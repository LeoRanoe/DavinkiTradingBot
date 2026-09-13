import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TradingMode } from "@/lib/types/trading-mode";

const MODE_STYLES: Record<TradingMode, string> = {
  OBSERVE: "bg-info/15 text-info border-info/30",
  PAPER: "bg-warning/15 text-warning border-warning/30",
  DEMO: "bg-positive/15 text-positive border-positive/30",
  LIVE: "bg-negative/15 text-negative border-negative/30",
};

/** Always-visible trading mode indicator (spec #3: mode must be extremely visible). */
export function ModeBadge({ mode }: { mode: TradingMode }) {
  return (
    <Badge variant="outline" className={cn("font-medium tracking-wide", MODE_STYLES[mode])}>
      {mode}
      {mode === "LIVE" ? " (DISABLED)" : ""}
    </Badge>
  );
}
