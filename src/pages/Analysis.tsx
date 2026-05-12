import { useCallback, useEffect, useMemo, useState } from "react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { SOCSidebar } from "@/components/SOCSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, RefreshCw } from "lucide-react";
import {
  defaultAnalysisAfterDate,
  defaultAnalysisBeforeDate,
  loadSiemMasterRuleNamesFromStorage,
} from "@/lib/siemMasterRules";
import { postGmailRuleHits, type GmailRuleHitsResponse, type GmailRuleHitRow } from "@/api/gmail";
import { useToast } from "@/hooks/use-toast";

const DEFAULT_FROM_HINT = "nttin.support@global.ntt";

function sortResults(rows: GmailRuleHitRow[]): GmailRuleHitRow[] {
  return [...rows].sort((a, b) => {
    if (b.match_count !== a.match_count) return b.match_count - a.match_count;
    return a.rule_name.localeCompare(b.rule_name);
  });
}

export default function Analysis() {
  const { toast } = useToast();
  const [masterInfo, setMasterInfo] = useState(() => loadSiemMasterRuleNamesFromStorage());
  const [afterDate, setAfterDate] = useState(defaultAnalysisAfterDate);
  const [beforeDate, setBeforeDate] = useState(defaultAnalysisBeforeDate);
  const [fromFilter, setFromFilter] = useState("");
  const [restrictSender, setRestrictSender] = useState(false);
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<GmailRuleHitsResponse | null>(null);
  const [showZeroOnly, setShowZeroOnly] = useState(false);

  const refreshMaster = useCallback(() => {
    setMasterInfo(loadSiemMasterRuleNamesFromStorage());
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "siemWorkbookV2") refreshMaster();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refreshMaster]);

  const ruleCount = masterInfo.rules.length;

  const displayRows = useMemo(() => {
    if (!response?.results?.length) return [];
    const sorted = sortResults(response.results);
    if (showZeroOnly) return sorted.filter((r) => r.match_count === 0 && !r.error);
    return sorted;
  }, [response, showZeroOnly]);

  const runAnalysis = async () => {
    if (!masterInfo.rules.length || masterInfo.error) {
      toast({ title: "No rules to analyze", description: masterInfo.error ?? "Load SIEM Master first.", variant: "destructive" });
      return;
    }
    setLoading(true);
    setResponse(null);
    try {
      const from = restrictSender ? (fromFilter.trim() || DEFAULT_FROM_HINT) : fromFilter.trim() || undefined;
      const res = await postGmailRuleHits({
        ruleNames: masterInfo.rules,
        afterDate,
        beforeDate,
        fromFilter: from,
      });
      setResponse(res);
      toast({ title: "Analysis complete", description: `${res.summary.rules_with_hits} rules with at least one matching email in range.` });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "Analysis failed", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <SidebarProvider>
      <SOCSidebar />
      <SidebarInset className="max-h-svh overflow-hidden flex flex-col">
        <div className="flex min-h-0 flex-1 flex-col min-w-0 overflow-hidden bg-background">
          <header className="z-10 shrink-0 border-b bg-background/95 px-6 py-3">
            <div className="flex flex-wrap items-center gap-3 justify-between">
              <div className="min-w-0">
                <h1 className="text-2xl font-bold text-foreground truncate">Use case Analysis</h1>
                <p className="text-sm text-muted-foreground">
                  Match SIEM Master rule names to Gmail (subjects often embed the rule id and title).
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <ThemeToggle />
                <NotificationsPanel />
              </div>
            </div>
          </header>

          <main className="flex-1 overflow-auto p-6 space-y-6">
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
                <div>
                  <CardTitle>SIEM Master ↔ Gmail</CardTitle>
                  <CardDescription>
                    Reads unique rule names from the <strong className="text-foreground">SIEM Master</strong> sheet (
                    <code className="text-xs">Rule Name</code> column). Shared customer ids (e.g.{" "}
                    <code className="text-xs">125850341</code>) and the <code className="text-xs">Policy Bazaar</code> prefix
                    are stripped; each rule is searched by its <strong className="text-foreground">distinctive title</strong>{" "}
                    (keyword AND in Gmail, then subjects are scored so samples align with that rule).
                  </CardDescription>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={refreshMaster} className="shrink-0 gap-1">
                  <RefreshCw className="h-4 w-4" />
                  Reload sheet
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {masterInfo.error ? (
                  <p className="text-sm text-destructive">{masterInfo.error}</p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Sheet <span className="text-foreground font-medium">{masterInfo.sheetName}</span>, column{" "}
                    <span className="text-foreground font-medium">{masterInfo.ruleColumn}</span> —{" "}
                    <span className="text-foreground font-medium">{ruleCount}</span> unique rules loaded.
                  </p>
                )}

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-2">
                    <Label htmlFor="after-date">After (inclusive)</Label>
                    <Input
                      id="after-date"
                      type="date"
                      value={afterDate}
                      onChange={(e) => setAfterDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="before-date">Before (exclusive)</Label>
                    <Input
                      id="before-date"
                      type="date"
                      value={beforeDate}
                      onChange={(e) => setBeforeDate(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Default range: Feb 1 (current or prior year if before Feb) through end of today. Adjust as needed.
                    </p>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="from-filter">Sender filter (optional)</Label>
                    <Input
                      id="from-filter"
                      type="email"
                      placeholder={DEFAULT_FROM_HINT}
                      value={fromFilter}
                      onChange={(e) => setFromFilter(e.target.value)}
                    />
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="restrict-sender"
                        checked={restrictSender}
                        onCheckedChange={(v) => setRestrictSender(v === true)}
                      />
                      <label htmlFor="restrict-sender" className="text-sm text-muted-foreground cursor-pointer">
                        Require sender (uses field value, or default support address if empty)
                      </label>
                    </div>
                  </div>
                </div>

                <Button onClick={runAnalysis} disabled={loading || !ruleCount} className="gap-2">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {loading ? "Searching Gmail…" : "Run analysis"}
                </Button>
                {loading && ruleCount > 0 && (
                  <p className="text-xs text-muted-foreground">
                    One Gmail query per rule ({ruleCount} total). Large workbooks can take several minutes.
                  </p>
                )}
              </CardContent>
            </Card>

            {response && (
              <Card>
                <CardHeader>
                  <CardTitle>Results</CardTitle>
                  <CardDescription>
                    Range {response.after_date} → {response.before_date}
                    {response.from_filter ? ` · from:${response.from_filter}` : " · all senders"}
                    . Counts are emails whose subjects match the rule title after keyword search (max 500 candidates scanned per
                    rule; &quot;500+&quot; when Gmail has more pages).
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                    <div className="rounded-md border bg-muted/30 px-3 py-2">
                      <div className="text-muted-foreground">Rules analyzed</div>
                      <div className="text-lg font-semibold">{response.summary.rules_submitted}</div>
                    </div>
                    <div className="rounded-md border bg-muted/30 px-3 py-2">
                      <div className="text-muted-foreground">Rules with ≥1 email</div>
                      <div className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                        {response.summary.rules_with_hits}
                      </div>
                    </div>
                    <div className="rounded-md border bg-muted/30 px-3 py-2">
                      <div className="text-muted-foreground">Rules with 0 emails</div>
                      <div className="text-lg font-semibold">{response.summary.rules_with_zero_hits}</div>
                    </div>
                    <div className="rounded-md border bg-muted/30 px-3 py-2">
                      <div className="text-muted-foreground">Sum of row counts (first page)</div>
                      <div className="text-lg font-semibold tabular-nums">
                        {response.summary.sum_match_count_first_page}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="zero-only"
                      checked={showZeroOnly}
                      onCheckedChange={(v) => setShowZeroOnly(v === true)}
                    />
                    <label htmlFor="zero-only" className="text-sm cursor-pointer">
                      Show only rules with zero matches
                    </label>
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[200px]">Rule name</TableHead>
                        <TableHead className="whitespace-nowrap">Distinctive title</TableHead>
                        <TableHead className="text-right whitespace-nowrap">Matches</TableHead>
                        <TableHead>Sample subjects</TableHead>
                        <TableHead className="min-w-[120px]">Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {displayRows.map((row) => (
                        <TableRow key={row.rule_name}>
                          <TableCell className="align-top max-w-md">
                            <span className="line-clamp-3" title={row.rule_name}>
                              {row.rule_name}
                            </span>
                          </TableCell>
                          <TableCell className="align-top font-mono text-xs">{row.search_token}</TableCell>
                          <TableCell className="align-top text-right tabular-nums">
                            {row.error ? "—" : row.capped_at_max ? `${row.match_count}+` : row.match_count}
                          </TableCell>
                          <TableCell className="align-top text-xs text-muted-foreground max-w-xl">
                            {(row.sample_subjects ?? []).filter(Boolean).length ? (
                              <ul className="list-disc pl-4 space-y-1">
                                {row.sample_subjects.filter(Boolean).map((s, i) => (
                                  <li key={i} className="line-clamp-2" title={s}>
                                    {s}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="align-top text-xs text-destructive">
                            {row.error ?? (row.capped_at_max ? "More than page size" : "")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </main>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
