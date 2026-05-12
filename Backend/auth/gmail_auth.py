# Backend/auth/gmail_auth.py
"""
Google OAuth for Gmail read-only access.
Run backend from Backend/ so credentials.json and token.json paths resolve.
"""
import os
from typing import Optional, Tuple

from flask import redirect, request

from google_auth_oauthlib.flow import Flow
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

# `gmail.readonly` powers the existing email features.
# `userinfo.email` + `openid` let us identify which Google account signed in,
# so the backend can issue a session cookie tied to a `users` row.
SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid",
]

# Paths relative to Backend/
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CREDENTIALS_PATH = os.path.join(BACKEND_DIR, "credentials.json")
TOKEN_PATH = os.path.join(BACKEND_DIR, "token.json")

# Redirect URI must match Google Cloud Console (e.g. http://127.0.0.1:5000/api/auth/google/callback)
REDIRECT_URI_BASE = os.environ.get("GMAIL_REDIRECT_BASE", "http://127.0.0.1:5000")
REDIRECT_URI = f"{REDIRECT_URI_BASE}/api/auth/google/callback"

# Where to send user after successful OAuth (frontend; match vite.config.ts port)
FRONTEND_ORIGIN = os.environ.get("FRONTEND_ORIGIN", "http://localhost:8080")


def get_flow():
    if not os.path.exists(CREDENTIALS_PATH):
        raise FileNotFoundError(
            "credentials.json not found. Create a GCP OAuth 2.0 Client (Desktop or Web) and save it as Backend/credentials.json"
        )
    return Flow.from_client_secrets_file(
        CREDENTIALS_PATH,
        scopes=SCOPES,
        redirect_uri=REDIRECT_URI,
    )


def get_auth_url():
    flow = get_flow()
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    return auth_url


def save_token_from_callback(code: str):
    flow = get_flow()
    flow.fetch_token(code=code)
    creds = flow.credentials
    with open(TOKEN_PATH, "w") as f:
        f.write(creds.to_json())
    return True


def is_gmail_connected():
    return os.path.exists(TOKEN_PATH)


def remove_token():
    """Remove stored token so user can reconnect (e.g. after invalid_grant)."""
    if os.path.exists(TOKEN_PATH):
        try:
            os.remove(TOKEN_PATH)
        except OSError:
            pass


def _load_credentials() -> Optional[Credentials]:
    if not os.path.exists(TOKEN_PATH):
        return None
    try:
        return Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)
    except Exception:
        return None


def get_current_account_identity() -> Tuple[Optional[str], Optional[str]]:
    """
    Look up the currently-connected Google account's (email, display_name) by
    calling Gmail's `users.getProfile` (the email field is part of the userinfo
    scope we now request). Returns (None, None) if not connected or the call
    fails -- callers must handle that gracefully.
    """
    creds = _load_credentials()
    if creds is None:
        return None, None
    try:
        service = build("gmail", "v1", credentials=creds, cache_discovery=False)
        profile = service.users().getProfile(userId="me").execute()
        email = profile.get("emailAddress")
        # Gmail profile doesn't return a display name; we leave name=None and
        # let callers update it later if they fetch People API.
        return (email, None)
    except Exception as exc:
        print("get_current_account_identity failed:", exc, flush=True)
        return None, None
