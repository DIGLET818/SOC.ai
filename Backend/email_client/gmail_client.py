# email_client/gmail_client.py
import base64
import csv
import io
import os
import re
import threading
import time
from datetime import datetime, timezone
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

# Use same token path as auth (Backend/token.json when run from Backend/)
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKEN_PATH = os.path.join(BACKEND_DIR, "token.json")

_GMAIL_SERVICE = None
_GMAIL_LOCK = threading.Lock()


def _reset_gmail_service() -> None:
    global _GMAIL_SERVICE
    _GMAIL_SERVICE = None


def _get_service():
    global _GMAIL_SERVICE
    if _GMAIL_SERVICE is not None:
        return _GMAIL_SERVICE
    creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)
    _GMAIL_SERVICE = build("gmail", "v1", credentials=creds, cache_discovery=False)
    return _GMAIL_SERVICE


def _is_transient_gmail_error(exc: BaseException) -> bool:
    if isinstance(exc, (ConnectionResetError, BrokenPipeError, TimeoutError)):
        return True
    if isinstance(exc, OSError):
        winerr = getattr(exc, "winerror", None)
        if winerr in (10053, 10054, 10060, 10061):
            return True
        if exc.errno in (104, 110, 111):
            return True
    msg = str(exc).lower()
    if any(
        token in msg
        for token in (
            "connection aborted",
            "connection reset",
            "broken pipe",
            "temporarily unavailable",
            "service unavailable",
            "rate limit",
            "quota exceeded",
            "winerror 10053",
            "winerror 10054",
            "[10053]",
            "[10054]",
        )
    ):
        return True
    try:
        from googleapiclient.errors import HttpError

        if isinstance(exc, HttpError):
            status = getattr(getattr(exc, "resp", None), "status", None)
            if status in (429, 500, 502, 503, 504):
                return True
    except ImportError:
        pass
    return False


def _gmail_execute(request, retries: int = 5):
    """Run one Gmail API request; serialize access and retry transient socket errors."""
    last_exc: BaseException | None = None
    for attempt in range(retries):
        try:
            with _GMAIL_LOCK:
                return request.execute()
        except Exception as exc:
            last_exc = exc
            if not _is_transient_gmail_error(exc) or attempt >= retries - 1:
                raise
            _reset_gmail_service()
            delay = 0.6 * (2**attempt)
            print(
                f"gmail execute retry {attempt + 1}/{retries - 1}: {exc}",
                flush=True,
            )
            time.sleep(delay)
    if last_exc is not None:
        raise last_exc
    raise RuntimeError("gmail execute failed without exception")


def is_transient_gmail_error(exc: BaseException) -> bool:
    """Public helper for route-level retries."""
    return _is_transient_gmail_error(exc)

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
    att = _gmail_execute(
        service.users().messages().attachments().get(
            userId=user_id,
            messageId=message_id,
            id=attachment_id,
        )
    )
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


def _list_message_ids(service, query: str, max_results: int) -> list[str]:
    """Gmail messages.list — returns up to max_results unique message ids (newest first per Gmail)."""
    max_results = max(1, min(int(max_results), 2500))
    seen_ids: set[str] = set()
    message_ids: list[str] = []
    page_token = None
    while len(message_ids) < max_results:
        page_size = min(500, max_results - len(message_ids))
        kwargs = {"userId": "me", "q": query, "maxResults": page_size}
        if page_token:
            kwargs["pageToken"] = page_token
        resp = _gmail_execute(service.users().messages().list(**kwargs))
        batch = resp.get("messages") or []
        for msg in batch:
            mid = msg.get("id")
            if mid and mid not in seen_ids:
                seen_ids.add(mid)
                message_ids.append(mid)
            if len(message_ids) >= max_results:
                break
        page_token = resp.get("nextPageToken")
        if not page_token or not batch:
            break
    return message_ids


def _fetch_message_item(service, msg_id: str, include_csv_attachments: bool = False) -> dict:
    """Fetch one Gmail message and normalize to the fetch_recent_alerts item shape."""
    m = _gmail_execute(
        service.users().messages().get(userId="me", id=msg_id, format="full")
    )

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
    return item


GMAIL_MESSAGE_FETCH_DELAY_S = 0.12


def _fetch_message_item_resilient(
    service, msg_id: str, include_csv_attachments: bool = False
) -> dict:
    """Fetch one message; retry the whole message on transient socket errors."""
    last_exc: BaseException | None = None
    for attempt in range(4):
        try:
            return _fetch_message_item(service, msg_id, include_csv_attachments)
        except Exception as exc:
            last_exc = exc
            if not _is_transient_gmail_error(exc) or attempt >= 3:
                raise
            _reset_gmail_service()
            time.sleep(0.5 * (2**attempt))
    if last_exc is not None:
        raise last_exc
    raise RuntimeError("message fetch failed without exception")


def fetch_recent_alerts(query="subject:Case OR subject:Offense", max_results=50, include_csv_attachments=False):
    """
    Returns list of emails with keys: id, subject, date, from, body, bodyHtml, internalDate.
    Extracts both text/plain and text/html so HTML emails (e.g. NTT) show content.
    Paginates Gmail messages.list (max 500 per page) until max_results or no nextPageToken.
    """
    max_results = max(1, min(int(max_results), 2500))
    print("fetch_recent_alerts: start", query, max_results, flush=True)
    service = _get_service()
    message_ids = _list_message_ids(service, query, max_results)
    results = []
    for i, msg_id in enumerate(message_ids):
        results.append(_fetch_message_item_resilient(service, msg_id, include_csv_attachments))
        if i < len(message_ids) - 1:
            time.sleep(GMAIL_MESSAGE_FETCH_DELAY_S)
    print("fetch_recent_alerts: end, emails:", len(results), flush=True)
    return results


# Lighter cap for /api/gmail/latest-status — each hit fetches full bodies; 30× per row overloads Flask.
GMAIL_LATEST_STATUS_MAX_MESSAGES = 10


def fetch_recent_alerts_for_status(query: str, max_results: int = GMAIL_LATEST_STATUS_MAX_MESSAGES) -> list:
    """Same shape as fetch_recent_alerts but capped for closure-status scans."""
    cap = max(1, min(int(max_results), GMAIL_LATEST_STATUS_MAX_MESSAGES))
    print("fetch_recent_alerts_for_status: start", query, cap, flush=True)
    service = _get_service()
    message_ids = _list_message_ids(service, query, cap)
    results = []
    for i, msg_id in enumerate(message_ids):
        results.append(_fetch_message_item_resilient(service, msg_id, False))
        if i < len(message_ids) - 1:
            time.sleep(GMAIL_MESSAGE_FETCH_DELAY_S)
    print("fetch_recent_alerts_for_status: end, emails:", len(results), flush=True)
    return results


_STOPWORDS = frozenset({
    "the", "a", "an", "on", "in", "of", "to", "for", "and", "or", "is", "are", "was", "were",
    "be", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "shall", "can", "need", "via", "from", "with", "by", "at",
    "as", "if", "it", "its", "this", "that", "these", "those", "not", "no", "any", "all", "each",
})


def distinctive_rule_text(rule_name: str) -> str:
    """
    Strip shared customer / tenant id and optional org prefix so each rule maps to its own title.
    Example: "125850341 - Policy Bazaar - Abnormal ..." -> "Abnormal ...".
    The numeric prefix is often identical for all rules for one customer — do not use it as the only token.
    """
    name = (rule_name or "").strip()
    if not name:
        return ""
    s = re.sub(r"^\d{5,}\s*[-–—]\s*", "", name, count=1)
    s = re.sub(r"^Policy\s+Bazaar\s*[-–—]\s*", "", s, flags=re.IGNORECASE)
    s = re.sub(r"^Policy\s+Bazar\s*[-–—]\s*", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\s+", " ", s).strip()
    return s if s else name


def gmail_keyword_fragment(distinctive: str) -> str:
    """
    Space-separated terms for Gmail search (implicit AND). Fewer terms = broader candidate set;
    subject filtering then ties each message to the right rule.
    """
    if not distinctive:
        return ""
    raw_words = re.findall(r"[A-Za-z0-9][A-Za-z0-9\-]*", distinctive)
    words: list[str] = []
    for w in raw_words:
        wl = w.lower()
        if len(w) < 3 and not any(ch.isdigit() for ch in w):
            continue
        if wl in _STOPWORDS:
            continue
        words.append(w)
        if len(words) >= 4:
            break
    if len(words) < 2:
        words = [w for w in raw_words if len(w) >= 2][:6]
    return " ".join(words)


def _norm_subject_for_match(text: str) -> str:
    t = (text or "").lower()
    t = re.sub(r"policy\s+bazar\b", "policy bazaar", t)
    return t


def subject_matches_distinctive(subject: str, distinctive: str) -> bool:
    """
    Loose match: a majority of significant words from the rule title must appear in the subject
    (handles spelling variants like Bazaar/Bazar by normalizing). Falls back to a prefix substring
    when subjects paraphrase the title (e.g. X-Force wording vs sheet wording).
    """
    if not subject or not distinctive:
        return False
    subj = _norm_subject_for_match(subject)
    dist_norm = _norm_subject_for_match(distinctive)
    raw_words = re.findall(r"[A-Za-z0-9][A-Za-z0-9\-]*", distinctive)
    keywords = []
    for w in raw_words:
        wl = w.lower()
        if len(w) < 4 and not any(ch.isdigit() for ch in w):
            if wl in _STOPWORDS:
                continue
        if len(w) >= 3:
            keywords.append(wl)
    if len(keywords) < 2:
        keywords = [w.lower() for w in raw_words if len(w) >= 3][:10]
    if not keywords:
        return dist_norm[:30] in subj
    matched = sum(1 for k in keywords if k in subj)
    need = max(2, (len(keywords) + 1) // 2)
    if matched >= need:
        return True
    # Long shared substring (sheet title vs subject line often overlap partially)
    if len(dist_norm) >= 24:
        for n in (min(48, len(dist_norm)), min(36, len(dist_norm)), min(24, len(dist_norm))):
            chunk = dist_norm[:n].strip()
            if len(chunk) >= 18 and chunk in subj:
                return True
    return False


def rule_search_token(rule_name: str) -> str:
    """
    Human-readable token for API/UI: distinctive rule title (shared customer id removed).
    """
    return distinctive_rule_text(rule_name)


def search_messages_light(
    query: str,
    max_results: int = 500,
    sample_n: int = 3,
    distinctive_text: str | None = None,
    max_metadata_scan: int = 250,
):
    """
    List messages matching `query` without downloading full bodies.
    If distinctive_text is set, subjects are filtered so samples/counts match that rule title
    (avoids identical hits when every rule shared the same customer id).
    Returns dict: match_count (first page), capped (more pages exist), sample_subjects, sample_ids.
    """
    service = _get_service()
    max_results = max(1, min(int(max_results), 500))
    sample_n = max(0, min(int(sample_n), 20))
    max_metadata_scan = max(10, min(int(max_metadata_scan), 500))

    resp = _gmail_execute(
        service.users().messages().list(
            userId="me",
            q=query,
            maxResults=max_results,
        )
    )

    messages = resp.get("messages", []) or []
    next_token = resp.get("nextPageToken")
    capped_list = bool(next_token)

    def fetch_subject(mid: str) -> str:
        m = _gmail_execute(
            service.users().messages().get(
                userId="me",
                id=mid,
                format="metadata",
                metadataHeaders=["Subject"],
            )
        )
        headers = (m.get("payload") or {}).get("headers", [])
        return next((h["value"] for h in headers if (h.get("name") or "").lower() == "subject"), "")

    filtered: list[tuple[str, str]] = []
    if distinctive_text and distinctive_text.strip():
        dist = distinctive_text.strip()
        for msg in messages[:max_metadata_scan]:
            mid = msg.get("id")
            if not mid:
                continue
            try:
                subj = fetch_subject(mid)
            except Exception:
                continue
            if subject_matches_distinctive(subj, dist):
                filtered.append((mid, subj))
        match_count = len(filtered)
        capped = capped_list or (len(messages) >= max_results)
        # If keyword query was too loose, match_count may still be high but samples are consistent
        sample_subjects = [s for _, s in filtered[:sample_n]]
        sample_ids = [m for m, _ in filtered[:sample_n]]
    else:
        match_count = len(messages)
        capped = capped_list
        sample_subjects = []
        sample_ids = []
        for msg in messages[:sample_n]:
            mid = msg.get("id")
            if not mid:
                continue
            subj = fetch_subject(mid)
            sample_subjects.append(subj)
            sample_ids.append(mid)

    return {
        "match_count": match_count,
        "capped_at_max": capped,
        "sample_subjects": sample_subjects,
        "sample_ids": sample_ids,
    }


_INCIDENT_ID_RE = re.compile(r"\b(INC\d+)\b", re.IGNORECASE)
_CASE_ID_RE = re.compile(r"\bCase:\s*(CS\d+)\b", re.IGNORECASE)
_CS_FALLBACK_RE = re.compile(r"\b(CS\d{5,})\b", re.IGNORECASE)


def extract_incident_id_from_text(text: str) -> str | None:
    """First ServiceNow-style INC###### in text (uppercased)."""
    m = _INCIDENT_ID_RE.search(text or "")
    return m.group(1).upper() if m else None


def extract_case_id_from_text(text: str) -> str | None:
    """Case / CS id (e.g. Case: CS14757515 or standalone CS########)."""
    raw = text or ""
    m = _CASE_ID_RE.search(raw)
    if m:
        return m.group(1).upper()
    m = _CS_FALLBACK_RE.search(raw)
    return m.group(1).upper() if m else None


def extract_ids_from_text(text: str) -> tuple[str | None, str | None]:
    """Return (INC, CS) from a single text blob."""
    return extract_incident_id_from_text(text), extract_case_id_from_text(text)


def merge_ids_from_texts(*texts: str) -> tuple[str | None, str | None]:
    """Collect first INC and first CS found across subject/body fragments."""
    inc: str | None = None
    cs: str | None = None
    for t in texts:
        if not t:
            continue
        ti, tc = extract_ids_from_text(t)
        if ti and not inc:
            inc = ti
        if tc and not cs:
            cs = tc
        if inc and cs:
            break
    return inc, cs


def mapped_month_id(inc: str | None, cs: str | None) -> str | None:
    """Value for SIEM month column: INC when present, else CS."""
    return inc or cs


def _fetch_message_body_plain(service, message_id: str, max_chars: int = 12000) -> str:
    """Plain-ish text from message body (for INC in ServiceNow digest when subject only has CS)."""
    m = _gmail_execute(
        service.users().messages().get(
            userId="me",
            id=message_id,
            format="full",
        )
    )
    payload = m.get("payload", {})
    body = ""
    body_html = ""
    parts = payload.get("parts")
    if parts:
        body, body_html = _extract_from_parts(parts, body, body_html)
        if not body and body_html:
            body = re.sub(r"<[^>]+>", " ", body_html).strip()
    else:
        b = payload.get("body", {}).get("data")
        if b:
            decoded = _decode_body(b)
            mt = (payload.get("mimeType") or "").lower()
            if mt == "text/html":
                body = re.sub(r"<[^>]+>", " ", decoded).strip()
            else:
                body = decoded
    if len(body) > max_chars:
        body = body[:max_chars]
    return body


def _internal_ms_to_iso(internal_ms) -> str | None:
    if internal_ms is None:
        return None
    try:
        ms = int(float(str(internal_ms)))
    except (ValueError, TypeError):
        return None
    if ms <= 0:
        return None
    return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def search_latest_incident_for_rule(
    query: str,
    distinctive_text: str,
    max_results: int = 80,
    max_metadata_scan: int = 60,
) -> dict:
    """
    Search Gmail for messages matching `query`, filter by rule title.
    Returns newest mapped id: INC###### when present in subject/body, else CS########.
    """
    service = _get_service()
    max_results = max(1, min(int(max_results), 500))
    max_metadata_scan = max(10, min(int(max_metadata_scan), 500))
    dist = (distinctive_text or "").strip()

    resp = _gmail_execute(
        service.users().messages().list(
            userId="me",
            q=query,
            maxResults=max_results,
        )
    )
    messages = resp.get("messages", []) or []

    best_ms = -1
    best_inc: str | None = None
    best_cs: str | None = None
    best_mapped: str | None = None
    best_subj: str | None = None
    best_date_iso: str | None = None
    scanned = 0
    bodies_fetched = 0
    max_body_fetches = 8

    def fetch_subject_and_date(mid: str) -> tuple[str, int]:
        m = _gmail_execute(
            service.users().messages().get(
                userId="me",
                id=mid,
                format="metadata",
                metadataHeaders=["Subject"],
            )
        )
        headers = (m.get("payload") or {}).get("headers", [])
        subj = next((h["value"] for h in headers if (h.get("name") or "").lower() == "subject"), "")
        internal = m.get("internalDate")
        try:
            ms = int(float(str(internal))) if internal is not None else 0
        except (ValueError, TypeError):
            ms = 0
        return subj, ms

    for msg in messages[:max_metadata_scan]:
        mid = msg.get("id")
        if not mid:
            continue
        scanned += 1
        try:
            subj, ms = fetch_subject_and_date(mid)
        except Exception:
            continue
        if dist and not subject_matches_distinctive(subj, dist):
            continue
        inc, cs = merge_ids_from_texts(subj)
        if not inc and bodies_fetched < max_body_fetches:
            try:
                body = _fetch_message_body_plain(service, mid)
                bodies_fetched += 1
                inc, cs = merge_ids_from_texts(subj, body)
            except Exception:
                pass
        mapped = mapped_month_id(inc, cs)
        if not mapped:
            continue
        if ms >= best_ms:
            best_ms = ms
            best_inc = inc
            best_cs = cs
            best_mapped = mapped
            best_subj = subj
            best_date_iso = _internal_ms_to_iso(ms)

    return {
        "latest_incident_id": best_inc,
        "latest_case_id": best_cs,
        "mapped_id": best_mapped,
        "email_date_iso": best_date_iso,
        "subject": best_subj,
        "messages_scanned": scanned,
    }


def _hit_internal_ms(hit: dict) -> int:
    """Best-effort sort key from Gmail internalDate (ms) when present on a message dict."""
    v = hit.get("internalDate")
    if v is None:
        return 0
    try:
        return int(float(str(v)))
    except (ValueError, TypeError):
        return 0


def dedupe_search_hits_by_thread(hits: list[dict]) -> list[dict]:
    """
    Collapse Gmail `messages().list()` hits to one per thread.
    When `internalDate` is present (e.g. after a full get), the newest message in each thread wins.
    Otherwise the last seen hit per threadId wins (callers may pre-sort the list).
    """
    if not hits:
        return []
    best: dict[str, dict] = {}
    order: list[str] = []
    for h in hits:
        tid = (h.get("threadId") or "").strip() or (h.get("id") or "").strip() or "_no_thread"
        cur = best.get(tid)
        if cur is None:
            best[tid] = dict(h)
            order.append(tid)
            continue
        if _hit_internal_ms(h) >= _hit_internal_ms(cur):
            best[tid] = dict(h)
        else:
            pass
    return [best[tid] for tid in order if tid in best]


def merge_thread_into_search_hit(service, user_id: str, hit: dict) -> dict:
    """
    Placeholder for thread expansion: return the hit unchanged.
    Import compatibility for code paths that merge thread messages into one search row.
    """
    _ = service
    _ = user_id
    return dict(hit)
