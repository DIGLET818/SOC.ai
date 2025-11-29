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
    asn: string;
    reputation: number;
  };
  timeline: {
    timestamp: string;
    event: string;
  }[];
  ruleCategory: "brute-force" | "malware" | "recon" | "lateral-movement" | "data-exfiltration";
  mitreTactic: string;
  mitreId: string;
  sourceCountry: string;
  hostContext: {
    hostname: string;
    criticality: "critical" | "high" | "medium" | "low";
    assetOwner: string;
    os: string;
    edrStatus: "active" | "inactive" | "degraded";
  };
  relatedAlerts?: number;
  campaignId?: string;
}
