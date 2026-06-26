/**
 * Gmail mailbox hit counts per SIEM rule and calendar month (true alert frequency).
 * Scans rule-by-rule (all months per rule) with SQLite cache on the backend.
 */
import { monthColumnGmailDateRange } from "@/lib/siemMonthColumns";
import {
  postGmailRuleHitsCacheBulk,
  postGmailRuleHitsResilient,
} from "@/api/gmail";

export const DEFAULT_MAILBOX_FROM = "nttin.support@global.ntt";

export type MailboxMonthCell = { count: number; capped: boolean };

/** ruleName -> monthLabel -> cell */
export type AlertCountsByRule = Record<string, Record<string, MailboxMonthCell>>;

export type MailboxRuleRow = {
  ruleName: string;
  byMonth: Record<string, MailboxMonthCell>;
  totalHits: number;
};

export type MailboxFrequencyResult = {
  monthColumns: string[];
  fromFilter: string;
  rules: MailboxRuleRow[];
  totalsPerMonth: Array<{ month: string; totalHits: number }>;
  loadedAt: string;
};

export function formatAlertCount(count: number, capped?: boolean): string {
  if (count <= 0) return "0 alerts";
  const base = count === 1 ? "1 alert" : `${count} alerts`;
  return capped ? `${base}+` : base;
}

export function alertCountsToMailboxResult(
  monthColumns: string[],
  fromFilter: string,
  byRule: AlertCountsByRule,
  ruleOrder: string[]
): MailboxFrequencyResult {
  const rules: MailboxRuleRow[] = ruleOrder.map((ruleName) => {
    const byMonth: Record<string, MailboxMonthCell> = {};
    let totalHits = 0;
    for (const m of monthColumns) {
      const cell = byRule[ruleName]?.[m] ?? { count: 0, capped: false };
      byMonth[m] = cell;
      totalHits += cell.count;
    }
    return { ruleName, byMonth, totalHits };
  });
  rules.sort((a, b) => b.totalHits - a.totalHits);

  const totalsPerMonth = monthColumns.map((month) => ({
    month,
    totalHits: rules.reduce((sum, r) => sum + (r.byMonth[month]?.count ?? 0), 0),
  }));

  return {
    monthColumns,
    fromFilter,
    rules,
    totalsPerMonth,
    loadedAt: new Date().toISOString(),
  };
}

/** Load previously scanned counts from SQLite (no Gmail calls). */
export async function loadCachedMailboxHits(params: {
  ruleNames: string[];
  monthColumns: string[];
  fromFilter?: string;
}): Promise<AlertCountsByRule | { error: string }> {
  const { ruleNames, monthColumns, fromFilter = DEFAULT_MAILBOX_FROM } = params;
  const windows: Array<{ month_label: string; after_date: string; before_date: string }> = [];
  for (const label of monthColumns) {
    const range = monthColumnGmailDateRange(label);
    if (!range) continue;
    windows.push({
      month_label: label,
      after_date: range.afterDate,
      before_date: range.beforeDate,
    });
  }
  if (!windows.length) return {};

  try {
    const res = await postGmailRuleHitsCacheBulk({
      windows,
      ruleNames,
      fromFilter,
    });
    const map: AlertCountsByRule = {};
    for (const h of res.hits) {
      if (!map[h.rule_name]) map[h.rule_name] = {};
      map[h.rule_name]![h.month_label] = {
        count: h.match_count ?? 0,
        capped: Boolean(h.capped_at_max),
      };
    }
    return map;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not load cached mailbox hits.";
    return { error: msg };
  }
}

/** Rule-first scan: for each rule, query all month windows, then report progress. */
export async function fetchMailboxFrequency(params: {
  ruleNames: string[];
  monthColumns: string[];
  fromFilter?: string;
  forceRefresh?: boolean;
  onProgress?: (message: string) => void;
  onRuleComplete?: (rule: MailboxRuleRow, index: number, total: number) => void;
}): Promise<MailboxFrequencyResult | { error: string }> {
  const {
    ruleNames,
    monthColumns,
    fromFilter = DEFAULT_MAILBOX_FROM,
    forceRefresh = false,
    onProgress,
    onRuleComplete,
  } = params;

  const names = [...new Set(ruleNames.map((n) => n.trim()).filter(Boolean))];
  if (!names.length) return { error: "No rule names to analyze." };
  if (!monthColumns.length) return { error: "No month columns in workbook." };

  const byRule: AlertCountsByRule = {};

  for (let ri = 0; ri < names.length; ri++) {
    const ruleName = names[ri]!;
    const byMonth: Record<string, MailboxMonthCell> = {};
    let totalHits = 0;

    for (const month of monthColumns) {
      const range = monthColumnGmailDateRange(month);
      if (!range) {
        return { error: `Could not parse month column "${month}".` };
      }

      onProgress?.(`Rule ${ri + 1}/${names.length}: ${ruleName.slice(0, 40)}… — ${month}`);

      try {
        const res = await postGmailRuleHitsResilient({
          ruleNames: [ruleName],
          afterDate: range.afterDate,
          beforeDate: range.beforeDate,
          fromFilter,
          forceRefresh,
        });
        const row = res.results.find((r) => r.rule_name === ruleName) ?? res.results[0];
        const count = row?.match_count ?? 0;
        const capped = Boolean(row?.capped_at_max);
        byMonth[month] = { count, capped };
        totalHits += count;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Mailbox frequency lookup failed.";
        if (/not connected|connect gmail/i.test(msg)) {
          return { error: "Gmail is not connected. Connect Gmail from Alerts, then retry." };
        }
        return { error: msg };
      }
    }

    if (!byRule[ruleName]) byRule[ruleName] = {};
    Object.assign(byRule[ruleName]!, byMonth);

    const ruleRow: MailboxRuleRow = { ruleName, byMonth, totalHits };
    onRuleComplete?.(ruleRow, ri, names.length);
  }

  return alertCountsToMailboxResult(monthColumns, fromFilter, byRule, names);
}

export function filterMailboxRules(rules: MailboxRuleRow[], query: string): MailboxRuleRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rules;
  return rules.filter((r) => r.ruleName.toLowerCase().includes(q));
}

export function totalAlertsForRule(
  ruleName: string,
  monthColumns: string[],
  alertCounts: AlertCountsByRule | undefined
): number {
  if (!alertCounts?.[ruleName]) return 0;
  return monthColumns.reduce((sum, m) => sum + (alertCounts[ruleName]![m]?.count ?? 0), 0);
}
