/**
 * Gmail API – used by incident management (inbox) and alerts.
 * Keeps all Gmail endpoints in one place so page components stay thin.
 */
import api from "./client";
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

/** Map SIEM Master rule names to Gmail message counts in a date range (uses leading rule id when present). */
export async function postGmailRuleHits(body: {
  ruleNames: string[];
  afterDate: string;
  beforeDate: string;
  fromFilter?: string;
  maxResultsPerRule?: number;
  sampleN?: number;
}): Promise<GmailRuleHitsResponse> {
  const {
    ruleNames,
    afterDate,
    beforeDate,
    fromFilter,
    maxResultsPerRule = 500,
    sampleN = 3,
  } = body;
  return api.post<GmailRuleHitsResponse>("/gmail/rule-hits", {
    rule_names: ruleNames,
    after_date: afterDate.trim(),
    before_date: beforeDate.trim(),
    ...(fromFilter?.trim() ? { from_filter: fromFilter.trim() } : {}),
    max_results_per_rule: maxResultsPerRule,
    sample_n: sampleN,
  });
}
