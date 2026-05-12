/**
 * Renders a single CSV attachment as a table with column filters and resizable columns.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import {
  formatClosureDateToIst,
  formatClosureDateTooltip,
  looksLikeIsoInstant,
} from "@/lib/closureDateFormat";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Filter, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CsvAttachment } from "@/types/gmail";

const DEFAULT_COL_WIDTH = 160;
const MIN_COL_WIDTH = 80;

const STATUS_OPTIONS = ["Open", "Closed", "In Progress", "Pending", "Merged", "Incident Auto Closed"];

function isStatusHeader(header: string): boolean {
  return header.toLowerCase().replace(/\s/g, "") === "status";
}

function isClosureCommentsHeader(header: string): boolean {
  return header.toLowerCase().replace(/[\s_]/g, "") === "closurecomments";
}

function isClosureDateHeader(header: string): boolean {
  return header.toLowerCase().replace(/[\s_-]/g, "") === "closuredate";
}

/** Shows Gmail UTC ISO as IST when not editing; keeps ISO in parent on blur. */
function ClosureDateField({
  stored,
  row,
  onClosureDateChange,
}: {
  stored: string;
  row: Record<string, string>;
  onClosureDateChange: (row: Record<string, string>, v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(stored);

  useEffect(() => {
    if (!editing) setText(stored);
  }, [stored, editing]);

  const trimmed = stored.trim();
  const showIst = looksLikeIsoInstant(trimmed);
  const displayWhenBlurred = showIst ? formatClosureDateToIst(stored) : stored;
  const displayValue = editing ? text : displayWhenBlurred;

  return (
    <Input
      className="h-8 w-full min-w-[10rem] text-xs"
      value={displayValue}
      onFocus={() => {
        setEditing(true);
        setText(showIst ? formatClosureDateToIst(stored) : stored);
      }}
      onBlur={() => {
        setEditing(false);
        const v = text.trim();
        if (!v) {
          onClosureDateChange(row, "");
          return;
        }
        if (showIst && v === formatClosureDateToIst(stored)) {
          onClosureDateChange(row, stored);
          return;
        }
        if (looksLikeIsoInstant(v)) {
          onClosureDateChange(row, v);
          return;
        }
        const t = Date.parse(v);
        if (!Number.isNaN(t)) {
          onClosureDateChange(row, new Date(t).toISOString());
          return;
        }
        onClosureDateChange(row, v);
      }}
      onChange={(e) => setText(e.target.value)}
      placeholder="IST (from Gmail)"
      title={stored ? formatClosureDateTooltip(stored) : undefined}
    />
  );
}

export interface CsvDataTableProps {
  csv: CsvAttachment;
  /** Optional title above the table (e.g. report date) */
  title?: string;
  /** When set, rows are clickable; called with the row data (header -> value) */
  onRowClick?: (row: Record<string, string>) => void;
  /** Keyed by getRowKey(row); overrides displayed status for that row */
  statusOverrides?: Record<string, string>;
  /** Keyed by getRowKey(row); overrides displayed Closure_Comments for that row */
  closureCommentsOverrides?: Record<string, string>;
  /** Keyed by getRowKey(row); overrides Closure date (ISO or display text from mail fetch) */
  closureDateOverrides?: Record<string, string>;
  /** Unique key for a row (e.g. for status override storage) */
  getRowKey?: (row: Record<string, string>) => string;
  /** Called when user changes status via the Status column select */
  onStatusChange?: (row: Record<string, string>, newStatus: string) => void;
  /** Called when user edits Closure_Comments */
  onClosureCommentsChange?: (row: Record<string, string>, newValue: string) => void;
  /** Called when user edits Closure date */
  onClosureDateChange?: (row: Record<string, string>, newValue: string) => void;
  /** Optional extra column (e.g. "Create in Jira" button per row) */
  actionColumn?: { header: string; render: (row: Record<string, string>) => React.ReactNode };
  /** Optional column rendered in front of each row (e.g. "Fetch latest status") */
  leadingColumn?: { header: string; render: (row: Record<string, string>) => React.ReactNode };
  /** Optional column rendered first (e.g. "Jira" ticket ID) */
  firstColumn?: { header: string; render: (row: Record<string, string>) => React.ReactNode };
}

export function CsvDataTable({
  csv,
  title,
  onRowClick,
  statusOverrides = {},
  closureCommentsOverrides = {},
  closureDateOverrides = {},
  getRowKey,
  onStatusChange,
  onClosureCommentsChange,
  onClosureDateChange,
  actionColumn,
  leadingColumn,
  firstColumn,
}: CsvDataTableProps) {
  const { headers, rows } = csv;
  const displayHeaders = [
    ...(firstColumn ? [firstColumn.header] : []),
    ...headers,
    ...(actionColumn ? [actionColumn.header] : []),
    ...(leadingColumn ? [leadingColumn.header] : []),
  ];
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() =>
    displayHeaders.reduce((acc, h) => ({ ...acc, [h]: DEFAULT_COL_WIDTH }), {})
  );
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const resizeRef = useRef<{ header: string; startX: number; startW: number } | null>(null);

  const filteredRows = rows.filter((row) =>
    headers.every(
      (h) =>
        !columnFilters[h]?.trim() ||
        String(row[h] ?? "")
          .toLowerCase()
          .includes(columnFilters[h].trim().toLowerCase())
    )
  );

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

  const setFilter = useCallback((header: string, value: string) => {
    setColumnFilters((prev) => ({ ...prev, [header]: value }));
  }, []);

  const clearFilters = useCallback(() => {
    setColumnFilters({});
  }, []);

  const hasActiveFilters = Object.values(columnFilters).some((v) => v?.trim());

  const totalTableWidth = displayHeaders.reduce(
    (sum, h) => sum + (columnWidths[h] ?? DEFAULT_COL_WIDTH),
    0
  );

  return (
    <div className="space-y-2">
      {title && (
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      )}
      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs">
          Clear filters
        </Button>
      )}
      <div className="rounded-lg border border-border overflow-x-auto">
        <Table
          style={{
            tableLayout: "fixed",
            minWidth: Math.max(totalTableWidth, 800),
            width: totalTableWidth,
          }}
        >
          <colgroup>
            {displayHeaders.map((h) => (
              <col key={h} style={{ width: columnWidths[h] ?? DEFAULT_COL_WIDTH }} />
            ))}
          </colgroup>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              {displayHeaders.map((h) => (
                firstColumn && h === firstColumn.header ? (
                  <TableHead
                    key={h}
                    className="font-semibold text-foreground whitespace-nowrap"
                    style={{ width: columnWidths[h] ?? DEFAULT_COL_WIDTH, minWidth: MIN_COL_WIDTH }}
                  >
                    {h}
                  </TableHead>
                ) : leadingColumn && h === leadingColumn.header ? (
                  <TableHead
                    key={h}
                    className="font-semibold text-foreground whitespace-nowrap"
                    style={{ width: columnWidths[h] ?? DEFAULT_COL_WIDTH, minWidth: MIN_COL_WIDTH }}
                  >
                    {h}
                  </TableHead>
                ) : actionColumn && h === actionColumn.header ? (
                  <TableHead
                    key={h}
                    className="font-semibold text-foreground whitespace-nowrap"
                    style={{ width: columnWidths[h] ?? DEFAULT_COL_WIDTH, minWidth: MIN_COL_WIDTH }}
                  >
                    {h}
                  </TableHead>
                ) : (
                  <TableHead
                    key={h}
                    className="font-semibold text-foreground whitespace-nowrap relative group pr-8"
                    style={{ width: columnWidths[h] ?? DEFAULT_COL_WIDTH, minWidth: MIN_COL_WIDTH }}
                  >
                    <span className="truncate block">{h}</span>
                    <div className="absolute top-0 right-0 flex items-center gap-0.5 h-full">
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className={cn(
                              "h-7 w-7 shrink-0 opacity-70 hover:opacity-100",
                              columnFilters[h]?.trim() && "text-primary"
                            )}
                            title="Filter column"
                          >
                            <Filter className="h-3.5 w-3.5" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-56" align="start">
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">Filter &quot;{h}&quot;</p>
                            <Input
                              placeholder="Contains..."
                              value={columnFilters[h] ?? ""}
                              onChange={(e) => setFilter(h, e.target.value)}
                              className="h-8"
                            />
                          </div>
                        </PopoverContent>
                      </Popover>
                      <div
                        role="separator"
                        className="w-2 flex-shrink-0 cursor-col-resize hover:bg-primary/30 rounded h-full min-h-8 flex items-center justify-center"
                        onMouseDown={(e) => handleResizeStart(h, e)}
                        title="Drag to resize column"
                      >
                        <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    </div>
                  </TableHead>
                )
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredRows.map((row, idx) => (
              <TableRow
                key={String((row as Record<string, unknown>).__rowIndex ?? idx)}
                className={cn("hover:bg-muted/20", onRowClick && "cursor-pointer")}
                onClick={() => onRowClick?.(row)}
              >
                {firstColumn && (
                  <TableCell
                    className="text-sm whitespace-nowrap"
                    style={{ width: columnWidths[firstColumn.header] ?? DEFAULT_COL_WIDTH }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {firstColumn.render(row)}
                  </TableCell>
                )}
                {headers.map((h) => {
                  const isStatus = isStatusHeader(h) && getRowKey && onStatusChange;
                  const isClosureComments = isClosureCommentsHeader(h) && getRowKey && onClosureCommentsChange;
                  const isClosureDate = isClosureDateHeader(h) && getRowKey && onClosureDateChange;
                  const displayValue = isStatus
                    ? (statusOverrides[getRowKey(row)] ?? row[h] ?? "").trim() || "Open"
                    : row[h] ?? "";
                  const closureCommentsValue = isClosureComments
                    ? (closureCommentsOverrides[getRowKey(row)] ?? row[h] ?? "")
                    : "";
                  const closureDateStored = isClosureDate
                    ? (closureDateOverrides[getRowKey(row)] ?? row[h] ?? "")
                    : "";
                  return (
                    <TableCell
                      key={h}
                      className="text-sm whitespace-nowrap truncate"
                      style={{ maxWidth: columnWidths[h] ?? DEFAULT_COL_WIDTH }}
                      title={
                        isStatus
                          ? undefined
                          : isClosureComments
                            ? undefined
                            : isClosureDate
                              ? formatClosureDateTooltip(closureDateStored)
                              : String(row[h] ?? "")
                      }
                      onClick={
                        isStatus || isClosureComments || isClosureDate ? (e) => e.stopPropagation() : undefined
                      }
                    >
                      {isStatus ? (
                        <Select
                          value={STATUS_OPTIONS.includes(displayValue) ? displayValue : "Open"}
                          onValueChange={(value) => onStatusChange(row, value)}
                        >
                          <SelectTrigger className="h-8 w-full min-w-[7rem] border-input">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STATUS_OPTIONS.map((opt) => (
                              <SelectItem key={opt} value={opt}>
                                {opt}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : isClosureComments ? (
                        <Input
                          className="h-8 w-full min-w-[10rem] text-sm"
                          value={closureCommentsValue}
                          onChange={(e) => onClosureCommentsChange(row, e.target.value)}
                          placeholder="Add closure comment..."
                          title={closureCommentsValue}
                        />
                      ) : isClosureDate ? (
                        <ClosureDateField
                          stored={closureDateStored}
                          row={row}
                          onClosureDateChange={onClosureDateChange}
                        />
                      ) : (
                        row[h] ?? ""
                      )}
                    </TableCell>
                  );
                })}
                {actionColumn && (
                  <TableCell
                    className="text-sm whitespace-nowrap"
                    style={{ width: columnWidths[actionColumn.header] ?? DEFAULT_COL_WIDTH }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {actionColumn.render(row)}
                  </TableCell>
                )}
                {leadingColumn && (
                  <TableCell
                    className="text-sm whitespace-nowrap"
                    style={{ width: columnWidths[leadingColumn.header] ?? DEFAULT_COL_WIDTH }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {leadingColumn.render(row)}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {filteredRows.length < rows.length && (
        <p className="text-xs text-muted-foreground">
          Showing {filteredRows.length} of {rows.length} rows
        </p>
      )}
    </div>
  );
}
