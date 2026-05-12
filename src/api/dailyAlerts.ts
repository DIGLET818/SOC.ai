/**
 * Daily Alerts API client.
 *
 * Talks to the new DB-backed pipeline at /api/daily-alerts/*. Same shape and
 * conventions as /api/weekly-reports/*; a separate file so the two pages can
 * evolve independently without leaking types between them.
 *
 * All calls include the session cookie so the browser is authenticated as the
 * Google account that completed OAuth (workspace rule: PII responses must
 * require strong auth).
 */
import { API_BASE_URL } from "./client";
import type { CsvAttachment, GmailMessage } from "@/types/gmail";

/** Override fields recognised by the server. */
export type DailyOverrideField = "status" | "closure_comment" | "closure_date";

export interface DailyOverrideRecord {
  messageId: string;
  rowIndex: number;
  status: string | null;
  closure_comment: string | null;
  closure_date: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface JiraCreatedRecord {
  messageId: string;
  rowIndex: number;
  jiraKey: string;
  jiraUrl: string | null;
  incidentId: string | null;
  servicenowTicket: string | null;
  createdBy: string | null;
  createdAt: string | null;
}

export interface DailyAlertsListResponse {
  emails: GmailMessage[];
  /** Keyed by `${messageId}-r${rowIndex}` to mirror the override map shape. */
  overrides: Record<string, DailyOverrideRecord>;
  /** Same key shape -- O(1) lookup of "does this row already have a Jira ticket". */
  jiraCreated: Record<string, JiraCreatedRecord>;
}

export interface DailyAlertsSyncResponse {
  ok: true;
  syncedEmails: number;
  insertedEmails: number;
  updatedEmails: number;
  insertedRows: number;
  skippedNoCsv: number;
}

export interface DailyOverrideImportItem {
  message_id: string;
  row_index: number;
  field: DailyOverrideField;
  value: string;
}

export interface DailyOverrideImportResponse {
  ok: true;
  imported: number;
  skippedExisting: number;
  skippedUnknownEmail: number;
  skippedInvalid: number;
  totalSubmitted: number;
}

/**
 * Thrown when the server responds 401 to a daily-alerts request. Pages can
 * catch it to redirect the user back through Gmail OAuth instead of showing
 * a generic error toast.
 */
export class DailyAlertsAuthError extends Error {
  constructor(message: string = "Authentication required") {
    super(message);
    this.name = "DailyAlertsAuthError";
  }
}

async function call<T>(
  path: string,
  init: RequestInit & { jsonBody?: unknown } = {}
): Promise<T> {
  const { jsonBody, headers, ...rest } = init;
  const resp = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    credentials: "include",
    headers: {
      ...(jsonBody !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    body: jsonBody !== undefined ? JSON.stringify(jsonBody) : undefined,
  });
  if (resp.status === 401) {
    throw new DailyAlertsAuthError();
  }
  if (!resp.ok) {
    const text = await resp.text();
    let msg = text;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* keep raw text */
    }
    throw new Error(`API error (${resp.status}): ${msg}`);
  }
  const text = await resp.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

/** Fetch cached daily emails + shared overrides + jira-created mapping for [after, before). */
export async function getDailyAlerts(params: {
  afterDate: string;
  beforeDate: string;
}): Promise<DailyAlertsListResponse> {
  const { afterDate, beforeDate } = params;
  const qs = new URLSearchParams({ after: afterDate, before: beforeDate });
  const raw = await call<DailyAlertsListResponse>(`/daily-alerts?${qs.toString()}`, {
    method: "GET",
  });
  raw.emails = (raw.emails ?? []).map((e) => ({
    ...e,
    subject: e.subject ?? "",
    from: e.from ?? "",
    date: e.date ?? "",
    body: e.body ?? "",
    csvAttachment: e.csvAttachment as CsvAttachment | undefined,
  }));
  raw.overrides = raw.overrides ?? {};
  raw.jiraCreated = raw.jiraCreated ?? {};
  return raw;
}

/**
 * Trigger a Gmail fetch + DB upsert for a date range. After this resolves,
 * call `getDailyAlerts` again to pull the freshly-cached rows.
 */
export async function syncDailyAlerts(params: {
  afterDate: string;
  beforeDate: string;
  maxResults?: number;
}): Promise<DailyAlertsSyncResponse> {
  return call<DailyAlertsSyncResponse>("/daily-alerts/sync", {
    method: "POST",
    jsonBody: {
      after: params.afterDate,
      before: params.beforeDate,
      max_results: params.maxResults,
    },
  });
}

/** Upsert a single override (status / closure_comment / closure_date). */
export async function upsertDailyOverride(params: {
  messageId: string;
  rowIndex: number;
  field: DailyOverrideField;
  value: string;
}): Promise<{
  ok: true;
  override: DailyOverrideRecord & { field: DailyOverrideField };
}> {
  const { messageId, rowIndex, field, value } = params;
  return call("/daily-alerts/rows/" + encodeURIComponent(messageId) + "/" + rowIndex, {
    method: "PATCH",
    jsonBody: { field, value },
  });
}

/** Bulk import for the one-time "Import my local edits" migration. */
export async function importDailyOverrides(
  overrides: DailyOverrideImportItem[]
): Promise<DailyOverrideImportResponse> {
  return call<DailyOverrideImportResponse>("/daily-alerts/overrides/import", {
    method: "POST",
    jsonBody: { overrides },
  });
}
