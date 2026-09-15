import type { CanonicalCandle } from "@/lib/domain/market-data-provider";
import { runResearchBacktest, type ResearchBacktestConfig, type ResearchBacktestResult } from "./engine";
import type { SplitRange } from "./split";
import type { StrategyDefinition, StrategyParameterSet } from "./strategy";

/**
 * Segment (development/validation/holdout) execution wrapper implementing
 * Checkpoint 3A.1 §6's warm-up semantics: "context candles = historical
 * data up to segment end; trade window = [segmentStart, segmentEnd]".
 *
 * This is NOT look-ahead: every context candle before `window.startIndex`
 * is legally already known (it happened before the segment began) - a
 * strategy needing e.g. a 100-bar channel is legally allowed to read the
 * 100 bars immediately preceding the segment's own first bar to warm up.
 * What must never happen is a signal from BEFORE the segment opening a
 * trade that gets reported as belonging to the segment - `engine.ts`'s
 * `tradeWindowStartIndex` option (used here) enforces exactly that at
 * the trade-decision level, not just at the reporting level.
 *
 * No position ever leaks across a segment boundary: every trade in the
 * result has `entryCandleIndex >= window.startIndex` by construction
 * (the engine gates entries on `tradeWindowStartIndex`), and the
 * segment's own equity curve starts flat, at the window's own start
 * time, at `initialEquity` - no trade can have touched equity before
 * that time.
 */
export function runSegmentBacktest<TParams extends Record<string, unknown>>(
  fullHistory: readonly CanonicalCandle[],
  window: SplitRange,
  strategy: StrategyDefinition<TParams>,
  paramSet: StrategyParameterSet<TParams>,
  config: ResearchBacktestConfig,
): ResearchBacktestResult {
  if (window.startIndex < 0 || window.endIndex > fullHistory.length || window.startIndex > window.endIndex) {
    throw new Error(
      `runSegmentBacktest: invalid window [${window.startIndex}, ${window.endIndex}) for a history of length ${fullHistory.length}.`,
    );
  }

  if (window.startIndex === window.endIndex) {
    // Empty segment - nothing to warm up on, nothing to trade. Explicit,
    // deterministic no-op rather than an engine call on an empty slice.
    return { trades: [], skips: [], finalEquity: config.risk.initialEquity, equityCurve: [] };
  }

  // Context = everything up to (and including) the segment's own end -
  // this is what supplies legal warm-up history for the segment's first
  // tradeable bars.
  const contextCandles = fullHistory.slice(0, window.endIndex);

  const result = runResearchBacktest(contextCandles, strategy, paramSet, {
    ...config,
    tradeWindowStartIndex: window.startIndex,
  });

  // Report a segment-local equity curve: flat at initialEquity from the
  // segment's own start time (no trade can have opened before it), then
  // only the realized-trade points that actually happened inside the
  // segment. This is what "start each evaluation split flat" means in
  // curve terms - it is not a re-computation, just a re-anchored view of
  // the same (already correctly gated) trades.
  const windowStartTime = fullHistory[window.startIndex].openTime;
  const segmentEquityCurve = [
    { time: windowStartTime, equity: config.risk.initialEquity },
    ...result.equityCurve.filter((p) => p.time > windowStartTime),
  ];

  return { ...result, equityCurve: segmentEquityCurve };
}
