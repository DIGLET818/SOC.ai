/** Rolling month column labels for SIEM Use case workbook (e.g. "May 26"). */

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function formatMonthColumnLabel(date: Date): string {
  const month = MONTH_ABBR[date.getMonth()];
  const year = String(date.getFullYear()).slice(-2);
  return `${month} ${year}`;
}

/** Newest month first: current month, then previous three (4 total). */
export function getLastNMonthColumnLabels(count = 4, asOf: Date = new Date()): string[] {
  const labels: string[] = [];
  for (let offset = 0; offset < count; offset++) {
    const d = new Date(asOf.getFullYear(), asOf.getMonth() - offset, 1);
    labels.push(formatMonthColumnLabel(d));
  }
  return labels;
}

const MONTH_HEADER_RE =
  /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{2}|\d{4})$/i;

export function isMonthColumnHeader(header: string): boolean {
  return MONTH_HEADER_RE.test(header.trim());
}

/** Parse "May 26" / "May 2026" → first day of that month, or null. */
export function parseMonthColumnLabel(header: string): Date | null {
  const m = header.trim().match(MONTH_HEADER_RE);
  if (!m) return null;
  const monthIdx = MONTH_ABBR.findIndex((abbr) => abbr.toLowerCase() === m[1]!.toLowerCase());
  if (monthIdx < 0) return null;
  let year = Number(m[2]);
  if (year < 100) year += 2000;
  return new Date(year, monthIdx, 1);
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Gmail `after:` / `before:` range for a month column label (before is exclusive). */
export function monthColumnGmailDateRange(label: string): { afterDate: string; beforeDate: string } | null {
  const start = parseMonthColumnLabel(label);
  if (!start) return null;
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  return { afterDate: formatIsoDate(start), beforeDate: formatIsoDate(end) };
}

export type SiemSheetLike = {
  columns: string[];
  rows: Array<{ id: string } & Record<string, string>>;
};

/**
 * Replace month-style headers with the last N calendar months (including current),
 * preserving cell values when the same month exists under an old header.
 */
export function normalizeSheetMonthColumns<T extends SiemSheetLike>(
  sheet: T,
  count = 4,
  asOf: Date = new Date()
): T {
  const fixedColumns = sheet.columns.filter((c) => !isMonthColumnHeader(c));
  const oldMonthColumns = sheet.columns.filter((c) => isMonthColumnHeader(c));
  if (oldMonthColumns.length === 0 && fixedColumns.length === sheet.columns.length) {
    return sheet;
  }

  const newMonthColumns = getLastNMonthColumnLabels(count, asOf);
  const newColumns = [...fixedColumns, ...newMonthColumns];

  const rows = sheet.rows.map((row) => {
    const next: Record<string, string> = { id: row.id };
    fixedColumns.forEach((c) => {
      next[c] = row[c] ?? "";
    });

    const valuesByMonthKey = new Map<string, string>();
    oldMonthColumns.forEach((oldCol) => {
      const parsed = parseMonthColumnLabel(oldCol);
      if (!parsed) return;
      const val = String(row[oldCol] ?? "").trim();
      if (val) valuesByMonthKey.set(monthKey(parsed), val);
    });

    newMonthColumns.forEach((newCol) => {
      const parsed = parseMonthColumnLabel(newCol);
      if (!parsed) {
        next[newCol] = "";
        return;
      }
      next[newCol] = valuesByMonthKey.get(monthKey(parsed)) ?? "";
    });

    return next as T["rows"][number];
  });

  return { ...sheet, columns: newColumns, rows };
}
