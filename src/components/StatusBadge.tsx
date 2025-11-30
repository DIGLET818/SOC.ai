import { Badge } from "@/components/ui/badge";

interface StatusBadgeProps {
  status: "open" | "investigating" | "contained" | "closed" | "in-progress";
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const variants = {
    open: "bg-severity-high/20 text-severity-high border-severity-high/30",
    investigating: "bg-severity-medium/20 text-severity-medium border-severity-medium/30",
    contained: "bg-chart-3/20 text-chart-3 border-chart-3/30",
    closed: "bg-severity-info/20 text-severity-info border-severity-info/30",
    "in-progress": "bg-severity-medium/20 text-severity-medium border-severity-medium/30",
  };

  const labels = {
    open: "OPEN",
    investigating: "INVESTIGATING",
    contained: "CONTAINED",
    closed: "CLOSED",
    "in-progress": "IN PROGRESS",
  };

  return (
    <Badge variant="outline" className={variants[status]}>
      {labels[status]}
    </Badge>
  );
}
