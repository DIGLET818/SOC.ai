import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type SiemDynamicRow = { id: string } & Record<string, string>;

interface SiemDynamicUseCaseTableProps {
  columns: string[];
  rows: SiemDynamicRow[];
  onUpdateCell: (id: string, columnKey: string, value: string) => void;
}

export function SiemDynamicUseCaseTable({
  columns,
  rows,
  onUpdateCell,
}: SiemDynamicUseCaseTableProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  const filteredRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      columns.some((col) => String(row[col] ?? "").toLowerCase().includes(q))
    );
  }, [rows, columns, searchTerm]);

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
          className="w-full min-w-[6rem] bg-background border border-primary rounded px-1 py-0.5 text-sm focus:outline-none"
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
          className="cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded inline-block max-w-[28rem] break-words"
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
        className="cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded min-w-[40px] min-h-[20px] inline-flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground/60 text-xs"
        title="Click to edit"
      >
        —
      </span>
    );
  };

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
    <div className="flex flex-col h-full gap-3">
      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="w-full max-w-md relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search across columns in this sheet…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="text-sm text-muted-foreground ml-auto">
            Columns: {columns.length} · Rows: {filteredRows.length}
          </div>
        </div>
      </Card>

      <div className="rounded-lg border bg-card flex-1 flex flex-col min-h-0">
        <div className="overflow-auto flex-1">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {columns.map((col, idx) => (
                  <TableHead
                    key={col}
                    className={cn(
                      "whitespace-nowrap bg-background max-w-[20rem]",
                      idx === 0 && "sticky left-0 z-20 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]"
                    )}
                  >
                    {col}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map((row) => (
                <TableRow key={row.id}>
                  {columns.map((col, idx) => (
                    <TableCell
                      key={col}
                      className={cn(
                        "align-top text-sm",
                        idx === 0 && "font-medium sticky left-0 z-10 bg-card shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]"
                      )}
                    >
                      {renderCell(row.id, col, row[col] ?? "")}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
