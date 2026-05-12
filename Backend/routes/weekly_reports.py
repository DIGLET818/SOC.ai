"""
Weekly Reports HTTP API.

Source of truth for weekly-report alerts and the analyst overrides moved
*off* IndexedDB / localStorage. All endpoints are session-authenticated
(workspace rule: PII-returning APIs must require strong auth) and use
SQLAlchemy ORM with bound parameters (workspace rule: no string-built SQL).

Endpoints (mounted at /api/weekly-reports/* via blueprint):

  GET  /api/me                                         -> current user info
  GET  /api/weekly-reports?after=YYYY-MM-DD&before=... -> emails + rows + overrides
  POST /api/weekly-reports/sync                        -> fetch from Gmail + upsert
  PATCH /api/weekly-reports/rows/<msg_id>/<row_idx>    -> upsert one override
  POST /api/weekly-reports/overrides/import            -> bulk import from localStorage
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Iterable

from flask import Blueprint, jsonify, request, g
from sqlalchemy import select, and_

from db import SessionLocal
from auth.session import require_auth
from models.db_models import (
    User,
    WeeklyReportEmail,
    WeeklyReportRow,
    WeeklyReportOverride,
)


weekly_bp = Blueprint("weekly_reports", __name__)


WEEKLY_REPORTS_SENDER = "PB_weekly@global.ntt"
WEEKLY_REPORTS_SUBJECT = "PB Weekly report"
ALLOWED_OVERRIDE_FIELDS = {"status", "closure_comment", "closure_date"}


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _row_value(row: dict[str, Any], *keys: str) -> str:
    """Case/space-insensitive lookup against a CSV row dict (mirrors frontend)."""
    if not isinstance(row, dict):
        return ""
    norm = {str(k).lower().replace(" ", ""): v for k, v in row.items()}
    for want in keys:
        v = norm.get(str(want).lower().replace(" ", ""))
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _parse_yyyymmdd(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d")
    except ValueError:
        return None


def _internal_date_ms(email: dict[str, Any]) -> int | None:
    raw = email.get("internalDate")
    try:
        if raw is not None:
            return int(raw)
    except (TypeError, ValueError):
        return None
    return None


def _email_to_payload(email: WeeklyReportEmail, headers: list[str], rows: list[WeeklyReportRow]) -> dict[str, Any]:
    """Shape that mirrors the existing GmailMessage / CsvAttachment frontend type."""
    csv_rows: list[dict[str, Any]] = []
    for r in rows:
        try:
            values = json.loads(r.values_json or "{}")
        except json.JSONDecodeError:
            values = {}
        if not isinstance(values, dict):
            values = {}
        values["__rowIndex"] = str(r.row_index)
        csv_rows.append(values)
    return {
        "id": email.id,
        "threadId": email.thread_id,
        "subject": email.subject,
        "from": email.from_address,
        "date": email.date_header,
        "internalDate": str(email.internal_date_ms) if email.internal_date_ms is not None else None,
        "body": "",
        "csvAttachment": {
            "filename": email.csv_filename or "weekly_report.csv",
            "headers": headers,
            "rows": csv_rows,
        },
    }


def _override_row_key(message_id: str, row_index: int) -> str:
    """Same shape as the frontend's `${emailId}-r${rowIndex}` key."""
    return f"{message_id}-r{row_index}"


def _serialise_overrides(items: Iterable[WeeklyReportOverride]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for o in items:
        key = _override_row_key(o.message_id, o.row_index)
        bucket = out.setdefault(
            key,
            {
                "messageId": o.message_id,
                "rowIndex": o.row_index,
                "status": None,
                "closure_comment": None,
                "closure_date": None,
                "updatedBy": None,
                "updatedAt": None,
            },
        )
        bucket[o.field] = o.value
        # Keep the most recent timestamp/user across the (message_id,row_index) pair.
        if o.updated_at and (
            bucket["updatedAt"] is None or o.updated_at.isoformat() > bucket["updatedAt"]
        ):
            bucket["updatedAt"] = o.updated_at.isoformat()
            bucket["updatedBy"] = (
                o.updated_by_user.email if o.updated_by_user is not None else None
            )
    return out


# ---------------------------------------------------------------------------
# GET /api/weekly-reports
# ---------------------------------------------------------------------------

@weekly_bp.get("")
@require_auth
def list_weekly_reports():
    """
    Returns all cached emails (with rows) whose internal_date_ms falls inside
    [after, before) -- matching the half-open Gmail convention -- plus the
    shared overrides for those rows. The frontend uses this to render the
    table identically to the old Gmail-direct path, but reading from the DB.
    """
    after_str = (request.args.get("after") or "").strip()
    before_str = (request.args.get("before") or "").strip()
    after = _parse_yyyymmdd(after_str)
    before = _parse_yyyymmdd(before_str)
    if after is None or before is None or before <= after:
        return jsonify({"error": "after and before must be YYYY-MM-DD with after < before"}), 400

    after_ms = int(after.timestamp() * 1000)
    before_ms = int(before.timestamp() * 1000)

    db = SessionLocal()
    try:
        emails_q = (
            select(WeeklyReportEmail)
            .where(
                and_(
                    WeeklyReportEmail.internal_date_ms.isnot(None),
                    WeeklyReportEmail.internal_date_ms >= after_ms,
                    WeeklyReportEmail.internal_date_ms < before_ms,
                )
            )
            .order_by(WeeklyReportEmail.internal_date_ms.asc())
        )
        emails = db.execute(emails_q).scalars().all()
        email_ids = [e.id for e in emails]

        payload_emails: list[dict[str, Any]] = []
        if email_ids:
            rows_q = select(WeeklyReportRow).where(WeeklyReportRow.message_id.in_(email_ids))
            rows_by_email: dict[str, list[WeeklyReportRow]] = {eid: [] for eid in email_ids}
            for r in db.execute(rows_q).scalars():
                rows_by_email.setdefault(r.message_id, []).append(r)
            for e in emails:
                try:
                    headers = json.loads(e.headers_json or "[]")
                except json.JSONDecodeError:
                    headers = []
                if not isinstance(headers, list):
                    headers = []
                rows = sorted(rows_by_email.get(e.id, []), key=lambda r: r.row_index)
                payload_emails.append(_email_to_payload(e, headers, rows))

        overrides: dict[str, dict[str, Any]] = {}
        if email_ids:
            ovr_q = (
                select(WeeklyReportOverride)
                .where(WeeklyReportOverride.message_id.in_(email_ids))
            )
            overrides = _serialise_overrides(db.execute(ovr_q).scalars())

        return jsonify({"emails": payload_emails, "overrides": overrides})
    finally:
        db.close()


# ---------------------------------------------------------------------------
# POST /api/weekly-reports/sync
# ---------------------------------------------------------------------------

@weekly_bp.post("/sync")
@require_auth
def sync_weekly_reports():
    """
    Pull PB Weekly emails for [after, before) from Gmail and upsert into the DB.
    Reuses the existing email_client helpers so we keep parity with the old
    /api/gmail/messages path.
    """
    body = request.get_json(silent=True) or {}
    after_str = (body.get("after") or "").strip()
    before_str = (body.get("before") or "").strip()
    after = _parse_yyyymmdd(after_str)
    before = _parse_yyyymmdd(before_str)
    if after is None or before is None or before <= after:
        return jsonify({"error": "after and before must be YYYY-MM-DD with after < before"}), 400

    try:
        max_results = int(body.get("max_results") or 2000)
    except (TypeError, ValueError):
        max_results = 2000
    max_results = max(1, min(max_results, 5000))

    # Guard against missing Gmail config -- mirrors the old endpoints.
    try:
        from auth.gmail_auth import is_gmail_connected, remove_token
        from email_client.gmail_client import fetch_recent_alerts
    except Exception as exc:  # pragma: no cover - import time guard
        return jsonify({"error": f"Gmail not configured on server: {exc}"}), 503

    if not is_gmail_connected():
        return jsonify({"error": "Not connected. Reconnect Gmail first via /api/auth/google"}), 401

    query = (
        f'from:{WEEKLY_REPORTS_SENDER} subject:"{WEEKLY_REPORTS_SUBJECT}" '
        f"after:{after.year}/{after.month}/{after.day} "
        f"before:{before.year}/{before.month}/{before.day}"
    )

    try:
        emails = fetch_recent_alerts(
            query=query, max_results=max_results, include_csv_attachments=True
        )
    except Exception as exc:
        if "invalid_grant" in str(exc).lower():
            try:
                remove_token()
            except Exception:
                pass
            return jsonify({"error": "Gmail sign-in expired. Please reconnect Gmail."}), 401
        return jsonify({"error": str(exc)}), 500

    user: User = g.current_user
    inserted_emails = 0
    updated_emails = 0
    inserted_rows = 0
    skipped_no_csv = 0

    db = SessionLocal()
    try:
        for em in emails:
            csv = em.get("csvAttachment") or {}
            headers = csv.get("headers") or []
            rows = csv.get("rows") or []
            if not isinstance(rows, list) or len(rows) == 0:
                skipped_no_csv += 1
                continue

            existing = db.get(WeeklyReportEmail, em.get("id"))
            internal_ms = _internal_date_ms(em)
            if existing is None:
                rec = WeeklyReportEmail(
                    id=em.get("id"),
                    thread_id=em.get("threadId"),
                    subject=em.get("subject"),
                    from_address=em.get("from"),
                    date_header=em.get("date"),
                    internal_date_ms=internal_ms,
                    csv_filename=csv.get("filename") or "weekly_report.csv",
                    headers_json=json.dumps(headers if isinstance(headers, list) else []),
                    fetched_by_user_id=user.id,
                )
                db.add(rec)
                inserted_emails += 1
            else:
                existing.subject = em.get("subject")
                existing.from_address = em.get("from")
                existing.date_header = em.get("date")
                existing.internal_date_ms = internal_ms
                existing.csv_filename = csv.get("filename") or existing.csv_filename
                existing.headers_json = json.dumps(headers if isinstance(headers, list) else [])
                existing.fetched_at = datetime.utcnow()
                existing.fetched_by_user_id = user.id
                # Replace existing rows for this message (idempotent re-sync).
                db.query(WeeklyReportRow).filter(
                    WeeklyReportRow.message_id == existing.id
                ).delete(synchronize_session=False)
                updated_emails += 1

            for idx, row in enumerate(rows):
                if not isinstance(row, dict):
                    continue
                clean = {k: v for k, v in row.items() if k != "__rowIndex"}
                db.add(
                    WeeklyReportRow(
                        message_id=em.get("id"),
                        row_index=idx,
                        values_json=json.dumps(clean, ensure_ascii=False),
                        incident_id=_row_value(clean, "IncidentID", "Incident ID") or None,
                        servicenow_ticket=_row_value(
                            clean, "ServicenowTicket", "ServiceNow Ticket", "ServicenowT"
                        )
                        or None,
                        csv_status=_row_value(clean, "Status") or None,
                        created_iso=_row_value(
                            clean,
                            "Created",
                            "CreationDate",
                            "Creation Date",
                            "Created_On",
                            "CreatedOn",
                        )
                        or None,
                    )
                )
                inserted_rows += 1
        db.commit()
    except Exception as exc:
        db.rollback()
        return jsonify({"error": f"Sync failed: {exc}"}), 500
    finally:
        db.close()

    return jsonify(
        {
            "ok": True,
            "syncedEmails": inserted_emails + updated_emails,
            "insertedEmails": inserted_emails,
            "updatedEmails": updated_emails,
            "insertedRows": inserted_rows,
            "skippedNoCsv": skipped_no_csv,
        }
    )


# ---------------------------------------------------------------------------
# PATCH /api/weekly-reports/rows/<message_id>/<row_index>
# ---------------------------------------------------------------------------

@weekly_bp.patch("/rows/<string:message_id>/<int:row_index>")
@require_auth
def upsert_row_override(message_id: str, row_index: int):
    body = request.get_json(silent=True) or {}
    field = (body.get("field") or "").strip().lower()
    value = body.get("value")
    if field not in ALLOWED_OVERRIDE_FIELDS:
        return (
            jsonify({"error": f"field must be one of {sorted(ALLOWED_OVERRIDE_FIELDS)}"}),
            400,
        )
    if not isinstance(value, str):
        return jsonify({"error": "value must be a string"}), 400
    if row_index < 0:
        return jsonify({"error": "row_index must be >= 0"}), 400

    user: User = g.current_user
    db = SessionLocal()
    try:
        # Soft FK check: refuse to attach overrides to an unknown message.
        email = db.get(WeeklyReportEmail, message_id)
        if email is None:
            return (
                jsonify({"error": "unknown message_id; sync this report first"}),
                404,
            )

        stmt = select(WeeklyReportOverride).where(
            and_(
                WeeklyReportOverride.message_id == message_id,
                WeeklyReportOverride.row_index == row_index,
                WeeklyReportOverride.field == field,
            )
        )
        existing = db.execute(stmt).scalar_one_or_none()
        if existing is None:
            existing = WeeklyReportOverride(
                message_id=message_id,
                row_index=row_index,
                field=field,
                value=value,
                updated_by_user_id=user.id,
            )
            db.add(existing)
        else:
            existing.value = value
            existing.updated_by_user_id = user.id
            existing.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(existing)

        return jsonify(
            {
                "ok": True,
                "override": {
                    "messageId": existing.message_id,
                    "rowIndex": existing.row_index,
                    "field": existing.field,
                    "value": existing.value,
                    "updatedBy": user.email,
                    "updatedAt": existing.updated_at.isoformat(),
                },
            }
        )
    finally:
        db.close()


# ---------------------------------------------------------------------------
# POST /api/weekly-reports/overrides/import
# ---------------------------------------------------------------------------

@weekly_bp.post("/overrides/import")
@require_auth
def import_overrides():
    """
    One-shot migration endpoint for the localStorage overrides. Accepts a list of
    {message_id, row_index, field, value} entries. Each is upserted; values that
    already exist server-side are NOT overwritten (so importing twice is safe).
    Returns counts of imported / skipped.
    """
    body = request.get_json(silent=True) or {}
    items = body.get("overrides")
    if not isinstance(items, list):
        return jsonify({"error": "overrides must be a list"}), 400

    user: User = g.current_user
    imported = 0
    skipped_existing = 0
    skipped_invalid = 0
    skipped_unknown_email = 0

    db = SessionLocal()
    try:
        # Collect all referenced message ids in one query so we can validate cheaply.
        referenced_ids: set[str] = set()
        normalised: list[tuple[str, int, str, str]] = []
        for item in items:
            if not isinstance(item, dict):
                skipped_invalid += 1
                continue
            mid = str(item.get("message_id") or "").strip()
            field = str(item.get("field") or "").strip().lower()
            value = item.get("value")
            try:
                idx = int(item.get("row_index"))
            except (TypeError, ValueError):
                skipped_invalid += 1
                continue
            if (
                not mid
                or idx < 0
                or field not in ALLOWED_OVERRIDE_FIELDS
                or not isinstance(value, str)
            ):
                skipped_invalid += 1
                continue
            referenced_ids.add(mid)
            normalised.append((mid, idx, field, value))

        known_ids: set[str] = set()
        if referenced_ids:
            known_q = select(WeeklyReportEmail.id).where(
                WeeklyReportEmail.id.in_(list(referenced_ids))
            )
            known_ids = {row[0] for row in db.execute(known_q).all()}

        for mid, idx, field, value in normalised:
            if mid not in known_ids:
                skipped_unknown_email += 1
                continue
            stmt = select(WeeklyReportOverride).where(
                and_(
                    WeeklyReportOverride.message_id == mid,
                    WeeklyReportOverride.row_index == idx,
                    WeeklyReportOverride.field == field,
                )
            )
            existing = db.execute(stmt).scalar_one_or_none()
            if existing is not None:
                skipped_existing += 1
                continue
            db.add(
                WeeklyReportOverride(
                    message_id=mid,
                    row_index=idx,
                    field=field,
                    value=value,
                    updated_by_user_id=user.id,
                )
            )
            imported += 1
        db.commit()
    except Exception as exc:
        db.rollback()
        return jsonify({"error": f"Import failed: {exc}"}), 500
    finally:
        db.close()

    return jsonify(
        {
            "ok": True,
            "imported": imported,
            "skippedExisting": skipped_existing,
            "skippedUnknownEmail": skipped_unknown_email,
            "skippedInvalid": skipped_invalid,
            "totalSubmitted": len(items),
        }
    )
