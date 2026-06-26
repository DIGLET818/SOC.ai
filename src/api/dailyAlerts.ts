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
import { API_BASE_URL, waitForBackend } from "./client";
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableDailySyncError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message.toLowerCase();
  return (
    m.includes("failed to fetch") ||
    m.includes("networkerror") ||
    m.includes("connection refused") ||
    m.includes("connection reset") ||
    m.includes("connection aborted") ||
    m.includes("10053") ||
    m.includes("10054") ||
    m.includes("503") ||
    m.includes("502") ||
    m.includes("429") ||
    m.includes("sync failed")
  );
}

/** Retry Daily Alerts Gmail sync when the backend or Gmail connection drops mid-run. */
export async function syncDailyAlertsResilient(
  params: Parameters<typeof syncDailyAlerts>[0],
  maxAttempts = 4
): Promise<DailyAlertsSyncResponse> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      if (attempt > 0) await sleep(2500 * attempt);
      return await syncDailyAlerts(params);
    } catch (e) {
      lastErr = e;
      if (!isRetryableDailySyncError(e) || attempt === maxAttempts - 1) throw e;
      await waitForBackend(25_000, 5_000);
    }
  }
  throw lastErr;
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

export interface RecoverDailyReportCandidate {
  messageId: string;
  subject: string | null;
  receivedDate: string | null;
  reportDate: string | null;
  rowCount: number;
}

export interface RecoverDailyReportResponse {
  ok: true;
  reportDate: string;
  searchAfter: string;
  searchBefore: string;
  assigned: boolean;
  assignedMessageId: string | null;
  candidates: RecoverDailyReportCandidate[];
  syncedEmails: number;
  skippedNoCsv: number;
}

/** Search Gmail for a late daily report and optionally assign it to a calendar day. */
export async function recoverDailyReport(params: {
  reportDate: string;
  searchDays?: number;
  messageId?: string;
}): Promise<RecoverDailyReportResponse> {
  return call<RecoverDailyReportResponse>("/daily-alerts/recover", {
    method: "POST",
    jsonBody: {
      report_date: params.reportDate,
      search_days: params.searchDays,
      message_id: params.messageId,
    },
  });
}

export async function setDailyReportDate(params: {
  messageId: string;
  reportDate: string | null;
}): Promise<{ ok: true; messageId: string; reportDate: string | null; receivedDate: string | null }> {
  return call(`/daily-alerts/emails/${encodeURIComponent(params.messageId)}/report-date`, {
    method: "PATCH",
    jsonBody: { report_date: params.reportDate },
  });
}

/** Upload parsed headers + rows (from .csv or .xlsx on the client). */
export async function uploadDailyReportData(params: {
  reportDate: string;
  filename: string;
  headers: string[];
  rows: Record<string, string>[];
  replace?: boolean;
}): Promise<{
  ok: true;
  messageId: string;
  reportDate: string;
  rowCount: number;
  insertedEmails: number;
  updatedEmails: number;
}> {
  return call("/daily-alerts/upload-data", {
    method: "POST",
    jsonBody: {
      report_date: params.reportDate,
      filename: params.filename,
      headers: params.headers,
      rows: params.rows,
      replace: params.replace ? "1" : undefined,
    },
  });
}

export async function uploadDailyReportCsv(params: {
  reportDate: string;
  file: File;
  replace?: boolean;
}): Promise<{
  ok: true;
  messageId: string;
  reportDate: string;
  rowCount: number;
  insertedEmails: number;
  updatedEmails: number;
}> {
  const form = new FormData();
  form.append("report_date", params.reportDate);
  form.append("file", params.file);
  if (params.replace) form.append("replace", "1");

  const resp = await fetch(`${API_BASE_URL}/daily-alerts/upload`, {
    method: "POST",
    credentials: "include",
    body: form,
  });
  if (resp.status === 401) throw new DailyAlertsAuthError();
  if (!resp.ok) {
    const text = await resp.text();
    let msg = text;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* keep raw */
    }
    throw new Error(`API error (${resp.status}): ${msg}`);
  }
  return JSON.parse(await resp.text()) as {
    ok: true;
    messageId: string;
    reportDate: string;
    rowCount: number;
    insertedEmails: number;
    updatedEmails: number;
  };
}
