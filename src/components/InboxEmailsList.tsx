/**
 * Presents a list of Gmail messages (e.g. from nttin.support@global.ntt).
 * Columns: Case ID, Subject, Date. Horizontal scroll + resizable columns.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { RefreshCw, GripVertical } from "lucide-react";
import type { GmailMessage } from "@/types/gmail";

const DEFAULT_COL_WIDTH = 200;
const MIN_COL_WIDTH = 80;

/** Extract Case ID from subject (e.g. "Case: CS14468319 has been updated..." -> "CS14468319") */
function extractCaseId(subject: string): string {
  if (!subject?.trim()) return "—";
  const m = subject.match(/Case:\s*([A-Za-z0-9-]+)/i);
  return m ? m[1].trim() : "—";
}

export interface InboxEmailsListProps {
  emails: GmailMessage[];
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  onEmailClick?: (email: GmailMessage) => void;
  selectedEmailId?: string | null;
  title?: string;
  /** Sender filter label (e.g. "nttin.support@global.ntt") for display */
  senderLabel?: string;
  /** When set, show "Reconnect Gmail" button for token-expired errors */
  reconnectGmailUrl?: string;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    return Number.isNaN(d.getTime()) ? dateStr : d.toLocaleString();
  } catch {
    return dateStr;
  }
}

export function InboxEmailsList({
  emails,
  loading = false,
  error = null,
  onRefresh,
  onEmailClick,
  selectedEmailId,
  title = "Emails (last 24h)",
  senderLabel,
  reconnectGmailUrl,
}: InboxEmailsListProps) {
  const isTokenError = error && (error.toLowerCase().includes("reconnect") || error.toLowerCase().includes("expired") || error.toLowerCase().includes("revoked"));

  const cols = ["caseId", "subject", "date"] as const;
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => ({
    caseId: 140,
    subject: 720,
    date: 200,
  }));
  const resizeRef = useRef<{ header: string; startX: number; startW: number } | null>(null);

  const handleResizeStart = useCallback((header: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = {
      header,
      startX: e.clientX,
      startW: columnWidths[header] ?? DEFAULT_COL_WIDTH,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [columnWidths]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const cur = resizeRef.current;
      if (!cur) return;
      e.preventDefault();
      const delta = e.clientX - cur.startX;
      const newW = Math.max(MIN_COL_WIDTH, cur.startW + delta);
      setColumnWidths((prev) => ({ ...prev, [cur.header]: newW }));
    };
    const onUp = () => {
      resizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove, { capture: true });
    document.addEventListener("mouseup", onUp, true);
    return () => {
      document.removeEventListener("mousemove", onMove, { capture: true });
      document.removeEventListener("mouseup", onUp, true);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, []);

  const totalTableWidth = cols.reduce((sum, k) => sum + (columnWidths[k] ?? DEFAULT_COL_WIDTH), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          {senderLabel && (
            <p className="text-sm text-muted-foreground">From: {senderLabel}</p>
          )}
        </div>
        {onRefresh && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive space-y-2">
          <p>{error}</p>
          {isTokenError && reconnectGmailUrl && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => { window.location.href = reconnectGmailUrl; }}
            >
              Reconnect Gmail
            </Button>
          )}
        </div>
      )}

      {loading && emails.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          Loading emails…
        </div>
      ) : emails.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground rounded-lg border border-dashed">
          No emails to show. Click <strong>Refresh</strong> to load emails from the last 24 hours.
        </div>
      ) : (
        <div className="w-full max-w-full min-w-0 rounded-lg border border-border overflow-x-auto">
          <Table
            className="caption-bottom text-sm border-collapse"
            style={{
              tableLayout: "fixed",
              minWidth: Math.max(totalTableWidth, 1100),
              width: totalTableWidth,
            }}
          >
            <colgroup>
              {cols.map((k) => (
                <col key={k} style={{ width: columnWidths[k] ?? DEFAULT_COL_WIDTH }} />
              ))}
            </colgroup>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                {cols.map((k) => (
                  <TableHead
                    key={k}
                    className="font-semibold text-foreground whitespace-nowrap relative pr-6"
                    style={{ width: columnWidths[k] ?? DEFAULT_COL_WIDTH, minWidth: MIN_COL_WIDTH }}
                  >
                    <span className="truncate block">
                      {k === "caseId" ? "Case ID" : k === "subject" ? "Subject" : "Date"}
                    </span>
                    <div
                      role="separator"
                      className="absolute top-0 right-0 w-3 h-full min-h-12 flex items-center justify-center cursor-col-resize border-r-2 border-transparent hover:border-primary hover:bg-primary/10"
                      onMouseDown={(e) => handleResizeStart(k, e)}
                      title="Drag to resize column"
                    >
                      <GripVertical className="h-4 w-4 text-muted-foreground pointer-events-none" />
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {emails.map((email) => (
                <TableRow
                  key={email.id}
                  className={`hover:bg-muted/30 ${onEmailClick ? "cursor-pointer" : ""} ${selectedEmailId === email.id ? "bg-muted/50" : ""}`}
                  onClick={() => onEmailClick?.(email)}
                >
                  <TableCell
                    className="font-medium text-sm truncate"
                    style={{ maxWidth: columnWidths.caseId ?? DEFAULT_COL_WIDTH }}
                    title={extractCaseId(email.subject ?? "")}
                  >
                    {extractCaseId(email.subject ?? "")}
                  </TableCell>
                  <TableCell
                    className="text-foreground text-sm truncate"
                    style={{ maxWidth: columnWidths.subject ?? DEFAULT_COL_WIDTH }}
                    title={email.subject ?? ""}
                  >
                    {email.subject || "(No subject)"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm whitespace-nowrap" style={{ width: columnWidths.date ?? DEFAULT_COL_WIDTH }}>
                    {formatDate(email.date)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
