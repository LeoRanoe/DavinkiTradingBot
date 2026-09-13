import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type SystemHealthLevel = "HEALTHY" | "WARNING" | "ERROR" | "UNKNOWN";

const STYLES: Record<SystemHealthLevel, string> = {
  HEALTHY: "bg-positive/15 text-positive border-positive/30",
  WARNING: "bg-warning/15 text-warning border-warning/30",
  ERROR: "bg-negative/15 text-negative border-negative/30",
  UNKNOWN: "bg-muted text-muted-foreground border-border",
};

export function SystemStatusBadge({ level, label }: { level: SystemHealthLevel; label?: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", STYLES[level])}>
      {label ?? level}
    </Badge>
  );
}
