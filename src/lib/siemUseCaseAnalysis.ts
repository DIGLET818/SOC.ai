/**
 * Analytics over SIEM Master workbook rows — month columns hold INC/CS (triggered) or NA (not).
 */
import { getSiemWorkbook } from "@/api/siemWorkbook";
import {
  findRuleNameColumn,
  findSiemMasterSheet,
  type SiemWorkbookSheetLite,
} from "@/lib/siemMasterRules";
import { isMonthColumnHeader, parseMonthColumnLabel } from "@/lib/siemMonthColumns";

export type MonthTriggerStatus = "triggered" | "not_triggered";

export function parseMonthCellValue(raw: string | undefined): MonthTriggerStatus {
  const t = String(raw ?? "").trim();
  if (!t || t === "—" || /^n\/?a$/i.test(t)) return "not_triggered";
  return "triggered";
}

export interface RuleTriggerRow {
  rowId: string;
  ruleName: string;
  severity: string;
  team: string;
  byMonth: Record<string, { status: MonthTriggerStatus; value: string }>;
  monthsTriggered: number;
  frequency: "none" | "low" | "moderate" | "high";
}

export interface SiemUseCaseAnalysis {
  sheetName: string;
  ruleColumn: string;
  monthColumns: string[];
  rules: RuleTriggerRow[];
  kpis: {
    totalRules: number;
    triggeredAtLeastOnce: number;
    neverTriggered: number;
    avgRulesTriggeredPerMonth: number;
  };
  triggersPerMonth: Array<{ month: string; count: number; pct: number }>;
  rulesByActiveMonths: Array<{ label: string; months: number; count: number }>;
  topActiveRules: Array<{ ruleName: string; monthsTriggered: number; severity: string }>;
}

function findColumn(columns: string[], ...patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const hit = columns.find((c) => p.test(c.trim()));
    if (hit) return hit;
  }
  return null;
}

function orderMonthColumns(columns: string[]): string[] {
  return columns
    .filter(isMonthColumnHeader)
    .sort((a, b) => {
      const da = parseMonthColumnLabel(a);
      const db = parseMonthColumnLabel(b);
      if (!da || !db) return a.localeCompare(b);
      return db.getTime() - da.getTime();
    });
}

function frequencyFromMonths(n: number, totalMonths: number): RuleTriggerRow["frequency"] {
  if (n <= 0) return "none";
  if (n === 1) return "low";
  if (n >= totalMonths - 1 || n >= 3) return "high";
  return "moderate";
}

export function analyzeSiemMasterSheet(sheet: SiemWorkbookSheetLite): SiemUseCaseAnalysis | { error: string } {
  const ruleCol = findRuleNameColumn(sheet.columns);
  if (!ruleCol) {
    return { error: 'No "Rule Name" column on SIEM Master.' };
  }

  const monthColumns = orderMonthColumns(sheet.columns);
  if (monthColumns.length === 0) {
    return { error: "No month columns (e.g. May 26) found. Run Fetch incidents on SIEM Use case first." };
  }

  const severityCol = findColumn(sheet.columns, /^pb[- ]?severity$/i, /severity/i);
  const teamCol = findColumn(sheet.columns, /^team$/i);

  const rules: RuleTriggerRow[] = [];

  for (const row of sheet.rows) {
    const ruleName = (row[ruleCol] ?? "").trim();
    if (!ruleName) continue;

    const byMonth: RuleTriggerRow["byMonth"] = {};
    let monthsTriggered = 0;

    for (const m of monthColumns) {
      const raw = row[m] ?? "";
      const status = parseMonthCellValue(raw);
      byMonth[m] = { status, value: raw.trim() };
      if (status === "triggered") monthsTriggered += 1;
    }

    rules.push({
      rowId: String(row.id ?? ruleName),
      ruleName,
      severity: severityCol ? (row[severityCol] ?? "").trim() : "",
      team: teamCol ? (row[teamCol] ?? "").trim() : "",
      byMonth,
      monthsTriggered,
      frequency: frequencyFromMonths(monthsTriggered, monthColumns.length),
    });
  }

  if (!rules.length) {
    return { error: "No rules with names found on SIEM Master." };
  }

  const totalRules = rules.length;
  const triggeredAtLeastOnce = rules.filter((r) => r.monthsTriggered > 0).length;
  const neverTriggered = rules.filter((r) => r.monthsTriggered === 0).length;

  const triggersPerMonth = monthColumns.map((month) => {
    const count = rules.filter((r) => r.byMonth[month]?.status === "triggered").length;
    return {
      month,
      count,
      pct: totalRules > 0 ? Math.round((count / totalRules) * 1000) / 10 : 0,
    };
  });

  const avgRulesTriggeredPerMonth =
    monthColumns.length > 0
      ? Math.round(
          (triggersPerMonth.reduce((s, m) => s + m.count, 0) / monthColumns.length) * 100
        ) / 100
      : 0;

  const rulesByActiveMonths: Array<{ label: string; months: number; count: number }> = [];
  for (let m = 0; m <= monthColumns.length; m++) {
    const count = rules.filter((r) => r.monthsTriggered === m).length;
    rulesByActiveMonths.push({
      months: m,
      label: m === 0 ? "0 months" : m === 1 ? "1 month" : `${m} months`,
      count,
    });
  }

  const topActiveRules = [...rules]
    .sort((a, b) => b.monthsTriggered - a.monthsTriggered || a.ruleName.localeCompare(b.ruleName))
    .slice(0, 12)
    .map((r) => ({
      ruleName: r.ruleName,
      monthsTriggered: r.monthsTriggered,
      severity: r.severity,
    }));

  return {
    sheetName: sheet.name,
    ruleColumn: ruleCol,
    monthColumns,
    rules,
    kpis: {
      totalRules,
      triggeredAtLeastOnce,
      neverTriggered,
      avgRulesTriggeredPerMonth,
    },
    triggersPerMonth,
    rulesByActiveMonths,
    topActiveRules,
  };
}

export async function loadSiemUseCaseAnalysisFromApi(): Promise<
  SiemUseCaseAnalysis | { error: string }
> {
  try {
    const wb = await getSiemWorkbook();
    const sheets: SiemWorkbookSheetLite[] = (wb.sheets ?? []).map((s) => ({
      name: s.name,
      columns: s.columns,
      rows: s.rows as Record<string, string>[],
    }));
    const master = findSiemMasterSheet(sheets);
    if (!master) {
      return {
        error: 'No "SIEM Master" sheet in workbook. Upload data on SIEM Use case.',
      };
    }
    return analyzeSiemMasterSheet(master);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
