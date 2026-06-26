import { Calendar as CalendarIcon, FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type ReportStatusCounts = {
  open: number;
  closed: number;
  merged: number;
  pending: number;
  inProgress: number;
  incidentAutoClosed: number;
};

type StatusRow = {
  label: string;
  shortLabel: string;
  value: number;
  tone?: "open" | "closed" | "default";
};

function statusRows(counts: ReportStatusCounts, pendingLabel = "Pending"): StatusRow[] {
  return [
    { label: "Open", shortLabel: "Open", value: counts.open, tone: "open" },
    { label: "Closed", shortLabel: "Closed", value: counts.closed, tone: "closed" },
    { label: "Merged", shortLabel: "Merged", value: counts.merged },
    { label: pendingLabel, shortLabel: "Pending", value: counts.pending },
    { label: "In progress", shortLabel: "In progress", value: counts.inProgress },
    {
      label: "Incident auto closed",
      shortLabel: "Auto closed",
      value: counts.incidentAutoClosed,
    },
  ];
}

const valueToneClass: Record<NonNullable<StatusRow["tone"]>, string> = {
  open: "text-amber-700 dark:text-amber-400",
  closed: "text-emerald-700 dark:text-emerald-400",
  default: "text-foreground",
};

type ReportStatusSummaryCardProps = {
  variant?: "primary" | "blue";
  title: string;
  subtitle?: string;
  total: number;
  counts: ReportStatusCounts;
  /** Long pending label used on Daily Alerts */
  pendingLabel?: string;
  className?: string;
};

export function ReportStatusSummaryCard({
  variant = "primary",
  title,
  subtitle,
  total,
  counts,
  pendingLabel,
  className,
}: ReportStatusSummaryCardProps) {
  const rows = statusRows(counts, pendingLabel);
  const Icon = variant === "primary" ? CalendarIcon : FileText;
  const titleClass =
    variant === "primary"
      ? "text-primary"
      : "text-blue-700 dark:text-blue-300";
  const iconClass =
    variant === "primary" ? "text-primary" : "text-blue-600 dark:text-blue-400";

  return (
    <Card
      className={cn(
        "w-full border border-border/80 shadow-sm rounded-lg",
        variant === "primary" ? "bg-primary/5" : "bg-blue-500/5",
        className
      )}
    >
      <CardContent className="p-3 sm:p-3.5">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-4">
          <div className="flex items-start gap-2 min-w-0 sm:max-w-[min(100%,14rem)] shrink-0">
            <Icon className={cn("h-4 w-4 shrink-0 mt-0.5", iconClass)} />
            <div className="min-w-0">
              <p className={cn("text-[10px] font-semibold uppercase tracking-wide", titleClass)}>
                {title}
              </p>
              {subtitle ? (
                <p className="text-[11px] text-muted-foreground truncate mt-0.5" title={subtitle}>
                  {subtitle}
                </p>
              ) : null}
            </div>
          </div>

          <ul
            className="flex-1 grid grid-cols-3 sm:grid-cols-6 gap-1.5 sm:gap-2 min-w-0"
            aria-label={`${title} status breakdown`}
          >
            {rows.map((row) => (
              <li
                key={row.label}
                className="flex items-center justify-between gap-1 rounded-md border border-border/50 bg-background/70 px-2 py-1 sm:flex-col sm:items-stretch sm:justify-center sm:py-1.5 sm:text-center"
              >
                <span
                  className="text-[10px] sm:text-[11px] text-muted-foreground truncate sm:truncate-none"
                  title={row.label}
                >
                  {row.shortLabel}
                </span>
                <span
                  className={cn(
                    "text-xs sm:text-sm font-semibold tabular-nums shrink-0 sm:mt-0.5",
                    valueToneClass[row.tone ?? "default"]
                  )}
                >
                  {row.value}
                </span>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-end sm:justify-center sm:shrink-0 sm:pl-1 sm:border-l sm:border-border/60 sm:min-w-[3.25rem]">
            <span className="text-[10px] text-muted-foreground sm:hidden">Total</span>
            <div className="text-right">
              <p className="hidden sm:block text-[10px] text-muted-foreground leading-none mb-0.5">Total</p>
              <p className="text-base sm:text-lg font-bold tabular-nums text-foreground leading-tight">
                {total}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
