# email_client/gmail_client.py
import base64
import csv
import io
import os
import re
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

# Use same token path as auth (Backend/token.json when run from Backend/)
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKEN_PATH = os.path.join(BACKEND_DIR, "token.json")


def _get_service():
    creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)
    service = build("gmail", "v1", credentials=creds)
    return service

def _decode_body(data):
    if not data:
        return ""
    return base64.urlsafe_b64decode(data).decode("utf-8", errors="ignore")


def _extract_from_parts(parts, body_plain, body_html):
    """Recursively walk MIME parts; concatenate ALL text/plain and text/html so reply content (e.g. Customer Update) is included."""
    if not parts:
        return body_plain, body_html
    for p in parts:
        mt = (p.get("mimeType") or "").lower()
        bdata = p.get("body", {}).get("data")
        if bdata:
            decoded = _decode_body(bdata)
            if mt == "text/plain":
                body_plain = (body_plain + "\n" + decoded).strip() if body_plain else decoded
            elif mt == "text/html":
                body_html = (body_html + "\n" + decoded).strip() if body_html else decoded
        if mt.startswith("multipart/") and p.get("parts"):
            body_plain, body_html = _extract_from_parts(p["parts"], body_plain, body_html)
    return body_plain, body_html


def _get_attachment(service, user_id, message_id, attachment_id):
    """Fetch attachment bytes by id."""
    att = service.users().messages().attachments().get(
        userId=user_id,
        messageId=message_id,
        id=attachment_id,
    ).execute()
    data = att.get("data")
    if not data:
        return None
    return base64.urlsafe_b64decode(data)


def _parse_csv_raw(raw, filename="attachment.csv"):
    """Parse raw bytes as CSV; return {filename, headers, rows} or None."""
    try:
        text = raw.decode("utf-8", errors="replace")
        reader = csv.reader(io.StringIO(text))
        rows_list = [r for r in reader if any(cell.strip() for cell in r)]
        if not rows_list:
            return None
        headers = [str(h).strip() or f"Col{i}" for i, h in enumerate(rows_list[0])]
        rows = []
        for r in rows_list[1:]:
            row = {}
            for i, h in enumerate(headers):
                row[h] = (r[i].strip() if i < len(r) else "")
            rows.append(row)
        return {"filename": filename, "headers": headers, "rows": rows}
    except Exception:
        return None


def _get_part_filename(part):
    """Get attachment filename from part: Gmail API top-level 'filename' or headers (filename, Content-Disposition)."""
    name = part.get("filename") or ""
    if name:
        return name.strip()
    for h in part.get("headers") or []:
        key = (h.get("name") or "").lower()
        val = (h.get("value") or "").strip()
        if key == "filename":
            return val
        if key == "content-disposition" and "filename=" in val.lower():
            # e.g. attachment; filename="PB_Daily.csv"
            match = re.search(r'filename\s*=\s*["\']?([^"\';]+)["\']?', val, re.I)
            if match:
                return match.group(1).strip()
        if key == "content-type" and "name=" in val.lower():
            match = re.search(r'name\s*=\s*["\']?([^"\';]+)["\']?', val, re.I)
            if match:
                return match.group(1).strip()
    return ""


def _find_csv_in_parts(service, user_id, message_id, parts):
    """Recursively find first .csv attachment, fetch and parse it. Returns {filename, headers, rows} or None."""
    if not parts:
        return None
    for p in parts:
        mt = (p.get("mimeType") or "").lower()
        if mt.startswith("multipart/"):
            found = _find_csv_in_parts(service, user_id, message_id, p.get("parts") or [])
            if found:
                return found
        filename = _get_part_filename(p)
        is_csv = filename.lower().endswith(".csv") or mt in ("text/csv", "application/csv")
        if not is_csv:
            continue
        if not filename:
            filename = "attachment.csv"
        body = p.get("body") or {}
        raw = None
        if body.get("attachmentId"):
            raw = _get_attachment(service, user_id, message_id, body["attachmentId"])
        elif body.get("data"):
            raw = base64.urlsafe_b64decode(body["data"])
        if not raw:
            continue
        result = _parse_csv_raw(raw, filename)
        if result:
            return result
    return None


def fetch_recent_alerts(query="subject:Case OR subject:Offense", max_results=50, include_csv_attachments=False):
    """
    Returns list of emails with keys: id, subject, date, from, body, bodyHtml, internalDate.
    Extracts both text/plain and text/html so HTML emails (e.g. NTT) show content.
    """
    print("fetch_recent_alerts: start", query, max_results, flush=True)
    service = _get_service()

    resp = service.users().messages().list(
        userId="me",
        q=query,
        maxResults=max_results,
    ).execute()

    messages = resp.get("messages", [])
    results = []

    for msg in messages:
        m = service.users().messages().get(
            userId="me",
            id=msg["id"],
            format="full",
        ).execute()

        payload = m.get("payload", {})
        headers = payload.get("headers", [])

        subject = next((h["value"] for h in headers if h["name"].lower() == "subject"), "")
        date = next((h["value"] for h in headers if h["name"].lower() == "date"), "")
        sender = next((h["value"] for h in headers if h["name"].lower() == "from"), "")

        body = ""
        body_html = ""
        parts = payload.get("parts")
        if parts:
            body, body_html = _extract_from_parts(parts, body, body_html)
            # If no plain text but we have HTML, use HTML as fallback for body (snippet)
            if not body and body_html:
                body = re.sub(r"<[^>]+>", " ", body_html).strip()
                body = (body[:500] + "…") if len(body) > 500 else body
        else:
            b = payload.get("body", {}).get("data")
            if b:
                decoded = _decode_body(b)
                mt = (payload.get("mimeType") or "").lower()
                if mt == "text/html":
                    body_html = decoded
                    body = re.sub(r"<[^>]+>", " ", body_html).strip()
                    body = (body[:500] + "…") if len(body) > 500 else body
                else:
                    body = decoded

        item = {
            "id": m.get("id"),
            "subject": subject,
            "date": date,
            "from": sender,
            "body": body,
            "bodyHtml": body_html,
            "internalDate": m.get("internalDate"),
        }
        if include_csv_attachments:
            csv_att = None
            if parts:
                csv_att = _find_csv_in_parts(service, "me", m["id"], parts)
            if not csv_att and not parts:
                # Single-part message: whole body might be CSV attachment
                payload_body = payload.get("body", {})
                att_id = payload_body.get("attachmentId")
                if att_id:
                    mt = (payload.get("mimeType") or "").lower()
                    filename = payload.get("filename") or _get_part_filename(payload) or "attachment.csv"
                    if filename.lower().endswith(".csv") or mt in ("text/csv", "application/csv"):
                        raw = _get_attachment(service, "me", m["id"], att_id)
                        if raw:
                            csv_att = _parse_csv_raw(raw, filename)
            if csv_att:
                item["csvAttachment"] = csv_att
        results.append(item)

    print("fetch_recent_alerts: end, emails:", len(results), flush=True)
    return results
