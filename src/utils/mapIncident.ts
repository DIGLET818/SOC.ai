import { Case } from "@/types/case";

/**
 * Strong type for API incident response
 */
interface ApiIncident {
    caseId: string;
    title?: string;
    assignedAnalyst?: string;
    status?: string;
    severity?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | string;
    lastUpdated?: string;
    offenseId?: string;
    source?: string;
}

export function mapIncidentToCase(api: ApiIncident): Case {
    return {
        id: api.caseId,
        title: api.title || "No title",
        assignedAnalyst: api.assignedAnalyst || "Unassigned",

        status: (api.status?.toLowerCase() || "open") as Case["status"],

        // Map Google/Gmail/Backend severity → UI severity
        priority:
            api.severity === "CRITICAL" ? "critical" :
            api.severity === "HIGH" ? "high" :
            api.severity === "MEDIUM" ? "medium" :
            api.severity === "LOW" ? "low" :
            "medium",

        createdAt: api.lastUpdated || new Date().toISOString(),
        updatedAt: api.lastUpdated || new Date().toISOString(),

        relatedAlerts: api.offenseId ? [api.offenseId] : [],

        notes: [],

        timeline: [
            {
                id: "t1",
                timestamp: api.lastUpdated || new Date().toISOString(),
                actor: api.source || "System",
                event: api.title || "Event created"
            }
        ],

        attachments: [],

        mitreTactic: undefined
    };
}
