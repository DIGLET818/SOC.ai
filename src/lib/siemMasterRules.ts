/**
 * Read rule names from the SIEM Master sheet stored in localStorage (same workbook as SIEM Use case page).
 */
export const SIEM_WORKBOOK_STORAGE_KEY = "siemWorkbookV2";

export interface SiemWorkbookSheetLite {
  name: string;
  columns: string[];
  rows: Record<string, string>[];
}

export function parseSiemWorkbook(raw: string): SiemWorkbookSheetLite[] | null {
  try {
    const parsed = JSON.parse(raw) as { sheets?: unknown[] };
    if (!parsed?.sheets || !Array.isArray(parsed.sheets)) return null;
    const out: SiemWorkbookSheetLite[] = [];
    for (const s of parsed.sheets) {
      if (!s || typeof s !== "object") continue;
      const o = s as Record<string, unknown>;
      const name = String(o.name ?? "");
      const columns = Array.isArray(o.columns) ? (o.columns as string[]) : [];
      const rows = Array.isArray(o.rows) ? (o.rows as Record<string, string>[]) : [];
      out.push({ name, columns, rows });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

/** Sheet whose name matches "SIEM Master" (case-insensitive). */
export function findSiemMasterSheet(sheets: SiemWorkbookSheetLite[]): SiemWorkbookSheetLite | null {
  const m = sheets.find((s) => /siem\s*master/i.test((s.name || "").trim()));
  return m ?? null;
}

/** Column header for rule title (e.g. "Rule Name", "rule name"). */
export function findRuleNameColumn(columns: string[]): string | null {
  const hit = columns.find((c) => /^\s*rule\s*name\s*$/i.test(c.trim()));
  if (hit) return hit;
  const loose = columns.find((c) => /rule\s*name/i.test(c.trim()));
  return loose ?? null;
}

export function collectUniqueRuleNames(sheet: SiemWorkbookSheetLite, ruleCol: string): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const row of sheet.rows) {
    const v = (row[ruleCol] ?? "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    list.push(v);
  }
  return list;
}

export function loadSiemMasterRuleNamesFromStorage(): {
  sheetName: string;
  ruleColumn: string;
  rules: string[];
  error?: string;
} {
  try {
    const raw = localStorage.getItem(SIEM_WORKBOOK_STORAGE_KEY);
    if (!raw) {
      return { sheetName: "", ruleColumn: "", rules: [], error: "No SIEM workbook in localStorage. Upload a workbook on SIEM Use case first." };
    }
    const sheets = parseSiemWorkbook(raw);
    if (!sheets?.length) {
      return { sheetName: "", ruleColumn: "", rules: [], error: "Could not parse SIEM workbook." };
    }
    const master = findSiemMasterSheet(sheets);
    if (!master) {
      return {
        sheetName: "",
        ruleColumn: "",
        rules: [],
        error: 'No sheet named "SIEM Master" found. Add or rename a sheet to match SIEM Master.',
      };
    }
    const col = findRuleNameColumn(master.columns);
    if (!col) {
      return {
        sheetName: master.name,
        ruleColumn: "",
        rules: [],
        error: 'No "Rule Name" column found on SIEM Master sheet.',
      };
    }
    const rules = collectUniqueRuleNames(master, col);
    if (!rules.length) {
      return {
        sheetName: master.name,
        ruleColumn: col,
        rules: [],
        error: "SIEM Master has no non-empty rule names in that column.",
      };
    }
    return { sheetName: master.name, ruleColumn: col, rules };
  } catch {
    return { sheetName: "", ruleColumn: "", rules: [], error: "Failed to read localStorage." };
  }
}

/** Default start: Feb 1 of the current year, or previous year if today is before Feb 1. */
export function defaultAnalysisAfterDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const feb1 = new Date(y, 1, 1);
  if (now < feb1) {
    return `${y - 1}-02-01`;
  }
  return `${y}-02-01`;
}

/** Gmail `before:` is exclusive — use tomorrow so "today" is included. */
export function defaultAnalysisBeforeDate(): string {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
