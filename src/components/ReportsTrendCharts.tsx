import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const alertTrendData = [
  { date: "Jan 1", critical: 12, high: 34, medium: 56, low: 78 },
  { date: "Jan 8", critical: 15, high: 42, medium: 61, low: 82 },
  { date: "Jan 15", critical: 10, high: 38, medium: 59, low: 75 },
  { date: "Jan 22", critical: 18, high: 45, medium: 64, low: 88 },
  { date: "Jan 29", critical: 14, high: 40, medium: 58, low: 80 },
];

const responseTimeData = [
  { week: "Week 1", mttd: 12, mttr: 45 },
  { week: "Week 2", mttd: 10, mttr: 42 },
  { week: "Week 3", mttd: 8, mttr: 38 },
  { week: "Week 4", mttd: 7, mttr: 35 },
];

export function ReportsTrendCharts() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>30-Day Alert Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={alertTrendData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="date" className="text-xs" />
              <YAxis className="text-xs" />
              <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
              <Legend />
              <Line type="monotone" dataKey="critical" stroke="hsl(var(--destructive))" strokeWidth={2} />
              <Line type="monotone" dataKey="high" stroke="hsl(var(--chart-2))" strokeWidth={2} />
              <Line type="monotone" dataKey="medium" stroke="hsl(var(--chart-3))" strokeWidth={2} />
              <Line type="monotone" dataKey="low" stroke="hsl(var(--chart-4))" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle>Alerts by Severity</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={alertTrendData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="date" className="text-xs" />
              <YAxis className="text-xs" />
              <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
              <Legend />
              <Bar dataKey="critical" stackId="a" fill="hsl(var(--destructive))" />
              <Bar dataKey="high" stackId="a" fill="hsl(var(--chart-2))" />
              <Bar dataKey="medium" stackId="a" fill="hsl(var(--chart-3))" />
              <Bar dataKey="low" stackId="a" fill="hsl(var(--chart-4))" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="shadow-lg lg:col-span-2">
        <CardHeader>
          <CardTitle>Incident Response Time Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={responseTimeData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="week" className="text-xs" />
              <YAxis className="text-xs" label={{ value: "Minutes", angle: -90, position: "insideLeft" }} />
              <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
              <Legend />
              <Line type="monotone" dataKey="mttd" stroke="hsl(var(--primary))" strokeWidth={2} name="MTTD (min)" />
              <Line type="monotone" dataKey="mttr" stroke="hsl(var(--chart-2))" strokeWidth={2} name="MTTR (min)" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
