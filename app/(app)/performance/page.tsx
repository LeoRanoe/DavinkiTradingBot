import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/dashboard/empty-state";
import { MetricCard } from "@/components/dashboard/metric-card";
import { BarChart3 } from "lucide-react";

const MIN_SAMPLE = 20;

export default async function PerformancePage() {
  const supabase = await createClient();
  const { data: closedTrades } = await supabase.from("trades").select("pnl, r_multiple, fees").eq("status", "CLOSED");

  const trades = closedTrades ?? [];
  const wins = trades.filter((t) => (t.pnl ?? 0) > 0);
  const losses = trades.filter((t) => (t.pnl ?? 0) <= 0);
  const netPnl = trades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const totalFees = trades.reduce((s, t) => s + (t.fees ?? 0), 0);
  const winRate = trades.length ? (wins.length / trades.length) * 100 : null;
  const insufficientSample = trades.length < MIN_SAMPLE;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Performance</h1>
        <p className="text-muted-foreground text-sm">Based on closed PAPER trades.</p>
      </div>

      {trades.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="No closed trades yet"
          description="Performance analytics appear once at least one paper trade has closed."
        />
      ) : (
        <>
          {insufficientSample ? (
            <p className="text-warning text-sm">
              Only {trades.length} closed trade{trades.length === 1 ? "" : "s"} so far - too few to draw statistical
              conclusions. Numbers below are shown for reference only.
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard label="Net P/L" value={`${netPnl >= 0 ? "+" : ""}$${netPnl.toFixed(2)}`} tone={netPnl >= 0 ? "positive" : "negative"} />
            <MetricCard label="Win Rate" value={winRate !== null ? `${winRate.toFixed(0)}%` : "-"} />
            <MetricCard label="Trades" value={`${trades.length}`} sublabel={`${wins.length}W / ${losses.length}L`} />
            <MetricCard label="Total Fees" value={`$${totalFees.toFixed(2)}`} />
          </div>
        </>
      )}
    </div>
  );
}
