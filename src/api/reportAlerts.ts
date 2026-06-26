/**
 * Unified PB report alerts API (daily + weekly), backed by GET /api/alerts.
 */
import { API_BASE_URL } from "./client";
import type { CsvAttachment } from "@/types/gmail";

export type ReportAlertOverrideRecord = {
  status: string | null;
  closure_comment: string | null;
  closure_date: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  sourcePerField?: Record<string, string | null>;
};

export type ReportAlertsSummary = {
  after: string;
  before: string;
  monthStart: string;
  usedDailySource: boolean;
  usedWeeklySource: boolean;
  weeklyRowsConsidered: number;
  dailyRowsConsidered: number;
  droppedOutsideRange: number;
  uniqueAlerts: number;
};

export type ReportAlertsResponse = {
  alerts: CsvAttachment;
  overrides: Record<string, ReportAlertOverrideRecord>;
  jiraCreated: Record<string, unknown>;
  summary: ReportAlertsSummary;
};

export class ReportAlertsAuthError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "ReportAlertsAuthError";
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const resp = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (resp.status === 401) throw new ReportAlertsAuthError();
  if (!resp.ok) {
    const text = await resp.text();
    let msg = text;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* keep */
    }
    throw new Error(`API error (${resp.status}): ${msg}`);
  }
  const text = await resp.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

/** Alerts whose creation date falls in [afterDate, beforeDate) (before is exclusive). */
export async function getReportAlerts(params: {
  afterDate: string;
  beforeDate: string;
}): Promise<ReportAlertsResponse> {
  const qs = new URLSearchParams({
    after: params.afterDate,
    before: params.beforeDate,
  });
  const raw = await call<ReportAlertsResponse>(`/alerts?${qs.toString()}`);
  const att = raw.alerts ?? { filename: "alerts.csv", headers: [], rows: [] };
  return {
    alerts: {
      filename: att.filename || "alerts.csv",
      headers: att.headers ?? [],
      rows: att.rows ?? [],
    },
    overrides: raw.overrides ?? {},
    jiraCreated: raw.jiraCreated ?? {},
    summary: raw.summary ?? {
      after: params.afterDate,
      before: params.beforeDate,
      monthStart: "",
      usedDailySource: false,
      usedWeeklySource: false,
      weeklyRowsConsidered: 0,
      dailyRowsConsidered: 0,
      droppedOutsideRange: 0,
      uniqueAlerts: 0,
    },
  };
}
