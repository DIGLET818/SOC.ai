"""
Daily Alerts HTTP API.

Source of truth for `PB Daily report` alerts -- moved off browser IndexedDB /
localStorage so analyst edits survive refresh, project restarts, browser
switches, and machine moves. The same dataset is surfaced on two pages:

  - /daily-alerts          (Daily Alerts)
  - /jira-tickets          (Jira Tickets, plus the per-row "Created in Jira"
                            mapping persisted via routes/jira_tickets.py)

All endpoints are session-authenticated (workspace rule: PII responses must
require strong auth) and use SQLAlchemy ORM bound parameters (workspace rule:
no string-built SQL).

Endpoints (mounted at /api/daily-alerts/* via blueprint):

  GET   /api/daily-alerts?after=YYYY-MM-DD&before=...     emails + rows + overrides + jiraCreated
  POST  /api/daily-alerts/sync                            fetch from Gmail + upsert
  PATCH /api/daily-alerts/rows/<msg_id>/<row_idx>         upsert one override
  POST  /api/daily-alerts/overrides/import                bulk import from localStorage
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Iterable

from flask import Blueprint, jsonify, request, g
from sqlalchemy import select, and_
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from db import SessionLocal
from auth.session import require_auth
from models.db_models import (
    User,
    DailyReportEmail,
    DailyReportRow,
    DailyReportOverride,
    JiraCreatedTicket,
)


daily_bp = Blueprint("daily_alerts", __name__)


DAILY_ALERTS_SENDER = "PB_daily@global.ntt"
DAILY_ALERTS_SUBJECT = "PB Daily report"
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


def _email_to_payload(
    email: DailyReportEmail,
    headers: list[str],
    rows: list[DailyReportRow],
) -> dict[str, Any]:
    """Shape that mirrors the frontend's GmailMessage / CsvAttachment type."""
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
            "filename": email.csv_filename or "daily_report.csv",
            "headers": headers,
            "rows": csv_rows,
        },
    }


def _override_row_key(message_id: str, row_index: int) -> str:
    """`${messageId}-r${rowIndex}` -- matches the legacy localStorage key shape."""
    return f"{message_id}-r{row_index}"


def _serialise_overrides(items: Iterable[DailyReportOverride]) -> dict[str, dict[str, Any]]:
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
        if o.updated_at and (
            bucket["updatedAt"] is None or o.updated_at.isoformat() > bucket["updatedAt"]
        ):
            bucket["updatedAt"] = o.updated_at.isoformat()
            bucket["updatedBy"] = (
                o.updated_by_user.email if o.updated_by_user is not None else None
            )
    return out


def _serialise_jira_tickets(items: Iterable[JiraCreatedTicket]) -> dict[str, dict[str, Any]]:
    """Keyed by `${messageId}-r${rowIndex}` so the frontend can do O(1) lookups."""
    out: dict[str, dict[str, Any]] = {}
    for t in items:
        out[_override_row_key(t.message_id, t.row_index)] = {
            "messageId": t.message_id,
            "rowIndex": t.row_index,
            "jiraKey": t.jira_key,
            "jiraUrl": t.jira_url,
            "incidentId": t.incident_id,
            "servicenowTicket": t.servicenow_ticket,
            "createdBy": t.created_by_user.email if t.created_by_user is not None else None,
            "createdAt": t.created_at.isoformat() if t.created_at else None,
        }
    return out


# ---------------------------------------------------------------------------
# GET /api/daily-alerts
# ---------------------------------------------------------------------------

@daily_bp.get("")
@require_auth
def list_daily_alerts():
    """
    Returns all cached daily emails (with rows) whose internal_date_ms falls
    inside [after, before), plus the shared overrides AND the per-row
    Jira-created mapping for those rows. Frontend uses this to render Daily
    Alerts and Jira Tickets identically to the old Gmail-direct flow but
    reading from the DB.
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
            select(DailyReportEmail)
            .where(
                and_(
                    DailyReportEmail.internal_date_ms.isnot(None),
                    DailyReportEmail.internal_date_ms >= after_ms,
                    DailyReportEmail.internal_date_ms < before_ms,
                )
            )
            .order_by(DailyReportEmail.internal_date_ms.asc())
        )
        emails = db.execute(emails_q).scalars().all()
        email_ids = [e.id for e in emails]

        payload_emails: list[dict[str, Any]] = []
        if email_ids:
            rows_q = select(DailyReportRow).where(DailyReportRow.message_id.in_(email_ids))
            rows_by_email: dict[str, list[DailyReportRow]] = {eid: [] for eid in email_ids}
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
        jira_created: dict[str, dict[str, Any]] = {}
        if email_ids:
            ovr_q = select(DailyReportOverride).where(
                DailyReportOverride.message_id.in_(email_ids)
            )
            overrides = _serialise_overrides(db.execute(ovr_q).scalars())

            jira_q = select(JiraCreatedTicket).where(
                JiraCreatedTicket.message_id.in_(email_ids)
            )
            jira_created = _serialise_jira_tickets(db.execute(jira_q).scalars())

        return jsonify(
            {
                "emails": payload_emails,
                "overrides": overrides,
                "jiraCreated": jira_created,
            }
        )
    finally:
        db.close()


# ---------------------------------------------------------------------------
# POST /api/daily-alerts/sync
# ---------------------------------------------------------------------------

@daily_bp.post("/sync")
@require_auth
def sync_daily_alerts():
    """
    Pull PB Daily emails for [after, before) from Gmail and upsert into the DB.
    Idempotent (re-runs of the same range refresh the cached rows in place).
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

    try:
        from auth.gmail_auth import is_gmail_connected, remove_token
        from email_client.gmail_client import fetch_recent_alerts
    except Exception as exc:  # pragma: no cover - import-time guard
        return jsonify({"error": f"Gmail not configured on server: {exc}"}), 503

    if not is_gmail_connected():
        return jsonify({"error": "Not connected. Reconnect Gmail first via /api/auth/google"}), 401

    query = (
        f'from:{DAILY_ALERTS_SENDER} subject:"{DAILY_ALERTS_SUBJECT}" '
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

            existing = db.get(DailyReportEmail, em.get("id"))
            internal_ms = _internal_date_ms(em)
            if existing is None:
                rec = DailyReportEmail(
                    id=em.get("id"),
                    thread_id=em.get("threadId"),
                    subject=em.get("subject"),
                    from_address=em.get("from"),
                    date_header=em.get("date"),
                    internal_date_ms=internal_ms,
                    csv_filename=csv.get("filename") or "daily_report.csv",
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
                # Replace existing rows in place so re-syncs are idempotent.
                # NB: this preserves daily_report_overrides + jira_created_tickets
                # because they reference (message_id, row_index) by FK to the
                # email -- the email row is kept, only its child rows are wiped.
                db.query(DailyReportRow).filter(
                    DailyReportRow.message_id == existing.id
                ).delete(synchronize_session=False)
                updated_emails += 1

            for idx, row in enumerate(rows):
                if not isinstance(row, dict):
                    continue
                clean = {k: v for k, v in row.items() if k != "__rowIndex"}
                db.add(
                    DailyReportRow(
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
# PATCH /api/daily-alerts/rows/<message_id>/<row_index>
# ---------------------------------------------------------------------------

@daily_bp.patch("/rows/<string:message_id>/<int:row_index>")
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
        email = db.get(DailyReportEmail, message_id)
        if email is None:
            return (
                jsonify({"error": "unknown message_id; sync this report first"}),
                404,
            )

        stmt = select(DailyReportOverride).where(
            and_(
                DailyReportOverride.message_id == message_id,
                DailyReportOverride.row_index == row_index,
                DailyReportOverride.field == field,
            )
        )
        existing = db.execute(stmt).scalar_one_or_none()
        if existing is None:
            existing = DailyReportOverride(
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
# POST /api/daily-alerts/overrides/import
# ---------------------------------------------------------------------------

@daily_bp.post("/overrides/import")
@require_auth
def import_overrides():
    """
    One-shot migration endpoint for the localStorage overrides. Accepts a list
    of {message_id, row_index, field, value} entries. Each is upserted; values
    that already exist server-side are NOT overwritten (so re-importing is
    safe). Returns counts of imported / skipped.
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
    skipped_batch_dup = 0

    db = SessionLocal()
    try:
        # 1. Validate the request body. Drop obviously-broken items.
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

        # 2. Drop items whose parent email isn't in the DB (FK would fail).
        known_ids: set[str] = set()
        if referenced_ids:
            known_q = select(DailyReportEmail.id).where(
                DailyReportEmail.id.in_(list(referenced_ids))
            )
            known_ids = {row[0] for row in db.execute(known_q).all()}

        # 3. De-dupe inside the request payload on the unique key
        #    (message_id, row_index, field). The legacy migration helper
        #    can emit the same logical override more than once when a
        #    legacy localStorage key matches multiple loaded rows; without
        #    this the second attempt fails the UNIQUE constraint and aborts
        #    the whole batch. Keep the first occurrence -- the values are
        #    almost always identical anyway.
        seen_in_batch: set[tuple[str, int, str]] = set()
        deduped: list[tuple[str, int, str, str]] = []
        for mid, idx, field, value in normalised:
            if mid not in known_ids:
                skipped_unknown_email += 1
                continue
            key = (mid, idx, field)
            if key in seen_in_batch:
                skipped_batch_dup += 1
                continue
            seen_in_batch.add(key)
            deduped.append((mid, idx, field, value))

        # 4. INSERT ... ON CONFLICT DO NOTHING: any row that already exists
        #    server-side is silently skipped, so re-running this endpoint
        #    is safe and one bad duplicate can never abort the rest of the
        #    batch with an IntegrityError mid-commit.
        for mid, idx, field, value in deduped:
            stmt = (
                sqlite_insert(DailyReportOverride)
                .values(
                    message_id=mid,
                    row_index=idx,
                    field=field,
                    value=value,
                    updated_by_user_id=user.id,
                )
                .on_conflict_do_nothing(
                    index_elements=["message_id", "row_index", "field"]
                )
            )
            result = db.execute(stmt)
            if result.rowcount == 1:
                imported += 1
            else:
                skipped_existing += 1
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
            "skippedBatchDuplicate": skipped_batch_dup,
            "totalSubmitted": len(items),
        }
    )
