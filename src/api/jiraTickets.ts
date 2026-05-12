/**
 * Jira Tickets API client.
 *
 * Server-backed `(messageId, rowIndex) -> jira_key` mapping. Replaces the
 * `sentinel_jira_created_keys` localStorage map -- which lived in one browser,
 * dropped on cache eviction, and let analysts double-create Jira tickets on
 * refresh.
 *
 * `createJiraTicket` is idempotent: if a Jira ticket already exists for the
 * given (messageId, rowIndex) the server returns the existing key and does
 * NOT call Jira again. This is the central duplicate-protection that makes
 * "create all" safe to retry.
 */
import { API_BASE_URL } from "./client";
import type { JiraCreatedRecord } from "./dailyAlerts";

export class JiraTicketsAuthError extends Error {
  constructor(message: string = "Authentication required") {
    super(message);
    this.name = "JiraTicketsAuthError";
  }
}

export interface CreateJiraTicketParams {
  messageId: string;
  rowIndex: number;
  summary: string;
  description: string;
  status?: string;
  incidentCategory?: string;
  closureComments?: string;
  /** Sheet "Created" timestamp (forwarded to Jira). */
  created?: string;
  /** Sheet "Closure date" (ISO or YYYY-MM-DD); becomes Jira due date. */
  closureDate?: string;
}

export interface CreateJiraTicketResponse {
  ok: true;
  /** True if the row already had a Jira ticket -- nothing was created in Jira. */
  deduped: boolean;
  ticket: JiraCreatedRecord;
  /** Raw Jira API response when a new issue was created (undefined when deduped). */
  jira?: { id?: string; key?: string; self?: string };
}

export interface LinkJiraTicketParams {
  messageId: string;
  rowIndex: number;
  jiraKey: string;
  jiraUrl?: string;
}

export interface LinkJiraTicketResponse {
  ok: true;
  alreadyLinked: boolean;
  ticket: JiraCreatedRecord;
}

export interface ImportJiraTicketsItem {
  message_id: string;
  row_index: number;
  jira_key: string;
  jira_url?: string;
}

export interface ImportJiraTicketsResponse {
  ok: true;
  imported: number;
  skippedExisting: number;
  skippedUnknownEmail: number;
  skippedInvalid: number;
  totalSubmitted: number;
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
    throw new JiraTicketsAuthError();
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

/**
 * Create a Jira issue for a (messageId, rowIndex) and persist the mapping.
 * Idempotent on the server -- subsequent calls for the same row return the
 * existing key with `deduped: true`.
 */
export async function createJiraTicket(
  params: CreateJiraTicketParams
): Promise<CreateJiraTicketResponse> {
  return call<CreateJiraTicketResponse>("/jira-tickets/create", {
    method: "POST",
    jsonBody: {
      message_id: params.messageId,
      row_index: params.rowIndex,
      summary: params.summary,
      description: params.description,
      status: params.status ?? "",
      incident_category: params.incidentCategory ?? "",
      closure_comments: params.closureComments ?? "",
      created: params.created ?? "",
      closure_date: params.closureDate ?? "",
    },
  });
}

/** Record an existing Jira key for a row (no Jira API call). */
export async function linkJiraTicket(
  params: LinkJiraTicketParams
): Promise<LinkJiraTicketResponse> {
  return call<LinkJiraTicketResponse>("/jira-tickets/link", {
    method: "POST",
    jsonBody: {
      message_id: params.messageId,
      row_index: params.rowIndex,
      jira_key: params.jiraKey,
      jira_url: params.jiraUrl,
    },
  });
}

/** Bulk import for the one-time "Import my local Jira ticket IDs" migration. */
export async function importJiraTickets(
  tickets: ImportJiraTicketsItem[]
): Promise<ImportJiraTicketsResponse> {
  return call<ImportJiraTicketsResponse>("/jira-tickets/import", {
    method: "POST",
    jsonBody: { tickets },
  });
}
