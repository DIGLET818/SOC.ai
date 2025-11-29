import { Notification } from "@/types/notification";

export const mockNotifications: Notification[] = [
  {
    id: "notif-001",
    type: "critical-alert",
    title: "Critical: Ransomware Activity Detected",
    message: "Multiple endpoints showing encryption behavior - immediate action required",
    timestamp: "2 minutes ago",
    read: false,
    severity: "high",
    link: "/",
  },
  {
    id: "notif-002",
    type: "ai-finding",
    title: "AI Correlation: Coordinated Attack Campaign",
    message: "18 alerts grouped into potential APT activity from Eastern Europe",
    timestamp: "15 minutes ago",
    read: false,
    severity: "high",
  },
  {
    id: "notif-003",
    type: "ioc-change",
    title: "IOC Reputation Updated",
    message: "IP 203.0.113.45 now flagged by 35 threat feeds (was 12)",
    timestamp: "1 hour ago",
    read: false,
    severity: "medium",
  },
  {
    id: "notif-004",
    type: "case-update",
    title: "Case #CS-2024-089 Updated",
    message: "Sarah Chen added forensic evidence to malware investigation",
    timestamp: "2 hours ago",
    read: true,
  },
  {
    id: "notif-005",
    type: "ai-finding",
    title: "Behavioral Anomaly Detected",
    message: "User 'jsmith' accessing unusual file shares outside normal hours",
    timestamp: "3 hours ago",
    read: true,
    severity: "medium",
  },
];
