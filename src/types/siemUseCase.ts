export interface SiemUseCase {
  id: string;
  ruleName: string;
  pbSeverity: string;
  ruleCondition: string;
  logSource: string;
  team: string;
  latestIncident: string;
  alertReceived: string;
  remarks: string;
  monthlyData: Record<string, string | number>; // e.g., { "Jan 25": 10, "Feb 25": 5 }
}
