import { useCallback, useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { SOCSidebar } from "@/components/SOCSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, AlertCircle, BarChart3, Loader2, Mail, MinusCircle, RefreshCw, Search } from "lucide-react";
import { TopUseCaseAlertsLeaderboard } from "@/components/analysis/TopUseCaseAlertsLeaderboard";
import {
  loadSiemUseCaseAnalysisFromApi,
  type RuleTriggerRow,
  type SiemUseCaseAnalysis,
} from "@/lib/siemUseCaseAnalysis";
import {
  DEFAULT_MAILBOX_FROM,
  fetchMailboxFrequency,
  filterMailboxRules,
  formatAlertCount,
  loadCachedMailboxHits,
  totalAlertsForRule,
  type AlertCountsByRule,
  type MailboxFrequencyResult,
} from "@/lib/siemMailboxFrequency";

const CHART_TOOLTIP = {
  contentStyle: {
    backgroundColor: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "8px",
    fontSize: "12px",
  },
} as const;

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: string;
}) {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-3 flex gap-2">
        <div className={`rounded-md p-2 h-fit shrink-0 ${accent ?? "bg-muted"}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] text-muted-foreground leading-tight">{label}</p>
          <p className="text-xl font-semibold tabular-nums leading-tight">{value}</p>
          {sub ? <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function RulesTable({
  rules,
  monthColumns,
  emptyMessage,
  alertCounts,
}: {
  rules: RuleTriggerRow[];
  monthColumns: string[];
  emptyMessage: string;
  alertCounts?: AlertCountsByRule;
}) {
  if (!rules.length) {
    return <p className="text-sm text-muted-foreground py-6 text-center">{emptyMessage}</p>;
  }
  return (
    <div className="overflow-auto max-h-[min(50vh,28rem)] rounded-md border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="text-xs sticky top-0 bg-muted">Rule name</TableHead>
            <TableHead className="text-xs sticky top-0 bg-muted w-20">Severity</TableHead>
            <TableHead className="text-xs sticky top-0 bg-muted w-24 text-center">Months hit</TableHead>
            {monthColumns.map((m) => (
              <TableHead key={m} className="text-xs sticky top-0 bg-muted text-center whitespace-nowrap">
                {m}
              </TableHead>
            ))}
            <TableHead className="text-xs sticky top-0 bg-muted text-center">Total alerts</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.map((r) => (
            <TableRow key={r.rowId}>
              <TableCell className="text-xs align-top max-w-md">
                <span className="line-clamp-2" title={r.ruleName}>
                  {r.ruleName}
                </span>
              </TableCell>
              <TableCell className="text-xs">{r.severity || "—"}</TableCell>
              <TableCell className="text-xs text-center font-medium tabular-nums">
                {r.monthsTriggered}/{monthColumns.length}
              </TableCell>
              {monthColumns.map((m) => {
                const mappedId = String(r.byMonth[m]?.value ?? "").trim();
                const hit = alertCounts?.[r.ruleName]?.[m];
                const tooltip =
                  hit !== undefined && mappedId && !/^n\/?a$/i.test(mappedId)
                    ? `Latest mapped: ${mappedId}`
                    : hit !== undefined
                      ? "No INC/CS mapped in workbook for this month"
                      : "Run Scan mailbox to load alert counts";
                return (
                  <TableCell key={m} className="text-xs text-center tabular-nums">
                    {hit !== undefined ? (
                      <span
                        className={
                          hit.count > 0
                            ? "font-medium text-emerald-600 dark:text-emerald-400"
                            : "text-muted-foreground/60"
                        }
                        title={tooltip}
                      >
                        {formatAlertCount(hit.count, hit.capped)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/40" title={tooltip}>
                        —
                      </span>
                    )}
                  </TableCell>
                );
              })}
              <TableCell className="text-xs text-center font-semibold tabular-nums">
                {alertCounts?.[r.ruleName]
                  ? formatAlertCount(totalAlertsForRule(r.ruleName, monthColumns, alertCounts))
                  : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function Analysis() {
  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState<SiemUseCaseAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mailbox, setMailbox] = useState<MailboxFrequencyResult | null>(null);
  const [mailboxLoading, setMailboxLoading] = useState(false);
  const [mailboxProgress, setMailboxProgress] = useState<string | null>(null);
  const [mailboxError, setMailboxError] = useState<string | null>(null);
  const [ruleSearch, setRuleSearch] = useState("");
  const [alertCounts, setAlertCounts] = useState<AlertCountsByRule>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await loadSiemUseCaseAnalysisFromApi();
    if ("error" in res) {
      setAnalysis(null);
      setAlertCounts({});
      setError(res.error);
    } else {
      setAnalysis(res);
      setError(null);
      const cached = await loadCachedMailboxHits({
        ruleNames: res.rules.map((r) => r.ruleName),
        monthColumns: res.monthColumns,
        fromFilter: DEFAULT_MAILBOX_FROM,
      });
      if (!("error" in cached)) {
        setAlertCounts(cached);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const neverRules = useMemo(
    () => analysis?.rules.filter((r) => r.monthsTriggered === 0) ?? [],
    [analysis]
  );
  const highRules = useMemo(
    () => analysis?.rules.filter((r) => r.frequency === "high") ?? [],
    [analysis]
  );
  const lowRules = useMemo(
    () => analysis?.rules.filter((r) => r.frequency === "low") ?? [],
    [analysis]
  );

  const monthBarColors = useMemo(() => {
    const palette = ["#2563eb", "#16a34a", "#ea580c", "#dc2626", "#7c3aed", "#0891b2"];
    return analysis?.monthColumns.map((_, i) => palette[i % palette.length]) ?? [];
  }, [analysis]);

  const mailboxBarColors = useMemo(() => {
    const palette = ["#0d9488", "#2563eb", "#ca8a04", "#c026d3"];
    return mailbox?.monthColumns.map((_, i) => palette[i % palette.length]) ?? [];
  }, [mailbox]);

  const filteredMailboxRules = useMemo(
    () => (mailbox ? filterMailboxRules(mailbox.rules, ruleSearch) : []),
    [mailbox, ruleSearch]
  );

  const topRulesByAlertCount = useMemo(() => {
    if (!analysis) return [];
    const monthColumns = analysis.monthColumns;
    const hasAnyCounts = Object.keys(alertCounts).length > 0;
    if (!hasAnyCounts) return [];

    return analysis.rules
      .map((r) => {
        const byMonth: Record<string, number> = {};
        for (const m of monthColumns) {
          byMonth[m] = alertCounts[r.ruleName]?.[m]?.count ?? 0;
        }
        const totalAlerts = Object.values(byMonth).reduce((s, n) => s + n, 0);
        return {
          ruleName: r.ruleName,
          severity: r.severity,
          totalAlerts,
          byMonth,
          monthsTriggered: r.monthsTriggered,
        };
      })
      .filter((r) => r.totalAlerts > 0)
      .sort((a, b) => b.totalAlerts - a.totalAlerts || a.ruleName.localeCompare(b.ruleName))
      .slice(0, 12);
  }, [analysis, alertCounts]);

  const runMailboxAnalysis = useCallback(async () => {
    if (!analysis) return;
    setMailboxLoading(true);
    setMailboxError(null);
    setMailboxProgress("Starting mailbox scan…");
    const ruleNames = analysis.rules.map((r) => r.ruleName);
    const res = await fetchMailboxFrequency({
      ruleNames,
      monthColumns: analysis.monthColumns,
      fromFilter: DEFAULT_MAILBOX_FROM,
      onProgress: setMailboxProgress,
      onRuleComplete: (rule) => {
        setAlertCounts((prev) => ({ ...prev, [rule.ruleName]: rule.byMonth }));
      },
    });
    setMailboxLoading(false);
    setMailboxProgress(null);
    if ("error" in res) {
      setMailboxError(res.error);
      return;
    }
    setMailbox(res);
    setMailboxError(null);
  }, [analysis]);

  return (
    <SidebarProvider>
      <SOCSidebar />
      <SidebarInset className="max-h-svh overflow-hidden flex flex-col">
        <div className="flex min-h-0 flex-1 flex-col min-w-0 overflow-hidden bg-background">
          <header className="z-10 shrink-0 border-b bg-background/95 px-4 py-2">
            <div className="flex flex-wrap items-center gap-2 justify-between">
              <div className="min-w-0">
                <h1 className="text-lg font-semibold text-foreground truncate">Use case Analysis</h1>
                <p className="text-[11px] text-muted-foreground">
                  Trigger trends from SIEM Master month columns (INC/CS = triggered, NA = not)
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => void load()} disabled={loading}>
                  {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Refresh
                </Button>
                <ThemeToggle />
                <NotificationsPanel />
              </div>
            </div>
          </header>

          <main className="flex-1 overflow-auto p-3 space-y-3">
            {loading && !analysis ? (
              <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading workbook from database…
              </div>
            ) : error ? (
              <Card className="border-destructive/50">
                <CardContent className="py-8 text-center space-y-3">
                  <AlertCircle className="h-8 w-8 mx-auto text-destructive" />
                  <p className="text-sm text-destructive">{error}</p>
                  <Button size="sm" variant="outline" onClick={() => void load()}>
                    Retry
                  </Button>
                </CardContent>
              </Card>
            ) : analysis ? (
              <>
                <p className="text-[11px] text-muted-foreground px-0.5">
                  Sheet <span className="font-medium text-foreground">{analysis.sheetName}</span> ·{" "}
                  {analysis.monthColumns.join(", ")} · {analysis.kpis.totalRules} rules · Workbook = latest
                  INC/CS per month; run mailbox scan for Gmail hit counts
                </p>

                <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
                  <KpiCard label="Total use cases" value={analysis.kpis.totalRules} icon={BarChart3} />
                  <KpiCard
                    label="Triggered ≥1 month"
                    value={analysis.kpis.triggeredAtLeastOnce}
                    sub={`${Math.round((analysis.kpis.triggeredAtLeastOnce / analysis.kpis.totalRules) * 100)}% of rules`}
                    icon={Activity}
                    accent="bg-emerald-500/15"
                  />
                  <KpiCard
                    label="Never triggered"
                    value={analysis.kpis.neverTriggered}
                    sub="All month cells NA/empty"
                    icon={MinusCircle}
                    accent="bg-muted"
                  />
                  <KpiCard
                    label="Avg monthly rules triggered"
                    value={analysis.kpis.avgRulesTriggeredPerMonth}
                    sub={`Across ${analysis.monthColumns.length} months`}
                    icon={Activity}
                    accent="bg-sky-500/15"
                  />
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <Card>
                    <CardHeader className="py-3 px-4">
                      <CardTitle className="text-sm">Rules triggered per month</CardTitle>
                      <CardDescription className="text-xs">
                        How many distinct rules had at least one incident (INC/CS) in each month
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="pb-3 px-2">
                      <div className="h-[220px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={analysis.triggersPerMonth} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
                            <Tooltip
                              {...CHART_TOOLTIP}
                              formatter={(value: number, _n, p) => [
                                `${value} rules (${(p.payload as { pct: number }).pct}%)`,
                                "Triggered",
                              ]}
                            />
                            <Bar dataKey="count" name="Rules triggered" radius={[4, 4, 0, 0]}>
                              {analysis.triggersPerMonth.map((_, i) => (
                                <Cell key={i} fill={monthBarColors[i]} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="py-3 px-4 space-y-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <CardTitle className="text-sm flex items-center gap-1.5">
                            <Mail className="h-3.5 w-3.5" />
                            Mailbox alert frequency
                          </CardTitle>
                          <CardDescription className="text-xs">
                            Gmail matches per rule per month ({DEFAULT_MAILBOX_FROM}) — how often each use case
                            actually fired
                          </CardDescription>
                        </div>
                        <Button
                          size="sm"
                          className="h-7 text-xs shrink-0"
                          onClick={() => void runMailboxAnalysis()}
                          disabled={mailboxLoading}
                        >
                          {mailboxLoading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                          ) : (
                            <Mail className="h-3.5 w-3.5 mr-1" />
                          )}
                          {mailbox ? "Re-scan mailbox" : "Scan mailbox"}
                        </Button>
                      </div>
                      {mailboxProgress ? (
                        <p className="text-[10px] text-muted-foreground">{mailboxProgress}</p>
                      ) : null}
                      {mailboxError ? (
                        <p className="text-[10px] text-destructive">{mailboxError}</p>
                      ) : null}
                    </CardHeader>
                    <CardContent className="pb-3 px-2 space-y-3">
                      {!mailbox && !mailboxLoading ? (
                        <p className="text-xs text-muted-foreground text-center py-8 px-4">
                          Run a mailbox scan to see how many alert emails matched each rule in each month (not just
                          whether an INC was mapped).
                        </p>
                      ) : mailbox ? (
                        <>
                          <div className="h-[220px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart
                                data={mailbox.totalsPerMonth}
                                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                              >
                                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={40} />
                                <Tooltip
                                  {...CHART_TOOLTIP}
                                  formatter={(value: number) => [`${value} emails`, "Gmail hits"]}
                                />
                                <Bar dataKey="totalHits" name="Gmail hits" radius={[4, 4, 0, 0]}>
                                  {mailbox.totalsPerMonth.map((_, i) => (
                                    <Cell key={i} fill={mailboxBarColors[i]} />
                                  ))}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="relative px-2">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                              className="h-8 pl-8 text-xs"
                              placeholder="Filter rules (e.g. mailbox, o365, failed login)…"
                              value={ruleSearch}
                              onChange={(e) => setRuleSearch(e.target.value)}
                            />
                          </div>
                          <div className="overflow-auto max-h-[min(40vh,22rem)] rounded-md border mx-2">
                            <Table>
                              <TableHeader>
                                <TableRow className="bg-muted/50">
                                  <TableHead className="text-xs sticky top-0 bg-muted">Rule</TableHead>
                                  {mailbox.monthColumns.map((m) => (
                                    <TableHead
                                      key={m}
                                      className="text-xs sticky top-0 bg-muted text-center whitespace-nowrap w-16"
                                    >
                                      {m}
                                    </TableHead>
                                  ))}
                                  <TableHead className="text-xs sticky top-0 bg-muted text-center w-14">
                                    Total
                                  </TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {filteredMailboxRules.length === 0 ? (
                                  <TableRow>
                                    <TableCell
                                      colSpan={mailbox.monthColumns.length + 2}
                                      className="text-xs text-center text-muted-foreground py-6"
                                    >
                                      No rules match your filter.
                                    </TableCell>
                                  </TableRow>
                                ) : (
                                  filteredMailboxRules.slice(0, 80).map((r) => (
                                    <TableRow key={r.ruleName}>
                                      <TableCell className="text-xs align-top max-w-xs">
                                        <span className="line-clamp-2" title={r.ruleName}>
                                          {r.ruleName}
                                        </span>
                                      </TableCell>
                                      {mailbox.monthColumns.map((m) => {
                                        const cell = r.byMonth[m];
                                        const n = cell?.count ?? 0;
                                        return (
                                          <TableCell
                                            key={m}
                                            className="text-xs text-center tabular-nums font-medium"
                                          >
                                            {n > 0 ? (
                                              <span
                                                className={cell?.capped ? "text-amber-600 dark:text-amber-400" : ""}
                                                title={cell?.capped ? "Count capped at API max" : undefined}
                                              >
                                                {n}
                                                {cell?.capped ? "+" : ""}
                                              </span>
                                            ) : (
                                              <span className="text-muted-foreground/40">0</span>
                                            )}
                                          </TableCell>
                                        );
                                      })}
                                      <TableCell className="text-xs text-center font-semibold tabular-nums">
                                        {r.totalHits}
                                      </TableCell>
                                    </TableRow>
                                  ))
                                )}
                              </TableBody>
                            </Table>
                          </div>
                          {filteredMailboxRules.length > 80 ? (
                            <p className="text-[10px] text-muted-foreground text-center">
                              Showing top 80 of {filteredMailboxRules.length} matching rules by total hits.
                            </p>
                          ) : null}
                          <p className="text-[10px] text-muted-foreground text-center pb-1">
                            Scanned {new Date(mailbox.loadedAt).toLocaleString()}
                          </p>
                        </>
                      ) : (
                        <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span className="text-xs">{mailboxProgress ?? "Scanning…"}</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader className="py-3 px-4">
                    <CardTitle className="text-sm">Top use cases by alert volume</CardTitle>
                    <CardDescription className="text-xs">
                      Ranked by total Gmail alerts in {analysis.monthColumns.join(", ")} — colored bar shows
                      how volume splits across months
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pb-4 px-3">
                    <TopUseCaseAlertsLeaderboard
                      rows={topRulesByAlertCount}
                      monthColumns={analysis.monthColumns}
                      maxItems={10}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="py-3 px-4 pb-2">
                    <CardTitle className="text-sm">Rule inventory</CardTitle>
                    <CardDescription className="text-xs">
                      Alert counts per month from mailbox scan (cached in DB). Hover for latest mapped INC/CS
                      from workbook.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <Tabs defaultValue="never">
                      <TabsList className="h-8 mb-3">
                        <TabsTrigger value="never" className="text-xs px-2 h-7">
                          Never triggered ({neverRules.length})
                        </TabsTrigger>
                        <TabsTrigger value="high" className="text-xs px-2 h-7">
                          High frequency ({highRules.length})
                        </TabsTrigger>
                        <TabsTrigger value="low" className="text-xs px-2 h-7">
                          Low (1 month) ({lowRules.length})
                        </TabsTrigger>
                        <TabsTrigger value="all" className="text-xs px-2 h-7">
                          All rules ({analysis.rules.length})
                        </TabsTrigger>
                      </TabsList>
                      <TabsContent value="never">
                        <RulesTable
                          rules={neverRules}
                          monthColumns={analysis.monthColumns}
                          emptyMessage="Every rule triggered in at least one month."
                          alertCounts={alertCounts}
                        />
                      </TabsContent>
                      <TabsContent value="high">
                        <RulesTable
                          rules={highRules}
                          monthColumns={analysis.monthColumns}
                          emptyMessage="No rules triggered in 3+ months."
                          alertCounts={alertCounts}
                        />
                      </TabsContent>
                      <TabsContent value="low">
                        <RulesTable
                          rules={lowRules}
                          monthColumns={analysis.monthColumns}
                          emptyMessage="No rules with exactly one active month."
                          alertCounts={alertCounts}
                        />
                      </TabsContent>
                      <TabsContent value="all">
                        <RulesTable
                          rules={analysis.rules}
                          monthColumns={analysis.monthColumns}
                          emptyMessage="No rules."
                          alertCounts={alertCounts}
                        />
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>
              </>
            ) : null}
          </main>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
