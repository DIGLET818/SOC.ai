import { useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  CalendarRange,
  CheckCircle2,
  FileWarning,
  Mail,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import type { GmailMessage } from "@/types/gmail";

const CHART_TOOLTIP = {
  contentStyle: {
    backgroundColor: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "12px",
    fontSize: "12px",
    boxShadow: "0 8px 28px hsl(0 0% 0% / 0.12)",
  },
} as const;

const kpiCardClass = "border-border/70 shadow-sm bg-card/95";

export interface YearlyMonthTrendRow {
  key: string;
  label: string;
  reports: number;
  rows: number;
  open: number;
  closed: number;
  inProgress: number;
  pending: number;
  merged: number;
  incidentAutoClosed: number;
}

type EnrichedMonth = YearlyMonthTrendRow & {
  backlog: number;
  resolved: number;
  mergedPct: number;
};

function enrichMonthRows(data: YearlyMonthTrendRow[]): EnrichedMonth[] {
  return data.map((d) => {
    const backlog = d.open + d.inProgress + d.pending;
    const resolved = d.closed + d.merged + d.incidentAutoClosed;
    const mergedPct = d.rows > 0 ? Math.round((d.merged / d.rows) * 1000) / 10 : 0;
    return { ...d, backlog, resolved, mergedPct };
  });
}

export function YearlyFyTrendSection({
  data,
  fyLabel,
}: {
  data: YearlyMonthTrendRow[];
  fyLabel?: string;
}) {
  const enriched = useMemo(() => enrichMonthRows(data), [data]);

  const totals = useMemo(() => {
    return enriched.reduce(
      (acc, row) => {
        acc.rows += row.rows;
        acc.reports += row.reports;
        acc.open += row.open;
        acc.closed += row.closed;
        acc.inProgress += row.inProgress;
        acc.pending += row.pending;
        acc.merged += row.merged;
        acc.incidentAutoClosed += row.incidentAutoClosed;
        acc.backlog += row.backlog;
        acc.resolved += row.resolved;
        return acc;
      },
      {
        rows: 0,
        reports: 0,
        open: 0,
        closed: 0,
        inProgress: 0,
        pending: 0,
        merged: 0,
        incidentAutoClosed: 0,
        backlog: 0,
        resolved: 0,
      }
    );
  }, [enriched]);

  const mergedPctFy = totals.rows > 0 ? Math.round((totals.merged / totals.rows) * 1000) / 10 : 0;
  const resolutionRate =
    totals.rows > 0 ? Math.round((totals.resolved / Math.max(totals.rows, 1)) * 1000) / 10 : 0;
  const statusRows = useMemo(
    () => [
      { label: "Open", value: totals.open, color: "bg-amber-500" },
      { label: "In Progress", value: totals.inProgress, color: "bg-blue-500" },
      { label: "Pending", value: totals.pending, color: "bg-sky-500" },
      { label: "Closed", value: totals.closed, color: "bg-emerald-500" },
      { label: "Merged", value: totals.merged, color: "bg-violet-500" },
      { label: "Auto Closed", value: totals.incidentAutoClosed, color: "bg-rose-500" },
    ],
    [totals]
  );

  if (!data.length) {
    return (
      <Card className="border-dashed border-2 bg-muted/15">
        <CardContent className="py-14 text-center text-sm text-muted-foreground">
          No yearly trend data yet. Go to `Reports & table` and click `Refresh` to load weekly CSVs.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-border/70 shadow-sm">
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <CalendarRange className="h-5 w-5 text-muted-foreground" />
                Yearly SOC Alerts
              </CardTitle>
              <CardDescription className="mt-1 max-w-2xl">
                Last 12 months overview for the selected financial year. This view uses your real weekly-report data and the
                same status logic as the table.
              </CardDescription>
            </div>
          </div>
          {fyLabel ? <Badge variant="secondary" className="capitalize">{fyLabel}</Badge> : null}
        </CardHeader>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={<AlertTriangle className="h-5 w-5" />}
          label="Total Alerts"
          value={totals.rows.toLocaleString()}
          tone="bg-primary/10 text-primary"
          delta={`${totals.reports} weekly files`}
          accent="text-foreground"
        />
        <KpiCard
          icon={<ShieldAlert className="h-5 w-5" />}
          label="Merged"
          value={totals.merged.toLocaleString()}
          tone="bg-violet-500/10 text-violet-600 dark:text-violet-400"
          delta={`${mergedPctFy}% of all rows`}
        />
        <KpiCard
          icon={<CheckCircle2 className="h-5 w-5" />}
          label="Resolved"
          value={totals.resolved.toLocaleString()}
          tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          delta={`${resolutionRate}% of total rows`}
        />
        <KpiCard
          icon={<TrendingUp className="h-5 w-5" />}
          label="Backlog"
          value={totals.backlog.toLocaleString()}
          tone="bg-amber-500/10 text-amber-600 dark:text-amber-400"
          delta="Open + in progress + pending"
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">Alert vs Resolution Trend</CardTitle>
            <CardDescription>
              Total alert rows plotted against resolved outcomes over the selected FY.
            </CardDescription>
          </div>
          <Badge variant="secondary" className="capitalize">
            yearly
          </Badge>
        </CardHeader>
        <CardContent className="h-[360px]">
          <ResponsiveContainer width="100%" height="100%">

            <AreaChart data={enriched} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="fy-alerts" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.04} />
                </linearGradient>
                <linearGradient id="fy-resolved" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(150 65% 45%)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="hsl(150 65% 45%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" stroke="var(--muted-foreground)" fontSize={12} />
              <YAxis stroke="var(--muted-foreground)" fontSize={12} />
              <Tooltip {...CHART_TOOLTIP} />
              <Legend />
              <Area
                type="monotone"
                dataKey="rows"
                name="Alerts"
                stroke="hsl(var(--primary))"
                fill="url(#fy-alerts)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="resolved"
                name="Resolved"
                stroke="hsl(150 65% 45%)"
                fill="url(#fy-resolved)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status Distribution</CardTitle>
          <CardDescription>
            Aggregated counts across the selected yearly window.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {statusRows.map((row) => (
              <SeverityRow key={row.label} label={row.label} value={row.value} total={totals.rows} color={row.color} />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className={kpiCardClass}>
        <CardHeader>
          <CardTitle className="text-base">Month-by-month breakdown</CardTitle>
          <CardDescription>Rows are grouped by the weekly report email&apos;s month; repeated alerts across files are counted again.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-border text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 text-left font-medium">Month</th>
                <th className="py-2 pr-3 text-right font-medium">Reports</th>
                <th className="py-2 pr-3 text-right font-medium">Alerts</th>
                <th className="py-2 pr-3 text-right font-medium">Resolved</th>
                <th className="py-2 pr-3 text-right font-medium">Backlog</th>
                <th className="py-2 pr-3 text-right font-medium">Merged %</th>
                <th className="py-2 pr-3 text-right font-medium">Pending</th>
              </tr>
            </thead>
            <tbody>
              {enriched.map((row, idx) => (
                <tr key={row.key} className={idx % 2 ? "bg-muted/20" : ""}>
                  <td className="py-2 pr-3 font-medium">{row.label}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{row.reports}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.rows}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{row.resolved}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-amber-700 dark:text-amber-300">{row.backlog}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.mergedPct}%</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-sky-700 dark:text-sky-300">{row.pending}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

export interface YearlyCoverageProps {
  totalFromApi: number;
  withCsv: number;
  withoutCsv: number;
  maxResults: number;
  approxWeeksInRange: number;
  missingWeekMondays: string[];
  noCsvEmails: Pick<GmailMessage, "id" | "subject" | "date">[];
  fyLabel?: string;
}

export function YearlyFyCoverageSection({
  totalFromApi,
  withCsv,
  withoutCsv,
  maxResults,
  approxWeeksInRange,
  missingWeekMondays,
  noCsvEmails,
  fyLabel,
}: YearlyCoverageProps) {
  const hitCap = totalFromApi >= maxResults;
  const withCsvPct = totalFromApi > 0 ? Math.round((withCsv / totalFromApi) * 1000) / 10 : 0;
  const coverageChart = [
    { label: "With CSV", value: withCsv },
    { label: "No CSV", value: withoutCsv },
  ];

  return (
    <div className="space-y-6">
      <Card className="border-border/70 bg-gradient-to-r from-blue-500/[0.06] via-card to-card shadow-sm">
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-blue-500/10 p-2.5 text-blue-600 dark:text-blue-400">
              <Mail className="h-6 w-6" />
            </div>
            <div>
              <CardTitle className="text-xl">Fetch & attachment health</CardTitle>
              <CardDescription className="mt-1">
                Coverage checks for the selected FY: Gmail message volume, CSV quality, possible missing weeks, and whether the
                API result cap may have truncated your pull.
              </CardDescription>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {fyLabel ? <Badge variant="secondary">{fyLabel}</Badge> : null}
            <Badge variant="outline">{withCsvPct}% with CSV</Badge>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={<Mail className="h-5 w-5" />}
          label="Gmail messages"
          value={totalFromApi.toLocaleString()}
          tone="bg-primary/10 text-primary"
          delta="Matched sender + subject + FY range"
        />
        <KpiCard
          icon={<CheckCircle2 className="h-5 w-5" />}
          label="Usable CSV"
          value={withCsv.toLocaleString()}
          tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          delta="Messages with attachment rows"
        />
        <KpiCard
          icon={<FileWarning className="h-5 w-5" />}
          label="No usable CSV"
          value={withoutCsv.toLocaleString()}
          tone="bg-amber-500/10 text-amber-600 dark:text-amber-400"
          delta="Missing or empty attachment"
        />
        <KpiCard
          icon={<AlertTriangle className="h-5 w-5" />}
          label="Possible missing weeks"
          value={missingWeekMondays.length.toLocaleString()}
          tone={hitCap ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}
          delta={`~${approxWeeksInRange} weeks in FY`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
        <Card className={kpiCardClass}>
          <CardHeader>
            <CardTitle className="text-base">Attachment quality snapshot</CardTitle>
            <CardDescription>
              Compare weekly messages with usable CSV attachments versus messages that matched the search but cannot contribute to
              totals yet.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={coverageChart} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/70" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={40} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="value" name="Messages" radius={[8, 8, 0, 0]}>
                  <Bar dataKey="value" fill="hsl(var(--primary))" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className={kpiCardClass}>
          <CardHeader>
            <CardTitle className="text-base">Coverage notes</CardTitle>
            <CardDescription>Quick reading of the fetch quality for this FY.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="font-medium">Weeks in range</p>
              <p className="text-muted-foreground">Approximately {approxWeeksInRange} calendar weeks fall inside this FY.</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="font-medium">Missing weeks flagged</p>
              <p className="text-muted-foreground">
                {missingWeekMondays.length === 0
                  ? "Every week in range has at least one fetched message."
                  : `${missingWeekMondays.length} week(s) have no matching message in the loaded set.`}
              </p>
            </div>
            <div className={`rounded-lg border p-3 ${hitCap ? "border-destructive/40 bg-destructive/10" : "border-border bg-muted/30"}`}>
              <p className="font-medium">API limit</p>
              <p className={hitCap ? "text-destructive" : "text-muted-foreground"}>
                {totalFromApi}/{maxResults} messages returned {hitCap ? "— cap reached, results may be incomplete." : "— under the max-results cap."}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className={kpiCardClass}>
        <CardHeader>
          <CardTitle className="text-base">Week coverage (heuristic)</CardTitle>
          <CardDescription>Weeks are approximated using Monday starts; holidays and timezone edges can create false gaps.</CardDescription>
        </CardHeader>
        <CardContent>
          {missingWeekMondays.length === 0 ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">Every week in range has at least one fetched message.</p>
          ) : (
            <ul className="max-h-48 space-y-1 overflow-auto rounded-xl border border-border bg-muted/25 p-3 font-mono text-sm">
              {missingWeekMondays.map((d) => (
                <li key={d}>Week of {d}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className={kpiCardClass}>
        <CardHeader>
          <CardTitle className="text-base">Messages without usable CSV</CardTitle>
          <CardDescription>These matched the FY fetch but are excluded from totals until a valid attachment is present.</CardDescription>
        </CardHeader>
        <CardContent>
          {noCsvEmails.length === 0 ? (
            <p className="text-sm text-muted-foreground">None — all loaded messages have CSV rows.</p>
          ) : (
            <div className="max-h-64 overflow-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b border-border bg-muted/90 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-2.5 font-medium">Date</th>
                    <th className="p-2.5 font-medium">Subject</th>
                  </tr>
                </thead>
                <tbody>
                  {noCsvEmails.map((email, idx) => (
                    <tr key={email.id} className={idx % 2 ? "bg-muted/20" : ""}>
                      <td className="p-2.5 whitespace-nowrap text-muted-foreground">{email.date || "—"}</td>
                      <td className="p-2.5">{email.subject || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  tone,
  delta,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: string;
  delta?: string;
  accent?: string;
}) {
  return (
    <Card className={kpiCardClass}>
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className={`mt-1 text-2xl font-semibold tabular-nums ${accent ?? "text-foreground"}`}>{value}</p>
          {delta ? <p className="mt-1 text-xs text-muted-foreground">{delta}</p> : null}
        </div>
        <div className={`rounded-lg p-2 ${tone}`}>{icon}</div>
      </CardContent>
    </Card>
  );
}

function SeverityRow({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 1000) / 10 : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {value.toLocaleString()} <span className="text-xs">({pct}%)</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
