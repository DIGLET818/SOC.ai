import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, Globe, Server, AlertTriangle } from "lucide-react";

interface IOCEnrichmentResultsProps {
  results: any;
}

export function IOCEnrichmentResults({ results }: IOCEnrichmentResultsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <Card className="shadow-lg">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">VirusTotal</CardTitle>
          <Shield className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="text-2xl font-bold text-destructive">{results.virustotal.score}/100</div>
            <div className="text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>Malicious:</span>
                <span className="text-destructive font-medium">{results.virustotal.malicious}</span>
              </div>
              <div className="flex justify-between">
                <span>Suspicious:</span>
                <span className="text-yellow-500 font-medium">{results.virustotal.suspicious}</span>
              </div>
              <div className="flex justify-between">
                <span>Clean:</span>
                <span className="text-green-500 font-medium">{results.virustotal.clean}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-lg">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">GeoIP & ASN</CardTitle>
          <Globe className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="text-lg font-bold">{results.geoip.country}</div>
            <div className="text-xs text-muted-foreground space-y-1">
              <div className="flex justify-between">
                <span>City:</span>
                <span className="font-medium">{results.geoip.city}</span>
              </div>
              <div className="flex justify-between">
                <span>ASN:</span>
                <span className="font-medium">{results.geoip.asn}</span>
              </div>
              <div className="flex justify-between">
                <span>Org:</span>
                <span className="font-medium text-xs">{results.geoip.org}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-lg">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">GreyNoise</CardTitle>
          <Server className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Badge variant="destructive" className="text-xs">{results.greynoise.classification}</Badge>
            <div className="text-xs text-muted-foreground">
              <div className="font-medium mb-1">Tags:</div>
              <div className="flex flex-wrap gap-1">
                {results.greynoise.tags.map((tag: string) => (
                  <Badge key={tag} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-lg">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">AbuseIPDB</CardTitle>
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="text-2xl font-bold text-destructive">{results.abuseipdb.score}%</div>
            <div className="text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>Reports:</span>
                <span className="font-medium">{results.abuseipdb.reports}</span>
              </div>
              <div className="flex justify-between">
                <span>Last Seen:</span>
                <span className="font-medium">{results.abuseipdb.lastReported}</span>
              </div>
              <div className="flex justify-between">
                <span>Sightings:</span>
                <span className="font-medium">{results.sightings}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
