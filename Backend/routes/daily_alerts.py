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
  POST  /api/daily-alerts/recover                         late delivery: Gmail search window
  POST  /api/daily-alerts/upload                          manual .csv file upload
  POST  /api/daily-alerts/upload-data                     parsed rows (.csv / .xlsx)
  PATCH /api/daily-alerts/emails/<msg_id>/report-date     pin report to a calendar day
  PATCH /api/daily-alerts/rows/<msg_id>/<row_idx>         upsert one override
  POST  /api/daily-alerts/overrides/import                bulk import from localStorage
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Any, Iterable

from flask import Blueprint, jsonify, request, g
from sqlalchemy import select, and_, or_
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


def _parse_yyyymmdd(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return datetime.strptime(s.strip(), "%Y-%m-%d").date()
    except ValueError:
        return None


def _date_to_ms(d: date) -> int:
    return int(datetime(d.year, d.month, d.day).timestamp() * 1000)


def _ms_to_date_iso(ms: int | None) -> str | None:
    if ms is None:
        return None
    return datetime.utcfromtimestamp(ms / 1000.0).date().isoformat()


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
        "reportDate": email.report_date,
        "receivedDate": _ms_to_date_iso(email.internal_date_ms),
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

    after_ms = _date_to_ms(after)
    before_ms = _date_to_ms(before)
    after_iso = after.isoformat()
    before_iso = before.isoformat()

    db = SessionLocal()
    try:
        # Include emails whose *report* day is in range (late delivery) OR whose
        # Gmail received date is in range when no report_date override is set.
        emails_q = (
            select(DailyReportEmail)
            .where(
                or_(
                    and_(
                        DailyReportEmail.report_date.isnot(None),
                        DailyReportEmail.report_date >= after_iso,
                        DailyReportEmail.report_date < before_iso,
                    ),
                    and_(
                        DailyReportEmail.report_date.is_(None),
                        DailyReportEmail.internal_date_ms.isnot(None),
                        DailyReportEmail.internal_date_ms >= after_ms,
                        DailyReportEmail.internal_date_ms < before_ms,
                    ),
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
# Gmail upsert helper (shared by /sync and /recover)
# ---------------------------------------------------------------------------

def _build_daily_gmail_query(after: date, before: date) -> str:
    """
    Gmail search for PB Daily report messages.

    Do not rely on `from:PB_daily@global.ntt` alone — messages often show as
    "'NTT SOAR' via PB SOC" with a different envelope From. Subject + CSV is stable.
    """
    return (
        f'subject:"{DAILY_ALERTS_SUBJECT}" has:attachment filename:csv '
        f"after:{after.year}/{after.month}/{after.day} "
        f"before:{before.year}/{before.month}/{before.day}"
    )


def _is_pb_daily_message(em: dict[str, Any]) -> bool:
    """Post-filter: subject must look like PB Daily; keep CSV rows only."""
    subj = (em.get("subject") or "").strip().lower()
    if DAILY_ALERTS_SUBJECT.lower() not in subj and "pb daily" not in subj:
        return False
    csv = em.get("csvAttachment") or {}
    rows = csv.get("rows") or []
    return isinstance(rows, list) and len(rows) > 0


def _pull_gmail_daily(after: date, before: date, max_results: int) -> list[dict[str, Any]]:
    try:
        from auth.gmail_auth import is_gmail_connected, remove_token
        from email_client.gmail_client import fetch_recent_alerts
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(f"Gmail not configured on server: {exc}") from exc

    if not is_gmail_connected():
        raise PermissionError("Not connected. Reconnect Gmail first via /api/auth/google")

    query = _build_daily_gmail_query(after, before)
    try:
        raw = fetch_recent_alerts(
            query=query, max_results=max_results, include_csv_attachments=True
        )
        return [em for em in raw if _is_pb_daily_message(em)]
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


def _upsert_gmail_emails(
    db,
    emails: list[dict[str, Any]],
    user: User,
) -> dict[str, Any]:
    inserted_emails = 0
    updated_emails = 0
    inserted_rows = 0
    skipped_no_csv = 0
    synced_ids: list[str] = []

    for em in emails:
        csv = em.get("csvAttachment") or {}
        headers = csv.get("headers") or []
        rows = csv.get("rows") or []
        if not isinstance(rows, list) or len(rows) == 0:
            skipped_no_csv += 1
            continue

        mid = em.get("id")
        if not mid:
            continue
        synced_ids.append(mid)

        existing = db.get(DailyReportEmail, mid)
        internal_ms = _internal_date_ms(em)
        if existing is None:
            rec = DailyReportEmail(
                id=mid,
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
                    message_id=mid,
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

    return {
        "insertedEmails": inserted_emails,
        "updatedEmails": updated_emails,
        "insertedRows": inserted_rows,
        "skippedNoCsv": skipped_no_csv,
        "syncedIds": synced_ids,
    }


def _upsert_csv_email(
    db,
    *,
    message_id: str,
    report_date: str,
    headers: list[str],
    rows: list[dict[str, Any]],
    filename: str,
    user: User,
) -> dict[str, int]:
    """Insert or replace a manually uploaded daily report for one calendar day."""
    existing = db.get(DailyReportEmail, message_id)
    if existing is None:
        rec = DailyReportEmail(
            id=message_id,
            subject=f"Manual upload — PB Daily report ({report_date})",
            from_address="manual-upload@sentinel-ai",
            date_header=report_date,
            internal_date_ms=_date_to_ms(_parse_yyyymmdd(report_date) or date.today()),
            report_date=report_date,
            csv_filename=filename,
            headers_json=json.dumps(headers),
            fetched_by_user_id=user.id,
        )
        db.add(rec)
        inserted = 1
        updated = 0
    else:
        existing.subject = f"Manual upload — PB Daily report ({report_date})"
        existing.report_date = report_date
        existing.csv_filename = filename
        existing.headers_json = json.dumps(headers)
        existing.fetched_at = datetime.utcnow()
        existing.fetched_by_user_id = user.id
        db.query(DailyReportRow).filter(
            DailyReportRow.message_id == message_id
        ).delete(synchronize_session=False)
        inserted = 0
        updated = 1

    row_count = 0
    for idx, row in enumerate(rows):
        if not isinstance(row, dict):
            continue
        clean = {k: v for k, v in row.items() if k != "__rowIndex"}
        db.add(
            DailyReportRow(
                message_id=message_id,
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
        row_count += 1
    return {"insertedEmails": inserted, "updatedEmails": updated, "insertedRows": row_count}


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

    user: User = g.current_user
    stats: dict[str, Any] = {
        "insertedEmails": 0,
        "updatedEmails": 0,
        "insertedRows": 0,
        "skippedNoCsv": 0,
    }
    db = SessionLocal()
    try:
        try:
            emails = _pull_gmail_daily(after, before, max_results)
        except PermissionError as exc:
            return jsonify({"error": str(exc)}), 401
        except RuntimeError as exc:
            return jsonify({"error": str(exc)}), 503

        stats = _upsert_gmail_emails(db, emails, user)
        db.commit()
    except Exception as exc:
        db.rollback()
        return jsonify({"error": f"Sync failed: {exc}"}), 500
    finally:
        db.close()

    inserted_emails = stats["insertedEmails"]
    updated_emails = stats["updatedEmails"]
    return jsonify(
        {
            "ok": True,
            "syncedEmails": inserted_emails + updated_emails,
            "insertedEmails": inserted_emails,
            "updatedEmails": updated_emails,
            "insertedRows": stats["insertedRows"],
            "skippedNoCsv": stats["skippedNoCsv"],
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


# ---------------------------------------------------------------------------
# POST /api/daily-alerts/recover  (late delivery for a missing report day)
# ---------------------------------------------------------------------------

@daily_bp.post("/recover")
@require_auth
def recover_missing_daily_report():
    """
    Search Gmail for PB Daily emails received within `search_days` after a
    missing `report_date`, import them, and optionally assign one email to
    that report day on the dashboard calendar.

    Body:
      report_date   YYYY-MM-DD  (the day that was missing on the dashboard)
      search_days   optional, default 14, max 31
      message_id    optional -- when set, assign this Gmail message to report_date
    """
    body = request.get_json(silent=True) or {}
    report_date = _parse_yyyymmdd((body.get("report_date") or "").strip())
    if report_date is None:
        return jsonify({"error": "report_date must be YYYY-MM-DD"}), 400

    try:
        search_days = int(body.get("search_days") or 14)
    except (TypeError, ValueError):
        search_days = 14
    search_days = max(1, min(search_days, 31))

    assign_message_id = (body.get("message_id") or "").strip() or None

    try:
        max_results = int(body.get("max_results") or 200)
    except (TypeError, ValueError):
        max_results = 200
    max_results = max(1, min(max_results, 500))

    # Reports for calendar day D may arrive in Gmail on D or a few days earlier/later.
    lookback_days = 7
    try:
        lookback_days = int(body.get("lookback_days") or 7)
    except (TypeError, ValueError):
        lookback_days = 7
    lookback_days = max(0, min(lookback_days, 14))

    search_after = report_date - timedelta(days=lookback_days)
    search_before = report_date + timedelta(days=search_days)

    user: User = g.current_user
    db = SessionLocal()
    try:
        try:
            emails = _pull_gmail_daily(search_after, search_before, max_results)
        except PermissionError as exc:
            return jsonify({"error": str(exc)}), 401
        except RuntimeError as exc:
            return jsonify({"error": str(exc)}), 503

        stats = _upsert_gmail_emails(db, emails, user)

        candidates: list[dict[str, Any]] = []
        for mid in stats["syncedIds"]:
            rec = db.get(DailyReportEmail, mid)
            if rec is None:
                continue
            row_count = (
                db.query(DailyReportRow)
                .filter(DailyReportRow.message_id == mid)
                .count()
            )
            candidates.append(
                {
                    "messageId": mid,
                    "subject": rec.subject,
                    "receivedDate": _ms_to_date_iso(rec.internal_date_ms),
                    "reportDate": rec.report_date,
                    "rowCount": row_count,
                }
            )

        assigned = False
        if assign_message_id:
            rec = db.get(DailyReportEmail, assign_message_id)
            if rec is None:
                db.rollback()
                return (
                    jsonify(
                        {
                            "error": "message_id not found; run recover without message_id first"
                        }
                    ),
                    404,
                )
            rec.report_date = report_date.isoformat()
            assigned = True

        db.commit()
    except Exception as exc:
        db.rollback()
        return jsonify({"error": f"Recover failed: {exc}"}), 500
    finally:
        db.close()

    return jsonify(
        {
            "ok": True,
            "reportDate": report_date.isoformat(),
            "searchAfter": search_after.isoformat(),
            "searchBefore": search_before.isoformat(),
            "gmailQuery": _build_daily_gmail_query(search_after, search_before),
            "assigned": assigned,
            "assignedMessageId": assign_message_id if assigned else None,
            "candidates": candidates,
            "syncedEmails": stats["insertedEmails"] + stats["updatedEmails"],
            "skippedNoCsv": stats["skippedNoCsv"],
        }
    )


# ---------------------------------------------------------------------------
# PATCH /api/daily-alerts/emails/<message_id>/report-date
# ---------------------------------------------------------------------------

@daily_bp.patch("/emails/<string:message_id>/report-date")
@require_auth
def set_daily_report_date(message_id: str):
    """Pin a loaded daily email to a dashboard calendar day (or clear with null)."""
    body = request.get_json(silent=True) or {}
    raw = body.get("report_date")
    if raw is None:
        return jsonify({"error": "report_date is required (string YYYY-MM-DD or null)"}), 400

    db = SessionLocal()
    try:
        rec = db.get(DailyReportEmail, message_id)
        if rec is None:
            return jsonify({"error": "unknown message_id; sync or upload this report first"}), 404

        if raw is None or (isinstance(raw, str) and not raw.strip()):
            rec.report_date = None
        else:
            parsed = _parse_yyyymmdd(str(raw).strip())
            if parsed is None:
                return jsonify({"error": "report_date must be YYYY-MM-DD or null"}), 400
            rec.report_date = parsed.isoformat()

        db.commit()
        db.refresh(rec)
        return jsonify(
            {
                "ok": True,
                "messageId": rec.id,
                "reportDate": rec.report_date,
                "receivedDate": _ms_to_date_iso(rec.internal_date_ms),
            }
        )
    finally:
        db.close()


# ---------------------------------------------------------------------------
# POST /api/daily-alerts/upload  (manual .csv when email never arrived)
# ---------------------------------------------------------------------------

@daily_bp.post("/upload")
@require_auth
def upload_daily_report_csv():
    """
  multipart/form-data:
    report_date  YYYY-MM-DD  (required)
    file         .csv attachment (required)
    replace      optional "1" to overwrite an existing upload for that day
    """
    report_date = _parse_yyyymmdd((request.form.get("report_date") or "").strip())
    if report_date is None:
        return jsonify({"error": "report_date must be YYYY-MM-DD"}), 400

    upload = request.files.get("file")
    if upload is None or not upload.filename:
        return jsonify({"error": "file is required (.csv)"}), 400

    filename = upload.filename.strip()
    if not filename.lower().endswith(".csv"):
        return jsonify({"error": "file must be a .csv"}), 400

    raw = upload.read()
    if not raw:
        return jsonify({"error": "empty file"}), 400
    if len(raw) > 8 * 1024 * 1024:
        return jsonify({"error": "file too large (max 8 MB)"}), 400

    try:
        from email_client.gmail_client import _parse_csv_raw
    except Exception as exc:
        return jsonify({"error": f"CSV parser unavailable: {exc}"}), 503

    parsed = _parse_csv_raw(raw, filename)
    if not parsed or not parsed.get("rows"):
        return jsonify({"error": "could not parse CSV or file has no data rows"}), 400

    headers = parsed.get("headers") or []
    rows = parsed.get("rows") or []
    if not isinstance(headers, list) or not isinstance(rows, list):
        return jsonify({"error": "invalid CSV shape"}), 400

    report_iso = report_date.isoformat()
    message_id = f"upload-{report_iso}"

    user: User = g.current_user
    db = SessionLocal()
    try:
        existing = db.get(DailyReportEmail, message_id)
        replace = (request.form.get("replace") or "").strip().lower() in (
            "1",
            "true",
            "yes",
        )
        if existing is not None and not replace:
            return (
                jsonify(
                    {
                        "error": (
                            f"A manual upload already exists for {report_iso}. "
                            "Send replace=1 to overwrite."
                        ),
                        "messageId": message_id,
                    }
                ),
                409,
            )

        stats = _upsert_csv_email(
            db,
            message_id=message_id,
            report_date=report_iso,
            headers=headers,
            rows=rows,
            filename=filename,
            user=user,
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        return jsonify({"error": f"Upload failed: {exc}"}), 500
    finally:
        db.close()

    return jsonify(
        {
            "ok": True,
            "messageId": message_id,
            "reportDate": report_iso,
            "rowCount": stats["insertedRows"],
            "insertedEmails": stats["insertedEmails"],
            "updatedEmails": stats["updatedEmails"],
        }
    )


# ---------------------------------------------------------------------------
# POST /api/daily-alerts/upload-data  (client-parsed .csv / .xlsx)
# ---------------------------------------------------------------------------

@daily_bp.post("/upload-data")
@require_auth
def upload_daily_report_data():
    """
    JSON body:
      report_date  YYYY-MM-DD
      filename     original file name
      headers      string[]
      rows         list of row objects
      replace      optional "1"
    """
    body = request.get_json(silent=True) or {}
    report_date = _parse_yyyymmdd((body.get("report_date") or "").strip())
    if report_date is None:
        return jsonify({"error": "report_date must be YYYY-MM-DD"}), 400

    filename = (body.get("filename") or "daily_report.csv").strip()
    if not filename:
        filename = "daily_report.csv"

    headers = body.get("headers")
    rows = body.get("rows")
    if not isinstance(headers, list) or not isinstance(rows, list):
        return jsonify({"error": "headers and rows are required"}), 400
    if len(rows) == 0:
        return jsonify({"error": "rows must not be empty"}), 400

    clean_headers = [str(h) for h in headers]
    clean_rows: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        clean_rows.append({str(k): str(v) if v is not None else "" for k, v in row.items()})
    if not clean_rows:
        return jsonify({"error": "no valid rows in payload"}), 400

    report_iso = report_date.isoformat()
    message_id = f"upload-{report_iso}"

    user: User = g.current_user
    db = SessionLocal()
    try:
        existing = db.get(DailyReportEmail, message_id)
        replace = str(body.get("replace") or "").strip().lower() in ("1", "true", "yes")
        if existing is not None and not replace:
            return (
                jsonify(
                    {
                        "error": (
                            f"A manual upload already exists for {report_iso}. "
                            "Send replace=1 to overwrite."
                        ),
                        "messageId": message_id,
                    }
                ),
                409,
            )

        stats = _upsert_csv_email(
            db,
            message_id=message_id,
            report_date=report_iso,
            headers=clean_headers,
            rows=clean_rows,
            filename=filename,
            user=user,
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        return jsonify({"error": f"Upload failed: {exc}"}), 500
    finally:
        db.close()

    return jsonify(
        {
            "ok": True,
            "messageId": message_id,
            "reportDate": report_iso,
            "rowCount": stats["insertedRows"],
            "insertedEmails": stats["insertedEmails"],
            "updatedEmails": stats["updatedEmails"],
        }
    )
