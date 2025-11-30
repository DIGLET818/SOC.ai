import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Download, Mail } from "lucide-react";
import { toast } from "sonner";

export function ReportsExportOptions() {
  const handleExport = (format: string) => {
    toast.success(`Exporting report in ${format} format...`);
  };

  return (
    <Card className="shadow-lg">
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Export Reports</h3>
            <p className="text-sm text-muted-foreground">Download or share SOC analytics reports</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => handleExport("PDF")}>
              <FileText className="h-4 w-4 mr-2" />
              Export PDF
            </Button>
            <Button variant="outline" onClick={() => handleExport("CSV")}>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
            <Button variant="outline" onClick={() => handleExport("Email")}>
              <Mail className="h-4 w-4 mr-2" />
              Weekly Summary
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
