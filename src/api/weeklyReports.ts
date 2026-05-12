/**
 * Weekly Reports API client.
 *
 * Talks to the new server-backed pipeline at /api/weekly-reports/*. All calls
 * include the session cookie so the browser is authenticated as the
 * Google account that completed OAuth (workspace rule: PII responses must
 * require strong auth).
 */
import { API_BASE_URL } from "./client";
import type { CsvAttachment, GmailMessage } from "@/types/gmail";

/** Override fields recognised by the server. */
export type OverrideField = "status" | "closure_comment" | "closure_date";

export interface WeeklyOverrideRecord {
  messageId: string;
  rowIndex: number;
  status: string | null;
  closure_comment: string | null;
  closure_date: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface WeeklyReportsListResponse {
  emails: GmailMessage[];
  /** Keyed by `${messageId}-r${rowIndex}` to mirror the legacy localStorage layout. */
  overrides: Record<string, WeeklyOverrideRecord>;
}

export interface SyncResponse {
  ok: true;
  syncedEmails: number;
  insertedEmails: number;
  updatedEmails: number;
  insertedRows: number;
  skippedNoCsv: number;
}

export interface ImportOverridesItem {
  message_id: string;
  row_index: number;
  field: OverrideField;
  value: string;
}

export interface ImportOverridesResponse {
  ok: true;
  imported: number;
  skippedExisting: number;
  skippedUnknownEmail: number;
  skippedInvalid: number;
  totalSubmitted: number;
}

export interface CurrentUser {
  id: number;
  email: string;
  name: string | null;
  lastSeenAt: string | null;
}

/**
 * Thrown when the server responds 401 to a weekly-reports request. Pages can
 * catch it to redirect the user back through Gmail OAuth instead of showing
 * a generic error toast.
 */
export class WeeklyReportsAuthError extends Error {
  constructor(message: string = "Authentication required") {
    super(message);
    this.name = "WeeklyReportsAuthError";
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
    throw new WeeklyReportsAuthError();
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

/** Returns the Google account currently bound to this browser session, or null on 401. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    return await call<CurrentUser>("/me", { method: "GET" });
  } catch (err) {
    if (err instanceof WeeklyReportsAuthError) return null;
    throw err;
  }
}

/** Fetch cached emails + shared overrides for a [after, before) date range (YYYY-MM-DD). */
export async function getWeeklyReports(params: {
  afterDate: string;
  beforeDate: string;
}): Promise<WeeklyReportsListResponse> {
  const { afterDate, beforeDate } = params;
  const qs = new URLSearchParams({ after: afterDate, before: beforeDate });
  const raw = await call<WeeklyReportsListResponse>(`/weekly-reports?${qs.toString()}`, {
    method: "GET",
  });
  // Server may return null fields where DB had nulls; coerce to satisfy GmailMessage type.
  raw.emails = (raw.emails ?? []).map((e) => ({
    ...e,
    subject: e.subject ?? "",
    from: e.from ?? "",
    date: e.date ?? "",
    body: e.body ?? "",
    csvAttachment: e.csvAttachment as CsvAttachment | undefined,
  }));
  raw.overrides = raw.overrides ?? {};
  return raw;
}

/**
 * Trigger a Gmail fetch + DB upsert for a date range. After this resolves,
 * call `getWeeklyReports` again to pull the freshly-cached rows.
 */
export async function syncWeeklyReports(params: {
  afterDate: string;
  beforeDate: string;
  maxResults?: number;
}): Promise<SyncResponse> {
  return call<SyncResponse>("/weekly-reports/sync", {
    method: "POST",
    jsonBody: {
      after: params.afterDate,
      before: params.beforeDate,
      max_results: params.maxResults,
    },
  });
}

/** Upsert a single override (status / closure_comment / closure_date). */
export async function upsertOverride(params: {
  messageId: string;
  rowIndex: number;
  field: OverrideField;
  value: string;
}): Promise<{ ok: true; override: WeeklyOverrideRecord & { field: OverrideField } }> {
  const { messageId, rowIndex, field, value } = params;
  return call("/weekly-reports/rows/" + encodeURIComponent(messageId) + "/" + rowIndex, {
    method: "PATCH",
    jsonBody: { field, value },
  });
}

/** Bulk import for the one-time "Import my local edits" migration. */
export async function importOverrides(
  overrides: ImportOverridesItem[]
): Promise<ImportOverridesResponse> {
  return call<ImportOverridesResponse>("/weekly-reports/overrides/import", {
    method: "POST",
    jsonBody: { overrides },
  });
}
