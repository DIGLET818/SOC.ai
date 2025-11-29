import { Badge } from "@/components/ui/badge";

interface SeverityBadgeProps {
  severity: "high" | "medium" | "low";
}

export function SeverityBadge({ severity }: SeverityBadgeProps) {
  const variants = {
    high: "bg-severity-high/20 text-severity-high border-severity-high/30",
    medium: "bg-severity-medium/20 text-severity-medium border-severity-medium/30",
    low: "bg-severity-low/20 text-severity-low border-severity-low/30",
  };

  return (
    <Badge variant="outline" className={variants[severity]}>
      {severity.toUpperCase()}
    </Badge>
  );
}
