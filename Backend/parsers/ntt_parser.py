# parsers/ntt_parser.py
import re
from datetime import datetime

SUBJECT_REGEX = re.compile(
    r"""Case:\s*(?P<case>CS[\dA-Za-z-]+)      # Case: CS...
        \s*(?P<action>has been updated|has been created|was closed|is updated|updated)?    # optional action
        \s*-\s*(?P<ticket>[\dA-Za-z-]+)?     # - 125850xxx (ticket/internal id)
        \s*-\s*(?P<client>[^-]+?)\s*-\s*(?P<product>[^:|]+)   # - ClientX - X-Force
        \s*:\s*(?P<title>[^|]+)               # : Internal Connection...
        (?:\|\|\s*Offense\s*ID:\s*(?P<offense>\d+))?         # || Offense ID: 3314
    """,
    re.IGNORECASE | re.VERBOSE,
)


def parse_subject(subject: str) -> dict:
    """
    Parse the NTT style subject into structured fields.
    Returns dict with keys: case_id, ticket, client, product, title, offense_id, action
    """
    if not subject:
        return {}

    m = SUBJECT_REGEX.search(subject)
    if not m:
        # fallback: try to extract CSxxxx and Offense ID
        case_match = re.search(r"(CS[\dA-Za-z-]+)", subject, re.IGNORECASE)
        off_match = re.search(r"Offense\s*ID[:\-]?\s*(\d+)", subject, re.IGNORECASE)
        return {
            "case_id": case_match.group(1) if case_match else None,
            "ticket": None,
            "client": None,
            "product": None,
            "title": subject,
            "offense_id": off_match.group(1) if off_match else None,
            "action": None,
        }

    return {
        "case_id": m.group("case"),
        "ticket": (m.group("ticket") or "").strip() or None,
        "client": (m.group("client") or "").strip() if m.group("client") else None,
        "product": (m.group("product") or "").strip() if m.group("product") else None,
        "title": (m.group("title") or "").strip(),
        "offense_id": m.group("offense"),
        "action": (m.group("action") or "").strip() if m.group("action") else None,
    }


def email_to_incident(email):
    """
    Convert an email dict (subject, date, from, body, id) to an incident dict.
    """
    parsed = parse_subject(email.get("subject", ""))
    now = email.get("date") or datetime.utcnow().isoformat()

    incident = {
        "caseId": parsed.get("case_id") or f"CS-{email.get('id')[:8]}",
        "ticket": parsed.get("ticket"),
        "client": parsed.get("client"),
        "product": parsed.get("product"),
        "title": parsed.get("title") or email.get("subject"),
        "offenseId": parsed.get("offense_id"),
        "action": parsed.get("action"),
        "source": email.get("from"),
        "body": email.get("body"),
        "lastUpdated": now,
        # default mappings (you can improve by inspecting body)
        "severity": "UNKNOWN",
        "status": "open",          # lowercase to match frontend union type
        "assignedAnalyst": None,
        "priorityScore": 50,
    }

    # try to infer severity from body or title
    title = incident["title"] or ""
    body = email.get("body", "") or ""

    if re.search(r"\b(critical|severe)\b", title, re.I) or re.search(r"CRITICAL", body, re.I):
        incident["severity"] = "CRITICAL"
        incident["priorityScore"] = 95
    elif re.search(r"\b(high|urgent)\b", title, re.I):
        incident["severity"] = "HIGH"
        incident["priorityScore"] = 80
    elif re.search(r"\blow\b", title, re.I):
        incident["severity"] = "LOW"
        incident["priorityScore"] = 30

    return incident
