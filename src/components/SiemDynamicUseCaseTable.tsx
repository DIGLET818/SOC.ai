import { useCallback, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Loader2, RefreshCw, Filter } from "lucide-react";
import { cn } from "@/lib/utils";

export type SiemDynamicRow = { id: string } & Record<string, string>;

/** Display-only serial column (not stored in workbook / DB). */
const SNO_HEADER = "S. No.";
const BLANK_LABEL = "(Blanks)";
const MAX_CHECKBOX_VALUES = 200;

function cellDisplayValue(raw: string | undefined): string {
  const t = String(raw ?? "").trim();
  return t || BLANK_LABEL;
}

function uniqueColumnValues(rows: SiemDynamicRow[], col: string): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    set.add(cellDisplayValue(row[col]));
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

type ColumnFilterMap = Record<string, Set<string> | undefined>;

function SiemColumnFilter({
  column,
  rows,
  selected,
  onChange,
}: {
  column: string;
  rows: SiemDynamicRow[];
  selected: Set<string> | undefined;
  onChange: (next: Set<string> | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const allValues = useMemo(() => uniqueColumnValues(rows, column), [rows, column]);
  const tooMany = allValues.length > MAX_CHECKBOX_VALUES;

  const filteredValues = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allValues;
    return allValues.filter((v) => v.toLowerCase().includes(q));
  }, [allValues, search]);

  const active = selected !== undefined && selected.size > 0;
  const allSelected =
    active && selected !== undefined && allValues.length > 0 && selected.size >= allValues.length;

  const toggleValue = (value: string, checked: boolean) => {
    const base = selected ? new Set(selected) : new Set(allValues);
    if (checked) base.add(value);
    else base.delete(value);
    if (base.size === 0 || base.size >= allValues.length) {
      onChange(undefined);
    } else {
      onChange(base);
    }
  };

  const selectAll = () => onChange(undefined);
  const clearAll = () => onChange(new Set());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("h-6 w-6 shrink-0", active && "text-primary bg-primary/10")}
          title={`Filter ${column}`}
        >
          <Filter className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <div className="p-2 border-b space-y-2">
          <p className="text-xs font-medium truncate" title={column}>
            Filter: {column}
          </p>
          <Input
            placeholder="Search values…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-xs"
          />
          <div className="flex gap-1">
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs flex-1" onClick={selectAll}>
              Select all
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs flex-1" onClick={clearAll}>
              Clear
            </Button>
          </div>
        </div>
        <div className="max-h-56 overflow-y-auto p-2 space-y-1">
          {tooMany ? (
            <p className="text-xs text-muted-foreground px-1 py-2">
              {allValues.length} unique values — narrow with search, then tick values to show.
            </p>
          ) : null}
          {!tooMany && (
            <label className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted/60 cursor-pointer text-xs">
              <Checkbox checked={!active || allSelected} onCheckedChange={() => selectAll()} />
              <span className="font-medium">(Select all)</span>
            </label>
          )}
          {filteredValues.length === 0 ? (
            <p className="text-xs text-muted-foreground px-1 py-2">No matching values</p>
          ) : (
            filteredValues.map((value) => {
              const checked = !active || selected?.has(value);
              return (
                <label
                  key={value}
                  className="flex items-center gap-2 px-1 py-1 rounded hover:bg-muted/60 cursor-pointer text-xs"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(c) => toggleValue(value, c === true)}
                  />
                  <span className="truncate" title={value}>
                    {value}
                  </span>
                </label>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface SiemDynamicUseCaseTableProps {
  columns: string[];
  rows: SiemDynamicRow[];
  onUpdateCell: (id: string, columnKey: string, value: string) => void;
  ruleNameColumn?: string | null;
  onFetchRowIncidents?: (rowId: string, ruleName: string) => void;
  fetchingRowId?: string | null;
}

export function SiemDynamicUseCaseTable({
  columns,
  rows,
  onUpdateCell,
  ruleNameColumn,
  onFetchRowIncidents,
  fetchingRowId,
}: SiemDynamicUseCaseTableProps) {
  const [columnFilters, setColumnFilters] = useState<ColumnFilterMap>({});
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  const rowIndexById = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, i) => map.set(row.id, i + 1));
    return map;
  }, [rows]);

  const hasActiveFilters = useMemo(
    () => Object.values(columnFilters).some((s) => s !== undefined && s.size > 0),
    [columnFilters]
  );

  const filteredRows = useMemo(() => {
    return rows.filter((row) =>
      columns.every((col) => {
        const allowed = columnFilters[col];
        if (allowed === undefined) return true;
        if (allowed.size === 0) return false;
        return allowed.has(cellDisplayValue(row[col]));
      })
    );
  }, [rows, columns, columnFilters]);

  const setColumnFilter = useCallback((col: string, next: Set<string> | undefined) => {
    setColumnFilters((prev) => {
      if (next === undefined) {
        const { [col]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [col]: next };
    });
  }, []);

  const clearAllFilters = useCallback(() => setColumnFilters({}), []);

  const thBase =
    "h-auto min-h-7 px-1.5 py-0.5 text-left align-middle font-semibold text-foreground text-[11px] leading-tight border-b bg-muted";
  const stickyTop = "sticky top-0 z-30 bg-muted";
  const stickySno = cn(thBase, stickyTop, "left-0 z-40 w-9 min-w-[2.25rem] max-w-[2.25rem] text-center");
  const stickyFirstCol = cn(thBase, stickyTop, "left-9 z-40 min-w-[8rem]");
  const tdSno =
    "sticky left-0 z-10 w-9 min-w-[2.25rem] text-center text-muted-foreground tabular-nums bg-card border-r border-border/60 py-0.5 px-1 text-[11px] leading-snug";
  const tdFirstCol =
    "sticky left-9 z-10 bg-card shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] py-0.5 px-1.5 text-[11px] leading-snug align-top";
  const tdBody = "align-top py-0.5 px-1.5 text-[11px] leading-snug min-w-[4.5rem]";

  const handleCellBlur = () => {
    if (editingCell) {
      onUpdateCell(editingCell.id, editingCell.field, editValue);
    }
    setEditingCell(null);
    setEditValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleCellBlur();
    else if (e.key === "Escape") {
      setEditingCell(null);
      setEditValue("");
    }
  };

  const renderCell = (id: string, col: string, raw: string) => {
    const isEditing = editingCell?.id === id && editingCell?.field === col;
    const value = raw ?? "";
    const isEmpty = !value.trim();

    if (isEditing) {
      return (
        <input
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleCellBlur}
          onKeyDown={handleKeyDown}
          className="w-full min-w-[4rem] bg-background border border-primary rounded px-1 py-0 text-[11px] focus:outline-none"
        />
      );
    }

    if (!isEmpty) {
      return (
        <span
          role="button"
          tabIndex={0}
          onClick={() => {
            setEditingCell({ id, field: col });
            setEditValue(value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setEditingCell({ id, field: col });
              setEditValue(value);
            }
          }}
          className="cursor-pointer hover:bg-muted/50 px-0.5 py-0 rounded inline-block max-w-[20rem] break-words leading-snug"
        >
          {value}
        </span>
      );
    }

    return (
      <span
        role="button"
        tabIndex={0}
        onClick={() => {
          setEditingCell({ id, field: col });
          setEditValue("");
        }}
        className="cursor-pointer hover:bg-muted/50 px-0.5 rounded min-w-[1.5rem] min-h-[1rem] inline-flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground/60 text-[10px]"
        title="Click to edit"
      >
        —
      </span>
    );
  };

  const renderHeaderCell = (label: string, colKey: string | null, stickyClass: string) => (
    <th className={stickyClass}>
      <div className="flex items-start justify-between gap-1">
        <span className="whitespace-nowrap leading-tight pt-0.5">{label}</span>
        {colKey ? (
          <SiemColumnFilter
            column={colKey}
            rows={rows}
            selected={columnFilters[colKey]}
            onChange={(next) => setColumnFilter(colKey, next)}
          />
        ) : null}
      </div>
    </th>
  );

  if (rows.length === 0) {
    return (
      <Card className="p-12 text-center">
        <p className="text-muted-foreground text-lg">No rows in this sheet</p>
      </Card>
    );
  }

  if (columns.length === 0) {
    return (
      <Card className="p-12 text-center">
        <p className="text-muted-foreground text-lg">No column headers found in this sheet.</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 flex-1">
      <div className="flex flex-wrap items-center gap-1.5 px-1.5 py-0.5 text-[10px] text-muted-foreground shrink-0 border-b bg-muted/20">
        <span>
          {filteredRows.length}/{rows.length} rows · {columns.length} cols
        </span>
        {hasActiveFilters ? (
          <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] ml-auto" onClick={clearAllFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>

      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b">
                {renderHeaderCell(SNO_HEADER, null, stickySno)}
                {columns.map((col, idx) =>
                  renderHeaderCell(
                    col,
                    col,
                    cn(thBase, stickyTop, idx === 0 ? stickyFirstCol : "min-w-[4.5rem]")
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length + 1}
                    className="py-8 text-center text-muted-foreground text-sm"
                  >
                    No rows match the current column filters.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const serial = rowIndexById.get(row.id) ?? 0;
                  return (
                    <tr key={row.id} className="border-b border-border/50 hover:bg-muted/25">
                      <td className={tdSno}>{serial || "—"}</td>
                      {columns.map((col, idx) => (
                        <td key={col} className={cn(tdBody, idx === 0 && tdFirstCol)}>
                          {ruleNameColumn && col === ruleNameColumn ? (
                            <div className="flex items-center gap-0.5 group">
                              {renderCell(row.id, col, row[col] ?? "")}
                              {onFetchRowIncidents && (row[col] ?? "").trim() ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5 shrink-0 opacity-50 group-hover:opacity-100"
                                  title="Fetch latest incident IDs for this rule (month columns)"
                                  disabled={fetchingRowId === row.id}
                                  onClick={() =>
                                    onFetchRowIncidents(row.id, String(row[col] ?? "").trim())
                                  }
                                >
                                  {fetchingRowId === row.id ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <RefreshCw className="h-3 w-3" />
                                  )}
                                </Button>
                              ) : null}
                            </div>
                          ) : (
                            renderCell(row.id, col, row[col] ?? "")
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
