import { useState, useMemo, useEffect, useCallback } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SOCSidebar } from "@/components/SOCSidebar";
import { StatsOverview } from "@/components/StatsOverview";
import { MetricsPanel } from "@/components/MetricsPanel";
import { ThreatMapCard } from "@/components/ThreatMapCard";
import { SearchBar } from "@/components/SearchBar";
import { EnhancedFiltersBar } from "@/components/EnhancedFiltersBar";
import { AlertsTable } from "@/components/AlertsTable";
import { CsvDataTable } from "@/components/CsvDataTable";
import { IncidentDrawer } from "@/components/IncidentDrawer";
import { CaseManagement } from "@/components/CaseManagement";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Alert } from "@/types/alert";
import { mockAlerts } from "@/data/mockAlerts";
import { getGmailAuthStatus, getGmailAlerts } from "@/api/alerts";
import { API_BASE_URL } from "@/api/client";
import { useReportAlertsByDate } from "@/hooks/useReportAlertsByDate";
import {
  overrideMapsFromReport,
  unifiedRowKey,
  persistUnifiedReportOverride,
  toYYYYMMDD,
  nextDay,
} from "@/lib/reportAlertUtils";
import type { OverrideField } from "@/api/weeklyReports";
import { Radio, RefreshCw, Mail, Inbox } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const Index = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [severity, setSeverity] = useState("all");
  const [status, setStatus] = useState("all");
  const [ruleCategory, setRuleCategory] = useState("all");
  const [mitreTactic, setMitreTactic] = useState("all");
  const [sourceCountry, setSourceCountry] = useState("all");
  const [assetCriticality, setAssetCriticality] = useState("all");
  const [dateRange, setDateRange] = useState<{ from: Date | undefined; to: Date | undefined }>({
    from: undefined,
    to: undefined,
  });
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [realtimeMode, setRealtimeMode] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [alertView, setAlertView] = useState<"reports" | "demo">("reports");

  const reportRange = useMemo(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 30);
    return { after: toYYYYMMDD(from), before: nextDay(toYYYYMMDD(to)) };
  }, []);

  const {
    alertsCsv: reportAlertsCsv,
    overrides: reportOverrides,
    loading: reportAlertsLoading,
    error: reportAlertsError,
    loadRange: loadReportAlerts,
    setLocalOverride: setReportLocalOverride,
  } = useReportAlertsByDate();

  const reportOverrideMaps = useMemo(
    () => overrideMapsFromReport(reportOverrides),
    [reportOverrides]
  );

  const getUnifiedRowKey = useCallback(() => (row: Record<string, string>) => unifiedRowKey(row), []);

  useEffect(() => {
    void loadReportAlerts(reportRange.after, reportRange.before);
  }, [loadReportAlerts, reportRange.after, reportRange.before]);

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

  // Gmail: connect + load alerts from mail (SOC demo tab)
  const [gmailAvailable, setGmailAvailable] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailAlerts, setGmailAlerts] = useState<Alert[]>([]);
  const [loadingGmail, setLoadingGmail] = useState(false);

  const allAlerts = useMemo(
    () => [...gmailAlerts, ...mockAlerts],
    [gmailAlerts]
  );

  useEffect(() => {
    getGmailAuthStatus()
      .then((s) => {
        setGmailAvailable(s.gmailAvailable);
        setGmailConnected(s.connected);
      })
      .catch(() => setGmailAvailable(false));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("gmail_connected") === "1") {
      setGmailConnected(true);
      toast({ title: "Gmail connected", description: "You can load alerts from your inbox." });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const handleConnectGmail = () => {
    window.location.href = `${API_BASE_URL}/auth/google`;
  };

  const handleLoadFromGmail = async () => {
    setLoadingGmail(true);
    try {
      const alerts = (await getGmailAlerts({ max_results: 50 })) as Alert[];
      setGmailAlerts(alerts);
      toast({
        title: "Alerts loaded from Gmail",
        description: `${alerts.length} email alert(s) added.`,
      });
    } catch (e) {
      toast({
        title: "Failed to load Gmail alerts",
        description: e instanceof Error ? e.message : "Check backend and try again.",
        variant: "destructive",
      });
    } finally {
      setLoadingGmail(false);
    }
  };

  // Simulate real-time alerts
  useEffect(() => {
    if (realtimeMode) {
      const interval = setInterval(() => {
        toast({
          title: "New Alert Detected",
          description: "High severity alert from 198.51.100.89",
          duration: 3000,
        });
      }, 15000);
      return () => clearInterval(interval);
    }
  }, [realtimeMode]);

  const filteredAlerts = useMemo(() => {
    return allAlerts.filter((alert) => {
      const matchesSearch =
        searchQuery === "" ||
        alert.sourceIp.toLowerCase().includes(searchQuery.toLowerCase()) ||
        alert.ruleName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (alert.sourceUser?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
        alert.id.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesSeverity = severity === "all" || alert.severity === severity;
      const matchesStatus = status === "all" || alert.status === status;
      const matchesRuleCategory = ruleCategory === "all" || alert.ruleCategory === ruleCategory;
      const matchesMitreTactic =
        mitreTactic === "all" ||
        alert.mitreTactic.toLowerCase().includes(mitreTactic.toLowerCase());
      const matchesSourceCountry =
        sourceCountry === "all" ||
        alert.sourceCountry.toLowerCase() === sourceCountry.toLowerCase();
      const matchesAssetCriticality =
        assetCriticality === "all" || alert.hostContext.criticality === assetCriticality;

      return (
        matchesSearch &&
        matchesSeverity &&
        matchesStatus &&
        matchesRuleCategory &&
        matchesMitreTactic &&
        matchesSourceCountry &&
        matchesAssetCriticality
      );
    });
  }, [allAlerts, searchQuery, severity, status, ruleCategory, mitreTactic, sourceCountry, assetCriticality]);

  const handleAlertClick = (alert: Alert) => {
    setSelectedAlert(alert);
    setDetailPanelOpen(true);
  };

  const handleClearFilters = () => {
    setSeverity("all");
    setStatus("all");
    setRuleCategory("all");
    setMitreTactic("all");
    setSourceCountry("all");
    setAssetCriticality("all");
    setDateRange({ from: undefined, to: undefined });
  };

  const handleRefresh = () => {
    if (alertView === "reports") {
      setIsRefreshing(true);
      void loadReportAlerts(reportRange.after, reportRange.before).finally(() => {
        setIsRefreshing(false);
        toast({
          title: "Report alerts refreshed",
          description: "Loaded PB daily & weekly report alerts (last 30 days).",
        });
      });
      return;
    }
    setIsRefreshing(true);
    toast({
      title: "Refreshing demo data",
      description: "SOC sample metrics unchanged; reload Gmail alerts if needed.",
    });
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <SOCSidebar />
        <div className="flex-1 flex flex-col">
          <header className="h-14 border-b border-border flex items-center justify-between px-6 bg-card shadow-sm backdrop-blur-sm">
            <div className="flex items-center gap-4">
              <SidebarTrigger className="" />
              <h1 className="text-xl font-semibold text-foreground">
                Security Operations Center
              </h1>
            </div>
            <div className="flex items-center gap-4">
              {gmailAvailable && (
                <>
                  {gmailConnected ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleLoadFromGmail}
                      disabled={loadingGmail}
                      className="gap-2"
                    >
                      <Inbox className="h-4 w-4" />
                      {loadingGmail ? "Loading…" : "Load from Gmail"}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleConnectGmail}
                      className="gap-2"
                    >
                      <Mail className="h-4 w-4" />
                      Connect Gmail
                    </Button>
                  )}
                  {gmailConnected && (
                    <span className="text-xs text-muted-foreground px-2 py-1 rounded bg-muted/50">
                      Gmail connected
                    </span>
                  )}
                </>
              )}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 border border-border">
                <Radio className={`h-4 w-4 ${realtimeMode ? "text-severity-high animate-pulse" : "text-muted-foreground"}`} />
                <span className="text-sm text-muted-foreground">Real-time</span>
                <Switch checked={realtimeMode} onCheckedChange={setRealtimeMode} />
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="hover:bg-accent/10 transition-colors"
              >
                <RefreshCw className={`h-5 w-5 ${isRefreshing ? "animate-spin" : ""}`} />
              </Button>
              <ThemeToggle />
              <NotificationsPanel />
            </div>
          </header>

          <main className="flex-1 p-6 space-y-6 overflow-auto">
            <StatsOverview />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <MetricsPanel />
              </div>
              <div>
                <ThreatMapCard />
              </div>
            </div>

            <Tabs value={alertView} onValueChange={(v) => setAlertView(v as "reports" | "demo")} className="space-y-4">
              <TabsList>
                <TabsTrigger value="reports">
                  PB report alerts
                  {reportAlertsCsv?.rows?.length != null ? ` (${reportAlertsCsv.rows.length})` : ""}
                </TabsTrigger>
                <TabsTrigger value="demo">SOC demo</TabsTrigger>
              </TabsList>

              <TabsContent value="reports" className="space-y-4 mt-0">
                <p className="text-sm text-muted-foreground">
                  Alerts from synced <strong>Daily</strong> and <strong>Weekly</strong> PB reports (last 30 days). Sync
                  data on those pages, then refresh here.
                </p>
                {reportAlertsError && (
                  <p className="text-sm text-destructive">{reportAlertsError}</p>
                )}
                {reportAlertsLoading && (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Loading report alerts…
                  </p>
                )}
                {!reportAlertsLoading && reportAlertsCsv && reportAlertsCsv.rows.length > 0 && (
                  <div className="rounded-lg border border-border overflow-hidden">
                    <CsvDataTable
                      csv={reportAlertsCsv}
                      statusOverrides={reportOverrideMaps.status}
                      closureCommentsOverrides={reportOverrideMaps.closureComments}
                      closureDateOverrides={reportOverrideMaps.closureDate}
                      getRowKey={getUnifiedRowKey()}
                      onStatusChange={(row, v) => void persistReportOverride(row, "status", v)}
                      onClosureCommentsChange={(row, v) => void persistReportOverride(row, "closure_comment", v)}
                      onClosureDateChange={(row, v) => void persistReportOverride(row, "closure_date", v)}
                    />
                  </div>
                )}
                {!reportAlertsLoading && (!reportAlertsCsv || reportAlertsCsv.rows.length === 0) && !reportAlertsError && (
                  <p className="text-sm text-muted-foreground">
                    No cached report alerts for the last 30 days. Open Daily Alerts or Weekly Reports and fetch data
                    first.
                  </p>
                )}
              </TabsContent>

              <TabsContent value="demo" className="space-y-4 mt-0">
                <div className="space-y-4">
                  <SearchBar value={searchQuery} onChange={setSearchQuery} />
                  <EnhancedFiltersBar
                    severity={severity}
                    status={status}
                    ruleCategory={ruleCategory}
                    mitreTactic={mitreTactic}
                    sourceCountry={sourceCountry}
                    assetCriticality={assetCriticality}
                    dateRange={dateRange}
                    onSeverityChange={setSeverity}
                    onStatusChange={setStatus}
                    onRuleCategoryChange={setRuleCategory}
                    onMitreTacticChange={setMitreTactic}
                    onSourceCountryChange={setSourceCountry}
                    onAssetCriticalityChange={setAssetCriticality}
                    onDateRangeChange={setDateRange}
                    onClearFilters={handleClearFilters}
                  />
                </div>
                <div className="animate-fade-in">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-foreground">
                      Sample SIEM alerts ({filteredAlerts.length})
                    </h2>
                    {realtimeMode && (
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-severity-high/10 border border-severity-high/30 text-sm">
                        <div className="h-2 w-2 rounded-full bg-severity-high animate-pulse shadow-[0_0_8px_hsl(var(--severity-high))]" />
                        <span className="text-severity-high font-medium">Live monitoring active</span>
                      </div>
                    )}
                  </div>
                  <AlertsTable alerts={filteredAlerts} onAlertClick={handleAlertClick} />
                </div>
              </TabsContent>
            </Tabs>

            <CaseManagement />
          </main>
        </div>

        <IncidentDrawer
          alert={selectedAlert}
          open={detailPanelOpen}
          onClose={() => setDetailPanelOpen(false)}
        />
      </div>
    </SidebarProvider>
  );
};

export default Index;
