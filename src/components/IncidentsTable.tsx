import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { mockCases } from "@/data/mockCases";
import { Case } from "@/types/case";
import { SeverityBadge } from "./SeverityBadge";
import { StatusBadge } from "./StatusBadge";

interface IncidentsTableProps {
  severity: string;
  status: string;
  assignedAnalyst: string;
  mitreTactic: string;
  dateRange: { from: Date | undefined; to: Date | undefined };
  onIncidentClick: (incident: Case) => void;
}

export function IncidentsTable({
  severity,
  status,
  assignedAnalyst,
  mitreTactic,
  dateRange,
  onIncidentClick,
}: IncidentsTableProps) {
  const filteredCases = mockCases.filter((incident) => {
    if (severity !== "all" && incident.priority !== severity) return false;
    if (status !== "all" && incident.status !== status) return false;
    if (assignedAnalyst !== "all" && incident.assignedAnalyst !== assignedAnalyst) return false;
    
    if (dateRange.from || dateRange.to) {
      const incidentDate = new Date(incident.createdAt);
      if (dateRange.from && incidentDate < dateRange.from) return false;
      if (dateRange.to && incidentDate > dateRange.to) return false;
    }
    
    return true;
  });

  return (
    <Card className="shadow-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Case ID</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Severity</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Assigned Analyst</TableHead>
            <TableHead>AI Priority</TableHead>
            <TableHead>Last Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredCases.map((incident) => (
            <TableRow
              key={incident.id}
              onClick={() => onIncidentClick(incident)}
              className="cursor-pointer hover:bg-muted/50 transition-colors"
            >
              <TableCell className="font-mono text-xs">{incident.id}</TableCell>
              <TableCell className="font-medium">{incident.title}</TableCell>
              <TableCell>
                <SeverityBadge severity={incident.priority} />
              </TableCell>
              <TableCell>
                <StatusBadge status={incident.status} />
              </TableCell>
              <TableCell>{incident.assignedAnalyst}</TableCell>
              <TableCell>
                <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                  {Math.floor(Math.random() * 30) + 70}/100
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {new Date(incident.updatedAt).toLocaleString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
