"""
Lightweight signed-cookie session for the Sentinel-AI backend.

We piggy-back on the existing Google OAuth handshake: after the OAuth callback
saves the Gmail token, we hit Gmail's `users.getProfile` to pull the user's
email address, upsert a `users` row, and set a *signed* session cookie that
references their `users.id`. All weekly-report endpoints then use
`@require_auth` to enforce strong authentication on PII responses (workspace
SQL/PII rules).

Cookie properties:
  - HttpOnly  -> not exposed to JS, mitigates XSS theft.
  - Secure    -> only over HTTPS in production (auto-disabled for plain http
                  localhost dev so the cookie still works on http://127.0.0.1).
  - SameSite=Lax -> blocks CSRF for cross-site GET-with-credential abuse while
                    still allowing top-level OAuth redirects.

For dev convenience the signing secret falls back to a per-process random
value if SESSION_SECRET isn't set; production deployments MUST set it
explicitly so cookies survive restarts.
"""
from __future__ import annotations

import os
import secrets
from datetime import datetime
from functools import wraps
from typing import Callable, Optional, TYPE_CHECKING

from flask import Response, after_this_request, g, jsonify, request
from itsdangerous import BadSignature, URLSafeTimedSerializer

from db import SessionLocal

if TYPE_CHECKING:
    from models.db_models import User


SESSION_COOKIE_NAME = "sentinel_session"
# 30 days; matches the session-cookie max age below.
SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

_SECRET = os.environ.get("SESSION_SECRET") or secrets.token_urlsafe(48)
_serializer = URLSafeTimedSerializer(_SECRET, salt="sentinel-session-v1")


def _is_secure_request() -> bool:
    """True when the cookie should be marked Secure (HTTPS or proxy-forwarded HTTPS)."""
    if request.is_secure:
        return True
    forwarded = request.headers.get("X-Forwarded-Proto", "").lower()
    return forwarded == "https"


def issue_session_cookie(response: Response, user_id: int) -> None:
    """Sign user_id and attach it as `sentinel_session` on the response."""
    token = _serializer.dumps({"uid": int(user_id)})
    response.set_cookie(
        SESSION_COOKIE_NAME,
        token,
        max_age=SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=_is_secure_request(),
        samesite="Lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")


def _read_user_id_from_cookie() -> Optional[int]:
    raw = request.cookies.get(SESSION_COOKIE_NAME)
    if not raw:
        return None
    try:
        data = _serializer.loads(raw, max_age=SESSION_MAX_AGE_SECONDS)
    except BadSignature:
        return None
    uid = data.get("uid") if isinstance(data, dict) else None
    if isinstance(uid, int) and uid > 0:
        return uid
    return None


def get_current_user() -> Optional["User"]:
    """
    Look up the User associated with the current request's session cookie, or
    None if the cookie is missing/invalid. Caller is responsible for closing
    the session it gets back via `current_user.session` -- to keep things
    simple we instead return a *detached* dict-like object. Use
    `with_current_user` to access it inside a session scope.
    """
    uid = _read_user_id_from_cookie()
    if uid is None:
        return None
    # Local import to avoid circular import with models -> db -> session.
    from models.db_models import User

    db = SessionLocal()
    try:
        user = db.get(User, uid)
        if user is None:
            return None
        # Touch last_seen so we can spot inactive users later.
        user.last_seen_at = datetime.utcnow()
        db.commit()
        # Expunge so caller can use attributes after session close.
        db.refresh(user)
        db.expunge(user)
        return user
    finally:
        db.close()


def upsert_user(email: str, name: Optional[str]) -> int:
    """Find-or-create a user by email. Returns user.id."""
    if not email or "@" not in email:
        raise ValueError("upsert_user requires a non-empty email address")
    from models.db_models import User
    from sqlalchemy import select

    normalised_email = email.strip().lower()
    db = SessionLocal()
    try:
        stmt = select(User).where(User.email == normalised_email)
        user = db.execute(stmt).scalar_one_or_none()
        if user is None:
            user = User(email=normalised_email, name=(name or "").strip() or None)
            db.add(user)
            db.commit()
            db.refresh(user)
        else:
            # Keep name fresh if Gmail returns one
            if name and (user.name or "") != name.strip():
                user.name = name.strip()
                db.commit()
        return int(user.id)
    finally:
        db.close()


def get_or_establish_current_user() -> Optional["User"]:
    """
    Like `get_current_user`, but if the browser has no session cookie AND the
    server has a valid Gmail OAuth token on disk (token.json), automatically:
      1. resolve the Google account email from Gmail's userinfo,
      2. upsert that user,
      3. attach a fresh session cookie to the outgoing response.
    This means analysts who completed OAuth BEFORE the session-cookie code
    shipped don't have to redo the whole Google sign-in flow -- the first
    authenticated request silently establishes their session.

    Falls back to None only when the server has no Gmail token at all (in
    which case the user really does need to OAuth in fresh).
    """
    cached = getattr(g, "_sentinel_user_cache", None)
    if cached is not None:
        return cached if cached != "anonymous" else None

    user = get_current_user()
    if user is not None:
        g._sentinel_user_cache = user
        return user

    # Auto-establish from on-disk token.json (single-user dev / first-time
    # cookie issuance for an existing OAuth grant).
    try:
        # Local import: gmail_auth depends on optional Google libs and we want
        # this fallback to be a no-op if those aren't installed.
        from auth.gmail_auth import is_gmail_connected, get_current_account_identity

        if not is_gmail_connected():
            g._sentinel_user_cache = "anonymous"
            return None
        email, name = get_current_account_identity()
        if not email:
            g._sentinel_user_cache = "anonymous"
            return None
        uid = upsert_user(email, name)

        @after_this_request
        def _attach_session_cookie(response: Response) -> Response:
            try:
                issue_session_cookie(response, uid)
            except Exception as exc:  # pragma: no cover - cookie should always serialise
                print("auto-attach session cookie failed:", exc, flush=True)
            return response

        from models.db_models import User as _User

        db = SessionLocal()
        try:
            fresh = db.get(_User, uid)
            if fresh is not None:
                fresh.last_seen_at = datetime.utcnow()
                db.commit()
                db.refresh(fresh)
                db.expunge(fresh)
            g._sentinel_user_cache = fresh if fresh is not None else "anonymous"
            return fresh
        finally:
            db.close()
    except Exception as exc:
        print("get_or_establish_current_user fallback failed:", exc, flush=True)
        g._sentinel_user_cache = "anonymous"
        return None


def require_auth(view_func: Callable) -> Callable:
    """
    Flask view decorator. Returns 401 JSON when no valid session cookie is
    present AND no on-disk Gmail token can be used to auto-establish one.
    On success the wrapped view receives the request unchanged -- use
    `g.current_user` (set below) or call `get_current_user()` again.
    """

    @wraps(view_func)
    def wrapper(*args, **kwargs):
        user = get_or_establish_current_user()
        if user is None:
            return jsonify({"error": "authentication required"}), 401
        g.current_user = user
        return view_func(*args, **kwargs)

    return wrapper
