import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Upload, UserPlus, FileText, Play, X } from "lucide-react";
import { Case } from "@/types/case";
import { SeverityBadge } from "./SeverityBadge";
import { StatusBadge } from "./StatusBadge";

interface IncidentDetailViewProps {
  incident: Case;
  onBack: () => void;
}

export function IncidentDetailView({ incident, onBack }: IncidentDetailViewProps) {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Incidents
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <UserPlus className="h-4 w-4 mr-2" />
            Assign Analyst
          </Button>
          <Button variant="outline" size="sm">
            <FileText className="h-4 w-4 mr-2" />
            Add Note
          </Button>
          <Button variant="outline" size="sm">
            <Upload className="h-4 w-4 mr-2" />
            Upload Evidence
          </Button>
          <Button variant="outline" size="sm">
            <Play className="h-4 w-4 mr-2" />
            Run Playbook
          </Button>
          <Button variant="destructive" size="sm">
            <X className="h-4 w-4 mr-2" />
            Close Incident
          </Button>
        </div>
      </div>

      <Card className="shadow-lg">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <CardTitle className="text-2xl">{incident.title}</CardTitle>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground font-mono">{incident.id}</span>
                <SeverityBadge severity={incident.priority} />
                <StatusBadge status={incident.status} />
                <Badge variant="outline">Assigned: {incident.assignedAnalyst}</Badge>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-muted/30">
              <CardHeader>
                <CardTitle className="text-lg">AI Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  This incident involves multiple failed authentication attempts originating from a known malicious IP address. 
                  The attacker attempted to brute-force credentials for several user accounts. AI analysis indicates this is 
                  part of a coordinated campaign targeting financial sector organizations. Recommend immediate IP blocking 
                  and password resets for affected accounts.
                </p>
              </CardContent>
            </Card>

            <Card className="bg-muted/30">
              <CardHeader>
                <CardTitle className="text-lg">MITRE ATT&CK Mapping</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">T1110.001 - Password Guessing</Badge>
                  <Badge variant="secondary">T1078 - Valid Accounts</Badge>
                  <Badge variant="secondary">TA0001 - Initial Access</Badge>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-muted/30">
            <CardHeader>
              <CardTitle className="text-lg">Timeline of Events</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[300px]">
                <div className="space-y-4">
                  {incident.timeline.map((event) => (
                    <div key={event.id} className="flex gap-4">
                      <div className="flex-shrink-0 w-32 text-sm text-muted-foreground">
                        {new Date(event.timestamp).toLocaleString()}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{event.event}</p>
                        <p className="text-xs text-muted-foreground">by {event.actor}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-muted/30">
              <CardHeader>
                <CardTitle className="text-lg">Related Alerts ({incident.relatedAlerts.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {incident.relatedAlerts.map((alertId) => (
                    <div key={alertId} className="flex items-center justify-between p-2 rounded bg-background">
                      <span className="text-sm font-mono">{alertId}</span>
                      <Button variant="ghost" size="sm">View</Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="bg-muted/30">
              <CardHeader>
                <CardTitle className="text-lg">Evidence ({incident.attachments.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {incident.attachments.map((attachment) => (
                    <div key={attachment.id} className="flex items-center justify-between p-2 rounded bg-background">
                      <div className="flex-1">
                        <p className="text-sm font-medium">{attachment.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {attachment.size} • {new Date(attachment.uploadedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm">Download</Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="bg-muted/30">
            <CardHeader>
              <CardTitle className="text-lg">Analyst Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                {incident.notes.map((note) => (
                  <div key={note.id} className="p-3 rounded bg-background">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">{note.author}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(note.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{note.content}</p>
                  </div>
                ))}
              </div>
              <Separator />
              <div className="space-y-2">
                <Textarea placeholder="Add a new note..." className="min-h-[100px]" />
                <Button size="sm">Add Note</Button>
              </div>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  );
}
