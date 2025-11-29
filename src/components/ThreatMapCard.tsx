import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Globe, MapPin } from "lucide-react";

const threatSources = [
  { country: "Russia", attacks: 1247, severity: "high", lat: 60, long: 100 },
  { country: "China", attacks: 892, severity: "high", lat: 35, long: 105 },
  { country: "North Korea", attacks: 234, severity: "medium", lat: 40, long: 127 },
  { country: "Iran", attacks: 178, severity: "medium", lat: 32, long: 53 },
  { country: "Brazil", attacks: 145, severity: "low", lat: -10, long: -55 },
  { country: "Ukraine", attacks: 89, severity: "low", lat: 49, long: 32 },
];

export function ThreatMapCard() {
  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Globe className="h-5 w-5 text-primary" />
          Global Threat Sources (24h)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative bg-muted/30 rounded-lg p-6 h-[300px] flex items-center justify-center">
          <div className="absolute inset-0 flex items-center justify-center opacity-20">
            <Globe className="h-48 w-48 text-primary" />
          </div>
          <div className="relative z-10 w-full">
            <div className="space-y-3">
              {threatSources.map((source, idx) => (
                <div
                  key={source.country}
                  className="flex items-center justify-between p-3 bg-card rounded-lg border border-border hover:border-primary/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10">
                      <MapPin className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{source.country}</p>
                      <p className="text-xs text-muted-foreground">{source.attacks} attempts</p>
                    </div>
                  </div>
                  <div
                    className={`px-3 py-1 rounded-full text-xs font-medium ${
                      source.severity === "high"
                        ? "bg-severity-high/20 text-severity-high"
                        : source.severity === "medium"
                        ? "bg-severity-medium/20 text-severity-medium"
                        : "bg-severity-low/20 text-severity-low"
                    }`}
                  >
                    {source.severity.toUpperCase()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
