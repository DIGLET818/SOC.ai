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
      {/* HEADER BUTTONS */}
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

      {/* MAIN CARD */}
      <Card className="shadow-lg">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <CardTitle className="text-2xl">{incident.title}</CardTitle>

              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground font-mono">
                  {incident.id}
                </span>

                <SeverityBadge severity={incident.priority} />
                <StatusBadge status={incident.status} />

                <Badge variant="outline">
                  Assigned: {incident.assignedAnalyst || "Unassigned"}
                </Badge>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">

          {/* AI SUMMARY + MITRE */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* AI Summary */}
            <Card className="bg-muted/30">
              <CardHeader>
                <CardTitle className="text-lg">AI Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {incident.aiSummary ||
                    "No AI summary available for this incident."}
                </p>
              </CardContent>
            </Card>

            {/* MITRE SECTION */}
            <Card className="bg-muted/30">
              <CardHeader>
                <CardTitle className="text-lg">MITRE ATT&CK Mapping</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {(incident.mitreTechniques || []).map((tech) => (
                    <Badge key={tech} variant="secondary">
                      {tech}
                    </Badge>
                  ))}

                  {(!incident.mitreTechniques ||
                    incident.mitreTechniques.length === 0) && (
                    <p className="text-sm text-muted-foreground">
                      No MITRE techniques mapped.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* TIMELINE */}
          <Card className="bg-muted/30">
            <CardHeader>
              <CardTitle className="text-lg">Details of Alert</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[300px]">
                <div className="space-y-4">
                  {(incident.timeline || []).map((event) => (
                    <div key={event.id} className="flex gap-4">
                      <div className="flex-shrink-0 w-32 text-sm text-muted-foreground">
                        {new Date(event.timestamp).toLocaleString()}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{event.event}</p>
                        <p className="text-xs text-muted-foreground">
                          by {event.actor}
                        </p>
                      </div>
                    </div>
                  ))}

                  {(!incident.timeline ||
                    incident.timeline.length === 0) && (
                    <p className="text-sm text-muted-foreground">
                      No Alert Deatils recorded.
                    </p>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* RELATED ALERTS + EVIDENCE */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Related Alerts */}
            <Card className="bg-muted/30">
              <CardHeader>
                <CardTitle className="text-lg">
                  Related Alerts ({incident.relatedAlerts?.length || 0})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {(incident.relatedAlerts || []).map((alertId) => (
                    <div
                      key={alertId}
                      className="flex items-center justify-between p-2 rounded bg-background"
                    >
                      <span className="text-sm font-mono">{alertId}</span>
                      <Button variant="ghost" size="sm">
                        View
                      </Button>
                    </div>
                  ))}

                  {(!incident.relatedAlerts ||
                    incident.relatedAlerts.length === 0) && (
                    <p className="text-sm text-muted-foreground">
                      No related alerts.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Evidence */}
            <Card className="bg-muted/30">
              <CardHeader>
                <CardTitle className="text-lg">
                  Evidence ({incident.attachments?.length || 0})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {(incident.attachments || []).map((attachment) => (
                    <div
                      key={attachment.id}
                      className="flex items-center justify-between p-2 rounded bg-background"
                    >
                      <div className="flex-1">
                        <p className="text-sm font-medium">{attachment.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {attachment.size} •{" "}
                          {new Date(attachment.uploadedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <Button variant="ghost" size="sm">
                        Download
                      </Button>
                    </div>
                  ))}

                  {(!incident.attachments ||
                    incident.attachments.length === 0) && (
                    <p className="text-sm text-muted-foreground">
                      No evidence uploaded.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* NOTES */}
          <Card className="bg-muted/30">
            <CardHeader>
              <CardTitle className="text-lg">Analyst Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                {(incident.notes || []).map((note) => (
                  <div key={note.id} className="p-3 rounded bg-background">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">{note.author}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(note.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {note.content}
                    </p>
                  </div>
                ))}

                {(!incident.notes || incident.notes.length === 0) && (
                  <p className="text-sm text-muted-foreground">
                    No notes added yet.
                  </p>
                )}
              </div>

              <Separator />

              <div className="space-y-2">
                <Textarea
                  placeholder="Add a new note..."
                  className="min-h-[100px]"
                />
                <Button size="sm">Add Note</Button>
              </div>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  );
}
