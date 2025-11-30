import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle } from "lucide-react";

const iocs = [
  { type: "IP", value: "185.220.101.42", threat: "C2 Server", severity: "critical", detections: 234 },
  { type: "Domain", value: "malicious-site.xyz", threat: "Phishing", severity: "high", detections: 189 },
  { type: "Hash", value: "a3f5d9e8b2c1...", threat: "Ransomware", severity: "critical", detections: 456 },
  { type: "IP", value: "45.142.120.58", threat: "Scanner", severity: "medium", detections: 112 },
  { type: "Domain", value: "fake-login.net", threat: "Credential Theft", severity: "high", detections: 298 },
];

export function TopMaliciousIOCs() {
  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          Top Malicious IOCs (24h)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>IOC Value</TableHead>
              <TableHead>Threat</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Detections</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {iocs.map((ioc, index) => (
              <TableRow key={index}>
                <TableCell>
                  <Badge variant="outline">{ioc.type}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{ioc.value}</TableCell>
                <TableCell>{ioc.threat}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      ioc.severity === "critical"
                        ? "destructive"
                        : ioc.severity === "high"
                        ? "secondary"
                        : "outline"
                    }
                  >
                    {ioc.severity}
                  </Badge>
                </TableCell>
                <TableCell className="font-semibold">{ioc.detections}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
