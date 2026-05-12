import { useCallback, useState, useEffect } from "react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { SOCSidebar } from "@/components/SOCSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, Trash2, FileSpreadsheet, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from "lucide-react";
import { SiemDynamicUseCaseTable, type SiemDynamicRow } from "@/components/SiemDynamicUseCaseTable";
import { SiemUseCase } from "@/types/siemUseCase";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { useToast } from "@/hooks/use-toast";

const STORAGE_KEY_V2 = "siemWorkbookV2";

export interface SiemWorkbookSheet {
    name: string;
    /** Column headers exactly as in the file (first row), in order */
    columns: string[];
    rows: SiemDynamicRow[];
}

function computeDefaultMonthColumns(): string[] {
    const now = new Date();
    const monthNames = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    const prev1 = (now.getMonth() - 1 + 12) % 12;
    const prev2 = (now.getMonth() - 2 + 12) % 12;
    const prev3 = (now.getMonth() - 3 + 12) % 12;
    return [monthNames[prev3], monthNames[prev2], monthNames[prev1]];
}

/** Legacy upload format → dynamic sheet (fixed columns + month columns). */
function legacyUseCasesToDynamic(name: string, useCases: SiemUseCase[], monthColumns: string[]): SiemWorkbookSheet {
    const columns = [
        "Rule Name",
        "PB-Severity",
        "Rule Condition",
        "Log Source",
        "Team",
        "Alert Received",
        "Remarks",
        ...monthColumns,
    ];
    const rows: SiemDynamicRow[] = useCases.map((uc) => {
        const row: Record<string, string> = {
            id: uc.id,
            "Rule Name": uc.ruleName,
            "PB-Severity": uc.pbSeverity,
            "Rule Condition": uc.ruleCondition,
            "Log Source": uc.logSource,
            Team: uc.team,
            "Alert Received": uc.alertReceived,
            Remarks: uc.remarks,
        };
        monthColumns.forEach((m) => {
            row[m] = String(uc.monthlyData[m] ?? "");
        });
        return row as SiemDynamicRow;
    });
    return { name, columns, rows };
}

function dedupeHeaderNames(raw: string[]): string[] {
    const counts = new Map<string, number>();
    return raw.map((h, i) => {
        let base = h.trim() || `Column ${i + 1}`;
        const n = counts.get(base) ?? 0;
        counts.set(base, n + 1);
        if (n > 0) base = `${base} (${n + 1})`;
        return base;
    });
}

/** First row = headers; following rows = data. Only columns present in the file are used. */
function sheetGridToObjects(jsonData: (string | number | null)[][]): Record<string, string>[] {
    if (!jsonData.length) return [];
    const rawHeaders = (jsonData[0] || []).map((h) => String(h ?? ""));
    const headers = dedupeHeaderNames(rawHeaders);
    const dataRows = jsonData.slice(1) as (string | number | null)[][];
    return dataRows
        .map((row) => {
            const obj: Record<string, string> = {};
            headers.forEach((header, index) => {
                obj[header] = row[index]?.toString() ?? "";
            });
            return obj;
        })
        .filter((obj) => Object.values(obj).some((v) => v.trim() !== ""));
}

/** Build column order from first row keys, then any extra keys from later rows (Papa/Excel). */
function collectColumnOrder(rows: Record<string, string>[]): string[] {
    const order: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
        for (const k of Object.keys(row)) {
            if (seen.has(k)) continue;
            seen.add(k);
            order.push(k);
        }
    }
    return order.filter((k) => k.trim() !== "");
}

function buildSheetFromObjects(name: string, data: Record<string, string>[]): SiemWorkbookSheet {
    if (data.length === 0) {
        return { name, columns: [], rows: [] };
    }
    const columns = collectColumnOrder(data);
    const rows: SiemDynamicRow[] = data.map((row, index) => {
        const id = `siem-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 9)}`;
        const r: Record<string, string> = { id };
        columns.forEach((c) => {
            r[c] = row[c] ?? "";
        });
        return r as SiemDynamicRow;
    });
    return { name, columns, rows };
}

function migrateSheetFromStorage(s: unknown): SiemWorkbookSheet {
    if (!s || typeof s !== "object") return { name: "Sheet", columns: [], rows: [] };
    const o = s as Record<string, unknown>;
    const name = String(o.name ?? "Sheet");
    if (Array.isArray(o.columns) && Array.isArray(o.rows)) {
        return {
            name,
            columns: o.columns as string[],
            rows: o.rows as SiemDynamicRow[],
        };
    }
    if (Array.isArray(o.useCases)) {
        const monthCols = Array.isArray(o.monthColumns) ? (o.monthColumns as string[]) : computeDefaultMonthColumns();
        return legacyUseCasesToDynamic(name, o.useCases as SiemUseCase[], monthCols);
    }
    return { name, columns: [], rows: [] };
}

export default function SiemUseCases() {
    const [sheets, setSheets] = useState<SiemWorkbookSheet[]>([]);
    const [activeSheetIndex, setActiveSheetIndex] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const { toast } = useToast();

    const activeSheet = sheets[activeSheetIndex] ?? sheets[0];

    useEffect(() => {
        try {
            const savedV2 = localStorage.getItem(STORAGE_KEY_V2);
            if (savedV2) {
                const parsed = JSON.parse(savedV2) as { sheets?: unknown[]; activeSheetIndex?: number };
                if (parsed?.sheets && Array.isArray(parsed.sheets) && parsed.sheets.length > 0) {
                    const migrated = parsed.sheets.map(migrateSheetFromStorage);
                    setSheets(migrated);
                    const idx = typeof parsed.activeSheetIndex === "number" ? parsed.activeSheetIndex : 0;
                    setActiveSheetIndex(Math.min(Math.max(0, idx), migrated.length - 1));
                    return;
                }
            }
            const savedUseCases = localStorage.getItem("siemUseCases");
            const savedMonthCols = localStorage.getItem("siemMonthColumns");
            if (savedUseCases) {
                const parsedUseCases = JSON.parse(savedUseCases) as SiemUseCase[];
                const parsedMonthCols = savedMonthCols ? (JSON.parse(savedMonthCols) as string[]) : computeDefaultMonthColumns();
                if (parsedUseCases.length > 0) {
                    setSheets([legacyUseCasesToDynamic("Sheet1", parsedUseCases, parsedMonthCols)]);
                    setActiveSheetIndex(0);
                }
            }
        } catch (error) {
            console.warn("Failed to load SIEM data from localStorage:", error);
        }
    }, []);

    useEffect(() => {
        if (sheets.length === 0) {
            try {
                localStorage.removeItem(STORAGE_KEY_V2);
                localStorage.removeItem("siemUseCases");
                localStorage.removeItem("siemMonthColumns");
            } catch {
                /* ignore */
            }
            return;
        }
        try {
            localStorage.setItem(STORAGE_KEY_V2, JSON.stringify({ sheets, activeSheetIndex }));
        } catch (error) {
            console.warn("Failed to save SIEM workbook to localStorage:", error);
        }
    }, [sheets, activeSheetIndex]);

    useEffect(() => {
        if (activeSheetIndex >= sheets.length && sheets.length > 0) {
            setActiveSheetIndex(sheets.length - 1);
        }
    }, [sheets.length, activeSheetIndex]);

    const handleUpdateCell = useCallback((id: string, columnKey: string, value: string) => {
        setSheets((prev) =>
            prev.map((sheet, idx) => {
                if (idx !== activeSheetIndex) return sheet;
                return {
                    ...sheet,
                    rows: sheet.rows.map((row) =>
                        row.id === id ? { ...row, [columnKey]: value } : row
                    ),
                };
            })
        );
    }, [activeSheetIndex]);

    const clearSiemData = useCallback(() => {
        setSheets([]);
        setActiveSheetIndex(0);
        try {
            localStorage.removeItem(STORAGE_KEY_V2);
            localStorage.removeItem("siemUseCases");
            localStorage.removeItem("siemMonthColumns");
        } catch {
            /* ignore */
        }
    }, []);

    const handleClearSavedClick = useCallback(() => {
        clearSiemData();
        toast({ title: "Cleared", description: "SIEM use case data was removed from this browser." });
    }, [clearSiemData, toast]);

    const applyWorkbook = useCallback(
        (nextSheets: SiemWorkbookSheet[]) => {
            if (nextSheets.length === 0) {
                toast({
                    title: "Empty File",
                    description: "No worksheet data found",
                    variant: "destructive",
                });
                return;
            }
            setSheets(nextSheets);
            setActiveSheetIndex(0);
            const totalRows = nextSheets.reduce((n, s) => n + s.rows.length, 0);
            toast({
                title: "File uploaded",
                description: `${nextSheets.length} sheet(s), ${totalRows} row(s) total.`,
            });
        },
        [toast]
    );

    const processCsvRows = useCallback(
        (data: Record<string, string>[]) => {
            clearSiemData();
            if (data.length === 0) {
                toast({
                    title: "Empty File",
                    description: "The uploaded file contains no data",
                    variant: "destructive",
                });
                return;
            }
            const sheet = buildSheetFromObjects("Sheet1", data);
            applyWorkbook([sheet]);
        },
        [applyWorkbook, clearSiemData, toast]
    );

    const parseExcelWorkbook = useCallback(
        (workbook: XLSX.WorkBook) => {
            const nextSheets: SiemWorkbookSheet[] = [];
            for (const sheetName of workbook.SheetNames) {
                const ws = workbook.Sheets[sheetName];
                if (!ws) continue;
                const jsonData = XLSX.utils.sheet_to_json(ws, {
                    header: 1,
                    defval: "",
                    raw: false,
                }) as (string | number | null)[][];
                const objects = sheetGridToObjects(jsonData);
                const displayName = sheetName.trim() || `Sheet ${nextSheets.length + 1}`;
                nextSheets.push(buildSheetFromObjects(displayName, objects));
            }
            clearSiemData();
            applyWorkbook(nextSheets);
        },
        [applyWorkbook, clearSiemData]
    );

    const parseFile = useCallback(
        (file: File) => {
            const fileExtension = file.name.split(".").pop()?.toLowerCase();

            if (fileExtension === "csv") {
                Papa.parse(file, {
                    header: true,
                    skipEmptyLines: true,
                    complete: (results) => {
                        processCsvRows(results.data as Record<string, string>[]);
                    },
                    error: (error) => {
                        toast({
                            title: "Parse Error",
                            description: `Failed to parse CSV: ${error.message}`,
                            variant: "destructive",
                        });
                    },
                });
            } else if (fileExtension === "xlsx" || fileExtension === "xls") {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const raw = new Uint8Array(e.target?.result as ArrayBuffer);
                        const workbook = XLSX.read(raw, { type: "array" });
                        parseExcelWorkbook(workbook);
                    } catch {
                        toast({
                            title: "Parse Error",
                            description: "Failed to parse Excel file",
                            variant: "destructive",
                        });
                    }
                };
                reader.readAsArrayBuffer(file);
            } else {
                toast({
                    title: "Invalid File Type",
                    description: "Please upload a CSV or Excel file (.csv, .xlsx, .xls)",
                    variant: "destructive",
                });
            }
        },
        [parseExcelWorkbook, processCsvRows, toast]
    );

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) parseFile(file);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) parseFile(file);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => setIsDragging(false);

    const goFirst = () => setActiveSheetIndex(0);
    const goPrev = () => setActiveSheetIndex((i) => Math.max(0, i - 1));
    const goNext = () => setActiveSheetIndex((i) => Math.min(sheets.length - 1, i + 1));
    const goLast = () => setActiveSheetIndex(Math.max(0, sheets.length - 1));

    return (
        <SidebarProvider>
            <SOCSidebar />
            <SidebarInset className="max-h-svh overflow-hidden flex flex-col">
                <div
                    className={`flex min-h-0 flex-1 flex-col min-w-0 overflow-hidden bg-background ${isDragging ? "ring-2 ring-primary/30 ring-inset" : ""}`}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                >
                    <header className="z-10 shrink-0 border-b bg-background/95 px-6 py-3">
                        <div className="flex flex-wrap items-center gap-3 justify-between">
                            <div className="min-w-0">
                                <h1 className="text-2xl font-bold text-foreground truncate">SIEM Use case</h1>
                                <p className="text-sm text-muted-foreground">
                                    Each Excel tab uses <strong>only its own columns</strong> (no extra month columns). Data is saved in this browser.
                                </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                                <label>
                                    <input
                                        type="file"
                                        accept=".csv,.xlsx,.xls"
                                        onChange={handleFileInput}
                                        className="hidden"
                                    />
                                    <Button variant="outline" size="sm" asChild>
                                        <span className="cursor-pointer">
                                            <Upload className="mr-2 h-4 w-4" />
                                            Upload file
                                        </span>
                                    </Button>
                                </label>
                                {sheets.length > 0 && (
                                    <Button variant="outline" size="sm" onClick={handleClearSavedClick}>
                                        <Trash2 className="mr-2 h-4 w-4" />
                                        Clear saved data
                                    </Button>
                                )}
                                <ThemeToggle />
                                <NotificationsPanel />
                            </div>
                        </div>
                    </header>

                    <div className="min-h-0 flex-1 overflow-auto p-6">
                        {sheets.length === 0 ? (
                            <Card
                                className={`border-dashed max-w-2xl mx-auto ${isDragging ? "border-primary bg-primary/5" : ""}`}
                            >
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2 text-lg">
                                        <FileSpreadsheet className="h-5 w-5" />
                                        No use cases loaded
                                    </CardTitle>
                                    <CardDescription>
                                        Drag and drop a <strong>.csv</strong>, <strong>.xlsx</strong>, or <strong>.xls</strong> file here, or use{" "}
                                        <strong>Upload file</strong>. Each worksheet tab shows <strong>only the columns from that sheet</strong>.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-sm text-muted-foreground">
                                        After upload, rows appear below. Edits are saved automatically in this browser.
                                    </p>
                                </CardContent>
                            </Card>
                        ) : (
                            <Card className="overflow-hidden border border-border shadow-sm flex flex-col max-h-[calc(100vh-8rem)]">
                                <CardHeader className="py-3 px-4 bg-muted/30 border-b shrink-0">
                                    <CardTitle className="text-base">Use case workbook</CardTitle>
                                    <CardDescription className="text-xs">
                                        {sheets.length} sheet(s) • {sheets.reduce((n, s) => n + s.rows.length, 0)} row(s) total • drag another file to replace
                                    </CardDescription>
                                </CardHeader>

                                <div className="flex items-center gap-0.5 border-b bg-muted/30 px-1 py-1 shrink-0">
                                    <div className="flex items-center gap-0.5 shrink-0 mr-1">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7"
                                            disabled={activeSheetIndex <= 0}
                                            onClick={goFirst}
                                            title="First sheet"
                                        >
                                            <ChevronsLeft className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7"
                                            disabled={activeSheetIndex <= 0}
                                            onClick={goPrev}
                                            title="Previous sheet"
                                        >
                                            <ChevronLeft className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7"
                                            disabled={activeSheetIndex >= sheets.length - 1}
                                            onClick={goNext}
                                            title="Next sheet"
                                        >
                                            <ChevronRight className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7"
                                            disabled={activeSheetIndex >= sheets.length - 1}
                                            onClick={goLast}
                                            title="Last sheet"
                                        >
                                            <ChevronsRight className="h-4 w-4" />
                                        </Button>
                                    </div>
                                    <Tabs
                                        value={String(activeSheetIndex)}
                                        onValueChange={(v) => setActiveSheetIndex(Number(v))}
                                        className="flex-1 min-w-0"
                                    >
                                        <TabsList className="h-auto w-full justify-start flex-nowrap overflow-x-auto bg-transparent p-0 gap-0.5 rounded-none">
                                            {sheets.map((s, i) => (
                                                <TabsTrigger
                                                    key={`${s.name}-${i}`}
                                                    value={String(i)}
                                                    className="shrink-0 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-background data-[state=active]:text-primary px-3 py-1.5 text-sm font-medium"
                                                    title={s.name}
                                                >
                                                    {s.name}
                                                </TabsTrigger>
                                            ))}
                                        </TabsList>
                                    </Tabs>
                                </div>

                                <CardContent className="p-0 sm:p-4 flex-1 min-h-0 overflow-auto">
                                    {activeSheet && (
                                        <SiemDynamicUseCaseTable
                                            columns={activeSheet.columns}
                                            rows={activeSheet.rows}
                                            onUpdateCell={handleUpdateCell}
                                        />
                                    )}
                                </CardContent>
                            </Card>
                        )}
                    </div>
                </div>
            </SidebarInset>
        </SidebarProvider>
    );
}
