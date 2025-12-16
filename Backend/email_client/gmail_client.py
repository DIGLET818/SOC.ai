# email_client/gmail_client.py
import base64
from email import message_from_bytes
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

def _get_service():
    creds = Credentials.from_authorized_user_file("token.json", SCOPES)
    service = build("gmail", "v1", credentials=creds)
    return service

def fetch_recent_alerts(query="subject:Case OR subject:Offense", max_results=50):
    """
    Returns list of emails with keys: id, subject, date, from, body, internalDate.
    Make sure you've created token.json via OAuth flow beforehand.
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
        parts = payload.get("parts")
        if parts:
            for p in parts:
                if p.get("mimeType") == "text/plain" and p.get("body", {}).get("data"):
                    data = p["body"]["data"]
                    body = base64.urlsafe_b64decode(data).decode("utf-8", errors="ignore")
                    break
        else:
            b = payload.get("body", {}).get("data")
            if b:
                body = base64.urlsafe_b64decode(b).decode("utf-8", errors="ignore")

        results.append(
            {
                "id": m.get("id"),
                "subject": subject,
                "date": date,
                "from": sender,
                "body": body,
                # needed by EmailToIncidentParser.parse_email
                "internalDate": m.get("internalDate"),
            }
        )

    print("fetch_recent_alerts: end, emails:", len(results), flush=True)
    return results
