# main.py

import json
import os
import re
import time
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
        get_current_account_identity,
        FRONTEND_ORIGIN,
    )
    from email_client.gmail_client import (
        fetch_recent_alerts,
        distinctive_rule_text,
        gmail_keyword_fragment,
        rule_search_token,
        search_messages_light,
    )
    from mappers.gmail_to_alert import gmail_message_to_alert
    GMAIL_AVAILABLE = True
except Exception as e:
    fetch_recent_alerts = None  # type: ignore
    distinctive_rule_text = None  # type: ignore
    gmail_keyword_fragment = None  # type: ignore
    rule_search_token = None  # type: ignore
    search_messages_light = None  # type: ignore
    get_current_account_identity = None  # type: ignore
    GMAIL_AVAILABLE = False
    print("Gmail/OAuth not loaded:", e, flush=True)

# DB + session-based auth for the weekly-reports endpoints (PII).
from db import init_db
from auth.session import (
    upsert_user,
    issue_session_cookie,
    clear_session_cookie,
    SESSION_COOKIE_NAME,
)
from routes.weekly_reports import weekly_bp
from routes.daily_alerts import daily_bp
from routes.jira_tickets import jira_tickets_bp

init_db()

STORAGE_FILE = os.path.join(os.path.dirname(__file__), "storage", "incident_store.json")
JIRA_ROW_OVERRIDES_FILE = os.path.join(os.path.dirname(__file__), "storage", "jira_row_overrides.json")

app = Flask(__name__)

# Register the DB-backed blueprints. Each enforces session auth via
# `@require_auth` on every route (workspace rule: PII endpoints need
# strong auth) and reads/writes through SQLAlchemy ORM bound parameters
# (workspace rule: never build SQL via string concatenation).
#   /api/weekly-reports/*  -> Weekly Reports page
#   /api/daily-alerts/*    -> Daily Alerts + Jira Tickets pages (shared rows)
#   /api/jira-tickets/*    -> per-row Jira ticket mapping (server-side dedupe)
# `/api/me` is registered separately below using the same auth decorator.
app.register_blueprint(weekly_bp, url_prefix="/api/weekly-reports")
app.register_blueprint(daily_bp, url_prefix="/api/daily-alerts")
app.register_blueprint(jira_tickets_bp, url_prefix="/api/jira-tickets")

# ---------------------------------------------------------------------
# CORS CONFIG
# ---------------------------------------------------------------------
# Cookies (sentinel_session) are credentials -- with `supports_credentials=True`
# the spec forbids `Access-Control-Allow-Origin: *`. Pull allowed origins from
# env (CORS_ORIGINS comma-separated) and fall back to the dev frontend / local
# Vite ports. NEVER ship a wildcard with credentialed cookies in production.
_cors_env = os.environ.get("CORS_ORIGINS", "").strip()
if _cors_env:
    _allowed_origins = [o.strip() for o in _cors_env.split(",") if o.strip()]
else:
    _allowed_origins = [
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

CORS(
    app,
    resources={r"/api/*": {"origins": _allowed_origins}},
    supports_credentials=True,
    allow_headers=["Content-Type", "Authorization"],
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
)


@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        response = make_response()
        origin = request.headers.get("Origin", "")
        if origin in _allowed_origins:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
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
        # Identify the just-signed-in account so we can issue a server session.
        user_email, user_name = (None, None)
        try:
            if get_current_account_identity is not None:
                user_email, user_name = get_current_account_identity()
        except Exception as ident_exc:
            print("identity lookup failed:", ident_exc, flush=True)

        response = make_response(redirect(f"{FRONTEND_ORIGIN}/?gmail_connected=1"))
        if user_email:
            try:
                uid = upsert_user(user_email, user_name)
                issue_session_cookie(response, uid)
            except Exception as sess_exc:
                # Do not block OAuth on session-setup errors; the user can still
                # browse non-PII pages, but PII endpoints will 401 until fixed.
                print("session setup failed:", sess_exc, flush=True)
        return response
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/auth/logout", methods=["POST"])
def api_auth_logout():
    response = make_response(jsonify({"ok": True}))
    clear_session_cookie(response)
    return response


from auth.session import get_or_establish_current_user as _resolve_current_user
from auth.session import require_auth as _require_auth


@app.get("/api/me")
def api_me():
    """
    Session probe.

    Returns the Google account bound to this browser session, or 401 when
    nothing is connected. If the server has a valid Gmail token but the
    browser hasn't been issued a session cookie yet (e.g. user OAuthed
    before the cookie code shipped), this endpoint silently establishes
    the session as a side effect -- the response will set the cookie.
    """
    user = _resolve_current_user()
    if user is None:
        return jsonify({"error": "authentication required"}), 401
    return jsonify(
        {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "lastSeenAt": user.last_seen_at.isoformat() if user.last_seen_at else None,
        }
    )


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
        max_results = min(int(request.args.get("max_results", 50)), 2500)
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
        newer_days = max(1, min(int(request.args.get("newer_than_days", 30)), 450))
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


def _gmail_rule_hits_query(keyword_fragment: str, after_date: str, before_date: str, from_filter: str) -> str:
    """Compose a bounded Gmail search query for SIEM rule ↔ mailbox mapping (implicit AND on keywords)."""
    a = datetime.strptime(after_date, "%Y-%m-%d")
    b = datetime.strptime(before_date, "%Y-%m-%d")
    qa = f"after:{a.year}/{a.month}/{a.day}"
    qb = f"before:{b.year}/{b.month}/{b.day}"
    parts = [qa, qb]
    ff = (from_filter or "").strip()
    if ff:
        parts.append(f"from:{ff}")
    kf = (keyword_fragment or "").strip()
    if not kf:
        return ""
    parts.append(kf)
    return " ".join(parts)


@app.route("/api/gmail/rule-hits", methods=["POST"])
def api_gmail_rule_hits():
    """
    POST JSON: { "rule_names": [...], "after_date": "YYYY-MM-DD", "before_date": "YYYY-MM-DD",
                 "from_filter": optional sender, "max_results_per_rule": optional (default 500) }
    For each rule name, search Gmail using the distinctive rule title (shared customer id like 125850341
    is stripped). Keyword AND narrows the list; subjects are filtered so samples match that rule.
    """
    if not GMAIL_AVAILABLE:
        return jsonify({"error": "Gmail not configured"}), 503
    if not is_gmail_connected():
        return jsonify({"error": "Not connected. Connect Gmail first via /api/auth/google"}), 401
    try:
        data = request.get_json() or {}
        rule_names = data.get("rule_names") or []
        after_date = (data.get("after_date") or "").strip()
        before_date = (data.get("before_date") or "").strip()
        from_filter = (data.get("from_filter") or "").strip()
        max_per = min(int(data.get("max_results_per_rule", 500)), 500)
        sample_n = min(int(data.get("sample_n", 3)), 20)

        if not isinstance(rule_names, list):
            return jsonify({"error": "rule_names must be an array"}), 400
        if not after_date or not before_date:
            return jsonify({"error": "after_date and before_date (YYYY-MM-DD) are required"}), 400
        try:
            datetime.strptime(after_date, "%Y-%m-%d")
            datetime.strptime(before_date, "%Y-%m-%d")
        except ValueError:
            return jsonify({"error": "Dates must be YYYY-MM-DD"}), 400

        if from_filter and not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", from_filter):
            return jsonify({"error": "from_filter must be a valid email address if provided"}), 400

        cleaned: list[str] = []
        for r in rule_names:
            if not isinstance(r, str):
                continue
            s = r.strip()
            if not s or len(s) > 500:
                continue
            cleaned.append(s)
        # Dedupe preserving order
        seen = set()
        unique_rules: list[str] = []
        for r in cleaned:
            if r in seen:
                continue
            seen.add(r)
            unique_rules.append(r)
        if len(unique_rules) > 400:
            return jsonify({"error": "Too many rule names (max 400)"}), 400

        results = []
        rules_with_hits = 0
        total_first_page = 0

        for i, rule_name in enumerate(unique_rules):
            if i > 0:
                time.sleep(0.12)
            distinctive = distinctive_rule_text(rule_name)
            fragment = gmail_keyword_fragment(distinctive)
            display_token = rule_search_token(rule_name)
            q = _gmail_rule_hits_query(fragment, after_date, before_date, from_filter)
            if not q or not fragment:
                results.append({
                    "rule_name": rule_name,
                    "search_token": display_token,
                    "gmail_query": q,
                    "match_count": 0,
                    "capped_at_max": False,
                    "sample_subjects": [],
                    "error": "Could not derive searchable keywords from rule name (need text after customer id).",
                })
                continue
            try:
                info = search_messages_light(
                    q,
                    max_results=max_per,
                    sample_n=sample_n,
                    distinctive_text=distinctive,
                )
            except Exception as ex:
                results.append({
                    "rule_name": rule_name,
                    "search_token": display_token,
                    "gmail_query": q,
                    "match_count": 0,
                    "capped_at_max": False,
                    "sample_subjects": [],
                    "error": str(ex),
                })
                continue

            mc = info.get("match_count", 0)
            if mc > 0:
                rules_with_hits += 1
            total_first_page += mc
            results.append({
                "rule_name": rule_name,
                "search_token": display_token,
                "gmail_query": q,
                "match_count": mc,
                "capped_at_max": bool(info.get("capped_at_max")),
                "sample_subjects": info.get("sample_subjects") or [],
            })

        zero_hits = len(unique_rules) - rules_with_hits
        return jsonify({
            "after_date": after_date,
            "before_date": before_date,
            "from_filter": from_filter or None,
            "summary": {
                "rules_submitted": len(unique_rules),
                "rules_with_hits": rules_with_hits,
                "rules_with_zero_hits": zero_hits,
                "sum_match_count_first_page": total_first_page,
            },
            "results": results,
        })
    except Exception as e:
        err_msg = str(e)
        if "invalid_grant" in err_msg.lower():
            remove_token()
            return jsonify({
                "error": "Gmail sign-in expired or was revoked. Please reconnect Gmail from the Alerts page (click Connect Gmail)."
            }), 401
        print("gmail/rule-hits error:", e, flush=True)
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
    # Common ServiceNow / SOC wording (often "Kindly proceed with" + line break + "closing this alert")
    "proceed with closing this alert",
    "kindly proceed with closing this alert",
    "proceed with the closure of the ticket",
    "we proceed with the closure",
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

# Cyware: "Ticket is closed from My NTTIN Portal". CMP integration often: "Ticket closed from MYNTTI Portal by Customer."
# (optional "is", MYNTTI vs My NTTIN spelling) → same portal closure path → Vedantsingh 1.
_RE_NTTIN_FAMILY_PORTAL = re.compile(
    r"ticket\s+(?:is\s+)?closed\s+from\s+(?:my\s+nttin|myntti|my\s+ntti)\s+portal\b",
    re.IGNORECASE,
)


def _body_has_nttin_portal_closure(body_text):
    if not body_text or not isinstance(body_text, str):
        return False
    t = body_text.replace("\xa0", " ").replace("\u200b", "").replace("\ufeff", "")
    return bool(_RE_NTTIN_FAMILY_PORTAL.search(t))


def _email_body_normalized_plain(em):
    """Plain text + de-HTML'd body, whitespace-collapsed (same rules as latest-status scan loop)."""
    if not em or not isinstance(em, dict):
        return ""
    body_plain = (em.get("body") or "").strip()
    body_html = (em.get("bodyHtml") or "").strip()
    if body_html:
        body_from_html = re.sub(r"<[^>]+>", " ", body_html).strip()
        body = (body_plain + " " + body_from_html).strip()
    else:
        body = body_plain
    return " ".join(body.replace("\xa0", " ").split())


def _merged_bodies_from_emails(email_list):
    """Concatenate all message bodies so portal / closure lines in any hit are visible."""
    parts = []
    for em in email_list or []:
        b = _email_body_normalized_plain(em)
        if b:
            parts.append(b)
    return "\n".join(parts)


# ServiceNow / HTML often breaks "Reply" and "from" across whitespace or &nbsp;; allow flexible gaps.
_RE_REPLY_FROM_LINE = re.compile(
    r"Reply[\s\xa0]+from[\s\xa0]*:[\s\xa0]*(.+?)(?:\r?\n|$)",
    re.IGNORECASE | re.DOTALL,
)
# Prefer customer addresses from these domains when multiple externals appear after closure phrase.
_PREFERRED_CUSTOMER_EMAIL_SUFFIXES = ("@policybazaar.com",)

# Fixed labels for role mailboxes (fetch-status closure_comments / sender display).
_KNOWN_MAILBOX_DISPLAY_BY_EMAIL: dict[str, str] = {
    "soc-incident@policybazaar.com": "SOC-Team",
    "pbsoc@policybazaar.com": "PB SOC",
}


def _email_is_pbsoc_distribution_mailbox(addr: str) -> bool:
    """
    True for pbsoc@… in deep quoted helpdesk lines. Skip for *body* email scans only.
    Do not conflate with soc-incident@… — Reply-from soc-incident should attribute as SOC-Team.
    """
    if not addr or not isinstance(addr, str):
        return False
    al = addr.strip().lower()
    if not al.endswith("@policybazaar.com"):
        return False
    local = re.sub(r"[^a-z0-9]", "", al.split("@", 1)[0])
    return local == "pbsoc"


def _email_is_pb_non_person_mailbox(addr: str) -> bool:
    """
    Integration / service accounts (e.g. pbpw50427@policybazaar.com → "Pbpw 50427") that appear
    in HTML or headers before real people; must not win closure attribution.
    """
    if not addr or not isinstance(addr, str):
        return False
    al = addr.strip().lower()
    if not al.endswith("@policybazaar.com"):
        return False
    local = re.sub(r"[._+\-]", "", al.split("@", 1)[0])
    if re.fullmatch(r"pbpw\d+", local, re.I):
        return True
    return False


def _email_skip_closure_attribution(addr: str) -> bool:
    """Skip pbsoc (quoted DL) and pbpw service accounts in raw body email scans — not soc-incident."""
    return _email_is_pbsoc_distribution_mailbox(addr) or _email_is_pb_non_person_mailbox(addr)


def _email_to_display_name(email_value):
    """
    Single format from mailbox local-part: e.g. gajendrasingh1@x.com -> "Gajendrasingh 1".
    Dots/underscores/dashes are removed (not turned into separate words) so we never mix
    "Gajendra Singh" vs "Gajendrasingh 1".
    """
    if not email_value or not isinstance(email_value, str) or "@" not in email_value:
        return email_value or ""
    mapped = _KNOWN_MAILBOX_DISPLAY_BY_EMAIL.get(email_value.strip().lower())
    if mapped:
        return mapped
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


def _email_address_internal(addr: str) -> bool:
    if not addr or not isinstance(addr, str):
        return True
    al = addr.strip().lower()
    if "nttin.support" in al:
        return True
    if al.endswith("@global.ntt"):
        return True
    if al.endswith("@ntt.com") and "support" in al:
        return True
    return False


def _email_looks_system_or_bulk(addr: str) -> bool:
    if not addr or not isinstance(addr, str):
        return True
    al = addr.lower()
    if "noreply" in al or "no-reply" in al or "donotreply" in al or "mailer-daemon" in al:
        return True
    return False


def _closure_text_looks_internal_bogus(text: str) -> bool:
    """True if snippet/comment is helpdesk boilerplate, not a real customer id."""
    if not text or not isinstance(text, str):
        return True
    sl = text.lower()
    if "nttin.support" in sl or "nttinsupport" in sl.replace(" ", "").replace("—", "").replace("-", ""):
        return True
    if "customer confirmation" in sl and ("ntt" in sl or "helpdesk" in sl):
        return True
    if "reply from:" in sl and "ntt" in sl and "@" not in sl:
        return True
    return False


def _extract_best_external_display_after_phrase(body_text, after_index: int):
    """
    First external email at/after after_index in body; prefer preferred customer domains.
    Used when Reply-from lines are missing (HTML mangling) but the thread still contains @customer.
    """
    if not body_text or not isinstance(body_text, str):
        return None
    start = max(0, int(after_index))
    tail = body_text[start:]
    best = None  # (prefer_rank 0=best, pos)
    for m in re.finditer(r"[\w.+-]+@[\w.-]+\.\w+", tail):
        addr = m.group(0)
        if _email_address_internal(addr) or _email_looks_system_or_bulk(addr):
            continue
        if _email_skip_closure_attribution(addr):
            continue
        al = addr.lower()
        pref = 0 if any(al.endswith(sfx) for sfx in _PREFERRED_CUSTOMER_EMAIL_SUFFIXES) else 1
        pos = m.start()
        cand = (pref, pos, _email_to_display_name(addr) or addr)
        if best is None or cand[0] < best[0] or (cand[0] == best[0] and cand[1] < best[1]):
            best = cand
    return best[2] if best else None


def _extract_best_external_display_from_body(body_text):
    """Prefer first non-role @policybazaar.com in body (top = latest customer reply); else last external."""
    if not body_text or not isinstance(body_text, str):
        return None
    matches = list(re.finditer(r"[\w.+-]+@[\w.-]+\.\w+", body_text))
    if not matches:
        return None
    first_pb_person = None
    last_ext = None
    for m in matches:
        addr = m.group(0)
        if _email_address_internal(addr) or _email_looks_system_or_bulk(addr):
            continue
        if _email_skip_closure_attribution(addr):
            continue
        al = addr.lower()
        disp = _email_to_display_name(addr) or addr
        last_ext = disp
        if any(al.endswith(sfx) for sfx in _PREFERRED_CUSTOMER_EMAIL_SUFFIXES):
            if first_pb_person is None:
                first_pb_person = disp
    return first_pb_person or last_ext


def _email_suggests_closed(body_text):
    """Return (suggested_status, found_phrase) if body suggests closure; else (None, None)."""
    if not body_text or not isinstance(body_text, str):
        return None, None
    # Collapse newlines / NBSP so phrases are not split across lines (e.g. "with\\nclosing this alert").
    text = " ".join(body_text.lower().replace("\xa0", " ").split())
    for phrase in _GMAIL_CLOSURE_PHRASES:
        if phrase in text:
            return "Closed", phrase
    return None, None


def _extract_reply_from_body(body_text, before_position=None):
    """
    If body contains 'Reply from: ...' (e.g. in a forwarded thread), return that value.
    When before_position is set, use the last 'Reply from:' in that prefix (legacy).
    Prefer _extract_first_reply_from_after / _extract_last_external_reply_from for ServiceNow digests.
    """
    if not body_text or not isinstance(body_text, str):
        return None
    search_region = body_text[: before_position] if before_position is not None else body_text
    matches = list(_RE_REPLY_FROM_LINE.finditer(search_region))
    if not matches:
        return None
    value = matches[-1].group(1).strip().split("\n")[0].split("\r")[0].strip()
    if value:
        return _sender_to_closure_comment(value) or value
    return None


def _reply_line_internal(reply_line: str) -> bool:
    """True if Reply-from line points at NTT / helpdesk (not the customer)."""
    if not reply_line or not isinstance(reply_line, str):
        return True
    s = reply_line.lower()
    for addr in re.findall(r"[\w.+-]+@[\w.-]+\.\w+", s):
        if _email_address_internal(addr):
            return True
    compact = re.sub(r"[\s—\-]+", "", s)
    return "nttin.support" in s or "nttinsupport" in compact


def _reply_from_line_excluded_from_closure(reply_line: str) -> bool:
    """True if Reply-from should not be used for closure attribution."""
    if _reply_line_internal(reply_line):
        return True
    for addr in re.findall(r"[\w.+-]+@[\w.-]+\.\w+", reply_line):
        if _email_skip_closure_attribution(addr):
            return True
    return False


def _from_header_internal(from_val: str) -> bool:
    if not from_val or not isinstance(from_val, str):
        return False
    s = from_val.lower()
    return "nttin.support" in s or ("ntt" in s and "helpdesk" in s)


def _extract_first_reply_from_after(body_text, start_pos: int):
    """First external 'Reply from:' at/after start_pos (customer line often below ServiceNow 'Customer Update')."""
    if not body_text or not isinstance(body_text, str):
        return None
    start = max(0, int(start_pos))
    region = body_text[start:]
    for m in _RE_REPLY_FROM_LINE.finditer(region):
        value = m.group(1).strip().split("\n")[0].split("\r")[0].strip()
        if value and not _reply_from_line_excluded_from_closure(value):
            return _sender_to_closure_comment(value) or value
    return None


def _extract_last_external_reply_from(body_text):
    """Last Reply-from whose address is not NTT/internal (customer usually last meaningful replier)."""
    if not body_text or not isinstance(body_text, str):
        return None
    for m in reversed(list(_RE_REPLY_FROM_LINE.finditer(body_text))):
        value = m.group(1).strip().split("\n")[0].split("\r")[0].strip()
        if value and not _reply_from_line_excluded_from_closure(value):
            return _sender_to_closure_comment(value) or value
    return None


def _excerpt_around_closure_phrase(body_text, found_phrase, max_len=240):
    """Short snippet for Closure_Comments when From is internal but body states customer confirmation."""
    if not body_text or not found_phrase or not isinstance(body_text, str):
        return None
    idx = body_text.lower().find(found_phrase.lower())
    if idx < 0:
        return None
    start = max(0, idx - 100)
    end = min(len(body_text), idx + len(found_phrase) + 140)
    snippet = " ".join(body_text[start:end].split())
    if len(snippet) > max_len:
        snippet = snippet[: max_len - 1].rstrip() + "…"
    snippet = (snippet or "").strip()
    if not snippet or _closure_text_looks_internal_bogus(snippet):
        return None
    return snippet


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
        matches = list(_RE_REPLY_FROM_LINE.finditer(body_text))
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
        if _reply_from_line_excluded_from_closure(value):
            for _, val in reversed(candidates):
                if val and not _reply_from_line_excluded_from_closure(val):
                    return _sender_to_closure_comment(val) or val
            return None
        return _sender_to_closure_comment(value) or value
    except Exception:
        return None



def _suggest_closure_comment(body_text, matched_email, found_phrase):
    """
    Return suggested Closure_Comments from latest email.
    1. If body contains "Auto-closed due to no response from customer" -> "Incident Auto Closed"
    2. Else if closure phrase found: prefer "Reply from:" whose block contains the phrase (e.g. soc-incident@ -> SOC-Team).
       ServiceNow "IST - Name" lines are not used for closure attribution.
    3. Avoid using NTT helpdesk From when the notification is internal; use excerpt around the closure phrase instead.
    """
    if not body_text or not isinstance(body_text, str):
        return None
    body_text = body_text.replace("\xa0", " ")
    text_lower = body_text.lower()
    if any(p in text_lower for p in _GMAIL_AUTO_CLOSED_PHRASES):
        return "Incident Auto Closed"
    if _body_has_nttin_portal_closure(body_text):
        return "Vedantsingh 1"
    if not found_phrase or not matched_email:
        return None

    reply_from = _extract_reply_from_same_block_as_closure_phrase(body_text, found_phrase)
    if reply_from:
        return reply_from

    phrase_pos = text_lower.find(found_phrase.lower())
    reply_from = _extract_first_reply_from_after(body_text, phrase_pos if phrase_pos >= 0 else 0)
    if reply_from:
        return reply_from

    reply_from = _extract_last_external_reply_from(body_text)
    if reply_from:
        return reply_from

    phrase_idx = phrase_pos if phrase_pos >= 0 else 0
    ext_after = _extract_best_external_display_after_phrase(body_text, phrase_idx)
    if ext_after:
        return ext_after

    ext_any = _extract_best_external_display_from_body(body_text)
    if ext_any:
        return ext_any

    excerpt = _excerpt_around_closure_phrase(body_text, found_phrase)
    from_val = matched_email.get("from") or ""

    if _from_header_internal(from_val):
        if excerpt:
            return excerpt
        return None

    name = _sender_to_closure_comment(from_val)
    if name:
        return name
    if excerpt:
        return excerpt
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
        # Weekly / FY CSV rows can reference incidents from many months ago; allow long lookback (Gmail supports newer_than:Xd).
        newer_days = max(1, min(int(request.args.get("newer_than_days", 30)), 450))
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
            body = _email_body_normalized_plain(em)
            sug, phrase = _email_suggests_closed(body)
            if sug and phrase:
                suggested, found_phrase, matched_email, combined_body = sug, phrase, em, body
                break
        if not matched_email:
            matched_email = sorted_emails[0]
            combined_body = _email_body_normalized_plain(matched_email)
        try:
            suggested_closure = _suggest_closure_comment(combined_body, matched_email, found_phrase)
        except Exception:
            suggested_closure = None
        if suggested == "Closed" and not (suggested_closure or "").strip():
            from_val = (matched_email or {}).get("from") or ""
            cb = combined_body.replace("\xa0", " ")
            pl = (found_phrase or "").lower()
            phrase_idx = cb.lower().find(pl) if pl else -1
            phrase_idx = phrase_idx if phrase_idx >= 0 else 0
            ex = _excerpt_around_closure_phrase(cb, found_phrase or "")
            scav = _extract_best_external_display_after_phrase(cb, phrase_idx) or _extract_best_external_display_from_body(cb)
            if _from_header_internal(from_val):
                suggested_closure = scav or ex or "Closed from email"
            else:
                suggested_closure = (
                    scav
                    or (_sender_to_closure_comment(from_val) or from_val.strip() or None)
                    or ex
                    or "Closed from email"
                )
        # Portal line may appear in a different Gmail hit than the one that matched the generic closure phrase;
        # scan all returned messages so Cyware "My NTTIN Portal" / CMP "MYNTTI Portal" wins over excerpts or integration names.
        merged_all_bodies = _merged_bodies_from_emails(sorted_emails)
        if merged_all_bodies and _body_has_nttin_portal_closure(merged_all_bodies):
            ml = merged_all_bodies.lower()
            if (suggested_closure or "").strip() != "Incident Auto Closed" and not any(
                p in ml for p in _GMAIL_AUTO_CLOSED_PHRASES
            ):
                suggested_closure = "Vedantsingh 1"
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
# NOTE: Prefer POST /api/jira-tickets/create -- it does the same Jira call
# AND records the (message_id, row_index) -> jira_key mapping in the DB so
# the same row can never accidentally create two Jira tickets after a
# refresh / restart / browser switch. This raw endpoint is kept for backwards
# compatibility; it is now session-authenticated to satisfy the "PII APIs
# require strong auth" workspace rule (request payload includes incident
# data scraped from Gmail / ServiceNow).
@app.route("/api/jira/issue", methods=["POST"])
@_require_auth
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
        msg = str(e)
        print("Jira create_issue failed:", e, flush=True)
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
@_require_auth
def api_jira_search_issues():
    """
    GET /api/jira/issues?max_results=200
    Returns list of issues in the Jira project: [{ "key": "SOC-1", "summary": "...", "status": "..." }].
    Used by "Link existing Jira tickets" to match and display ticket IDs for alerts.
    Session-authenticated: response contains issue summaries which can include
    incident IDs / customer references (PII) per the workspace rule.
    """
    try:
        from jira_client import search_issues
    except ImportError:
        return jsonify({"error": "Jira client not available"}), 503
    try:
        max_results = min(int(request.args.get("max_results", 200)), 2000)
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
