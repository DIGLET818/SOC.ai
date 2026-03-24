# main.py

import json
import os
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import requests
from dotenv import load_dotenv

# Load .env from Backend folder so it works regardless of cwd
_backend_dir = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_backend_dir, ".env"))
from flask import Flask, jsonify, request, make_response, redirect
from flask_cors import CORS

# Gmail OAuth + alerts (optional: requires credentials.json and token)
try:
    from auth.gmail_auth import (
        get_auth_url,
        save_token_from_callback,
        is_gmail_connected,
        remove_token,
        FRONTEND_ORIGIN,
    )
    from email_client.gmail_client import fetch_recent_alerts
    from mappers.gmail_to_alert import gmail_message_to_alert
    GMAIL_AVAILABLE = True
except Exception as e:
    GMAIL_AVAILABLE = False
    print("Gmail/OAuth not loaded:", e, flush=True)

STORAGE_FILE = os.path.join(os.path.dirname(__file__), "storage", "incident_store.json")
JIRA_ROW_OVERRIDES_FILE = os.path.join(os.path.dirname(__file__), "storage", "jira_row_overrides.json")

app = Flask(__name__)

# ---------------------------------------------------------------------
# CORS CONFIG (FIXED)
# ---------------------------------------------------------------------
CORS(
    app,
    resources={r"/api/*": {"origins": "*"}},
    supports_credentials=True,
    allow_headers=["Content-Type", "Authorization"],
    methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
)

@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        response = make_response()
        response.headers["Access-Control-Allow-Origin"] = request.headers.get("Origin", "*")
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        response.headers["Access-Control-Max-Age"] = "3600"
        return response


# ---------------------------------------------------------------------
# ROUTE: LIST ALL ROUTES
# ---------------------------------------------------------------------
@app.get("/routes")
def routes():
    return jsonify([str(rule) for rule in app.url_map.iter_rules()])


# ---------------------------------------------------------------------
# STORAGE HELPERS
# ---------------------------------------------------------------------
def load_store():
    try:
        with open(STORAGE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def save_store(data):
    os.makedirs(os.path.dirname(STORAGE_FILE), exist_ok=True)
    with open(STORAGE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


# ---------------------------------------------------------------------
# TEMPORARY DUMMY INCIDENTS (SAFE, NO GMAIL)
# ---------------------------------------------------------------------
DUMMY_INCIDENTS = [
    {
        "caseId": "INC-101",
        "title": "Suspicious Login Attempt",
        "severity": "High",
        "status": "Open",
        "assignedTo": "Unassigned",
        "aiPriority": "P1",
        "lastUpdated": "2025-12-10T10:32:00",
    },
    {
        "caseId": "INC-102",
        "title": "Malware Detected",
        "severity": "Medium",
        "status": "In Progress",
        "assignedTo": "Analyst A",
        "aiPriority": "P2",
        "lastUpdated": "2025-12-09T11:15:00",
    },
    {
        "caseId": "INC-103",
        "title": "Email Phishing Attempt",
        "severity": "Low",
        "status": "Closed",
        "assignedTo": "Analyst B",
        "aiPriority": "P3",
        "lastUpdated": "2025-12-08T14:10:00",
    },
]


# ---------------------------------------------------------------------
# MAIN INCIDENT LIST API (DUMMY until Gmail ready)
# ---------------------------------------------------------------------
@app.route("/api/incidents")
def api_incidents():
    """
    GET /api/incidents?from=YYYY-MM-DD&to=YYYY-MM-DD
    """

    date_from = request.args.get("from")
    date_to = request.args.get("to")

    print("Incoming request:", date_from, date_to, flush=True)

    # Convert to datetime objects
    def parse(s):
        try:
            return datetime.strptime(s, "%Y-%m-%d")
        except:
            return None

    start = parse(date_from)
    end = parse(date_to)

    if not start or not end:
        return jsonify({"error": "Invalid date format"}), 400

    filtered = []
    for inc in DUMMY_INCIDENTS:
        try:
            ts = datetime.fromisoformat(inc["lastUpdated"])
            if start <= ts <= end:
                filtered.append(inc)
        except:
            continue

    print("Returning incidents:", len(filtered), flush=True)

    # Save cache
    save_store(filtered)

    return jsonify(filtered)


# ---------------------------------------------------------------------
# INCIDENT DETAIL API
# ---------------------------------------------------------------------
@app.route("/api/incidents/<incident_id>")
def api_incident_detail(incident_id):
    incidents = load_store()
    incident = next((i for i in incidents if str(i.get("caseId")) == str(incident_id)), None)

    if not incident:
        return jsonify({"error": "Incident not found"}), 404

    return jsonify(incident)


# ---------------------------------------------------------------------
# INCIDENT CACHE API
# ---------------------------------------------------------------------
@app.route("/api/incidents/cache")
def api_incidents_cache():
    return jsonify(load_store())


# ---------------------------------------------------------------------
# GMAIL OAUTH + ALERTS
# ---------------------------------------------------------------------
@app.route("/api/auth/status")
def api_auth_status():
    return jsonify({
        "gmailAvailable": GMAIL_AVAILABLE,
        "connected": is_gmail_connected() if GMAIL_AVAILABLE else False,
    })


@app.route("/auth")
@app.route("/auth/google")
def redirect_legacy_auth():
    """Redirect /auth and /auth/google to the correct OAuth endpoint."""
    return redirect("/api/auth/google", code=302)


@app.route("/api/auth/google")
def api_auth_google():
    if not GMAIL_AVAILABLE:
        return jsonify({"error": "Gmail OAuth not configured (missing credentials.json)"}), 503
    try:
        auth_url = get_auth_url()
        return redirect(auth_url)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/auth/google/callback")
def api_auth_google_callback():
    if not GMAIL_AVAILABLE:
        return jsonify({"error": "Gmail OAuth not configured"}), 503
    code = request.args.get("code")
    if not code:
        return jsonify({"error": "Missing code"}), 400
    try:
        save_token_from_callback(code)
        return redirect(f"{FRONTEND_ORIGIN}/?gmail_connected=1")
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/gmail/alerts")
def api_gmail_alerts():
    if not GMAIL_AVAILABLE:
        return jsonify({"error": "Gmail not configured"}), 503
    if not is_gmail_connected():
        return jsonify({"error": "Not connected. Connect Gmail first via /api/auth/google"}), 401
    try:
        query = request.args.get("q", "subject:Case OR subject:Offense")
        max_results = min(int(request.args.get("max_results", 50)), 100)
        emails = fetch_recent_alerts(query=query, max_results=max_results)
        alerts = [gmail_message_to_alert(e) for e in emails]
        return jsonify(alerts)
    except Exception as e:
        err_msg = str(e)
        if "invalid_grant" in err_msg.lower():
            remove_token()
            return jsonify({
                "error": "Gmail sign-in expired or was revoked. Please reconnect Gmail from the Alerts page (click Connect Gmail)."
            }), 401
        print("gmail/alerts error:", e, flush=True)
        return jsonify({"error": err_msg}), 500


@app.route("/api/gmail/messages")
def api_gmail_messages():
    """
    GET /api/gmail/messages?from=...&subject=...&newer_than_days=1&max_results=50
    Returns raw emails. Optional subject filters by subject line (e.g. "PB Daily report").
    """
    if not GMAIL_AVAILABLE:
        return jsonify({"error": "Gmail not configured"}), 503
    if not is_gmail_connected():
        return jsonify({"error": "Not connected. Connect Gmail first via /api/auth/google"}), 401
    try:
        from_addr = request.args.get("from", "").strip()
        subject = request.args.get("subject", "").strip()
        after_date = request.args.get("after_date", "").strip()
        before_date = request.args.get("before_date", "").strip()
        newer_days = max(1, min(int(request.args.get("newer_than_days", 1)), 30))
        max_results = min(int(request.args.get("max_results", 50)), 500)
        include_csv = request.args.get("include_csv", "").lower() in ("1", "true", "yes")
        if not from_addr:
            return jsonify({"error": "Query param 'from' (sender address) is required"}), 400
        if after_date and before_date:
            # Gmail uses after:YYYY/M/D and before:YYYY/M/D (before is exclusive)
            try:
                from datetime import datetime
                a = datetime.strptime(after_date, "%Y-%m-%d")
                b = datetime.strptime(before_date, "%Y-%m-%d")
                query = f"from:{from_addr} after:{a.year}/{a.month}/{a.day} before:{b.year}/{b.month}/{b.day}"
            except ValueError:
                return jsonify({"error": "after_date and before_date must be YYYY-MM-DD"}), 400
        else:
            query = f"from:{from_addr} newer_than:{newer_days}d"
        if subject:
            query += f' subject:"{subject.replace(chr(34), "")}"'
        emails = fetch_recent_alerts(query=query, max_results=max_results, include_csv_attachments=include_csv)
        return jsonify(emails)
    except Exception as e:
        err_msg = str(e)
        if "invalid_grant" in err_msg.lower():
            remove_token()
            return jsonify({
                "error": "Gmail sign-in expired or was revoked. Please reconnect Gmail from the Alerts page (click Connect Gmail)."
            }), 401
        print("gmail/messages error:", e, flush=True)
        return jsonify({"error": err_msg}), 500


@app.route("/api/gmail/messages/search")
def api_gmail_messages_search():
    """
    GET /api/gmail/messages/search?q=INC12411145&from=...&newer_than_days=30
    Search Gmail by text (e.g. ServicenowTicket or IncidentID), return the latest matching email (full body).
    Used to open "last mail trail" for an alert row.
    """
    if not GMAIL_AVAILABLE:
        return jsonify({"error": "Gmail not configured"}), 503
    if not is_gmail_connected():
        return jsonify({"error": "Not connected. Connect Gmail first via /api/auth/google"}), 401
    try:
        search_text = request.args.get("q", "").strip()
        from_addr = request.args.get("from", "").strip() or "nttin.support@global.ntt"
        newer_days = max(1, min(int(request.args.get("newer_than_days", 30)), 90))
        if not search_text:
            return jsonify({"error": "Query param 'q' (search text) is required"}), 400
        query = f"from:{from_addr} newer_than:{newer_days}d {search_text}"
        emails = fetch_recent_alerts(query=query, max_results=10, include_csv_attachments=False)
        if not emails:
            return jsonify({"error": "No matching email found"}), 404
        return jsonify(emails[0])
    except Exception as e:
        err_msg = str(e)
        if "invalid_grant" in err_msg.lower():
            remove_token()
            return jsonify({
                "error": "Gmail sign-in expired or was revoked. Please reconnect Gmail from the Alerts page (click Connect Gmail)."
            }), 401
        print("gmail/messages/search error:", e, flush=True)
        return jsonify({"error": err_msg}), 500


# Closure phrases in email body → suggest status "Closed" (from anybody)
_GMAIL_CLOSURE_PHRASES = [
    "please close this alert",
    "close this alert",
    "please close the alert",
    "close the alert",
    "can be closed",
    "request to close",
    "request you to close",
    "close the incident",
    "please close",
    "pls close",
    "kindly close",
    "close from anybody",
    "close this incident",
    "close this case",
    "close this ticket",
    "please close this incident",
    "close from anyone",
    # Auto-closed: so status becomes Closed and Closure_Comments = "Incident Auto Closed"
    "auto-closed due to no response from customer",
    "auto closed due to no response from customer",
    "autoclosed due to no response from customer",
]

# When one of these is in body we suggest Closure_Comments = "Incident Auto Closed" (checked in _suggest_closure_comment)
_GMAIL_AUTO_CLOSED_PHRASE = "auto-closed due to no response from customer"
_GMAIL_AUTO_CLOSED_PHRASES = [
    _GMAIL_AUTO_CLOSED_PHRASE,
    "auto closed due to no response from customer",
    "autoclosed due to no response from customer",
]


def _email_to_display_name(email_value):
    """
    Single format from mailbox local-part: e.g. gajendrasingh1@x.com -> "Gajendrasingh 1".
    Dots/underscores/dashes are removed (not turned into separate words) so we never mix
    "Gajendra Singh" vs "Gajendrasingh 1".
    """
    if not email_value or not isinstance(email_value, str) or "@" not in email_value:
        return email_value or ""
    local = email_value.strip().split("@")[0].strip()
    if not local:
        return email_value.strip()
    local = re.sub(r"[._+\-]+", "", local)
    if not local:
        return email_value.strip()
    m = re.match(r"^(.*?)(\d+)$", local)
    if m:
        alpha, digits = m.group(1), m.group(2)
        if alpha:
            name_part = alpha[0].upper() + alpha[1:].lower()
            return f"{name_part} {digits}".strip()
        return digits
    return local[0].upper() + local[1:].lower() if len(local) > 1 else local.upper()


def _sender_to_closure_comment(sender_value):
    """
    Prefer the email address inside From / Reply-from so closure comments always use
    _email_to_display_name (e.g. Gajendrasingh 1), not the human display name (e.g. Gajendra Singh).
    """
    if not sender_value or not isinstance(sender_value, str):
        return ""
    s = sender_value.strip()
    email_in_angle = re.search(r"<([^>\s]+@[^>\s]+)>", s)
    if email_in_angle:
        return _email_to_display_name(email_in_angle.group(1).strip()) or s.strip()
    if "@" in s and "<" not in s:
        return _email_to_display_name(s)
    if "<" in s and ">" in s:
        inner = re.search(r"<([^>]+)>", s)
        if inner and "@" in inner.group(1):
            return _email_to_display_name(inner.group(1).strip())
        match = re.match(r"^([^<]+)<", s)
        if match:
            return match.group(1).strip().strip('"')
    return s


def _email_suggests_closed(body_text):
    """Return (suggested_status, found_phrase) if body suggests closure; else (None, None)."""
    if not body_text or not isinstance(body_text, str):
        return None, None
    text = body_text.lower().strip()
    for phrase in _GMAIL_CLOSURE_PHRASES:
        if phrase in text:
            return "Closed", phrase
    return None, None


def _extract_reply_from_body(body_text, before_position=None):
    """
    If body contains 'Reply from: ...' (e.g. in a forwarded thread), return that value.
    When before_position is set, use the last 'Reply from:' before that position (same reply block as closure phrase).
    """
    if not body_text or not isinstance(body_text, str):
        return None
    search_region = body_text[: before_position] if before_position is not None else body_text
    # Find all "Reply from: ..." lines; take the last one in the region (closest before closure phrase)
    matches = list(re.finditer(r"Reply from:\s*(.+?)(?:\n|$)", search_region, re.IGNORECASE | re.DOTALL))
    if not matches:
        return None
    value = matches[-1].group(1).strip().split("\n")[0].strip()  # first line only
    if value:
        return _sender_to_closure_comment(value) or value
    return None


def _extract_reply_from_same_block_as_closure_phrase(body_text, found_phrase):
    """
    Find the 'Reply from: X' whose block (from that line to the next 'Reply from:' or end) contains
    the closure phrase. Use the LAST such block so we get who actually requested closure (same formatted name as from email),
    not the email sender (e.g. NTT Helpdesk) when the body has multiple blocks.
    """
    try:
        if not body_text or not found_phrase or not isinstance(body_text, str):
            return None
        phrase_lower = found_phrase.lower() if isinstance(found_phrase, str) else ""
        if not phrase_lower:
            return None
        # Match "Reply from:" with flexible whitespace; capture rest of line
        pattern = re.compile(r"Reply\s+from\s*:\s*(.+?)(?:\r?\n|$)", re.IGNORECASE | re.DOTALL)
        matches = list(pattern.finditer(body_text))
        if not matches:
            return None
        candidates = []
        for i, m in enumerate(matches):
            block_start = m.start()
            block_end = matches[i + 1].start() if i + 1 < len(matches) else len(body_text)
            block = body_text[block_start:block_end]
            if phrase_lower in block.lower():
                value = m.group(1).strip().split("\n")[0].split("\r")[0].strip()
                if value:
                    candidates.append((block_start, value))
        if not candidates:
            return None
        _, value = candidates[-1]
        return _sender_to_closure_comment(value) or value
    except Exception:
        return None



def _suggest_closure_comment(body_text, matched_email, found_phrase):
    """
    Return suggested Closure_Comments from latest email.
    1. If body contains "Auto-closed due to no response from customer" -> "Incident Auto Closed"
    2. Else if closure phrase found: prefer "Reply from: ..." in same block as phrase (who asked to close), else From header
    """
    if not body_text or not isinstance(body_text, str):
        return None
    text_lower = body_text.lower()
    if any(p in text_lower for p in _GMAIL_AUTO_CLOSED_PHRASES):
        return "Incident Auto Closed"
    if found_phrase and matched_email:
        # Prefer "Reply from: ..." in the same block as the closure phrase (formatted like local-part name, not NTT Helpdesk)
        reply_from = _extract_reply_from_same_block_as_closure_phrase(body_text, found_phrase)
        if reply_from:
            return reply_from
        # Fallback: last "Reply from:" before first occurrence of phrase
        phrase_pos = text_lower.find(found_phrase)
        reply_from = _extract_reply_from_body(body_text, before_position=phrase_pos + len(found_phrase) if phrase_pos >= 0 else None)
        if reply_from:
            return reply_from
        from_val = matched_email.get("from") or ""
        name = _sender_to_closure_comment(from_val)
        if name:
            return name
    return None


def _parse_date_header_to_utc_iso(date_hdr):
    """Date header may be RFC 2822 or ISO 8601 / RFC3339 (e.g. ...Z); normalize to UTC Z."""
    if not date_hdr or not isinstance(date_hdr, str):
        return None
    s = date_hdr.strip()
    if not s:
        return None
    # ISO 8601 / Gmail-style: 2026-03-04T23:49:58.000Z
    try:
        s2 = s.replace("Z", "+00:00") if s.endswith("Z") else s
        dt = datetime.fromisoformat(s2)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        return dt.isoformat().replace("+00:00", "Z")
    except (ValueError, TypeError, OSError):
        pass
    try:
        dt = parsedate_to_datetime(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        return dt.isoformat().replace("+00:00", "Z")
    except (ValueError, TypeError, OSError):
        pass
    return None


def _email_internal_date_iso(em):
    """RFC3339 UTC from Gmail internalDate (ms), else Date header; used as Closure date in UI."""
    if not em or not isinstance(em, dict):
        return None
    tid = em.get("internalDate")
    if tid is not None and str(tid).strip() != "":
        try:
            ms = int(float(str(tid)))
            dt = datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc)
            return dt.isoformat().replace("+00:00", "Z")
        except (ValueError, TypeError, OSError):
            pass
    date_hdr = (em.get("date") or "").strip()
    if date_hdr:
        iso = _parse_date_header_to_utc_iso(date_hdr)
        if iso:
            return iso
    return None


def _best_email_date_iso(matched_email, sorted_emails):
    """Prefer matched email time; fall back to newest emails until a parseable timestamp is found."""
    tried = set()
    for em in ([matched_email] if matched_email else []) + list(sorted_emails or []):
        if em is None or not isinstance(em, dict):
            continue
        key = id(em)
        if key in tried:
            continue
        tried.add(key)
        iso = _email_internal_date_iso(em)
        if iso:
            return iso
    return None


@app.route("/api/gmail/latest-status")
def api_gmail_latest_status():
    """
    GET /api/gmail/latest-status?q=INC12411145&newer_than_days=30
    Fetches the latest email for the given incident/ticket. By default searches all senders
    so closure emails from anybody are found. Scans body for closure phrases, returns suggestedStatus.
    """
    if not GMAIL_AVAILABLE:
        return jsonify({"error": "Gmail not configured"}), 503
    if not is_gmail_connected():
        return jsonify({"error": "Not connected. Connect Gmail first via /api/auth/google"}), 401
    try:
        search_text = request.args.get("q", "").strip()
        from_addr = request.args.get("from", "").strip()
        newer_days = max(1, min(int(request.args.get("newer_than_days", 30)), 90))
        if not search_text:
            return jsonify({"error": "Query param 'q' (search text) is required"}), 400
        if from_addr:
            query = f"from:{from_addr} newer_than:{newer_days}d {search_text}"
        else:
            query = f"newer_than:{newer_days}d {search_text}"
        emails = fetch_recent_alerts(query=query, max_results=30, include_csv_attachments=False)
        if not emails:
            return jsonify({
                "suggestedStatus": None,
                "suggestedClosureComment": None,
                "error": "No matching email found",
            }), 200
        def _msg_time_ms(m):
            tid = m.get("internalDate")
            if tid is not None and str(tid).strip() != "":
                try:
                    return int(float(str(tid)))
                except (ValueError, TypeError):
                    pass
            date_hdr = (m.get("date") or "").strip()
            if date_hdr:
                iso = _parse_date_header_to_utc_iso(date_hdr)
                if iso:
                    try:
                        iso2 = iso.replace("Z", "+00:00")
                        dt = datetime.fromisoformat(iso2)
                        return int(dt.timestamp() * 1000)
                    except (ValueError, TypeError, OSError):
                        pass
            return 0

        sorted_emails = sorted(emails, key=_msg_time_ms, reverse=True)  # newest first
        suggested, found_phrase, matched_email, combined_body = None, None, None, ""
        for em in sorted_emails:
            body_plain = (em.get("body") or "").strip()
            body_html = (em.get("bodyHtml") or "").strip()
            if body_html:
                body_from_html = re.sub(r"<[^>]+>", " ", body_html).strip()
                body = (body_plain + " " + body_from_html).strip()
            else:
                body = body_plain
            sug, phrase = _email_suggests_closed(body)
            if sug and phrase:
                suggested, found_phrase, matched_email, combined_body = sug, phrase, em, body
                break
        if not matched_email:
            matched_email = sorted_emails[0]
            combined_body = (matched_email.get("body") or "").strip()
            if matched_email.get("bodyHtml"):
                combined_body += " " + re.sub(r"<[^>]+>", " ", matched_email["bodyHtml"]).strip()
        try:
            suggested_closure = _suggest_closure_comment(combined_body, matched_email, found_phrase)
        except Exception:
            suggested_closure = None
        if suggested == "Closed" and not (suggested_closure or "").strip():
            from_val = (matched_email or {}).get("from") or ""
            suggested_closure = from_val.strip() or "Closed from email"
        # If _suggest_closure_comment found text (e.g. auto-closed) but the scan loop missed it, still return a status
        # so the UI persists Closure_Comments (strict null suggestedStatus would skip the row).
        if not suggested and (suggested_closure or "").strip():
            suggested = (
                "Incident Auto Closed"
                if (suggested_closure or "").strip() == "Incident Auto Closed"
                else "Closed"
            )
        matched_iso = _best_email_date_iso(matched_email, sorted_emails)
        # If every message lacked internalDate but Date was ISO, _best_email_iso may still be None — try once more on matched email only
        if not matched_iso and matched_email:
            matched_iso = _parse_date_header_to_utc_iso((matched_email.get("date") or "").strip())
        if not matched_iso and matched_email:
            matched_iso = _email_internal_date_iso(matched_email)

        return jsonify({
            "suggestedStatus": suggested,
            "suggestedClosureComment": suggested_closure,
            "matchedEmailDateIso": matched_iso,
            "emailId": matched_email.get("id") if matched_email else None,
            "snippet": (combined_body[:300] + "…") if len(combined_body) > 300 else combined_body,
            "foundPhrase": found_phrase,
            "emailsChecked": len(sorted_emails),
        })
    except Exception as e:
        err_msg = str(e)
        if "invalid_grant" in err_msg.lower():
            remove_token()
            return jsonify({
                "error": "Gmail sign-in expired or was revoked. Please reconnect Gmail from the Alerts page (click Connect Gmail)."
            }), 401
        print("gmail/latest-status error:", e, flush=True)
        return jsonify({"error": err_msg, "suggestedStatus": None, "suggestedClosureComment": None}), 500


# ---------------------------------------------------------------------
# JIRA TICKETS: row status + closure (mirrors browser unified localStorage)
# ---------------------------------------------------------------------
@app.route("/api/jira-row-overrides", methods=["GET", "POST"])
def api_jira_row_overrides():
    """GET returns saved JSON; POST replaces file (body = object keyed by row id)."""
    os.makedirs(os.path.dirname(JIRA_ROW_OVERRIDES_FILE), exist_ok=True)
    if request.method == "GET":
        try:
            with open(JIRA_ROW_OVERRIDES_FILE, "r", encoding="utf-8") as f:
                return jsonify(json.load(f))
        except Exception:
            return jsonify({})
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        data = {}
    try:
        with open(JIRA_ROW_OVERRIDES_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------
# JIRA: CREATE ISSUE (requires JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY, JIRA_ISSUE_TYPE)
# ---------------------------------------------------------------------
@app.route("/api/jira/issue", methods=["POST"])
def api_jira_create_issue():
    """
    POST /api/jira/issue
    Body: { "summary": "...", "description": "...", "incident_category": "", "closure_comments": "", "created": "", "closure_date": "" }
    Creates one Jira issue in the configured project. See docs/JIRA_SETUP.md for env vars.
    """
    try:
        from jira_client import create_issue
    except ImportError:
        return jsonify({"error": "Jira client not available"}), 503

    data = request.get_json() or {}
    summary = (data.get("summary") or "").strip()
    description = (data.get("description") or "").strip()
    status = (data.get("status") or "").strip()
    incident_category = (data.get("incident_category") or "").strip()
    closure_comments = (data.get("closure_comments") or "").strip()
    created = (data.get("created") or "").strip()
    closure_date = (data.get("closure_date") or "").strip()

    if not summary:
        return jsonify({"error": "summary is required"}), 400

    try:
        result = create_issue(
            summary=summary,
            description=description,
            status=status,
            incident_category=incident_category,
            closure_comments=closure_comments,
            created=created,
            closure_date=closure_date,
        )
        return jsonify(result)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except RuntimeError as e:
        print("Jira create_issue failed:", e, flush=True)
        return jsonify({"error": str(e)}), 502
    except Exception as e:
        print("Jira create_issue error:", e, flush=True)
        return jsonify({"error": str(e)}), 500


@app.route("/api/jira/fields")
def api_jira_list_fields():
    """
    GET /api/jira/fields
    Returns list of Jira fields { "id": "customfield_10020", "name": "Start date" }.
    Use this to find the Start date field ID for JIRA_CF_START_DATE in .env.
    """
    try:
        from jira_client import list_fields
    except ImportError:
        return jsonify({"error": "Jira client not available"}), 503
    try:
        return jsonify(list_fields())
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except RuntimeError as e:
        print("Jira list_fields failed:", e, flush=True)
        return jsonify({"error": str(e)}), 502
    except Exception as e:
        print("Jira list_fields error:", e, flush=True)
        return jsonify({"error": str(e)}), 500


@app.route("/api/jira/issues")
def api_jira_search_issues():
    """
    GET /api/jira/issues?max_results=200
    Returns list of issues in the Jira project: [{ "key": "SOC-1", "summary": "...", "status": "..." }].
    Used by "Link existing Jira tickets" to match and display ticket IDs for alerts.
    """
    try:
        from jira_client import search_issues
    except ImportError:
        return jsonify({"error": "Jira client not available"}), 503
    try:
        max_results = min(int(request.args.get("max_results", 200)), 500)
    except (TypeError, ValueError):
        max_results = 200
    try:
        issues = search_issues(max_results=max_results)
        return jsonify(issues)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except RuntimeError as e:
        print("Jira search_issues failed:", e, flush=True)
        return jsonify({"error": str(e)}), 502
    except Exception as e:
        print("Jira search_issues error:", e, flush=True)
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------
# START BACKEND
# ---------------------------------------------------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
