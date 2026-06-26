import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Flame, Trophy } from "lucide-react";

const MONTH_COLORS = [
  "bg-sky-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-cyan-500",
] as const;

export type TopUseCaseAlertRow = {
  ruleName: string;
  severity: string;
  totalAlerts: number;
  byMonth: Record<string, number>;
  monthsTriggered: number;
};

function shortenRuleLabel(name: string): string {
  const parts = name.split(/\s-\s/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) return parts.slice(2).join(" - ");
  if (parts.length === 2) return parts[1]!;
  return name.length > 48 ? `${name.slice(0, 46)}…` : name;
}

function rankBadgeClass(rank: number): string {
  if (rank === 0) return "bg-amber-500/20 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/40";
  if (rank === 1) return "bg-slate-400/20 text-slate-700 dark:text-slate-300 ring-1 ring-slate-400/40";
  if (rank === 2) return "bg-orange-600/15 text-orange-800 dark:text-orange-300 ring-1 ring-orange-500/35";
  return "bg-muted text-muted-foreground";
}

function severityVariant(sev: string): "destructive" | "default" | "secondary" | "outline" {
  const s = sev.toLowerCase();
  if (s === "high" || s === "critical") return "destructive";
  if (s === "medium") return "default";
  if (s === "low") return "secondary";
  return "outline";
}

export function TopUseCaseAlertsLeaderboard({
  rows,
  monthColumns,
  maxItems = 10,
}: {
  rows: TopUseCaseAlertRow[];
  monthColumns: string[];
  maxItems?: number;
}) {
  const shown = rows.slice(0, maxItems);
  const peak = Math.max(...shown.map((r) => r.totalAlerts), 1);

  if (!shown.length) {
    return (
      <p className="text-xs text-muted-foreground text-center py-12 px-4">
        Run <strong>Scan mailbox</strong> to rank use cases by how many alert emails matched each rule.
      </p>
    );
  }

  return (
    <div className="space-y-3 px-1">
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground px-1">
        {monthColumns.map((m, i) => (
          <span key={m} className="inline-flex items-center gap-1">
            <span className={cn("h-2 w-2 rounded-sm shrink-0", MONTH_COLORS[i % MONTH_COLORS.length])} />
            {m}
          </span>
        ))}
        <span className="ml-auto">Bar = share of that rule&apos;s alerts per month</span>
      </div>

      <div className="space-y-2">
        {shown.map((row, idx) => {
          const pctOfPeak = Math.round((row.totalAlerts / peak) * 100);
          return (
            <div
              key={row.ruleName}
              className={cn(
                "rounded-lg border p-3 transition-colors",
                idx === 0 ? "border-amber-500/30 bg-amber-500/[0.04]" : "border-border/60 bg-card/50"
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums",
                    rankBadgeClass(idx)
                  )}
                >
                  {idx < 3 ? <Trophy className="h-3.5 w-3.5" /> : idx + 1}
                </div>

                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2 gap-y-0.5">
                    <p className="text-xs font-medium leading-snug line-clamp-2" title={row.ruleName}>
                      {shortenRuleLabel(row.ruleName)}
                    </p>
                    {row.severity ? (
                      <Badge variant={severityVariant(row.severity)} className="h-4 px-1.5 text-[9px] shrink-0">
                        {row.severity}
                      </Badge>
                    ) : null}
                    {idx === 0 ? (
                      <span className="inline-flex items-center gap-0.5 text-[9px] font-medium text-amber-600 dark:text-amber-400">
                        <Flame className="h-3 w-3" />
                        Top volume
                      </span>
                    ) : null}
                  </div>

                  <div className="relative h-3 w-full overflow-hidden rounded-full bg-muted/80">
                    <div
                      className="absolute inset-y-0 left-0 flex overflow-hidden rounded-full"
                      style={{ width: `${pctOfPeak}%` }}
                    >
                      {monthColumns.map((m, mi) => {
                        const count = row.byMonth[m] ?? 0;
                        if (count <= 0 || row.totalAlerts <= 0) return null;
                        const w = (count / row.totalAlerts) * 100;
                        return (
                          <div
                            key={m}
                            className={cn("h-full min-w-[2px]", MONTH_COLORS[mi % MONTH_COLORS.length])}
                            style={{ width: `${w}%` }}
                            title={`${m}: ${count} alerts`}
                          />
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] tabular-nums text-muted-foreground">
                    {monthColumns.map((m, mi) => (
                      <span key={m}>
                        <span className={cn("inline-block h-1.5 w-1.5 rounded-full mr-0.5 align-middle", MONTH_COLORS[mi % MONTH_COLORS.length])} />
                        {m}: <span className="text-foreground font-medium">{row.byMonth[m] ?? 0}</span>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="shrink-0 text-right pl-1">
                  <p className="text-2xl font-bold tabular-nums leading-none text-foreground">{row.totalAlerts}</p>
                  <p className="text-[9px] text-muted-foreground mt-0.5">alerts</p>
                  <p className="text-[9px] text-muted-foreground/80 mt-1">
                    {row.monthsTriggered}/{monthColumns.length} mo INC
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
