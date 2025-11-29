import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Alert } from "@/types/alert";
import { SeverityBadge } from "./SeverityBadge";
import { StatusBadge } from "./StatusBadge";
import { Shield, CheckCircle, Ban, UserX, XCircle, Brain, Target, Globe } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface AlertDetailPanelProps {
  alert: Alert | null;
  open: boolean;
  onClose: () => void;
}

export function AlertDetailPanel({ alert, open, onClose }: AlertDetailPanelProps) {
  if (!alert) return null;

  const handleAction = (action: string) => {
    toast({
      title: "Action Initiated",
      description: `${action} for alert ${alert.id}`,
    });
  };

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-2xl flex items-center gap-3">
            <Shield className="h-6 w-6 text-primary" />
            {alert.id}
          </SheetTitle>
          <SheetDescription className="flex items-center gap-3 pt-2">
            <SeverityBadge severity={alert.severity} />
            <StatusBadge status={alert.status} />
            <span className="text-sm text-muted-foreground">{alert.timestamp}</span>
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Rule Name */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-1">Rule Name</h3>
            <p className="text-lg font-medium">{alert.ruleName}</p>
          </div>

          {/* Source Information */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-1">Source Information</h3>
            <div className="flex items-center gap-4">
              <span className="font-mono text-sm bg-muted px-3 py-1 rounded">{alert.sourceIp}</span>
              {alert.sourceUser && (
                <span className="text-sm bg-muted px-3 py-1 rounded">{alert.sourceUser}</span>
              )}
            </div>
          </div>

          {/* AI Score */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-2">AI Threat Score</h3>
            <div className="flex items-center gap-3">
              <span className="text-3xl font-bold">{alert.aiScore}</span>
              <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full ${
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
          </div>

          <Separator />

          {/* AI Summary */}
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Brain className="h-5 w-5 text-primary" />
                AI Analysis Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed">{alert.aiSummary}</p>
            </CardContent>
          </Card>

          {/* Recommended Actions */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                Recommended Actions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {alert.recommendedActions.map((action, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <CheckCircle className="h-4 w-4 text-severity-info mt-0.5 flex-shrink-0" />
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* IOC Enrichment */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Globe className="h-5 w-5 text-primary" />
                IOC Enrichment
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground mb-1">VirusTotal</h4>
                <p className="text-sm">{alert.iocEnrichment.virusTotal}</p>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground mb-1">GeoIP</h4>
                <p className="text-sm">{alert.iocEnrichment.geoIP}</p>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground mb-1">GreyNoise</h4>
                <p className="text-sm">{alert.iocEnrichment.greyNoise}</p>
              </div>
            </CardContent>
          </Card>

          {/* Evidence Timeline */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-lg">Evidence Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {alert.timeline.map((event, idx) => (
                  <div key={idx} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="h-2 w-2 rounded-full bg-primary" />
                      {idx < alert.timeline.length - 1 && <div className="w-0.5 h-full bg-border" />}
                    </div>
                    <div className="flex-1 pb-4">
                      <p className="text-xs text-muted-foreground font-mono">{event.timestamp}</p>
                      <p className="text-sm mt-1">{event.event}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3 pt-4">
            <Button onClick={() => handleAction("Approved actions")} className="flex-1">
              <CheckCircle className="mr-2 h-4 w-4" />
              Approve Action
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleAction("Blocked IP")}
              className="flex-1"
            >
              <Ban className="mr-2 h-4 w-4" />
              Block IP
            </Button>
            <Button
              variant="outline"
              onClick={() => handleAction("Disabled user account")}
              className="flex-1"
            >
              <UserX className="mr-2 h-4 w-4" />
              Disable User
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleAction("Closed incident")}
              className="w-full"
            >
              <XCircle className="mr-2 h-4 w-4" />
              Close Incident
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
