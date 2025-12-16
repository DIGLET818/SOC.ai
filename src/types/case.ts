export interface Case {
    id: string;
    title: string;
    assignedAnalyst: string;
    status: "open" | "investigating" | "contained" | "closed";
    priority: "critical" | "high" | "medium" | "low";
    createdAt: string;
    updatedAt: string;
    relatedAlerts: string[];
    notes: CaseNote[];
    timeline: CaseTimelineEvent[];
    attachments: CaseAttachment[];

    // 🆕 MITRE tactic filtering (already present)
    mitreTactic?: string;

    // 🆕 Backend Incident model fields (optional - populated by detail fetch)
    caseId?: string;
    incidentId?: string;
    offenseId?: string;
    client?: string;
    product?: string;
    ticket?: string;
    action?: string;
    severity?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
    priorityScore?: number;
    source?: string;
    body?: string;
    lastUpdated?: string;

    // Case stage inferred from email sequence
    stage?: "Opened" | "Update" | "Closed";

    // SLA tracking
    closedAt?: string;
    slaStatus?: "On Track" | "At Risk" | "Breached";

    // MITRE ATT&CK techniques (array from backend)
    mitreTechniques?: string[];

    // AI-powered summary (from backend)
    aiSummary?: string;

    // Updates parsed from updated emails
    updates?: {
        time: string;
        message: string;
    }[];
}

export interface CaseNote {
    id: string;
    author: string;
    content: string;
    timestamp: string;
}

export interface CaseTimelineEvent {
    id: string;
    timestamp: string;
    event: string;
    actor: string;
}

export interface CaseAttachment {
    id: string;
    name: string;
    type: string;
    uploadedBy: string;
    uploadedAt: string;
    size: string;
}
