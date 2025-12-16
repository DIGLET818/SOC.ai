import { Badge } from "@/components/ui/badge";

interface SeverityBadgeProps {
  severity: string; // accept any string from backend, normalize internally
}

export function SeverityBadge({ severity }: SeverityBadgeProps) {
  // Normalize input to lowercase
  const normalized = (severity || "").toLowerCase().trim();

  const variants: Record<string, string> = {
    critical: "bg-destructive/20 text-destructive border-destructive/30",
    high: "bg-severity-high/20 text-severity-high border-severity-high/30",
    medium: "bg-severity-medium/20 text-severity-medium border-severity-medium/30",
    low: "bg-severity-low/20 text-severity-low border-severity-low/30",
  };

  // Default to "medium" style if we get an unexpected severity
  const classes = variants[normalized] ?? variants["medium"];
  const label = normalized ? normalized.toUpperCase() : "UNKNOWN";

  return (
    <Badge variant="outline" className={classes}>
      {label}
    </Badge>
  );
}
