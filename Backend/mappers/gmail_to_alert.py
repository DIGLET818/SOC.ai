# Backend/mappers/gmail_to_alert.py
"""
Map Gmail message dict to frontend Alert-like dict.
Uses defaults for fields we don't get from email so AlertsTable can render.
"""
import re
from datetime import datetime


def _parse_date(date_str: str, internal_date_ms: str) -> str:
    """Return timestamp string for frontend."""
    if internal_date_ms:
        try:
            dt = datetime.utcfromtimestamp(int(internal_date_ms) / 1000)
            return dt.strftime("%Y-%m-%d %H:%M:%S")
        except (ValueError, TypeError):
            pass
    return date_str or datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")


def _infer_severity(subject: str, body: str) -> str:
    text = (subject + " " + body).lower()
    if "critical" in text or "critical" in subject.lower():
        return "high"
    if "high" in text or "severity: high" in text:
        return "high"
    if "low" in text:
        return "low"
    return "medium"


def gmail_message_to_alert(email: dict) -> dict:
    """
    Convert one Gmail message (from fetch_recent_alerts) to frontend Alert shape.
    """
    msg_id = str(email.get("id", ""))
    subject = email.get("subject", "")
    body = (email.get("body") or "")[:500]
    from_ = email.get("from", "")
    date_str = email.get("date", "")
    internal_date = email.get("internalDate")

    timestamp = _parse_date(date_str, internal_date)
    severity = _infer_severity(subject, body)

    # Extract first email address from "Name <email@domain.com>"
    source_user = from_
    if "<" in from_ and ">" in from_:
        source_user = re.search(r"<([^>]+)>", from_).group(1) if re.search(r"<([^>]+)>", from_) else from_

    return {
        "id": f"GMAIL-{msg_id}",
        "timestamp": timestamp,
        "ruleName": subject or "Email alert",
        "sourceIp": "Email",
        "sourceUser": source_user,
        "severity": severity,
        "aiScore": 70,
        "status": "open",
        "aiSummary": body or subject,
        "recommendedActions": ["Review email content", "Check sender reputation"],
        "iocEnrichment": {
            "virusTotal": "—",
            "geoIP": "—",
            "greyNoise": "—",
            "asn": "—",
            "reputation": 0,
        },
        "timeline": [{"timestamp": timestamp, "event": subject or "Received"}],
        "ruleCategory": "malware",
        "mitreTactic": "Initial Access",
        "mitreId": "T1566",
        "sourceCountry": "—",
        "hostContext": {
            "hostname": "—",
            "criticality": "medium",
            "assetOwner": "—",
            "os": "—",
            "edrStatus": "active",
        },
        "source": "gmail",
    }
