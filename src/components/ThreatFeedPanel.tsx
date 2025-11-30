import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skull, Bug, Shield, TrendingUp } from "lucide-react";

const threats = [
  {
    id: 1,
    type: "threat-actor",
    name: "APT29 (Cozy Bear)",
    description: "Targeting government and healthcare sectors",
    severity: "critical",
    timestamp: "2 hours ago",
  },
  {
    id: 2,
    type: "malware",
    name: "Emotet Banking Trojan",
    description: "New variant detected in phishing campaigns",
    severity: "high",
    timestamp: "5 hours ago",
  },
  {
    id: 3,
    type: "cve",
    name: "CVE-2024-1234",
    description: "Critical RCE in Apache Log4j",
    severity: "critical",
    timestamp: "8 hours ago",
  },
  {
    id: 4,
    type: "campaign",
    name: "Operation ShadowNet",
    description: "Coordinated attacks on financial institutions",
    severity: "high",
    timestamp: "12 hours ago",
  },
];

const typeIcons = {
  "threat-actor": Skull,
  "malware": Bug,
  "cve": Shield,
  "campaign": TrendingUp,
};

export function ThreatFeedPanel() {
  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle>Latest Threats Feed</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px]">
          <div className="space-y-4">
            {threats.map((threat) => {
              const Icon = typeIcons[threat.type as keyof typeof typeIcons];
              return (
                <div key={threat.id} className="flex gap-4 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
                  <div className="flex-shrink-0">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold">{threat.name}</h4>
                      <Badge
                        variant={threat.severity === "critical" ? "destructive" : "secondary"}
                        className="text-xs"
                      >
                        {threat.severity}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{threat.description}</p>
                    <p className="text-xs text-muted-foreground">{threat.timestamp}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
