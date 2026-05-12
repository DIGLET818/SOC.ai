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
import { Calendar as CalendarIcon, RefreshCw, ChevronLeft, ChevronRight, FileText, DatabaseZap } from "lucide-react";
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
import { useDailyAlertsData } from "@/hooks/useDailyAlertsData";
import {
  upsertDailyOverride,
  importDailyOverrides,
  syncDailyAlerts,
  getDailyAlerts,
  type DailyOverrideRecord,
  type JiraCreatedRecord,
} from "@/api/dailyAlerts";
import {
  createJiraTicket,
  linkJiraTicket,
  importJiraTickets,
} from "@/api/jiraTickets";
import {
  getGmailMessageBySearch,
  fetchLatestStatusFromEmail,
  GMAIL_INCIDENT_LOOKUP_LOOKBACK_DAYS,
  type LatestStatusFromEmailResult,
} from "@/api/gmail";
import { fetchJiraIssues } from "@/api/jira";
import { toast } from "@/hooks/use-toast";
import type { GmailMessage } from "@/types/gmail";
import type { CsvAttachment } from "@/types/gmail";
import {
  collectLegacyMigrationCandidates,
  hasLegacyDailyAlertsData,
  clearLegacyDailyAlertsLocalStorage,
  extractLegacyMonths,
  monthDateRange,
} from "@/lib/legacyDailyAlertsMigration";

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

function getMonthRange(year: number, month: number): { afterDate: string; beforeDate: string } {
  const after = new Date(year, month - 1, 1);
  const before = new Date(year, month, 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    afterDate: `${after.getFullYear()}-${pad(after.getMonth() + 1)}-${pad(after.getDate())}`,
    beforeDate: `${before.getFullYear()}-${pad(before.getMonth() + 1)}-${pad(before.getDate())}`,
  };
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

function firstIncInText(text: string): string | null {
  const m = (text || "").match(/\b(INC\d+)\b/i);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Stable row identity (for Gmail fetch lookups + Jira-link matching).
 * Prevents every row collapsing to `n/a-n/a` when CSV columns are blank but
 * Title contains INC######.
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

/** Extra Gmail `q` tokens when IncidentID / Servicenow cells miss the thread (CS… / INC in body). */
function extraGmailIncidentQueries(row: Record<string, string>): string[] {
  const blob = [
    getRowValue(row, "Title", "Short description", "Shortdescription", "Number", "Case"),
    ...Object.values(row),
  ]
    .filter((s): s is string => typeof s === "string" && s.trim() !== "")
    .join("\n");
  const out: string[] = [];
  const cs = blob.match(/\b(CS\d{5,})\b/i);
  if (cs) out.push(cs[1]);
  const inc = blob.match(/\b(INC\d{6,})\b/i);
  if (inc) out.push(inc[1]);
  return [...new Set(out)];
}

/** `Number("")` and `Number(null)` are 0 — would map every bad row to index 0. */
function parseJiraTableRowIndex(row: Record<string, string>): number {
  const v = (row as Record<string, unknown>).__rowIndex;
  if (v === undefined || v === null || v === "") return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** Tokens to match Jira issue summary (INC# in URLs, summary prefix before " - ", etc.). */
function collectJiraLinkMatchTokens(incidentId: string, servicenow: string, displaySummary: string): string[] {
  const out = new Set<string>();
  const push = (s: string) => {
    const t = s.trim().toLowerCase();
    if (t.length >= 4) out.add(t);
  };
  const pullInc = (blob: string) => {
    const m = blob.match(/\b(INC\d+)\b/gi);
    if (m) for (const x of m) push(x);
  };
  push(incidentId);
  push(servicenow);
  pullInc(incidentId);
  pullInc(servicenow);
  const sum = displaySummary.trim();
  if (sum) {
    const head = sum.split(/\s-\s/).map((p) => p.trim()).filter(Boolean)[0];
    if (head) {
      push(head);
      pullInc(head);
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

const STATUS_COUNTS = ["Open", "Closed", "In Progress", "Pending", "Merged", "Incident Auto Closed"] as const;

function normalizeStatus(s: string): (typeof STATUS_COUNTS)[number] {
  const t = s.trim();
  const found = STATUS_COUNTS.find((opt) => opt.toLowerCase() === t.toLowerCase());
  return found ?? "Open";
}

/** DB-keyed override lookup: `${messageId}-r${rowIndex}` is the canonical key. */
function dbRowKey(messageId: string, rowIndex: number): string {
  return `${messageId}-r${rowIndex}`;
}

function getRowStatus(
  row: Record<string, string>,
  headers: string[],
  rowKey: string,
  statusOverrides: Record<string, string>
): string {
  if (statusOverrides[rowKey]?.trim()) return statusOverrides[rowKey].trim();
  const statusHeader = headers.find((h) => h.toLowerCase().replace(/\s/g, "") === "status");
  const raw = statusHeader ? row[statusHeader]?.trim() : "";
  return raw || "Open";
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

/**
 * Collapse the server's structured override records into the legacy
 * `Record<string, string>` maps that CsvDataTable expects, keyed by
 * `${messageId}-r${rowIndex}`. This keeps the table renderer untouched while
 * letting us swap out the persistence layer.
 */
function flattenOverrideMaps(
  overrides: Record<string, DailyOverrideRecord>
): {
  status: Record<string, string>;
  closureComment: Record<string, string>;
  closureDate: Record<string, string>;
} {
  const status: Record<string, string> = {};
  const closureComment: Record<string, string> = {};
  const closureDate: Record<string, string> = {};
  for (const [key, rec] of Object.entries(overrides)) {
    if (rec.status) status[key] = rec.status;
    if (rec.closure_comment) closureComment[key] = rec.closure_comment;
    if (rec.closure_date) closureDate[key] = rec.closure_date;
  }
  return { status, closureComment, closureDate };
}

function flattenJiraKeys(
  jiraCreated: Record<string, JiraCreatedRecord>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, rec] of Object.entries(jiraCreated)) {
    if (rec.jiraKey) out[key] = rec.jiraKey;
  }
  return out;
}

export default function JiraTickets() {
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [selectedReportDate, setSelectedReportDate] = useState<string | null>(null);

  /** Same full-month Gmail window as Daily Alerts so refresh never drops later days. */
  const { afterDate, beforeDate } = useMemo(
    () => getMonthRange(selectedYear, selectedMonth),
    [selectedYear, selectedMonth]
  );

  const {
    emails,
    overrides: serverOverrides,
    jiraCreated: serverJiraCreated,
    loading,
    syncing,
    error,
    currentUser,
    refetchFromGmail,
    setLocalOverride,
    setLocalJiraCreated,
    reload,
  } = useDailyAlertsData({
    afterDate,
    beforeDate,
    maxResults: 2000,
  });

  /** Auth-prompt state: the page rendered, but the server says "not signed in". */
  const isAnonymous = currentUser === "anonymous";

  /**
   * Flatten the structured server records into the legacy-shaped maps the
   * existing CsvDataTable / counting code already understands. Any change to
   * `serverOverrides` immediately reflects in the table without needing a
   * full re-render of the persistence layer.
   */
  const { resolvedStatusOverrides, resolvedClosureCommentsOverrides, resolvedClosureDateOverrides } = useMemo(() => {
    const flat = flattenOverrideMaps(serverOverrides);
    return {
      resolvedStatusOverrides: flat.status,
      resolvedClosureCommentsOverrides: flat.closureComment,
      resolvedClosureDateOverrides: flat.closureDate,
    };
  }, [serverOverrides]);
  const resolvedCreatedJiraKeys = useMemo(() => flattenJiraKeys(serverJiraCreated), [serverJiraCreated]);

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

  /** Reset selected date when month context changes so the new month opens on its earliest report. */
  useEffect(() => {
    setSelectedReportDate(null);
  }, [selectedYear, selectedMonth]);

  /** Stable per-row DB key: `${messageId}-r${rowIndex}` -- mirrors the server. */
  const getRowKey = useCallback((row: Record<string, string>) => {
    if (!firstReport) return "";
    const idx = parseJiraTableRowIndex(row);
    if (Number.isNaN(idx)) {
      // Fall back to the row's own __rowIndex set by the server payload.
      const explicit = Number((row as Record<string, unknown>).__rowIndex);
      if (!Number.isFinite(explicit)) return "";
      return dbRowKey(firstReport.id, explicit);
    }
    return dbRowKey(firstReport.id, idx);
  }, [firstReport]);

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
    if (!firstReport?.csvAttachment) {
      return { total: 0, open: 0, closed: 0, inProgress: 0, pending: 0, merged: 0, incidentAutoClosed: 0 };
    }
    const { headers, rows } = firstReport.csvAttachment;
    const counts = { total: rows.length, open: 0, closed: 0, inProgress: 0, pending: 0, merged: 0, incidentAutoClosed: 0 };
    for (let i = 0; i < rows.length; i++) {
      const key = dbRowKey(firstReport.id, i);
      const s = normalizeStatus(getRowStatus(rows[i], headers, key, resolvedStatusOverrides));
      if (s === "Open") counts.open++;
      else if (s === "Closed") counts.closed++;
      else if (s === "In Progress") counts.inProgress++;
      else if (s === "Pending") counts.pending++;
      else if (s === "Merged") counts.merged++;
      else if (s === "Incident Auto Closed") counts.incidentAutoClosed++;
      else counts.open++;
    }
    return counts;
  }, [firstReport, resolvedStatusOverrides]);

  /**
   * Persist a single override: optimistically update the local state, then
   * PATCH the server. On server failure we surface a toast but DON'T revert
   * the optimistic update (server-side error is the exception, not the rule;
   * forcing a revert would lose the analyst's keystrokes).
   */
  const persistOverride = useCallback(
    async (
      rowIndex: number,
      field: "status" | "closure_comment" | "closure_date",
      value: string
    ) => {
      if (!firstReport) return;
      const actor = currentUser && currentUser !== "anonymous" ? { email: currentUser.email } : undefined;
      setLocalOverride(firstReport.id, rowIndex, field, value, actor);
      try {
        await upsertDailyOverride({
          messageId: firstReport.id,
          rowIndex,
          field,
          value,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to save override";
        toast({
          title: "Save failed (server)",
          description: `${msg}. Your edit is visible locally; refresh to retry.`,
          variant: "destructive",
        });
      }
    },
    [firstReport, currentUser, setLocalOverride]
  );

  const handleStatusChange = useCallback(
    (rowIndex: number, newStatus: string) => persistOverride(rowIndex, "status", newStatus),
    [persistOverride]
  );

  const handleClosureCommentsChange = useCallback(
    (rowIndex: number, newValue: string) => persistOverride(rowIndex, "closure_comment", newValue),
    [persistOverride]
  );

  const handleClosureDateChange = useCallback(
    (rowIndex: number, newValue: string) => persistOverride(rowIndex, "closure_date", newValue),
    [persistOverride]
  );

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

  /** Migration banner state (one-shot import of legacy localStorage data). */
  const [legacyDataPresent, setLegacyDataPresent] = useState<boolean>(() => hasLegacyDailyAlertsData());
  const [importing, setImporting] = useState(false);
  const [importStage, setImportStage] = useState<string>("");

  const handleImportLegacy = useCallback(async () => {
    setImporting(true);
    setImportStage("");
    try {
      // 1. Figure out which months our localStorage keys point at. Most
      //    legacy entries are date-scoped (`YYYY-MM-DD-${inc}-${sn}`) so we
      //    can extract a unique set of YYYY-MM buckets and only sync those
      //    -- avoids a full Gmail re-fetch when the user only edited a
      //    handful of months.
      const months = extractLegacyMonths();
      const seenIds = new Set<string>();
      const allEmails: GmailMessage[] = [];
      const pushUnique = (list: GmailMessage[]) => {
        for (const e of list) {
          if (e?.id && !seenIds.has(e.id)) {
            seenIds.add(e.id);
            allEmails.push(e);
          }
        }
      };
      // Always include whatever's already on screen so the user's currently
      // visible month is part of the matcher's row index even if no
      // localStorage key references it directly.
      pushUnique(emails);

      for (let i = 0; i < months.length; i++) {
        const ym = months[i];
        const range = monthDateRange(ym);
        if (!range) continue;
        setImportStage(`Syncing ${ym} (${i + 1}/${months.length})…`);
        try {
          await syncDailyAlerts({ afterDate: range.afterDate, beforeDate: range.beforeDate });
        } catch (err) {
          // Sync failures are non-fatal -- the month may still have rows
          // already in the DB from a prior sync. Carry on and try to load.
          // eslint-disable-next-line no-console
          console.warn(`[JiraTickets import] sync failed for ${ym}:`, err);
        }
        try {
          const data = await getDailyAlerts({ afterDate: range.afterDate, beforeDate: range.beforeDate });
          pushUnique(data.emails ?? []);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[JiraTickets import] load failed for ${ym}:`, err);
        }
      }

      setImportStage("Matching legacy edits to rows…");
      const candidates = collectLegacyMigrationCandidates(allEmails);
      const totals = candidates.legacyEntryCounts;
      const totalLocal =
        totals.status + totals.closureComment + totals.closureDate + totals.jira;

      let importedOverrides = 0;
      let importedJira = 0;
      if (candidates.overrides.length > 0) {
        setImportStage(`Uploading ${candidates.overrides.length} edits…`);
        const r = await importDailyOverrides(candidates.overrides);
        importedOverrides = r.imported;
      }
      if (candidates.jiraTickets.length > 0) {
        setImportStage(`Uploading ${candidates.jiraTickets.length} Jira mappings…`);
        const r = await importJiraTickets(candidates.jiraTickets);
        importedJira = r.imported;
      }
      // Reload from DB so the UI now reads from the freshly-imported records.
      setImportStage("Reloading current month…");
      await reload();

      const matched = candidates.overrides.length + candidates.jiraTickets.length;
      const unmatched = candidates.unmatchedKeys.length;
      const description =
        `Imported ${importedOverrides} edits and ${importedJira} Jira mappings into the database.` +
        (unmatched > 0
          ? ` ${unmatched} legacy entries still didn't match any synced report -- they may belong to deleted Gmail messages or to months outside your sync history.`
          : ` All ${totalLocal} legacy entries are now in the database.`) +
        ` (${matched} candidates considered, ${months.length} month(s) synced, ${allEmails.length} email(s) scanned.)`;
      toast({ title: "Import complete", description });

      // Diagnostics: when we still couldn't match anything, dump a few
      // sample legacy keys + the loaded row identities to the console.
      if (matched === 0 && totalLocal > 0) {
        // eslint-disable-next-line no-console
        console.warn("[JiraTickets import] 0 matches against", candidates.diagnostics.rowsLoaded, "loaded rows after sync.", {
          monthsSynced: months,
          emailsScanned: allEmails.length,
          sampleLegacyKeys: candidates.diagnostics.sampleLegacyKeys,
          sampleParsed: candidates.diagnostics.sampleParsed,
          sampleRowIdentities: candidates.diagnostics.sampleRowIdentities,
        });
      }

      if (unmatched === 0) {
        clearLegacyDailyAlertsLocalStorage();
        setLegacyDataPresent(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import failed";
      toast({ title: "Import failed", description: msg, variant: "destructive" });
    } finally {
      setImporting(false);
      setImportStage("");
    }
  }, [emails, reload]);

  /**
   * Create a Jira issue for one row through the DB-backed endpoint. The server
   * dedupes by (messageId, rowIndex) so a successful create persists the
   * mapping and a re-click on the same row returns the existing key instead
   * of double-creating in Jira.
   */
  const handleCreateInJira = useCallback(async (
    displayRow: Record<string, string>,
    effectiveStatus?: string,
    effectiveClosureComment?: string,
    effectiveClosureDate?: string,
  ) => {
    if (!firstReport) return;
    const rowId = String((displayRow as Record<string, unknown>).__rowIndex ?? "");
    const rowIndex = parseJiraTableRowIndex(displayRow);
    if (!Number.isFinite(rowIndex)) return;
    setJiraCreatingKey(rowId);
    const statusToSend = effectiveStatus ?? displayRow.Status ?? "";
    const closureToSend = (effectiveClosureComment ?? displayRow.Closure_Comments ?? "").trim();
    const closureDateToSend = (effectiveClosureDate ?? displayRow["Closure date"] ?? "").trim();
    try {
      const res = await createJiraTicket({
        messageId: firstReport.id,
        rowIndex,
        summary: displayRow.Summary ?? "",
        description: displayRow.Description ?? "",
        status: statusToSend,
        incidentCategory: displayRow["Incident Category"] ?? "",
        closureComments: closureToSend,
        created: displayRow.Created ?? "",
        closureDate: closureDateToSend,
      });
      // Optimistically update so the cell flips to the new key without waiting
      // for a full reload from the DB.
      setLocalJiraCreated(firstReport.id, rowIndex, {
        jiraKey: res.ticket.jiraKey,
        jiraUrl: res.ticket.jiraUrl,
        createdBy: res.ticket.createdBy,
        createdAt: res.ticket.createdAt,
      });
      toast({
        title: res.deduped ? "Already linked" : "Created in Jira",
        description: res.deduped
          ? `Row already has Jira ticket ${res.ticket.jiraKey} -- no duplicate created.`
          : `Issue ${res.ticket.jiraKey} created and saved to the database.`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create Jira issue";
      const hint =
        /permission|do not have permission|401|403/i.test(msg)
          ? " Ask a Jira admin to grant Create issues on this project for the account used in JIRA_EMAIL, and confirm JIRA_PROJECT_KEY is correct (see docs/JIRA_SETUP.md)."
          : "";
      toast({ title: "Jira create failed", description: `${msg}${hint}`, variant: "destructive" });
    } finally {
      setJiraCreatingKey(null);
    }
  }, [firstReport, setLocalJiraCreated]);

  const handleFetchAllLatestStatus = useCallback(async () => {
    if (!transformedData?.rows.length || !firstReport) return;
    setFetchingAllStatus(true);
    setFetchAllProgress({ current: 0, total: transformedData.rows.length });
    let updated = 0;
    let datesSet = 0;
    let mergedNtt = 0;
    let mergedDateFromCreated = 0;
    const total = transformedData.rows.length;
    const headers = firstReport.csvAttachment?.headers ?? [];
    try {
      for (let i = 0; i < transformedData.rows.length; i++) {
        setFetchAllProgress({ current: i + 1, total });
        const { original } = transformedData.rows[i];
        const rowIndex = i;
        const rowKey = dbRowKey(firstReport.id, rowIndex);
        if (headers.length) {
          const st = normalizeStatus(getRowStatus(original, headers, rowKey, resolvedStatusOverrides));
          if (st === "Merged") {
            const createdVal = getRowValue(original, "Created", "Created On").trim();
            await persistOverride(rowIndex, "closure_comment", "NTT");
            if (createdVal) {
              mergedDateFromCreated++;
              await persistOverride(rowIndex, "closure_date", createdVal);
            }
            mergedNtt++;
            continue;
          }
        }
        const servicenowTicket = getRowValue(original, "ServicenowTicket", "ServiceNow Ticket", "ServicenowT");
        const incidentId = getRowValue(original, "IncidentID", "Incident ID");
        const searchFirst = servicenowTicket || incidentId;
        const searchFallback = servicenowTicket ? incidentId : "";
        const extraQs = extraGmailIncidentQueries(original);
        if (!searchFirst.trim() && !searchFallback.trim() && extraQs.length === 0) continue;
        try {
          const tried = new Set<string>();
          let result: LatestStatusFromEmailResult = { suggestedStatus: null };
          const run = async (q: string) => {
            const t = q.trim();
            if (!t || tried.has(t)) return;
            tried.add(t);
            result = await fetchLatestStatusFromEmail({ q: t });
          };
          if (searchFirst.trim()) await run(searchFirst);
          if (!result.suggestedStatus && searchFallback.trim()) await run(searchFallback);
          if (!result.suggestedStatus) {
            for (const q of extraQs) {
              await run(q);
              if (result.suggestedStatus) break;
            }
          }
          if (result.suggestedStatus === "Closed" || result.suggestedStatus === "Incident Auto Closed") {
            const statusToSet = result.suggestedStatus === "Incident Auto Closed" ? "Incident Auto Closed" : "Closed";
            const closure = (result.suggestedClosureComment ?? "").trim() || "Closed from email";
            const dateIso = (result.matchedEmailDateIso ?? "").trim();
            await persistOverride(rowIndex, "status", statusToSet);
            await persistOverride(rowIndex, "closure_comment", closure);
            if (dateIso) {
              datesSet++;
              await persistOverride(rowIndex, "closure_date", dateIso);
            }
            updated++;
          }
        } catch {
          /* skip this row on error */
        }
      }
      const parts: string[] = [];
      if (mergedNtt > 0) {
        parts.push(
          mergedDateFromCreated > 0
            ? `${mergedNtt} merged → NTT (${mergedDateFromCreated} with closure date from Created)`
            : `${mergedNtt} merged → NTT`
        );
      }
      if (updated > 0) {
        parts.push(datesSet > 0 ? `${updated} closed from email (${datesSet} with Gmail closure date)` : `${updated} closed from email`);
      }
      if (parts.length === 0) parts.push("No rows updated");
      parts.push(`${total - mergedNtt - updated} unchanged`);
      toast({
        title: "Fetch all complete (this day)",
        description: parts.join("; ") + ".",
      });
    } finally {
      setFetchingAllStatus(false);
      setFetchAllProgress(null);
    }
  }, [transformedData, firstReport, resolvedStatusOverrides, persistOverride]);

  const handleCreateAllInJiraClick = useCallback(() => {
    if (!transformedData?.rows.length || !firstReport) return;
    let alreadyHave = 0;
    for (let i = 0; i < transformedData.rows.length; i++) {
      const rowKey = dbRowKey(firstReport.id, i);
      if (resolvedCreatedJiraKeys[rowKey]) alreadyHave++;
    }
    const toCreate = transformedData.rows.length - alreadyHave;
    if (toCreate === 0) {
      toast({ title: "Create all in Jira", description: "All alerts for this day already have Jira tickets." });
      return;
    }
    setCreateAllConfirmPayload({ alreadyHave, toCreate });
    setCreateAllConfirmOpen(true);
  }, [transformedData, firstReport, resolvedCreatedJiraKeys]);

  const handleCreateAllInJiraConfirm = useCallback(async () => {
    setCreateAllConfirmOpen(false);
    if (!transformedData?.rows.length || !firstReport) return;
    const rowsToCreate: Array<{ display: Record<string, string>; original: Record<string, string>; rowIndex: number }> = [];
    for (let i = 0; i < transformedData.rows.length; i++) {
      const rowKey = dbRowKey(firstReport.id, i);
      if (!resolvedCreatedJiraKeys[rowKey]) {
        rowsToCreate.push({ ...transformedData.rows[i], rowIndex: i });
      }
    }
    if (rowsToCreate.length === 0) return;
    setCreatingAllJira(true);
    const total = rowsToCreate.length;
    setCreateAllJiraProgress({ current: 0, total });
    let created = 0;
    let deduped = 0;
    let failed = 0;
    let stoppedReason: string | null = null;
    try {
      for (let i = 0; i < rowsToCreate.length; i++) {
        setCreateAllJiraProgress({ current: i + 1, total });
        const { display, rowIndex } = rowsToCreate[i];
        const rowKey = dbRowKey(firstReport.id, rowIndex);
        const effectiveStatus = resolvedStatusOverrides[rowKey] ?? (display.Status ?? "");
        const effectiveClosure = resolvedClosureCommentsOverrides[rowKey] ?? (display.Closure_Comments ?? "");
        const effectiveClosureDate = resolvedClosureDateOverrides[rowKey] ?? (display["Closure date"] ?? "");
        try {
          const res = await createJiraTicket({
            messageId: firstReport.id,
            rowIndex,
            summary: display.Summary ?? "",
            description: display.Description ?? "",
            status: effectiveStatus,
            incidentCategory: display["Incident Category"] ?? "",
            closureComments: effectiveClosure.trim(),
            created: display.Created ?? "",
            closureDate: effectiveClosureDate.trim(),
          });
          setLocalJiraCreated(firstReport.id, rowIndex, {
            jiraKey: res.ticket.jiraKey,
            jiraUrl: res.ticket.jiraUrl,
            createdBy: res.ticket.createdBy,
            createdAt: res.ticket.createdAt,
          });
          if (res.deduped) deduped++;
          else created++;
        } catch (err) {
          failed++;
          const msg = err instanceof Error ? err.message : String(err);
          if (/permission|do not have permission|401|403/i.test(msg)) {
            stoppedReason = msg;
            break;
          }
        }
      }
      const skipped = stoppedReason ? rowsToCreate.length - created - deduped - failed : 0;
      const dedupeNote = deduped > 0 ? `; ${deduped} already linked (no duplicate created)` : "";
      toast({
        title: stoppedReason ? "Create all in Jira stopped" : "Create all in Jira complete",
        description: stoppedReason
          ? `${created} created before error${dedupeNote}. ${stoppedReason}${skipped > 0 ? ` (${skipped} not attempted.)` : ""} Fix Jira permissions (docs/JIRA_SETUP.md) and retry.`
          : `${created} ticket(s) created for this day${dedupeNote}; ${failed} failed.`,
        variant: failed > 0 || stoppedReason ? "destructive" : "default",
      });
    } finally {
      setCreatingAllJira(false);
      setCreateAllJiraProgress(null);
      setCreateAllConfirmPayload(null);
    }
  }, [transformedData, firstReport, resolvedStatusOverrides, resolvedClosureCommentsOverrides, resolvedClosureDateOverrides, resolvedCreatedJiraKeys, setLocalJiraCreated]);

  const handleCreateAllInJira = useCallback(() => {
    handleCreateAllInJiraClick();
  }, [handleCreateAllInJiraClick]);

  const handleLinkExistingJiraTickets = useCallback(async () => {
    if (!transformedData?.rows.length || !firstReport) return;
    setLinkingExistingJira(true);
    try {
      const issues = await fetchJiraIssues(1500);
      const usedIssueKeys = new Set<string>();
      let linked = 0;
      for (let i = 0; i < transformedData.rows.length; i++) {
        const { original, display } = transformedData.rows[i];
        const rowIndex = i;
        const rowKey = dbRowKey(firstReport.id, rowIndex);
        if (resolvedCreatedJiraKeys[rowKey]) continue;
        const incidentId = primaryIncidentIdFromRow(original) || getRowValue(original, "IncidentID", "Incident ID");
        const servicenow = getRowValue(original, "ServicenowTicket", "ServiceNow Ticket", "ServicenowT");
        const summary = (display.Summary ?? "").trim();
        const tokens = collectJiraLinkMatchTokens(incidentId, servicenow, summary);
        const match = issues.find((iss) => {
          if (usedIssueKeys.has(iss.key)) return false;
          const s = (iss.summary ?? "").toLowerCase();
          for (const tok of tokens) {
            if (tok && s.includes(tok)) return true;
          }
          return false;
        });
        if (match) {
          usedIssueKeys.add(match.key);
          try {
            await linkJiraTicket({
              messageId: firstReport.id,
              rowIndex,
              jiraKey: match.key,
            });
            setLocalJiraCreated(firstReport.id, rowIndex, { jiraKey: match.key });
            linked++;
          } catch {
            /* skip individual link errors */
          }
        }
      }
      toast({
        title: "Link existing Jira tickets",
        description:
          linked > 0
            ? `Linked ${linked} Jira ticket(s) to alerts for this day -- saved to the database.`
            : "No matching Jira tickets found. Issue summary must contain the same INC/Servicenow ID as the row (we search up to 1500 newest issues in the project).",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to fetch Jira issues";
      toast({ title: "Link failed", description: msg, variant: "destructive" });
    } finally {
      setLinkingExistingJira(false);
    }
  }, [transformedData, firstReport, resolvedCreatedJiraKeys, setLocalJiraCreated]);

  const handleFetchLatestStatus = useCallback(async (originalRow: Record<string, string>, rowIndex: number) => {
    if (!firstReport) return;
    const servicenowTicket = getRowValue(originalRow, "ServicenowTicket", "ServiceNow Ticket", "ServicenowT");
    const incidentId = getRowValue(originalRow, "IncidentID", "Incident ID");
    const searchFirst = servicenowTicket || incidentId;
    const searchFallback = servicenowTicket ? incidentId : "";
    const extraQs = extraGmailIncidentQueries(originalRow);
    if (!searchFirst.trim() && !searchFallback.trim() && extraQs.length === 0) {
      toast({ title: "No ticket or incident ID", description: "This row has no ServicenowTicket, IncidentID, or INC/CS in row text to search.", variant: "destructive" });
      return;
    }
    const rowKey = dbRowKey(firstReport.id, rowIndex);
    setFetchingStatusKey(rowKey);
    try {
      if (firstReport.csvAttachment?.headers?.length) {
        const st = normalizeStatus(
          getRowStatus(originalRow, firstReport.csvAttachment.headers, rowKey, resolvedStatusOverrides)
        );
        if (st === "Merged") {
          await handleClosureCommentsChange(rowIndex, "NTT");
          const createdVal = getRowValue(originalRow, "Created", "Created On").trim();
          if (createdVal) await handleClosureDateChange(rowIndex, createdVal);
          toast({
            title: "Merged alert (NTT)",
            description: "Closure set to NTT; closure date matches Created (auto-closed by NTT).",
          });
          return;
        }
      }
      const tried = new Set<string>();
      let result: LatestStatusFromEmailResult = { suggestedStatus: null };
      const run = async (q: string) => {
        const t = q.trim();
        if (!t || tried.has(t)) return;
        tried.add(t);
        result = await fetchLatestStatusFromEmail({ q: t });
      };
      if (searchFirst.trim()) await run(searchFirst);
      if (!result.suggestedStatus && searchFallback.trim()) await run(searchFallback);
      if (!result.suggestedStatus) {
        for (const q of extraQs) {
          await run(q);
          if (result.suggestedStatus) break;
        }
      }
      if (result.error && !result.suggestedStatus) {
        const isNoEmail = /no matching email/i.test(result.error);
        toast({
          title: isNoEmail ? "No email found" : "Fetch status failed",
          description: isNoEmail
            ? `No email mentioning this incident/ticket in the last ${GMAIL_INCIDENT_LOOKUP_LOOKBACK_DAYS} days (searches all senders).`
            : result.error,
          variant: isNoEmail ? "default" : "destructive",
        });
        return;
      }
      if (result.suggestedStatus === "Closed" || result.suggestedStatus === "Incident Auto Closed") {
        const statusToSet = result.suggestedStatus === "Incident Auto Closed" ? "Incident Auto Closed" : "Closed";
        await handleStatusChange(rowIndex, statusToSet);
        const closure = (result.suggestedClosureComment ?? "").trim() || "Closed from email";
        await handleClosureCommentsChange(rowIndex, closure);
        const dateIso = (result.matchedEmailDateIso ?? "").trim();
        if (dateIso) await handleClosureDateChange(rowIndex, dateIso);
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
  }, [firstReport, resolvedStatusOverrides, handleStatusChange, handleClosureCommentsChange, handleClosureDateChange]);

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
        email = await getGmailMessageBySearch({ q: searchFirst });
      }
      if (!email && searchFallback) {
        email = await getGmailMessageBySearch({ q: searchFallback });
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchFromGmail()}
                disabled={loading || syncing}
                className="shrink-0"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Syncing…" : "Refresh"}
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

          {legacyDataPresent && !isAnonymous && (
            <div className="shrink-0 border-b border-amber-500/40 bg-amber-500/10 px-6 py-3">
              <div className="flex items-start gap-3">
                <DatabaseZap className="h-5 w-5 mt-0.5 text-amber-600 dark:text-amber-300 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-amber-700 dark:text-amber-200">
                    Legacy edits detected in this browser.
                  </p>
                  <p className="text-xs text-amber-700/80 dark:text-amber-200/80 mt-0.5">
                    Status, comments and Jira ticket IDs you saved before the database migration are still in localStorage. Click Import to push them into the database so they survive refreshes, restarts, and other browsers. The importer will automatically sync every month referenced by your local edits before matching, so you only have to click once -- it may take a minute if you have many months of history.
                  </p>
                  {importing && importStage && (
                    <p className="text-xs text-amber-700 dark:text-amber-200 mt-1 font-medium">
                      {importStage}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="default"
                    onClick={handleImportLegacy}
                    disabled={importing}
                  >
                    {importing ? (importStage || "Importing…") : "Import local edits + Jira tickets"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      clearLegacyDailyAlertsLocalStorage();
                      setLegacyDataPresent(false);
                      toast({ title: "Dismissed", description: "Local edits cleared from this browser." });
                    }}
                    disabled={importing}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            </div>
          )}

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
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-2 gap-y-0.5 text-xs">
                      <span className="text-muted-foreground">Open:</span>
                      <span className="font-medium text-foreground">{firstReportStats.open}</span>
                      <span className="text-muted-foreground">Closed:</span>
                      <span className="font-medium text-foreground">{firstReportStats.closed}</span>
                      <span className="text-muted-foreground">Merged:</span>
                      <span className="font-medium text-foreground">{firstReportStats.merged}</span>
                      <span className="text-muted-foreground">Pending:</span>
                      <span className="font-medium text-foreground">{firstReportStats.pending}</span>
                      <span className="text-muted-foreground">In progress:</span>
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
                {(error.toLowerCase().includes("reconnect") || error.toLowerCase().includes("expired") || error.toLowerCase().includes("authentication")) && (
                  <Button variant="outline" size="sm" onClick={() => { window.location.href = `${API_BASE_URL}/auth/google`; }}>
                    Reconnect Gmail
                  </Button>
                )}
              </div>
            )}

            {loading && emails.length === 0 && (
              <div className="px-6 py-10 flex items-center gap-3 text-sm text-muted-foreground">
                <RefreshCw className="h-4 w-4 animate-spin" />
                Loading daily alerts from the database…
              </div>
            )}

            {!loading && firstReport && csvForTable && transformedData && (
              <section className="p-6">
                <Card key={firstReport.id} className="overflow-hidden">
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
                        const idx = parseJiraTableRowIndex(row);
                        if (!Number.isNaN(idx) && transformedData.rows[idx]) {
                          handleAlertRowClick(transformedData.rows[idx].original);
                        }
                      }}
                      statusOverrides={resolvedStatusOverrides}
                      closureCommentsOverrides={resolvedClosureCommentsOverrides}
                      closureDateOverrides={resolvedClosureDateOverrides}
                      getRowKey={getRowKey}
                      firstColumn={{
                        header: "Jira",
                        render: (row) => {
                          const key = getRowKey(row);
                          const jiraKey = key ? resolvedCreatedJiraKeys[key] : "";
                          return <span className="font-mono text-xs">{jiraKey || "—"}</span>;
                        },
                      }}
                      leadingColumn={{
                        header: "Fetch status",
                        render: (row) => {
                          const idx = parseJiraTableRowIndex(row);
                          const original = Number.isNaN(idx) ? null : transformedData.rows[idx]?.original;
                          const rowKey = original ? getRowKey(row) : "";
                          const isFetching = fetchingStatusKey === rowKey;
                          return (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={isFetching || fetchingAllStatus}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (original && !Number.isNaN(idx)) handleFetchLatestStatus(original, idx);
                              }}
                              title="Check latest email for closure comment (e.g. please close this alert)"
                            >
                              {isFetching ? "…" : "Fetch"}
                            </Button>
                          );
                        },
                      }}
                      onStatusChange={(row, newStatus) => {
                        const idx = parseJiraTableRowIndex(row);
                        if (!Number.isNaN(idx) && transformedData.rows[idx]) {
                          void handleStatusChange(idx, newStatus);
                        }
                      }}
                      onClosureCommentsChange={(row, newValue) => {
                        const idx = parseJiraTableRowIndex(row);
                        if (!Number.isNaN(idx) && transformedData.rows[idx]) {
                          void handleClosureCommentsChange(idx, newValue);
                        }
                      }}
                      onClosureDateChange={(row, newValue) => {
                        const idx = parseJiraTableRowIndex(row);
                        if (!Number.isNaN(idx) && transformedData.rows[idx]) {
                          void handleClosureDateChange(idx, newValue);
                        }
                      }}
                      actionColumn={{
                        header: "Create in Jira",
                        render: (row) => {
                          const rowId = String((row as Record<string, unknown>).__rowIndex ?? "");
                          const rowKey = getRowKey(row);
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
                                handleCreateInJira(row, effectiveStatus, effectiveClosure, effectiveClosureDate);
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
                No CSV attachments found in the loaded emails. Click <strong>Refresh</strong> to pull the latest from Gmail.
              </p>
            )}

            {!loading && emails.length === 0 && !error && (
              <p className="px-6 py-4 text-sm text-muted-foreground">
                Select a month and click <strong>Refresh</strong> to load PB Daily reports into the database. Status changes, closure comments, and Jira ticket IDs are saved server-side so they survive page reloads and project restarts.
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
