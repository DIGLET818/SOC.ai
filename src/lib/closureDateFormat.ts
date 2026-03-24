/** Format Gmail/API UTC ISO instants for Closure date column (IST). */

const IST_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: "Asia/Kolkata",
  weekday: "short",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: true,
};

/** Typical Gmail/API instant: 2026-03-04T23:49:58Z or with offset / fractional seconds */
export function looksLikeIsoInstant(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(t)) return false;
  return !Number.isNaN(Date.parse(t));
}

/** User-facing closure time in India Standard Time */
export function formatClosureDateToIst(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("en-IN", IST_OPTIONS);
}

/** Tooltip: IST line + raw UTC ISO for copy/debug */
export function formatClosureDateTooltip(stored: string): string {
  const s = (stored ?? "").trim();
  if (!s) return "";
  if (looksLikeIsoInstant(s)) {
    const ist = formatClosureDateToIst(s);
    return `IST: ${ist}\nUTC: ${s}`;
  }
  return s;
}
