import * as XLSX from "xlsx";

export type ParsedReportSpreadsheet = {
  filename: string;
  headers: string[];
  rows: Record<string, string>[];
};

/** Parse PB Daily / Weekly style .csv, .xlsx, or .xls (first sheet). */
export function parseReportSpreadsheetFile(file: File): Promise<ParsedReportSpreadsheet> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext !== "csv" && ext !== "xlsx" && ext !== "xls") {
    return Promise.reject(new Error("Please choose a .csv, .xlsx, or .xls file."));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file from disk."));
    reader.onload = () => {
      try {
        const wb =
          ext === "csv"
            ? XLSX.read(reader.result as string, { type: "string" })
            : XLSX.read(reader.result as ArrayBuffer, { type: "array" });

        const sheetName = wb.SheetNames[0];
        if (!sheetName) {
          reject(new Error("The file has no worksheet."));
          return;
        }
        const sheet = wb.Sheets[sheetName];
        const grid = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          defval: "",
          raw: false,
        }) as (string | number | null)[][];

        const nonEmpty = grid.filter((row) =>
          row.some((cell) => String(cell ?? "").trim() !== "")
        );
        if (nonEmpty.length < 2) {
          reject(new Error("The file has no data rows (need a header row plus at least one alert)."));
          return;
        }

        const headers = nonEmpty[0].map((h, i) => String(h ?? "").trim() || `Col${i}`);
        const rows = nonEmpty.slice(1).map((row) => {
          const obj: Record<string, string> = {};
          headers.forEach((h, i) => {
            obj[h] = i < row.length ? String(row[i] ?? "").trim() : "";
          });
          return obj;
        });

        resolve({ filename: file.name, headers, rows });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };

    if (ext === "csv") reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  });
}
