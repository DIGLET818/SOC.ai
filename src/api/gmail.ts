/**
 * Gmail API – used by incident management (inbox) and alerts.
 * Keeps all Gmail endpoints in one place so page components stay thin.
 */
import api, { waitForBackend } from "./client";
import type { GmailMessage } from "@/types/gmail";

/** Lookback for incident/ticket ID search; must stay ≤ backend max (`newer_than_days` in main.py, currently 450). */
export const GMAIL_INCIDENT_LOOKUP_LOOKBACK_DAYS = 400;

export interface GetGmailMessagesParams {
  from: string;
  subject?: string;
  newerThanDays?: number;
  /** When both set, fetch emails in this date range (YYYY-MM-DD). Takes precedence over newerThanDays. */
  afterDate?: string;
  beforeDate?: string;
  maxResults?: number;
  includeCsv?: boolean;
}

export async function getGmailMessages(
  params: GetGmailMessagesParams
): Promise<GmailMessage[]> {
  const { from, subject, newerThanDays = 1, afterDate, beforeDate, maxResults = 50, includeCsv } = params;
  const search = new URLSearchParams({ from, max_results: String(maxResults) });
  if (afterDate?.trim() && beforeDate?.trim()) {
    search.set("after_date", afterDate.trim());
    search.set("before_date", beforeDate.trim());
  } else {
    search.set("newer_than_days", String(newerThanDays));
  }
  if (subject?.trim()) search.set("subject", subject.trim());
  if (includeCsv) search.set("include_csv", "true");
  return api.get<GmailMessage[]>(`/gmail/messages?${search.toString()}`);
}

/** Search for latest email by text (e.g. ServicenowTicket or IncidentID); returns single message or null. */
export async function getGmailMessageBySearch(params: {
  q: string;
  from?: string;
  newerThanDays?: number;
}): Promise<GmailMessage | null> {
  const { q, from = "nttin.support@global.ntt", newerThanDays = GMAIL_INCIDENT_LOOKUP_LOOKBACK_DAYS } = params;
  if (!q.trim()) return null;
  const search = new URLSearchParams({
    q: q.trim(),
    from,
    newer_than_days: String(newerThanDays),
  });
  try {
    return await api.get<GmailMessage>(`/gmail/messages/search?${search.toString()}`);
  } catch {
    return null;
  }
}

/** Response from GET /api/gmail/latest-status: suggests status and closure comment from latest email body. */
export interface LatestStatusFromEmailResult {
  suggestedStatus: "Closed" | "Incident Auto Closed" | null;
  /** e.g. "Incident Auto Closed" or sender name when closure phrase found */
  suggestedClosureComment?: string | null;
  /** Gmail internalDate of the email used for the suggestion (ISO UTC), for Closure date column */
  matchedEmailDateIso?: string | null;
  emailId?: string;
  snippet?: string;
  foundPhrase?: string;
  error?: string;
  /** When no closure found, number of emails we scanned (for debugging). */
  emailsChecked?: number;
  /** Gmail search returned no messages for this incident/ticket token. */
  notFound?: boolean;
}

/** Fetch latest email for incident/ticket and get suggested status from body (e.g. "please close this alert"). Uses any sender so closure emails from anybody are found. */
export async function fetchLatestStatusFromEmail(params: {
  q: string;
  from?: string;
  newerThanDays?: number;
}): Promise<LatestStatusFromEmailResult> {
  const { q, from, newerThanDays = GMAIL_INCIDENT_LOOKUP_LOOKBACK_DAYS } = params;
  if (!q.trim()) {
    return { suggestedStatus: null };
  }
  const search = new URLSearchParams({
    q: q.trim(),
    newer_than_days: String(newerThanDays),
  });
  if (from?.trim()) search.set("from", from.trim());
  const res = await api.get<LatestStatusFromEmailResult>(`/gmail/latest-status?${search.toString()}`);
  return res ?? { suggestedStatus: null };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableLatestStatusError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message.toLowerCase();
  return (
    m.includes("failed to fetch") ||
    m.includes("networkerror") ||
    m.includes("load failed") ||
    m.includes("connection refused") ||
    m.includes("429") ||
    m.includes("rate") ||
    m.includes("quota") ||
    m.includes("503") ||
    m.includes("502") ||
    m.includes("timeout") ||
    m.includes("connection reset") ||
    m.includes("econnreset")
  );
}

function isBackendDownError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message.toLowerCase();
  return (
    m.includes("failed to fetch") ||
    m.includes("networkerror") ||
    m.includes("load failed") ||
    m.includes("connection refused")
  );
}

/** Retry transient Gmail / network failures during long "Fetch all" runs. */
export async function fetchLatestStatusFromEmailResilient(
  params: Parameters<typeof fetchLatestStatusFromEmail>[0],
  maxAttempts = 3
): Promise<LatestStatusFromEmailResult> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      if (attempt > 0) {
        const backoff = isBackendDownError(lastErr) ? 3000 * attempt : 400 * attempt;
        await sleep(Math.min(backoff, 10_000));
        if (isBackendDownError(lastErr)) {
          await waitForBackend(20_000, 5_000);
        }
      }
      return await fetchLatestStatusFromEmail(params);
    } catch (e) {
      lastErr = e;
      if (!isRetryableLatestStatusError(e) || attempt === maxAttempts - 1) throw e;
    }
  }
  throw lastErr;
}

export type LatestStatusBatchItem = {
  id: string;
  queries: string[];
};

export type LatestStatusBatchResult = LatestStatusFromEmailResult & {
  id: string;
  error?: string;
};

export interface LatestStatusBatchResponse {
  results: LatestStatusBatchResult[];
  error?: string;
}

/** Server-side batch closure lookup — one HTTP call processes many rows (Fetch all). */
export async function postGmailLatestStatusBatch(body: {
  items: LatestStatusBatchItem[];
  newerThanDays?: number;
}): Promise<LatestStatusBatchResponse> {
  const { items, newerThanDays = GMAIL_INCIDENT_LOOKUP_LOOKBACK_DAYS } = body;
  return api.post<LatestStatusBatchResponse>("/gmail/latest-status-batch", {
    items,
    newer_than_days: newerThanDays,
  });
}

function isRetryableBatchError(err: unknown): boolean {
  return isRetryableLatestStatusError(err);
}

/** Retry whole batch on connection drops (Flask restart / transient network). */
export async function postGmailLatestStatusBatchResilient(
  body: Parameters<typeof postGmailLatestStatusBatch>[0],
  maxAttempts = 3
): Promise<LatestStatusBatchResponse> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      if (attempt > 0) {
        await sleep(3000 * attempt);
        if (isBackendDownError(lastErr)) {
          const up = await waitForBackend(30_000, 5_000);
          if (!up) {
            throw new Error(
              "Backend unavailable. Restart python main.py in Backend/, then click Resume."
            );
          }
        }
      }
      return await postGmailLatestStatusBatch(body);
    } catch (e) {
      lastErr = e;
      if (!isRetryableBatchError(e) || attempt === maxAttempts - 1) throw e;
    }
  }
  throw lastErr;
}

/** Per-rule Gmail search result (SIEM Master ↔ mailbox analysis). */
export interface GmailRuleHitRow {
  rule_name: string;
  search_token: string;
  gmail_query: string;
  match_count: number;
  capped_at_max: boolean;
  sample_subjects: string[];
  error?: string;
}

export interface GmailRuleHitsSummary {
  rules_submitted: number;
  rules_with_hits: number;
  rules_with_zero_hits: number;
  sum_match_count_first_page: number;
}

export interface GmailRuleHitsResponse {
  after_date: string;
  before_date: string;
  from_filter: string | null;
  summary: GmailRuleHitsSummary;
  results: GmailRuleHitRow[];
}

/** Latest id per SIEM rule for each calendar month column (INC preferred, CS fallback). */
export interface SiemRuleMonthIncidentCell {
  latest_incident_id: string | null;
  latest_case_id?: string | null;
  /** Value written to the month cell: INC when found, else CS. */
  mapped_id?: string | null;
  email_date_iso?: string | null;
  subject?: string | null;
  messages_scanned?: number;
  gmail_query?: string;
  search_token?: string;
  error?: string;
}

export interface SiemRuleLatestIncidentsRow {
  rule_name: string;
  row_id: string | null;
  by_month: Record<string, SiemRuleMonthIncidentCell>;
}

export interface SiemRuleLatestIncidentsResponse {
  from_filter: string | null;
  results: SiemRuleLatestIncidentsRow[];
  lookups_performed: number;
}

export type SiemRuleLatestIncidentsItem = {
  rule_name: string;
  row_id?: string;
  months: Array<{ label: string; after_date: string; before_date: string }>;
};

/** For each rule row and month window, find the newest matching Gmail alert; map INC, else CS. */
export async function postGmailSiemRuleLatestIncidents(body: {
  items: SiemRuleLatestIncidentsItem[];
  fromFilter?: string;
}): Promise<SiemRuleLatestIncidentsResponse> {
  const { items, fromFilter } = body;
  return api.post<SiemRuleLatestIncidentsResponse>(
    "/gmail/siem-rule-latest-incidents",
    {
      items: items.map((item) => ({
        rule_name: item.rule_name,
        row_id: item.row_id,
        months: item.months,
      })),
      ...(fromFilter?.trim() ? { from_filter: fromFilter.trim() } : {}),
    },
    { credentials: "include" }
  );
}

function isNetworkFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message.toLowerCase();
  return m.includes("failed to fetch") || m.includes("networkerror") || m.includes("load failed");
}

/** Retry once on connection drops (e.g. Flask dev server reload mid-request). */
export async function postGmailSiemRuleLatestIncidentsResilient(
  body: Parameters<typeof postGmailSiemRuleLatestIncidents>[0]
): Promise<SiemRuleLatestIncidentsResponse> {
  try {
    return await postGmailSiemRuleLatestIncidents(body);
  } catch (e) {
    if (!isNetworkFetchError(e)) throw e;
    return await postGmailSiemRuleLatestIncidents(body);
  }
}

/** Map SIEM Master rule names to Gmail message counts in a date range (uses leading rule id when present). */
export async function postGmailRuleHits(body: {
  ruleNames: string[];
  afterDate: string;
  beforeDate: string;
  fromFilter?: string;
  maxResultsPerRule?: number;
  sampleN?: number;
  forceRefresh?: boolean;
}): Promise<GmailRuleHitsResponse> {
  const {
    ruleNames,
    afterDate,
    beforeDate,
    fromFilter,
    maxResultsPerRule = 500,
    sampleN = 3,
    forceRefresh = false,
  } = body;
  return api.post<GmailRuleHitsResponse>("/gmail/rule-hits", {
    rule_names: ruleNames,
    after_date: afterDate.trim(),
    before_date: beforeDate.trim(),
    ...(fromFilter?.trim() ? { from_filter: fromFilter.trim() } : {}),
    max_results_per_rule: maxResultsPerRule,
    sample_n: sampleN,
    ...(forceRefresh ? { force_refresh: true } : {}),
  });
}

/** Retry once on connection drops (Flask restart/reload mid-request). */
export async function postGmailRuleHitsResilient(
  body: Parameters<typeof postGmailRuleHits>[0]
): Promise<GmailRuleHitsResponse> {
  try {
    return await postGmailRuleHits(body);
  } catch (e) {
    if (!isNetworkFetchError(e)) throw e;
    return await postGmailRuleHits(body);
  }
}

export interface GmailRuleHitsCacheHit {
  rule_name: string;
  month_label: string;
  after_date: string;
  before_date: string;
  match_count: number;
  capped_at_max: boolean;
  cached_at?: string | null;
}

export interface GmailRuleHitsCacheBulkResponse {
  from_filter: string | null;
  hits: GmailRuleHitsCacheHit[];
}

/** Read cached mailbox hit counts from SQLite (no Gmail API). */
export async function postGmailRuleHitsCacheBulk(body: {
  windows: Array<{ month_label: string; after_date: string; before_date: string }>;
  ruleNames?: string[];
  fromFilter?: string;
}): Promise<GmailRuleHitsCacheBulkResponse> {
  const { windows, ruleNames, fromFilter } = body;
  return api.post<GmailRuleHitsCacheBulkResponse>("/gmail/rule-hits-cache/bulk", {
    windows,
    ...(ruleNames?.length ? { rule_names: ruleNames } : {}),
    ...(fromFilter?.trim() ? { from_filter: fromFilter.trim() } : {}),
  });
}
