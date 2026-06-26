import { useCallback, useState, useEffect, useMemo, useRef } from "react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { SOCSidebar } from "@/components/SOCSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, Trash2, FileSpreadsheet, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, Loader2, RefreshCw, ChevronDown } from "lucide-react";
import { SiemDynamicUseCaseTable, type SiemDynamicRow } from "@/components/SiemDynamicUseCaseTable";
import { SiemUseCase } from "@/types/siemUseCase";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { useToast } from "@/hooks/use-toast";
import {
    getLastNMonthColumnLabels,
    isMonthColumnHeader,
    monthColumnGmailDateRange,
    normalizeSheetMonthColumns,
} from "@/lib/siemMonthColumns";
import { findRuleNameColumn } from "@/lib/siemMasterRules";
import {
    postGmailSiemRuleLatestIncidentsResilient,
    type SiemRuleLatestIncidentsRow,
} from "@/api/gmail";
import {
    deleteSiemWorkbook,
    getSiemWorkbook,
    putSiemWorkbookResilient,
    type SiemWorkbookSheetDto,
} from "@/api/siemWorkbook";

const STORAGE_KEY_V2 = "siemWorkbookV2";

export interface SiemWorkbookSheet {
    name: string;
    /** Column headers exactly as in the file (first row), in order */
    columns: string[];
    rows: SiemDynamicRow[];
}

function computeDefaultMonthColumns(): string[] {
    return getLastNMonthColumnLabels(4);
}

function normalizeWorkbookSheets(sheets: SiemWorkbookSheet[]): SiemWorkbookSheet[] {
    return sheets.map((s) => normalizeSheetMonthColumns(s));
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

function clearLegacySiemBrowserStorage() {
    try {
        localStorage.removeItem(STORAGE_KEY_V2);
        localStorage.removeItem("siemUseCases");
        localStorage.removeItem("siemMonthColumns");
    } catch {
        /* ignore */
    }
}

function readLegacyWorkbookFromBrowser(): { sheets: SiemWorkbookSheet[]; activeSheetIndex: number } | null {
    try {
        const savedV2 = localStorage.getItem(STORAGE_KEY_V2);
        if (savedV2) {
            const parsed = JSON.parse(savedV2) as { sheets?: unknown[]; activeSheetIndex?: number };
            if (parsed?.sheets && Array.isArray(parsed.sheets) && parsed.sheets.length > 0) {
                const migrated = normalizeWorkbookSheets(
                    parsed.sheets.map(migrateSheetFromStorage)
                );
                const idx = typeof parsed.activeSheetIndex === "number" ? parsed.activeSheetIndex : 0;
                return {
                    sheets: migrated,
                    activeSheetIndex: Math.min(Math.max(0, idx), migrated.length - 1),
                };
            }
        }
        const savedUseCases = localStorage.getItem("siemUseCases");
        const savedMonthCols = localStorage.getItem("siemMonthColumns");
        if (savedUseCases) {
            const parsedUseCases = JSON.parse(savedUseCases) as SiemUseCase[];
            const parsedMonthCols = savedMonthCols
                ? (JSON.parse(savedMonthCols) as string[])
                : computeDefaultMonthColumns();
            if (parsedUseCases.length > 0) {
                const sheet = legacyUseCasesToDynamic("Sheet1", parsedUseCases, parsedMonthCols);
                return { sheets: normalizeWorkbookSheets([sheet]), activeSheetIndex: 0 };
            }
        }
    } catch {
        /* ignore */
    }
    return null;
}

/** Merge Gmail incident fetch results into workbook state (pure — safe to save immediately). */
function mergeIncidentResultsIntoSheets(
    sheets: SiemWorkbookSheet[],
    sheetIndex: number,
    results: SiemRuleLatestIncidentsRow[]
): SiemWorkbookSheet[] {
    if (!results.length) return sheets;
    return sheets.map((sheet, idx) => {
        if (idx !== sheetIndex) return sheet;
        const byRowId = new Map(results.filter((r) => r.row_id).map((r) => [r.row_id as string, r]));
        const byRuleLower = new Map(results.map((r) => [r.rule_name.trim().toLowerCase(), r]));
        const ruleCol = findRuleNameColumn(sheet.columns);
        return {
            ...sheet,
            rows: sheet.rows.map((row) => {
                const hit =
                    byRowId.get(row.id) ??
                    (ruleCol ? byRuleLower.get((row[ruleCol] ?? "").trim().toLowerCase()) : undefined);
                if (!hit) return row;
                const next = { ...row };
                for (const [label, cell] of Object.entries(hit.by_month)) {
                    const mapped =
                        cell.mapped_id ?? cell.latest_incident_id ?? cell.latest_case_id ?? null;
                    next[label] = mapped ?? "NA";
                }
                return next;
            }),
        };
    });
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
    const [fetchingIncidents, setFetchingIncidents] = useState(false);
    const [fetchingRowId, setFetchingRowId] = useState<string | null>(null);
    const [fetchProgress, setFetchProgress] = useState<{
        done: number;
        total: number;
        monthLabel?: string;
    } | null>(null);
    const [workbookLoading, setWorkbookLoading] = useState(true);
    const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
    const [saveErrorDetail, setSaveErrorDetail] = useState<string | null>(null);
    const hydrateDoneRef = useRef(false);
    const sheetsRef = useRef<SiemWorkbookSheet[]>([]);
    const activeSheetIndexRef = useRef(0);
    const saveChainRef = useRef<Promise<void>>(Promise.resolve());
    const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const { toast } = useToast();

    const activeSheet = sheets[activeSheetIndex] ?? sheets[0];

    const ruleNameColumn = useMemo(
        () => (activeSheet ? findRuleNameColumn(activeSheet.columns) : null),
        [activeSheet]
    );
    const monthColumns = useMemo(
        () => activeSheet?.columns.filter(isMonthColumnHeader) ?? [],
        [activeSheet]
    );

    useEffect(() => {
        sheetsRef.current = sheets;
    }, [sheets]);

    useEffect(() => {
        activeSheetIndexRef.current = activeSheetIndex;
    }, [activeSheetIndex]);

    const persistWorkbookNow = useCallback(async () => {
        const payload = {
            sheets: sheetsRef.current as SiemWorkbookSheetDto[],
            activeSheetIndex: activeSheetIndexRef.current,
        };
        setSaveStatus("saving");
        setSaveErrorDetail(null);
        try {
            if (payload.sheets.length === 0) {
                await deleteSiemWorkbook();
            } else {
                await putSiemWorkbookResilient(payload);
            }
            setSaveStatus("saved");
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn("Failed to save SIEM workbook:", e);
            setSaveErrorDetail(msg);
            setSaveStatus("error");
        }
    }, []);

    const queueWorkbookSave = useCallback(() => {
        saveChainRef.current = saveChainRef.current
            .then(() => persistWorkbookNow())
            .catch(() => {
                /* persistWorkbookNow already sets error state */
            });
    }, [persistWorkbookNow]);

    const monthGmailRanges = useMemo(() => {
        const out: Array<{ label: string; after_date: string; before_date: string }> = [];
        for (const label of monthColumns) {
            const range = monthColumnGmailDateRange(label);
            if (!range) continue;
            out.push({ label, after_date: range.afterDate, before_date: range.beforeDate });
        }
        return out;
    }, [monthColumns]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setWorkbookLoading(true);
            try {
                const data = await getSiemWorkbook();
                let nextSheets: SiemWorkbookSheet[] = [];
                let nextIndex = 0;

                if (data.sheets?.length) {
                    nextSheets = normalizeWorkbookSheets(data.sheets.map((s) => migrateSheetFromStorage(s)));
                    nextIndex =
                        typeof data.activeSheetIndex === "number"
                            ? Math.min(Math.max(0, data.activeSheetIndex), Math.max(0, nextSheets.length - 1))
                            : 0;
                } else {
                    const legacy = readLegacyWorkbookFromBrowser();
                    if (legacy?.sheets.length) {
                        await putSiemWorkbookResilient({
                            sheets: legacy.sheets,
                            activeSheetIndex: legacy.activeSheetIndex,
                        });
                        clearLegacySiemBrowserStorage();
                        nextSheets = legacy.sheets;
                        nextIndex = legacy.activeSheetIndex;
                        if (!cancelled) {
                            toast({
                                title: "Workbook migrated to database",
                                description:
                                    "Your browser copy was saved to SQLite. It will load from the server from now on.",
                            });
                        }
                    }
                }

                if (!cancelled) {
                    setSheets(nextSheets);
                    setActiveSheetIndex(nextIndex);
                }
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                if (!cancelled) {
                    toast({
                        title: "Could not load SIEM workbook",
                        description: msg.includes("401") || /auth|session|sign/i.test(msg)
                            ? "Sign in with Google from the Alerts page first, then reload."
                            : msg,
                        variant: "destructive",
                    });
                }
            } finally {
                if (!cancelled) {
                    setWorkbookLoading(false);
                    hydrateDoneRef.current = true;
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [toast]);

    useEffect(() => {
        if (!hydrateDoneRef.current || workbookLoading || fetchingIncidents) return;

        if (saveDebounceRef.current) window.clearTimeout(saveDebounceRef.current);
        saveDebounceRef.current = window.setTimeout(() => {
            queueWorkbookSave();
        }, 1200);

        return () => {
            if (saveDebounceRef.current) window.clearTimeout(saveDebounceRef.current);
        };
    }, [sheets, activeSheetIndex, workbookLoading, fetchingIncidents, queueWorkbookSave]);

    useEffect(() => {
        if (activeSheetIndex >= sheets.length && sheets.length > 0) {
            setActiveSheetIndex(sheets.length - 1);
        }
    }, [sheets.length, activeSheetIndex]);

    const commitSheets = useCallback((next: SiemWorkbookSheet[]) => {
        sheetsRef.current = next;
        setSheets(next);
    }, []);

    const persistFetchProgress = useCallback(async () => {
        await saveChainRef.current;
        await persistWorkbookNow();
    }, [persistWorkbookNow]);

    useEffect(() => {
        if (!fetchingIncidents) return;
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = "";
        };
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, [fetchingIncidents]);

    const fetchLatestIncidentsForRowIds = useCallback(
        async (rowIds: string[], options?: { monthLabels?: string[] }) => {
            if (!activeSheet || !ruleNameColumn || monthGmailRanges.length === 0) {
                toast({
                    title: "Cannot fetch incidents",
                    description:
                        "Active sheet needs a Rule Name column and month columns (e.g. May 26). Connect Gmail from Alerts first.",
                    variant: "destructive",
                });
                return;
            }
            const labelFilter = options?.monthLabels?.filter(Boolean);
            const monthsToFetch =
                labelFilter && labelFilter.length > 0
                    ? monthGmailRanges.filter((m) => labelFilter.includes(m.label))
                    : monthGmailRanges;
            if (monthsToFetch.length === 0) {
                toast({
                    title: "Unknown month",
                    description: "Pick a month column that exists on this sheet.",
                    variant: "destructive",
                });
                return;
            }
            const idSet = new Set(rowIds);
            const items = activeSheet.rows
                .filter((row) => idSet.has(row.id))
                .map((row) => ({
                    rule_name: (row[ruleNameColumn] ?? "").trim(),
                    row_id: row.id,
                    months: monthsToFetch,
                }))
                .filter((item) => item.rule_name.length > 0);

            if (!items.length) {
                toast({
                    title: "No rules to fetch",
                    description: "Selected rows have no Rule Name value.",
                    variant: "destructive",
                });
                return;
            }

            const monthScopeLabel =
                monthsToFetch.length === monthGmailRanges.length
                    ? `all ${monthsToFetch.length} months`
                    : monthsToFetch.map((m) => m.label).join(", ");

            setFetchingIncidents(true);
            setFetchProgress({ done: 0, total: items.length });
            try {
                let filled = 0;
                // One rule × one month per request — avoids long hangs and "Failed to fetch" when the dev server reloads.
                for (let i = 0; i < items.length; i++) {
                    const item = items[i]!;
                    for (const month of monthsToFetch) {
                        setFetchProgress({
                            done: i,
                            total: items.length,
                            monthLabel: month.label,
                        });
                        const res = await postGmailSiemRuleLatestIncidentsResilient({
                            items: [
                                {
                                    rule_name: item.rule_name,
                                    row_id: item.row_id,
                                    months: [month],
                                },
                            ],
                        });
                        const nextSheets = mergeIncidentResultsIntoSheets(
                            sheetsRef.current,
                            activeSheetIndexRef.current,
                            res.results
                        );
                        commitSheets(nextSheets);
                        await persistFetchProgress();
                        for (const row of res.results) {
                            for (const cell of Object.values(row.by_month)) {
                                if (cell.mapped_id ?? cell.latest_incident_id ?? cell.latest_case_id) {
                                    filled += 1;
                                }
                            }
                        }
                    }
                    setFetchProgress({ done: i + 1, total: items.length });
                }
                toast({
                    title: "Latest incidents fetched",
                    description: `Processed ${items.length} rule(s) for ${monthScopeLabel}. ${filled} month cell(s) have INC/CS; others are marked NA when no matching alert was found.`,
                });
            } catch (e) {
                await persistFetchProgress();
                const msg = e instanceof Error ? e.message : String(e);
                const hint = /failed to fetch|network/i.test(msg)
                    ? " Partial results were saved to the database. Retry to continue, or refresh to load saved rows."
                    : "";
                toast({
                    title: "Gmail fetch failed",
                    description: msg + hint,
                    variant: "destructive",
                });
            } finally {
                setFetchingIncidents(false);
                setFetchingRowId(null);
                setFetchProgress(null);
            }
        },
        [activeSheet, commitSheets, monthGmailRanges, persistFetchProgress, ruleNameColumn, toast]
    );

    const handleFetchAllIncidents = useCallback(
        (monthLabels?: string[]) => {
            if (!activeSheet?.rows.length) return;
            void fetchLatestIncidentsForRowIds(
                activeSheet.rows.map((r) => r.id),
                monthLabels?.length ? { monthLabels } : undefined
            );
        },
        [activeSheet, fetchLatestIncidentsForRowIds]
    );

    const handleFetchRowIncidents = useCallback(
        (rowId: string) => {
            setFetchingRowId(rowId);
            void fetchLatestIncidentsForRowIds([rowId]);
        },
        [fetchLatestIncidentsForRowIds]
    );

    const handleUpdateCell = useCallback(
        (id: string, columnKey: string, value: string) => {
            setSheets((prev) => {
                const next = prev.map((sheet, idx) => {
                    if (idx !== activeSheetIndex) return sheet;
                    return {
                        ...sheet,
                        rows: sheet.rows.map((row) =>
                            row.id === id ? { ...row, [columnKey]: value } : row
                        ),
                    };
                });
                sheetsRef.current = next;
                return next;
            });
            if (
                isMonthColumnHeader(columnKey) &&
                hydrateDoneRef.current &&
                !workbookLoading &&
                !fetchingIncidents
            ) {
                void persistWorkbookNow();
            }
        },
        [activeSheetIndex, workbookLoading, fetchingIncidents, persistWorkbookNow]
    );

    const clearSiemData = useCallback(async () => {
        setSheets([]);
        setActiveSheetIndex(0);
        clearLegacySiemBrowserStorage();
        try {
            await deleteSiemWorkbook();
        } catch (e) {
            console.warn("Failed to clear SIEM workbook on server:", e);
        }
    }, []);

    const handleClearSavedClick = useCallback(() => {
        void clearSiemData().then(() => {
            toast({ title: "Cleared", description: "SIEM workbook removed from the database." });
        });
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
            const normalized = normalizeWorkbookSheets(nextSheets);
            setSheets(normalized);
            setActiveSheetIndex(0);
            const totalRows = normalized.reduce((n, s) => n + s.rows.length, 0);
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
                    <header className="z-10 shrink-0 border-b bg-background/95 px-3 py-1.5">
                        <div className="flex flex-wrap items-center gap-2 justify-between">
                            <div className="min-w-0">
                                <h1 className="text-lg font-semibold text-foreground truncate">SIEM Use case</h1>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                <label>
                                    <input
                                        type="file"
                                        accept=".csv,.xlsx,.xls"
                                        onChange={handleFileInput}
                                        className="hidden"
                                    />
                                    <Button variant="outline" size="sm" className="h-7 px-2 text-xs" asChild>
                                        <span className="cursor-pointer">
                                            <Upload className="mr-1 h-3.5 w-3.5" />
                                            Upload
                                        </span>
                                    </Button>
                                </label>
                                {sheets.length > 0 && (
                                    <>
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-7 px-2 text-xs max-w-[13rem] truncate"
                                                    disabled={
                                                        fetchingIncidents ||
                                                        !ruleNameColumn ||
                                                        monthGmailRanges.length === 0
                                                    }
                                                    title={
                                                        ruleNameColumn
                                                            ? "Search Gmail per rule and month; write INC (or CS fallback) into month columns"
                                                            : "Upload a sheet with a Rule Name column first"
                                                    }
                                                >
                                                    {fetchingIncidents && !fetchingRowId ? (
                                                        <Loader2 className="mr-1 h-3.5 w-3.5 shrink-0 animate-spin" />
                                                    ) : (
                                                        <RefreshCw className="mr-1 h-3.5 w-3.5 shrink-0" />
                                                    )}
                                                    <span className="truncate">
                                                        {fetchProgress && !fetchingRowId
                                                            ? `${fetchProgress.done}/${fetchProgress.total}${
                                                                  fetchProgress.monthLabel
                                                                      ? ` · ${fetchProgress.monthLabel}`
                                                                      : ""
                                                              }`
                                                            : "Fetch incidents"}
                                                    </span>
                                                    {!fetchingIncidents && (
                                                        <ChevronDown className="ml-1 h-3 w-3 shrink-0 opacity-60" />
                                                    )}
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="w-52">
                                                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                                                    All rules on this sheet
                                                </DropdownMenuLabel>
                                                <DropdownMenuItem
                                                    onClick={() => handleFetchAllIncidents()}
                                                    disabled={fetchingIncidents}
                                                >
                                                    All month columns ({monthColumns.length})
                                                </DropdownMenuItem>
                                                {monthColumns.length > 0 && <DropdownMenuSeparator />}
                                                {monthColumns.map((label) => (
                                                    <DropdownMenuItem
                                                        key={label}
                                                        onClick={() => handleFetchAllIncidents([label])}
                                                        disabled={fetchingIncidents}
                                                    >
                                                        {label} only
                                                    </DropdownMenuItem>
                                                ))}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-7 px-2 text-xs"
                                            onClick={handleClearSavedClick}
                                        >
                                            <Trash2 className="mr-1 h-3.5 w-3.5" />
                                            Clear
                                        </Button>
                                    </>
                                )}
                                {saveStatus === "saving" && (
                                    <span className="text-[10px] text-muted-foreground">
                                        {fetchingIncidents ? "Saving to DB…" : "Saving…"}
                                    </span>
                                )}
                                {saveStatus === "saved" && sheets.length > 0 && !fetchingIncidents && (
                                    <span className="text-[10px] text-muted-foreground">Saved</span>
                                )}
                                {fetchingIncidents && saveStatus !== "saving" && saveStatus !== "error" && (
                                    <span
                                        className="text-[10px] text-muted-foreground"
                                        title="Each completed month is written to SQLite — safe to refresh and resume later"
                                    >
                                        Auto-save on
                                    </span>
                                )}
                                {saveStatus === "error" && (
                                    <span
                                        className="text-xs text-destructive max-w-[14rem] truncate"
                                        title={saveErrorDetail ?? "Save failed"}
                                    >
                                        Save failed
                                        {saveErrorDetail ? `: ${saveErrorDetail}` : ""}
                                    </span>
                                )}
                                <ThemeToggle />
                                <NotificationsPanel />
                            </div>
                        </div>
                    </header>

                    {fetchingIncidents && fetchProgress && (
                        <div
                            className="shrink-0 border-b bg-primary/5 px-3 py-2"
                            role="status"
                            aria-live="polite"
                        >
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                                <p className="text-xs font-medium text-foreground">
                                    {fetchingRowId ? "Fetching incidents (single rule)" : "Fetching incidents (all rules)"}
                                    {" · "}
                                    {fetchProgress.done}/{fetchProgress.total} rules
                                    {fetchProgress.monthLabel ? ` · ${fetchProgress.monthLabel}` : ""}
                                </p>
                                <span className="text-[10px] text-muted-foreground">
                                    Auto-save on — safe to refresh and resume
                                </span>
                            </div>
                            <Progress
                                value={
                                    fetchProgress.total > 0
                                        ? Math.round((fetchProgress.done / fetchProgress.total) * 100)
                                        : 0
                                }
                                className="h-1.5"
                            />
                        </div>
                    )}

                    <div className="min-h-0 flex-1 flex flex-col overflow-hidden p-2">
                        {workbookLoading ? (
                            <Card className="border-dashed max-w-2xl mx-auto p-12 text-center">
                                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-muted-foreground" />
                                <p className="text-muted-foreground">Loading workbook from database…</p>
                            </Card>
                        ) : sheets.length === 0 ? (
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
                            <Card className="overflow-hidden border border-border shadow-sm flex flex-col flex-1 min-h-0">
                                <div className="flex items-center gap-1 border-b bg-muted/40 px-1.5 py-0.5 shrink-0 min-h-8">
                                    <div className="flex items-center gap-0 shrink-0">
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6"
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
                                            className="h-6 w-6"
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
                                            className="h-6 w-6"
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
                                            className="h-6 w-6"
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
                                                    className="shrink-0 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-background data-[state=active]:text-primary px-2 py-1 text-xs font-medium h-7"
                                                    title={s.name}
                                                >
                                                    {s.name}
                                                </TabsTrigger>
                                            ))}
                                        </TabsList>
                                    </Tabs>
                                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground whitespace-nowrap pl-2">
                                        {sheets.reduce((n, s) => n + s.rows.length, 0)} rows · {sheets.length} sheets
                                    </span>
                                </div>

                                <CardContent className="p-0 flex-1 min-h-0 flex flex-col overflow-hidden">
                                    {activeSheet && (
                                        <SiemDynamicUseCaseTable
                                            columns={activeSheet.columns}
                                            rows={activeSheet.rows}
                                            onUpdateCell={handleUpdateCell}
                                            ruleNameColumn={ruleNameColumn}
                                            onFetchRowIncidents={
                                                monthGmailRanges.length > 0 && ruleNameColumn
                                                    ? handleFetchRowIncidents
                                                    : undefined
                                            }
                                            fetchingRowId={fetchingRowId}
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
