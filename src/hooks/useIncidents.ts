import { useEffect, useState } from "react";
import { Case } from "@/types/case";
import apiClient from "@/api/client";

/* =======================
   Backend incident shape
   ======================= */
interface ApiIncident {
    incidentId: string;
    caseId?: string;
    offenseId?: string;
    title?: string;
    priority?: string;
    stage?: string;
    assignedAnalyst?: string;
    lastUpdated?: string;
    mitreTechniques?: string[];
    body?: string;
    action?: string | null;
    updates?: Array<{ time: string; message: string }>;
}

/* =======================
   Hook return type
   ======================= */
interface UseIncidentsResult {
    incidents: Case[];
    loading: boolean;
    error: string | null;
}

/* =======================
   NORMALIZERS (IMPORTANT)
   ======================= */
function mapStatus(stage?: string): Case["status"] {
    switch (stage?.toLowerCase()) {
        case "open":
            return "open";
        case "investigating":
        case "in_progress":
            return "investigating";
        case "contained":
            return "contained";
        case "closed":
        case "resolved":
            return "closed";
        default:
            return "open";
    }
}

function mapPriority(priority?: string): Case["priority"] {
    switch (priority?.toLowerCase()) {
        case "critical":
            return "critical";
        case "high":
            return "high";
        case "low":
            return "low";
        default:
            return "medium";
    }
}

/* =======================
   MAIN HOOK
   ======================= */
export function useIncidents(from?: string, to?: string): UseIncidentsResult {
    const [incidents, setIncidents] = useState<Case[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function fetchIncidents() {
            setLoading(true);
            setError(null);

            try {
                /* 🔥 Flask returns ARRAY directly, not { data: ... } */
                const response = await apiClient.get<ApiIncident[]>(
                    `/api/incidents`
                );

                const source = response ?? [];

                const mapped: Case[] = source.map((item) => {
                    const timestamp = item.lastUpdated ?? new Date().toISOString();

                    return {
                        id: item.incidentId,
                        caseId: item.caseId ?? item.incidentId,
                        offenseId: item.offenseId ?? null,

                        title: item.title ?? "Untitled Incident",
                        priority: mapPriority(item.priority),
                        status: mapStatus(item.stage),
                        assignedAnalyst: item.assignedAnalyst ?? "Unassigned",

                        createdAt: timestamp,
                        updatedAt: timestamp,

                        mitreTactic: item.mitreTechniques?.[0] ?? "Unknown",

                        body: item.body ?? "",
                        action: item.action ?? null,
                        updates: item.updates ?? [],

                        // Required Case fields
                        relatedAlerts: [],
                        notes: [],
                        timeline: [],
                        attachments: [],
                    };
                });

                if (!cancelled) {
                    setIncidents(mapped);
                }
            } catch (err) {
                const message =
                    err instanceof Error ? err.message : "Failed to fetch incidents";
                if (!cancelled) {
                    setError(message);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }

        fetchIncidents();

        return () => {
            cancelled = true;
        };
    }, [from, to]);

    return { incidents, loading, error };
}
