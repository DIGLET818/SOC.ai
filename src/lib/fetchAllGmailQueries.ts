/** Shared Gmail search tokens for Fetch-all on PB report CSV rows. */

function getRowValue(row: Record<string, string>, ...possibleKeys: string[]): string {
  const keys = Object.keys(row);
  for (const want of possibleKeys) {
    const found = keys.find((k) => k.toLowerCase().replace(/\s/g, "") === want.toLowerCase().replace(/\s/g, ""));
    if (found && row[found]?.trim()) return row[found].trim();
  }
  return "";
}

export function extraGmailIncidentQueries(row: Record<string, string>): string[] {
  const blob = [
    getRowValue(row, "Title", "Short description", "Shortdescription", "Number", "Case"),
    ...Object.values(row),
  ]
    .filter((s): s is string => typeof s === "string" && s.trim() !== "")
    .join("\n");
  const out: string[] = [];
  const cs = blob.match(/\b(CS\d{5,})\b/i);
  if (cs) out.push(cs[1]);
  const inc = blob.match(/\b(INC\d{6,})\b/i);
  if (inc) out.push(inc[1]);
  return [...new Set(out)];
}

/** Ordered unique Gmail `q` tokens to try for one CSV row (ServiceNow → Incident → INC/CS in text). */
export function buildFetchAllGmailQueries(row: Record<string, string>): string[] {
  const servicenowTicket = getRowValue(row, "ServicenowTicket", "ServiceNow Ticket", "ServicenowT");
  const incidentId = getRowValue(row, "IncidentID", "Incident ID");
  const searchFirst = servicenowTicket || incidentId;
  const searchFallback = servicenowTicket ? incidentId : "";
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (q: string) => {
    const t = q.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  if (searchFirst.trim()) add(searchFirst);
  if (searchFallback.trim()) add(searchFallback);
  for (const q of extraGmailIncidentQueries(row)) add(q);
  return out;
}

export const FETCH_ALL_GMAIL_BATCH_SIZE = 5;
