/**
 * Parsed CSV attachment (e.g. PB_Daily.csv from PB Daily report emails).
 */
export interface CsvAttachment {
  filename: string;
  headers: string[];
  rows: Record<string, string>[];
}

/**
 * Raw Gmail message as returned by backend /api/gmail/messages.
 * bodyHtml is set when the email has HTML content.
 * csvAttachment is set when include_csv=true and email has a .csv attachment.
 */
export interface GmailMessage {
  id: string;
  subject: string;
  date: string;
  from: string;
  body: string;
  bodyHtml?: string;
  internalDate?: string;
  csvAttachment?: CsvAttachment;
}
