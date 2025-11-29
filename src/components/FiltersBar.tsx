import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";

interface FiltersBarProps {
  severity: string;
  status: string;
  dateRange: { from: Date | undefined; to: Date | undefined };
  onSeverityChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onDateRangeChange: (range: { from: Date | undefined; to: Date | undefined }) => void;
}

export function FiltersBar({
  severity,
  status,
  dateRange,
  onSeverityChange,
  onStatusChange,
  onDateRangeChange,
}: FiltersBarProps) {
  return (
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
  );
}
