import { useState, useMemo } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { SOCSidebar } from "@/components/SOCSidebar";
import { StatsOverview } from "@/components/StatsOverview";
import { SearchBar } from "@/components/SearchBar";
import { FiltersBar } from "@/components/FiltersBar";
import { AlertsTable } from "@/components/AlertsTable";
import { AlertDetailPanel } from "@/components/AlertDetailPanel";
import { Alert } from "@/types/alert";
import { mockAlerts } from "@/data/mockAlerts";

const Index = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [severity, setSeverity] = useState("all");
  const [status, setStatus] = useState("all");
  const [dateRange, setDateRange] = useState<{ from: Date | undefined; to: Date | undefined }>({
    from: undefined,
    to: undefined,
  });
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);

  const filteredAlerts = useMemo(() => {
    return mockAlerts.filter((alert) => {
      // Search filter
      const matchesSearch =
        searchQuery === "" ||
        alert.sourceIp.toLowerCase().includes(searchQuery.toLowerCase()) ||
        alert.ruleName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (alert.sourceUser?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);

      // Severity filter
      const matchesSeverity = severity === "all" || alert.severity === severity;

      // Status filter
      const matchesStatus = status === "all" || alert.status === status;

      return matchesSearch && matchesSeverity && matchesStatus;
    });
  }, [searchQuery, severity, status]);

  const handleAlertClick = (alert: Alert) => {
    setSelectedAlert(alert);
    setDetailPanelOpen(true);
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <SOCSidebar />
        <div className="flex-1 flex flex-col">
          <header className="h-14 border-b border-border flex items-center px-6 bg-card">
            <SidebarTrigger className="mr-4" />
            <h1 className="text-xl font-semibold text-foreground">Security Operations Center</h1>
          </header>

          <main className="flex-1 p-6 space-y-6 overflow-auto">
            <StatsOverview />

            <div className="space-y-4">
              <SearchBar value={searchQuery} onChange={setSearchQuery} />
              <FiltersBar
                severity={severity}
                status={status}
                dateRange={dateRange}
                onSeverityChange={setSeverity}
                onStatusChange={setStatus}
                onDateRangeChange={setDateRange}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-foreground">
                  Alerts ({filteredAlerts.length})
                </h2>
              </div>
              <AlertsTable alerts={filteredAlerts} onAlertClick={handleAlertClick} />
            </div>
          </main>
        </div>

        <AlertDetailPanel
          alert={selectedAlert}
          open={detailPanelOpen}
          onClose={() => setDetailPanelOpen(false)}
        />
      </div>
    </SidebarProvider>
  );
};

export default Index;
