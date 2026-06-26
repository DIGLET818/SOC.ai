/**
 * SIEM Use case workbook — persisted in SQLite via /api/siem-workbook.
 */
import { API_BASE_URL } from "./client";

export interface SiemWorkbookSheetDto {
  name: string;
  columns: string[];
  rows: Array<{ id: string } & Record<string, string>>;
}

export interface SiemWorkbookResponse {
  sheets: SiemWorkbookSheetDto[];
  activeSheetIndex: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

async function parseError(resp: Response): Promise<string> {
  const text = await resp.text();
  try {
    const json = JSON.parse(text) as { error?: string };
    return json.error || text;
  } catch {
    return text || `HTTP ${resp.status}`;
  }
}

export async function getSiemWorkbook(): Promise<SiemWorkbookResponse> {
  const resp = await fetch(`${API_BASE_URL}/siem-workbook`, {
    method: "GET",
    credentials: "include",
  });
  if (!resp.ok) throw new Error(await parseError(resp));
  return resp.json() as Promise<SiemWorkbookResponse>;
}

export async function putSiemWorkbook(payload: {
  sheets: SiemWorkbookSheetDto[];
  activeSheetIndex: number;
}): Promise<SiemWorkbookResponse> {
  const resp = await fetch(`${API_BASE_URL}/siem-workbook`, {
    method: "PUT",
    credentials: "include",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      sheets: payload.sheets,
      activeSheetIndex: Math.max(0, Math.floor(Number(payload.activeSheetIndex)) || 0),
    }),
  });
  if (!resp.ok) throw new Error(await parseError(resp));
  return resp.json() as Promise<SiemWorkbookResponse>;
}

function isNetworkFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message.toLowerCase();
  return m.includes("failed to fetch") || m.includes("networkerror") || m.includes("load failed");
}

/** Retry once when the dev server drops the connection mid-save. */
export async function putSiemWorkbookResilient(
  payload: Parameters<typeof putSiemWorkbook>[0]
): Promise<SiemWorkbookResponse> {
  try {
    return await putSiemWorkbook(payload);
  } catch (e) {
    if (!isNetworkFetchError(e)) throw e;
    return await putSiemWorkbook(payload);
  }
}

export async function deleteSiemWorkbook(): Promise<void> {
  const resp = await fetch(`${API_BASE_URL}/siem-workbook`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!resp.ok) throw new Error(await parseError(resp));
}
