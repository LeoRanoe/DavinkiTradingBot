import type { BacktestMetrics, BacktestTradeRecord } from "./types";

const MIN_SAMPLE_FOR_STATS = 20;

/**
 * The only fields computeMetrics actually reads. Narrowed (rather than the
 * full BacktestTradeRecord) so this function works for any backtest trade
 * shape that carries these three fields - V1's own BacktestTradeRecord (via
 * structural compatibility) and the generic engine's
 * GenericBacktestTradeRecord (lib/strategy-platform/backtest.ts) alike,
 * without a V1-specific "score"/"regime" requirement leaking into a
 * generic caller. Pure type narrowing - no behavior change for V1.
 */
export type TradeOutcomeFields = Pick<BacktestTradeRecord, "pnl" | "rMultiple" | "fees">;

/**
 * Computes backtest performance metrics from a list of closed trades.
 * Never overinterprets small samples: `insufficientSample` is set (and the
 * UI must say so) below MIN_SAMPLE_FOR_STATS closed trades.
 */
export function computeMetrics(
  trades: TradeOutcomeFields[],
  initialEquity: number,
  totalFees: number,
): BacktestMetrics {
  const closed = trades.filter((t) => t.pnl !== null);
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0);
  const losses = closed.filter((t) => (t.pnl ?? 0) <= 0);

  const grossReturn = closed.reduce((sum, t) => sum + (t.pnl ?? 0) + t.fees, 0);
  const netReturn = closed.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const finalEquity = initialEquity + netReturn;

  const avgWinR = wins.length ? avg(wins.map((t) => t.rMultiple ?? 0)) : null;
  const avgLossR = losses.length ? avg(losses.map((t) => t.rMultiple ?? 0)) : null;
  const winRate = closed.length ? wins.length / closed.length : null;

  const expectancyR =
    winRate !== null && avgWinR !== null && avgLossR !== null
      ? winRate * avgWinR + (1 - winRate) * avgLossR
      : null;

  const grossProfit = wins.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.pnl ?? 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : wins.length > 0 ? Infinity : null;

  // Equity curve + max drawdown.
  let equity = initialEquity;
  let peak = initialEquity;
  let maxDrawdownPct = 0;
  for (const t of closed) {
    equity += t.pnl ?? 0;
    peak = Math.max(peak, equity);
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    maxDrawdownPct = Math.max(maxDrawdownPct, dd);
  }

  // Max consecutive losing streak.
  let streak = 0;
  let maxStreak = 0;
  for (const t of closed) {
    if ((t.pnl ?? 0) <= 0) {
      streak += 1;
      maxStreak = Math.max(maxStreak, streak);
    } else {
      streak = 0;
    }
  }

  return {
    tradeCount: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    avgWinR,
    avgLossR,
    expectancyR,
    profitFactor: profitFactor === Infinity ? null : profitFactor,
    grossReturn,
    netReturn,
    totalFees,
    maxDrawdownPct,
    maxLosingStreak: maxStreak,
    finalEquity,
    insufficientSample: closed.length < MIN_SAMPLE_FOR_STATS,
  };
}

function avg(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
