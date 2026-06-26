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
  POST /api/weekly-reports/overrides/bulk              -> upsert many overrides (Fetch all)
  POST /api/weekly-reports/fetch-closure-batch         -> Gmail lookup + DB persist (Fetch all)
"""
from __future__ import annotations

import json
import time
from datetime import date, datetime
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

FETCH_CLOSURE_BATCH_MAX = 5
FETCH_CLOSURE_ITEM_DELAY_S = 0.45


def _gmail_latest_status_payload(search_text: str, *, newer_days: int = 400) -> dict[str, Any]:
    """Resolve via app config (set in main.py) to avoid circular imports."""
    from flask import current_app

    fn = current_app.config.get("GMAIL_CLOSURE_RESOLVER")
    if fn is None:
        raise RuntimeError("Gmail closure resolver not registered on app")
    return fn(search_text, newer_days=newer_days)


def _bulk_upsert_overrides(
    db,
    user: User,
    message_id: str,
    entries: list[tuple[int, str, str]],
) -> int:
    """Upsert (row_index, field, value) tuples; overwrites existing values. Returns count written."""
    written = 0
    now = datetime.utcnow()
    for row_index, field, value in entries:
        if field not in ALLOWED_OVERRIDE_FIELDS or row_index < 0:
            continue
        stmt = select(WeeklyReportOverride).where(
            and_(
                WeeklyReportOverride.message_id == message_id,
                WeeklyReportOverride.row_index == row_index,
                WeeklyReportOverride.field == field,
            )
        )
        existing = db.execute(stmt).scalar_one_or_none()
        if existing is None:
            db.add(
                WeeklyReportOverride(
                    message_id=message_id,
                    row_index=row_index,
                    field=field,
                    value=value,
                    updated_by_user_id=user.id,
                )
            )
        else:
            existing.value = value
            existing.updated_by_user_id = user.id
            existing.updated_at = now
        written += 1
    return written


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


def _as_date(d: datetime | date) -> date:
    return d.date() if isinstance(d, datetime) else d


def _build_weekly_gmail_query(after: datetime | date, before: datetime | date) -> str:
    """
    Gmail search for PB Weekly report messages.

    Do not rely on `from:PB_weekly@global.ntt` alone — messages often show as
    "'NTT SOAR' via PB SOC" with a different envelope From. Subject + CSV is stable.
    """
    a = _as_date(after)
    b = _as_date(before)
    return (
        f'subject:"{WEEKLY_REPORTS_SUBJECT}" has:attachment filename:csv '
        f"after:{a.year}/{a.month}/{a.day} "
        f"before:{b.year}/{b.month}/{b.day}"
    )


def _is_pb_weekly_message(em: dict[str, Any]) -> bool:
    subj = (em.get("subject") or "").strip().lower()
    if WEEKLY_REPORTS_SUBJECT.lower() not in subj and "pb weekly" not in subj:
        return False
    csv = em.get("csvAttachment") or {}
    rows = csv.get("rows") or []
    return isinstance(rows, list) and len(rows) > 0


def _pull_gmail_weekly(
    after: datetime | date, before: datetime | date, max_results: int
) -> list[dict[str, Any]]:
    try:
        from auth.gmail_auth import is_gmail_connected, remove_token
        from email_client.gmail_client import fetch_recent_alerts
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(f"Gmail not configured on server: {exc}") from exc

    if not is_gmail_connected():
        raise PermissionError("Not connected. Reconnect Gmail first via /api/auth/google")

    query = _build_weekly_gmail_query(after, before)
    try:
        raw = fetch_recent_alerts(
            query=query, max_results=max_results, include_csv_attachments=True
        )
        return [em for em in raw if _is_pb_weekly_message(em)]
    except Exception as exc:
        if "invalid_grant" in str(exc).lower():
            try:
                remove_token()
            except Exception:
                pass
            raise PermissionError(
                "Gmail sign-in expired. Please reconnect Gmail."
            ) from exc
        raise


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

    from email_client.gmail_client import is_transient_gmail_error

    emails = None
    last_sync_exc: Exception | None = None
    for attempt in range(4):
        try:
            emails = _pull_gmail_weekly(after, before, max_results)
            break
        except PermissionError as exc:
            return jsonify({"error": str(exc)}), 401
        except RuntimeError as exc:
            return jsonify({"error": str(exc)}), 503
        except Exception as exc:
            last_sync_exc = exc
            if not is_transient_gmail_error(exc) or attempt >= 3:
                return jsonify({"error": str(exc)}), 500
            time.sleep(1.2 * (2**attempt))
    if emails is None:
        return jsonify({"error": str(last_sync_exc or "Gmail sync failed")}), 500

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
            "gmailQuery": _build_weekly_gmail_query(after, before),
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


# ---------------------------------------------------------------------------
# POST /api/weekly-reports/overrides/bulk
# ---------------------------------------------------------------------------

@weekly_bp.post("/overrides/bulk")
@require_auth
def bulk_upsert_overrides():
    """
    Upsert many overrides in one transaction (Fetch-all saves).
    Unlike /overrides/import, existing values ARE overwritten.
    Body: { overrides: [{ message_id, row_index, field, value }, ...] }
    """
    body = request.get_json(silent=True) or {}
    items = body.get("overrides")
    if not isinstance(items, list) or not items:
        return jsonify({"error": "overrides must be a non-empty list"}), 400
    if len(items) > 200:
        return jsonify({"error": "At most 200 overrides per bulk request"}), 400

    user: User = g.current_user
    db = SessionLocal()
    try:
        entries: list[tuple[str, int, str, str]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            mid = str(item.get("message_id") or "").strip()
            field = str(item.get("field") or "").strip().lower()
            value = item.get("value")
            try:
                idx = int(item.get("row_index"))
            except (TypeError, ValueError):
                continue
            if (
                not mid
                or idx < 0
                or field not in ALLOWED_OVERRIDE_FIELDS
                or not isinstance(value, str)
            ):
                continue
            entries.append((mid, idx, field, value))

        if not entries:
            return jsonify({"error": "No valid overrides in request"}), 400

        message_ids = {e[0] for e in entries}
        known = {
            row[0]
            for row in db.execute(
                select(WeeklyReportEmail.id).where(WeeklyReportEmail.id.in_(message_ids))
            ).all()
        }
        written = 0
        by_message: dict[str, list[tuple[int, str, str]]] = {}
        for mid, idx, field, value in entries:
            if mid not in known:
                continue
            by_message.setdefault(mid, []).append((idx, field, value))
        for mid, group in by_message.items():
            written += _bulk_upsert_overrides(db, user, mid, group)
        db.commit()
        return jsonify({"ok": True, "written": written}), 200
    except Exception as exc:
        db.rollback()
        return jsonify({"error": str(exc)}), 500
    finally:
        db.close()


# ---------------------------------------------------------------------------
# POST /api/weekly-reports/fetch-closure-batch
# ---------------------------------------------------------------------------

@weekly_bp.post("/fetch-closure-batch")
@require_auth
def fetch_closure_batch():
    """
    Gmail closure lookup + DB persist for up to 10 rows in one HTTP request.
    Body: {
      message_id: str,
      newer_than_days?: int,
      items: [{ row_index: int, queries: string[] }]
    }
    """
    try:
        from auth.gmail_auth import is_gmail_connected
    except ImportError:
        return jsonify({"error": "Gmail not configured"}), 503
    if not is_gmail_connected():
        return jsonify({"error": "Not connected. Connect Gmail first."}), 401

    body = request.get_json(silent=True) or {}
    message_id = str(body.get("message_id") or "").strip()
    items = body.get("items")
    newer_days = max(1, min(int(body.get("newer_than_days", 400)), 450))
    if not message_id:
        return jsonify({"error": "message_id is required"}), 400
    if not isinstance(items, list) or not items:
        return jsonify({"error": "items must be a non-empty list"}), 400
    if len(items) > FETCH_CLOSURE_BATCH_MAX:
        return jsonify({"error": f"At most {FETCH_CLOSURE_BATCH_MAX} items per batch"}), 400

    user: User = g.current_user
    db = SessionLocal()
    try:
        email = db.get(WeeklyReportEmail, message_id)
        if email is None:
            return jsonify({"error": "unknown message_id; sync this report first"}), 404

        results: list[dict[str, Any]] = []
        override_entries: list[tuple[int, str, str]] = []
        rows_updated = 0
        dates_set = 0

        for idx_item, item in enumerate(items):
            if not isinstance(item, dict):
                results.append({"rowIndex": None, "error": "invalid item"})
                continue
            try:
                row_index = int(item.get("row_index"))
            except (TypeError, ValueError):
                results.append({"rowIndex": None, "error": "row_index must be int"})
                continue
            raw_queries = item.get("queries") or []
            if isinstance(raw_queries, str):
                raw_queries = [raw_queries]
            queries: list[str] = []
            seen: set[str] = set()
            for q in raw_queries:
                t = str(q).strip()
                if t and t not in seen:
                    seen.add(t)
                    queries.append(t)

            row_result: dict[str, Any] = {
                "rowIndex": row_index,
                "suggestedStatus": None,
                "suggestedClosureComment": None,
                "matchedEmailDateIso": None,
                "persisted": False,
            }
            last_error: str | None = None
            payload: dict[str, Any] | None = None
            had_successful_lookup = False
            for q in queries:
                try:
                    payload = _gmail_latest_status_payload(q, newer_days=newer_days)
                    had_successful_lookup = True
                    row_result.update(
                        {
                            k: payload.get(k)
                            for k in (
                                "suggestedStatus",
                                "suggestedClosureComment",
                                "matchedEmailDateIso",
                            )
                        }
                    )
                    if payload.get("notFound"):
                        row_result["notFound"] = True
                    if payload.get("suggestedStatus"):
                        break
                except Exception as exc:
                    last_error = str(exc)
            if not had_successful_lookup and last_error:
                row_result["error"] = last_error

            status = row_result.get("suggestedStatus")
            if status in ("Closed", "Incident Auto Closed"):
                status_to_set = (
                    "Incident Auto Closed" if status == "Incident Auto Closed" else "Closed"
                )
                closure = (row_result.get("suggestedClosureComment") or "").strip() or "Closed from email"
                date_iso = (row_result.get("matchedEmailDateIso") or "").strip()
                override_entries.append((row_index, "status", status_to_set))
                override_entries.append((row_index, "closure_comment", closure))
                if date_iso:
                    override_entries.append((row_index, "closure_date", date_iso))
                    dates_set += 1
                row_result["persisted"] = True
                rows_updated += 1

            results.append(row_result)
            if idx_item < len(items) - 1:
                time.sleep(FETCH_CLOSURE_ITEM_DELAY_S)

        if override_entries:
            _bulk_upsert_overrides(db, user, message_id, override_entries)
        db.commit()
        return jsonify(
            {
                "ok": True,
                "results": results,
                "updated": rows_updated,
                "datesSet": dates_set,
            }
        ), 200
    except Exception as exc:
        db.rollback()
        print("fetch-closure-batch error:", exc, flush=True)
        return jsonify({"error": str(exc)}), 500
    finally:
        db.close()
