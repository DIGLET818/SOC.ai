/**
 * One-shot migration helper for the legacy `sentinel_daily_alerts_*` and
 * `sentinel_jira_created_keys` localStorage maps.
 *
 * Why this exists:
 *   The Daily Alerts and Jira Tickets pages used to store analyst overrides
 *   AND created-Jira-ticket keys in localStorage, scoped per browser. After
 *   the DB migration we want those edits to live on the server so they
 *   survive refreshes / restarts / browser switches. This helper finds every
 *   relevant entry currently in the user's localStorage and prepares import
 *   payloads for the new `/api/daily-alerts/overrides/import` and
 *   `/api/jira-tickets/import` endpoints.
 *
 * Key shapes the legacy code used:
 *   - JiraTickets:    `${YYYY-MM-DD}-${primaryIncidentIdFromRow(row) || "n/a"}-${servicenow || "n/a"}`
 *   - DailyAlerts:    `${gmailMessageId}-${IncidentID || "n/a"}-${ServicenowTicket || "n/a"}`
 *
 * `primaryIncidentIdFromRow` (from the old JiraTickets page) was NOT a raw
 * column read -- it extracts the first INC###### pattern from
 * IncidentID / ServicenowTicket / Title / row text and uppercases it. We
 * reproduce that exact logic here so we generate the SAME keys the legacy
 * code persisted, otherwise nothing matches and the import is a no-op.
 *
 * Each localStorage entry resolves to a (messageId, rowIndex) tuple via the
 * loaded server data. Matching is best-effort: we try strict scope match
 * first (date OR messageId), then fall back to any row whose
 * (incidentKey, servicenowKey) pair matches -- since incident IDs are
 * unique across the dataset, this safely catches cases where the original
 * scope was an old / lost messageId that no longer exists.
 *
 * The server-side import endpoints are idempotent (existing rows are NOT
 * overwritten), so importing twice or matching one localStorage entry to
 * multiple rows is safe.
 */
import type {
  DailyOverrideField,
  DailyOverrideImportItem,
} from "@/api/dailyAlerts";
import type { ImportJiraTicketsItem } from "@/api/jiraTickets";
import type { GmailMessage } from "@/types/gmail";

const STATUS_OVERRIDES_KEY = "sentinel_daily_alerts_status_overrides";
const CLOSURE_COMMENTS_OVERRIDES_KEY = "sentinel_daily_alerts_closure_comments_overrides";
const CLOSURE_DATE_OVERRIDES_KEY = "sentinel_daily_alerts_closure_date_overrides";
const JIRA_CREATED_KEYS_KEY = "sentinel_jira_created_keys";

export const LEGACY_DAILY_ALERTS_LOCALSTORAGE_KEYS = [
  STATUS_OVERRIDES_KEY,
  CLOSURE_COMMENTS_OVERRIDES_KEY,
  CLOSURE_DATE_OVERRIDES_KEY,
  JIRA_CREATED_KEYS_KEY,
] as const;

interface RowIdentity {
  messageId: string;
  rowIndex: number;
  /**
   * Lowercased identity used by JiraTickets keys (matches the legacy
   * `primaryIncidentIdFromRow` output: INC###### extracted from
   * IncidentID/ServicenowTicket/Title/row text, uppercased then lowercased
   * for comparison).
   */
  jiraIncKey: string;
  /**
   * Lowercased raw IncidentID column value -- matches the legacy DailyAlerts
   * key exactly (no INC pattern extraction, just trim).
   */
  dailyIncKey: string;
  /** Lowercased raw ServicenowTicket value or "n/a". */
  servicenowKey: string;
  /** YYYY-MM-DD of the email -- needed to resolve the JiraTickets date scope. */
  dateKey: string;
}

function safeParse(s: string | null): Record<string, string> {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function readLegacyMap(key: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return safeParse(window.localStorage.getItem(key));
  } catch {
    return {};
  }
}

function getRowValue(row: Record<string, string>, ...possibleKeys: string[]): string {
  if (!row || typeof row !== "object") return "";
  const keys = Object.keys(row);
  for (const want of possibleKeys) {
    const wantNorm = want.toLowerCase().replace(/\s/g, "");
    const found = keys.find((k) => k.toLowerCase().replace(/\s/g, "") === wantNorm);
    if (found && (row[found] ?? "").toString().trim()) {
      return (row[found] ?? "").toString().trim();
    }
  }
  return "";
}

/** First INC##### in `text`, uppercased -- mirrors legacy firstIncInText. */
function firstIncInText(text: string): string | null {
  const m = (text || "").match(/\b(INC\d+)\b/i);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Reproduces the legacy `primaryIncidentIdFromRow` from the old JiraTickets
 * page. Returns "" when nothing INC-like was found anywhere in the row.
 */
function primaryIncidentIdFromRow(row: Record<string, string>): string {
  const incCol = getRowValue(row, "IncidentID", "Incident ID");
  const snCol = getRowValue(row, "ServicenowTicket", "ServiceNow Ticket", "ServicenowT");
  let id: string | null = firstIncInText(incCol) || firstIncInText(snCol);
  if (!id) {
    id = firstIncInText(getRowValue(row, "Title", "Short description", "Shortdescription", "Number"));
  }
  if (!id) {
    const blob = Object.values(row).join("\n");
    const incs = [...blob.matchAll(/\b(INC\d+)\b/gi)].map((m) => m[1].toUpperCase());
    const uniq = [...new Set(incs)];
    if (uniq.length >= 1) id = uniq[0];
  }
  return id ?? "";
}

function emailDateKey(email: GmailMessage): string {
  const internal = email.internalDate;
  let ts = 0;
  if (internal) {
    const n = Number(internal);
    if (!Number.isNaN(n)) ts = n;
  }
  if (!ts && email.date) {
    const d = new Date(email.date);
    if (!Number.isNaN(d.getTime())) ts = d.getTime();
  }
  if (!ts) return "";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function buildRowIndex(emails: GmailMessage[]): RowIdentity[] {
  const out: RowIdentity[] = [];
  for (const email of emails) {
    const rows = email.csvAttachment?.rows ?? [];
    if (!Array.isArray(rows)) continue;
    const dateKey = emailDateKey(email);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row || typeof row !== "object") continue;
      // Prefer the row's own __rowIndex (set by the server payload) so we use
      // the SAME index the DB knows about, not just the array position.
      const explicitIdx = Number((row as Record<string, unknown>).__rowIndex);
      const rowIndex = Number.isFinite(explicitIdx) ? explicitIdx : i;
      const rawInc = getRowValue(row, "IncidentID", "Incident ID");
      const sn = getRowValue(row, "ServicenowTicket", "ServiceNow Ticket", "ServicenowT");
      const jiraInc = primaryIncidentIdFromRow(row); // pattern-extracted, uppercased
      out.push({
        messageId: email.id,
        rowIndex,
        jiraIncKey: (jiraInc || "n/a").toLowerCase(),
        dailyIncKey: (rawInc || "n/a").toLowerCase(),
        servicenowKey: (sn || "n/a").toLowerCase(),
        dateKey,
      });
    }
  }
  return out;
}

/**
 * Try to interpret the legacy key and return the row identity tuples it
 * could refer to. We try several strategies:
 *
 *   1. JiraTickets-style: `${YYYY-MM-DD}-${jiraInc}-${sn}` → strict match on
 *      `dateKey == scope` AND `jiraIncKey == inc` AND `servicenowKey == sn`.
 *   2. DailyAlerts-style: `${gmailMessageId}-${rawInc}-${sn}` → strict match
 *      on `messageId == scope` AND `dailyIncKey == inc` AND `servicenowKey == sn`.
 *   3. Fallback: relax the scope check entirely and match on (inc, sn)
 *      against either jiraIncKey or dailyIncKey. Catches cases where the
 *      original scope was a Gmail message ID we no longer have in memory
 *      (e.g. older months not loaded yet) but the incident appears again in
 *      the loaded data.
 *
 * Returns matches in the order discovered, deduped by (messageId, rowIndex).
 */
function matchLegacyKey(
  key: string,
  rowIndex: RowIdentity[]
): { matches: RowIdentity[]; parsedScope: string; parsedInc: string; parsedSn: string } {
  if (!key) return { matches: [], parsedScope: "", parsedInc: "", parsedSn: "" };
  const parts = key.split("-");
  if (parts.length < 3) {
    return { matches: [], parsedScope: "", parsedInc: "", parsedSn: "" };
  }
  // The legacy code wrote `scope-inc-sn` and neither inc nor sn typically
  // contains a hyphen, so the LAST two segments are sn and inc.
  const sn = parts[parts.length - 1];
  const inc = parts[parts.length - 2];
  const scope = parts.slice(0, parts.length - 2).join("-");
  if (!scope) {
    return { matches: [], parsedScope: "", parsedInc: inc, parsedSn: sn };
  }

  const incKey = (inc || "n/a").toLowerCase();
  const snKey = (sn || "n/a").toLowerCase();

  const seen = new Set<string>();
  const out: RowIdentity[] = [];
  const push = (r: RowIdentity) => {
    const k = `${r.messageId}#${r.rowIndex}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(r);
  };

  // Strategy 1: JiraTickets scope (date) + pattern-extracted inc.
  for (const r of rowIndex) {
    if (r.dateKey === scope && r.jiraIncKey === incKey && r.servicenowKey === snKey) {
      push(r);
    }
  }
  // Strategy 2: DailyAlerts scope (messageId) + raw column inc.
  for (const r of rowIndex) {
    if (r.messageId === scope && r.dailyIncKey === incKey && r.servicenowKey === snKey) {
      push(r);
    }
  }
  if (out.length > 0) {
    return { matches: out, parsedScope: scope, parsedInc: inc, parsedSn: sn };
  }
  // Strategy 3: relax scope -- best-effort for entries whose original scope
  // is gone (different cached message id, etc). Match on inc+sn alone using
  // EITHER inc encoding so both legacy schemes are covered.
  for (const r of rowIndex) {
    const incMatches = r.jiraIncKey === incKey || r.dailyIncKey === incKey;
    if (incMatches && r.servicenowKey === snKey) {
      push(r);
    }
  }
  return { matches: out, parsedScope: scope, parsedInc: inc, parsedSn: sn };
}

export interface LegacyMigrationCandidates {
  overrides: DailyOverrideImportItem[];
  jiraTickets: ImportJiraTicketsItem[];
  legacyEntryCounts: {
    status: number;
    closureComment: number;
    closureDate: number;
    jira: number;
  };
  unmatchedKeys: string[];
  /**
   * Diagnostic samples (first 5 of each) so a caller can console.log these
   * when matching results in 0 candidates -- helps the user (and us) see
   * exactly what shapes are in the local storage vs the loaded data.
   */
  diagnostics: {
    sampleLegacyKeys: string[];
    sampleParsed: Array<{ key: string; scope: string; inc: string; sn: string }>;
    sampleRowIdentities: RowIdentity[];
    rowsLoaded: number;
  };
}

/** Read every legacy localStorage entry and prepare server-import payloads. */
export function collectLegacyMigrationCandidates(
  emails: GmailMessage[]
): LegacyMigrationCandidates {
  const rowIndex = buildRowIndex(emails);

  const status = readLegacyMap(STATUS_OVERRIDES_KEY);
  const closureComment = readLegacyMap(CLOSURE_COMMENTS_OVERRIDES_KEY);
  const closureDate = readLegacyMap(CLOSURE_DATE_OVERRIDES_KEY);
  const jira = readLegacyMap(JIRA_CREATED_KEYS_KEY);

  const overrides: DailyOverrideImportItem[] = [];
  const unmatched = new Set<string>();
  const sampleLegacyKeys: string[] = [];
  const sampleParsed: Array<{ key: string; scope: string; inc: string; sn: string }> = [];

  const recordSample = (key: string, parsed: { parsedScope: string; parsedInc: string; parsedSn: string }) => {
    if (sampleLegacyKeys.length < 5) sampleLegacyKeys.push(key);
    if (sampleParsed.length < 5) {
      sampleParsed.push({
        key,
        scope: parsed.parsedScope,
        inc: parsed.parsedInc,
        sn: parsed.parsedSn,
      });
    }
  };

  const addOverride = (
    key: string,
    value: string,
    field: DailyOverrideField
  ) => {
    if (!value) return;
    const result = matchLegacyKey(key, rowIndex);
    if (result.matches.length === 0) {
      unmatched.add(key);
      recordSample(key, result);
      return;
    }
    for (const m of result.matches) {
      overrides.push({
        message_id: m.messageId,
        row_index: m.rowIndex,
        field,
        value,
      });
    }
  };
  for (const [k, v] of Object.entries(status)) addOverride(k, v, "status");
  for (const [k, v] of Object.entries(closureComment)) addOverride(k, v, "closure_comment");
  for (const [k, v] of Object.entries(closureDate)) addOverride(k, v, "closure_date");

  const jiraTickets: ImportJiraTicketsItem[] = [];
  for (const [k, v] of Object.entries(jira)) {
    if (!v) continue;
    const result = matchLegacyKey(k, rowIndex);
    if (result.matches.length === 0) {
      unmatched.add(k);
      recordSample(k, result);
      continue;
    }
    for (const m of result.matches) {
      jiraTickets.push({
        message_id: m.messageId,
        row_index: m.rowIndex,
        jira_key: v,
      });
    }
  }

  // De-dupe the import payloads by their respective uniqueness keys before
  // shipping them to the server. The scope-relaxed matcher in
  // `matchLegacyKey` can map one legacy key to multiple loaded rows, and
  // the same logical override can also live in two different localStorage
  // maps (e.g. a JiraTickets-style key AND a DailyAlerts-style key for the
  // same incident). The backend will dedupe again with ON CONFLICT, but
  // doing it here keeps the payload small and the post-import counts
  // honest -- "imported: 100 of 100" instead of "imported: 100 of 250
  // (150 batch-duplicates)".
  const overridesDeduped = (() => {
    const seen = new Map<string, DailyOverrideImportItem>();
    for (const o of overrides) {
      const k = `${o.message_id}#${o.row_index}#${o.field}`;
      if (!seen.has(k)) seen.set(k, o);
    }
    return [...seen.values()];
  })();
  const jiraDeduped = (() => {
    const seen = new Map<string, ImportJiraTicketsItem>();
    for (const j of jiraTickets) {
      const k = `${j.message_id}#${j.row_index}`;
      if (!seen.has(k)) seen.set(k, j);
    }
    return [...seen.values()];
  })();

  return {
    overrides: overridesDeduped,
    jiraTickets: jiraDeduped,
    legacyEntryCounts: {
      status: Object.keys(status).length,
      closureComment: Object.keys(closureComment).length,
      closureDate: Object.keys(closureDate).length,
      jira: Object.keys(jira).length,
    },
    unmatchedKeys: [...unmatched],
    diagnostics: {
      sampleLegacyKeys,
      sampleParsed,
      sampleRowIdentities: rowIndex.slice(0, 5),
      rowsLoaded: rowIndex.length,
    },
  };
}

/**
 * Scan every legacy localStorage map and return the unique YYYY-MM month
 * buckets referenced by JiraTickets-style keys (which are date-scoped:
 * `${YYYY-MM-DD}-${inc}-${sn}`).
 *
 * Used by the import flow to auto-sync every month the user has edits for
 * before attempting to match -- otherwise rows from older months aren't in
 * the DB / in memory and the matcher returns 0 candidates.
 *
 * Note: DailyAlerts-style keys (`${gmailMessageId}-${inc}-${sn}`) carry no
 * date info, so we can't extract their month from the key alone. In
 * practice the user's DailyAlerts edits cover the same months as their
 * JiraTickets edits, so syncing the JiraTickets months tends to bring the
 * DailyAlerts message ids back into memory too.
 */
export function extractLegacyMonths(): string[] {
  const months = new Set<string>();
  // Capture any leading `YYYY-MM-DD-` token, regardless of which map it came
  // from. Date-prefixed keys = JiraTickets scheme; others (Gmail message ids)
  // won't match this regex so they're silently ignored.
  const datePrefix = /^(\d{4})-(\d{2})-\d{2}-/;
  for (const mapKey of LEGACY_DAILY_ALERTS_LOCALSTORAGE_KEYS) {
    const map = readLegacyMap(mapKey);
    for (const k of Object.keys(map)) {
      const m = k.match(datePrefix);
      if (m) months.add(`${m[1]}-${m[2]}`);
    }
  }
  return [...months].sort();
}

/**
 * Compute first-day (inclusive) and first-day-of-next-month (exclusive)
 * `YYYY-MM-DD` strings for a `YYYY-MM` bucket. Suitable for the
 * `after` / `before` query params on `/api/daily-alerts*`.
 */
export function monthDateRange(yearMonth: string): { afterDate: string; beforeDate: string } | null {
  const m = yearMonth.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) return null;
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const next = new Date(Date.UTC(y, mo, 1));
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return { afterDate: fmt(first), beforeDate: fmt(next) };
}

/** True if the user has any legacy data left in localStorage. */
export function hasLegacyDailyAlertsData(): boolean {
  if (typeof window === "undefined") return false;
  for (const key of LEGACY_DAILY_ALERTS_LOCALSTORAGE_KEYS) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = safeParse(raw);
      if (Object.keys(parsed).length > 0) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

/**
 * After a successful import, optionally clear the legacy maps from this
 * browser so the banner doesn't keep showing. Caller decides when to invoke
 * this -- usually after the user clicks "Done" on the import success toast.
 */
export function clearLegacyDailyAlertsLocalStorage(): void {
  if (typeof window === "undefined") return;
  for (const key of LEGACY_DAILY_ALERTS_LOCALSTORAGE_KEYS) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
}
