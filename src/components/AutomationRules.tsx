import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

const automationRules = [
  {
    id: 1,
    condition: "High Severity + External IP",
    action: "Auto-block IP",
    enabled: true,
  },
  {
    id: 2,
    condition: "Brute Force (5+ attempts)",
    action: "Lock User Account",
    enabled: true,
  },
  {
    id: 3,
    condition: "VirusTotal Score > 80",
    action: "Auto-escalate to Incident",
    enabled: true,
  },
];

export function AutomationRules() {
  const handleAddRule = () => {
    toast.success("Add rule dialog would open here");
  };

  const handleDeleteRule = (id: number) => {
    toast.error(`Rule ${id} deleted`);
  };

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Automation Rules</CardTitle>
          <Button onClick={handleAddRule}>
            <Plus className="h-4 w-4 mr-2" />
            Add Rule
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {automationRules.map((rule) => (
          <Card key={rule.id} className="bg-muted/30">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={rule.enabled ? "default" : "secondary"}>
                      {rule.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Condition</p>
                      <p className="text-sm font-medium">{rule.condition}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Action</p>
                      <p className="text-sm font-medium">{rule.action}</p>
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDeleteRule(rule.id)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}

        <Card className="bg-muted/30 border-dashed">
          <CardContent className="pt-6">
            <div className="space-y-4">
              <h4 className="text-sm font-semibold">Create New Rule</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Select>
                  <SelectTrigger>
                    <SelectValue placeholder="Select condition" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="severity">Severity Level</SelectItem>
                    <SelectItem value="ip-type">IP Type</SelectItem>
                    <SelectItem value="brute-force">Brute Force</SelectItem>
                    <SelectItem value="vt-score">VT Score</SelectItem>
                  </SelectContent>
                </Select>

                <Select>
                  <SelectTrigger>
                    <SelectValue placeholder="Select operator" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="equals">Equals</SelectItem>
                    <SelectItem value="greater">Greater than</SelectItem>
                    <SelectItem value="less">Less than</SelectItem>
                  </SelectContent>
                </Select>

                <Select>
                  <SelectTrigger>
                    <SelectValue placeholder="Select action" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="block-ip">Block IP</SelectItem>
                    <SelectItem value="lock-account">Lock Account</SelectItem>
                    <SelectItem value="escalate">Escalate to Incident</SelectItem>
                    <SelectItem value="notify">Send Notification</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" className="w-full">Create Rule</Button>
            </div>
          </CardContent>
        </Card>
      </CardContent>
    </Card>
  );
}
