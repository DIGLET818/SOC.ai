import { Badge } from "@/components/ui/badge";

interface StatusBadgeProps {
  status: "open" | "in-progress" | "closed";
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const variants = {
    open: "bg-severity-high/20 text-severity-high border-severity-high/30",
    "in-progress": "bg-severity-medium/20 text-severity-medium border-severity-medium/30",
    closed: "bg-severity-info/20 text-severity-info border-severity-info/30",
  };

  const labels = {
    open: "OPEN",
    "in-progress": "IN PROGRESS",
    closed: "CLOSED",
  };

  return (
    <Badge variant="outline" className={variants[status]}>
      {labels[status]}
    </Badge>
  );
}
