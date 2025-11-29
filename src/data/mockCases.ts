import { Case } from "@/types/case";

export const mockCases: Case[] = [
  {
    id: "CS-2024-089",
    title: "TrickBot Malware Investigation - Finance Department",
    assignedAnalyst: "Sarah Chen",
    status: "investigating",
    priority: "critical",
    createdAt: "2024-11-28 09:15:00",
    updatedAt: "2024-11-29 14:23:15",
    relatedAlerts: ["ALR-2024-0002", "ALR-2024-0004"],
    notes: [
      {
        id: "note-001",
        author: "Sarah Chen",
        content: "Initial triage complete. Malware confirmed as TrickBot variant. C2 communication blocked at firewall. Investigating lateral movement attempts.",
        timestamp: "2024-11-29 10:30:00",
      },
      {
        id: "note-002",
        author: "Mike Rodriguez",
        content: "Memory dump analysis shows persistence via registry run keys. No ransomware payload deployed yet. Recommend immediate containment.",
        timestamp: "2024-11-29 13:15:00",
      },
    ],
    timeline: [
      {
        id: "evt-001",
        timestamp: "2024-11-28 09:15:00",
        event: "Case created - Multiple malware alerts",
        actor: "System",
      },
      {
        id: "evt-002",
        timestamp: "2024-11-28 09:30:00",
        event: "Case assigned to Sarah Chen",
        actor: "SOC Manager",
      },
      {
        id: "evt-003",
        timestamp: "2024-11-28 14:45:00",
        event: "Endpoint isolated from network",
        actor: "Sarah Chen",
      },
      {
        id: "evt-004",
        timestamp: "2024-11-29 10:30:00",
        event: "Forensic analysis completed",
        actor: "Sarah Chen",
      },
    ],
    attachments: [
      {
        id: "att-001",
        name: "memory_dump_analysis.pdf",
        type: "PDF",
        uploadedBy: "Mike Rodriguez",
        uploadedAt: "2024-11-29 13:20:00",
        size: "2.4 MB",
      },
      {
        id: "att-002",
        name: "network_traffic_pcap.pcap",
        type: "PCAP",
        uploadedBy: "Sarah Chen",
        uploadedAt: "2024-11-29 11:05:00",
        size: "15.7 MB",
      },
    ],
  },
  {
    id: "CS-2024-087",
    title: "Data Exfiltration Attempt - Employee Credentials",
    assignedAnalyst: "Mike Rodriguez",
    status: "contained",
    priority: "high",
    createdAt: "2024-11-27 16:20:00",
    updatedAt: "2024-11-29 08:45:00",
    relatedAlerts: ["ALR-2024-0003"],
    notes: [
      {
        id: "note-003",
        author: "Mike Rodriguez",
        content: "User account disabled. Transfer blocked. Reviewing cloud storage logs for complete timeline.",
        timestamp: "2024-11-28 08:15:00",
      },
    ],
    timeline: [
      {
        id: "evt-005",
        timestamp: "2024-11-27 16:20:00",
        event: "DLP violation detected",
        actor: "System",
      },
      {
        id: "evt-006",
        timestamp: "2024-11-27 16:25:00",
        event: "User account suspended",
        actor: "Mike Rodriguez",
      },
      {
        id: "evt-007",
        timestamp: "2024-11-28 09:30:00",
        event: "HR notified for investigation",
        actor: "Mike Rodriguez",
      },
    ],
    attachments: [],
  },
];
