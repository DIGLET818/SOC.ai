import { useState, useEffect } from "react";
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
import { fetchIncidents, fetchIncidentById } from "@/api/incidents";

/* =========================
   Backend Mail Incident
   ========================= */
interface BackendIncident {
    caseId: string;
    title: string;
    severity: "Critical" | "High" | "Medium" | "Low";
    status: "Open" | "Investigating" | "Contained" | "Closed";
    assignedTo?: string;
    lastUpdated: string;
    aiPriority?: string;
}

/* =========================
   MAPPERS
   ========================= */
function mapSeverity(
    s: BackendIncident["severity"]
): Case["priority"] {
    switch (s) {
        case "Critical":
            return "critical";
        case "High":
            return "high";
        case "Medium":
            return "medium";
        case "Low":
            return "low";
        default:
            return "medium";
    }
}

function mapStatus(
    s: BackendIncident["status"]
): Case["status"] {
    return s.toLowerCase() as Case["status"];
}

function mapIncident(i: BackendIncident): Case {
    return {
        id: i.caseId,
        caseId: i.caseId,
        offenseId: i.caseId,

        title: i.title,
        priority: mapSeverity(i.severity),
        status: mapStatus(i.status),
        assignedAnalyst: i.assignedTo ?? "Unassigned",

        createdAt: i.lastUpdated,
        updatedAt: i.lastUpdated,

        mitreTactic: "Initial Access",

        body: "",
        client: "",
        product: "Email Security",

        relatedAlerts: [],
        mitreTechniques: [],
        notes: [],
        attachments: [],
        timeline: [],

        action: "",
        aiSummary: "",
    };
}

export default function Incidents() {
    const [incidents, setIncidents] = useState<Case[]>([]);
    const [selectedIncident, setSelectedIncident] = useState<Case | null>(null);
    const [loading, setLoading] = useState(false);
    const [detailLoading, setDetailLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Filters
    const [severity, setSeverity] = useState("all");
    const [status, setStatus] = useState("all");
    const [assignedAnalyst, setAssignedAnalyst] = useState("all");
    const [mitreTactic, setMitreTactic] = useState("all");

    const [dateRange, setDateRange] = useState<{
        from: Date | undefined;
        to: Date | undefined;
    }>({ from: undefined, to: undefined });

    /* =========================
       LOAD INCIDENTS (MAIL)
       ========================= */
    const loadIncidents = async () => {
        if (!dateRange.from || !dateRange.to) {
            setError("Please select a date range.");
            return;
        }

        try {
            setLoading(true);
            setError(null);
            setSelectedIncident(null);

            const from = dateRange.from.toISOString().split("T")[0];
            const to = dateRange.to.toISOString().split("T")[0];

            // ✅ FIX: object parameter (TS2554 resolved)
            const backendIncidents: BackendIncident[] =
                await fetchIncidents({ from, to });

            const mapped: Case[] = backendIncidents.map(mapIncident);

            setIncidents(mapped);
            sessionStorage.setItem("incidents", JSON.stringify(mapped));
        } catch (e) {
            console.error(e);
            setError("Failed to load incidents from mail.");
        } finally {
            setLoading(false);
        }
    };

    /* =========================
       CACHE RESTORE
       ========================= */
    useEffect(() => {
        const cached = sessionStorage.getItem("incidents");
        if (cached) {
            setIncidents(JSON.parse(cached) as Case[]);
        }
    }, []);

    /* =========================
       HANDLERS
       ========================= */
    const handleIncidentClick = async (incident: Case) => {
        const id = incident.caseId;
        if (!id) return;

        setDetailLoading(true);
        try {
            const full = await fetchIncidentById(id);
            setSelectedIncident(full ?? incident);
        } finally {
            setDetailLoading(false);
        }
    };

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
                    {/* HEADER */}
                    <header className="sticky top-0 border-b bg-background/95">
                        <div className="flex h-16 items-center justify-between px-6">
                            <div>
                                <h1 className="text-2xl font-bold">Incident Management</h1>
                                <p className="text-sm text-muted-foreground">
                                    Track, analyze & resolve security incidents
                                </p>
                            </div>

                            <div className="flex gap-3">
                                <Button size="sm" variant="outline" onClick={loadIncidents}>
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

                    {/* MAIN */}
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

                        {error && (
                            <div className="text-red-500 bg-red-100 border p-3 rounded">
                                {error}
                            </div>
                        )}

                        {loading ? (
                            <div className="text-center py-10">
                                Loading incidents from mail…
                            </div>
                        ) : selectedIncident ? (
                            detailLoading ? (
                                <div className="text-center py-10">
                                    Loading incident details…
                                </div>
                            ) : (
                                <IncidentDetailView
                                    incident={selectedIncident}
                                    onBack={() => setSelectedIncident(null)}
                                />
                            )
                        ) : (
                            <IncidentsTable
                                data={incidents}
                                severity={severity}
                                status={status}
                                assignedAnalyst={assignedAnalyst}
                                mitreTactic={mitreTactic}
                                dateRange={dateRange}
                                onIncidentClick={handleIncidentClick}
                            />
                        )}
                    </main>
                </div>
            </SidebarInset>
        </SidebarProvider>
    );
}
