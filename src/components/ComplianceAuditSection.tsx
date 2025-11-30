import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";

const cisControls = [
  { control: "CIS 1: Inventory of Devices", coverage: 92 },
  { control: "CIS 6: Access Control", coverage: 87 },
  { control: "CIS 8: Audit Logs", coverage: 95 },
  { control: "CIS 12: Network Security", coverage: 78 },
  { control: "CIS 16: Security Awareness", coverage: 84 },
];

const mitreMatrix = [
  { tactic: "Initial Access", coverage: 85, techniques: 12 },
  { tactic: "Execution", coverage: 78, techniques: 15 },
  { tactic: "Persistence", coverage: 92, techniques: 18 },
  { tactic: "Credential Access", coverage: 88, techniques: 10 },
  { tactic: "Lateral Movement", coverage: 75, techniques: 9 },
];

export function ComplianceAuditSection() {
  return (
    <div className="space-y-6">
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>CIS Control Coverage</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {cisControls.map((item) => (
              <div key={item.control} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{item.control}</span>
                  <Badge variant="outline">{item.coverage}%</Badge>
                </div>
                <Progress value={item.coverage} className="h-2" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>MITRE ATT&CK Detection Matrix</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {mitreMatrix.map((item) => (
              <div key={item.tactic} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium">{item.tactic}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      ({item.techniques} techniques)
                    </span>
                  </div>
                  <Badge
                    variant={item.coverage >= 85 ? "default" : "secondary"}
                  >
                    {item.coverage}%
                  </Badge>
                </div>
                <Progress value={item.coverage} className="h-2" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
