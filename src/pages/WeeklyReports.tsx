import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { SOCSidebar } from "@/components/SOCSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { CsvDataTable } from "@/components/CsvDataTable";
import { EmailDetailSheet } from "@/components/EmailDetailSheet";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Badge } from "@/components/ui/badge";
import { Calendar as DatePickerCalendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  CalendarRange,
  FileText,
  Download,
  LayoutGrid,
  BarChart3,
} from "lucide-react";
import { API_BASE_URL } from "@/api/client";
import { useWeeklyReportData } from "@/hooks/useWeeklyReportData";
import { useReportAlertsByDate } from "@/hooks/useReportAlertsByDate";
import {
  upsertOverride,
  importOverrides,
  bulkUpsertOverrides,
  fetchClosureBatchResilient,
  type OverrideField,
  type ImportOverridesItem,
  type WeeklyOverrideRecord,
  type FetchClosureBatchResult,
  WeeklyReportsAuthError,
} from "@/api/weeklyReports";
import {
  overrideMapsFromReport,
  unifiedRowKey,
  rowCreationDateKey,
  persistUnifiedReportOverride,
} from "@/lib/reportAlertUtils";
import {
  getGmailMessageBySearch,
} from "@/api/gmail";
import { toast } from "@/hooks/use-toast";
import type { GmailMessage, CsvAttachment } from "@/types/gmail";
import {
  mergeOverridesIntoRows,
  downloadCsvAsXlsx,
  buildConsolidatedWeeklyReportsCsv,
} from "@/lib/exportReportSheetXlsx";
import { YearlyFyTrendSection, type YearlyMonthTrendRow } from "@/components/weekly/YearlyFyInsights";
import { ReportStatusSummaryCard } from "@/components/ReportStatusSummaryCard";
import { FetchAllReportButtons, type FetchAllProgressState } from "@/components/FetchAllReportButtons";
import {
  canResumeFetchAll,
  clearFetchAllProgress as clearFetchAllCheckpoint,
  setFetchAllProgress as saveFetchAllCheckpoint,
} from "@/lib/fetchAllProgress";
import { waitForBackend } from "@/api/client";
import {
  buildFetchAllGmailQueries,
  FETCH_ALL_GMAIL_BATCH_SIZE,
} from "@/lib/fetchAllGmailQueries";

const WEEKLY_REPORTS_SENDER = "PB_weekly@global.ntt";
const WEEKLY_REPORTS_SUBJECT = "PB Weekly report";

const YEARLY_MAX_RESULTS = 2000;

/** Indian FY: 1 Apr – 31 Mar; `beforeDate` is exclusive (first day after FY). */
type YearlyFyOption = {
  id: string;
  label: string;
  /** Human range, e.g. "1 Apr 2025 – 31 Mar 2026" */
  rangeLabel: string;
  afterDate: string;
  beforeDate: string;
  storageSuffix: string;
};

const YEARLY_FY_OPTIONS: YearlyFyOption[] = [
  {
    id: "2025-26",
    label: "FY 2025–26",
    rangeLabel: "1 Apr 2025 – 31 Mar 2026",
    afterDate: "2025-04-01",
    beforeDate: "2026-04-01",
    storageSuffix: "2025_2026",
  },
  {
    id: "2026-27",
    label: "FY 2026–27",
    rangeLabel: "1 Apr 2026 – 31 Mar 2027",
    afterDate: "2026-04-01",
    beforeDate: "2027-04-01",
    storageSuffix: "2026_2027",
  },
];

function fyAlertCreationBoundsMs(fy: YearlyFyOption): { startMs: number; endMs: number } {
  const [y, m, d] = fy.afterDate.split("-").map(Number);
  const startMs = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  const end = new Date(fy.beforeDate + "T12:00:00");
  end.setDate(end.getDate() - 1);
  const endMs = startOfLocalDayMs(end);
  return { startMs, endMs };
}

function startOfLocalDayMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
}

/** Parse common CSV date shapes; returns null if unknown (caller may keep row). */
function parseAlertCreationDate(row: Record<string, string>): Date | null {
  const raw = getRowValue(
    row,
    "Created",
    "CreationDate",
    "Creation Date",
    "Creation_Date",
    "Created_On",
    "CreatedOn",
    "AlertCreated",
    "OpenDate",
    "Opened",
    "IncidentCreated",
    "DateCreated",
    "CreationTime",
    "Creation Time",
    "Alert Creation Date",
    "OpenedDate"
  );
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const dt = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const dmy = t.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})(?:\s|$)/);
  if (dmy) {
    let day = Number(dmy[1]);
    let month = Number(dmy[2]);
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    const dt = new Date(year, month - 1, day);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const parsed = Date.parse(t.replace(/\//g, "-"));
  if (!Number.isNaN(parsed)) return new Date(parsed);
  return null;
}

/** True if alert creation falls in the FY window, or date not parseable (keep row). */
function isAlertCreationInFyWindow(row: Record<string, string>, startMs: number, endMs: number): boolean {
  const d = parseAlertCreationDate(row);
  if (!d) return true;
  const dayMs = startOfLocalDayMs(d);
  return dayMs >= startMs && dayMs <= endMs;
}

/** Rows kept for FY UI/export, each tagged with original CSV index for override keys. */
function filterFyAlertRowsWithOriginalIndex(
  csv: CsvAttachment,
  startMs: number,
  endMs: number
): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  csv.rows.forEach((row, origIdx) => {
    const clean: Record<string, string> = { ...row };
    delete (clean as Record<string, unknown>).__rowIndex;
    if (!isAlertCreationInFyWindow(clean, startMs, endMs)) return;
    out.push({ ...clean, __rowIndex: String(origIdx) });
  });
  return out;
}

function firstMondayOnOrAfter(dateStr: string): Date {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  const start = new Date(dateStr + "T12:00:00");
  if (d < start) d.setDate(d.getDate() + 7);
  return d;
}

/** Mondays from first in range through last before `beforeExclusive` (YYYY-MM-DD). */
function mondaysInHalfOpenRange(afterStr: string, beforeExclusiveStr: string): Date[] {
  const end = new Date(beforeExclusiveStr + "T12:00:00");
  const out: Date[] = [];
  let d = firstMondayOnOrAfter(afterStr);
  while (d < end) {
    out.push(new Date(d));
    d.setDate(d.getDate() + 7);
  }
  return out;
}

function startOfWeekMondayFromTs(ts: number): string {
  const x = new Date(ts);
  const local = new Date(x.getFullYear(), x.getMonth(), x.getDate(), 12, 0, 0);
  const day = local.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  local.setDate(local.getDate() + diff);
  return toYYYYMMDD(local);
}

function approxCalendarWeeksInRange(afterStr: string, beforeExclusiveStr: string): number {
  const start = new Date(afterStr + "T12:00:00").getTime();
  const end = new Date(beforeExclusiveStr + "T12:00:00").getTime();
  const days = Math.max(0, (end - start) / 86400000);
  return Math.max(1, Math.round(days / 7));
}

/** Twelve FY months from `afterDate` (Apr → Mar). */
function getFyMonthMetaFromAfter(afterDateStr: string): { key: string; label: string }[] {
  const [y0, m0] = afterDateStr.split("-").map(Number);
  const out: { key: string; label: string }[] = [];
  let y = y0;
  let m = m0;
  for (let i = 0; i < 12; i++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    const d = new Date(y, m - 1, 1);
    const label = d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
    out.push({ key, label });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}
const STATUS_OVERRIDES_KEY = "sentinel_weekly_reports_status_overrides";
const CLOSURE_COMMENTS_OVERRIDES_KEY = "sentinel_weekly_reports_closure_comments_overrides";
const CLOSURE_DATE_OVERRIDES_KEY = "sentinel_weekly_reports_closure_date_overrides";

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
    const   n = Number(internal);
    if (!Number.isNaN(n)) return n;
  }
  const d = new Date(email.date);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function emailToYearMonthKey(email: GmailMessage): string {
  const ts = parseEmailDate(email);
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
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

function formatWeekLabel(weekStartIso: string): string {
  const d = new Date(weekStartIso + "T12:00:00");
  return `Week of ${d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}`;
}

function emailCalendarDateKey(email: GmailMessage): string {
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

/** YYYY-MM-DD from email timestamp (stable scope for overrides across refresh). */
function emailToDateKey(email: GmailMessage): string {
  const ts = parseEmailDate(email);
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function legacyRowStorageKey(emailId: string, row: Record<string, string>): string {
  const inc = getRowValue(row, "IncidentID", "Incident ID");
  const sn = getRowValue(row, "ServicenowTicket", "ServiceNow Ticket", "ServicenowT");
  return `${emailId}-${inc || "n/a"}-${sn || "n/a"}`;
}

/** Status values we count (align with CsvDataTable STATUS_OPTIONS). */
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
): {
  total: number;
  open: number;
  closed: number;
  inProgress: number;
  pending: number;
  merged: number;
  incidentAutoClosed: number;
} {
  const counts = { total: rows.length, open: 0, closed: 0, inProgress: 0, pending: 0, merged: 0, incidentAutoClosed: 0 };
  for (const row of rows) {
    const s = normalizeStatus(getRowStatus(row, headers, getRowKey, statusOverrides));
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

export default function WeeklyReports() {
  const location = useLocation();
  const isYearlyView = location.pathname.replace(/\/$/, "").endsWith("/weekly-reports/yearly");

  const [yearlyFyId, setYearlyFyId] = useState<string>(YEARLY_FY_OPTIONS[0]!.id);
  const activeYearlyFy = useMemo(
    () => YEARLY_FY_OPTIONS.find((o) => o.id === yearlyFyId) ?? YEARLY_FY_OPTIONS[0]!,
    [yearlyFyId]
  );
  const fyCreationBounds = useMemo(() => fyAlertCreationBoundsMs(activeYearlyFy), [activeYearlyFy]);

  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [fetchingAllStatus, setFetchingAllStatus] = useState(false);
  const [fetchAllProgress, setFetchAllProgress] = useState<FetchAllProgressState | null>(null);
  const [fetchAllResumeVersion, setFetchAllResumeVersion] = useState(0);
  const [yearlySection, setYearlySection] = useState<"reports" | "analysis">("reports");
  const [fetchScope, setFetchScope] = useState<"date" | "range">("range");

  const { afterDate, beforeDate } = useMemo(() => {
    if (isYearlyView) {
      return { afterDate: activeYearlyFy.afterDate, beforeDate: activeYearlyFy.beforeDate };
    }
    return getMonthRange(selectedYear, selectedMonth);
  }, [isYearlyView, activeYearlyFy, selectedYear, selectedMonth]);

  const {
    emails,
    overrides: serverOverrides,
    loading: dbLoading,
    syncing,
    error,
    currentUser,
    refetchFromGmail,
    refetchDateRange,
    setLocalOverride,
  } = useWeeklyReportData({
    afterDate,
    beforeDate,
    maxResults: isYearlyView ? YEARLY_MAX_RESULTS : 2000,
  });

  const {
    alertsCsv: reportAlertsCsv,
    overrides: reportOverrides,
    summary: reportAlertsSummary,
    loading: reportAlertsLoading,
    error: reportAlertsError,
    loadRange: loadReportAlerts,
    setLocalOverride: setReportLocalOverride,
  } = useReportAlertsByDate();

  // Legacy `useGmailMessages` exposed `loading` + `isHydratingFromCache`. The
  // DB-backed hook splits its work into `dbLoading` (server read) and `syncing`
  // (Gmail-side fetch). Collapse them into a single `loading` so all existing
  // JSX (Refresh disabled, spinner classes, empty-state gates) keeps working
  // unchanged. `isHydratingFromCache` is no longer meaningful (we hydrate from
  // the server, not IndexedDB) -- alias it to `dbLoading` so the existing
  // "Restoring cached reports" spinner still appears during the first read.
  const loading = dbLoading || syncing;
  const refetch = refetchFromGmail;
  const isHydratingFromCache = dbLoading && emails.length === 0;
  // Keep the legacy localStorage values around in memory only for the
  // one-time "Import my local edits to the server" migration button below.
  const legacyStatusRef = useRef<Record<string, string>>(loadStatusOverrides());
  const legacyClosureCommentsRef = useRef<Record<string, string>>(loadClosureCommentsOverrides());
  const legacyClosureDateRef = useRef<Record<string, string>>(loadClosureDateOverrides());
  const [legacyImportSuppressed, setLegacyImportSuppressed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("sentinel_weekly_reports_legacy_import_done") === "1";
    } catch {
      return false;
    }
  });
  const [legacyImporting, setLegacyImporting] = useState(false);

  /**
   * Derive the three Record<rowKey, string> maps the rest of the page already
   * understands from the single shared server response. Mirrors the legacy
   * shape so downstream handlers (status counting, exports, CsvDataTable
   * props) keep working without rewrites.
   */
  const statusOverrides = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const [key, rec] of Object.entries(serverOverrides)) {
      if (rec.status) out[key] = rec.status;
    }
    return out;
  }, [serverOverrides]);
  const closureCommentsOverrides = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const [key, rec] of Object.entries(serverOverrides)) {
      if (rec.closure_comment) out[key] = rec.closure_comment;
    }
    return out;
  }, [serverOverrides]);
  const closureDateOverrides = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const [key, rec] of Object.entries(serverOverrides)) {
      if (rec.closure_date) out[key] = rec.closure_date;
    }
    return out;
  }, [serverOverrides]);

  const reportOverrideMaps = useMemo(() => overrideMapsFromReport(reportOverrides), [reportOverrides]);
  const reportStatusOverrides = reportOverrideMaps.status;
  const reportClosureCommentsOverrides = reportOverrideMaps.closureComments;
  const reportClosureDateOverrides = reportOverrideMaps.closureDate;

  const getUnifiedRowKey = useCallback(
    () => (row: Record<string, string>) => unifiedRowKey(row),
    []
  );

  const [yearlyCreationScope, setYearlyCreationScope] = useState<"date" | "range">("date");
  const [yearlyCreationDate, setYearlyCreationDate] = useState<string>(() => toYYYYMMDD(new Date()));
  const [yearlyCreationRange, setYearlyCreationRange] = useState<{
    from: Date | undefined;
    to: Date | undefined;
  }>({ from: undefined, to: undefined });
  const [yearlyCreationCalendarOpen, setYearlyCreationCalendarOpen] = useState(false);

  useEffect(() => {
    if (!isYearlyView) return;
    void loadReportAlerts(activeYearlyFy.afterDate, activeYearlyFy.beforeDate);
  }, [isYearlyView, activeYearlyFy.afterDate, activeYearlyFy.beforeDate, loadReportAlerts]);

  const filteredYearlyReportRows = useMemo(() => {
    if (!reportAlertsCsv?.rows?.length) return [];
    const rows = reportAlertsCsv.rows;
    if (yearlyCreationScope === "date") {
      return rows.filter((r) => rowCreationDateKey(r) === yearlyCreationDate);
    }
    const from = yearlyCreationRange.from ? toYYYYMMDD(yearlyCreationRange.from) : null;
    const to = yearlyCreationRange.to
      ? toYYYYMMDD(yearlyCreationRange.to)
      : yearlyCreationRange.from
        ? toYYYYMMDD(yearlyCreationRange.from)
        : null;
    if (!from) return rows;
    return rows.filter((r) => {
      const d = rowCreationDateKey(r);
      if (!d) return true;
      return d >= from && (!to || d <= to);
    });
  }, [reportAlertsCsv, yearlyCreationScope, yearlyCreationDate, yearlyCreationRange]);

  const emailsSortedByDate = useMemo(() => {
    return [...emails].sort((a, b) => parseEmailDate(a) - parseEmailDate(b));
  }, [emails]);

  const emailsWithCsv = useMemo(
    () => emailsSortedByDate.filter((e) => e.csvAttachment?.rows?.length),
    [emailsSortedByDate]
  );

  /** Yearly view: only rows whose creation date falls in FY; preserves original row index for overrides. Monthly: same as raw. */
  const emailsWithCsvDisplay = useMemo(() => {
    if (!isYearlyView) return emailsWithCsv;
    const { startMs, endMs } = fyCreationBounds;
    return emailsWithCsv
      .map((e) => {
        const csv = e.csvAttachment!;
        const rows = filterFyAlertRowsWithOriginalIndex(csv, startMs, endMs);
        return { ...e, csvAttachment: { ...csv, rows } };
      })
      .filter((e) => e.csvAttachment.rows.length > 0);
  }, [emailsWithCsv, isYearlyView, fyCreationBounds]);

  const getRowKey = useCallback((emailId: string) => (row: Record<string, string>) => {
    const idx = (row as Record<string, unknown>).__rowIndex;
    if (idx != null && String(idx).trim() !== "") {
      return `${emailId}-r${idx}`;
    }
    return legacyRowStorageKey(emailId, row);
  }, []);

  const [fetchDate, setFetchDate] = useState<string>(() => toYYYYMMDD(new Date()));
  const fetchDateMin = useMemo(() => afterDate, [afterDate]);
  const fetchDateMax = useMemo(() => {
    const [y, m] = beforeDate.split("-").map(Number);
    const last = new Date(y, m - 1, 0);
    return toYYYYMMDD(last);
  }, [beforeDate]);
  const fetchDateForMonth = useMemo(() => {
    if (isYearlyView) {
      const first = activeYearlyFy.afterDate;
      const [y, m] = activeYearlyFy.beforeDate.split("-").map(Number);
      const last = new Date(y, m - 1, 0);
      const lastStr = toYYYYMMDD(last);
      const today = toYYYYMMDD(new Date());
      if (today >= first && today <= lastStr) return today;
      return first;
    }
    const [y, m] = afterDate.split("-").map(Number);
    const last = new Date(y, m, 0);
    const today = toYYYYMMDD(new Date());
    if (today >= afterDate && today <= toYYYYMMDD(last)) return today;
    return afterDate;
  }, [isYearlyView, afterDate, activeYearlyFy]);

  const reloadYearlyReportAlerts = useCallback(() => {
    if (!isYearlyView) return;
    void loadReportAlerts(activeYearlyFy.afterDate, activeYearlyFy.beforeDate);
  }, [isYearlyView, activeYearlyFy.afterDate, activeYearlyFy.beforeDate, loadReportAlerts]);

  const handleFetchThisDate = useCallback(() => {
    const after = fetchDate;
    const before = nextDay(fetchDate);
    refetchDateRange(after, before).then(() => {
      reloadYearlyReportAlerts();
      toast({ title: "Date fetched", description: `Data for ${fetchDate} merged into month view.` });
    });
  }, [fetchDate, refetchDateRange, reloadYearlyReportAlerts]);

  const handleFetchSelectedScope = useCallback(() => {
    if (fetchScope === "date") {
      handleFetchThisDate();
      return;
    }
    void refetch().then(() => reloadYearlyReportAlerts());
  }, [fetchScope, handleFetchThisDate, refetch, reloadYearlyReportAlerts]);

  useEffect(() => {
    setFetchDate(fetchDateForMonth);
  }, [selectedYear, selectedMonth, fetchDateForMonth, isYearlyView]);

  /**
   * `null` = user hasn't picked a report yet → default to the LATEST one in the loaded list
   * (emailsWithCsvDisplay is sorted ascending by date, so latest = last index).
   * Reset to `null` whenever the month / FY context changes so the new period also opens on its latest report.
   */
  const [selectedReportIndex, setSelectedReportIndex] = useState<number | null>(null);
  const [yearlyAlertDate, setYearlyAlertDate] = useState<string>("");
  const [yearlyCalendarOpen, setYearlyCalendarOpen] = useState(false);
  const [yearlyCalendarMonth, setYearlyCalendarMonth] = useState<Date>(() => new Date());
  const safeReportIndex = useMemo(() => {
    if (emailsWithCsvDisplay.length === 0) return 0;
    if (selectedReportIndex == null) return emailsWithCsvDisplay.length - 1;
    return Math.min(Math.max(0, selectedReportIndex), emailsWithCsvDisplay.length - 1);
  }, [emailsWithCsvDisplay.length, selectedReportIndex]);

  const yearlyAlertOptions = useMemo(() => {
    if (!isYearlyView) return [] as Array<{
      email: GmailMessage;
      year: string;
      month: string;
      monthLabel: string;
      week: string;
      weekLabel: string;
      date: string;
      dateLabel: string;
      ts: number;
    }>;
    return [...emailsWithCsvDisplay]
      .map((email) => {
        const ts = parseEmailDate(email);
        const d = new Date(ts);
        return {
          email,
          year: String(d.getFullYear()),
          month: String(d.getMonth() + 1).padStart(2, "0"),
          monthLabel: d.toLocaleDateString(undefined, { month: "long" }),
          week: startOfWeekMondayFromTs(ts),
          weekLabel: formatWeekLabel(startOfWeekMondayFromTs(ts)),
          date: toYYYYMMDD(d),
          dateLabel: formatReportDate(email),
          ts,
        };
      })
      .sort((a, b) => a.ts - b.ts);
  }, [isYearlyView, emailsWithCsvDisplay]);

  const latestYearlyAlert = yearlyAlertOptions[yearlyAlertOptions.length - 1] ?? null;

  useEffect(() => {
    if (!isYearlyView) return;
    if (!latestYearlyAlert) {
      setYearlyAlertDate("");
      return;
    }
    setYearlyAlertDate((prev) => (yearlyAlertOptions.some((o) => o.date === prev) ? prev : latestYearlyAlert.date));
  }, [isYearlyView, latestYearlyAlert, yearlyAlertOptions]);

  useEffect(() => {
    if (!isYearlyView || !yearlyAlertDate) return;
    setYearlyCalendarMonth(parseISODateLocal(yearlyAlertDate));
  }, [isYearlyView, yearlyAlertDate]);

  const yearlyReportDateSet = useMemo(() => new Set(yearlyAlertOptions.map((o) => o.date)), [yearlyAlertOptions]);

  const selectedYearlyEmail = useMemo(() => {
    const match = yearlyAlertOptions.find((o) => o.date === yearlyAlertDate);
    return match?.email ?? latestYearlyAlert?.email ?? null;
  }, [yearlyAlertOptions, yearlyAlertDate, latestYearlyAlert]);

  const selectedEmail = isYearlyView ? selectedYearlyEmail : emailsWithCsvDisplay[safeReportIndex] ?? null;

  useEffect(() => {
    setSelectedReportIndex(null);
  }, [yearlyFyId, isYearlyView, selectedYear, selectedMonth]);

  const monthStats = useMemo(() => {
    if (isYearlyView && reportAlertsCsv?.headers?.length && reportAlertsCsv.rows.length) {
      return countByStatus(
        reportAlertsCsv.rows,
        reportAlertsCsv.headers,
        getUnifiedRowKey(),
        reportStatusOverrides
      );
    }
    let total = 0;
    const counts = { open: 0, closed: 0, inProgress: 0, pending: 0, merged: 0, incidentAutoClosed: 0 };
    for (const email of emailsWithCsvDisplay) {
      const csv = email.csvAttachment;
      if (!csv?.headers?.length || !csv.rows?.length) continue;
      const rowsWithIdx = csv.rows.map((r, i) => {
        const preserved = (r as Record<string, unknown>).__rowIndex;
        const idxStr =
          preserved != null && String(preserved).trim() !== "" ? String(preserved) : String(i);
        return { ...r, __rowIndex: idxStr };
      });
      const rk = getRowKey(email.id);
      const c = countByStatus(rowsWithIdx, csv.headers, rk, statusOverrides);
      total += c.total;
      counts.open += c.open;
      counts.closed += c.closed;
      counts.inProgress += c.inProgress;
      counts.pending += c.pending;
      counts.merged += c.merged;
      counts.incidentAutoClosed += c.incidentAutoClosed;
    }
    return { total, ...counts };
  }, [
    isYearlyView,
    reportAlertsCsv,
    getUnifiedRowKey,
    reportStatusOverrides,
    emailsWithCsvDisplay,
    statusOverrides,
    getRowKey,
  ]);

  const yearlyMonthTrend = useMemo((): YearlyMonthTrendRow[] => {
    if (!isYearlyView) return [];
    const { startMs, endMs } = fyCreationBounds;
    const fyMonths = getFyMonthMetaFromAfter(activeYearlyFy.afterDate);
    const empty = () => ({
      reports: 0,
      rows: 0,
      open: 0,
      closed: 0,
      inProgress: 0,
      pending: 0,
      merged: 0,
      incidentAutoClosed: 0,
    });
    const byKey = new Map<string, ReturnType<typeof empty>>();
    for (const fm of fyMonths) byKey.set(fm.key, empty());
    for (const email of emailsSortedByDate) {
      const csv = email.csvAttachment;
      if (!csv?.headers?.length || !csv.rows?.length) continue;
      const ym = emailToYearMonthKey(email);
      const b = byKey.get(ym);
      if (!b) continue;
      const rowsWithIdx = filterFyAlertRowsWithOriginalIndex(csv, startMs, endMs);
      b.reports += 1;
      const rk = getRowKey(email.id);
      const c = countByStatus(rowsWithIdx, csv.headers, rk, statusOverrides);
      b.rows += c.total;
      b.open += c.open;
      b.closed += c.closed;
      b.inProgress += c.inProgress;
      b.pending += c.pending;
      b.merged += c.merged;
      b.incidentAutoClosed += c.incidentAutoClosed;
    }
    return fyMonths.map((fm) => ({
      key: fm.key,
      label: fm.label,
      ...(byKey.get(fm.key) ?? empty()),
    }));
  }, [isYearlyView, emailsSortedByDate, statusOverrides, getRowKey, fyCreationBounds, activeYearlyFy.afterDate]);

  const yearlyCoverage = useMemo(() => {
    if (!isYearlyView) return null;
    const noCsv = emailsSortedByDate.filter((e) => !(e.csvAttachment?.rows && e.csvAttachment.rows.length > 0));
    const mondays = mondaysInHalfOpenRange(activeYearlyFy.afterDate, activeYearlyFy.beforeDate);
    const covered = new Set<string>();
    for (const e of emailsSortedByDate) {
      const ts = parseEmailDate(e);
      if (!ts) continue;
      covered.add(startOfWeekMondayFromTs(ts));
    }
    const missingWeekMondays = mondays.map((d) => toYYYYMMDD(d)).filter((mon) => !covered.has(mon));
    return {
      totalFromApi: emailsSortedByDate.length,
      withCsv: emailsWithCsv.length,
      withoutCsv: noCsv.length,
      maxResults: YEARLY_MAX_RESULTS,
      approxWeeksInRange: approxCalendarWeeksInRange(activeYearlyFy.afterDate, activeYearlyFy.beforeDate),
      missingWeekMondays,
      noCsvEmails: noCsv.map((e) => ({ id: e.id, subject: e.subject, date: e.date })),
    };
  }, [isYearlyView, emailsSortedByDate, emailsWithCsv.length, activeYearlyFy]);

  const csvForTable = useMemo((): CsvAttachment | null => {
    if (isYearlyView) {
      if (!reportAlertsCsv?.headers?.length) return null;
      return {
        filename: reportAlertsCsv.filename || "pb_alerts.csv",
        headers: reportAlertsCsv.headers,
        rows: filteredYearlyReportRows,
      };
    }
    if (!selectedEmail?.csvAttachment) return null;
    const { filename, headers, rows } = selectedEmail.csvAttachment;
    return {
      filename: filename || "weekly_report.csv",
      headers,
      rows: rows.map((r, i) => {
        const preserved = (r as Record<string, unknown>).__rowIndex;
        const idxStr =
          preserved != null && String(preserved).trim() !== "" ? String(preserved) : String(i);
        return { ...r, __rowIndex: idxStr };
      }),
    };
  }, [
    isYearlyView,
    reportAlertsCsv,
    filteredYearlyReportRows,
    selectedEmail?.csvAttachment,
    selectedEmail?.id,
  ]);

  const selectedDateStats = useMemo(() => {
    if (isYearlyView) {
      if (!reportAlertsCsv?.headers?.length)
        return { total: 0, open: 0, closed: 0, inProgress: 0, pending: 0, merged: 0, incidentAutoClosed: 0 };
      return countByStatus(
        filteredYearlyReportRows,
        reportAlertsCsv.headers,
        getUnifiedRowKey(),
        reportStatusOverrides
      );
    }
    if (!csvForTable)
      return { total: 0, open: 0, closed: 0, inProgress: 0, pending: 0, merged: 0, incidentAutoClosed: 0 };
    const { headers, rows } = csvForTable;
    const rk = selectedEmail ? getRowKey(selectedEmail.id) : () => "";
    return countByStatus(rows, headers, rk, statusOverrides);
  }, [
    isYearlyView,
    reportAlertsCsv,
    filteredYearlyReportRows,
    getUnifiedRowKey,
    reportStatusOverrides,
    csvForTable,
    selectedEmail,
    getRowKey,
    statusOverrides,
  ]);

  const [trailEmail, setTrailEmail] = useState<GmailMessage | null>(null);
  const [trailLoading, setTrailLoading] = useState(false);

  /**
   * Helper: derive (messageId, rowIndex) from a CSV row + emailId.
   * `__rowIndex` is the original CSV position the backend stored; falls back
   * to the displayed array index when missing.
   */
  const resolveRowIndex = useCallback(
    (row: Record<string, string>, fallbackIndex: number = 0): number => {
      const raw = (row as Record<string, unknown>).__rowIndex;
      if (raw != null && String(raw).trim() !== "") {
        const n = Number(raw);
        if (Number.isFinite(n)) return n;
      }
      return fallbackIndex;
    },
    []
  );

  /** Persist one override field by PATCHing the API; optimistically update local state for snappy UI. */
  const persistOverride = useCallback(
    async (
      emailId: string,
      row: Record<string, string>,
      field: OverrideField,
      value: string,
      fallbackIndex: number = 0,
      options?: { silent?: boolean }
    ) => {
      const rowIndex = resolveRowIndex(row, fallbackIndex);
      const actorEmail =
        currentUser && currentUser !== "anonymous" ? currentUser.email : undefined;
      setLocalOverride(
        emailId,
        rowIndex,
        field,
        value,
        actorEmail ? { email: actorEmail } : undefined
      );
      try {
        await upsertOverride({ messageId: emailId, rowIndex, field, value });
      } catch (err) {
        if (options?.silent) return;
        if (err instanceof WeeklyReportsAuthError) {
          toast({
            title: "Sign in to Gmail",
            description:
              "Your edit was made locally but could not be saved to the server until you reconnect Gmail.",
            variant: "destructive",
          });
        } else {
          toast({
            title: "Could not save edit",
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          });
        }
      }
    },
    [currentUser, resolveRowIndex, setLocalOverride]
  );

  const persistReportOverride = useCallback(
    async (row: Record<string, string>, field: OverrideField, value: string) => {
      const key = unifiedRowKey(row);
      if (!key) return;
      setReportLocalOverride(key, field, value);
      try {
        await persistUnifiedReportOverride(row, field, value);
      } catch (err) {
        toast({
          title: "Could not save edit",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      }
    },
    [setReportLocalOverride]
  );

  const handleReportStatusChange = useCallback(
    (row: Record<string, string>, newStatus: string) => {
      void persistReportOverride(row, "status", newStatus);
    },
    [persistReportOverride]
  );

  const handleReportClosureCommentsChange = useCallback(
    (row: Record<string, string>, newValue: string) => {
      void persistReportOverride(row, "closure_comment", newValue);
    },
    [persistReportOverride]
  );

  const handleReportClosureDateChange = useCallback(
    (row: Record<string, string>, newValue: string) => {
      void persistReportOverride(row, "closure_date", newValue);
    },
    [persistReportOverride]
  );

  const handleStatusChange = useCallback(
    (row: Record<string, string>, newStatus: string, emailId: string) => {
      void persistOverride(emailId, row, "status", newStatus);
    },
    [persistOverride]
  );

  const handleClosureCommentsChange = useCallback(
    (row: Record<string, string>, newValue: string, emailId: string) => {
      void persistOverride(emailId, row, "closure_comment", newValue);
    },
    [persistOverride]
  );

  const handleClosureDateChange = useCallback(
    (row: Record<string, string>, newValue: string, emailId: string) => {
      void persistOverride(emailId, row, "closure_date", newValue);
    },
    [persistOverride]
  );

  /**
   * One-shot migration: detect legacy localStorage overrides captured at mount,
   * upload them to the server, then mark the import as done so the UI stops
   * offering it. Existing server values are NOT overwritten (server-side guard).
   */
  const legacyImportableCount = useMemo(() => {
    return (
      Object.keys(legacyStatusRef.current).length +
      Object.keys(legacyClosureCommentsRef.current).length +
      Object.keys(legacyClosureDateRef.current).length
    );
  }, []);

  const handleImportLegacyOverrides = useCallback(async () => {
    const items: ImportOverridesItem[] = [];
    const pushAll = (source: Record<string, string>, field: OverrideField) => {
      for (const [key, value] of Object.entries(source)) {
        if (!value || !value.trim()) continue;
        // Legacy keys look like "<messageId>-r<rowIndex>" or the older
        // "<messageId>-<incidentId>-<snTicket>" shape. We can only migrate the
        // first kind reliably -- the older shape requires a row lookup we no
        // longer have client-side. Skip the legacy shape silently.
        const m = key.match(/^(.+)-r(\d+)$/);
        if (!m) continue;
        const messageId = m[1];
        const rowIndex = Number(m[2]);
        if (!messageId || !Number.isFinite(rowIndex)) continue;
        items.push({ message_id: messageId, row_index: rowIndex, field, value });
      }
    };
    pushAll(legacyStatusRef.current, "status");
    pushAll(legacyClosureCommentsRef.current, "closure_comment");
    pushAll(legacyClosureDateRef.current, "closure_date");

    if (items.length === 0) {
      toast({
        title: "Nothing to import",
        description:
          "No row-keyed legacy overrides found in this browser. Older incident-keyed entries can't be migrated automatically.",
      });
      return;
    }

    setLegacyImporting(true);
    try {
      const resp = await importOverrides(items);
      try {
        localStorage.setItem("sentinel_weekly_reports_legacy_import_done", "1");
      } catch {
        /* ignore */
      }
      setLegacyImportSuppressed(true);
      toast({
        title: "Local edits imported",
        description:
          `${resp.imported} new, ${resp.skippedExisting} already on server, ` +
          `${resp.skippedUnknownEmail} skipped (sync those reports first), ` +
          `${resp.skippedInvalid} invalid.`,
      });
      // Refresh server overrides so the table reflects the just-imported values.
      void refetch();
    } catch (err) {
      if (err instanceof WeeklyReportsAuthError) {
        toast({
          title: "Sign in to Gmail",
          description: "Reconnect Gmail and try the import again.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Import failed",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      }
    } finally {
      setLegacyImporting(false);
    }
  }, [refetch]);

  const fetchAllResume = useMemo(() => {
    const rows = csvForTable?.rows;
    if (!selectedEmail?.id || !rows?.length) {
      return { canResume: false, resumeFromIndex: 0 };
    }
    return canResumeFetchAll(selectedEmail.id, rows.length);
    // fetchAllResumeVersion: bump after run completes or report changes
  }, [selectedEmail?.id, csvForTable?.rows?.length, fetchAllResumeVersion]);

  useEffect(() => {
    setFetchAllResumeVersion((v) => v + 1);
  }, [selectedEmail?.id]);

  const handleFetchAllLatestStatus = useCallback(
    async (startFromBeginning = false) => {
    if (!csvForTable?.rows?.length || !selectedEmail) {
      toast({ title: "No data", description: "Load a weekly report with CSV rows first.", variant: "destructive" });
      return;
    }
    const emailId = selectedEmail.id;
    const rows = csvForTable.rows;
    const headers = csvForTable.headers ?? [];
    const rk = getRowKey(emailId);
    const total = rows.length;

    if (startFromBeginning) {
      clearFetchAllCheckpoint(emailId);
    }
    const resumeInfo = startFromBeginning
      ? { canResume: false, resumeFromIndex: 0, checkpoint: null }
      : canResumeFetchAll(emailId, total);
    const startIndex = resumeInfo.resumeFromIndex;

    if (startFromBeginning) {
      toast({
        title: "Fetch all started",
        description: `Processing all ${total} rows from row 1.`,
      });
    } else if (resumeInfo.canResume) {
      toast({
        title: "Resuming fetch all",
        description: `Continuing at row ${startIndex + 1} of ${total}. Click “Start from row 1” to run the full report again.`,
      });
    }

    setFetchingAllStatus(true);
    setFetchAllProgress({ current: startIndex + 1, total, gmailChecked: 0, updated: 0, skippedNoId: 0, mergedSkipped: 0, errors: 0, noClosureInGmail: 0, phase: "scan" });
    let updated = 0;
    let datesSet = 0;
    let mergedNtt = 0;
    let mergedDateFromCreated = 0;
    let gmailChecked = 0;
    let skippedNoId = 0;
    let errors = 0;
    let consecutiveErrors = 0;
    let aborted = false;
    let lastSuccessfulRow = startIndex > 0 ? startIndex - 1 : -1;
    let noClosureInGmail = 0;
    const bumpProgress = (current: number, phase: "scan" | "gmail" = "scan") => {
      setFetchAllProgress({
        current,
        total,
        gmailChecked,
        updated,
        skippedNoId,
        mergedSkipped: mergedNtt,
        errors,
        noClosureInGmail,
        phase,
      });
    };
    try {
      type GmailQueueItem = {
        i: number;
        rowIndex: number;
        queries: string[];
      };
      const actorEmail =
        currentUser && currentUser !== "anonymous" ? currentUser.email : undefined;

      const applyLocalClosure = (rowIndex: number, result: FetchClosureBatchResult) => {
        if (!result.persisted) return;
        const statusToSet =
          result.suggestedStatus === "Incident Auto Closed" ? "Incident Auto Closed" : "Closed";
        const closure = (result.suggestedClosureComment ?? "").trim() || "Closed from email";
        const dateIso = (result.matchedEmailDateIso ?? "").trim();
        setLocalOverride(
          emailId,
          rowIndex,
          "status",
          statusToSet,
          actorEmail ? { email: actorEmail } : undefined
        );
        setLocalOverride(
          emailId,
          rowIndex,
          "closure_comment",
          closure,
          actorEmail ? { email: actorEmail } : undefined
        );
        if (dateIso) {
          setLocalOverride(
            emailId,
            rowIndex,
            "closure_date",
            dateIso,
            actorEmail ? { email: actorEmail } : undefined
          );
        }
      };

      /** Process CSV rows in chunks so progress shows 1, 2, 3… not jumping to first Gmail row. */
      for (
        let chunkStart = startIndex;
        chunkStart < rows.length && !aborted;
        chunkStart += FETCH_ALL_GMAIL_BATCH_SIZE
      ) {
        const chunkEnd = Math.min(chunkStart + FETCH_ALL_GMAIL_BATCH_SIZE, rows.length);
        const gmailItems: GmailQueueItem[] = [];
        const chunkMergedBulk: ImportOverridesItem[] = [];

        for (let i = chunkStart; i < chunkEnd; i++) {
          bumpProgress(i + 1);
          const row = rows[i];
          const rawIdx = (row as Record<string, unknown>).__rowIndex;
          let idxStr = String(i);
          if (rawIdx != null && String(rawIdx).trim() !== "") {
            const n = Number(rawIdx);
            idxStr = Number.isFinite(n) ? String(n) : String(i);
          }
          const rowWithIdx = { ...row, __rowIndex: idxStr };
          const rowIndex = resolveRowIndex(rowWithIdx, i);
          if (headers.length) {
            const st = normalizeStatus(getRowStatus(rowWithIdx, headers, rk, statusOverrides));
            if (st === "Merged") {
              const createdVal = getRowValue(row, "Created", "Created On").trim();
              chunkMergedBulk.push({
                message_id: emailId,
                row_index: rowIndex,
                field: "closure_comment",
                value: "NTT",
              });
              setLocalOverride(
                emailId,
                rowIndex,
                "closure_comment",
                "NTT",
                actorEmail ? { email: actorEmail } : undefined
              );
              if (createdVal) {
                mergedDateFromCreated++;
                chunkMergedBulk.push({
                  message_id: emailId,
                  row_index: rowIndex,
                  field: "closure_date",
                  value: createdVal,
                });
                setLocalOverride(
                  emailId,
                  rowIndex,
                  "closure_date",
                  createdVal,
                  actorEmail ? { email: actorEmail } : undefined
                );
              }
              mergedNtt++;
              continue;
            }
          }
          const queries = buildFetchAllGmailQueries(row);
          if (queries.length === 0) {
            skippedNoId++;
            continue;
          }
          gmailItems.push({ i, rowIndex, queries });
        }

        if (chunkMergedBulk.length > 0) {
          try {
            await bulkUpsertOverrides(chunkMergedBulk);
          } catch {
            /* optimistic UI already updated */
          }
        }

        const chunkLastRow = chunkEnd - 1;

        if (gmailItems.length === 0) {
          lastSuccessfulRow = chunkLastRow;
          saveFetchAllCheckpoint(emailId, lastSuccessfulRow, total);
          continue;
        }

        try {
          const { results, updated: batchUpdated, datesSet: batchDates } =
            await fetchClosureBatchResilient({
              messageId: emailId,
              items: gmailItems.map((c) => ({ row_index: c.rowIndex, queries: c.queries })),
            });
          gmailChecked += gmailItems.length;
          updated += batchUpdated;
          datesSet += batchDates;
          bumpProgress(chunkLastRow + 1, "gmail");
          for (const result of results) {
            if (result.error && !result.suggestedStatus) {
              if (result.notFound || /no matching email/i.test(result.error)) {
                noClosureInGmail++;
              } else {
                errors++;
              }
            } else if (!result.suggestedStatus && (result.notFound || !result.error)) {
              noClosureInGmail++;
            }
            applyLocalClosure(result.rowIndex, result);
          }
          lastSuccessfulRow = chunkLastRow;
          consecutiveErrors = 0;
          saveFetchAllCheckpoint(emailId, lastSuccessfulRow, total);
        } catch {
          errors += gmailItems.length;
          consecutiveErrors++;
          if (consecutiveErrors >= 3) {
            toast({
              title: "Backend connection lost",
              description: "Restart python main.py in Backend/, then click Resume.",
            });
            const up = await waitForBackend(30_000, 5_000);
            if (!up) {
              toast({
                title: "Fetch paused",
                description: `Stopped before row ${chunkStart + 1} of ${total}. Restart backend, then Resume.`,
                variant: "destructive",
              });
              aborted = true;
            } else {
              consecutiveErrors = 0;
              chunkStart -= FETCH_ALL_GMAIL_BATCH_SIZE;
            }
          }
          if (lastSuccessfulRow >= startIndex) {
            saveFetchAllCheckpoint(emailId, lastSuccessfulRow, total);
          }
        }
      }
      if (!aborted) {
        clearFetchAllCheckpoint(emailId);
      }
      const parts: string[] = [];
      if (aborted) {
        parts.push("checkpoint saved — use Resume after restarting the backend");
      } else if (startIndex > 0) {
        parts.push(`resumed from row ${startIndex + 1}`);
      }
      parts.push(`Gmail checked ${gmailChecked} of ${total} rows`);
      if (mergedNtt > 0) {
        parts.push(
          mergedDateFromCreated > 0
            ? `${mergedNtt} merged → NTT (${mergedDateFromCreated} with closure date from Created)`
            : `${mergedNtt} merged → NTT`
        );
      }
      if (updated > 0) {
        parts.push(datesSet > 0 ? `${updated} closed from Gmail (${datesSet} with closure date)` : `${updated} closed from Gmail`);
      }
      if (skippedNoId > 0) parts.push(`${skippedNoId} skipped (no incident/ticket ID)`);
      if (noClosureInGmail > 0) parts.push(`${noClosureInGmail} still open (no closure email in Gmail)`);
      if (errors > 0) parts.push(`${errors} failed lookups (retry or resume)`);
      if (updated === 0 && mergedNtt === 0) parts.push("No rows updated");
      toast({
        title: aborted ? "Fetch paused (this report)" : "Fetch all complete (this report)",
        description: parts.join("; ") + ".",
      });
    } finally {
      setFetchingAllStatus(false);
      setFetchAllProgress(null);
      setFetchAllResumeVersion((v) => v + 1);
    }
  },
    [selectedEmail, csvForTable, getRowKey, statusOverrides, persistOverride, resolveRowIndex, setLocalOverride, currentUser]
  );

  const handleDownloadXlsx = useCallback(() => {
    if (!csvForTable || !selectedEmail) {
      toast({ title: "Nothing to export", description: "Select a report with CSV data.", variant: "destructive" });
      return;
    }
    const rk = getRowKey(selectedEmail.id);
    const merged = mergeOverridesIntoRows(
      csvForTable,
      rk,
      statusOverrides,
      closureCommentsOverrides,
      closureDateOverrides
    );
    const exportCsv: CsvAttachment = {
      filename: csvForTable.filename,
      headers: csvForTable.headers,
      rows: merged,
    };
    const base = `weekly_${emailToDateKey(selectedEmail)}`;
    downloadCsvAsXlsx(exportCsv, base);
    toast({ title: "Download started", description: `${base}.xlsx` });
  }, [csvForTable, selectedEmail, getRowKey, statusOverrides, closureCommentsOverrides, closureDateOverrides]);

  const handleDownloadConsolidatedXlsx = useCallback(() => {
    const list =
      isYearlyView
        ? [...emailsWithCsvDisplay].sort((a, b) => parseEmailDate(a) - parseEmailDate(b))
        : emailsSortedByDate.filter((e) => e.csvAttachment?.rows?.length);
    if (list.length === 0) {
      toast({
        title: "Nothing to export",
        description: "Load at least one weekly report with a CSV attachment.",
        variant: "destructive",
      });
      return;
    }
    const sources = list.map((e) => {
      const att = e.csvAttachment!;
      return {
        messageId: e.id,
        reportDateYyyyMmDd: emailToDateKey(e),
        csv: {
          filename: att.filename || "weekly.csv",
          headers: att.headers,
          rows: att.rows,
        },
        getRowKey: getRowKey(e.id),
      };
    });
    const consolidated = buildConsolidatedWeeklyReportsCsv(
      sources,
      statusOverrides,
      closureCommentsOverrides,
      closureDateOverrides
    );
    const base = isYearlyView
      ? `weekly_fy${activeYearlyFy.id}_consolidated`
      : `weekly_${selectedYear}_${String(selectedMonth).padStart(2, "0")}_consolidated`;
    downloadCsvAsXlsx(consolidated, base, "Consolidated");
    toast({
      title: "Consolidated export started",
      description: `${consolidated.rows.length} row(s) from ${sources.length} report(s) → ${base}.xlsx`,
    });
  }, [
    emailsSortedByDate,
    emailsWithCsvDisplay,
    getRowKey,
    statusOverrides,
    closureCommentsOverrides,
    closureDateOverrides,
    isYearlyView,
    activeYearlyFy.id,
    selectedYear,
    selectedMonth,
  ]);

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
            {isYearlyView ? (
              <div className="px-6 py-4 space-y-4">
                <div className="flex flex-col gap-3 min-[880px]:flex-row min-[880px]:items-start min-[880px]:justify-between">
                  <div className="min-w-0 space-y-1 pr-2">
                    <h1 className="text-xl min-[880px]:text-2xl font-bold text-foreground tracking-tight">
                      Weekly reports (FY roll-up)
                    </h1>
                    <p className="text-sm text-muted-foreground leading-relaxed max-w-3xl">
                      Table, trends, and exports include only rows whose alert creation date is in{" "}
                      <span className="text-foreground font-medium">{activeYearlyFy.rangeLabel}</span> (from{" "}
                      {WEEKLY_REPORTS_SENDER}). Rows with no readable creation date are kept.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 self-start">
                    <ThemeToggle />
                    <NotificationsPanel />
                  </div>
                </div>

                <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between xl:gap-6 min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2 xl:flex-1">
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-2 py-1.5">
                      <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">Fetch</span>
                      <Select value={fetchScope} onValueChange={(v) => setFetchScope(v as "date" | "range")}>
                        <SelectTrigger className="h-9 w-[11rem] bg-background">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="date">Week data</SelectItem>
                          <SelectItem value="range">Yearly data</SelectItem>
                        </SelectContent>
                      </Select>
                      {fetchScope === "date" && (
                        <input
                          type="date"
                          className="h-9 rounded-md border border-input bg-background px-2 text-sm w-[9rem] shrink-0"
                          min={fetchDateMin}
                          max={fetchDateMax}
                          value={fetchDate}
                          onChange={(e) => setFetchDate(e.target.value)}
                        />
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleFetchSelectedScope}
                        disabled={loading}
                        className="shrink-0 h-9"
                      >
                        <RefreshCw className={`h-4 w-4 sm:mr-2 ${loading ? "animate-spin" : ""}`} />
                        {loading ? "Fetching..." : "Fetch data"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDownloadXlsx}
                        disabled={!csvForTable?.rows.length}
                        className="shrink-0 h-9"
                        title="Download current alert table as Excel"
                      >
                        <Download className="h-4 w-4 sm:mr-2" />
                        <span className="hidden sm:inline">Download alerts .xlsx</span>
                        <span className="sm:hidden">Download</span>
                      </Button>
                    </div>
                    <div className="xl:ml-auto">
                      <ToggleGroup
                        type="single"
                        value={yearlySection}
                        onValueChange={(v) => v && setYearlySection(v as "reports" | "analysis")}
                        variant="outline"
                        className="justify-start"
                      >
                        <ToggleGroupItem value="reports" className="gap-1.5">
                          <LayoutGrid className="h-4 w-4" />
                          Alerts
                        </ToggleGroupItem>
                        <ToggleGroupItem value="analysis" className="gap-1.5">
                          <BarChart3 className="h-4 w-4" />
                          Trends
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 px-6 py-2 min-w-0">
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
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-2 py-1.5">
                <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">Fetch</span>
                <Select value={fetchScope} onValueChange={(v) => setFetchScope(v as "date" | "range")}>
                  <SelectTrigger className="h-9 w-[11rem] bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="date">Week data</SelectItem>
                    <SelectItem value="range">Monthly data</SelectItem>
                  </SelectContent>
                </Select>
                {fetchScope === "date" && (
                  <input
                    type="date"
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm w-[8.5rem]"
                    min={fetchDateMin}
                    max={fetchDateMax}
                    value={fetchDate}
                    onChange={(e) => setFetchDate(e.target.value)}
                  />
                )}
                <Button variant="outline" size="sm" onClick={handleFetchSelectedScope} disabled={loading} className="shrink-0 h-9">
                  <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                  {loading ? "Fetching..." : "Fetch data"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadXlsx}
                  disabled={!csvForTable?.rows.length}
                  className="shrink-0 h-9"
                  title="Download current alert table as Excel"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download alerts .xlsx
                </Button>
              </div>
                <div className="min-w-0 flex-1 basis-[min(100%,14rem)]">
                  <h1 className="text-xl lg:text-2xl font-bold text-foreground truncate">Weekly Reports</h1>
                  <p className="text-sm text-muted-foreground truncate">PB Weekly report emails from {WEEKLY_REPORTS_SENDER}</p>
              </div>
              <div className="flex items-center gap-2 ml-auto shrink-0">
                <ThemeToggle />
                <NotificationsPanel />
              </div>
            </div>
            )}
          </header>

          {/*
            One-shot migration banner: appears only when this browser still
            holds row-keyed legacy localStorage overrides AND the user hasn't
            already imported. Clicking the button POSTs them to the server.
          */}
          {legacyImportableCount > 0 && !legacyImportSuppressed && (
            <div className="mx-6 mt-4 rounded-lg border border-amber-300/60 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 text-sm flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-amber-900 dark:text-amber-100 leading-snug">
                <strong>Local edits found in this browser.</strong> ~{legacyImportableCount} legacy
                status / closure entries can be uploaded to the server so they're shared with
                your team and survive browser data wipes.
              </span>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="default"
                  size="sm"
                  disabled={legacyImporting}
                  onClick={() => void handleImportLegacyOverrides()}
                >
                  {legacyImporting ? "Importing…" : "Import my local edits"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    try {
                      localStorage.setItem(
                        "sentinel_weekly_reports_legacy_import_done",
                        "1"
                      );
                    } catch {
                      /* ignore */
                    }
                    setLegacyImportSuppressed(true);
                  }}
                >
                  Dismiss
                </Button>
              </div>
            </div>
          )}

          {isYearlyView ? (
            <Tabs value={yearlySection} className="flex flex-1 flex-col min-h-0 min-w-0">
              <TabsContent
                value="reports"
                className="flex flex-1 flex-col min-h-0 mt-0 overflow-hidden focus-visible:outline-none data-[state=inactive]:hidden"
              >
                {((isYearlyView && !reportAlertsLoading && (reportAlertsCsv?.rows?.length ?? 0) > 0) ||
                  (!isYearlyView && !loading && emailsWithCsvDisplay.length > 0)) && (
                  <div className="shrink-0 border-b border-border bg-background px-6 py-4 shadow-sm space-y-4">
                    {isYearlyView ? (
                      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
                        <span className="text-xs font-medium text-muted-foreground">Alert created</span>
                        <Select
                          value={yearlyCreationScope}
                          onValueChange={(v) => setYearlyCreationScope(v as "date" | "range")}
                        >
                          <SelectTrigger className="h-9 w-[7.5rem] bg-background">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="date">Single day</SelectItem>
                            <SelectItem value="range">Date range</SelectItem>
                          </SelectContent>
                        </Select>
                        <Popover open={yearlyCreationCalendarOpen} onOpenChange={setYearlyCreationCalendarOpen}>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className="h-9 min-w-[14rem] justify-start gap-2 px-3 font-normal text-sm"
                              title="Filter by alert creation date"
                            >
                              <CalendarIcon className="h-4 w-4 shrink-0 opacity-70" />
                              <span className="truncate">
                                {yearlyCreationScope === "date"
                                  ? yearlyCreationDate
                                  : yearlyCreationRange.from
                                    ? `${toYYYYMMDD(yearlyCreationRange.from)}${yearlyCreationRange.to ? ` – ${toYYYYMMDD(yearlyCreationRange.to)}` : ""}`
                                    : "Select range"}
                              </span>
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            {yearlyCreationScope === "date" ? (
                              <DatePickerCalendar
                                mode="single"
                                selected={parseISODateLocal(yearlyCreationDate)}
                                onSelect={(date) => {
                                  if (!date) return;
                                  setYearlyCreationDate(toYYYYMMDD(date));
                                  setYearlyCreationCalendarOpen(false);
                                }}
                                fromDate={parseISODateLocal(activeYearlyFy.afterDate)}
                                toDate={parseISODateLocal(fetchDateMax)}
                                disabled={(date) => {
                                  const key = toYYYYMMDD(date);
                                  return key < activeYearlyFy.afterDate || key > fetchDateMax;
                                }}
                                initialFocus
                              />
                            ) : (
                              <DatePickerCalendar
                                mode="range"
                                selected={{ from: yearlyCreationRange.from, to: yearlyCreationRange.to }}
                                onSelect={(range) => {
                                  setYearlyCreationRange({ from: range?.from, to: range?.to });
                                  if (range?.from && range?.to) setYearlyCreationCalendarOpen(false);
                                }}
                                fromDate={parseISODateLocal(activeYearlyFy.afterDate)}
                                toDate={parseISODateLocal(fetchDateMax)}
                                disabled={(date) => {
                                  const key = toYYYYMMDD(date);
                                  return key < activeYearlyFy.afterDate || key > fetchDateMax;
                                }}
                                initialFocus
                              />
                            )}
                          </PopoverContent>
                        </Popover>
                        {reportAlertsSummary ? (
                          <>
                            {reportAlertsSummary.usedDailySource ? (
                              <Badge variant="secondary" className="font-normal">
                                Daily + weekly
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="font-normal">
                                Weekly archive
                              </Badge>
                            )}
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {reportAlertsSummary.uniqueAlerts} in FY
                            </span>
                          </>
                        ) : null}
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <span className="text-sm font-medium text-muted-foreground shrink-0">Report date</span>
                        <div className="flex items-center gap-0.5 rounded-lg border border-input bg-background min-w-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 shrink-0"
                            disabled={emailsWithCsvDisplay.length <= 1 || safeReportIndex <= 0}
                            onClick={() => setSelectedReportIndex(Math.max(0, safeReportIndex - 1))}
                            title="Previous date"
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <Select
                            value={selectedEmail?.id ?? ""}
                            onValueChange={(id) => {
                              const idx = emailsWithCsvDisplay.findIndex((e) => e.id === id);
                              if (idx >= 0) setSelectedReportIndex(idx);
                            }}
                          >
                            <SelectTrigger className="h-9 min-w-[12rem] max-w-[min(100vw-8rem,28rem)] border-0 bg-transparent shadow-none focus:ring-0 text-sm">
                              <SelectValue placeholder="Select date" />
                            </SelectTrigger>
                            <SelectContent>
                              {emailsWithCsvDisplay.map((email) => (
                                <SelectItem key={email.id} value={email.id}>
                                  {formatReportDate(email)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 shrink-0"
                            disabled={emailsWithCsvDisplay.length <= 1 || safeReportIndex >= emailsWithCsvDisplay.length - 1}
                            onClick={() => setSelectedReportIndex(Math.min(emailsWithCsvDisplay.length - 1, safeReportIndex + 1))}
                            title="Next date"
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 w-full">
                      <ReportStatusSummaryCard
                        variant="primary"
                        title="FY total"
                        total={monthStats.total}
                        counts={monthStats}
                      />
                      <ReportStatusSummaryCard
                        variant="blue"
                        title="Selected date"
                        subtitle={
                          isYearlyView
                            ? yearlyCreationScope === "date"
                              ? yearlyCreationDate
                              : yearlyCreationRange.from
                                ? `${toYYYYMMDD(yearlyCreationRange.from)}${yearlyCreationRange.to ? ` – ${toYYYYMMDD(yearlyCreationRange.to)}` : ""}`
                                : "—"
                            : selectedEmail
                              ? formatReportDate(selectedEmail)
                              : "—"
                        }
                        total={selectedDateStats.total}
                        counts={selectedDateStats}
                      />
                    </div>
                  </div>
                )}
                <div className="min-h-0 min-w-0 flex-1 overflow-auto">
                  {(error || reportAlertsError) && (
                    <div className="mx-6 mt-4 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center justify-between gap-4">
                      <span>{reportAlertsError ?? error}</span>
                      {((reportAlertsError ?? error ?? "")
                        .toLowerCase()
                        .includes("reconnect") ||
                        (reportAlertsError ?? error ?? "").toLowerCase().includes("expired")) && (
                        <Button variant="outline" size="sm" onClick={() => { window.location.href = `${API_BASE_URL}/auth/google`; }}>
                          Reconnect Gmail
                        </Button>
                      )}
                    </div>
                  )}
                  {((isYearlyView &&
                    !reportAlertsLoading &&
                    csvForTable &&
                    csvForTable.rows.length > 0) ||
                    (!isYearlyView &&
                      !loading &&
                      emailsWithCsvDisplay.length > 0 &&
                      csvForTable &&
                      selectedEmail)) && (
                    <section className="p-6">
                      <Card key={isYearlyView ? "yearly-unified-alerts" : selectedEmail!.id} className="overflow-hidden">
                        <CardHeader className="py-3 px-4 bg-muted/30 border-b">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <h3 className="text-base font-semibold text-foreground">
                                {isYearlyView
                                  ? `Alerts — ${yearlyCreationScope === "date" ? yearlyCreationDate : "selected range"}`
                                  : `Report — ${formatReportDate(selectedEmail!)}`}
                              </h3>
                              {csvForTable.filename && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  {csvForTable.filename} • {csvForTable.rows?.length ?? 0} rows • from daily & weekly PB reports
                                </p>
                              )}
                            </div>
                            {!isYearlyView && selectedEmail && (
                              <FetchAllReportButtons
                                canResume={fetchAllResume.canResume}
                                resumeFromRow={fetchAllResume.resumeFromIndex + 1}
                                fetching={fetchingAllStatus}
                                progress={fetchAllProgress}
                                disabled={!csvForTable?.rows.length}
                                onResume={() => void handleFetchAllLatestStatus(false)}
                                onStartFromBeginning={() => void handleFetchAllLatestStatus(true)}
                              />
                            )}
                          </div>
                        </CardHeader>
                        <CardContent className="p-4">
                          <CsvDataTable
                            csv={csvForTable}
                            onRowClick={isYearlyView ? undefined : handleAlertRowClick}
                            statusOverrides={isYearlyView ? reportStatusOverrides : statusOverrides}
                            closureCommentsOverrides={
                              isYearlyView ? reportClosureCommentsOverrides : closureCommentsOverrides
                            }
                            closureDateOverrides={isYearlyView ? reportClosureDateOverrides : closureDateOverrides}
                            getRowKey={isYearlyView ? getUnifiedRowKey() : getRowKey(selectedEmail!.id)}
                            onStatusChange={(row, newStatus) =>
                              isYearlyView
                                ? handleReportStatusChange(row, newStatus)
                                : handleStatusChange(row, newStatus, selectedEmail!.id)
                            }
                            onClosureCommentsChange={(row, newValue) =>
                              isYearlyView
                                ? handleReportClosureCommentsChange(row, newValue)
                                : handleClosureCommentsChange(row, newValue, selectedEmail!.id)
                            }
                            onClosureDateChange={(row, newValue) =>
                              isYearlyView
                                ? handleReportClosureDateChange(row, newValue)
                                : handleClosureDateChange(row, newValue, selectedEmail!.id)
                            }
                          />
                        </CardContent>
                      </Card>
                    </section>
                  )}
                  {trailLoading && (
                    <p className="px-6 text-sm text-muted-foreground">Searching for mail trail…</p>
                  )}
                  {reportAlertsLoading && (
                    <div className="mx-6 my-4 rounded-lg border border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground flex items-center gap-3">
                      <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
                      <span>Loading PB report alerts for {activeYearlyFy.rangeLabel}…</span>
                    </div>
                  )}
                  {isHydratingFromCache && emails.length === 0 && !reportAlertsLoading && (
                    <div className="mx-6 my-4 rounded-lg border border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground flex items-center gap-3">
                      <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
                      <span>Syncing weekly reports for trends (optional)…</span>
                    </div>
                  )}
                  {!reportAlertsLoading &&
                    isYearlyView &&
                    reportAlertsCsv &&
                    reportAlertsCsv.rows.length > 0 &&
                    filteredYearlyReportRows.length === 0 && (
                      <p className="px-6 py-4 text-sm text-muted-foreground">
                        No alerts with <strong>creation date</strong> on the selected day or range. Try another date or widen the
                        range.
                      </p>
                    )}
                  {!reportAlertsLoading &&
                    !reportAlertsError &&
                    isYearlyView &&
                    (!reportAlertsCsv || reportAlertsCsv.rows.length === 0) && (
                      <p className="px-6 py-4 text-sm text-muted-foreground">
                        No PB report alerts cached for <strong>{activeYearlyFy.rangeLabel}</strong>. Use{" "}
                        <strong>Fetch data</strong> to sync weekly reports, open <strong>Daily Alerts</strong> to sync daily
                        reports, then return here.
                      </p>
                    )}
                  {!loading && emails.length > 0 && emailsWithCsv.length === 0 && !isYearlyView && (
                    <p className="px-6 py-4 text-sm text-muted-foreground">
                      No CSV attachments found in the loaded emails. Ensure PB Weekly report emails include a .csv file.
                    </p>
                  )}
                  {!loading && !isHydratingFromCache && emails.length === 0 && !error && !isYearlyView && (
                    <p className="px-6 py-4 text-sm text-muted-foreground">
                      Click <strong>Fetch data</strong> to load PB Weekly reports for this month.
                    </p>
                  )}
                </div>
              </TabsContent>
              <TabsContent
                value="analysis"
                className="flex-1 min-h-0 overflow-auto mt-0 px-6 py-4 focus-visible:outline-none data-[state=inactive]:hidden"
              >
                <YearlyFyTrendSection data={yearlyMonthTrend} fyLabel={activeYearlyFy.label} />
              </TabsContent>
            </Tabs>
          ) : (
            <>
              {!loading && emailsWithCsvDisplay.length > 0 && (
            <div className="shrink-0 border-b border-border bg-background px-6 py-2 shadow-sm">
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <span className="text-sm font-medium text-muted-foreground">Report date</span>
                <div className="flex items-center gap-0.5 rounded-md border border-input bg-background">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                        disabled={emailsWithCsvDisplay.length <= 1 || safeReportIndex <= 0}
                    onClick={() => setSelectedReportIndex(Math.max(0, safeReportIndex - 1))}
                    title="Previous date"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Select
                    value={selectedEmail?.id ?? ""}
                    onValueChange={(id) => {
                          const idx = emailsWithCsvDisplay.findIndex((e) => e.id === id);
                      if (idx >= 0) setSelectedReportIndex(idx);
                    }}
                  >
                    <SelectTrigger className="h-8 w-[16rem] border-0 bg-transparent shadow-none focus:ring-0 text-sm">
                      <SelectValue placeholder="Select date" />
                    </SelectTrigger>
                    <SelectContent>
                          {emailsWithCsvDisplay.map((email) => (
                        <SelectItem key={email.id} value={email.id}>
                          {formatReportDate(email)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                        disabled={emailsWithCsvDisplay.length <= 1 || safeReportIndex >= emailsWithCsvDisplay.length - 1}
                        onClick={() => setSelectedReportIndex(Math.min(emailsWithCsvDisplay.length - 1, safeReportIndex + 1))}
                    title="Next date"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 w-full">
                <ReportStatusSummaryCard
                  variant="primary"
                  title="Month data"
                  total={monthStats.total}
                  counts={monthStats}
                />
                <ReportStatusSummaryCard
                  variant="blue"
                  title="Report date"
                  subtitle={selectedEmail ? formatReportDate(selectedEmail) : "—"}
                  total={selectedDateStats.total}
                  counts={selectedDateStats}
                />
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
                {!loading && emailsWithCsvDisplay.length > 0 && csvForTable && selectedEmail && (
              <section className="p-6">
                <Card key={selectedEmail.id} className="overflow-hidden">
                  <CardHeader className="py-3 px-4 bg-muted/30 border-b">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                    <h3 className="text-base font-semibold text-foreground">
                      Report — {formatReportDate(selectedEmail)}
                    </h3>
                    {csvForTable.filename && (
                      <p className="text-xs text-muted-foreground mt-1">
                                {csvForTable.filename} • {csvForTable.rows?.length ?? 0} rows • status and closures are saved in this
                                browser
                      </p>
                    )}
                          </div>
                          <FetchAllReportButtons
                            canResume={fetchAllResume.canResume}
                            resumeFromRow={fetchAllResume.resumeFromIndex + 1}
                            fetching={fetchingAllStatus}
                            progress={fetchAllProgress}
                            disabled={!csvForTable?.rows.length}
                            onResume={() => void handleFetchAllLatestStatus(false)}
                            onStartFromBeginning={() => void handleFetchAllLatestStatus(true)}
                          />
                        </div>
                  </CardHeader>
                  <CardContent className="p-4">
                    <CsvDataTable
                      csv={csvForTable}
                      onRowClick={handleAlertRowClick}
                      statusOverrides={statusOverrides}
                      closureCommentsOverrides={closureCommentsOverrides}
                      closureDateOverrides={closureDateOverrides}
                      getRowKey={getRowKey(selectedEmail.id)}
                      onStatusChange={(row, newStatus) => handleStatusChange(row, newStatus, selectedEmail.id)}
                      onClosureCommentsChange={(row, newValue) => handleClosureCommentsChange(row, newValue, selectedEmail.id)}
                      onClosureDateChange={(row, newValue) => handleClosureDateChange(row, newValue, selectedEmail.id)}
                    />
                  </CardContent>
                </Card>
              </section>
            )}
            {trailLoading && (
              <p className="px-6 text-sm text-muted-foreground">Searching for mail trail…</p>
            )}
            {isHydratingFromCache && emails.length === 0 && (
              <div className="mx-6 my-4 rounded-lg border border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground flex items-center gap-3">
                <RefreshCw className="h-4 w-4 animate-spin shrink-0" />
                <span>Loading weekly reports for this month from the server…</span>
              </div>
            )}
            {!loading && emails.length > 0 && emailsWithCsv.length === 0 && (
              <p className="px-6 py-4 text-sm text-muted-foreground">
                No CSV attachments found in the loaded emails. Ensure PB Weekly report emails include a .csv file.
              </p>
            )}
            {!loading && !isHydratingFromCache && emails.length === 0 && !error && (
              <div className="mx-6 my-4 rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-sm text-muted-foreground flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <span>
                  No reports loaded for{" "}
                  <strong className="text-foreground">
                    {MONTH_OPTIONS.find((o) => o.year === selectedYear && o.month === selectedMonth)?.label ?? "this month"}
                  </strong>{" "}
                  yet. Click <strong className="text-foreground">Refresh</strong> to fetch PB Weekly reports for this month
                  &mdash; the report-date selector appears once at least one email with a CSV is loaded.
                </span>
                <Button variant="default" size="sm" onClick={refetch} disabled={loading} className="shrink-0">
                  <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                  Refresh now
                </Button>
              </div>
            )}
          </div>
            </>
          )}

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
