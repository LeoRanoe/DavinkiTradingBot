import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared building blocks for the app UI, used instead of reaching for a new
 * <Card> for every piece of information. Keep this file small - a handful
 * of primitives reused everywhere beats dozens of near-identical ones.
 */

/** Page title, optionally with trailing controls. No subtitle by default -
 * add one only when it says something the title doesn't. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-muted-foreground mt-0.5 text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** A single labeled number, no card chrome. Use for top-of-page status rows. */
export function Stat({
  label,
  value,
  tone = "neutral",
  sublabel,
}: {
  label: string;
  value: ReactNode;
  tone?: "neutral" | "positive" | "negative";
  sublabel?: string;
}) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div
        className={cn(
          "mt-0.5 font-mono text-xl font-semibold tabular-nums sm:text-2xl",
          tone === "positive" && "text-positive",
          tone === "negative" && "text-negative",
        )}
      >
        {value}
      </div>
      {sublabel ? <div className="text-muted-foreground mt-0.5 text-xs">{sublabel}</div> : null}
    </div>
  );
}

const DOT_TONE: Record<"positive" | "negative" | "warning" | "neutral", string> = {
  positive: "bg-positive",
  negative: "bg-negative",
  warning: "bg-warning",
  neutral: "bg-muted-foreground/50",
};

/** Small status indicator dot, e.g. "● Online". Pairs with a short label. */
export function StatusDot({
  tone = "neutral",
  className,
}: {
  tone?: "positive" | "negative" | "warning" | "neutral";
  className?: string;
}) {
  return <span className={cn("inline-block size-1.5 rounded-full", DOT_TONE[tone], className)} aria-hidden />;
}

/** "BTC / USDT" from a raw "BTCUSDT" symbol. Falls back to the raw string. */
export function TradingPair({ symbol, className }: { symbol: string; className?: string }) {
  const match = /^([A-Z]{2,10})(USDT|USDC|USD)$/.exec(symbol);
  return (
    <span className={cn("font-medium", className)}>
      {match ? `${match[1]} / ${match[2]}` : symbol}
    </span>
  );
}

/** Compact relative time - "4m ago", "2h ago" - for secondary metadata. */
export function relativeTimeShort(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "-";
  const diffMs = now - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function Timestamp({ iso, className }: { iso: string | null | undefined; className?: string }) {
  return <span className={cn("font-mono text-xs", className)}>{relativeTimeShort(iso)}</span>;
}

/** Signed value with automatic positive/negative tone. */
export function ValueChange({ value, format, className }: { value: number | null; format: (n: number) => string; className?: string }) {
  if (value === null) return <span className={cn("text-muted-foreground", className)}>-</span>;
  return (
    <span className={cn("tabular-nums", value >= 0 ? "text-positive" : "text-negative", className)}>
      {value >= 0 ? "+" : ""}
      {format(value)}
    </span>
  );
}

/** A compact label/value row - for stat rails under a chart, detail panels, etc. */
export function DataRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
