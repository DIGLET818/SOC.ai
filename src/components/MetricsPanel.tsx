import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, Target, TrendingUp, Bot, AlertTriangle } from "lucide-react";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";

const alertTrendData = [
  { time: "00:00", alerts: 12 },
  { time: "04:00", alerts: 8 },
  { time: "08:00", alerts: 25 },
  { time: "12:00", alerts: 31 },
  { time: "16:00", alerts: 22 },
  { time: "20:00", alerts: 18 },
  { time: "24:00", alerts: 15 },
];

const metrics = [
  {
    label: "MTTD",
    value: "3.2m",
    description: "Mean Time To Detect",
    trend: "-15% vs last week",
    icon: Clock,
    positive: true,
  },
  {
    label: "MTTR",
    value: "12.8m",
    description: "Mean Time To Respond",
    trend: "-22% vs last week",
    icon: Target,
    positive: true,
  },
  {
    label: "AI Handled",
    value: "73%",
    description: "Alerts auto-resolved by AI",
    trend: "+8% vs last week",
    icon: Bot,
    positive: true,
  },
  {
    label: "Escalation Rate",
    value: "12%",
    description: "Alerts requiring analyst",
    trend: "-5% vs last week",
    icon: AlertTriangle,
    positive: true,
  },
];

export function MetricsPanel() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((metric) => (
          <Card key={metric.label} className="border-border">
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <metric.icon className="h-4 w-4 text-primary" />
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {metric.label}
                    </p>
                  </div>
                  <p className="text-3xl font-bold text-foreground mb-1">{metric.value}</p>
                  <p className="text-xs text-muted-foreground mb-2">{metric.description}</p>
                  <p
                    className={`text-xs font-medium ${
                      metric.positive ? "text-severity-info" : "text-severity-high"
                    }`}
                  >
                    {metric.trend}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            24-Hour Alert Trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={alertTrendData}>
              <XAxis
                dataKey="time"
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
              />
              <Line
                type="monotone"
                dataKey="alerts"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
