"""
Create a Jira Cloud issue via REST API v3.
Uses env: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY, JIRA_ISSUE_TYPE, optional JIRA_ISSUE_TYPE_ID.
Optional: JIRA_CF_START_DATE (field ID for Start date so sheet Created maps there). Custom fields: JIRA_CF_INCIDENT_DATE, JIRA_CF_INCIDENT_CATEGORY, JIRA_CF_CLOSURE_COMMENTS.
Portal Closure_Comments → Jira issue Comments (REST comment). Portal Closure date → Jira Due date (duedate).
"""
import os
import re
import base64
import requests
from datetime import datetime, timezone


def _env(key: str, default: str = "") -> str:
    return (os.environ.get(key) or default).strip()


def _get_headers(auth: str) -> dict:
    return {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": f"Basic {auth}",
    }


def _resolve_issue_type_id(base_url: str, auth: str, project_key: str, issue_type_name: str):
    """Resolve issue type name to id for the project (Jira Cloud often requires id not name)."""
    try:
        url = f"{base_url}/rest/api/3/project/{project_key}"
        resp = requests.get(url, headers=_get_headers(auth), timeout=15)
        if not resp.ok:
            return None
        data = resp.json()
        for it in data.get("issueTypes", []):
            if (it.get("name") or "").strip().lower() == issue_type_name.strip().lower():
                return str(it.get("id", ""))
    except Exception:
        pass
    return None


def _sheet_date_to_jira_date(created: str) -> str:
    """Parse sheet Created (e.g. 2026-02-28T14:50:23.572944Z) to YYYY-MM-DD for Jira date custom fields."""
    if not created or not created.strip():
        return ""
    s = created.strip()
    # ISO-like: take first 10 chars if it looks like YYYY-MM-DD
    if len(s) >= 10 and re.match(r"\d{4}-\d{2}-\d{2}", s):
        return s[:10]
    return s


def _portal_closure_to_jira_due_date(closure_date: str) -> str:
    """Portal Closure date (ISO UTC, YYYY-MM-DD, or parseable) -> YYYY-MM-DD for Jira duedate."""
    if not closure_date or not str(closure_date).strip():
        return ""
    s = str(closure_date).strip()
    if len(s) >= 10 and re.match(r"\d{4}-\d{2}-\d{2}", s):
        return s[:10]
    try:
        s2 = s.replace("Z", "+00:00") if s.endswith("Z") else s
        dt = datetime.fromisoformat(s2)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).date().isoformat()
    except (ValueError, TypeError, OSError):
        pass
    return ""


def _description_to_adf(plain_text: str) -> dict:
    """Turn plain text into Atlassian Document Format (single paragraph)."""
    if not plain_text:
        plain_text = ""
    return {
        "type": "doc",
        "version": 1,
        "content": [
            {
                "type": "paragraph",
                "content": [{"type": "text", "text": plain_text}],
            }
        ],
    }


# Status names we treat as "closed" (sheet) -> we transition the new issue to a matching Jira status
DONE_LIKE_STATUSES = frozenset((
    "DONE", "CLOSED", "RESOLVED", "COMPLETE", "COMPLETED", "RESOLVED", "CANCELLED",
))


def _add_issue_comment(base_url: str, auth: str, issue_key: str, plain_text: str) -> None:
    """Post portal closure text as a Jira issue comment (Comments tab)."""
    text = (plain_text or "").strip()
    if not text:
        return
    url = f"{base_url}/rest/api/3/issue/{issue_key}/comment"
    payload = {"body": _description_to_adf(text)}
    resp = requests.post(url, json=payload, headers=_get_headers(auth), timeout=30)
    if not resp.ok:
        raise RuntimeError(f"Jira comment API {resp.status_code}: {resp.text[:400]}")


def _patch_issue_description(base_url: str, auth: str, issue_key: str, plain_text: str) -> None:
    """Update issue description (fallback if issue comment fails)."""
    url = f"{base_url}/rest/api/3/issue/{issue_key}"
    payload = {"fields": {"description": _description_to_adf(plain_text)}}
    resp = requests.put(url, json=payload, headers=_get_headers(auth), timeout=30)
    if not resp.ok:
        print(f"Jira description PATCH failed for {issue_key}: {resp.status_code} {resp.text[:300]}", flush=True)


def _transition_to_done(base_url: str, auth: str, issue_key: str) -> None:
    """If the issue can be transitioned to Done/Closed, do it. Logs on failure for debugging."""
    try:
        url = f"{base_url}/rest/api/3/issue/{issue_key}/transitions"
        resp = requests.get(url, headers=_get_headers(auth), timeout=15)
        if not resp.ok:
            print(f"Jira transitions GET failed for {issue_key}: {resp.status_code} {resp.text[:200]}", flush=True)
            return
        data = resp.json()
        transitions = data.get("transitions") or []
        for t in transitions:
            to_status = t.get("to") or {}
            to_name = (to_status.get("name") or "").strip().upper()
            if to_name in DONE_LIKE_STATUSES:
                post_resp = requests.post(
                    url,
                    json={"transition": {"id": t["id"]}},
                    headers=_get_headers(auth),
                    timeout=15,
                )
                if post_resp.ok:
                    print(f"Jira {issue_key} transitioned to {to_status.get('name')}", flush=True)
                else:
                    print(f"Jira transition POST failed for {issue_key}: {post_resp.status_code} {post_resp.text[:200]}", flush=True)
                return
        if transitions:
            names = [(t.get("to") or {}).get("name") for t in transitions]
            print(f"Jira {issue_key}: no Done-like transition (available: {names})", flush=True)
        else:
            print(f"Jira {issue_key}: no transitions available", flush=True)
    except Exception as e:
        print(f"Jira transition error for {issue_key}: {e}", flush=True)


def create_issue(
    summary: str,
    description: str,
    *,
    status: str = "",
    incident_category: str = "",
    closure_comments: str = "",
    created: str = "",
    closure_date: str = "",
) -> dict:
    """
    Create one Jira issue. Returns the JSON response (includes key, id, etc.) or raises.
    closure_comments → Jira issue Comments (REST comment); closure_date → Due date (YYYY-MM-DD).
    If status is Closed/Done/Resolved, transitions the new issue to Done after create.
    """
    base_url = _env("JIRA_BASE_URL").rstrip("/")
    email = _env("JIRA_EMAIL")
    api_token = _env("JIRA_API_TOKEN")
    project_key = _env("JIRA_PROJECT_KEY")
    issue_type_name = _env("JIRA_ISSUE_TYPE") or "Task"
    issue_type_id = _env("JIRA_ISSUE_TYPE_ID")

    if not base_url or not email or not api_token or not project_key:
        raise ValueError(
            "Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY (see docs/JIRA_SETUP.md)"
        )

    auth = base64.b64encode(f"{email}:{api_token}".encode()).decode()
    headers = _get_headers(auth)

    # Jira Cloud often requires issuetype by id, not name (400 otherwise)
    if issue_type_id:
        issuetype_field = {"id": issue_type_id}
    else:
        resolved_id = _resolve_issue_type_id(base_url, auth, project_key, issue_type_name)
        issuetype_field = {"id": resolved_id} if resolved_id else {"name": issue_type_name}

    # Build description body: optional lines + main description (Closure_Comments go to Jira Comments API, not here)
    lines = []
    if created:
        lines.append(f"Created: {created}")
    if incident_category:
        lines.append(f"Incident Category: {incident_category}")
    if description:
        lines.append(description)
    body_text = "\n".join(lines) if lines else "No description."

    # Jira summary must not contain newlines
    summary_clean = (summary or "No summary").replace("\r", " ").replace("\n", " ").strip()
    while "  " in summary_clean:
        summary_clean = summary_clean.replace("  ", " ")

    fields = {
        "project": {"key": project_key},
        "summary": summary_clean or "No summary",
        "issuetype": issuetype_field,
        "description": _description_to_adf(body_text),
        "priority": {"name": "Major"},
    }
    closure_due = _portal_closure_to_jira_due_date(closure_date)
    # Portal Closure date -> Jira Due date (built-in field)
    if closure_due:
        fields["duedate"] = closure_due
    # Map sheet Created date to Start date (preferred) or Due date when closure date did not set due date
    if created:
        jira_date = _sheet_date_to_jira_date(created)
        if jira_date:
            cf_start_date = _env("JIRA_CF_START_DATE")
            if not cf_start_date:
                cf_start_date = _resolve_start_date_field_id()  # auto-detect "Start date" from Jira
            if cf_start_date:
                fields[cf_start_date] = jira_date  # Start date column in Jira
            elif not closure_due:
                fields["duedate"] = jira_date  # legacy: sheet Created -> Due date if no closure date
    # Optional custom fields so sheet Created / Category / Closure appear as Jira columns (not only in description)
    cf_incident_date = _env("JIRA_CF_INCIDENT_DATE")
    cf_incident_category = _env("JIRA_CF_INCIDENT_CATEGORY")
    cf_closure_comments = _env("JIRA_CF_CLOSURE_COMMENTS")
    if cf_incident_date and created:
        fields[cf_incident_date] = _sheet_date_to_jira_date(created)
    if cf_incident_category and incident_category:
        fields[cf_incident_category] = incident_category
    if cf_closure_comments and closure_comments:
        fields[cf_closure_comments] = closure_comments
    # Map Incident Category to Jira Labels (one or more labels; normalize for Jira: lowercase, spaces -> hyphen)
    if incident_category:
        raw = [s.strip() for s in incident_category.split(",") if s.strip()]
        labels = [re.sub(r"[^\w\-]", "-", s.lower().replace(" ", "-")).strip("-") or "uncategorized" for s in raw]
        if labels:
            fields["labels"] = labels

    payload = {"fields": fields}

    url = f"{base_url}/rest/api/3/issue"

    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=30)
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"Jira request failed: {e}") from e

    if not resp.ok:
        try:
            err_body = resp.json()
            parts = []
            if err_body.get("errorMessages"):
                parts.append("; ".join(str(m) for m in err_body["errorMessages"]))
            if err_body.get("errors") and isinstance(err_body["errors"], dict):
                for k, v in err_body["errors"].items():
                    parts.append(f"{k}: {v}")
            msg = " ".join(parts) if parts else resp.text or str(err_body) or resp.reason
        except Exception:
            msg = resp.text or resp.reason
        raise RuntimeError(f"Jira API {resp.status_code}: {msg}")

    result = resp.json()
    issue_key = result.get("key")
    # Map Closure_Comments -> Jira issue Comments (REST comment)
    if issue_key and (closure_comments or "").strip():
        cc = closure_comments.strip()
        try:
            _add_issue_comment(base_url, auth, issue_key, cc)
        except Exception as e:
            print(f"Jira issue comment failed for {issue_key}, falling back to description: {e}", flush=True)
            fallback = body_text + ("\n\nClosure_Comments: " + cc if cc else "")
            try:
                _patch_issue_description(base_url, auth, issue_key, fallback)
            except Exception as e2:
                print(f"Jira description fallback failed for {issue_key}: {e2}", flush=True)
    # If sheet status is closed-like, transition the new issue to Done so Jira matches
    if issue_key and status:
        status_upper = status.strip().upper()
        sheet_closed = (
            status_upper in ("CLOSED", "DONE", "RESOLVED", "COMPLETE", "COMPLETED", "CANCELLED")
            or "CLOSED" in status_upper  # e.g. "INCIDENT AUTO CLOSED"
        )
        if sheet_closed:
            _transition_to_done(base_url, auth, issue_key)
    return result


# Cache for auto-resolved Start date field ID (so we don't call list_fields on every create)
_start_date_field_id_cache = None


def _resolve_start_date_field_id() -> str:
    """Return Jira field ID for 'Start date' if found, else ''. Uses cache after first lookup."""
    global _start_date_field_id_cache
    if _start_date_field_id_cache is not None:
        return _start_date_field_id_cache
    try:
        for f in list_fields():
            if (f.get("name") or "").strip().lower() == "start date":
                _start_date_field_id_cache = (f.get("id") or "").strip()
                return _start_date_field_id_cache
    except Exception:
        pass
    _start_date_field_id_cache = ""
    return ""


def list_fields() -> list:
    """
    List Jira fields (id, name) so you can find e.g. Start date field ID for JIRA_CF_START_DATE.
    """
    base_url = _env("JIRA_BASE_URL").rstrip("/")
    email = _env("JIRA_EMAIL")
    api_token = _env("JIRA_API_TOKEN")
    if not base_url or not email or not api_token:
        raise ValueError("Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN")
    auth = base64.b64encode(f"{email}:{api_token}".encode()).decode()
    headers = _get_headers(auth)
    url = f"{base_url}/rest/api/3/field"
    try:
        resp = requests.get(url, headers=headers, timeout=30)
    except requests.exceptions.RequestException as e:
        raise RuntimeError(f"Jira request failed: {e}") from e
    if not resp.ok:
        raise RuntimeError(f"Jira API {resp.status_code}: {resp.text[:200]}")
    out = []
    for f in resp.json() or []:
        out.append({"id": f.get("id", ""), "name": (f.get("name") or "").strip()})
    return out


def _issues_from_search_payload(data: dict) -> list:
    """Parse issues array from Jira search JSON (classic or enhanced JQL)."""
    issues = []
    for item in (data or {}).get("issues") or []:
        key = item.get("key")
        if not key:
            continue
        fields = item.get("fields") or {}
        summary = (fields.get("summary") or "").strip()
        status_obj = fields.get("status") or {}
        status_name = (status_obj.get("name") or "").strip()
        issues.append({"key": key, "summary": summary, "status": status_name})
    return issues


def _search_issues_jql_enhanced(base_url: str, headers: dict, jql: str, max_results: int) -> list | None:
    """
    Jira Cloud enhanced search GET /rest/api/3/search/jql with nextPageToken pagination.
    Returns None if the endpoint is missing (caller falls back to classic /search).
    """
    url = f"{base_url}/rest/api/3/search/jql"
    collected: list = []
    next_token = None
    first_request = True
    while len(collected) < max_results:
        batch = min(100, max_results - len(collected))
        params: dict = {"jql": jql, "maxResults": batch, "fields": "summary,status"}
        if next_token:
            params["nextPageToken"] = next_token
        try:
            resp = requests.get(url, params=params, headers=headers, timeout=60)
        except requests.exceptions.RequestException as e:
            raise RuntimeError(f"Jira request failed: {e}") from e
        if resp.status_code != 200:
            if first_request and resp.status_code in (404, 405, 410):
                return None
            raise RuntimeError(f"Jira API {resp.status_code}: {(resp.text or '')[:400]}")
        first_request = False
        try:
            data = resp.json()
        except Exception as e:
            raise RuntimeError(f"Jira search: invalid JSON ({e})") from e
        collected.extend(_issues_from_search_payload(data))
        if data.get("isLast"):
            break
        next_token = data.get("nextPageToken")
        if not next_token or (isinstance(next_token, str) and not next_token.strip()):
            break
    return collected


def _search_issues_classic(base_url: str, headers: dict, jql: str, max_results: int) -> list:
    """Legacy GET /rest/api/3/search or /rest/api/2/search with startAt pagination (Jira Server / older Cloud)."""
    collected: list = []
    for api_ver in ("3", "2"):
        url = f"{base_url}/rest/api/{api_ver}/search"
        start_at = 0
        while len(collected) < max_results:
            batch = min(50, max_results - len(collected))
            params = {"jql": jql, "startAt": start_at, "maxResults": batch, "fields": "summary,status"}
            try:
                resp = requests.get(url, params=params, headers=headers, timeout=60)
            except requests.exceptions.RequestException as e:
                raise RuntimeError(f"Jira request failed: {e}") from e
            if not resp.ok:
                break
            try:
                data = resp.json()
            except Exception:
                break
            page = _issues_from_search_payload(data)
            if not page:
                return collected
            collected.extend(page)
            total = int(data.get("total") or 0)
            start_at += len(page)
            if start_at >= total or len(page) < batch:
                return collected
        if collected:
            return collected
    raise RuntimeError(
        "Jira search failed: no working search endpoint (tried /rest/api/3/search/jql and /rest/api/3|2/search)."
    )


def search_issues(max_results: int = 200) -> list:
    """
    Search Jira for issues in the configured project. Returns list of { "key": "SOC-1", "summary": "...", "status": "..." }.
    Used to link existing Jira tickets to alerts by matching summary to incident/servicenow.
    Uses enhanced JQL search with pagination when available; falls back to classic /search.
    """
    base_url = _env("JIRA_BASE_URL").rstrip("/")
    email = _env("JIRA_EMAIL")
    api_token = _env("JIRA_API_TOKEN")
    project_key = _env("JIRA_PROJECT_KEY")
    if not base_url or not email or not api_token or not project_key:
        raise ValueError(
            "Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY (see docs/JIRA_SETUP.md)"
        )
    auth = base64.b64encode(f"{email}:{api_token}".encode()).decode()
    headers = _get_headers(auth)
    jql = f"project = {project_key} ORDER BY created DESC"
    cap = min(max(1, int(max_results)), 2000)

    enhanced = _search_issues_jql_enhanced(base_url, headers, jql, cap)
    if enhanced is not None:
        return enhanced[:cap]

    classic = _search_issues_classic(base_url, headers, jql, cap)
    return classic[:cap]
