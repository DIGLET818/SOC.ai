import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Filter } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface IncidentFiltersBarProps {
  severity: string;
  status: string;
  assignedAnalyst: string;
  mitreTactic: string;
  dateRange: { from: Date | undefined; to: Date | undefined };
  onSeverityChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onAssignedAnalystChange: (value: string) => void;
  onMitreTacticChange: (value: string) => void;
  onDateRangeChange: (range: { from: Date | undefined; to: Date | undefined }) => void;
  onClearFilters: () => void;
}

export function IncidentFiltersBar({
  severity,
  status,
  assignedAnalyst,
  mitreTactic,
  dateRange,
  onSeverityChange,
  onStatusChange,
  onAssignedAnalystChange,
  onMitreTacticChange,
  onDateRangeChange,
  onClearFilters,
}: IncidentFiltersBarProps) {
  const hasActiveFilters =
    severity !== "all" ||
    status !== "all" ||
    assignedAnalyst !== "all" ||
    mitreTactic !== "all" ||
    dateRange.from ||
    dateRange.to;

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
      </div>
      <div className="flex flex-wrap gap-3">
        <Select value={severity} onValueChange={onSeverityChange}>
          <SelectTrigger className="w-[150px] bg-card border-border">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={onStatusChange}>
          <SelectTrigger className="w-[160px] bg-card border-border">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="investigating">Investigating</SelectItem>
            <SelectItem value="contained">Contained</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>

        <Select value={assignedAnalyst} onValueChange={onAssignedAnalystChange}>
          <SelectTrigger className="w-[180px] bg-card border-border">
            <SelectValue placeholder="Assigned Analyst" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Analysts</SelectItem>
            <SelectItem value="Sarah Chen">Sarah Chen</SelectItem>
            <SelectItem value="Mike Rodriguez">Mike Rodriguez</SelectItem>
            <SelectItem value="Emily Watson">Emily Watson</SelectItem>
            <SelectItem value="Unassigned">Unassigned</SelectItem>
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
            <SelectItem value="credential-access">Credential Access</SelectItem>
            <SelectItem value="lateral-movement">Lateral Movement</SelectItem>
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
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
