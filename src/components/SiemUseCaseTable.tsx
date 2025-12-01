import { useState, useMemo } from "react";
import { SiemUseCase } from "@/types/siemUseCase";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Search } from "lucide-react";

interface SiemUseCaseTableProps {
  useCases: SiemUseCase[];
  monthColumns: string[];
}

export function SiemUseCaseTable({ useCases, monthColumns }: SiemUseCaseTableProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [logSourceFilter, setLogSourceFilter] = useState("all");

  // Extract unique values for filters
  const uniqueSeverities = useMemo(() => {
    const severities = new Set(useCases.map((uc) => uc.pbSeverity));
    return Array.from(severities).sort();
  }, [useCases]);

  const uniqueLogSources = useMemo(() => {
    const sources = new Set(useCases.map((uc) => uc.logSource));
    return Array.from(sources).sort();
  }, [useCases]);

  // Apply filters
  const filteredUseCases = useMemo(() => {
    return useCases.filter((useCase) => {
      const matchesSearch = useCase.ruleName
        .toLowerCase()
        .includes(searchTerm.toLowerCase());
      const matchesSeverity =
        severityFilter === "all" || useCase.pbSeverity === severityFilter;
      const matchesLogSource =
        logSourceFilter === "all" || useCase.logSource === logSourceFilter;
      return matchesSearch && matchesSeverity && matchesLogSource;
    });
  }, [useCases, searchTerm, severityFilter, logSourceFilter]);

  const getSeverityColor = (severity: string) => {
    const s = severity.toLowerCase();
    if (s === "high" || s === "critical") return "destructive";
    if (s === "medium") return "default";
    return "secondary";
  };

  if (useCases.length === 0) {
    return (
      <Card className="p-12 text-center">
        <p className="text-muted-foreground text-lg">
          Upload a SIEM use case spreadsheet to get started
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by rule name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          <div className="w-[180px]">
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severities</SelectItem>
                {uniqueSeverities.map((severity) => (
                  <SelectItem key={severity} value={severity}>
                    {severity}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-[180px]">
            <Select value={logSourceFilter} onValueChange={setLogSourceFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Log Source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                {uniqueLogSources.map((source) => (
                  <SelectItem key={source} value={source}>
                    {source}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="text-sm text-muted-foreground">
            Rows: {filteredUseCases.length}
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-card z-10 min-w-[200px]">
                  Rule Name
                </TableHead>
                <TableHead>PB-Severity</TableHead>
                <TableHead className="min-w-[200px]">Rule Condition</TableHead>
                <TableHead>Log Source</TableHead>
                <TableHead>Team</TableHead>
                <TableHead>Latest Incident</TableHead>
                <TableHead>Alert Received</TableHead>
                <TableHead className="min-w-[150px]">Remarks</TableHead>
                {monthColumns.map((month) => (
                  <TableHead key={month} className="text-center min-w-[100px]">
                    {month}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUseCases.map((useCase) => (
                <TableRow key={useCase.id} className="hover:bg-muted/50">
                  <TableCell className="sticky left-0 bg-card z-10 font-medium">
                    {useCase.ruleName}
                  </TableCell>
                  <TableCell>
                    <Badge variant={getSeverityColor(useCase.pbSeverity)}>
                      {useCase.pbSeverity}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{useCase.ruleCondition}</TableCell>
                  <TableCell>{useCase.logSource}</TableCell>
                  <TableCell>{useCase.team}</TableCell>
                  <TableCell>{useCase.latestIncident}</TableCell>
                  <TableCell>{useCase.alertReceived}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {useCase.remarks}
                  </TableCell>
                  {monthColumns.map((month) => (
                    <TableCell key={month} className="text-center">
                      {useCase.monthlyData[month] || "-"}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
