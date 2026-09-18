import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/auth/authorization";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/dashboard/empty-state";
import { MetricCard } from "@/components/dashboard/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Coins } from "lucide-react";
import { listJeanfxGoldPaperTrades, listJeanfxGoldSessionDiagnostics, isMissingTableError } from "@/lib/strategy-platform/gold/db";
import { computeJeanfxGoldPerformance } from "@/lib/strategy-platform/gold/performance";

/**
 * JeanFX Gold (XAU/USD) PAPER performance + frequency diagnostics
 * (brief S12/S13) - deliberately its OWN page, reading ONLY
 * jeanfx_gold_paper_trades/jeanfx_gold_session_diagnostics, never V1's
 * `trades` table or the generic strategy-platform's `strategy_*` tables -
 * "Do not mix with V1 crypto / TRB / custom strategies."
 */
const DEFAULT_RESEARCH_EQUITY = 100_000; // IMPLEMENTATION ASSUMPTION: no dedicated Gold PAPER account-equity setting exists yet - see docs/strategies/jeanfx-gold-activation.md.

export default async function JeanfxGoldPerformancePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isOwner(user)) redirect("/dashboard");

  const [tradesResult, diagnosticsResult] = await Promise.all([listJeanfxGoldPaperTrades(supabase, user.id), listJeanfxGoldSessionDiagnostics(supabase, user.id)]);

  if (tradesResult.error && isMissingTableError(tradesResult.error)) {
    return (
      <div className="max-w-4xl space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">JeanFX Gold (XAU/USD)</h1>
        <p className="text-muted-foreground text-sm">JeanFX Gold tables are not yet available - the jeanfx_gold_paper migration has not been applied to this environment.</p>
      </div>
    );
  }

  const trades = tradesResult.data ?? [];
  const diagnostics = diagnosticsResult.data ?? [];
  const { openTrades, closedTrades, metrics } = computeJeanfxGoldPerformance(trades, DEFAULT_RESEARCH_EQUITY);

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">JeanFX Gold (XAU/USD)</h1>
        <p className="text-muted-foreground text-sm">PAPER-only research evidence for the JeanFX Gold configuration - isolated from V1 crypto, TRB, and custom strategies.</p>
      </div>

      {trades.length === 0 ? (
        <EmptyState icon={Coins} title="No JeanFX Gold PAPER trades yet" />
      ) : (
        <>
          {metrics.insufficientSample ? <p className="text-warning text-sm">{closedTrades.length} closed trade{closedTrades.length === 1 ? "" : "s"} - too few for statistical conclusions.</p> : null}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricCard label="Open Trades" value={`${openTrades.length}`} />
            <MetricCard label="Closed Trades" value={`${closedTrades.length}`} />
            <MetricCard label="Net P/L" value={`${metrics.netReturn >= 0 ? "+" : ""}$${metrics.netReturn.toFixed(2)}`} tone={metrics.netReturn >= 0 ? "positive" : "negative"} />
            <MetricCard label="Win Rate" value={metrics.winRate !== null ? `${(metrics.winRate * 100).toFixed(0)}%` : "-"} />
            <MetricCard label="Expectancy (R)" value={metrics.expectancyR !== null ? metrics.expectancyR.toFixed(2) : "-"} />
            <MetricCard label="Profit Factor" value={metrics.profitFactor !== null && Number.isFinite(metrics.profitFactor) ? metrics.profitFactor.toFixed(2) : "-"} />
            <MetricCard label="Avg Win (R)" value={metrics.avgWinR !== null ? metrics.avgWinR.toFixed(2) : "-"} />
            <MetricCard label="Avg Loss (R)" value={metrics.avgLossR !== null ? metrics.avgLossR.toFixed(2) : "-"} />
            <MetricCard label="Max Drawdown" value={`${(metrics.maxDrawdownPct * 100).toFixed(1)}%`} />
            <MetricCard label="Total Costs" value={`$${metrics.totalFees.toFixed(2)}`} />
          </div>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Frequency diagnostics - by session</CardTitle>
        </CardHeader>
        <CardContent>
          {diagnostics.length === 0 ? (
            <p className="text-muted-foreground text-sm">No session diagnostics recorded yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Session</TableHead>
                    <TableHead>Sweeps</TableHead>
                    <TableHead>MSS/BOS</TableHead>
                    <TableHead>FVGs</TableHead>
                    <TableHead>Retraces</TableHead>
                    <TableHead>Confirmations</TableHead>
                    <TableHead>Ready</TableHead>
                    <TableHead>RR Rejected</TableHead>
                    <TableHead>Risk Rejected</TableHead>
                    <TableHead>Executed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {diagnostics.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>{d.session_date}</TableCell>
                      <TableCell>{d.session}</TableCell>
                      <TableCell>{d.liquidity_sweeps}</TableCell>
                      <TableCell>{d.mss_bos}</TableCell>
                      <TableCell>{d.fvgs}</TableCell>
                      <TableCell>{d.retraces}</TableCell>
                      <TableCell>{d.confirmations}</TableCell>
                      <TableCell>{d.ready_setups}</TableCell>
                      <TableCell>{d.rr_rejected}</TableCell>
                      <TableCell>{d.risk_rejected}</TableCell>
                      <TableCell>{d.executed}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
