import { useState } from "react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { SOCSidebar } from "@/components/SOCSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { IncidentsTable } from "@/components/IncidentsTable";
import { IncidentDetailView } from "@/components/IncidentDetailView";
import { IncidentFiltersBar } from "@/components/IncidentFiltersBar";
import { Button } from "@/components/ui/button";
import { Plus, RefreshCw } from "lucide-react";
import { Case } from "@/types/case";

export default function Incidents() {
  const [selectedIncident, setSelectedIncident] = useState<Case | null>(null);
  const [severity, setSeverity] = useState("all");
  const [status, setStatus] = useState("all");
  const [assignedAnalyst, setAssignedAnalyst] = useState("all");
  const [mitreTactic, setMitreTactic] = useState("all");
  const [dateRange, setDateRange] = useState<{ from: Date | undefined; to: Date | undefined }>({
    from: undefined,
    to: undefined,
  });

  const handleClearFilters = () => {
    setSeverity("all");
    setStatus("all");
    setAssignedAnalyst("all");
    setMitreTactic("all");
    setDateRange({ from: undefined, to: undefined });
  };

  return (
    <SidebarProvider>
      <SOCSidebar />
      <SidebarInset>
        <div className="flex flex-col min-h-screen bg-background">
          <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex h-16 items-center justify-between px-6">
              <div>
                <h1 className="text-2xl font-bold text-foreground">Incident Management</h1>
                <p className="text-sm text-muted-foreground">Track and manage security incidents</p>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </Button>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  New Incident
                </Button>
                <ThemeToggle />
                <NotificationsPanel />
              </div>
            </div>
          </header>

          <main className="flex-1 p-6 space-y-6">
            <IncidentFiltersBar
              severity={severity}
              status={status}
              assignedAnalyst={assignedAnalyst}
              mitreTactic={mitreTactic}
              dateRange={dateRange}
              onSeverityChange={setSeverity}
              onStatusChange={setStatus}
              onAssignedAnalystChange={setAssignedAnalyst}
              onMitreTacticChange={setMitreTactic}
              onDateRangeChange={setDateRange}
              onClearFilters={handleClearFilters}
            />

            {selectedIncident ? (
              <IncidentDetailView
                incident={selectedIncident}
                onBack={() => setSelectedIncident(null)}
              />
            ) : (
              <IncidentsTable
                severity={severity}
                status={status}
                assignedAnalyst={assignedAnalyst}
                mitreTactic={mitreTactic}
                dateRange={dateRange}
                onIncidentClick={setSelectedIncident}
              />
            )}
          </main>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
