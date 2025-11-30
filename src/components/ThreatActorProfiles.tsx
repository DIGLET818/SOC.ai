import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users } from "lucide-react";

const actors = [
  {
    id: 1,
    name: "APT28 (Fancy Bear)",
    origin: "Russia",
    tools: ["Zebrocy", "X-Agent", "Sofacy"],
    targets: ["Government", "Military", "Defense"],
    ttps: "Spear-phishing, watering hole attacks, credential harvesting",
  },
  {
    id: 2,
    name: "Lazarus Group",
    origin: "North Korea",
    tools: ["WannaCry", "FALLCHILL", "BLINDINGCAN"],
    targets: ["Financial", "Cryptocurrency", "Defense"],
    ttps: "Supply chain attacks, destructive malware, financial theft",
  },
  {
    id: 3,
    name: "APT29 (Cozy Bear)",
    origin: "Russia",
    tools: ["SolarWinds", "SUNBURST", "Cobalt Strike"],
    targets: ["Government", "Think Tanks", "Healthcare"],
    ttps: "Supply chain compromise, cloud exploitation, living-off-the-land",
  },
];

export function ThreatActorProfiles() {
  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Threat Actor Profiles
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {actors.map((actor) => (
            <Card key={actor.id} className="bg-muted/30">
              <CardContent className="pt-6">
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <h3 className="font-semibold text-lg">{actor.name}</h3>
                    <Badge variant="outline">{actor.origin}</Badge>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-muted-foreground">Tools:</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {actor.tools.map((tool) => (
                          <Badge key={tool} variant="secondary" className="text-xs">
                            {tool}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Target Sectors:</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {actor.targets.map((target) => (
                          <Badge key={target} variant="secondary" className="text-xs">
                            {target}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-sm">TTPs:</span>
                    <p className="text-sm mt-1">{actor.ttps}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
