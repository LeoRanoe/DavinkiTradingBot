import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const CLASSIFICATION_STYLES: Record<string, string> = {
  IGNORE: "bg-muted text-muted-foreground border-border",
  LOG: "bg-muted text-muted-foreground border-border",
  WATCH: "bg-info/15 text-info border-info/30",
  CANDIDATE: "bg-positive/15 text-positive border-positive/30",
};

export function ClassificationBadge({ classification }: { classification: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", CLASSIFICATION_STYLES[classification])}>
      {classification}
    </Badge>
  );
}

export function SetupScore({ score, classification }: { score: number; classification: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-sm font-semibold tabular-nums">{score}/100</span>
      <ClassificationBadge classification={classification} />
    </div>
  );
}
