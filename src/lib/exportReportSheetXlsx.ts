import * as XLSX from "xlsx";
import type { CsvAttachment } from "@/types/gmail";

function normalizeHeaderKey(h: string): string {
  return h.toLowerCase().replace(/[\s_-]/g, "");
}

function findHeader(headers: string[], ...candidates: string[]): string | undefined {
  for (const c of candidates) {
    const want = normalizeHeaderKey(c);
    const found = headers.find((h) => normalizeHeaderKey(h) === want);
    if (found) return found;
  }
  return undefined;
}

/** One weekly CSV plus per-email row keying for overrides. */
export interface WeeklyReportCsvSource {
  messageId: string;
  reportDateYyyyMmDd: string;
  csv: CsvAttachment;
  getRowKey: (row: Record<string, string>) => string;
}

function pickRowValueByCanonicalHeader(row: Record<string, string>, canonicalHeader: string): string {
  const want = normalizeHeaderKey(canonicalHeader);
  for (const [k, v] of Object.entries(row)) {
    if (normalizeHeaderKey(k) === want) return String(v ?? "");
  }
  return "";
}

const CONSOLIDATED_PREFIX = [
  { header: "Report_Email_Date", norm: "reportemaildate" },
  { header: "Gmail_Message_Id", norm: "gmailmessageid" },
] as const;

const RESERVED_CONSOLIDATED_NORMS = new Set(CONSOLIDATED_PREFIX.map((p) => p.norm));

/** Union CSV columns (first-seen header spelling), prepend source columns, merge overrides per report. */
export function buildConsolidatedWeeklyReportsCsv(
  sources: WeeklyReportCsvSource[],
  statusOverrides: Record<string, string>,
  closureCommentsOverrides: Record<string, string>,
  closureDateOverrides: Record<string, string>
): CsvAttachment {
  const normSeen = new Set<string>();
  const headerOrder: string[] = [];
  for (const s of sources) {
    for (const h of s.csv.headers) {
      const n = normalizeHeaderKey(h);
      if (RESERVED_CONSOLIDATED_NORMS.has(n)) continue;
      if (normSeen.has(n)) continue;
      normSeen.add(n);
      headerOrder.push(h);
    }
  }

  const allHeaders = [...CONSOLIDATED_PREFIX.map((p) => p.header), ...headerOrder];
  const outRows: Record<string, string>[] = [];

  for (const s of sources) {
    const merged = mergeOverridesIntoRows(
      s.csv,
      s.getRowKey,
      statusOverrides,
      closureCommentsOverrides,
      closureDateOverrides
    );
    for (const row of merged) {
      const out: Record<string, string> = {
        [CONSOLIDATED_PREFIX[0].header]: s.reportDateYyyyMmDd,
        [CONSOLIDATED_PREFIX[1].header]: s.messageId,
      };
      for (const h of headerOrder) {
        out[h] = pickRowValueByCanonicalHeader(row, h);
      }
      outRows.push(out);
    }
  }

  return {
    filename: "consolidated_weekly_reports.csv",
    headers: allHeaders,
    rows: outRows,
  };
}

function sanitizeExcelSheetName(name: string): string {
  const cleaned = name.replace(/[\[\]:*?/\\]/g, "_").trim().slice(0, 31);
  return cleaned || "Sheet1";
}

/** Build export rows with overrides merged into Status / Closure_Comments / Closure date columns. */
export function mergeOverridesIntoRows(
  csv: CsvAttachment,
  getRowKey: (row: Record<string, string>) => string,
  statusOverrides: Record<string, string>,
  closureCommentsOverrides: Record<string, string>,
  closureDateOverrides: Record<string, string>
): Record<string, string>[] {
  const { headers, rows } = csv;
  const statusH = findHeader(headers, "Status");
  const ccH = findHeader(headers, "Closure_Comments", "Closure Comments");
  const cdH = findHeader(headers, "Closure date", "Closure_Date", "ClosureDate");
  return rows.map((row) => {
    const key = getRowKey(row);
    const out: Record<string, string> = { ...row };
    delete (out as Record<string, unknown>).__rowIndex;
    if (statusH && statusOverrides[key]?.trim()) out[statusH] = statusOverrides[key].trim();
    if (ccH && closureCommentsOverrides[key]?.trim()) out[ccH] = closureCommentsOverrides[key].trim();
    if (cdH && closureDateOverrides[key]?.trim()) out[cdH] = closureDateOverrides[key].trim();
    return out;
  });
}

export function downloadCsvAsXlsx(csv: CsvAttachment, filenameBase: string, sheetName = "Report"): void {
  const safeName = filenameBase.replace(/[^\w.-]+/g, "_").slice(0, 80) || "report";
  const { headers, rows } = csv;
  const aoa: string[][] = [headers, ...rows.map((row) => headers.map((h) => String(row[h] ?? "")))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sanitizeExcelSheetName(sheetName));
  XLSX.writeFile(wb, `${safeName}.xlsx`);
}
