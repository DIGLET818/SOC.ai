import { useCallback, useState, useEffect } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { SOCSidebar } from "@/components/SOCSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Upload, RefreshCw } from "lucide-react";
import { SiemUseCaseTable } from "@/components/SiemUseCaseTable";
import { SiemUseCase } from "@/types/siemUseCase";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { useToast } from "@/hooks/use-toast";

export default function SiemUseCases() {
    const [useCases, setUseCases] = useState<SiemUseCase[]>([]);
    const [monthColumns, setMonthColumns] = useState<string[]>([]);
    const [isDragging, setIsDragging] = useState(false);
    const { toast } = useToast();

    // Load from localStorage on mount
    useEffect(() => {
        try {
            const savedUseCases = localStorage.getItem("siemUseCases");
            const savedMonthCols = localStorage.getItem("siemMonthColumns");

            if (savedUseCases) {
                const parsedUseCases = JSON.parse(savedUseCases) as SiemUseCase[];
                if (parsedUseCases.length > 0) {
                    setUseCases(parsedUseCases);
                }
            }

            if (savedMonthCols) {
                const parsedMonthCols = JSON.parse(savedMonthCols) as string[];
                if (parsedMonthCols.length > 0) {
                    setMonthColumns(parsedMonthCols);
                }
            }
        } catch (error) {
            console.warn("Failed to load SIEM data from localStorage:", error);
        }
    }, []);

    // Persist useCases to localStorage
    useEffect(() => {
        if (useCases.length > 0) {
            try {
                localStorage.setItem("siemUseCases", JSON.stringify(useCases));
            } catch (error) {
                console.warn("Failed to save SIEM use cases to localStorage:", error);
            }
        } else {
            localStorage.removeItem("siemUseCases");
        }
    }, [useCases]);

    // Persist monthColumns to localStorage
    useEffect(() => {
        if (monthColumns.length > 0) {
            try {
                localStorage.setItem("siemMonthColumns", JSON.stringify(monthColumns));
            } catch (error) {
                console.warn("Failed to save SIEM month columns to localStorage:", error);
            }
        } else {
            localStorage.removeItem("siemMonthColumns");
        }
    }, [monthColumns]);

    // Handle cell updates - THIS IS THE KEY FIX!
    const handleUpdateUseCase = useCallback(
        (id: string, field: keyof SiemUseCase | string, value: string) => {
            setUseCases((prevUseCases) =>
                prevUseCases.map((useCase) => {
                    if (useCase.id !== id) return useCase;

                    // Handle nested monthlyData fields
                    if (field.startsWith("monthlyData.")) {
                        const month = field.replace("monthlyData.", "");
                        return {
                            ...useCase,
                            monthlyData: {
                                ...useCase.monthlyData,
                                [month]: value,
                            },
                        };
                    }

                    // Handle regular fields
                    return {
                        ...useCase,
                        [field]: value,
                    };
                })
            );
        },
        []
    );

    const clearSiemData = useCallback(() => {
        setUseCases([]);
        setMonthColumns([]);
        localStorage.removeItem("siemUseCases");
        localStorage.removeItem("siemMonthColumns");
    }, []);

    const processData = useCallback(
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

            const headers = Object.keys(data[0]);
            const headerMap: Record<string, string> = {};
            headers.forEach((header) => {
                const lower = header.toLowerCase().trim();
                headerMap[lower] = header;
            });

            const now = new Date();
            const monthNames = [
                "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
            ];
            const prev1 = (now.getMonth() - 1 + 12) % 12;
            const prev2 = (now.getMonth() - 2 + 12) % 12;
            const prev3 = (now.getMonth() - 3 + 12) % 12;

            const monthCols = [monthNames[prev3], monthNames[prev2], monthNames[prev1]];
            setMonthColumns(monthCols);

            const parsedUseCases: SiemUseCase[] = data.map((row, index) => {
                const monthlyData: Record<string, string> = {};
                monthCols.forEach((month) => {
                    const value = row[month];
                    monthlyData[month] = value || "-";
                });

                return {
                    id: `${index}-${Date.now()}`,
                    ruleName:
                        row[headerMap["rule name"]] || row[headerMap["rulename"]] || "",
                    pbSeverity:
                        row[headerMap["pb-severity"]] ||
                        row[headerMap["pbseverity"]] ||
                        row[headerMap["severity"]] ||
                        "",
                    ruleCondition:
                        row[headerMap["rule condition"]] ||
                        row[headerMap["rulecondition"]] ||
                        row[headerMap["condition"]] ||
                        "",
                    logSource:
                        row[headerMap["log source"]] ||
                        row[headerMap["logsource"]] ||
                        row[headerMap["source"]] ||
                        "",
                    team: row[headerMap["team"]] || "",
                    alertReceived:
                        row[headerMap["alert received"]] ||
                        row[headerMap["alertreceived"]] ||
                        "",
                    remarks: row[headerMap["remarks"]] || row[headerMap["remark"]] || "",
                    monthlyData,
                };
            });

            setUseCases(parsedUseCases);
            toast({
                title: "File Uploaded Successfully",
                description: `Loaded ${parsedUseCases.length} use cases`,
            });
        },
        [clearSiemData, toast]
    );

    const parseFile = useCallback(
        (file: File) => {
            const fileExtension = file.name.split(".").pop()?.toLowerCase();

            if (fileExtension === "csv") {
                Papa.parse(file, {
                    header: true,
                    skipEmptyLines: true,
                    complete: (results) => {
                        processData(results.data as Record<string, string>[]);
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
                        const data = new Uint8Array(e.target?.result as ArrayBuffer);
                        const workbook = XLSX.read(data, { type: "array" });
                        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                        const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

                        const headers = jsonData[0] as string[];
                        const rows = jsonData.slice(1) as (string | number | null)[][];

                        const objects = rows.map((row) => {
                            const obj: Record<string, string> = {};
                            headers.forEach((header, index) => {
                                obj[header] = row[index]?.toString() || "";
                            });
                            return obj;
                        });

                        processData(objects);
                    } catch (error) {
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
        [processData, toast]
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

    return (
        <SidebarProvider>
            <div
                className={`flex min-h-screen w-full ${isDragging ? "bg-primary/5" : ""}`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
            >
                <SOCSidebar />
                <main className="flex flex-1 flex-col overflow-hidden">
                    {/* Header */}
                    <header className="flex items-center justify-between border-b px-4 py-2">
                        <div className="flex items-center gap-4">
                            <h1 className="text-xl font-semibold">SIEM Use Cases</h1>

                            {/* Upload section */}
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <span>Drop file or</span>
                                <label>
                                    <input
                                        type="file"
                                        accept=".csv,.xlsx,.xls"
                                        onChange={handleFileInput}
                                        className="hidden"
                                    />
                                    <Button variant="ghost" size="sm" asChild>
                                        <span className="cursor-pointer">
                                            <Upload className="mr-1 h-4 w-4" />
                                            Upload
                                        </span>
                                    </Button>
                                </label>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => console.log("Fetch all incidents")}
                                >
                                    <RefreshCw className="mr-1 h-4 w-4" />
                                    Fetch
                                </Button>
                            </div>
                        </div>
                        <ThemeToggle />
                    </header>

                    {/* Table */}
                    <div className="flex-1 overflow-hidden p-4">
                        <SiemUseCaseTable
                            useCases={useCases}
                            monthColumns={monthColumns}
                            onUpdateUseCase={handleUpdateUseCase}
                        />
                    </div>
                </main>
            </div>
        </SidebarProvider>
    );
}
