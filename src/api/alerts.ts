import api from "./client";

export async function getAlerts() {
    return api.get<unknown[]>("/alerts");
}

export async function getCases() {
    return api.get<unknown[]>("/cases");
}

export async function getNotifications() {
    return api.get<unknown[]>("/notifications");
}

export interface GmailAuthStatus {
    gmailAvailable: boolean;
    connected: boolean;
}

export async function getGmailAuthStatus(): Promise<GmailAuthStatus> {
    return api.get<GmailAuthStatus>("/auth/status");
}

export async function getGmailAlerts(params?: { q?: string; max_results?: number }) {
    const search = params
        ? `?${new URLSearchParams(
              Object.entries(params).reduce<Record<string, string>>((acc, [k, v]) => {
                  if (v !== undefined && v !== "") acc[k] = String(v);
                  return acc;
              }, {})
          ).toString()}`
        : "";
    return api.get<unknown[]>(`/gmail/alerts${search}`);
}
