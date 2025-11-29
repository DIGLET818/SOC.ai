export interface Alert {
  id: string;
  timestamp: string;
  ruleName: string;
  sourceIp: string;
  sourceUser?: string;
  severity: "high" | "medium" | "low";
  aiScore: number;
  status: "open" | "in-progress" | "closed";
  aiSummary: string;
  recommendedActions: string[];
  iocEnrichment: {
    virusTotal: string;
    geoIP: string;
    greyNoise: string;
  };
  timeline: {
    timestamp: string;
    event: string;
  }[];
}
