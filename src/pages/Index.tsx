import { useState, useMemo, useEffect } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SOCSidebar } from "@/components/SOCSidebar";
import { StatsOverview } from "@/components/StatsOverview";
import { MetricsPanel } from "@/components/MetricsPanel";
import { ThreatMapCard } from "@/components/ThreatMapCard";
import { SearchBar } from "@/components/SearchBar";
import { EnhancedFiltersBar } from "@/components/EnhancedFiltersBar";
import { AlertsTable } from "@/components/AlertsTable";
import { IncidentDrawer } from "@/components/IncidentDrawer";
import { CaseManagement } from "@/components/CaseManagement";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Alert } from "@/types/alert";
import { mockAlerts } from "@/data/mockAlerts";
import { getGmailAuthStatus, getGmailAlerts } from "@/api/alerts";
import { API_BASE_URL } from "@/api/client";
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

  // Gmail: connect + load alerts from mail
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
    setIsRefreshing(true);
    toast({
      title: "Refreshing Data",
      description: "Fetching latest alerts...",
    });
    setTimeout(() => {
      setIsRefreshing(false);
      toast({
        title: "Data Refreshed",
        description: "Alert data updated successfully",
      });
    }, 1000);
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
                  Active Alerts ({filteredAlerts.length})
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
