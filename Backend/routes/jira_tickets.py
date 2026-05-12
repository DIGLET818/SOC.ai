"""
Jira Tickets HTTP API.

Persistent server-side mapping of `(daily_report_email.message_id, row_index)`
-> Jira issue key. Replaces the `sentinel_jira_created_keys` localStorage
map that lived only in one browser and silently dropped on cache eviction
(letting analysts create duplicate Jira tickets for the same alert).

Endpoints (mounted at /api/jira-tickets/* via blueprint):

  POST  /api/jira-tickets/create     create a Jira issue + record the mapping
                                     (idempotent: if a mapping already exists
                                     for this row, returns the existing key
                                     instead of creating a duplicate)
  POST  /api/jira-tickets/link       record an existing Jira key for a row
                                     (used by "Link existing Jira tickets")
  POST  /api/jira-tickets/import     bulk import legacy localStorage map

All endpoints require an authenticated session (workspace rule: PII-touching
endpoints need strong auth) and use ORM bound parameters (no string SQL).
"""
from __future__ import annotations

from typing import Any

from flask import Blueprint, jsonify, request, g
from sqlalchemy import select, and_
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from db import SessionLocal
from auth.session import require_auth
from models.db_models import (
    User,
    DailyReportEmail,
    DailyReportRow,
    JiraCreatedTicket,
)


jira_tickets_bp = Blueprint("jira_tickets", __name__)


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _serialise_ticket(t: JiraCreatedTicket, actor_email: str | None = None) -> dict[str, Any]:
    return {
        "messageId": t.message_id,
        "rowIndex": t.row_index,
        "jiraKey": t.jira_key,
        "jiraUrl": t.jira_url,
        "incidentId": t.incident_id,
        "servicenowTicket": t.servicenow_ticket,
        "createdBy": (
            actor_email
            if actor_email is not None
            else (t.created_by_user.email if t.created_by_user is not None else None)
        ),
        "createdAt": t.created_at.isoformat() if t.created_at else None,
    }


def _existing_mapping(
    db, message_id: str, row_index: int
) -> JiraCreatedTicket | None:
    stmt = select(JiraCreatedTicket).where(
        and_(
            JiraCreatedTicket.message_id == message_id,
            JiraCreatedTicket.row_index == row_index,
        )
    )
    return db.execute(stmt).scalar_one_or_none()


def _row_metadata(db, message_id: str, row_index: int) -> tuple[str | None, str | None]:
    """Pull cached IncidentID / ServicenowTicket for a row so we can store them
    on the JiraCreatedTicket record without trusting the request body for
    identity columns."""
    stmt = select(DailyReportRow).where(
        and_(
            DailyReportRow.message_id == message_id,
            DailyReportRow.row_index == row_index,
        )
    )
    row = db.execute(stmt).scalar_one_or_none()
    if row is None:
        return None, None
    return row.incident_id, row.servicenow_ticket


# ---------------------------------------------------------------------------
# POST /api/jira-tickets/create
# ---------------------------------------------------------------------------

@jira_tickets_bp.post("/create")
@require_auth
def create_jira_ticket():
    """
    Create a Jira issue for a (message_id, row_index) and record the mapping.

    Body: {
      message_id: str, row_index: int,
      summary, description, status, incident_category,
      closure_comments, created, closure_date  (forwarded to Jira)
    }

    Behaviour:
      - If a JiraCreatedTicket already exists for this (message_id, row_index),
        the existing key is returned and NO new Jira issue is created. This
        is the per-server duplicate-protection the localStorage map could
        never give us.
      - On successful Jira create, a JiraCreatedTicket row is inserted.
      - On Jira API failure, the response code is 502 (or 403 for
        permissions) and no DB row is inserted.
    """
    body = request.get_json(silent=True) or {}
    message_id = str(body.get("message_id") or "").strip()
    try:
        row_index = int(body.get("row_index"))
    except (TypeError, ValueError):
        return jsonify({"error": "row_index must be an integer"}), 400
    if not message_id or row_index < 0:
        return jsonify({"error": "message_id and row_index are required"}), 400

    summary = (body.get("summary") or "").strip()
    if not summary:
        return jsonify({"error": "summary is required"}), 400

    description = (body.get("description") or "").strip()
    status = (body.get("status") or "").strip()
    incident_category = (body.get("incident_category") or "").strip()
    closure_comments = (body.get("closure_comments") or "").strip()
    created = (body.get("created") or "").strip()
    closure_date = (body.get("closure_date") or "").strip()

    user: User = g.current_user

    db = SessionLocal()
    try:
        email = db.get(DailyReportEmail, message_id)
        if email is None:
            return (
                jsonify({"error": "unknown message_id; sync this report first"}),
                404,
            )

        existing = _existing_mapping(db, message_id, row_index)
        if existing is not None:
            # Idempotent: return the existing ticket; do NOT create a duplicate
            # in Jira. This is the central "no double-creates after refresh"
            # guarantee that localStorage couldn't enforce.
            return jsonify(
                {
                    "ok": True,
                    "deduped": True,
                    "ticket": _serialise_ticket(existing),
                }
            )

        # Create the Jira issue first; only persist the mapping if Jira
        # accepted the create (so a failed create never leaves a phantom row
        # claiming a Jira key that doesn't exist).
        try:
            from jira_client import create_issue
        except ImportError:
            return jsonify({"error": "Jira client not available"}), 503

        try:
            jira_result = create_issue(
                summary=summary,
                description=description,
                status=status,
                incident_category=incident_category,
                closure_comments=closure_comments,
                created=created,
                closure_date=closure_date,
            )
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        except RuntimeError as exc:
            msg = str(exc)
            http_code = 502
            if msg.startswith("Jira API "):
                try:
                    api_code = int(msg.split(":", 1)[0].replace("Jira API ", "").strip())
                    if api_code in (401, 403):
                        http_code = 403
                except ValueError:
                    if "permission" in msg.lower():
                        http_code = 403
            return jsonify({"error": msg}), http_code
        except Exception as exc:  # pragma: no cover - unexpected client error
            return jsonify({"error": str(exc)}), 500

        jira_key = (jira_result.get("key") or "").strip() if isinstance(jira_result, dict) else ""
        if not jira_key:
            return (
                jsonify({"error": "Jira created the issue but did not return a key"}),
                502,
            )
        jira_self = (jira_result.get("self") or "").strip() if isinstance(jira_result, dict) else ""

        incident_id, servicenow_ticket = _row_metadata(db, message_id, row_index)

        rec = JiraCreatedTicket(
            message_id=message_id,
            row_index=row_index,
            jira_key=jira_key,
            jira_url=jira_self or None,
            incident_id=incident_id,
            servicenow_ticket=servicenow_ticket,
            created_by_user_id=user.id,
        )
        db.add(rec)
        db.commit()
        db.refresh(rec)

        return jsonify(
            {
                "ok": True,
                "deduped": False,
                "ticket": _serialise_ticket(rec, actor_email=user.email),
                "jira": jira_result,  # raw response (includes id / key / self)
            }
        )
    except Exception as exc:
        db.rollback()
        return jsonify({"error": f"Create failed: {exc}"}), 500
    finally:
        db.close()


# ---------------------------------------------------------------------------
# POST /api/jira-tickets/link
# ---------------------------------------------------------------------------

@jira_tickets_bp.post("/link")
@require_auth
def link_jira_ticket():
    """
    Record an existing Jira key for a row (no Jira API call). Used by the
    "Link existing Jira tickets" button on the Jira Tickets page when the
    server-side dedupe matched a row to a pre-existing Jira issue.

    Body: { message_id: str, row_index: int, jira_key: str, jira_url?: str }

    Idempotent: if a mapping already exists, the response says so and the
    stored key is left unchanged (we never silently overwrite).
    """
    body = request.get_json(silent=True) or {}
    message_id = str(body.get("message_id") or "").strip()
    jira_key = str(body.get("jira_key") or "").strip()
    jira_url = str(body.get("jira_url") or "").strip() or None
    try:
        row_index = int(body.get("row_index"))
    except (TypeError, ValueError):
        return jsonify({"error": "row_index must be an integer"}), 400
    if not message_id or row_index < 0 or not jira_key:
        return (
            jsonify({"error": "message_id, row_index, and jira_key are required"}),
            400,
        )

    user: User = g.current_user

    db = SessionLocal()
    try:
        email = db.get(DailyReportEmail, message_id)
        if email is None:
            return (
                jsonify({"error": "unknown message_id; sync this report first"}),
                404,
            )

        existing = _existing_mapping(db, message_id, row_index)
        if existing is not None:
            return jsonify(
                {
                    "ok": True,
                    "alreadyLinked": True,
                    "ticket": _serialise_ticket(existing),
                }
            )

        incident_id, servicenow_ticket = _row_metadata(db, message_id, row_index)
        rec = JiraCreatedTicket(
            message_id=message_id,
            row_index=row_index,
            jira_key=jira_key,
            jira_url=jira_url,
            incident_id=incident_id,
            servicenow_ticket=servicenow_ticket,
            created_by_user_id=user.id,
        )
        db.add(rec)
        db.commit()
        db.refresh(rec)

        return jsonify(
            {
                "ok": True,
                "alreadyLinked": False,
                "ticket": _serialise_ticket(rec, actor_email=user.email),
            }
        )
    except Exception as exc:
        db.rollback()
        return jsonify({"error": f"Link failed: {exc}"}), 500
    finally:
        db.close()


# ---------------------------------------------------------------------------
# POST /api/jira-tickets/import
# ---------------------------------------------------------------------------

@jira_tickets_bp.post("/import")
@require_auth
def import_jira_tickets():
    """
    Bulk import the legacy `sentinel_jira_created_keys` localStorage map.

    Body: {
      tickets: [
        { message_id: str, row_index: int, jira_key: str, jira_url?: str }, ...
      ]
    }

    Mappings that already exist server-side are NOT overwritten (so importing
    twice is safe). Returns counts of imported / skipped.
    """
    body = request.get_json(silent=True) or {}
    items = body.get("tickets")
    if not isinstance(items, list):
        return jsonify({"error": "tickets must be a list"}), 400

    user: User = g.current_user
    imported = 0
    skipped_existing = 0
    skipped_invalid = 0
    skipped_unknown_email = 0
    skipped_batch_dup = 0

    db = SessionLocal()
    try:
        # 1. Validate + parse the request body. Drop any obviously broken
        #    items before touching the DB.
        referenced_ids: set[str] = set()
        normalised: list[tuple[str, int, str, str | None]] = []
        for item in items:
            if not isinstance(item, dict):
                skipped_invalid += 1
                continue
            mid = str(item.get("message_id") or "").strip()
            jira_key = str(item.get("jira_key") or "").strip()
            jira_url = str(item.get("jira_url") or "").strip() or None
            try:
                idx = int(item.get("row_index"))
            except (TypeError, ValueError):
                skipped_invalid += 1
                continue
            if not mid or idx < 0 or not jira_key:
                skipped_invalid += 1
                continue
            referenced_ids.add(mid)
            normalised.append((mid, idx, jira_key, jira_url))

        # 2. Filter out items whose parent email isn't synced yet -- the
        #    foreign key constraint would otherwise fail.
        known_ids: set[str] = set()
        if referenced_ids:
            known_q = select(DailyReportEmail.id).where(
                DailyReportEmail.id.in_(list(referenced_ids))
            )
            known_ids = {row[0] for row in db.execute(known_q).all()}

        # 3. De-dupe the batch on (message_id, row_index). The frontend's
        #    scope-relaxed matcher can map a single row from multiple legacy
        #    keys, so the same (mid, idx) can appear more than once in one
        #    import payload. Keep the FIRST occurrence and silently drop the
        #    rest -- otherwise the second-and-later inserts would fail the
        #    UNIQUE constraint and abort the whole transaction.
        seen_in_batch: set[tuple[str, int]] = set()
        deduped: list[tuple[str, int, str, str | None]] = []
        for mid, idx, jira_key, jira_url in normalised:
            if mid not in known_ids:
                skipped_unknown_email += 1
                continue
            key = (mid, idx)
            if key in seen_in_batch:
                skipped_batch_dup += 1
                continue
            seen_in_batch.add(key)
            deduped.append((mid, idx, jira_key, jira_url))

        # 4. Bulk insert with ON CONFLICT DO NOTHING so an existing
        #    (message_id, row_index) row in the DB just becomes a no-op
        #    instead of throwing an IntegrityError. This makes the import
        #    fully idempotent across multiple clicks AND across overlapping
        #    legacy data.
        for mid, idx, jira_key, jira_url in deduped:
            incident_id, servicenow_ticket = _row_metadata(db, mid, idx)
            stmt = (
                sqlite_insert(JiraCreatedTicket)
                .values(
                    message_id=mid,
                    row_index=idx,
                    jira_key=jira_key,
                    jira_url=jira_url,
                    incident_id=incident_id,
                    servicenow_ticket=servicenow_ticket,
                    created_by_user_id=user.id,
                )
                .on_conflict_do_nothing(index_elements=["message_id", "row_index"])
            )
            result = db.execute(stmt)
            # rowcount == 1 if a new row was inserted; 0 if a conflict
            # caused the insert to be skipped (existing mapping wins).
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
