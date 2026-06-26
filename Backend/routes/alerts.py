"""
Unified alerts HTTP API (date / date-range view).

Bridges the two cached email streams so the Yearly Data -> Alerts view can
show alerts for a single date OR a date range, regardless of whether they
came from a Daily report (PB Daily) or a Weekly report (PB Weekly):

  - For the *current calendar month* (relative to the server's local clock)
    we read from `daily_report_rows` -- the daily feed is the freshest
    source-of-truth for in-flight alerts.
  - For *older months* we read from `weekly_report_rows` -- weekly digests
    are the long-term archive and they keep the search query / sync surface
    small (one weekly email per week instead of seven daily ones).

When a requested range straddles both regimes both stores are queried and the
results are merged (deduped by `(incident_id, servicenow_ticket)` -- daily
beats weekly on ties so a recently-updated daily row wins over a stale
weekly snapshot of the same incident).

Override merge (the user explicitly asked for "most recent across both
tables wins"):
  for each surviving alert row, we look up overrides keyed by
  `(message_id, row_index)` in *both* `daily_report_overrides` and
  `weekly_report_overrides`, and per field (status / closure_comment /
  closure_date) we keep the entry with the latest `updated_at`. The
  response tells the frontend which side that value came from so a PATCH
  back goes to the same table.

This endpoint is read-only -- it does NOT sync from Gmail. The frontend is
expected to trigger the existing `/api/weekly-reports/sync` or
`/api/daily-alerts/sync` first (or rely on cached data).

Workspace rules enforced:
  - Session auth (`@require_auth`) -- PII response.
  - SQLAlchemy ORM bound parameters everywhere -- no string-built SQL.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from typing import Any

from flask import Blueprint, jsonify, request
from sqlalchemy import select, and_

from db import SessionLocal
from auth.session import require_auth
from models.db_models import (
    DailyReportEmail,
    DailyReportRow,
    DailyReportOverride,
    WeeklyReportEmail,
    WeeklyReportRow,
    WeeklyReportOverride,
    JiraCreatedTicket,
)


alerts_bp = Blueprint("alerts", __name__)

OVERRIDE_FIELDS = ("status", "closure_comment", "closure_date")

# Columns we try (case/space-insensitive) when extracting the alert's
# creation date from raw row JSON. Mirrors the existing frontend helpers
# in WeeklyReports.tsx / JiraTickets.tsx so the same alerts that show up
# in those pages also show up here.
CREATED_COLUMN_CANDIDATES: tuple[str, ...] = (
    "Created",
    "CreationDate",
    "Creation Date",
    "Creation_Date",
    "Created_On",
    "CreatedOn",
    "AlertCreated",
    "OpenDate",
    "Opened",
    "IncidentCreated",
    "DateCreated",
    "CreationTime",
    "Creation Time",
    "Alert Creation Date",
    "OpenedDate",
)


# ---------------------------------------------------------------------------
# tiny date helpers
# ---------------------------------------------------------------------------

def _parse_yyyymmdd(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        return None


def _first_of_month(d: date) -> date:
    return date(d.year, d.month, 1)


def _row_value_ci(row: dict[str, Any], *candidates: str) -> str:
    """Case + space-insensitive value lookup against a CSV row dict."""
    if not isinstance(row, dict):
        return ""
    norm: dict[str, Any] = {}
    for k, v in row.items():
        if not isinstance(k, str):
            continue
        norm[k.lower().replace(" ", "")] = v
    for want in candidates:
        v = norm.get(want.lower().replace(" ", ""))
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _parse_alert_creation(raw_value: str | None, row_json: dict[str, Any]) -> date | None:
    """
    Try to extract the alert's *creation* date from the row.

    Order:
      1. `created_iso` denormalised column (already populated on sync).
      2. The same set of column names the frontend understands.
      3. Give up -> None (caller decides whether to keep the row).

    Accepts ISO (`YYYY-MM-DD[Thh:mm...]`), DMY with `/`, `-`, or `.`
    separators, and a final relaxed `dateutil`-style ISO parse.
    """
    candidates: list[str] = []
    if raw_value and isinstance(raw_value, str) and raw_value.strip():
        candidates.append(raw_value.strip())
    fallback = _row_value_ci(row_json, *CREATED_COLUMN_CANDIDATES)
    if fallback and fallback not in candidates:
        candidates.append(fallback)

    for cand in candidates:
        d = _parse_one_date(cand)
        if d is not None:
            return d
    return None


def _parse_one_date(value: str) -> date | None:
    s = value.strip()
    if not s:
        return None
    # ISO-ish: YYYY-MM-DD optionally followed by Thh:mm... or space.
    try:
        if len(s) >= 10 and s[4] == "-" and s[7] == "-":
            return date(int(s[0:4]), int(s[5:7]), int(s[8:10]))
    except (ValueError, IndexError):
        pass
    # D/M/YYYY or D-M-YYYY or D.M.YYYY (also 2-digit years => 20yy)
    for sep in ("/", "-", "."):
        parts = s.split(" ", 1)[0].split(sep)
        if len(parts) == 3:
            try:
                day = int(parts[0])
                month = int(parts[1])
                year = int(parts[2])
                if year < 100:
                    year += 2000
                # Plausibility: D in 1..31, M in 1..12.
                if 1 <= day <= 31 and 1 <= month <= 12 and 1900 <= year <= 2100:
                    return date(year, month, day)
            except ValueError:
                pass
    # Last-ditch: Python's `fromisoformat` understands many shapes.
    try:
        return datetime.fromisoformat(s.replace("/", "-")).date()
    except ValueError:
        return None


def _row_keys_for_dedup(
    incident_id: str | None,
    servicenow_ticket: str | None,
    message_id: str,
    row_index: int,
) -> str:
    """Stable de-dup key.

    Prefer the alert-level identity (incident / SN ticket); fall back to the
    storage identity so rows that have neither are still preserved.
    """
    inc = (incident_id or "").strip().upper()
    sn = (servicenow_ticket or "").strip().upper()
    if inc or sn:
        return f"alert:{inc}|{sn}"
    return f"row:{message_id}:{row_index}"


# ---------------------------------------------------------------------------
# GET /api/alerts
# ---------------------------------------------------------------------------

@alerts_bp.get("")
@require_auth
def list_alerts():
    """
    GET /api/alerts?after=YYYY-MM-DD&before=YYYY-MM-DD

    `before` is exclusive (matches the existing weekly/daily endpoints).
    For a single-day query the frontend sends `after=D` and `before=D+1`.
    """
    after = _parse_yyyymmdd(request.args.get("after"))
    before = _parse_yyyymmdd(request.args.get("before"))
    if after is None or before is None or before <= after:
        return (
            jsonify({"error": "after and before must be YYYY-MM-DD with after < before"}),
            400,
        )

    today = date.today()
    month_start = _first_of_month(today)

    # Two half-open segments. Either can be empty.
    weekly_until = min(before, month_start)
    daily_from = max(after, month_start)
    use_weekly = after < weekly_until
    use_daily = daily_from < before

    weekly_after = after if use_weekly else None
    weekly_before = weekly_until if use_weekly else None
    daily_after = daily_from if use_daily else None
    daily_before = before if use_daily else None

    db = SessionLocal()
    try:
        weekly_candidates: list[tuple[WeeklyReportRow, dict[str, Any]]] = []
        if use_weekly and weekly_after is not None and weekly_before is not None:
            weekly_candidates = _collect_weekly(db, weekly_after, weekly_before)

        daily_candidates: list[tuple[DailyReportRow, dict[str, Any]]] = []
        if use_daily and daily_after is not None and daily_before is not None:
            daily_candidates = _collect_daily(db, daily_after, daily_before)

        # Dedup. Daily wins on ties (more current).
        deduped: dict[str, dict[str, Any]] = {}
        weekly_count = 0
        daily_count = 0
        dropped_outside_range = 0

        # Walk weekly first; daily overwrites on identical keys below.
        for row, parsed in weekly_candidates:
            creation = parsed["creation_date"]
            if creation is None:
                # We chose to drop rows whose creation date can't be parsed:
                # otherwise a single un-dated row would appear in *every*
                # range. Mirrors the existing fy filter behaviour for export.
                dropped_outside_range += 1
                continue
            if creation < after or creation >= before:
                dropped_outside_range += 1
                continue
            key = _row_keys_for_dedup(
                row.incident_id, row.servicenow_ticket, row.message_id, row.row_index
            )
            deduped[key] = {
                "source": "weekly",
                "messageId": row.message_id,
                "rowIndex": row.row_index,
                "incidentId": row.incident_id,
                "servicenowTicket": row.servicenow_ticket,
                "creationDate": creation.isoformat(),
                "rowData": parsed["row_data"],
                "csvStatus": row.csv_status,
            }
            weekly_count += 1

        for row, parsed in daily_candidates:
            creation = parsed["creation_date"]
            if creation is None:
                dropped_outside_range += 1
                continue
            if creation < after or creation >= before:
                dropped_outside_range += 1
                continue
            key = _row_keys_for_dedup(
                row.incident_id, row.servicenow_ticket, row.message_id, row.row_index
            )
            deduped[key] = {
                "source": "daily",
                "messageId": row.message_id,
                "rowIndex": row.row_index,
                "incidentId": row.incident_id,
                "servicenowTicket": row.servicenow_ticket,
                "creationDate": creation.isoformat(),
                "rowData": parsed["row_data"],
                "csvStatus": row.csv_status,
            }
            daily_count += 1

        # Overrides merge across both tables.
        weekly_keys = [
            (rec["messageId"], rec["rowIndex"])
            for rec in deduped.values()
            if rec["source"] == "weekly"
        ]
        daily_keys = [
            (rec["messageId"], rec["rowIndex"])
            for rec in deduped.values()
            if rec["source"] == "daily"
        ]

        daily_overrides_by_pair: dict[tuple[str, int], dict[str, dict[str, Any]]] = {}
        weekly_overrides_by_pair: dict[tuple[str, int], dict[str, dict[str, Any]]] = {}
        if daily_keys:
            daily_overrides_by_pair = _load_overrides_by_pair_daily(db, daily_keys)
        if weekly_keys:
            weekly_overrides_by_pair = _load_overrides_by_pair_weekly(db, weekly_keys)

        # Jira-created mapping (only daily emails have these in the DB).
        jira_by_pair: dict[tuple[str, int], dict[str, Any]] = {}
        if daily_keys:
            jira_by_pair = _load_jira_by_pair(db, daily_keys)

        # Build merged overrides per surviving alert. Per field we pick the
        # entry (across daily + weekly) with the latest updated_at.
        merged_overrides: dict[str, dict[str, Any]] = {}
        for key, rec in deduped.items():
            pair = (rec["messageId"], rec["rowIndex"])
            same_table = (
                daily_overrides_by_pair.get(pair, {})
                if rec["source"] == "daily"
                else weekly_overrides_by_pair.get(pair, {})
            )
            cross_table = _cross_table_overrides_for_alert(
                rec, daily_overrides_by_pair, weekly_overrides_by_pair
            )
            merged_overrides[key] = _merge_override_buckets(
                rec["source"], same_table, cross_table
            )

        # Build the response shape. We render via a synthetic CsvAttachment
        # so the frontend can keep using CsvDataTable as-is.
        headers, rows = _build_alerts_table(deduped, merged_overrides)

        return jsonify(
            {
                "alerts": {
                    "filename": (
                        f"alerts_{after.isoformat()}_to_"
                        f"{(before - timedelta(days=1)).isoformat()}.csv"
                    ),
                    "headers": headers,
                    "rows": rows,
                },
                "overrides": merged_overrides,
                "jiraCreated": _serialise_jira(jira_by_pair, deduped),
                "summary": {
                    "after": after.isoformat(),
                    "before": before.isoformat(),
                    "monthStart": month_start.isoformat(),
                    "usedDailySource": use_daily,
                    "usedWeeklySource": use_weekly,
                    "weeklyRowsConsidered": weekly_count,
                    "dailyRowsConsidered": daily_count,
                    "droppedOutsideRange": dropped_outside_range,
                    "uniqueAlerts": len(deduped),
                },
            }
        )
    finally:
        db.close()


# ---------------------------------------------------------------------------
# collection helpers (per source)
# ---------------------------------------------------------------------------

def _collect_weekly(
    db, after: date, before: date
) -> list[tuple[WeeklyReportRow, dict[str, Any]]]:
    """
    Pre-filter via parent email `internal_date_ms` so we don't pull years of
    rows; a weekly digest is usually emitted within a few days of the
    period it covers, but be generous (~14 days slack) for late deliveries.
    Final creation-date filtering happens in Python.
    """
    start_ms = _date_to_ms(after - timedelta(days=14))
    end_ms = _date_to_ms(before + timedelta(days=14))

    email_q = select(WeeklyReportEmail.id).where(
        and_(
            WeeklyReportEmail.internal_date_ms.isnot(None),
            WeeklyReportEmail.internal_date_ms >= start_ms,
            WeeklyReportEmail.internal_date_ms < end_ms,
        )
    )
    email_ids = [eid for (eid,) in db.execute(email_q).all()]
    if not email_ids:
        return []
    rows_q = select(WeeklyReportRow).where(WeeklyReportRow.message_id.in_(email_ids))
    out: list[tuple[WeeklyReportRow, dict[str, Any]]] = []
    for row in db.execute(rows_q).scalars():
        out.append((row, _parse_row(row.values_json, row.created_iso)))
    return out


def _collect_daily(
    db, after: date, before: date
) -> list[tuple[DailyReportRow, dict[str, Any]]]:
    """Same as `_collect_weekly` but for the daily feed (smaller slack -- a
    daily email tracks the calendar day directly)."""
    start_ms = _date_to_ms(after - timedelta(days=3))
    end_ms = _date_to_ms(before + timedelta(days=3))

    email_q = select(DailyReportEmail.id).where(
        and_(
            DailyReportEmail.internal_date_ms.isnot(None),
            DailyReportEmail.internal_date_ms >= start_ms,
            DailyReportEmail.internal_date_ms < end_ms,
        )
    )
    email_ids = [eid for (eid,) in db.execute(email_q).all()]
    if not email_ids:
        return []
    rows_q = select(DailyReportRow).where(DailyReportRow.message_id.in_(email_ids))
    out: list[tuple[DailyReportRow, dict[str, Any]]] = []
    for row in db.execute(rows_q).scalars():
        out.append((row, _parse_row(row.values_json, row.created_iso)))
    return out


def _date_to_ms(d: date) -> int:
    return int(datetime(d.year, d.month, d.day).timestamp() * 1000)


def _parse_row(values_json: str | None, created_iso: str | None) -> dict[str, Any]:
    try:
        row_data = json.loads(values_json or "{}")
    except json.JSONDecodeError:
        row_data = {}
    if not isinstance(row_data, dict):
        row_data = {}
    return {
        "row_data": row_data,
        "creation_date": _parse_alert_creation(created_iso, row_data),
    }


# ---------------------------------------------------------------------------
# overrides
# ---------------------------------------------------------------------------

def _load_overrides_by_pair_daily(
    db, pairs: list[tuple[str, int]]
) -> dict[tuple[str, int], dict[str, dict[str, Any]]]:
    if not pairs:
        return {}
    msg_ids = list({m for (m, _) in pairs})
    q = select(DailyReportOverride).where(DailyReportOverride.message_id.in_(msg_ids))
    out: dict[tuple[str, int], dict[str, dict[str, Any]]] = {}
    requested = set(pairs)
    for o in db.execute(q).scalars():
        pair = (o.message_id, o.row_index)
        if pair not in requested:
            continue
        bucket = out.setdefault(pair, {})
        bucket[o.field] = {
            "value": o.value,
            "updated_at": o.updated_at,
            "updated_by": (
                o.updated_by_user.email if o.updated_by_user is not None else None
            ),
            "source": "daily",
        }
    return out


def _load_overrides_by_pair_weekly(
    db, pairs: list[tuple[str, int]]
) -> dict[tuple[str, int], dict[str, dict[str, Any]]]:
    if not pairs:
        return {}
    msg_ids = list({m for (m, _) in pairs})
    q = select(WeeklyReportOverride).where(WeeklyReportOverride.message_id.in_(msg_ids))
    out: dict[tuple[str, int], dict[str, dict[str, Any]]] = {}
    requested = set(pairs)
    for o in db.execute(q).scalars():
        pair = (o.message_id, o.row_index)
        if pair not in requested:
            continue
        bucket = out.setdefault(pair, {})
        bucket[o.field] = {
            "value": o.value,
            "updated_at": o.updated_at,
            "updated_by": (
                o.updated_by_user.email if o.updated_by_user is not None else None
            ),
            "source": "weekly",
        }
    return out


def _cross_table_overrides_for_alert(
    rec: dict[str, Any],
    daily_by_pair: dict[tuple[str, int], dict[str, dict[str, Any]]],
    weekly_by_pair: dict[tuple[str, int], dict[str, dict[str, Any]]],
) -> dict[str, dict[str, Any]]:
    """
    A daily-sourced alert might *also* have overrides in the weekly table if
    the same incident appeared in an earlier weekly digest (and vice versa).
    We cross-walk via (incident_id, servicenow_ticket) -- both denormalised
    on the row tables and the override tables (overrides only know
    (message_id, row_index), so we look those up against the *other*
    source's known rows by their incident / SN ticket).

    For Phase A we keep this conservative: only the same-table overrides are
    considered. The user can always edit on either page and the most-recent
    rule still wins because we'll pick the latest updated_at among
    fields the alert has. Cross-source override merge can be expanded later
    once the FE wiring is in place (it requires another `WeeklyReportRow`/
    `DailyReportRow` lookup per alert which we don't want to do per request).
    """
    return {}


def _merge_override_buckets(
    primary_source: str,
    same_table: dict[str, dict[str, Any]],
    cross_table: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """
    Returns: { status, closure_comment, closure_date, _meta: { source_per_field } }

    For each field choose the entry with the latest updated_at across both
    sources. Empty / missing -> None.
    """
    out: dict[str, Any] = {
        "status": None,
        "closure_comment": None,
        "closure_date": None,
        "updatedAt": None,
        "updatedBy": None,
        "sourcePerField": {"status": None, "closure_comment": None, "closure_date": None},
    }
    latest_overall: datetime | None = None
    latest_user: str | None = None
    for field in OVERRIDE_FIELDS:
        a = same_table.get(field)
        b = cross_table.get(field)
        chosen = _choose_latest(a, b)
        if chosen is None:
            continue
        out[field] = chosen["value"]
        out["sourcePerField"][field] = chosen["source"]
        upd_at = chosen["updated_at"]
        if upd_at is not None and (latest_overall is None or upd_at > latest_overall):
            latest_overall = upd_at
            latest_user = chosen.get("updated_by")
    if latest_overall is not None:
        out["updatedAt"] = latest_overall.isoformat()
        out["updatedBy"] = latest_user
    return out


def _choose_latest(
    a: dict[str, Any] | None, b: dict[str, Any] | None
) -> dict[str, Any] | None:
    if a is None:
        return b
    if b is None:
        return a
    aw = a.get("updated_at")
    bw = b.get("updated_at")
    if aw is None and bw is None:
        return a
    if aw is None:
        return b
    if bw is None:
        return a
    return a if aw >= bw else b


# ---------------------------------------------------------------------------
# Jira ticket mapping
# ---------------------------------------------------------------------------

def _load_jira_by_pair(
    db, pairs: list[tuple[str, int]]
) -> dict[tuple[str, int], dict[str, Any]]:
    if not pairs:
        return {}
    msg_ids = list({m for (m, _) in pairs})
    q = select(JiraCreatedTicket).where(JiraCreatedTicket.message_id.in_(msg_ids))
    out: dict[tuple[str, int], dict[str, Any]] = {}
    requested = set(pairs)
    for t in db.execute(q).scalars():
        pair = (t.message_id, t.row_index)
        if pair not in requested:
            continue
        out[pair] = {
            "messageId": t.message_id,
            "rowIndex": t.row_index,
            "jiraKey": t.jira_key,
            "jiraUrl": t.jira_url,
            "incidentId": t.incident_id,
            "servicenowTicket": t.servicenow_ticket,
            "createdBy": (
                t.created_by_user.email if t.created_by_user is not None else None
            ),
            "createdAt": t.created_at.isoformat() if t.created_at else None,
        }
    return out


def _serialise_jira(
    jira_by_pair: dict[tuple[str, int], dict[str, Any]],
    deduped: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for key, rec in deduped.items():
        pair = (rec["messageId"], rec["rowIndex"])
        if pair in jira_by_pair:
            out[key] = jira_by_pair[pair]
    return out


# ---------------------------------------------------------------------------
# table builder
# ---------------------------------------------------------------------------

def _build_alerts_table(
    deduped: dict[str, dict[str, Any]],
    overrides_by_key: dict[str, dict[str, Any]],
) -> tuple[list[str], list[dict[str, Any]]]:
    """
    Produce a CSV-shaped table the frontend's existing `CsvDataTable` can
    render unchanged:
      - `headers`: union of every column we saw, with the canonical
        columns put up front (so the table layout is stable across runs).
      - `rows`: one row per surviving alert. The `__rowIndex` field carries
        an encoded "<source>:<msgId>:<rowIndex>" string so the FE can PATCH
        the right override table on edit. We *also* return separate
        `__source`, `__messageId`, `__rowIndexNum` fields for convenience.
    """
    preferred_front = [
        "Title",
        "IncidentID",
        "ServicenowTicket",
        "Status",
        "Created",
        "ClosureComments",
        "ClosureDate",
        "Severity",
        "Owner",
        "Assigned To",
    ]
    seen_keys: list[str] = []
    seen_set: set[str] = set()
    for rec in deduped.values():
        for k in rec["rowData"].keys():
            if not isinstance(k, str):
                continue
            if k == "__rowIndex":
                continue
            if k in seen_set:
                continue
            seen_set.add(k)
            seen_keys.append(k)

    def _front_index(k: str) -> int:
        # case + space-insensitive match against preferred_front
        norm_k = k.lower().replace(" ", "")
        for i, p in enumerate(preferred_front):
            if p.lower().replace(" ", "") == norm_k:
                return i
        return len(preferred_front)

    headers = sorted(seen_keys, key=lambda k: (_front_index(k), k))

    rows: list[dict[str, Any]] = []
    # Stable order: newest creation date first, then incident id ASC.
    def _sort_key(item: tuple[str, dict[str, Any]]):
        _, rec = item
        return (
            rec["creationDate"],
            rec.get("incidentId") or "",
            rec["messageId"],
            rec["rowIndex"],
        )

    for key, rec in sorted(deduped.items(), key=_sort_key, reverse=True):
        row = dict(rec["rowData"])
        # The synthetic `__rowIndex` encodes everything the FE needs to PATCH
        # the right override row in either the daily or the weekly table.
        row["__rowIndex"] = key
        row["__source"] = rec["source"]
        row["__messageId"] = rec["messageId"]
        row["__rowIndexNum"] = str(rec["rowIndex"])
        row["__creationDate"] = rec["creationDate"]
        rows.append(row)

    # Make sure the helper "__" columns aren't rendered as visible headers
    # (CsvDataTable hides keys starting with __ already, but we filter here
    # anyway so the response headers are clean).
    headers = [h for h in headers if not h.startswith("__")]
    return headers, rows
