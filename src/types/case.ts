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
