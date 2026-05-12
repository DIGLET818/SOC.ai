import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useLocation, Link } from "react-router-dom";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { SOCSidebar } from "@/components/SOCSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { CsvDataTable } from "@/components/CsvDataTable";
import { EmailDetailSheet } from "@/components/EmailDetailSheet";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
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
  Calendar,
  CalendarRange,
  FileText,
  Download,
  LayoutGrid,
  BarChart3,
  Radar,
} from "lucide-react";
import { API_BASE_URL } from "@/api/client";
import { useWeeklyReportData } from "@/hooks/useWeeklyReportData";
import {
  upsertOverride,
  importOverrides,
  type OverrideField,
  type ImportOverridesItem,
  type WeeklyOverrideRecord,
  WeeklyReportsAuthError,
} from "@/api/weeklyReports";
import {
  getGmailMessageBySearch,
  fetchLatestStatusFromEmail,
  type LatestStatusFromEmailResult,
} from "@/api/gmail";
import { toast } from "@/hooks/use-toast";
import type { GmailMessage, CsvAttachment } from "@/types/gmail";
import {
  mergeOverridesIntoRows,
  downloadCsvAsXlsx,
  buildConsolidatedWeeklyReportsCsv,
} from "@/lib/exportReportSheetXlsx";
import { YearlyFyTrendSection, YearlyFyCoverageSection, type YearlyMonthTrendRow } from "@/components/weekly/YearlyFyInsights";

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
  const [fetchAllProgress, setFetchAllProgress] = useState<{ current: number; total: number } | null>(null);

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

  const handleFetchThisDate = useCallback(() => {
    const after = fetchDate;
    const before = nextDay(fetchDate);
    refetchDateRange(after, before).then(() => {
      toast({ title: "Date fetched", description: `Data for ${fetchDate} merged into month view.` });
    });
  }, [fetchDate, refetchDateRange]);

  useEffect(() => {
    setFetchDate(fetchDateForMonth);
  }, [selectedYear, selectedMonth, fetchDateForMonth, isYearlyView]);

  /**
   * `null` = user hasn't picked a report yet → default to the LATEST one in the loaded list
   * (emailsWithCsvDisplay is sorted ascending by date, so latest = last index).
   * Reset to `null` whenever the month / FY context changes so the new period also opens on its latest report.
   */
  const [selectedReportIndex, setSelectedReportIndex] = useState<number | null>(null);
  const safeReportIndex = useMemo(() => {
    if (emailsWithCsvDisplay.length === 0) return 0;
    if (selectedReportIndex == null) return emailsWithCsvDisplay.length - 1;
    return Math.min(Math.max(0, selectedReportIndex), emailsWithCsvDisplay.length - 1);
  }, [emailsWithCsvDisplay.length, selectedReportIndex]);
  const selectedEmail = emailsWithCsvDisplay[safeReportIndex] ?? null;

  useEffect(() => {
    setSelectedReportIndex(null);
  }, [yearlyFyId, isYearlyView, selectedYear, selectedMonth]);

  const monthStats = useMemo(() => {
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
  }, [emailsWithCsvDisplay, statusOverrides, getRowKey]);

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
  }, [selectedEmail?.csvAttachment, selectedEmail?.id]);

  const selectedDateStats = useMemo(() => {
    if (!csvForTable)
      return { total: 0, open: 0, closed: 0, inProgress: 0, pending: 0, merged: 0, incidentAutoClosed: 0 };
    const { headers, rows } = csvForTable;
    const rk = selectedEmail ? getRowKey(selectedEmail.id) : () => "";
    return countByStatus(rows, headers, rk, statusOverrides);
  }, [csvForTable, selectedEmail, getRowKey, statusOverrides]);

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
      fallbackIndex: number = 0
    ) => {
      const rowIndex = resolveRowIndex(row, fallbackIndex);
      const actorEmail =
        currentUser && currentUser !== "anonymous" ? currentUser.email : undefined;
      // Optimistic local update first so the cell doesn't flash old value during the round-trip.
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

  const handleFetchAllLatestStatus = useCallback(async () => {
    if (!selectedEmail?.csvAttachment?.rows?.length) {
      toast({ title: "No data", description: "Load a weekly report with CSV rows first.", variant: "destructive" });
      return;
    }
    const emailId = selectedEmail.id;
    const rows = selectedEmail.csvAttachment.rows;
    const headers = selectedEmail.csvAttachment.headers ?? [];
    const rk = getRowKey(emailId);
    setFetchingAllStatus(true);
    setFetchAllProgress({ current: 0, total: rows.length });
    let updated = 0;
    let datesSet = 0;
    let mergedNtt = 0;
    let mergedDateFromCreated = 0;
    const total = rows.length;
    try {
      for (let i = 0; i < rows.length; i++) {
        setFetchAllProgress({ current: i + 1, total });
        const row = rows[i];
        const rawIdx = (row as Record<string, unknown>).__rowIndex;
        let idxStr = String(i);
        if (rawIdx != null && String(rawIdx).trim() !== "") {
          const n = Number(rawIdx);
          idxStr = Number.isFinite(n) ? String(n) : String(i);
        }
        const rowWithIdx = { ...row, __rowIndex: idxStr };
        if (headers.length) {
          const st = normalizeStatus(getRowStatus(rowWithIdx, headers, rk, statusOverrides));
          if (st === "Merged") {
            const createdVal = getRowValue(row, "Created", "Created On").trim();
            await persistOverride(emailId, rowWithIdx, "closure_comment", "NTT", i);
            if (createdVal) {
              mergedDateFromCreated++;
              await persistOverride(emailId, rowWithIdx, "closure_date", createdVal, i);
            }
            mergedNtt++;
            continue;
          }
        }
        const servicenowTicket = getRowValue(row, "ServicenowTicket", "ServiceNow Ticket", "ServicenowT");
        const incidentId = getRowValue(row, "IncidentID", "Incident ID");
        const searchFirst = servicenowTicket || incidentId;
        const searchFallback = servicenowTicket ? incidentId : "";
        const extraQs = extraGmailIncidentQueries(row);
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
            await persistOverride(emailId, rowWithIdx, "status", statusToSet, i);
            await persistOverride(emailId, rowWithIdx, "closure_comment", closure, i);
            if (dateIso) {
              datesSet++;
              await persistOverride(emailId, rowWithIdx, "closure_date", dateIso, i);
            }
            updated++;
          }
        } catch {
          /* skip row */
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
        parts.push(datesSet > 0 ? `${updated} closed from Gmail (${datesSet} with closure date)` : `${updated} closed from Gmail`);
      }
      if (parts.length === 0) parts.push("No rows updated");
      parts.push(`${total - mergedNtt - updated} unchanged or skipped`);
      toast({
        title: "Fetch all complete (this report)",
        description: parts.join("; ") + ".",
      });
    } finally {
      setFetchingAllStatus(false);
      setFetchAllProgress(null);
    }
  }, [selectedEmail, getRowKey, statusOverrides, persistOverride]);

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
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-primary/25 bg-gradient-to-r from-primary/[0.06] to-card px-3 py-2 shadow-sm w-fit max-w-full">
                    <div className="flex items-center gap-2 text-primary shrink-0">
                      <CalendarRange className="h-4 w-4 shrink-0" aria-hidden />
                      <span className="text-xs font-semibold uppercase tracking-wide whitespace-nowrap">FY</span>
                      <Select value={yearlyFyId} onValueChange={setYearlyFyId}>
                        <SelectTrigger className="h-9 w-[11rem] text-sm border-input bg-background/90">
                          <SelectValue placeholder="Select FY" />
                        </SelectTrigger>
                        <SelectContent>
                          {YEARLY_FY_OPTIONS.map((fy) => (
                            <SelectItem key={fy.id} value={fy.id}>
                              {fy.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <span className="text-xs text-muted-foreground leading-snug min-w-0 sm:max-w-[20rem] xl:max-w-[24rem] border-t border-border/60 pt-2 mt-1 w-full sm:border-t-0 sm:border-l sm:pl-3 sm:pt-0 sm:mt-0 sm:w-auto">
                      {activeYearlyFy.rangeLabel}
                    </span>
                    <Link
                      to="/weekly-reports"
                      className="text-sm font-medium text-primary hover:text-primary/80 underline-offset-2 hover:underline whitespace-nowrap"
                    >
                      Monthly view →
                    </Link>
                  </div>

                  <div className="flex flex-col gap-3 min-w-0 xl:items-end">
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                      <div
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-2 py-1.5"
                        role="group"
                        aria-label="Sync from Gmail"
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={refetch}
                          disabled={loading}
                          className="shrink-0 h-9"
                          aria-label="Refresh weekly reports from Gmail"
                        >
                          <RefreshCw className={`h-4 w-4 sm:mr-2 ${loading ? "animate-spin" : ""}`} />
                          <span className="hidden sm:inline">Refresh</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleFetchAllLatestStatus}
                          disabled={loading || fetchingAllStatus || !csvForTable?.rows.length}
                          className="shrink-0 h-9"
                          title="Fetch Gmail closure status for every row (Servicenow / Incident ID)"
                          aria-label={
                            fetchingAllStatus && fetchAllProgress
                              ? `Fetch all Gmail status, ${fetchAllProgress.current} of ${fetchAllProgress.total}`
                              : "Fetch Gmail closure status for all rows"
                          }
                        >
                          <RefreshCw className={`h-4 w-4 sm:mr-2 ${fetchingAllStatus ? "animate-spin" : ""}`} />
                          <span className="hidden min-[420px]:inline">
                            {fetchingAllStatus && fetchAllProgress
                              ? `Fetch all ${fetchAllProgress.current}/${fetchAllProgress.total}`
                              : "Fetch all (Gmail)"}
                          </span>
                          <span className="min-[420px]:hidden">Fetch all</span>
                        </Button>
                      </div>

                      <div className="hidden sm:block h-8 w-px bg-border shrink-0 self-center" aria-hidden />

                      <div
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-2 py-1.5"
                        role="group"
                        aria-label="Export"
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleDownloadXlsx}
                          disabled={!csvForTable?.rows.length}
                          className="shrink-0 h-9"
                          title="Download current table with your status and closure updates"
                          aria-label="Download current table as Excel"
                        >
                          <Download className="h-4 w-4 sm:mr-2" />
                          <span className="hidden sm:inline">Download .xlsx</span>
                          <span className="sm:hidden">Sheet</span>
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleDownloadConsolidatedXlsx}
                          disabled={loading || emailsWithCsvDisplay.length === 0}
                          className="shrink-0 h-9"
                          title="One .xlsx: all loaded FY weekly CSV rows in a single sheet, plus report date and Gmail message id per row"
                          aria-label="Download FY consolidated Excel workbook"
                        >
                          <Download className="h-4 w-4 sm:mr-2" />
                          <span className="hidden lg:inline">FY consolidated .xlsx</span>
                          <span className="hidden sm:inline lg:hidden">FY .xlsx</span>
                          <span className="sm:hidden">FY</span>
                        </Button>
                      </div>

                      <div className="hidden md:block h-8 w-px bg-border shrink-0 self-center" aria-hidden />

                      <div
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-2 py-1.5"
                        role="group"
                        aria-label="Fetch by calendar date"
                      >
                        <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">Fetch date</span>
                        <input
                          type="date"
                          className="h-9 rounded-md border border-input bg-background px-2 text-sm w-[9rem] shrink-0"
                          min={fetchDateMin}
                          max={fetchDateMax}
                          value={fetchDate}
                          onChange={(e) => setFetchDate(e.target.value)}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleFetchThisDate}
                          disabled={loading}
                          className="shrink-0 h-9"
                          aria-label="Fetch weekly report for selected calendar date"
                        >
                          <RefreshCw className={`h-3.5 w-3.5 sm:mr-1.5 ${loading ? "animate-spin" : ""}`} />
                          <span className="hidden sm:inline">Fetch this date</span>
                          <span className="sm:hidden">Go</span>
                        </Button>
                      </div>
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
                <Button variant="outline" size="sm" onClick={refetch} disabled={loading} className="shrink-0 h-9">
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleFetchAllLatestStatus}
                disabled={loading || fetchingAllStatus || !csvForTable?.rows.length}
                  className="shrink-0 h-9"
                title="Fetch Gmail closure status for every row (Servicenow / Incident ID)"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${fetchingAllStatus ? "animate-spin" : ""}`} />
                {fetchingAllStatus && fetchAllProgress
                  ? `Fetch all ${fetchAllProgress.current}/${fetchAllProgress.total}`
                  : "Fetch all (Gmail)"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadXlsx}
                disabled={!csvForTable?.rows.length}
                  className="shrink-0 h-9"
                title="Download current table with your status and closure updates"
              >
                <Download className="h-4 w-4 mr-2" />
                Download .xlsx
              </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleDownloadConsolidatedXlsx}
                  disabled={loading || emailsWithCsvDisplay.length === 0}
                  className="shrink-0 h-9"
                  title="One .xlsx: every loaded weekly CSV for this month in a single sheet"
                >
                  <Download className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Consolidated .xlsx</span>
                </Button>
                <div className="flex flex-wrap items-center gap-2 shrink-0 border-l border-border pl-3">
                <span className="text-sm text-muted-foreground hidden sm:inline">Fetch date</span>
                <input
                  type="date"
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm w-[8.5rem]"
                  min={fetchDateMin}
                  max={fetchDateMax}
                  value={fetchDate}
                  onChange={(e) => setFetchDate(e.target.value)}
                />
                  <Button variant="outline" size="sm" onClick={handleFetchThisDate} disabled={loading} className="shrink-0 h-9">
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
                  Fetch this date
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
            <Tabs defaultValue="reports" className="flex flex-1 flex-col min-h-0 min-w-0">
              <div className="shrink-0 border-b border-border bg-muted/20 px-6 py-3">
                <TabsList className="h-auto w-full flex-wrap justify-start gap-1 rounded-xl bg-muted/60 p-1 sm:w-auto">
                  <TabsTrigger
                    value="reports"
                    className="gap-1.5 rounded-lg px-3 py-2 text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm"
                  >
                    <LayoutGrid className="h-4 w-4 opacity-70" />
                    Reports &amp; table
                  </TabsTrigger>
                  <TabsTrigger
                    value="analysis"
                    className="gap-1.5 rounded-lg px-3 py-2 text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm"
                  >
                    <BarChart3 className="h-4 w-4 opacity-70" />
                    Trends
                  </TabsTrigger>
                  <TabsTrigger
                    value="coverage"
                    className="gap-1.5 rounded-lg px-3 py-2 text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm"
                  >
                    <Radar className="h-4 w-4 opacity-70" />
                    Fetch coverage
                  </TabsTrigger>
                </TabsList>
              </div>
              <TabsContent
                value="reports"
                className="flex flex-1 flex-col min-h-0 mt-0 overflow-hidden focus-visible:outline-none data-[state=inactive]:hidden"
              >
                {!loading && emailsWithCsvDisplay.length > 0 && (
                  <div className="shrink-0 border-b border-border bg-background px-6 py-4 shadow-sm space-y-4">
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
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <Card className="border border-border/80 shadow-sm bg-primary/5 rounded-xl">
                        <CardContent className="p-4 sm:p-5">
                          <div className="flex items-center gap-2 mb-3">
                            <Calendar className="h-5 w-5 text-primary shrink-0" />
                            <p className="text-xs font-semibold text-primary uppercase tracking-wide">FY total (all loaded reports)</p>
                          </div>
                          <p className="text-xl font-bold text-foreground mb-4 tabular-nums">{monthStats.total} alerts</p>
                          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
                            {[
                              ["Open", monthStats.open],
                              ["Closed", monthStats.closed],
                              ["Merged", monthStats.merged],
                              ["Pending", monthStats.pending],
                              ["In progress", monthStats.inProgress],
                              ["Incident auto closed", monthStats.incidentAutoClosed],
                            ].map(([label, val]) => (
                              <div key={label} className="flex items-baseline justify-between gap-6 min-w-0">
                                <dt className="text-muted-foreground">{label}</dt>
                                <dd className="font-semibold tabular-nums text-foreground text-right">{val}</dd>
                              </div>
                            ))}
                          </dl>
                        </CardContent>
                      </Card>
                      <Card className="border border-border/80 shadow-sm bg-blue-500/5 rounded-xl">
                        <CardContent className="p-4 sm:p-5">
                          <div className="flex items-center gap-2 mb-2">
                            <FileText className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0" />
                            <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide">This date</p>
                          </div>
                          <p className="text-xs text-muted-foreground mb-3 truncate">{selectedEmail ? formatReportDate(selectedEmail) : "—"}</p>
                          <p className="text-xl font-bold text-foreground mb-4 tabular-nums">{selectedDateStats.total} alerts</p>
                          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
                            {[
                              ["Open", selectedDateStats.open],
                              ["Closed", selectedDateStats.closed],
                              ["Merged", selectedDateStats.merged],
                              ["Pending", selectedDateStats.pending],
                              ["In progress", selectedDateStats.inProgress],
                              ["Incident auto closed", selectedDateStats.incidentAutoClosed],
                            ].map(([label, val]) => (
                              <div key={label} className="flex items-baseline justify-between gap-6 min-w-0">
                                <dt className="text-muted-foreground">{label}</dt>
                                <dd className="font-semibold tabular-nums text-foreground text-right">{val}</dd>
                              </div>
                            ))}
                          </dl>
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
                                  {csvForTable.filename} • {csvForTable.rows?.length ?? 0} rows • status and closures are saved in
                                  this browser
                                </p>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={fetchingAllStatus || !csvForTable?.rows.length}
                                onClick={() => void handleFetchAllLatestStatus()}
                                title="Fetch current status, closure date, and closure comments from Gmail for every row (ServiceNow / Incident ID)"
                                aria-label="Fetch all rows: status, closure date, and closure comments from Gmail"
                              >
                                {fetchingAllStatus && fetchAllProgress
                                  ? `Fetching… ${fetchAllProgress.current}/${fetchAllProgress.total}`
                                  : "Fetch all (this report)"}
                              </Button>
                            </div>
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
                      <span>Loading weekly reports for this FY from the server…</span>
                    </div>
                  )}
                  {!loading && isYearlyView && emailsWithCsv.length > 0 && emailsWithCsvDisplay.length === 0 && (
                    <p className="px-6 py-4 text-sm text-muted-foreground">
                      Every row in the loaded weekly CSVs was filtered out: alert <strong>creation</strong> date is outside{" "}
                      <strong>{activeYearlyFy.rangeLabel}</strong> (or the creation column could not be read). Check column names
                      like Created / Creation Date, or open the monthly view for the full file.
                    </p>
                  )}
                  {!loading && emails.length > 0 && emailsWithCsv.length === 0 && (
                    <p className="px-6 py-4 text-sm text-muted-foreground">
                      No CSV attachments found in the loaded emails. Ensure PB Weekly report emails include a .csv file.
                    </p>
                  )}
                  {!loading && !isHydratingFromCache && emails.length === 0 && !error && (
                    <p className="px-6 py-4 text-sm text-muted-foreground">
                      Click <strong>Refresh</strong> to load all PB Weekly reports for <strong>{activeYearlyFy.rangeLabel}</strong>{" "}
                      (up to {YEARLY_MAX_RESULTS} messages). First load may take a short while.
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
              <TabsContent
                value="coverage"
                className="flex-1 min-h-0 overflow-auto mt-0 px-6 py-4 focus-visible:outline-none data-[state=inactive]:hidden"
              >
                {yearlyCoverage ? (
                  <YearlyFyCoverageSection {...yearlyCoverage} fyLabel={activeYearlyFy.label} />
                ) : null}
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
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                <Card className="border border-border shadow-sm bg-primary/5">
                  <CardContent className="p-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Calendar className="h-4 w-4 text-primary shrink-0" />
                      <p className="text-xs font-semibold text-primary uppercase tracking-wide">Month data</p>
                    </div>
                    <p className="text-lg font-bold text-foreground mb-1">Total: {monthStats.total} alerts</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-2 gap-y-0.5 text-xs">
                      <span className="text-muted-foreground">Open:</span>
                      <span className="font-medium text-foreground">{monthStats.open}</span>
                      <span className="text-muted-foreground">Closed:</span>
                      <span className="font-medium text-foreground">{monthStats.closed}</span>
                          <span className="text-muted-foreground">Merged:</span>
                          <span className="font-medium text-foreground">{monthStats.merged}</span>
                      <span className="text-muted-foreground">Pending:</span>
                          <span className="font-medium text-foreground">{monthStats.pending}</span>
                          <span className="text-muted-foreground">In progress:</span>
                      <span className="font-medium text-foreground">{monthStats.inProgress}</span>
                      <span className="text-muted-foreground">Incident Auto Closed:</span>
                      <span className="font-medium text-foreground">{monthStats.incidentAutoClosed}</span>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border border-border shadow-sm bg-blue-500/5">
                  <CardContent className="p-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
                      <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide">This date</p>
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate mb-0.5">{selectedEmail ? formatReportDate(selectedEmail) : "—"}</p>
                    <p className="text-lg font-bold text-foreground mb-1">Total: {selectedDateStats.total} alerts</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-2 gap-y-0.5 text-xs">
                      <span className="text-muted-foreground">Open:</span>
                      <span className="font-medium text-foreground">{selectedDateStats.open}</span>
                      <span className="text-muted-foreground">Closed:</span>
                      <span className="font-medium text-foreground">{selectedDateStats.closed}</span>
                          <span className="text-muted-foreground">Merged:</span>
                          <span className="font-medium text-foreground">{selectedDateStats.merged}</span>
                      <span className="text-muted-foreground">Pending:</span>
                          <span className="font-medium text-foreground">{selectedDateStats.pending}</span>
                          <span className="text-muted-foreground">In progress:</span>
                      <span className="font-medium text-foreground">{selectedDateStats.inProgress}</span>
                      <span className="text-muted-foreground">Incident Auto Closed:</span>
                      <span className="font-medium text-foreground">{selectedDateStats.incidentAutoClosed}</span>
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
                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={fetchingAllStatus || !csvForTable?.rows.length}
                              onClick={() => void handleFetchAllLatestStatus()}
                              title="Fetch current status, closure date, and closure comments from Gmail for every row (ServiceNow / Incident ID)"
                              aria-label="Fetch all rows: status, closure date, and closure comments from Gmail"
                            >
                              {fetchingAllStatus && fetchAllProgress
                                ? `Fetching… ${fetchAllProgress.current}/${fetchAllProgress.total}`
                                : "Fetch all (this report)"}
                            </Button>
                          </div>
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
