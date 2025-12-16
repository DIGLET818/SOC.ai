// src/api/incidents.ts

import api from "./client";
import type { AxiosResponse } from "axios";
import { Case } from "@/types/case";

export interface IncidentQueryParams {
    from?: string; // YYYY-MM-DD
    to?: string;   // YYYY-MM-DD
}

function unwrapArray<T>(res: AxiosResponse<T> | T): T {
    // If res is an AxiosResponse, it has a .data field; otherwise it's already T
    if ((res as AxiosResponse<T>).data !== undefined) {
        return (res as AxiosResponse<T>).data;
    }
    return res as T;
}

/** Fetch all incidents (optionally filtered by date range) */
export async function fetchIncidents(
    params?: IncidentQueryParams
): Promise<Case[]> {
    try {
        const query = params
            ? `?${new URLSearchParams(
                Object.entries(params).reduce<Record<string, string>>(
                    (acc, [k, v]) => {
                        if (v) acc[k] = v;
                        return acc;
                    },
                    {}
                )
            ).toString()}`
            : "";

        const res = await api.get<Case[]>(`/incidents${query}`, {
            credentials: "include",
            mode: "cors",
        });

        const data = unwrapArray<Case[]>(res);
        return data || [];
    } catch (err) {
        console.error("Error fetching incidents:", err);
        return [];
    }
}

/** Fetch incident by ID */
export async function fetchIncidentById(id: string): Promise<Case | null> {
    try {
        const res = await api.get<Case>(`/incidents/${id}`, {
            credentials: "include",
            mode: "cors",
        });

        const data = unwrapArray<Case>(res);
        return data || null;
    } catch (err) {
        console.error("Error fetching incident:", err);
        return null;
    }
}

/** Create new incident */
export async function createIncident(
    payload: Partial<Case>
): Promise<Case | null> {
    try {
        const res = await api.post<Case>("/incidents", payload, {
            credentials: "include",
            mode: "cors",
            headers: { "Content-Type": "application/json" },
        });

        const data = unwrapArray<Case>(res);
        return data || null;
    } catch (err) {
        console.error("Error creating incident:", err);
        return null;
    }
}

/** Update incident */
export async function updateIncident(
    id: string,
    payload: Partial<Case>
): Promise<Case | null> {
    try {
        const res = await api.put<Case>(`/incidents/${id}`, payload, {
            credentials: "include",
            mode: "cors",
            headers: { "Content-Type": "application/json" },
        });

        const data = unwrapArray<Case>(res);
        return data || null;
    } catch (err) {
        console.error("Error updating incident:", err);
        return null;
    }
}

/** Delete incident */
export async function deleteIncident(id: string): Promise<boolean> {
    try {
        await api.delete(`/incidents/${id}`, {
            credentials: "include",
            mode: "cors",
        });

        return true;
    } catch (err) {
        console.error("Error deleting incident:", err);
        return false;
    }
}
