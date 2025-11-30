import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { SOCSidebar } from "@/components/SOCSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { ReportsSummaryWidgets } from "@/components/ReportsSummaryWidgets";
import { ReportsTrendCharts } from "@/components/ReportsTrendCharts";
import { ComplianceAuditSection } from "@/components/ComplianceAuditSection";
import { ReportsExportOptions } from "@/components/ReportsExportOptions";

export default function Reports() {
  return (
    <SidebarProvider>
      <SOCSidebar />
      <SidebarInset>
        <div className="flex flex-col min-h-screen bg-background">
          <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex h-16 items-center justify-between px-6">
              <div>
                <h1 className="text-2xl font-bold text-foreground">SOC Reports</h1>
                <p className="text-sm text-muted-foreground">Analytics, trends, and compliance reporting</p>
              </div>
              <div className="flex items-center gap-3">
                <ThemeToggle />
                <NotificationsPanel />
              </div>
            </div>
          </header>

          <main className="flex-1 p-6 space-y-6">
            <ReportsExportOptions />
            
            <ReportsSummaryWidgets />

            <ReportsTrendCharts />

            <ComplianceAuditSection />
          </main>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
