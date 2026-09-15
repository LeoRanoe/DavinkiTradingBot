import type { CanonicalCandle } from "@/lib/domain/market-data-provider";

/**
 * Buy-and-hold market benchmark (Checkpoint 3A §23). This is NOT a
 * strategy competing under identical risk sizing — it's the market's own
 * return over the same period, for context. Actual strategy-vs-benchmark
 * comparison happens in Checkpoint 3B.
 *
 * Convention: buy at the FIRST candle's open (the first executable price
 * in the research period — consistent with the engine's own "next-bar
 * open" fill convention elsewhere in this namespace), hold to the LAST
 * candle's close.
 */
export type BenchmarkResult = {
  startTime: number;
  endTime: number;
  startPrice: number;
  endPrice: number;
  totalReturn: number; // (endPrice - startPrice) / startPrice
  maxDrawdownPct: number; // peak-to-trough on the candle close series
};

export function computeBuyAndHoldBenchmark(candles: readonly CanonicalCandle[]): BenchmarkResult {
  if (candles.length === 0) {
    throw new Error("computeBuyAndHoldBenchmark: candles must not be empty");
  }

  const startPrice = candles[0].open;
  const endPrice = candles[candles.length - 1].close;

  let peak = startPrice;
  let maxDrawdownPct = 0;
  for (const c of candles) {
    peak = Math.max(peak, c.close);
    const drawdown = peak > 0 ? (peak - c.close) / peak : 0;
    maxDrawdownPct = Math.max(maxDrawdownPct, drawdown);
  }

  return {
    startTime: candles[0].openTime,
    endTime: candles[candles.length - 1].openTime,
    startPrice,
    endPrice,
    totalReturn: (endPrice - startPrice) / startPrice,
    maxDrawdownPct,
  };
}
