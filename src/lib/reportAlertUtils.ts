import type { ReportAlertOverrideRecord } from "@/api/reportAlerts";
import type { OverrideField } from "@/api/weeklyReports";
import { upsertDailyOverride } from "@/api/dailyAlerts";
import { upsertOverride } from "@/api/weeklyReports";

export function toYYYYMMDD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function nextDay(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + 1);
  return toYYYYMMDD(d);
}

/** Dedupe key from unified `/api/alerts` rows. */
export function unifiedRowKey(row: Record<string, string>): string {
  return String((row as Record<string, unknown>).__rowIndex ?? "").trim();
}

export function overrideMapsFromReport(overrides: Record<string, ReportAlertOverrideRecord>): {
  status: Record<string, string>;
  closureComments: Record<string, string>;
  closureDate: Record<string, string>;
} {
  const status: Record<string, string> = {};
  const closureComments: Record<string, string> = {};
  const closureDate: Record<string, string> = {};
  for (const [key, rec] of Object.entries(overrides)) {
    if (rec.status) status[key] = rec.status;
    if (rec.closure_comment) closureComments[key] = rec.closure_comment;
    if (rec.closure_date) closureDate[key] = rec.closure_date;
  }
  return { status, closureComments, closureDate };
}

export function rowCreationDateKey(row: Record<string, string>): string | null {
  const raw = String((row as Record<string, unknown>).__creationDate ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const created = getRowValue(
    row,
    "Created",
    "CreationDate",
    "Creation Date",
    "Creation_Date",
    "Created_On",
    "CreatedOn",
    "AlertCreated",
    "OpenDate",
    "Opened",
    "IncidentCreated",
    "DateCreated"
  );
  if (!created) return null;
  const iso = created.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = created.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
  if (dmy) {
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    const month = String(Number(dmy[2])).padStart(2, "0");
    const day = String(Number(dmy[1])).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const parsed = Date.parse(created.replace(/\//g, "-"));
  if (!Number.isNaN(parsed)) return toYYYYMMDD(new Date(parsed));
  return null;
}

function getRowValue(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== "") return String(row[k]).trim();
  }
  const norm: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith("__")) continue;
    norm[k.toLowerCase().replace(/\s/g, "")] = String(v ?? "");
  }
  for (const k of keys) {
    const v = norm[k.toLowerCase().replace(/\s/g, "")];
    if (v?.trim()) return v.trim();
  }
  return "";
}

export async function persistUnifiedReportOverride(
  row: Record<string, string>,
  field: OverrideField,
  value: string
): Promise<void> {
  const messageId = String((row as Record<string, unknown>).__messageId ?? "").trim();
  const rowIndex = Number((row as Record<string, unknown>).__rowIndexNum);
  const source = String((row as Record<string, unknown>).__source ?? "weekly").trim();
  if (!messageId || !Number.isFinite(rowIndex)) {
    throw new Error("Missing report row identity for save");
  }
  if (source === "daily") {
    await upsertDailyOverride({ messageId, rowIndex, field, value });
  } else {
    await upsertOverride({ messageId, rowIndex, field, value });
  }
}
