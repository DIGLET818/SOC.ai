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
import { RefreshCw, ChevronLeft, ChevronRight, Calendar, FileText } from "lucide-react";
import { API_BASE_URL } from "@/api/client";
import { useGmailMessages } from "@/hooks/useGmailMessages";
import { getGmailMessageBySearch } from "@/api/gmail";
import { toast } from "@/hooks/use-toast";
import type { GmailMessage } from "@/types/gmail";

const DAILY_ALERTS_SENDER = "PB_daily@global.ntt";
const DAILY_ALERTS_SUBJECT = "PB Daily report";
const STATUS_OVERRIDES_KEY = "sentinel_daily_alerts_status_overrides";
const CLOSURE_COMMENTS_OVERRIDES_KEY = "sentinel_daily_alerts_closure_comments_overrides";

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
const STATUS_COUNTS = ["Open", "Closed", "In Progress", "Merged", "Incident Auto Closed"] as const;

function normalizeStatus(s: string): (typeof STATUS_COUNTS)[number] {
  const t = s.trim();
  const found = STATUS_COUNTS.find((opt) => opt.toLowerCase() === t.toLowerCase());
  return found ?? "Open";
}

/** Get display status for a row (override or CSV Status column). */
function getRowStatus(
  row: Record<string, string>,
  headers: string[],
  emailId: string,
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
  emailId: string,
  getRowKey: (row: Record<string, string>) => string,
  statusOverrides: Record<string, string>
): { total: number; open: number; closed: number; inProgress: number; merged: number; incidentAutoClosed: number } {
  const counts = { total: rows.length, open: 0, closed: 0, inProgress: 0, merged: 0, incidentAutoClosed: 0 };
  for (const row of rows) {
    const s = normalizeStatus(getRowStatus(row, headers, emailId, getRowKey, statusOverrides));
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

export default function DailyAlerts() {
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>(() => loadStatusOverrides());
  const [closureCommentsOverrides, setClosureCommentsOverrides] = useState<Record<string, string>>(() => loadClosureCommentsOverrides());

  const { afterDate, beforeDate } = useMemo(
    () => getMonthRange(selectedYear, selectedMonth),
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
    refetchDateRange,
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

  const getRowKey = useCallback((emailId: string) => (row: Record<string, string>) => {
    const inc = getRowValue(row, "IncidentID", "Incident ID");
    const sn = getRowValue(row, "ServicenowTicket", "ServiceNow Ticket", "ServicenowT");
    return `${emailId}-${inc || "n/a"}-${sn || "n/a"}`;
  }, []);

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
      toast({ title: "Date fetched", description: `Data for ${fetchDate} merged into month view.` });
    });
  }, [fetchDate, refetchDateRange]);

  useEffect(() => {
    setFetchDate(fetchDateForMonth);
  }, [selectedYear, selectedMonth, fetchDateForMonth]);

  const [selectedReportIndex, setSelectedReportIndex] = useState(0);
  const safeReportIndex =
    emailsWithCsv.length > 0 ? Math.min(selectedReportIndex, emailsWithCsv.length - 1) : 0;
  const selectedEmail = emailsWithCsv[safeReportIndex] ?? null;

  useEffect(() => {
    if (emailsWithCsv.length > 0 && selectedReportIndex > emailsWithCsv.length - 1) {
      setSelectedReportIndex(emailsWithCsv.length - 1);
    }
  }, [emailsWithCsv.length, selectedReportIndex]);

  const monthStats = useMemo(() => {
    let total = 0;
    const counts = { open: 0, closed: 0, inProgress: 0, merged: 0, incidentAutoClosed: 0 };
    for (const email of emailsWithCsv) {
      const csv = email.csvAttachment;
      if (!csv?.headers?.length || !csv.rows?.length) continue;
      const c = countByStatus(csv.rows, csv.headers, email.id, getRowKey(email.id), statusOverrides);
      total += c.total;
      counts.open += c.open;
      counts.closed += c.closed;
      counts.inProgress += c.inProgress;
      counts.merged += c.merged;
      counts.incidentAutoClosed += c.incidentAutoClosed;
    }
    return { total, ...counts };
  }, [emailsWithCsv, statusOverrides, getRowKey]);

  const selectedDateStats = useMemo(() => {
    if (!selectedEmail?.csvAttachment) return { total: 0, open: 0, closed: 0, inProgress: 0, merged: 0, incidentAutoClosed: 0 };
    const { headers, rows } = selectedEmail.csvAttachment;
    return countByStatus(rows, headers, selectedEmail.id, getRowKey(selectedEmail.id), statusOverrides);
  }, [selectedEmail, statusOverrides, getRowKey]);

  const [trailEmail, setTrailEmail] = useState<GmailMessage | null>(null);
  const [trailLoading, setTrailLoading] = useState(false);

  const handleStatusChange = useCallback((row: Record<string, string>, newStatus: string, emailId: string) => {
    const key = getRowKey(emailId)(row);
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

  const handleClosureCommentsChange = useCallback((row: Record<string, string>, newValue: string, emailId: string) => {
    const key = getRowKey(emailId)(row);
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
              <div className="flex items-center gap-2 shrink-0 border-l border-border pl-4">
                <span className="text-sm text-muted-foreground hidden sm:inline">Fetch date</span>
                <input
                  type="date"
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm w-[8.5rem]"
                  min={fetchDateMin}
                  max={fetchDateMax}
                  value={fetchDate}
                  onChange={(e) => setFetchDate(e.target.value)}
                />
                <Button variant="outline" size="sm" onClick={handleFetchThisDate} disabled={loading} className="shrink-0">
                  <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
                  Fetch this date
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

          {!loading && emailsWithCsv.length > 0 && (
            <div className="shrink-0 border-b border-border bg-background px-6 py-2 shadow-sm">
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <span className="text-sm font-medium text-muted-foreground">Report date</span>
                <div className="flex items-center gap-0.5 rounded-md border border-input bg-background">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    disabled={emailsWithCsv.length <= 1 || safeReportIndex <= 0}
                    onClick={() => setSelectedReportIndex((i) => Math.max(0, i - 1))}
                    title="Previous date"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Select
                    value={selectedEmail?.id ?? ""}
                    onValueChange={(id) => {
                      const idx = emailsWithCsv.findIndex((e) => e.id === id);
                      if (idx >= 0) setSelectedReportIndex(idx);
                    }}
                  >
                    <SelectTrigger className="h-8 w-[16rem] border-0 bg-transparent shadow-none focus:ring-0 text-sm">
                      <SelectValue placeholder="Select date" />
                    </SelectTrigger>
                    <SelectContent>
                      {emailsWithCsv.map((email) => (
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
                    disabled={emailsWithCsv.length <= 1 || safeReportIndex >= emailsWithCsv.length - 1}
                    onClick={() => setSelectedReportIndex((i) => Math.min(emailsWithCsv.length - 1, i + 1))}
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
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-2 gap-y-0.5 text-xs">
                      <span className="text-muted-foreground">Open:</span>
                      <span className="font-medium text-foreground">{monthStats.open}</span>
                      <span className="text-muted-foreground">Closed:</span>
                      <span className="font-medium text-foreground">{monthStats.closed}</span>
                      <span className="text-muted-foreground">Pending:</span>
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
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-2 gap-y-0.5 text-xs">
                      <span className="text-muted-foreground">Open:</span>
                      <span className="font-medium text-foreground">{selectedDateStats.open}</span>
                      <span className="text-muted-foreground">Closed:</span>
                      <span className="font-medium text-foreground">{selectedDateStats.closed}</span>
                      <span className="text-muted-foreground">Pending:</span>
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
                Select a month and click <strong>Refresh</strong> to load that month&apos;s PB Daily reports.
              </p>
            )}
          </div>

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
