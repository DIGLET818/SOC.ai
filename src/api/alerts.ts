import { apiGet } from "./client";

export async function getAlerts() {
    return apiGet("/alerts");  // Hits http://127.0.0.1:8000/alerts
}

export async function getCases() {
    return apiGet("/cases");
}

export async function getNotifications() {
    return apiGet("/notifications");
}
