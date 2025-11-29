import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { FileText, User, Clock, Paperclip, MessageSquare, Plus } from "lucide-react";
import { mockCases } from "@/data/mockCases";
import { Case } from "@/types/case";

export function CaseManagement() {
  const [selectedCase, setSelectedCase] = useState<Case | null>(null);
  const [newNote, setNewNote] = useState("");

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "critical":
        return "bg-severity-high/20 text-severity-high border-severity-high/30";
      case "high":
        return "bg-severity-medium/20 text-severity-medium border-severity-medium/30";
      case "medium":
        return "bg-severity-low/20 text-severity-low border-severity-low/30";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open":
        return "bg-severity-high/20 text-severity-high border-severity-high/30";
      case "investigating":
        return "bg-severity-medium/20 text-severity-medium border-severity-medium/30";
      case "contained":
        return "bg-severity-info/20 text-severity-info border-severity-info/30";
      case "closed":
        return "bg-muted text-muted-foreground";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Case Management
          </div>
          <Button size="sm" className="shadow-sm">
            <Plus className="h-4 w-4 mr-2" />
            New Case
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {mockCases.map((caseItem) => (
            <Dialog key={caseItem.id}>
              <DialogTrigger asChild>
                <div
                  className="p-4 border border-border rounded-lg hover:border-primary/50 cursor-pointer transition-all hover:shadow-md bg-card"
                  onClick={() => setSelectedCase(caseItem)}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-sm font-semibold text-primary">
                          {caseItem.id}
                        </span>
                        <Badge variant="outline" className={getPriorityColor(caseItem.priority)}>
                          {caseItem.priority.toUpperCase()}
                        </Badge>
                        <Badge variant="outline" className={getStatusColor(caseItem.status)}>
                          {caseItem.status.replace("-", " ").toUpperCase()}
                        </Badge>
                      </div>
                      <h4 className="text-sm font-medium text-foreground mb-2">
                        {caseItem.title}
                      </h4>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {caseItem.assignedAnalyst}
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Updated {caseItem.updatedAt}
                        </div>
                        <div className="flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          {caseItem.relatedAlerts.length} related alerts
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </DialogTrigger>
              <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-primary" />
                    {selectedCase?.id}: {selectedCase?.title}
                  </DialogTitle>
                  <DialogDescription className="flex gap-2 pt-2">
                    <Badge variant="outline" className={getPriorityColor(selectedCase?.priority || "")}>
                      {selectedCase?.priority.toUpperCase()}
                    </Badge>
                    <Badge variant="outline" className={getStatusColor(selectedCase?.status || "")}>
                      {selectedCase?.status.replace("-", " ").toUpperCase()}
                    </Badge>
                  </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="notes" className="w-full">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="notes">Notes</TabsTrigger>
                    <TabsTrigger value="timeline">Timeline</TabsTrigger>
                    <TabsTrigger value="attachments">Attachments</TabsTrigger>
                  </TabsList>

                  <TabsContent value="notes" className="space-y-4">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold">Case Notes</h3>
                        <span className="text-xs text-muted-foreground">
                          Assigned to: {selectedCase?.assignedAnalyst}
                        </span>
                      </div>
                      <ScrollArea className="h-[300px] pr-4">
                        <div className="space-y-3">
                          {selectedCase?.notes.map((note) => (
                            <Card key={note.id} className="bg-muted/30">
                              <CardContent className="p-4">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs font-semibold text-foreground">
                                    {note.author}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {note.timestamp}
                                  </span>
                                </div>
                                <p className="text-sm text-foreground">{note.content}</p>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </ScrollArea>
                      <div className="space-y-2">
                        <Textarea
                          placeholder="Add a new note..."
                          value={newNote}
                          onChange={(e) => setNewNote(e.target.value)}
                          className="min-h-[100px]"
                        />
                        <Button size="sm" className="w-full">
                          <MessageSquare className="h-4 w-4 mr-2" />
                          Add Note
                        </Button>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="timeline">
                    <ScrollArea className="h-[400px]">
                      <div className="space-y-3">
                        {selectedCase?.timeline.map((event, idx) => (
                          <div key={event.id} className="flex gap-3">
                            <div className="flex flex-col items-center">
                              <div className="h-3 w-3 rounded-full bg-primary" />
                              {idx < (selectedCase?.timeline.length || 0) - 1 && (
                                <div className="w-0.5 h-full bg-border mt-1" />
                              )}
                            </div>
                            <div className="flex-1 pb-4">
                              <p className="text-xs text-muted-foreground mb-1">
                                {event.timestamp}
                              </p>
                              <p className="text-sm font-medium">{event.event}</p>
                              <p className="text-xs text-muted-foreground mt-1">
                                by {event.actor}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </TabsContent>

                  <TabsContent value="attachments">
                    <div className="space-y-3">
                      {selectedCase?.attachments.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <Paperclip className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">No attachments yet</p>
                        </div>
                      ) : (
                        selectedCase?.attachments.map((attachment) => (
                          <Card key={attachment.id} className="hover:border-primary/50 transition-colors">
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <Paperclip className="h-5 w-5 text-primary" />
                                  <div>
                                    <p className="text-sm font-medium">{attachment.name}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {attachment.size} • Uploaded by {attachment.uploadedBy} on{" "}
                                      {attachment.uploadedAt}
                                    </p>
                                  </div>
                                </div>
                                <Button variant="ghost" size="sm">
                                  Download
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        ))
                      )}
                      <Button variant="outline" className="w-full">
                        <Paperclip className="h-4 w-4 mr-2" />
                        Upload Attachment
                      </Button>
                    </div>
                  </TabsContent>
                </Tabs>
              </DialogContent>
            </Dialog>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
