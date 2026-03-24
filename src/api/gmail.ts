/**
 * Gmail API – used by incident management (inbox) and alerts.
 * Keeps all Gmail endpoints in one place so page components stay thin.
 */
import api from "./client";
import type { GmailMessage } from "@/types/gmail";

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
  const { q, from = "nttin.support@global.ntt", newerThanDays = 30 } = params;
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
  const { q, from, newerThanDays = 30 } = params;
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
