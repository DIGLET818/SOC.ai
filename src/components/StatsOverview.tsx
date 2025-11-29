import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, TrendingUp, Clock, Activity } from "lucide-react";

const stats = [
  {
    label: "Total Alerts Today",
    value: "247",
    icon: AlertTriangle,
    trend: "+12% from yesterday",
  },
  {
    label: "High Severity",
    value: "18",
    icon: TrendingUp,
    trend: "3 critical",
    critical: true,
  },
  {
    label: "Avg Response Time",
    value: "4.2m",
    icon: Clock,
    trend: "-8% improvement",
  },
  {
    label: "Active Incidents",
    value: "5",
    icon: Activity,
    trend: "2 escalated",
  },
];

export function StatsOverview() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat) => (
        <Card key={stat.label} className="border-border">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground mb-1">{stat.label}</p>
                <p className="text-3xl font-bold text-foreground">{stat.value}</p>
                <p className={`text-xs mt-2 ${stat.critical ? "text-severity-high" : "text-muted-foreground"}`}>
                  {stat.trend}
                </p>
              </div>
              <stat.icon className={`h-10 w-10 ${stat.critical ? "text-severity-high" : "text-primary"}`} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
