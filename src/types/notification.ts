export interface Notification {
  id: string;
  type: "ai-finding" | "ioc-change" | "critical-alert" | "case-update";
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  severity?: "high" | "medium" | "low";
  link?: string;
}
