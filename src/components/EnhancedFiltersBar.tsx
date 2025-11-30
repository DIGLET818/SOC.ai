import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Filter } from "lucide-react";
import { format } from "date-fns";

interface EnhancedFiltersBarProps {
  severity: string;
  status: string;
  ruleCategory: string;
  mitreTactic: string;
  sourceCountry: string;
  assetCriticality: string;
  dateRange: { from: Date | undefined; to: Date | undefined };
  onSeverityChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onRuleCategoryChange: (value: string) => void;
  onMitreTacticChange: (value: string) => void;
  onSourceCountryChange: (value: string) => void;
  onAssetCriticalityChange: (value: string) => void;
  onDateRangeChange: (range: { from: Date | undefined; to: Date | undefined }) => void;
  onClearFilters: () => void;
}

export function EnhancedFiltersBar({
  severity,
  status,
  ruleCategory,
  mitreTactic,
  sourceCountry,
  assetCriticality,
  dateRange,
  onSeverityChange,
  onStatusChange,
  onRuleCategoryChange,
  onMitreTacticChange,
  onSourceCountryChange,
  onAssetCriticalityChange,
  onDateRangeChange,
  onClearFilters,
}: EnhancedFiltersBarProps) {
  const hasActiveFilters =
    severity !== "all" ||
    status !== "all" ||
    ruleCategory !== "all" ||
    mitreTactic !== "all" ||
    sourceCountry !== "all" ||
    assetCriticality !== "all" ||
    dateRange.from ||
    dateRange.to;

  const setQuickDateRange = (hours: number) => {
    const now = new Date();
    const from = new Date(now.getTime() - hours * 60 * 60 * 1000);
    onDateRangeChange({ from, to: now });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">Filters</span>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearFilters}
            className="h-7 text-xs"
          >
            Clear all
          </Button>
        )}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-xs text-muted-foreground">Quick:</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setQuickDateRange(1)}
            className="h-7 text-xs"
          >
            Last 1h
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setQuickDateRange(24)}
            className="h-7 text-xs"
          >
            Last 24h
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setQuickDateRange(168)}
            className="h-7 text-xs"
          >
            Last 7d
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <Select value={severity} onValueChange={onSeverityChange}>
          <SelectTrigger className="w-[150px] bg-card border-border">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={onStatusChange}>
          <SelectTrigger className="w-[150px] bg-card border-border">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="in-progress">In Progress</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>

        <Select value={ruleCategory} onValueChange={onRuleCategoryChange}>
          <SelectTrigger className="w-[180px] bg-card border-border">
            <SelectValue placeholder="Rule Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            <SelectItem value="brute-force">Brute Force</SelectItem>
            <SelectItem value="malware">Malware</SelectItem>
            <SelectItem value="recon">Reconnaissance</SelectItem>
            <SelectItem value="lateral-movement">Lateral Movement</SelectItem>
            <SelectItem value="data-exfiltration">Data Exfiltration</SelectItem>
          </SelectContent>
        </Select>

        <Select value={mitreTactic} onValueChange={onMitreTacticChange}>
          <SelectTrigger className="w-[180px] bg-card border-border">
            <SelectValue placeholder="MITRE Tactic" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tactics</SelectItem>
            <SelectItem value="initial-access">Initial Access</SelectItem>
            <SelectItem value="execution">Execution</SelectItem>
            <SelectItem value="persistence">Persistence</SelectItem>
            <SelectItem value="privilege-escalation">Privilege Escalation</SelectItem>
            <SelectItem value="defense-evasion">Defense Evasion</SelectItem>
            <SelectItem value="credential-access">Credential Access</SelectItem>
            <SelectItem value="discovery">Discovery</SelectItem>
            <SelectItem value="lateral-movement">Lateral Movement</SelectItem>
            <SelectItem value="collection">Collection</SelectItem>
            <SelectItem value="exfiltration">Exfiltration</SelectItem>
          </SelectContent>
        </Select>

        <Select value={sourceCountry} onValueChange={onSourceCountryChange}>
          <SelectTrigger className="w-[150px] bg-card border-border">
            <SelectValue placeholder="Country" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Countries</SelectItem>
            <SelectItem value="russia">Russia</SelectItem>
            <SelectItem value="china">China</SelectItem>
            <SelectItem value="north-korea">North Korea</SelectItem>
            <SelectItem value="iran">Iran</SelectItem>
            <SelectItem value="usa">United States</SelectItem>
            <SelectItem value="internal">Internal</SelectItem>
          </SelectContent>
        </Select>

        <Select value={assetCriticality} onValueChange={onAssetCriticalityChange}>
          <SelectTrigger className="w-[170px] bg-card border-border">
            <SelectValue placeholder="Asset Criticality" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Criticality</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-[240px] justify-start text-left font-normal bg-card border-border">
              <CalendarIcon className="mr-2 h-4 w-4" />
              {dateRange.from ? (
                dateRange.to ? (
                  <>
                    {format(dateRange.from, "LLL dd")} - {format(dateRange.to, "LLL dd")}
                  </>
                ) : (
                  format(dateRange.from, "LLL dd, yyyy")
                )
              ) : (
                <span className="text-muted-foreground">Pick a date range</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              selected={{ from: dateRange.from, to: dateRange.to }}
              onSelect={(range) =>
                onDateRangeChange({ from: range?.from, to: range?.to })
              }
              numberOfMonths={2}
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
