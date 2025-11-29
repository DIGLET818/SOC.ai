import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { SeverityBadge } from "./SeverityBadge";
import { StatusBadge } from "./StatusBadge";
import { Alert } from "@/types/alert";
import { Network } from "lucide-react";

interface AlertsTableProps {
  alerts: Alert[];
  onAlertClick: (alert: Alert) => void;
}

export function AlertsTable({ alerts, onAlertClick }: AlertsTableProps) {
  return (
    <div className="rounded-lg border border-border overflow-hidden shadow-sm">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50 hover:bg-muted/50">
            <TableHead className="font-semibold text-foreground">Alert ID</TableHead>
            <TableHead className="font-semibold text-foreground">Timestamp</TableHead>
            <TableHead className="font-semibold text-foreground">Rule Name</TableHead>
            <TableHead className="font-semibold text-foreground">Source IP / User</TableHead>
            <TableHead className="font-semibold text-foreground">Severity</TableHead>
            <TableHead className="font-semibold text-foreground">AI Score</TableHead>
            <TableHead className="font-semibold text-foreground">Status</TableHead>
            <TableHead className="font-semibold text-foreground">Correlation</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {alerts.map((alert) => (
            <TableRow
              key={alert.id}
              className="cursor-pointer hover:bg-muted/30 transition-all"
              onClick={() => onAlertClick(alert)}
            >
              <TableCell className="font-mono text-primary font-medium">{alert.id}</TableCell>
              <TableCell className="text-muted-foreground text-sm">{alert.timestamp}</TableCell>
              <TableCell>
                <div className="font-medium">{alert.ruleName}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  <Badge variant="outline" className="text-xs mr-1">
                    {alert.ruleCategory}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {alert.mitreId}
                  </Badge>
                </div>
              </TableCell>
              <TableCell>
                <div className="font-mono text-sm">{alert.sourceIp}</div>
                {alert.sourceUser && <div className="text-xs text-muted-foreground">{alert.sourceUser}</div>}
                <div className="text-xs text-muted-foreground mt-1">{alert.sourceCountry}</div>
              </TableCell>
              <TableCell>
                <SeverityBadge severity={alert.severity} />
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-foreground">{alert.aiScore}</span>
                  <div className="h-2 w-20 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        alert.aiScore >= 80
                          ? "bg-severity-high"
                          : alert.aiScore >= 60
                          ? "bg-severity-medium"
                          : "bg-severity-low"
                      }`}
                      style={{ width: `${alert.aiScore}%` }}
                    />
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <StatusBadge status={alert.status} />
              </TableCell>
              <TableCell>
                {alert.relatedAlerts ? (
                  <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                    <Network className="h-3 w-3 mr-1" />
                    {alert.relatedAlerts} related
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">Standalone</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

