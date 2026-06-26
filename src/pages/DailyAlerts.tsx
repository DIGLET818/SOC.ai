import { useMemo, useState, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { format } from "date-fns";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { SOCSidebar } from "@/components/SOCSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { CsvDataTable } from "@/components/CsvDataTable";
import { ReportStatusSummaryCard } from "@/components/ReportStatusSummaryCard";
import { EmailDetailSheet } from "@/components/EmailDetailSheet";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  FileText,
  DatabaseZap,
  Upload,
  Search,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { API_BASE_URL } from "@/api/client";
import { useDailyAlertsData } from "@/hooks/useDailyAlertsData";
import {
  upsertDailyOverride,
  importDailyOverrides,
  syncDailyAlertsResilient,
  getDailyAlerts,
  recoverDailyReport,
  uploadDailyReportData,
  type DailyOverrideRecord,
  type RecoverDailyReportCandidate,
} from "@/api/dailyAlerts";
import { parseReportSpreadsheetFile } from "@/lib/parseReportSpreadsheet";
import { importJiraTickets } from "@/api/jiraTickets";
import {
  collectLegacyMigrationCandidates,
  hasLegacyDailyAlertsData,
  clearLegacyDailyAlertsLocalStorage,
  extractLegacyMonths,
  monthDateRange,
} from "@/lib/legacyDailyAlertsMigration";
import { getGmailMessageBySearch } from "@/api/gmail";
import { toast } from "@/hooks/use-toast";
import type { GmailMessage } from "@/types/gmail";

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

function toYYYYMMDD(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nextDay(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + 1);
  return toYYYYMMDD(d);
}

/** Stable per-row DB key: `${messageId}-r${rowIndex}` -- mirrors the server. */
function dbRowKey(messageId: string, rowIndex: number): string {
  return `${messageId}-r${rowIndex}`;
}

/**
 * Collapse the structured override records the server returns into the
 * legacy `Record<string, string>` shape that CsvDataTable expects.
 */
function flattenOverrides(
  overrides: Record<string, DailyOverrideRecord>
): {
  status: Record<string, string>;
  closureComment: Record<string, string>;
} {
  const status: Record<string, string> = {};
  const closureComment: Record<string, string> = {};
  for (const [key, rec] of Object.entries(overrides)) {
    if (rec.status) status[key] = rec.status;
    if (rec.closure_comment) closureComment[key] = rec.closure_comment;
  }
  return { status, closureComment };
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

/** Dashboard calendar day: reportDate override, else Gmail received day. */
function emailCalendarDateKey(email: GmailMessage): string {
  if (email.reportDate?.trim()) return email.reportDate.trim();
  if (email.receivedDate?.trim()) return email.receivedDate.trim();
  const ts = parseEmailDate(email);
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function emailReceivedDateKey(email: GmailMessage): string {
  if (email.receivedDate?.trim()) return email.receivedDate.trim();
  const ts = parseEmailDate(email);
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseISODateLocal(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Find row value by header key (case-insensitive match). */
function getRowValue(row: Record<string, string>, ...possibleKeys: string[]): string {
  const keys = Object.keys(row);
  for (const want of possibleKeys) {
    const found = keys.find((k) => k.toLowerCase().replace(/\s/g, "") === want.toLowerCase().replace(/\s/g, ""));
    if (found && row[found]?.trim()) return row[found].trim();
  }
  return "";
}

/** Status values we count (must match CsvDataTable STATUS_OPTIONS). */
const STATUS_COUNTS = ["Open", "Closed", "In Progress", "Pending", "Merged", "Incident Auto Closed"] as const;

function normalizeStatus(s: string): (typeof STATUS_COUNTS)[number] {
  const t = s.trim();
  const found = STATUS_COUNTS.find((opt) => opt.toLowerCase() === t.toLowerCase());
  return found ?? "Open";
}

/** Get display status for a row (override or CSV Status column). */
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

function countByStatus(
  rows: Record<string, string>[],
  headers: string[],
  emailId: string,
  statusOverrides: Record<string, string>
): {
  total: number;
  open: number;
  closed: number;
  inProgress: number;
  pending: number;
  merged: number;
  incidentAutoClosed: number;
} {
  const counts = {
    total: rows.length,
    open: 0,
    closed: 0,
    inProgress: 0,
    pending: 0,
    merged: 0,
    incidentAutoClosed: 0,
  };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const explicit = Number((row as Record<string, unknown>).__rowIndex);
    const idx = Number.isFinite(explicit) ? explicit : i;
    const key = dbRowKey(emailId, idx);
    const s = normalizeStatus(getRowStatus(row, headers, key, statusOverrides));
    if (s === "Open") counts.open++;
    else if (s === "Closed") counts.closed++;
    else if (s === "In Progress") counts.inProgress++;
    else if (s === "Pending") counts.pending++;
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

export default function DailyAlerts() {
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);

  const { afterDate, beforeDate } = useMemo(
    () => getMonthRange(selectedYear, selectedMonth),
    [selectedYear, selectedMonth]
  );

  const {
    emails,
    overrides: serverOverrides,
    loading,
    syncing,
    error,
    currentUser,
    refetchFromGmail: refetch,
    refetchDateRange,
    setLocalOverride,
    reload,
  } = useDailyAlertsData({
    afterDate,
    beforeDate,
    maxResults: 2000,
  });

  const isAnonymous = currentUser === "anonymous";

  /** Flatten server records to the legacy map shape CsvDataTable expects. */
  const { statusOverrides, closureCommentsOverrides } = useMemo(() => {
    const flat = flattenOverrides(serverOverrides);
    return {
      statusOverrides: flat.status,
      closureCommentsOverrides: flat.closureComment,
    };
  }, [serverOverrides]);

  const emailsSortedByDate = useMemo(() => {
    return [...emails].sort((a, b) => parseEmailDate(a) - parseEmailDate(b));
  }, [emails]);

  const emailsWithCsv = useMemo(
    () => emailsSortedByDate.filter((e) => e.csvAttachment?.rows?.length),
    [emailsSortedByDate]
  );

  const getRowKey = useCallback(
    (emailId: string) => (row: Record<string, string>) => {
      const explicit = Number((row as Record<string, unknown>).__rowIndex);
      if (!Number.isFinite(explicit)) return "";
      return dbRowKey(emailId, explicit);
    },
    []
  );

  const [fetchDate, setFetchDate] = useState<string>(() => toYYYYMMDD(new Date()));
  const fetchDateMin = useMemo(() => afterDate, [afterDate]);
  const fetchDateMax = useMemo(() => {
    const [y, m] = beforeDate.split("-").map(Number);
    const last = new Date(y, m - 1, 0);
    return toYYYYMMDD(last);
  }, [beforeDate]);
  const fetchDateForMonth = useMemo(() => {
    const [y, m] = afterDate.split("-").map(Number);
    const last = new Date(y, m, 0);
    const first = new Date(y, m - 1, 1);
    const today = toYYYYMMDD(new Date());
    if (today >= afterDate && today <= toYYYYMMDD(last)) return today;
    return afterDate;
  }, [afterDate]);

  const handleFetchThisDate = useCallback(() => {
    const after = fetchDate;
    const before = nextDay(fetchDate);
    refetchDateRange(after, before).then(() => {
      toast({
        title: "Gmail fetched",
        description: `Emails received on ${fetchDate} are in the database.`,
      });
    });
  }, [fetchDate, refetchDateRange]);

  const [recoverDate, setRecoverDate] = useState<string>(() => toYYYYMMDD(new Date()));
  const [recovering, setRecovering] = useState(false);
  const [recoverDialogOpen, setRecoverDialogOpen] = useState(false);
  const [recoverCandidates, setRecoverCandidates] = useState<RecoverDailyReportCandidate[]>([]);
  const [recoverTargetDate, setRecoverTargetDate] = useState("");
  const [uploading, setUploading] = useState(false);
  const csvUploadRef = useRef<HTMLInputElement>(null);

  const handleRecoverMissing = useCallback(async () => {
    setRecovering(true);
    try {
      const resp = await recoverDailyReport({ reportDate: recoverDate, searchDays: 14 });
      await reload();

      const unassigned = resp.candidates.filter((c) => c.rowCount > 0 && c.reportDate !== recoverDate);
      if (resp.candidates.length === 0) {
        toast({
          title: "No daily report found",
          description:
            `Gmail search found no "PB Daily report" with PB_Daily.csv between ${resp.searchAfter} and ${resp.searchBefore} ` +
            `(includes 7 days before the missing day). If the mail is in your inbox, restart the backend and try again, or use Upload file.`,
          variant: "destructive",
        });
        return;
      }
      if (unassigned.length === 1) {
        await recoverDailyReport({ reportDate: recoverDate, messageId: unassigned[0]!.messageId });
        await reload();
        toast({
          title: "Report recovered",
          description: `Assigned to ${recoverDate} (received ${unassigned[0]!.receivedDate ?? "unknown"}).`,
        });
        return;
      }
      if (unassigned.length === 0) {
        toast({
          title: "Already on dashboard",
          description: `A report for ${recoverDate} is already loaded.`,
        });
        return;
      }
      setRecoverTargetDate(recoverDate);
      setRecoverCandidates(unassigned);
      setRecoverDialogOpen(true);
    } catch (err) {
      toast({
        title: "Recover failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setRecovering(false);
    }
  }, [recoverDate, reload]);

  const handleAssignRecoverCandidate = useCallback(
    async (messageId: string) => {
      setRecovering(true);
      try {
        await recoverDailyReport({ reportDate: recoverTargetDate, messageId });
        await reload();
        setRecoverDialogOpen(false);
        toast({
          title: "Report assigned",
          description: `This email is now shown on ${recoverTargetDate} in the calendar.`,
        });
      } catch (err) {
        toast({
          title: "Could not assign",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      } finally {
        setRecovering(false);
      }
    },
    [recoverTargetDate, reload]
  );

  const handleUploadReportFile = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const parsed = await parseReportSpreadsheetFile(file);
        const resp = await uploadDailyReportData({
          reportDate: recoverDate,
          filename: parsed.filename,
          headers: parsed.headers,
          rows: parsed.rows,
          replace: true,
        });
        await reload();
        toast({
          title: "Report uploaded",
          description: `${resp.rowCount} row(s) loaded for ${resp.reportDate} from ${parsed.filename}.`,
        });
      } catch (err) {
        toast({
          title: "Upload failed",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      } finally {
        setUploading(false);
      }
    },
    [recoverDate, reload]
  );

  useEffect(() => {
    setFetchDate(fetchDateForMonth);
    setRecoverDate(fetchDateForMonth);
  }, [selectedYear, selectedMonth, fetchDateForMonth]);

  const reportListSignature = useMemo(() => emailsWithCsv.map((e) => e.id).join(","), [emailsWithCsv]);
  const reportDateSet = useMemo(() => {
    const s = new Set<string>();
    for (const e of emailsWithCsv) s.add(emailCalendarDateKey(e));
    return s;
  }, [emailsWithCsv]);

  const [selectedReportIndex, setSelectedReportIndex] = useState(0);
  const [reportCalendarOpen, setReportCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(selectedYear, selectedMonth - 1, 1));

  useEffect(() => {
    setCalendarMonth(new Date(selectedYear, selectedMonth - 1, 1));
  }, [selectedYear, selectedMonth]);

  /**
   * Default to the latest report on context change. We don't try to remember
   * "last viewed report" across reloads anymore -- the DB has all the data,
   * so always opening on the most recent day is the principled default.
   */
  useLayoutEffect(() => {
    if (emailsWithCsv.length === 0) return;
    setSelectedReportIndex(emailsWithCsv.length - 1);
  }, [selectedYear, selectedMonth, reportListSignature]);

  const safeReportIndex =
    emailsWithCsv.length > 0 ? Math.min(selectedReportIndex, emailsWithCsv.length - 1) : 0;
  const selectedEmail = emailsWithCsv[safeReportIndex] ?? null;

  const selectedReportDate = useMemo(() => {
    if (!selectedEmail) return undefined;
    return parseISODateLocal(emailCalendarDateKey(selectedEmail));
  }, [selectedEmail]);

  const handleReportCalendarSelect = useCallback(
    (d: Date | undefined) => {
      if (!d) return;
      const key = toYYYYMMDD(d);
      const matches = emailsWithCsv.filter((e) => emailCalendarDateKey(e) === key);
      if (matches.length === 0) {
        toast({ title: "No report", description: `No daily CSV loaded for ${key}.`, variant: "destructive" });
        return;
      }
      const last = matches[matches.length - 1];
      const idx = emailsWithCsv.findIndex((e) => e.id === last.id);
      if (idx >= 0) setSelectedReportIndex(idx);
      setReportCalendarOpen(false);
    },
    [emailsWithCsv]
  );

  const monthStats = useMemo(() => {
    let total = 0;
    const counts = { open: 0, closed: 0, inProgress: 0, pending: 0, merged: 0, incidentAutoClosed: 0 };
    for (const email of emailsWithCsv) {
      const csv = email.csvAttachment;
      if (!csv?.headers?.length || !csv.rows?.length) continue;
      const c = countByStatus(csv.rows, csv.headers, email.id, statusOverrides);
      total += c.total;
      counts.open += c.open;
      counts.closed += c.closed;
      counts.inProgress += c.inProgress;
      counts.pending += c.pending;
      counts.merged += c.merged;
      counts.incidentAutoClosed += c.incidentAutoClosed;
    }
    return { total, ...counts };
  }, [emailsWithCsv, statusOverrides]);

  const selectedDateStats = useMemo(() => {
    if (!selectedEmail?.csvAttachment) {
      return { total: 0, open: 0, closed: 0, inProgress: 0, pending: 0, merged: 0, incidentAutoClosed: 0 };
    }
    const { headers, rows } = selectedEmail.csvAttachment;
    return countByStatus(rows, headers, selectedEmail.id, statusOverrides);
  }, [selectedEmail, statusOverrides]);

  const [trailEmail, setTrailEmail] = useState<GmailMessage | null>(null);
  const [trailLoading, setTrailLoading] = useState(false);

  /**
   * Persist a single override: optimistically update local state, then PATCH
   * the server. On server failure we surface a toast but keep the optimistic
   * update so the analyst doesn't lose their keystrokes.
   */
  const persistOverride = useCallback(
    async (
      messageId: string,
      rowIndex: number,
      field: "status" | "closure_comment" | "closure_date",
      value: string
    ) => {
      const actor = currentUser && currentUser !== "anonymous" ? { email: currentUser.email } : undefined;
      setLocalOverride(messageId, rowIndex, field, value, actor);
      try {
        await upsertDailyOverride({ messageId, rowIndex, field, value });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to save override";
        toast({
          title: "Save failed (server)",
          description: `${msg}. Your edit is visible locally; refresh to retry.`,
          variant: "destructive",
        });
      }
    },
    [currentUser, setLocalOverride]
  );

  const handleStatusChange = useCallback(
    (row: Record<string, string>, newStatus: string, emailId: string) => {
      const explicit = Number((row as Record<string, unknown>).__rowIndex);
      if (!Number.isFinite(explicit)) return;
      void persistOverride(emailId, explicit, "status", newStatus);
    },
    [persistOverride]
  );

  const handleClosureCommentsChange = useCallback(
    (row: Record<string, string>, newValue: string, emailId: string) => {
      const explicit = Number((row as Record<string, unknown>).__rowIndex);
      if (!Number.isFinite(explicit)) return;
      void persistOverride(emailId, explicit, "closure_comment", newValue);
    },
    [persistOverride]
  );

  /** Migration banner state -- one-shot import of legacy localStorage data. */
  const [legacyDataPresent, setLegacyDataPresent] = useState<boolean>(() => hasLegacyDailyAlertsData());
  const [importing, setImporting] = useState(false);
  const [importStage, setImportStage] = useState<string>("");

  const handleImportLegacy = useCallback(async () => {
    setImporting(true);
    setImportStage("");
    try {
      // 1. Determine which months our legacy keys reference. Most are
      //    date-scoped (`YYYY-MM-DD-${inc}-${sn}`), so we sync only those
      //    months instead of the entire mailbox.
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
      pushUnique(emails); // currently visible month included by default

      for (let i = 0; i < months.length; i++) {
        const ym = months[i];
        const range = monthDateRange(ym);
        if (!range) continue;
        setImportStage(`Syncing ${ym} (${i + 1}/${months.length})…`);
        try {
          await syncDailyAlertsResilient({ afterDate: range.afterDate, beforeDate: range.beforeDate });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[DailyAlerts import] sync failed for ${ym}:`, err);
        }
        try {
          const data = await getDailyAlerts({ afterDate: range.afterDate, beforeDate: range.beforeDate });
          pushUnique(data.emails ?? []);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[DailyAlerts import] load failed for ${ym}:`, err);
        }
      }

      setImportStage("Matching legacy edits to rows…");
      const candidates = collectLegacyMigrationCandidates(allEmails);
      const totals = candidates.legacyEntryCounts;
      const totalLocal = totals.status + totals.closureComment + totals.closureDate + totals.jira;

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

      if (matched === 0 && totalLocal > 0) {
        // eslint-disable-next-line no-console
        console.warn("[DailyAlerts import] 0 matches against", candidates.diagnostics.rowsLoaded, "loaded rows after sync.", {
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
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={loading || syncing} className="shrink-0">
                <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Syncing…" : "Refresh"}
              </Button>
              <div className="flex flex-wrap items-center gap-2 shrink-0 border-l border-border pl-4 max-w-[44rem]">
                <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">Missing day</span>
                <input
                  type="date"
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm w-[8.5rem]"
                  min={fetchDateMin}
                  max={fetchDateMax}
                  value={recoverDate}
                  onChange={(e) => {
                    setRecoverDate(e.target.value);
                    setFetchDate(e.target.value);
                  }}
                />
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => void handleRecoverMissing()}
                  disabled={loading || syncing || recovering || uploading}
                  className="shrink-0"
                  title="Search Gmail for a report delivered late and show it on this day"
                >
                  <Search className={`h-3.5 w-3.5 mr-1.5 ${recovering ? "animate-pulse" : ""}`} />
                  {recovering ? "Searching…" : "Recover from Gmail"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => csvUploadRef.current?.click()}
                  disabled={loading || syncing || recovering || uploading}
                  className="shrink-0"
                  title="Upload a .csv or Excel (.xlsx) file for this day if the email never arrived"
                >
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  {uploading ? "Uploading…" : "Upload file"}
                </Button>
                <input
                  ref={csvUploadRef}
                  type="file"
                  accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void handleUploadReportFile(f);
                  }}
                />
                <Button variant="outline" size="sm" onClick={handleFetchThisDate} disabled={loading || syncing} className="shrink-0 hidden md:inline-flex">
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`} />
                  Fetch received date
                </Button>
              </div>
              <div className="min-w-0">
                <h1 className="text-2xl font-bold text-foreground truncate">Daily Alerts</h1>
                <p className="text-sm text-muted-foreground truncate">
                  PB Daily report emails from {DAILY_ALERTS_SENDER}
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
                    Status and closure-comment edits you saved before the database migration are still in localStorage. Click Import to push them into the database so they survive refreshes, restarts, and other browsers. The importer will automatically sync every month referenced by your local edits before matching, so you only have to click once -- it may take a minute if you have many months of history.
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

          {!loading && emailsWithCsv.length > 0 && (
            <div className="shrink-0 border-b border-border bg-background px-6 py-4 shadow-sm space-y-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="text-sm font-medium text-muted-foreground shrink-0">Report date</span>
                <div className="flex items-center gap-1 rounded-lg border border-input bg-background">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    disabled={emailsWithCsv.length <= 1 || safeReportIndex <= 0}
                    onClick={() => setSelectedReportIndex((i) => Math.max(0, i - 1))}
                    title="Previous report"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Popover open={reportCalendarOpen} onOpenChange={setReportCalendarOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        className="h-9 min-w-[12rem] max-w-[min(100vw-10rem,22rem)] justify-start gap-2 px-3 font-normal text-sm"
                        title="Pick a day with a loaded report"
                      >
                        <CalendarIcon className="h-4 w-4 shrink-0 opacity-70" />
                        <span className="truncate">
                          {selectedEmail
                            ? format(selectedReportDate ?? new Date(), "EEE, MMM d, yyyy")
                            : "Select date"}
                        </span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        month={calendarMonth}
                        onMonthChange={setCalendarMonth}
                        selected={selectedReportDate}
                        onSelect={handleReportCalendarSelect}
                        fromDate={parseISODateLocal(afterDate)}
                        toDate={parseISODateLocal(fetchDateMax)}
                        disabled={(date) => {
                          const k = toYYYYMMDD(date);
                          return k < afterDate || k > fetchDateMax || !reportDateSet.has(k);
                        }}
                        modifiers={{ hasReport: (date) => reportDateSet.has(toYYYYMMDD(date)) }}
                        modifiersClassNames={{
                          hasReport: "font-semibold text-primary underline decoration-primary/40 decoration-1 underline-offset-2",
                        }}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    disabled={emailsWithCsv.length <= 1 || safeReportIndex >= emailsWithCsv.length - 1}
                    onClick={() => setSelectedReportIndex((i) => Math.min(emailsWithCsv.length - 1, i + 1))}
                    title="Next report"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
                {selectedEmail ? (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {emailCalendarDateKey(selectedEmail) !== emailReceivedDateKey(selectedEmail)
                      ? `Report day ${emailCalendarDateKey(selectedEmail)} · Gmail received ${emailReceivedDateKey(selectedEmail)}`
                      : formatReportDate(selectedEmail)}
                  </span>
                ) : null}
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 w-full">
                <ReportStatusSummaryCard
                  variant="primary"
                  title="Month data"
                  total={monthStats.total}
                  counts={monthStats}
                  pendingLabel="Confirmation pending from End user"
                />
                <ReportStatusSummaryCard
                  variant="blue"
                  title="Report date"
                  subtitle={selectedEmail ? formatReportDate(selectedEmail) : "—"}
                  total={selectedDateStats.total}
                  counts={selectedDateStats}
                  pendingLabel="Confirmation pending from End user"
                />
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

            {!loading && emailsWithCsv.length > 0 && selectedEmail?.csvAttachment && (
              <section className="p-6">
                <Card key={selectedEmail.id} className="overflow-hidden">
                  <CardHeader className="py-3 px-4 bg-muted/30 border-b">
                    <h3 className="text-base font-semibold text-foreground">
                      Report — {formatReportDate(selectedEmail)}
                    </h3>
                    {selectedEmail.csvAttachment?.filename && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {selectedEmail.csvAttachment.filename} • {selectedEmail.csvAttachment.rows?.length ?? 0} rows
                      </p>
                    )}
                  </CardHeader>
                  <CardContent className="p-4">
                    <CsvDataTable
                      csv={selectedEmail.csvAttachment}
                      onRowClick={handleAlertRowClick}
                      statusOverrides={statusOverrides}
                      closureCommentsOverrides={closureCommentsOverrides}
                      getRowKey={getRowKey(selectedEmail.id)}
                      onStatusChange={(row, newStatus) => handleStatusChange(row, newStatus, selectedEmail.id)}
                      onClosureCommentsChange={(row, newValue) => handleClosureCommentsChange(row, newValue, selectedEmail.id)}
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
                Select a month and click <strong>Refresh</strong> to load that month&apos;s PB Daily reports into the database. Status changes and closure comments are saved server-side so they survive page reloads and project restarts.
              </p>
            )}
          </div>

          <Dialog open={recoverDialogOpen} onOpenChange={setRecoverDialogOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Which email is the report for {recoverTargetDate}?</DialogTitle>
                <DialogDescription>
                  Several daily reports arrived after that day. Pick the one that covers {recoverTargetDate}.
                </DialogDescription>
              </DialogHeader>
              <ul className="space-y-2 max-h-[min(50vh,20rem)] overflow-y-auto">
                {recoverCandidates.map((c) => (
                  <li key={c.messageId}>
                    <Button
                      variant="outline"
                      className="w-full justify-start h-auto py-3 text-left"
                      disabled={recovering}
                      onClick={() => void handleAssignRecoverCandidate(c.messageId)}
                    >
                      <span className="block font-medium truncate">{c.subject ?? "PB Daily report"}</span>
                      <span className="block text-xs text-muted-foreground mt-1">
                        Received {c.receivedDate ?? "—"} · {c.rowCount} row(s)
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setRecoverDialogOpen(false)}>
                  Cancel
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <EmailDetailSheet
            email={trailEmail}
            open={!!trailEmail}
            onClose={() => setTrailEmail(null)}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
