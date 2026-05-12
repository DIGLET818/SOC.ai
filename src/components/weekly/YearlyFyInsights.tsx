import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { GmailMessage } from "@/types/gmail";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle,
  CheckCircle2,
  ClipboardList,
  FileWarning,
  GitMerge,
  Inbox,
  Layers,
  LineChart as LineChartIcon,
  Mail,
  Sparkles,
} from "lucide-react";

const CHART_TOOLTIP = {
  contentStyle: {
    backgroundColor: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "10px",
    fontSize: "12px",
    boxShadow: "0 4px 24px hsl(0 0% 0% / 0.12)",
  },
} as const;

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
  mergedPct: number;
  backlog: number;
  resolved: number;
};

function enrichMonthRows(data: YearlyMonthTrendRow[]): EnrichedMonth[] {
  return data.map((d) => {
    const rows = d.rows || 0;
    const mergedPct = rows > 0 ? Math.round((1000 * d.merged) / rows) / 10 : 0;
    const pending = d.pending ?? 0;
    const backlog = d.open + d.inProgress + pending;
    const resolved = d.closed + d.merged + d.incidentAutoClosed;
    return { ...d, pending, mergedPct, backlog, resolved };
  });
}

const kpiCardClass =
  "rounded-2xl border border-border/80 bg-gradient-to-br from-card via-card to-muted/25 shadow-sm hover:shadow-md transition-shadow";

export function YearlyFyTrendSection({ data, fyLabel }: { data: YearlyMonthTrendRow[]; fyLabel?: string }) {
  const enriched = useMemo(() => enrichMonthRows(data), [data]);

  const fyTotals = useMemo(() => {
    const z = {
      rows: 0,
      reports: 0,
      merged: 0,
      closed: 0,
      open: 0,
      inProgress: 0,
      pending: 0,
      incidentAutoClosed: 0,
    };
    for (const d of data) {
      z.rows += d.rows;
      z.reports += d.reports;
      z.merged += d.merged;
      z.closed += d.closed;
      z.open += d.open;
      z.inProgress += d.inProgress;
      z.pending += d.pending ?? 0;
      z.incidentAutoClosed += d.incidentAutoClosed;
    }
    const backlog = z.open + z.inProgress + z.pending;
    const resolved = z.closed + z.merged + z.incidentAutoClosed;
    const mergedPctFy = z.rows > 0 ? Math.round((1000 * z.merged) / z.rows) / 10 : 0;
    const workload = resolved + backlog;
    const resolveWorkloadPct = workload > 0 ? Math.round((1000 * resolved) / workload) / 10 : 0;
    return { ...z, backlog, resolved, mergedPctFy, resolveWorkloadPct };
  }, [data]);

  if (!data.length) {
    return (
      <Card className="border-dashed border-2 bg-muted/15">
        <CardContent className="flex flex-col items-center justify-center py-14 px-6 text-center">
          <div className="rounded-full bg-primary/10 p-4 mb-4">
            <BarChart3 className="h-10 w-10 text-primary" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-1">No trend data for this FY yet</h3>
          <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
            Go to <strong className="text-foreground">Reports &amp; table</strong> and click <strong className="text-foreground">Refresh</strong> to load weekly CSVs.
            Trends appear once messages with attachments are in range.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-border/80 bg-gradient-to-r from-primary/[0.06] via-card to-card p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="rounded-xl bg-primary/12 p-2.5 shrink-0">
            <LineChartIcon className="h-6 w-6 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h2 className="text-lg font-semibold tracking-tight">FY workload &amp; closure trends</h2>
              {fyLabel ? (
                <Badge variant="secondary" className="font-normal">
                  {fyLabel}
                </Badge>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
              Numbers are summed from weekly CSVs by the report email&apos;s calendar month. Use charts to spot merge-heavy
              periods, backlog build-up, and how status mix evolves across the year.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end shrink-0">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted/70 px-2.5 py-1.5 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
            Same status rules as the table
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Card className={kpiCardClass}>
          <CardContent className="p-4 flex items-start gap-3">
            <Layers className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">FY total alerts</p>
              <p className="text-2xl font-bold tabular-nums tracking-tight">{fyTotals.rows}</p>
              <p className="text-xs text-muted-foreground mt-1 leading-snug">
                {fyTotals.reports} weekly files • {data.length} month{data.length !== 1 ? "s" : ""} with data
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className={kpiCardClass}>
          <CardContent className="p-4 flex items-start gap-3">
            <GitMerge className="h-5 w-5 text-violet-600 dark:text-violet-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">FY merged</p>
              <p className="text-2xl font-bold tabular-nums tracking-tight">{fyTotals.merged}</p>
              <p className="text-xs text-muted-foreground mt-1 leading-snug">{fyTotals.mergedPctFy}% of all alert rows</p>
            </div>
          </CardContent>
        </Card>
        <Card className={kpiCardClass}>
          <CardContent className="p-4 flex items-start gap-3">
            <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">FY resolved</p>
              <p className="text-2xl font-bold tabular-nums tracking-tight">{fyTotals.resolved}</p>
              <p className="text-xs text-muted-foreground mt-1 leading-snug">
                Closed + merged + auto closed • {fyTotals.resolveWorkloadPct}% of resolved + backlog
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className={kpiCardClass}>
          <CardContent className="p-4 flex items-start gap-3">
            <Inbox className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">FY backlog</p>
              <p className="text-2xl font-bold tabular-nums tracking-tight">{fyTotals.backlog}</p>
              <p className="text-xs text-muted-foreground mt-1 leading-snug">Open + in progress + pending (month sums)</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl border-border/80 shadow-sm overflow-hidden">
        <CardHeader className="pb-3 border-b border-border/60 bg-muted/25">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary shrink-0" />
            Month-by-month breakdown
          </CardTitle>
          <CardDescription className="leading-relaxed">
            One row per calendar month of the weekly report. Merged % is merged rows ÷ total alert rows in that month.
            Scroll horizontally on small screens; header stays visible while scrolling.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto max-h-[min(420px,55vh)]">
          <table className="w-full text-sm min-w-[780px]">
            <thead className="sticky top-0 z-10 border-b border-border bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/75">
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="py-2.5 px-3 font-medium">Month</th>
                <th className="py-2.5 pr-3 font-medium text-right tabular-nums">Reports</th>
                <th className="py-2.5 pr-3 font-medium text-right tabular-nums">Total alerts</th>
                <th className="py-2.5 pr-3 font-medium text-right tabular-nums">Merged</th>
                <th className="py-2.5 pr-3 font-medium text-right tabular-nums">Merged %</th>
                <th className="py-2.5 pr-3 font-medium text-right tabular-nums">Closed</th>
                <th className="py-2.5 pr-3 font-medium text-right tabular-nums">Auto closed</th>
                <th className="py-2.5 pr-3 font-medium text-right tabular-nums">Open</th>
                <th className="py-2.5 pr-3 font-medium text-right tabular-nums">In prog.</th>
                <th className="py-2.5 pr-3 font-medium text-right tabular-nums">Pending</th>
                <th className="py-2.5 px-3 font-medium text-right tabular-nums">Backlog</th>
              </tr>
            </thead>
            <tbody>
              {enriched.map((row, i) => (
                <tr
                  key={row.key}
                  className={`border-b border-border/50 ${i % 2 === 1 ? "bg-muted/20" : "bg-background"}`}
                >
                  <td className="py-2 px-3 font-medium text-foreground">{row.label}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{row.reports}</td>
                  <td className="py-2 pr-3 text-right tabular-nums font-medium">{row.rows}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-violet-700 dark:text-violet-300">{row.merged}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{row.mergedPct}%</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.closed}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.incidentAutoClosed}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.open}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.inProgress}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-sky-800/90 dark:text-sky-200/90">{row.pending}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-amber-800/90 dark:text-amber-200/90">{row.backlog}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2 px-0.5">
          <BarChart3 className="h-4 w-4 text-muted-foreground shrink-0" />
          Closures &amp; merge activity
        </h3>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Card className="rounded-2xl border-border/80 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Merged &amp; closed trend</CardTitle>
              <CardDescription className="leading-relaxed">
                Absolute counts per month: merged, manually closed, and incident auto-closed (same rules as the data table).
              </CardDescription>
            </CardHeader>
            <CardContent className="h-[280px] pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={enriched} margin={{ top: 10, right: 12, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-35} textAnchor="end" height={64} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={40} />
                  <Tooltip {...CHART_TOOLTIP} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="merged" name="Merged" stroke="hsl(262 83% 58%)" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="closed" name="Closed" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={{ r: 3 }} />
                  <Line
                    type="monotone"
                    dataKey="incidentAutoClosed"
                    name="Auto closed"
                    stroke="hsl(var(--destructive))"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border/80 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Merged share of volume</CardTitle>
              <CardDescription className="leading-relaxed">
                Bars: merged row count. Line: merged as a percentage of that month&apos;s total alert rows — highlights
                merge-heavy periods.
              </CardDescription>
            </CardHeader>
            <CardContent className="h-[280px] pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={enriched} margin={{ top: 10, right: 12, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-35} textAnchor="end" height={64} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} allowDecimals={false} width={40} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" width={44} />
                  <Tooltip
                    {...CHART_TOOLTIP}
                    formatter={(value: number, name: string) => {
                      if (name === "mergedPct") return [`${value}%`, "Merged % of rows"];
                      if (name === "merged") return [value, "Merged count"];
                      return [value, name];
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="left" dataKey="merged" name="Merged (count)" fill="hsl(262 83% 58%)" radius={[4, 4, 0, 0]} />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="mergedPct"
                    name="Merged %"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2 px-0.5">
          <Layers className="h-4 w-4 text-muted-foreground shrink-0" />
          Workload shape
        </h3>
        <Card className="rounded-2xl border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Backlog vs resolved (monthly)</CardTitle>
            <CardDescription className="leading-relaxed">
              Backlog = open + in progress + <strong className="text-foreground font-medium">pending</strong>. Resolved =
              closed + merged + incident auto closed. Each bar is the sum for that month; use it to see when backlog grew
              vs when closures caught up.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[300px] pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={enriched} margin={{ top: 10, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-35} textAnchor="end" height={64} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={40} />
                <Tooltip {...CHART_TOOLTIP} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="backlog" name="Backlog" fill="hsl(var(--chart-4))" stackId="a" radius={[0, 0, 0, 0]} />
                <Bar dataKey="resolved" name="Resolved" fill="hsl(var(--chart-2))" stackId="a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Month-wise volume</CardTitle>
            <CardDescription className="leading-relaxed">
              Alert rows from each weekly CSV, grouped by the report email&apos;s calendar month. Multiple sends in one
              month add together (not deduplicated). The line shows how many distinct weekly files contributed.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[320px] pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ top: 10, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-35} textAnchor="end" height={64} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} allowDecimals={false} width={40} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} allowDecimals={false} width={36} />
                <Tooltip
                  {...CHART_TOOLTIP}
                  formatter={(value: number, name: string) => {
                    if (name === "reports") return [value, "Weekly reports"];
                    if (name === "rows") return [value, "Alert rows (summed)"];
                    return [value, name];
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="left" dataKey="rows" name="Alert rows" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="reports"
                  name="Reports in month"
                  stroke="hsl(var(--chart-2))"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2 px-0.5">
          <Sparkles className="h-4 w-4 text-muted-foreground shrink-0" />
          Status distribution
        </h3>
        <Card className="rounded-2xl border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Status mix by month</CardTitle>
            <CardDescription className="leading-relaxed">
              Stacked counts from CSV Status (plus your overrides), summed across all reports attributed to that month.
              Pending sits between in-progress and closed so you can see queue pressure before closure.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[300px] pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 10, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-35} textAnchor="end" height={64} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={40} />
                <Tooltip {...CHART_TOOLTIP} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="open" stackId="s" name="Open" fill="hsl(var(--chart-4))" />
                <Bar dataKey="inProgress" stackId="s" name="In progress" fill="hsl(var(--chart-3))" />
                <Bar dataKey="pending" stackId="s" name="Pending" fill="hsl(199 89% 48%)" />
                <Bar dataKey="closed" stackId="s" name="Closed" fill="hsl(var(--chart-2))" />
                <Bar dataKey="merged" stackId="s" name="Merged" fill="hsl(var(--muted-foreground))" />
                <Bar dataKey="incidentAutoClosed" stackId="s" name="Auto closed" fill="hsl(var(--destructive))" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
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
  /** Optional FY label for context (e.g. "FY 2025–26"). */
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
  const hasData = totalFromApi > 0;
  const csvAttachRate = totalFromApi > 0 ? Math.round((1000 * withCsv) / totalFromApi) / 10 : 0;

  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-border/80 bg-gradient-to-r from-blue-500/[0.06] via-card to-card p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="rounded-xl bg-blue-500/12 p-2.5 shrink-0">
            <Mail className="h-6 w-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h2 className="text-lg font-semibold tracking-tight">Fetch &amp; attachment health</h2>
              {fyLabel ? (
                <Badge variant="secondary" className="font-normal">
                  {fyLabel}
                </Badge>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
              Sanity-check how complete your FY pull is: message counts, CSV attachment rate, possible missing weeks, and
              emails that matched the search but had no usable spreadsheet.
            </p>
          </div>
        </div>
        {hasData ? (
          <div className="flex flex-wrap gap-2 lg:justify-end shrink-0">
            <Badge variant="outline" className="font-normal tabular-nums">
              {csvAttachRate}% with CSV
            </Badge>
            <Badge variant="outline" className="font-normal tabular-nums">
              ~{approxWeeksInRange} weeks in range
            </Badge>
          </div>
        ) : null}
      </div>

      {hasData && (
        <Card className="rounded-2xl border-border/70 bg-muted/20 shadow-sm">
          <CardContent className="p-4 text-sm text-muted-foreground leading-relaxed">
            Compare <strong className="text-foreground font-medium">{withCsv}</strong> usable weekly reports to roughly{" "}
            <strong className="text-foreground font-medium">{approxWeeksInRange}</strong> calendar weeks in the FY. Large
            gaps or many &quot;no CSV&quot; rows mean totals and trends may be incomplete until fetches or attachments are
            fixed.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className={kpiCardClass}>
          <CardContent className="p-4 flex items-start gap-3">
            <Mail className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Gmail messages</p>
              <p className="text-2xl font-bold tabular-nums tracking-tight">{totalFromApi}</p>
              <p className="text-xs text-muted-foreground mt-1 leading-snug">Returned for sender + subject in FY window</p>
            </div>
          </CardContent>
        </Card>
        <Card className={kpiCardClass}>
          <CardContent className="p-4 flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">With CSV data</p>
              <p className="text-2xl font-bold tabular-nums tracking-tight">{withCsv}</p>
              <p className="text-xs text-muted-foreground mt-1 leading-snug">Attachments with ≥1 data row</p>
            </div>
          </CardContent>
        </Card>
        <Card className={kpiCardClass}>
          <CardContent className="p-4 flex items-start gap-3">
            <FileWarning className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">No usable CSV</p>
              <p className="text-2xl font-bold tabular-nums tracking-tight">{withoutCsv}</p>
              <p className="text-xs text-muted-foreground mt-1 leading-snug">Missing or empty attachment</p>
            </div>
          </CardContent>
        </Card>
        <Card className={kpiCardClass}>
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className={`h-5 w-5 shrink-0 mt-0.5 ${hitCap ? "text-destructive" : "text-muted-foreground"}`} />
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">API limit</p>
              <p className="text-2xl font-bold tabular-nums tracking-tight">
                {totalFromApi}/{maxResults}
              </p>
              <p className="text-xs text-muted-foreground mt-1 leading-snug">
                {hitCap ? "Hit cap — list may be truncated; totals can be incomplete." : "Under max results cap"}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {hitCap && (
        <div className="rounded-xl border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive flex gap-2 items-start">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span className="leading-relaxed">
            The API returned the maximum number of messages ({maxResults}). Some weekly reports may be missing from this view.
            Ask your team to raise the server limit or split the FY into smaller date ranges.
          </span>
        </div>
      )}

      <Card className="rounded-2xl border-border/80 shadow-sm overflow-hidden">
        <CardHeader className="pb-3 border-b border-border/60 bg-muted/25">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary shrink-0" />
            Week coverage (heuristic)
          </CardTitle>
          <CardDescription className="leading-relaxed">
            ~{approxWeeksInRange} calendar weeks in this FY. We flag ISO weeks (Monday start) with no matching message in the
            loaded set. Public holidays, extra sends, or timezone edge cases can cause false gaps or false OK.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {!hasData ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/15 px-4 py-6 text-center text-sm text-muted-foreground">
              Refresh FY data on the Reports tab to evaluate week gaps against your Gmail results.
            </div>
          ) : missingWeekMondays.length === 0 ? (
            <p className="text-sm text-green-700 dark:text-green-400 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Every week in range has at least one fetched message (still verify CSV quality below).
            </p>
          ) : (
            <div>
              <p className="text-sm text-amber-800 dark:text-amber-200 mb-2 leading-relaxed">
                {missingWeekMondays.length} week(s) with no message in the loaded set — possible missing fetch or no email
                that week:
              </p>
              <ul className="text-sm font-mono bg-muted/40 rounded-xl border border-border max-h-48 overflow-auto p-3 space-y-1">
                {missingWeekMondays.map((d) => (
                  <li key={d}>Week of {d} (Monday)</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border/80 shadow-sm overflow-hidden">
        <CardHeader className="pb-3 border-b border-border/60 bg-muted/25">
          <CardTitle className="text-base flex items-center gap-2">
            <FileWarning className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            Messages without usable CSV
          </CardTitle>
          <CardDescription className="leading-relaxed">
            These matched the search but will not appear in the table or month sums until a valid attachment is present.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {noCsvEmails.length === 0 ? (
            <p className="text-sm text-muted-foreground">None — all loaded messages have CSV rows.</p>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden max-h-64 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 border-b border-border bg-muted/95 backdrop-blur text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-2.5 font-medium">Date</th>
                    <th className="p-2.5 font-medium">Subject</th>
                  </tr>
                </thead>
                <tbody>
                  {noCsvEmails.map((e, i) => (
                    <tr key={e.id} className={`border-t border-border/60 ${i % 2 === 1 ? "bg-muted/15" : ""}`}>
                      <td className="p-2.5 whitespace-nowrap text-muted-foreground tabular-nums">{e.date || "—"}</td>
                      <td className="p-2.5 min-w-0 break-words">{e.subject || "—"}</td>
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
