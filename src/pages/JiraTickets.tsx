import { useMemo, useState, useCallback, useEffect } from "react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { SOCSidebar } from "@/components/SOCSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { CsvDataTable } from "@/components/CsvDataTable";
import { EmailDetailSheet } from "@/components/EmailDetailSheet";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar as CalendarIcon, RefreshCw, ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { API_BASE_URL } from "@/api/client";
import { useGmailMessages } from "@/hooks/useGmailMessages";
import { getGmailMessageBySearch, fetchLatestStatusFromEmail } from "@/api/gmail";
import { createJiraIssue, fetchJiraIssues } from "@/api/jira";
import { toast } from "@/hooks/use-toast";
import type { GmailMessage } from "@/types/gmail";
import type { CsvAttachment } from "@/types/gmail";

/** Normalize header for comparison (lowercase, no spaces). */
function norm(h: string): string {
  return h.toLowerCase().replace(/\s/g, "").replace(/-/g, "");
}

/** Find first header that matches any of the given names (case-insensitive, ignore spaces/hyphens). */
function findHeaderKey(headers: string[], ...names: string[]): string | null {
  for (const name of names) {
    const n = norm(name);
    const found = headers.find((h) => norm(h) === n);
    if (found) return found;
  }
  return null;
}

const JIRA_OUTPUT_HEADERS = [
  "Summary",
  "Status",
  "Created",
  "Incident Category",
  "Closure_Comments",
  "Closure date",
  "Description",
] as const;
const DESCRIPTION_COLUMNS = ["IncidentID", "OffenseID", "ParentID", "IsMerged", "Detected", "UpdateNotification", "Tactic", "Technique", "Kill-ChainPhase"];

/**
 * Transform PB Daily CSV into Jira ticket format (Summary, Status, Created, Incident Category, Closure_Comments, Description).
 */
function transformToJiraFormat(csv: CsvAttachment): {
  headers: string[];
  rows: Array<{ display: Record<string, string>; original: Record<string, string> }>;
} {
  const { headers, rows } = csv;
  const servicenowKey = findHeaderKey(headers, "ServicenowTicket", "ServiceNow Ticket", "ServicenowT");
  const titleKey = findHeaderKey(headers, "Title");
  const statusKey = findHeaderKey(headers, "Status");
  const createdKey = findHeaderKey(headers, "Created");
  const incidentCategoryKey = findHeaderKey(headers, "Incident Category", "IncidentCategory");
  const closureCommentsKey = findHeaderKey(headers, "Closure_Comments", "Closure Comments");
  const closureDateKey = findHeaderKey(headers, "Closure date", "Closure_Date", "ClosureDate");

  const descSourceKeys: { name: string; key: string | null }[] = DESCRIPTION_COLUMNS.map((name) => ({
    name,
    key: findHeaderKey(headers, name, name.replace(/-/g, " "), name.replace(/ /g, "")),
  }));

  const outRows: Array<{ display: Record<string, string>; original: Record<string, string> }> = [];

  for (const row of rows) {
    const servicenow = servicenowKey ? (row[servicenowKey] ?? "").trim() : "";
    const title = titleKey ? (row[titleKey] ?? "").trim() : "";
    const summary = [servicenow, title].filter(Boolean).join(" - ") || "—";

    const descParts: string[] = [];
    for (const { name, key } of descSourceKeys) {
      const value = key && row[key] != null && String(row[key]).trim() !== "" ? String(row[key]).trim() : "N/A";
      descParts.push(`${name}: ${value}`);
    }
    const description = descParts.join(", ");

    const display: Record<string, string> = {
      Summary: summary,
      Status: statusKey ? (row[statusKey] ?? "").trim() || "Open" : "Open",
      Created: createdKey ? (row[createdKey] ?? "").trim() : "",
      "Incident Category": incidentCategoryKey ? (row[incidentCategoryKey] ?? "").trim() : "",
      Closure_Comments: closureCommentsKey ? (row[closureCommentsKey] ?? "").trim() : "",
      "Closure date": closureDateKey ? (row[closureDateKey] ?? "").trim() : "",
      Description: description,
    };

    outRows.push({ display, original: row });
  }

  return { headers: [...JIRA_OUTPUT_HEADERS], rows: outRows };
}

const DAILY_ALERTS_SENDER = "PB_daily@global.ntt";
const DAILY_ALERTS_SUBJECT = "PB Daily report";
const STATUS_OVERRIDES_KEY = "sentinel_daily_alerts_status_overrides";
const CLOSURE_COMMENTS_OVERRIDES_KEY = "sentinel_daily_alerts_closure_comments_overrides";
const CLOSURE_DATE_OVERRIDES_KEY = "sentinel_daily_alerts_closure_date_overrides";
const JIRA_CREATED_KEYS_KEY = "sentinel_jira_created_keys";

function loadJiraCreatedKeys(): Record<string, string> {
  try {
    const s = localStorage.getItem(JIRA_CREATED_KEYS_KEY);
    if (s) return JSON.parse(s) as Record<string, string>;
  } catch {
    /* ignore */
  }
  return {};
}

function getMonthRange(year: number, month: number): { afterDate: string; beforeDate: string } {
  const after = new Date(year, month - 1, 1);
  const before = new Date(year, month, 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    afterDate: `${after.getFullYear()}-${pad(after.getMonth() + 1)}-${pad(after.getDate())}`,
    beforeDate: `${before.getFullYear()}-${pad(before.getMonth() + 1)}-${pad(before.getDate())}`,
  };
}

/** First 7 days of month (e.g. March 1–7) for Jira Tickets so more reports are included. */
function getFirstWeekRange(year: number, month: number): { afterDate: string; beforeDate: string } {
  const after = new Date(year, month - 1, 1);
  const before = new Date(year, month - 1, 8); // day 8 = exclusive end → days 1–7
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    afterDate: `${after.getFullYear()}-${pad(after.getMonth() + 1)}-${pad(after.getDate())}`,
    beforeDate: `${before.getFullYear()}-${pad(before.getMonth() + 1)}-${pad(before.getDate())}`,
  };
}

function loadStatusOverrides(): Record<string, string> {
  try {
    const s = localStorage.getItem(STATUS_OVERRIDES_KEY);
    if (s) return JSON.parse(s) as Record<string, string>;
  } catch {
    /* ignore */
  }
  return {};
}

function loadClosureCommentsOverrides(): Record<string, string> {
  try {
    const s = localStorage.getItem(CLOSURE_COMMENTS_OVERRIDES_KEY);
    if (s) return JSON.parse(s) as Record<string, string>;
  } catch {
    /* ignore */
  }
  return {};
}

function loadClosureDateOverrides(): Record<string, string> {
  try {
    const s = localStorage.getItem(CLOSURE_DATE_OVERRIDES_KEY);
    if (s) return JSON.parse(s) as Record<string, string>;
  } catch {
    /* ignore */
  }
  return {};
}

function parseEmailDate(email: GmailMessage): number {
  const internal = email.internalDate;
  if (internal) {
    const n = Number(internal);
    if (!Number.isNaN(n)) return n;
  }
  const d = new Date(email.date);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

/** Get YYYY-MM-DD for grouping/selecting reports by calendar day. */
function emailToDateKey(email: GmailMessage): string {
  const ts = parseEmailDate(email);
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatReportDate(email: GmailMessage): string {
  const ts = parseEmailDate(email);
  if (!ts) return email.date || "Unknown date";
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getRowValue(row: Record<string, string>, ...possibleKeys: string[]): string {
  const keys = Object.keys(row);
  for (const want of possibleKeys) {
    const found = keys.find((k) => k.toLowerCase().replace(/\s/g, "") === want.toLowerCase().replace(/\s/g, ""));
    if (found && row[found]?.trim()) return row[found].trim();
  }
  return "";
}

const STATUS_COUNTS = ["Open", "Closed", "In Progress", "Merged", "Incident Auto Closed"] as const;

function normalizeStatus(s: string): (typeof STATUS_COUNTS)[number] {
  const t = s.trim();
  const found = STATUS_COUNTS.find((opt) => opt.toLowerCase() === t.toLowerCase());
  return found ?? "Open";
}

function getRowStatus(
  row: Record<string, string>,
  headers: string[],
  getRowKey: (row: Record<string, string>) => string,
  statusOverrides: Record<string, string>
): string {
  const key = getRowKey(row);
  if (statusOverrides[key]?.trim()) return statusOverrides[key].trim();
  const statusHeader = headers.find((h) => h.toLowerCase().replace(/\s/g, "") === "status");
  const raw = statusHeader ? row[statusHeader]?.trim() : "";
  return raw || "Open";
}

function countByStatus(
  rows: Record<string, string>[],
  headers: string[],
  getRowKey: (row: Record<string, string>) => string,
  statusOverrides: Record<string, string>
): { total: number; open: number; closed: number; inProgress: number; merged: number; incidentAutoClosed: number } {
  const counts = { total: rows.length, open: 0, closed: 0, inProgress: 0, merged: 0, incidentAutoClosed: 0 };
  for (const row of rows) {
    const s = normalizeStatus(getRowStatus(row, headers, getRowKey, statusOverrides));
    if (s === "Open") counts.open++;
    else if (s === "Closed") counts.closed++;
    else if (s === "In Progress") counts.inProgress++;
    else if (s === "Merged") counts.merged++;
    else if (s === "Incident Auto Closed") counts.incidentAutoClosed++;
    else counts.open++;
  }
  return counts;
}

const now = new Date();
const currentYear = now.getFullYear();
const currentMonth = now.getMonth() + 1;

const MONTH_OPTIONS: { year: number; month: number; label: string }[] = [];
for (let i = 0; i < 12; i++) {
  const d = new Date(currentYear, currentMonth - 1 - i, 1);
  MONTH_OPTIONS.push({
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    label: d.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
  });
}

export default function JiraTickets() {
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [selectedReportDate, setSelectedReportDate] = useState<string | null>(null);
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>(() => loadStatusOverrides());
  const [closureCommentsOverrides, setClosureCommentsOverrides] = useState<Record<string, string>>(() => loadClosureCommentsOverrides());
  const [closureDateOverrides, setClosureDateOverrides] = useState<Record<string, string>>(() => loadClosureDateOverrides());
  const [createdJiraKeys, setCreatedJiraKeys] = useState<Record<string, string>>(() => loadJiraCreatedKeys());

  /** Jira Tickets uses first 7 days of month (e.g. Mar 1–7) to show more reports. */
  const { afterDate, beforeDate } = useMemo(
    () => getFirstWeekRange(selectedYear, selectedMonth),
    [selectedYear, selectedMonth]
  );

  const storageKey = useMemo(
    () => `sentinel_daily_alerts_emails_${selectedYear}_${selectedMonth}`,
    [selectedYear, selectedMonth]
  );

  const {
    emails,
    loading,
    error,
    refetch,
  } = useGmailMessages({
    from: DAILY_ALERTS_SENDER,
    subject: DAILY_ALERTS_SUBJECT,
    afterDate,
    beforeDate,
    maxResults: 100,
    enabled: false,
    includeCsv: true,
    storageKey,
    persistInLocalStorage: true,
  });

  const emailsSortedByDate = useMemo(() => {
    return [...emails].sort((a, b) => parseEmailDate(a) - parseEmailDate(b));
  }, [emails]);

  const emailsWithCsv = useMemo(
    () => emailsSortedByDate.filter((e) => e.csvAttachment?.rows?.length),
    [emailsSortedByDate]
  );

  /** Group reports by calendar date (YYYY-MM-DD); per date keep the latest email that day. */
  const reportsByDate = useMemo(() => {
    const byDate = new Map<string, GmailMessage>();
    for (const email of emailsWithCsv) {
      const key = emailToDateKey(email);
      const existing = byDate.get(key);
      if (!existing || parseEmailDate(email) > parseEmailDate(existing)) {
        byDate.set(key, email);
      }
    }
    return byDate;
  }, [emailsWithCsv]);

  /** Sorted list of dates that have at least one report (oldest first). */
  const availableDates = useMemo(() => {
    return Array.from(reportsByDate.keys()).sort();
  }, [reportsByDate]);

  /** Ensure selectedReportDate is valid when data loads; default to earliest date. */
  const effectiveReportDate = useMemo(() => {
    if (availableDates.length === 0) return null;
    if (selectedReportDate && availableDates.includes(selectedReportDate)) return selectedReportDate;
    return availableDates[0];
  }, [availableDates, selectedReportDate]);

  /** The single report for the selected date (one day's report). */
  const firstReport = useMemo(() => {
    if (!effectiveReportDate) return null;
    return reportsByDate.get(effectiveReportDate) ?? null;
  }, [effectiveReportDate, reportsByDate]);

  const getRowKey = useCallback((scope: string) => (row: Record<string, string>) => {
    const inc = getRowValue(row, "IncidentID", "Incident ID");
    const sn = getRowValue(row, "ServicenowTicket", "ServiceNow Ticket", "ServicenowT");
    return `${scope}-${inc || "n/a"}-${sn || "n/a"}`;
  }, []);

  /** Use report date as row key scope so status/closure/Jira keys persist across refresh (same date + incident = same key). */
  const rowKeyScope = effectiveReportDate ?? firstReport?.id ?? "";

  /** Suffix for row key: "-{incidentId}-{servicenow}" so we can match Jira keys saved with any scope (email id or date). */
  const getRowKeySuffix = useCallback((row: Record<string, string>) => {
    const inc = getRowValue(row, "IncidentID", "Incident ID");
    const sn = getRowValue(row, "ServicenowTicket", "ServiceNow Ticket", "ServicenowT");
    return `-${inc || "n/a"}-${sn || "n/a"}`;
  }, []);

  /** Resolved overrides/keys: use date-based key first, fall back to email-id key (status/closure) or any key with same row suffix (Jira) so data persists after refresh. */
  const { resolvedStatusOverrides, resolvedClosureCommentsOverrides, resolvedClosureDateOverrides, resolvedCreatedJiraKeys } =
    useMemo(() => {
    const status: Record<string, string> = { ...statusOverrides };
    const closure: Record<string, string> = { ...closureCommentsOverrides };
    const closureDate: Record<string, string> = { ...closureDateOverrides };
    const jira: Record<string, string> = { ...createdJiraKeys };
    if (firstReport?.csvAttachment?.rows && rowKeyScope) {
      for (const row of firstReport.csvAttachment.rows) {
        const keyDate = getRowKey(rowKeyScope)(row);
        if (!keyDate) continue;
        if (!status[keyDate] && firstReport.id && rowKeyScope !== firstReport.id) {
          const keyEmail = getRowKey(firstReport.id)(row);
          if (statusOverrides[keyEmail]) status[keyDate] = statusOverrides[keyEmail];
        }
        if (!closure[keyDate] && firstReport.id && rowKeyScope !== firstReport.id) {
          const keyEmail = getRowKey(firstReport.id)(row);
          if (closureCommentsOverrides[keyEmail]) closure[keyDate] = closureCommentsOverrides[keyEmail];
        }
        if (!closure[keyDate]) {
          const suffix = getRowKeySuffix(row);
          const matched = Object.entries(closureCommentsOverrides).find(([k]) => k.endsWith(suffix));
          if (matched) closure[keyDate] = matched[1];
        }
        if (!closureDate[keyDate] && firstReport.id && rowKeyScope !== firstReport.id) {
          const keyEmail = getRowKey(firstReport.id)(row);
          if (closureDateOverrides[keyEmail]) closureDate[keyDate] = closureDateOverrides[keyEmail];
        }
        if (!closureDate[keyDate]) {
          const suffix = getRowKeySuffix(row);
          const matched = Object.entries(closureDateOverrides).find(([k]) => k.endsWith(suffix));
          if (matched) closureDate[keyDate] = matched[1];
        }
        if (!jira[keyDate]) {
          const suffix = getRowKeySuffix(row);
          const matched = Object.entries(createdJiraKeys).find(([k]) => k.endsWith(suffix));
          if (matched) jira[keyDate] = matched[1];
        }
      }
    }
    return {
      resolvedStatusOverrides: status,
      resolvedClosureCommentsOverrides: closure,
      resolvedClosureDateOverrides: closureDate,
      resolvedCreatedJiraKeys: jira,
    };
  }, [statusOverrides, closureCommentsOverrides, closureDateOverrides, createdJiraKeys, firstReport, rowKeyScope, getRowKey, getRowKeySuffix]);

  /** One-time migrate: copy email-id–keyed (or any scope) values to date keys in localStorage so they persist after refresh. Jira keys matched by row suffix. */
  useEffect(() => {
    if (!firstReport?.csvAttachment?.rows?.length || !rowKeyScope) return;
    let statusChanged = false;
    let closureChanged = false;
    let closureDateChanged = false;
    let jiraChanged = false;
    const nextStatus = { ...statusOverrides };
    const nextClosure = { ...closureCommentsOverrides };
    const nextClosureDate = { ...closureDateOverrides };
    const nextJira = { ...createdJiraKeys };
    for (const row of firstReport.csvAttachment.rows) {
      const keyDate = getRowKey(rowKeyScope)(row);
      if (!keyDate) continue;
      if (!nextStatus[keyDate] && firstReport.id && rowKeyScope !== firstReport.id) {
        const keyEmail = getRowKey(firstReport.id)(row);
        if (nextStatus[keyEmail]) {
          nextStatus[keyDate] = nextStatus[keyEmail];
          statusChanged = true;
        }
      }
      if (!nextClosure[keyDate] && firstReport.id && rowKeyScope !== firstReport.id) {
        const keyEmail = getRowKey(firstReport.id)(row);
        if (nextClosure[keyEmail]) {
          nextClosure[keyDate] = nextClosure[keyEmail];
          closureChanged = true;
        }
      }
      if (!nextClosure[keyDate]) {
        const suffix = getRowKeySuffix(row);
        const matched = Object.entries(nextClosure).find(([k]) => k.endsWith(suffix));
        if (matched) {
          nextClosure[keyDate] = matched[1];
          closureChanged = true;
        }
      }
      if (!nextClosureDate[keyDate] && firstReport.id && rowKeyScope !== firstReport.id) {
        const keyEmail = getRowKey(firstReport.id)(row);
        if (nextClosureDate[keyEmail]) {
          nextClosureDate[keyDate] = nextClosureDate[keyEmail];
          closureDateChanged = true;
        }
      }
      if (!nextClosureDate[keyDate]) {
        const suffix = getRowKeySuffix(row);
        const matched = Object.entries(nextClosureDate).find(([k]) => k.endsWith(suffix));
        if (matched) {
          nextClosureDate[keyDate] = matched[1];
          closureDateChanged = true;
        }
      }
      if (!nextJira[keyDate]) {
        const suffix = getRowKeySuffix(row);
        const matched = Object.entries(nextJira).find(([k]) => k.endsWith(suffix));
        if (matched) {
          nextJira[keyDate] = matched[1];
          jiraChanged = true;
        }
      }
    }
    if (statusChanged) {
      try {
        localStorage.setItem(STATUS_OVERRIDES_KEY, JSON.stringify(nextStatus));
      } catch {
        /* ignore */
      }
      setStatusOverrides(nextStatus);
    }
    if (closureChanged) {
      try {
        localStorage.setItem(CLOSURE_COMMENTS_OVERRIDES_KEY, JSON.stringify(nextClosure));
      } catch {
        /* ignore */
      }
      setClosureCommentsOverrides(nextClosure);
    }
    if (closureDateChanged) {
      try {
        localStorage.setItem(CLOSURE_DATE_OVERRIDES_KEY, JSON.stringify(nextClosureDate));
      } catch {
        /* ignore */
      }
      setClosureDateOverrides(nextClosureDate);
    }
    if (jiraChanged) {
      try {
        localStorage.setItem(JIRA_CREATED_KEYS_KEY, JSON.stringify(nextJira));
      } catch {
        /* ignore */
      }
      setCreatedJiraKeys(nextJira);
    }
  }, [firstReport?.id, firstReport?.csvAttachment?.rows, rowKeyScope, getRowKey, getRowKeySuffix]); // Intentionally not depending on statusOverrides/closureCommentsOverrides/createdJiraKeys to avoid loops

  /** Table data for the selected date only (no merging across days). */
  const transformedData = useMemo(() => {
    if (!firstReport?.csvAttachment) return null;
    return transformToJiraFormat(firstReport.csvAttachment);
  }, [firstReport?.csvAttachment]);

  const csvForTable = useMemo((): CsvAttachment | null => {
    if (!transformedData || !firstReport) return null;
    return {
      filename: firstReport.csvAttachment?.filename || "jira_format.csv",
      headers: transformedData.headers,
      rows: transformedData.rows.map((r, i) => ({ ...r.display, __rowIndex: String(i) })),
    };
  }, [transformedData, firstReport]);

  const firstReportStats = useMemo(() => {
    if (!firstReport?.csvAttachment) return { total: 0, open: 0, closed: 0, inProgress: 0, merged: 0, incidentAutoClosed: 0 };
    const { headers, rows } = firstReport.csvAttachment;
    return countByStatus(rows, headers, getRowKey(rowKeyScope), resolvedStatusOverrides);
  }, [firstReport, resolvedStatusOverrides, getRowKey, rowKeyScope]);

  const handleStatusChange = useCallback((row: Record<string, string>, newStatus: string, scope: string) => {
    const key = getRowKey(scope)(row);
    setStatusOverrides((prev) => {
      const next = { ...prev, [key]: newStatus };
      try {
        localStorage.setItem(STATUS_OVERRIDES_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [getRowKey]);

  const handleClosureCommentsChange = useCallback((row: Record<string, string>, newValue: string, scope: string) => {
    const key = getRowKey(scope)(row);
    setClosureCommentsOverrides((prev) => {
      const next = { ...prev, [key]: newValue };
      try {
        localStorage.setItem(CLOSURE_COMMENTS_OVERRIDES_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [getRowKey]);

  const handleClosureDateChange = useCallback((row: Record<string, string>, newValue: string, scope: string) => {
    const key = getRowKey(scope)(row);
    setClosureDateOverrides((prev) => {
      const next = { ...prev, [key]: newValue };
      try {
        localStorage.setItem(CLOSURE_DATE_OVERRIDES_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [getRowKey]);

  const [trailEmail, setTrailEmail] = useState<GmailMessage | null>(null);
  const [trailLoading, setTrailLoading] = useState(false);
  const [jiraCreatingKey, setJiraCreatingKey] = useState<string | null>(null);
  const [fetchingStatusKey, setFetchingStatusKey] = useState<string | null>(null);
  const [fetchingAllStatus, setFetchingAllStatus] = useState(false);
  const [fetchAllProgress, setFetchAllProgress] = useState<{ current: number; total: number } | null>(null);
  const [creatingAllJira, setCreatingAllJira] = useState(false);
  const [createAllJiraProgress, setCreateAllJiraProgress] = useState<{ current: number; total: number } | null>(null);
  const [createAllConfirmOpen, setCreateAllConfirmOpen] = useState(false);
  const [createAllConfirmPayload, setCreateAllConfirmPayload] = useState<{ alreadyHave: number; toCreate: number } | null>(null);
  const [linkingExistingJira, setLinkingExistingJira] = useState(false);

  const saveJiraKey = useCallback((rowKey: string, issueKey: string) => {
    setCreatedJiraKeys((prev) => {
      const next = { ...prev, [rowKey]: issueKey };
      try {
        localStorage.setItem(JIRA_CREATED_KEYS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleCreateInJira = useCallback(async (
    displayRow: Record<string, string>,
    effectiveStatus?: string,
    rowKey?: string,
    effectiveClosureComment?: string,
    effectiveClosureDate?: string,
  ) => {
    const rowId = String((displayRow as Record<string, unknown>).__rowIndex ?? "");
    setJiraCreatingKey(rowId);
    const statusToSend = effectiveStatus ?? displayRow.Status ?? "";
    const closureToSend = (effectiveClosureComment ?? displayRow.Closure_Comments ?? "").trim();
    const closureDateToSend = (effectiveClosureDate ?? displayRow["Closure date"] ?? "").trim();
    try {
      const res = await createJiraIssue({
        summary: displayRow.Summary ?? "",
        description: displayRow.Description ?? "",
        status: statusToSend,
        created: displayRow.Created ?? "",
        incident_category: displayRow["Incident Category"] ?? "",
        closure_comments: closureToSend,
        closure_date: closureDateToSend,
      });
      const issueKey = res?.key ?? res?.id ?? "";
      if (issueKey && rowKey) saveJiraKey(rowKey, issueKey);
      toast({ title: "Created in Jira", description: `Issue ${issueKey} created.` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create Jira issue";
      toast({ title: "Jira create failed", description: msg, variant: "destructive" });
    } finally {
      setJiraCreatingKey(null);
    }
  }, [saveJiraKey]);

  const handleFetchAllLatestStatus = useCallback(async () => {
    if (!transformedData?.rows.length || !firstReport || !rowKeyScope) return;
    setFetchingAllStatus(true);
    setFetchAllProgress({ current: 0, total: transformedData.rows.length });
    let updated = 0;
    const total = transformedData.rows.length;
    try {
      for (let i = 0; i < transformedData.rows.length; i++) {
        setFetchAllProgress({ current: i + 1, total });
        const { original } = transformedData.rows[i];
        const servicenowTicket = getRowValue(original, "ServicenowTicket", "ServiceNow Ticket", "ServicenowT");
        const incidentId = getRowValue(original, "IncidentID", "Incident ID");
        const searchFirst = servicenowTicket || incidentId;
        const searchFallback = servicenowTicket ? incidentId : "";
        if (!searchFirst && !searchFallback) continue;
        try {
          let result = await fetchLatestStatusFromEmail({ q: searchFirst, newerThanDays: 30 });
          if (!result.suggestedStatus && searchFallback) {
            result = await fetchLatestStatusFromEmail({ q: searchFallback, newerThanDays: 30 });
          }
          if (result.suggestedStatus === "Closed" || result.suggestedStatus === "Incident Auto Closed") {
            const rowKey = getRowKey(rowKeyScope)(original);
            const statusToSet = result.suggestedStatus === "Incident Auto Closed" ? "Incident Auto Closed" : "Closed";
            setStatusOverrides((prev) => {
              const next = { ...prev, [rowKey]: statusToSet };
              try {
                localStorage.setItem(STATUS_OVERRIDES_KEY, JSON.stringify(next));
              } catch {
                /* ignore */
              }
              return next;
            });
            setClosureCommentsOverrides((prev) => {
              if ((prev[rowKey] ?? "").trim()) return prev;
              const closure = (result.suggestedClosureComment ?? "").trim() || "Closed from email";
              const next = { ...prev, [rowKey]: closure };
              try {
                localStorage.setItem(CLOSURE_COMMENTS_OVERRIDES_KEY, JSON.stringify(next));
              } catch {
                /* ignore */
              }
              return next;
            });
            const dateIso = (result.matchedEmailDateIso ?? "").trim();
            if (dateIso) {
              setClosureDateOverrides((prev) => {
                const next = { ...prev, [rowKey]: dateIso };
                try {
                  localStorage.setItem(CLOSURE_DATE_OVERRIDES_KEY, JSON.stringify(next));
                } catch {
                  /* ignore */
                }
                return next;
              });
            }
            updated++;
          }
        } catch {
          /* skip this row on error */
        }
      }
      toast({
        title: "Fetch all complete (this day)",
        description: `${updated} alert(s) set to Closed from email; ${total - updated} unchanged.`,
      });
    } finally {
      setFetchingAllStatus(false);
      setFetchAllProgress(null);
    }
  }, [transformedData, firstReport, rowKeyScope, getRowKey]);

  const handleCreateAllInJiraClick = useCallback(() => {
    if (!transformedData?.rows.length || !firstReport) return;
    let alreadyHave = 0;
    for (let i = 0; i < transformedData.rows.length; i++) {
      const rowKey = getRowKey(rowKeyScope)(transformedData.rows[i].original);
      if (resolvedCreatedJiraKeys[rowKey]) alreadyHave++;
    }
    const toCreate = transformedData.rows.length - alreadyHave;
    if (toCreate === 0) {
      toast({ title: "Create all in Jira", description: "All alerts for this day already have Jira tickets." });
      return;
    }
    setCreateAllConfirmPayload({ alreadyHave, toCreate });
    setCreateAllConfirmOpen(true);
  }, [transformedData, firstReport, rowKeyScope, getRowKey, resolvedCreatedJiraKeys]);

  const handleCreateAllInJiraConfirm = useCallback(async () => {
    setCreateAllConfirmOpen(false);
    if (!transformedData?.rows.length || !firstReport) return;
    const rowsToCreate = transformedData.rows.filter((r) => !resolvedCreatedJiraKeys[getRowKey(rowKeyScope)(r.original)]);
    if (rowsToCreate.length === 0) return;
    setCreatingAllJira(true);
    const total = rowsToCreate.length;
    setCreateAllJiraProgress({ current: 0, total });
    let created = 0;
    let failed = 0;
    try {
      for (let i = 0; i < rowsToCreate.length; i++) {
        setCreateAllJiraProgress({ current: i + 1, total });
        const { display, original } = rowsToCreate[i];
        const rowKey = getRowKey(rowKeyScope)(original);
        const effectiveStatus = (rowKey && resolvedStatusOverrides[rowKey]) ? resolvedStatusOverrides[rowKey] : (display.Status ?? "");
        const effectiveClosure = (rowKey && resolvedClosureCommentsOverrides[rowKey]) ? resolvedClosureCommentsOverrides[rowKey] : (display.Closure_Comments ?? "");
        const effectiveClosureDate = (rowKey && resolvedClosureDateOverrides[rowKey])
          ? resolvedClosureDateOverrides[rowKey]
          : (display["Closure date"] ?? "");
        try {
          const res = await createJiraIssue({
            summary: display.Summary ?? "",
            description: display.Description ?? "",
            status: effectiveStatus,
            created: display.Created ?? "",
            incident_category: display["Incident Category"] ?? "",
            closure_comments: effectiveClosure.trim(),
            closure_date: effectiveClosureDate.trim(),
          });
          const issueKey = res?.key ?? res?.id ?? "";
          if (issueKey && rowKey) saveJiraKey(rowKey, issueKey);
          created++;
        } catch {
          failed++;
        }
      }
      toast({
        title: "Create all in Jira complete",
        description: `${created} ticket(s) created for this day; ${failed} failed.`,
        variant: failed > 0 ? "destructive" : "default",
      });
    } finally {
      setCreatingAllJira(false);
      setCreateAllJiraProgress(null);
      setCreateAllConfirmPayload(null);
    }
  }, [transformedData, firstReport, rowKeyScope, getRowKey, resolvedStatusOverrides, resolvedClosureCommentsOverrides, resolvedClosureDateOverrides, resolvedCreatedJiraKeys, saveJiraKey]);

  const handleCreateAllInJira = useCallback(() => {
    handleCreateAllInJiraClick();
  }, [handleCreateAllInJiraClick]);

  const handleLinkExistingJiraTickets = useCallback(async () => {
    if (!transformedData?.rows.length || !rowKeyScope) return;
    setLinkingExistingJira(true);
    try {
      const issues = await fetchJiraIssues(300);
      const usedIssueKeys = new Set<string>();
      let linked = 0;
      for (const { original, display } of transformedData.rows) {
        const rowKey = getRowKey(rowKeyScope)(original);
        if (resolvedCreatedJiraKeys[rowKey]) continue;
        const incidentId = getRowValue(original, "IncidentID", "Incident ID");
        const servicenow = getRowValue(original, "ServicenowTicket", "ServiceNow Ticket", "ServicenowT");
        const summary = (display.Summary ?? "").trim();
        const match = issues.find((iss) => {
          if (usedIssueKeys.has(iss.key)) return false;
          const s = (iss.summary ?? "").toLowerCase();
          const inc = (incidentId ?? "").toLowerCase();
          const sn = (servicenow ?? "").toLowerCase();
          if (inc && s.includes(inc)) return true;
          if (sn && s.includes(sn)) return true;
          if (summary && s.includes(summary.slice(0, 20).toLowerCase())) return true;
          return false;
        });
        if (match) {
          usedIssueKeys.add(match.key);
          saveJiraKey(rowKey, match.key);
          linked++;
        }
      }
      toast({
        title: "Link existing Jira tickets",
        description: linked > 0 ? `Linked ${linked} Jira ticket(s) to alerts for this day.` : "No matching Jira tickets found. Ensure issue summaries contain the incident or ticket ID.",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to fetch Jira issues";
      toast({ title: "Link failed", description: msg, variant: "destructive" });
    } finally {
      setLinkingExistingJira(false);
    }
  }, [transformedData, rowKeyScope, getRowKey, resolvedCreatedJiraKeys, saveJiraKey]);

  const handleFetchLatestStatus = useCallback(async (originalRow: Record<string, string>) => {
    const servicenowTicket = getRowValue(originalRow, "ServicenowTicket", "ServiceNow Ticket", "ServicenowT");
    const incidentId = getRowValue(originalRow, "IncidentID", "Incident ID");
    const searchFirst = servicenowTicket || incidentId;
    const searchFallback = servicenowTicket ? incidentId : "";
    if (!searchFirst && !searchFallback) {
      toast({ title: "No ticket or incident ID", description: "This row has no ServicenowTicket or IncidentID to search.", variant: "destructive" });
      return;
    }
    const rowKey = rowKeyScope ? getRowKey(rowKeyScope)(originalRow) : "";
    setFetchingStatusKey(rowKey);
    try {
      let result = await fetchLatestStatusFromEmail({ q: searchFirst, newerThanDays: 30 });
      if (!result.suggestedStatus && searchFallback) {
        result = await fetchLatestStatusFromEmail({ q: searchFallback, newerThanDays: 30 });
      }
      if (result.error && !result.suggestedStatus) {
        const isNoEmail = /no matching email/i.test(result.error);
        toast({
          title: isNoEmail ? "No email found" : "Fetch status failed",
          description: isNoEmail
            ? "No email mentioning this incident/ticket in the last 30 days (searches all senders)."
            : result.error,
          variant: isNoEmail ? "default" : "destructive",
        });
        return;
      }
      if (
        (result.suggestedStatus === "Closed" || result.suggestedStatus === "Incident Auto Closed") &&
        rowKeyScope
      ) {
        const statusToSet = result.suggestedStatus === "Incident Auto Closed" ? "Incident Auto Closed" : "Closed";
        handleStatusChange(originalRow, statusToSet, rowKeyScope);
        const closure = (result.suggestedClosureComment ?? "").trim() || "Closed from email";
        handleClosureCommentsChange(originalRow, closure, rowKeyScope);
        const dateIso = (result.matchedEmailDateIso ?? "").trim();
        if (dateIso) {
          handleClosureDateChange(originalRow, dateIso, rowKeyScope);
        }
        toast({
          title: "Status updated from email",
          description: result.foundPhrase
            ? `Found "${result.foundPhrase}" → set to ${statusToSet}.`
            : `Latest email suggests closure → set to ${statusToSet}.`,
        });
      } else {
        const n = result.emailsChecked;
        toast({
          title: "No closure found in emails",
          description: n != null
            ? `Checked ${n} email(s) mentioning this incident; no closure phrase found. If the comment is only in ServiceNow (not in Gmail), it won't be detected.`
            : "No closure-related comment found in the emails for this incident.",
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to fetch latest status";
      toast({ title: "Fetch status failed", description: msg, variant: "destructive" });
    } finally {
      setFetchingStatusKey(null);
    }
  }, [getRowKey, handleStatusChange, handleClosureCommentsChange, handleClosureDateChange, rowKeyScope]);

  const handleAlertRowClick = useCallback(async (row: Record<string, string>) => {
    const servicenowTicket = getRowValue(row, "ServicenowTicket", "ServiceNow Ticket", "ServicenowT");
    const incidentId = getRowValue(row, "IncidentID", "Incident ID");
    const searchFirst = servicenowTicket || incidentId;
    const searchFallback = servicenowTicket ? incidentId : "";
    if (!searchFirst && !searchFallback) {
      toast({ title: "No ticket or incident ID", description: "This row has no ServicenowTicket or IncidentID to search.", variant: "destructive" });
      return;
    }
    setTrailLoading(true);
    setTrailEmail(null);
    try {
      let email: GmailMessage | null = null;
      if (searchFirst) {
        email = await getGmailMessageBySearch({ q: searchFirst, newerThanDays: 30 });
      }
      if (!email && searchFallback) {
        email = await getGmailMessageBySearch({ q: searchFallback, newerThanDays: 30 });
      }
      if (email) {
        setTrailEmail(email);
      } else {
        toast({
          title: "No matching email",
          description: `No mail trail found for ${searchFirst || searchFallback}. Try a different row.`,
          variant: "destructive",
        });
      }
    } finally {
      setTrailLoading(false);
    }
  }, []);

  return (
    <SidebarProvider>
      <SOCSidebar />
      <SidebarInset className="max-h-svh overflow-hidden flex flex-col">
        <div className="flex min-h-0 flex-1 flex-col min-w-0 overflow-hidden bg-background">
          <header className="z-10 shrink-0 border-b bg-background/95">
            <div className="flex h-16 items-center gap-4 px-6 min-w-0">
              <div className="flex items-center gap-1 rounded-md border border-input bg-background shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  disabled={selectedYear === MONTH_OPTIONS[MONTH_OPTIONS.length - 1]?.year && selectedMonth === MONTH_OPTIONS[MONTH_OPTIONS.length - 1]?.month}
                  onClick={() => {
                    const idx = MONTH_OPTIONS.findIndex((o) => o.year === selectedYear && o.month === selectedMonth);
                    if (idx >= 0 && idx < MONTH_OPTIONS.length - 1) {
                      const next = MONTH_OPTIONS[idx + 1];
                      setSelectedYear(next.year);
                      setSelectedMonth(next.month);
                    }
                  }}
                  title="Previous month"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Select
                  value={`${selectedYear}-${selectedMonth}`}
                  onValueChange={(v) => {
                    const [y, m] = v.split("-").map(Number);
                    setSelectedYear(y);
                    setSelectedMonth(m);
                  }}
                >
                  <SelectTrigger className="w-[11rem] border-0 bg-transparent shadow-none focus:ring-0">
                    <SelectValue placeholder="Select month" />
                  </SelectTrigger>
                  <SelectContent>
                    {MONTH_OPTIONS.map(({ year, month, label }) => (
                      <SelectItem key={`${year}-${month}`} value={`${year}-${month}`}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  disabled={selectedYear === currentYear && selectedMonth === currentMonth}
                  onClick={() => {
                    const idx = MONTH_OPTIONS.findIndex((o) => o.year === selectedYear && o.month === selectedMonth);
                    if (idx > 0) {
                      const next = MONTH_OPTIONS[idx - 1];
                      setSelectedYear(next.year);
                      setSelectedMonth(next.month);
                    }
                  }}
                  title="Next month"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <Button variant="outline" size="sm" onClick={refetch} disabled={loading} className="shrink-0">
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              {availableDates.length > 0 && effectiveReportDate && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-[11rem] shrink-0 justify-start text-left font-normal"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4 shrink-0 opacity-70" />
                      {(() => {
                        const d = new Date(effectiveReportDate + "T12:00:00");
                        return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
                      })()}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={effectiveReportDate ? new Date(effectiveReportDate + "T12:00:00") : undefined}
                      onSelect={(date) => {
                        if (date) {
                          const pad = (n: number) => String(n).padStart(2, "0");
                          const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
                          if (availableDates.includes(key)) setSelectedReportDate(key);
                        }
                      }}
                      defaultMonth={effectiveReportDate ? new Date(effectiveReportDate + "T12:00:00") : new Date(selectedYear, selectedMonth - 1, 1)}
                      disabled={(date) => {
                        const pad = (n: number) => String(n).padStart(2, "0");
                        const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
                        return !availableDates.includes(key);
                      }}
                    />
                    <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                      Only dates with reports are selectable.
                    </p>
                  </PopoverContent>
                </Popover>
              )}
              <div className="min-w-0">
                <h1 className="text-2xl font-bold text-foreground truncate">Jira Tickets</h1>
                <p className="text-sm text-muted-foreground truncate">
                  Select date — PB Daily from {DAILY_ALERTS_SENDER}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-auto shrink-0">
                <ThemeToggle />
                <NotificationsPanel />
              </div>
            </div>
          </header>

          {!loading && firstReport && (
            <div className="shrink-0 border-b border-border bg-background px-6 py-2 shadow-sm">
              <div className="grid grid-cols-1 max-w-xl gap-2">
                <Card className="border border-border shadow-sm bg-blue-500/5">
                  <CardContent className="p-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
                      <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide">Report date</p>
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate mb-0.5">{formatReportDate(firstReport)}</p>
                    <p className="text-lg font-bold text-foreground mb-1">Total: {firstReportStats.total} alerts</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-2 gap-y-0.5 text-xs">
                      <span className="text-muted-foreground">Open:</span>
                      <span className="font-medium text-foreground">{firstReportStats.open}</span>
                      <span className="text-muted-foreground">Closed:</span>
                      <span className="font-medium text-foreground">{firstReportStats.closed}</span>
                      <span className="text-muted-foreground">Pending:</span>
                      <span className="font-medium text-foreground">{firstReportStats.inProgress}</span>
                      <span className="text-muted-foreground">Incident Auto Closed:</span>
                      <span className="font-medium text-foreground">{firstReportStats.incidentAutoClosed}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}

          <div className="min-h-0 min-w-0 flex-1 overflow-auto">
            {error && (
              <div className="mx-6 mt-4 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center justify-between gap-4">
                <span>{error}</span>
                {(error.toLowerCase().includes("reconnect") || error.toLowerCase().includes("expired")) && (
                  <Button variant="outline" size="sm" onClick={() => { window.location.href = `${API_BASE_URL}/auth/google`; }}>
                    Reconnect Gmail
                  </Button>
                )}
              </div>
            )}

            {!loading && firstReport && csvForTable && transformedData && (
              <section className="p-6">
                <Card key={rowKeyScope || firstReport.id} className="overflow-hidden">
                  <CardHeader className="py-3 px-4 bg-muted/30 border-b">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h3 className="text-base font-semibold text-foreground">
                          Report — {formatReportDate(firstReport)} (Jira format)
                        </h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          {csvForTable.filename} • {csvForTable.rows.length} rows — Summary, Status, Created, Incident Category, Closure_Comments, Closure date, Description
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={fetchingAllStatus}
                          onClick={() => handleFetchAllLatestStatus()}
                          title="Fetch latest status from email for all alerts on this day only"
                        >
                          {fetchingAllStatus && fetchAllProgress
                            ? `Fetching… ${fetchAllProgress.current}/${fetchAllProgress.total}`
                            : "Fetch all (this day)"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={creatingAllJira}
                          onClick={() => handleCreateAllInJira()}
                          title="Create a Jira ticket for every alert on this day only"
                        >
                          {creatingAllJira && createAllJiraProgress
                            ? `Creating… ${createAllJiraProgress.current}/${createAllJiraProgress.total}`
                            : "Create all in Jira (this day)"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={linkingExistingJira}
                          onClick={() => handleLinkExistingJiraTickets()}
                          title="Fetch Jira issues from the project and link them to alerts by matching summary to incident/ticket ID"
                        >
                          {linkingExistingJira ? "Linking…" : "Link existing Jira tickets"}
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-4">
                    <CsvDataTable
                      csv={csvForTable}
                      onRowClick={(row) => {
                        const idx = Number((row as Record<string, unknown>).__rowIndex);
                        if (!Number.isNaN(idx) && transformedData.rows[idx]) {
                          handleAlertRowClick(transformedData.rows[idx].original);
                        }
                      }}
                      statusOverrides={resolvedStatusOverrides}
                      closureCommentsOverrides={resolvedClosureCommentsOverrides}
                      closureDateOverrides={resolvedClosureDateOverrides}
                      getRowKey={(row) => {
                        const idx = Number((row as Record<string, unknown>).__rowIndex);
                        if (Number.isNaN(idx) || !transformedData.rows[idx]) return "";
                        return getRowKey(rowKeyScope)(transformedData.rows[idx].original);
                      }}
                      firstColumn={{
                        header: "Jira",
                        render: (row) => {
                          const idx = Number((row as Record<string, unknown>).__rowIndex);
                          const original = Number.isNaN(idx) ? null : transformedData.rows[idx]?.original;
                          const key = original ? getRowKey(rowKeyScope)(original) : "";
                          const jiraKey = key ? resolvedCreatedJiraKeys[key] : "";
                          return <span className="font-mono text-xs">{jiraKey || "—"}</span>;
                        },
                      }}
                      leadingColumn={{
                        header: "Fetch status",
                        render: (row) => {
                          const idx = Number((row as Record<string, unknown>).__rowIndex);
                          const original = Number.isNaN(idx) ? null : transformedData.rows[idx]?.original;
                          const rowKey = original ? getRowKey(rowKeyScope)(original) : "";
                          const isFetching = fetchingStatusKey === rowKey;
                          return (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={isFetching || fetchingAllStatus}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (original) handleFetchLatestStatus(original);
                              }}
                              title="Check latest email for closure comment (e.g. please close this alert)"
                            >
                              {isFetching ? "…" : "Fetch"}
                            </Button>
                          );
                        },
                      }}
                      onStatusChange={(row, newStatus) => {
                        const idx = Number((row as Record<string, unknown>).__rowIndex);
                        if (!Number.isNaN(idx) && transformedData.rows[idx]) {
                          handleStatusChange(transformedData.rows[idx].original, newStatus, rowKeyScope);
                        }
                      }}
                      onClosureCommentsChange={(row, newValue) => {
                        const idx = Number((row as Record<string, unknown>).__rowIndex);
                        if (!Number.isNaN(idx) && transformedData.rows[idx]) {
                          handleClosureCommentsChange(transformedData.rows[idx].original, newValue, rowKeyScope);
                        }
                      }}
                      onClosureDateChange={(row, newValue) => {
                        const idx = Number((row as Record<string, unknown>).__rowIndex);
                        if (!Number.isNaN(idx) && transformedData.rows[idx]) {
                          handleClosureDateChange(transformedData.rows[idx].original, newValue, rowKeyScope);
                        }
                      }}
                      actionColumn={{
                        header: "Create in Jira",
                        render: (row) => {
                          const rowId = String((row as Record<string, unknown>).__rowIndex ?? "");
                          const idx = Number((row as Record<string, unknown>).__rowIndex);
                          const original = transformedData.rows[idx]?.original;
                          const rowKey = original ? getRowKey(rowKeyScope)(original) : "";
                          const effectiveStatus = (rowKey && resolvedStatusOverrides[rowKey]) ? resolvedStatusOverrides[rowKey] : (row.Status ?? "");
                          const isCreating = jiraCreatingKey === rowId;
                          return (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isCreating || creatingAllJira}
                              onClick={(e) => {
                                e.stopPropagation();
                                const effectiveClosure = (rowKey && resolvedClosureCommentsOverrides[rowKey]) ? resolvedClosureCommentsOverrides[rowKey] : (row.Closure_Comments ?? "");
                                const effectiveClosureDate = (rowKey && resolvedClosureDateOverrides[rowKey])
                                  ? resolvedClosureDateOverrides[rowKey]
                                  : (row["Closure date"] ?? "");
                                handleCreateInJira(row, effectiveStatus, rowKey, effectiveClosure, effectiveClosureDate);
                              }}
                            >
                              {isCreating ? "Creating…" : "Create"}
                            </Button>
                          );
                        },
                      }}
                    />
                  </CardContent>
                </Card>
              </section>
            )}

            {trailLoading && (
              <p className="px-6 text-sm text-muted-foreground">Searching for mail trail…</p>
            )}

            {!loading && emails.length > 0 && emailsWithCsv.length === 0 && (
              <p className="px-6 py-4 text-sm text-muted-foreground">
                No CSV attachments found in the loaded emails. Ensure PB Daily report emails include a .csv file.
              </p>
            )}

            {!loading && emails.length === 0 && !error && (
              <p className="px-6 py-4 text-sm text-muted-foreground">
                Select a month and click <strong>Refresh</strong> to load PB Daily reports. This page shows only the <strong>first report</strong> (earliest date) in the month.
              </p>
            )}
          </div>

          <EmailDetailSheet
            email={trailEmail}
            open={!!trailEmail}
            onClose={() => setTrailEmail(null)}
          />

          <AlertDialog open={createAllConfirmOpen} onOpenChange={setCreateAllConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Create Jira tickets for this day</AlertDialogTitle>
                <AlertDialogDescription>
                  {createAllConfirmPayload && createAllConfirmPayload.alreadyHave > 0
                    ? `${createAllConfirmPayload.alreadyHave} alert(s) already have Jira tickets. Create Jira tickets for the remaining ${createAllConfirmPayload.toCreate} alert(s)?`
                    : `Create Jira tickets for all ${createAllConfirmPayload?.toCreate ?? 0} alerts on this day?`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleCreateAllInJiraConfirm}>
                  Create
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
