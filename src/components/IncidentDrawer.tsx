import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/types/alert";
import { SeverityBadge } from "./SeverityBadge";
import { StatusBadge } from "./StatusBadge";
import {
  Shield,
  CheckCircle,
  Ban,
  UserX,
  XCircle,
  Brain,
  Target,
  Globe,
  Server,
  AlertTriangle,
  Activity,
  Network,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface IncidentDrawerProps {
  alert: Alert | null;
  open: boolean;
  onClose: () => void;
}

export function IncidentDrawer({ alert, open, onClose }: IncidentDrawerProps) {
  if (!alert) return null;

  const handleAction = (action: string) => {
    toast({
      title: "Action Initiated",
      description: `${action} for alert ${alert.id}`,
    });
  };

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-3xl overflow-y-auto" side="right">
        <SheetHeader>
          <SheetTitle className="text-2xl flex items-center gap-3">
            <Shield className="h-6 w-6 text-primary" />
            Incident Details: {alert.id}
          </SheetTitle>
          <div className="flex items-center gap-3 pt-2 flex-wrap">
            <SeverityBadge severity={alert.severity} />
            <StatusBadge status={alert.status} />
            <span className="text-sm text-muted-foreground">{alert.timestamp}</span>
            {alert.relatedAlerts && (
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">
                {alert.relatedAlerts} Related Alerts
              </Badge>
            )}
            {alert.campaignId && (
              <Badge variant="outline" className="bg-severity-high/10 text-severity-high border-severity-high/30">
                Campaign: {alert.campaignId}
              </Badge>
            )}
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Rule Name & Category */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-2">Rule Information</h3>
            <p className="text-lg font-medium mb-2">{alert.ruleName}</p>
            <div className="flex gap-2">
              <Badge variant="secondary">{alert.ruleCategory}</Badge>
              <Badge variant="outline">{alert.mitreTactic}</Badge>
              <Badge variant="outline" className="font-mono">
                {alert.mitreId}
              </Badge>
            </div>
          </div>

          {/* Source Information */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-2">Source Information</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-muted/30 p-3 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">IP Address</p>
                <p className="font-mono text-sm">{alert.sourceIp}</p>
              </div>
              <div className="bg-muted/30 p-3 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">Country</p>
                <p className="text-sm">{alert.sourceCountry}</p>
              </div>
              {alert.sourceUser && (
                <div className="bg-muted/30 p-3 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">User</p>
                  <p className="text-sm">{alert.sourceUser}</p>
                </div>
              )}
            </div>
          </div>

          {/* AI Threat Score */}
          <div className="bg-gradient-to-r from-primary/10 to-accent/10 p-4 rounded-lg border border-primary/20">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Brain className="h-4 w-4 text-primary" />
                AI Threat Score
              </h3>
              <span className="text-3xl font-bold text-primary">{alert.aiScore}</span>
            </div>
            <div className="h-3 bg-muted/50 rounded-full overflow-hidden">
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

          <Separator />

          {/* AI Summary */}
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Brain className="h-5 w-5 text-primary" />
                AI Incident Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed text-foreground">{alert.aiSummary}</p>
            </CardContent>
          </Card>

          {/* Recommended Actions */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
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

          {/* Host Context */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Server className="h-5 w-5 text-primary" />
                Host Context & Asset Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Hostname</p>
                  <p className="text-sm font-mono">{alert.hostContext.hostname}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Criticality</p>
                  <Badge
                    variant="outline"
                    className={
                      alert.hostContext.criticality === "critical"
                        ? "bg-severity-high/20 text-severity-high border-severity-high/30"
                        : alert.hostContext.criticality === "high"
                        ? "bg-severity-medium/20 text-severity-medium border-severity-medium/30"
                        : "bg-muted text-muted-foreground"
                    }
                  >
                    {alert.hostContext.criticality.toUpperCase()}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Asset Owner</p>
                  <p className="text-sm">{alert.hostContext.assetOwner}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Operating System</p>
                  <p className="text-sm">{alert.hostContext.os}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">EDR Status</p>
                  <Badge
                    variant="outline"
                    className={
                      alert.hostContext.edrStatus === "active"
                        ? "bg-severity-info/20 text-severity-info border-severity-info/30"
                        : alert.hostContext.edrStatus === "degraded"
                        ? "bg-severity-medium/20 text-severity-medium border-severity-medium/30"
                        : "bg-muted text-muted-foreground"
                    }
                  >
                    {alert.hostContext.edrStatus.toUpperCase()}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* IOC Enrichment */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Globe className="h-5 w-5 text-primary" />
                IOC Enrichment & Threat Intelligence
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-muted/30 p-3 rounded-lg">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">VirusTotal</p>
                  <p className="text-sm">{alert.iocEnrichment.virusTotal}</p>
                </div>
                <div className="bg-muted/30 p-3 rounded-lg">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">Reputation Score</p>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold">{alert.iocEnrichment.reputation}/100</span>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full ${
                          alert.iocEnrichment.reputation < 30
                            ? "bg-severity-high"
                            : alert.iocEnrichment.reputation < 70
                            ? "bg-severity-medium"
                            : "bg-severity-info"
                        }`}
                        style={{ width: `${alert.iocEnrichment.reputation}%` }}
                      />
                    </div>
                  </div>
                </div>
                <div className="bg-muted/30 p-3 rounded-lg">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">GeoIP Location</p>
                  <p className="text-sm">{alert.iocEnrichment.geoIP}</p>
                </div>
                <div className="bg-muted/30 p-3 rounded-lg">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">ASN</p>
                  <p className="text-sm font-mono">{alert.iocEnrichment.asn}</p>
                </div>
                <div className="bg-muted/30 p-3 rounded-lg col-span-2">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">GreyNoise Intelligence</p>
                  <p className="text-sm">{alert.iocEnrichment.greyNoise}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Attack Timeline */}
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-5 w-5 text-primary" />
                Attack Timeline with MITRE ATT&CK
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {alert.timeline.map((event, idx) => (
                  <div key={idx} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="h-3 w-3 rounded-full bg-primary border-2 border-background shadow-lg" />
                      {idx < alert.timeline.length - 1 && <div className="w-0.5 h-full bg-border mt-1" />}
                    </div>
                    <div className="flex-1 pb-4">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-xs text-muted-foreground font-mono bg-muted/30 px-2 py-1 rounded">
                          {event.timestamp}
                        </p>
                        <Badge variant="outline" className="text-xs">
                          {alert.mitreTactic}
                        </Badge>
                      </div>
                      <p className="text-sm">{event.event}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-3 pt-4 pb-6">
            <Button onClick={() => handleAction("Approved actions")} className="w-full shadow-md hover:shadow-lg transition-all">
              <CheckCircle className="mr-2 h-4 w-4" />
              Approve Actions
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleAction("Blocked IP")}
              className="w-full shadow-md hover:shadow-lg transition-all"
            >
              <Ban className="mr-2 h-4 w-4" />
              Block IP
            </Button>
            <Button
              variant="outline"
              onClick={() => handleAction("Disabled user account")}
              className="w-full hover:bg-destructive/10 hover:border-destructive transition-all"
            >
              <UserX className="mr-2 h-4 w-4" />
              Disable User
            </Button>
            <Button
              variant="outline"
              onClick={() => handleAction("Isolated endpoint")}
              className="w-full hover:bg-severity-high/10 hover:border-severity-high transition-all"
            >
              <Network className="mr-2 h-4 w-4" />
              Isolate Endpoint
            </Button>
            <Button
              variant="outline"
              onClick={() => handleAction("Created case")}
              className="w-full hover:bg-primary/10 hover:border-primary transition-all"
            >
              <AlertTriangle className="mr-2 h-4 w-4" />
              Create Case
            </Button>
            <Button
              variant="secondary"
              onClick={() => handleAction("Marked as resolved")}
              className="w-full hover:bg-severity-info/20 transition-all"
            >
              <XCircle className="mr-2 h-4 w-4" />
              Close Alert
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
