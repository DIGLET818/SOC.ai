import { useState, useCallback } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { SOCSidebar } from "@/components/SOCSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, FileSpreadsheet } from "lucide-react";
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

  const parseFile = useCallback((file: File) => {
    const fileExtension = file.name.split(".").pop()?.toLowerCase();

    if (fileExtension === "csv") {
      // Parse CSV using papaparse
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
      // Parse Excel using xlsx
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
          
          // Convert to objects with headers
          const headers = jsonData[0] as string[];
          const rows = jsonData.slice(1) as any[][];
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
  }, [toast]);

  const processData = (data: Record<string, string>[]) => {
    if (data.length === 0) {
      toast({
        title: "Empty File",
        description: "The uploaded file contains no data",
        variant: "destructive",
      });
      return;
    }

    // Get all headers
    const headers = Object.keys(data[0]);
    
    // Map headers (case-insensitive)
    const headerMap: Record<string, string> = {};
    headers.forEach((header) => {
      const lower = header.toLowerCase().trim();
      headerMap[lower] = header;
    });

    // Identify month columns (anything that looks like a date or month)
    const monthCols = headers.filter((header) => {
      const lower = header.toLowerCase();
      return (
        /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(lower) ||
        /\d{2}/.test(lower)
      );
    });

    setMonthColumns(monthCols);

    // Parse use cases
    const parsedUseCases: SiemUseCase[] = data.map((row, index) => {
      const monthlyData: Record<string, string | number> = {};
      monthCols.forEach((month) => {
        const value = row[month];
        monthlyData[month] = value || "-";
      });

      return {
        id: `${index}-${Date.now()}`,
        ruleName: row[headerMap["rule name"]] || row[headerMap["rulename"]] || "",
        pbSeverity: row[headerMap["pb-severity"]] || row[headerMap["pbseverity"]] || row[headerMap["severity"]] || "",
        ruleCondition: row[headerMap["rule condition"]] || row[headerMap["rulecondition"]] || row[headerMap["condition"]] || "",
        logSource: row[headerMap["log source"]] || row[headerMap["logsource"]] || row[headerMap["source"]] || "",
        team: row[headerMap["team"]] || "",
        latestIncident: row[headerMap["latest incident"]] || row[headerMap["latestincident"]] || "",
        alertReceived: row[headerMap["alert received"]] || row[headerMap["alertreceived"]] || "",
        remarks: row[headerMap["remarks"]] || row[headerMap["remark"]] || "",
        monthlyData,
      };
    });

    setUseCases(parsedUseCases);
    toast({
      title: "File Uploaded Successfully",
      description: `Loaded ${parsedUseCases.length} use cases`,
    });
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      parseFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      parseFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <SOCSidebar />
        <main className="flex-1 overflow-auto">
          {/* Header */}
          <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex h-16 items-center justify-between px-6">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">SIEM Use Cases</h1>
                <p className="text-sm text-muted-foreground">
                  Upload and manage your SIEM detection use cases
                </p>
              </div>
              <ThemeToggle />
            </div>
          </header>

          <div className="p-6 space-y-6">
            {/* Upload Card */}
            <Card>
              <CardHeader>
                <CardTitle>Upload Use Cases</CardTitle>
                <CardDescription>
                  Upload a CSV or Excel file containing your SIEM use cases
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                    isDragging
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <FileSpreadsheet className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-sm text-muted-foreground mb-4">
                    Drag and drop your file here, or click to browse
                  </p>
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={handleFileInput}
                    className="hidden"
                    id="file-upload"
                  />
                  <label htmlFor="file-upload">
                    <Button asChild>
                      <span>
                        <Upload className="mr-2 h-4 w-4" />
                        Upload Excel/CSV
                      </span>
                    </Button>
                  </label>
                  <p className="text-xs text-muted-foreground mt-3">
                    Supported formats: .csv, .xlsx, .xls
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Use Cases Table */}
            <SiemUseCaseTable useCases={useCases} monthColumns={monthColumns} />
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
