import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function MetricCard({
  label,
  value,
  sublabel,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sublabel?: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  return (
    <Card className="gap-2 border-border/80 py-4 shadow-none">
      <CardHeader className="px-4">
        <CardTitle className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        <div
          className={cn(
            "font-mono text-xl font-semibold tabular-nums sm:text-2xl",
            tone === "positive" && "text-positive",
            tone === "negative" && "text-negative",
          )}
        >
          {value}
        </div>
        {sublabel ? <p className="text-muted-foreground mt-1 text-xs">{sublabel}</p> : null}
      </CardContent>
    </Card>
  );
}
