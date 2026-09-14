import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/dashboard/empty-state";
import { MetricCard } from "@/components/dashboard/metric-card";
import { BarChart3 } from "lucide-react";
import { PerformanceCharts } from "@/components/charts/performance-charts";

const MIN_SAMPLE = 20;

export default async function PerformancePage() {
  const supabase = await createClient();
  const [{ data: closedTrades }, { data: snapshots }] = await Promise.all([supabase.from("trades").select("pnl, r_multiple, fees, closed_at, symbol").eq("status", "CLOSED").order("closed_at", { ascending: true }).limit(500), supabase.from("portfolio_snapshots").select("equity, taken_at").eq("trading_mode", "PAPER").order("taken_at", { ascending: true }).limit(500)]);

  const trades = closedTrades ?? [];
  const wins = trades.filter((t) => (t.pnl ?? 0) > 0);
  const losses = trades.filter((t) => (t.pnl ?? 0) <= 0);
  const netPnl = trades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const totalFees = trades.reduce((s, t) => s + (t.fees ?? 0), 0);
  const winRate = trades.length ? (wins.length / trades.length) * 100 : null;
  const insufficientSample = trades.length < MIN_SAMPLE;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Performance</h1>

      {trades.length === 0 ? (
        <EmptyState icon={BarChart3} title="No result" />
      ) : (
        <>
          {insufficientSample ? (
            <p className="text-warning text-sm">
              {trades.length} closed trade{trades.length === 1 ? "" : "s"} - too few for statistical conclusions.
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard label="Net P/L" value={`${netPnl >= 0 ? "+" : ""}$${netPnl.toFixed(2)}`} tone={netPnl >= 0 ? "positive" : "negative"} />
            <MetricCard label="Win Rate" value={winRate !== null ? `${winRate.toFixed(0)}%` : "-"} />
            <MetricCard label="Trades" value={`${trades.length}`} sublabel={`${wins.length}W / ${losses.length}L`} />
            <MetricCard label="Total Fees" value={`$${totalFees.toFixed(2)}`} />
          </div>
          <PerformanceCharts equity={(snapshots ?? []).map((row) => ({ time: new Date(row.taken_at).getTime(), equity: Number(row.equity) }))} trades={trades.map((row) => ({ time: row.closed_at ? new Date(row.closed_at).getTime() : 0, r: row.r_multiple, pnl: row.pnl, symbol: row.symbol }))} />
        </>
      )}
    </div>
  );
}
