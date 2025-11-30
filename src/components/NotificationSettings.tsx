import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function NotificationSettings() {
  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle>Notification Preferences</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="high-severity">High Severity Alert Notifications</Label>
            <p className="text-sm text-muted-foreground">
              Get notified immediately when high or critical alerts are detected
            </p>
          </div>
          <Switch id="high-severity" defaultChecked />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="ioc-change">IOC Reputation Changes</Label>
            <p className="text-sm text-muted-foreground">
              Notify when IOC reputation scores change significantly
            </p>
          </div>
          <Switch id="ioc-change" defaultChecked />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="weekly-summary">Weekly SOC Summary Email</Label>
            <p className="text-sm text-muted-foreground">
              Receive a weekly summary of SOC metrics and incidents
            </p>
          </div>
          <Switch id="weekly-summary" defaultChecked />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="ai-findings">AI-Detected Anomalies</Label>
            <p className="text-sm text-muted-foreground">
              Get alerts when AI detects unusual patterns or anomalies
            </p>
          </div>
          <Switch id="ai-findings" defaultChecked />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="case-updates">Case Status Updates</Label>
            <p className="text-sm text-muted-foreground">
              Notify when assigned cases are updated or closed
            </p>
          </div>
          <Switch id="case-updates" />
        </div>
      </CardContent>
    </Card>
  );
}
