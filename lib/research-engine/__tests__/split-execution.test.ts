import { describe, expect, it } from "vitest";
import type { CanonicalCandle } from "@/lib/domain/market-data-provider";
import { runSegmentBacktest } from "../split-execution";
import { ZERO_COST_MODEL } from "../cost-model";
import type { NormalizedRiskConfig } from "../position-sizing";
import { TRB_STRATEGY, getTrbParameterSet } from "../strategies/trb";

function candle(overrides: Partial<CanonicalCandle> = {}): CanonicalCandle {
  return {
    instrumentId: "TEST",
    timeframe: "1H",
    openTime: 0,
    open: 100,
    high: 100,
    low: 100,
    close: 100,
    volume: 10,
    isClosed: true,
    ...overrides,
  };
}

const RISK: NormalizedRiskConfig = { initialEquity: 10_000, riskPct: 0.01 };
const paramSet = getTrbParameterSet("TRB-1H-20-10")!; // entryLookback=20, exitLookback=10

/**
 * 20 flat warm-up bars, then a breakout signal + fill INSIDE the segment
 * window, so a test can assert the segment can use the warm-up context
 * without the segment "owning" any bar before its own start.
 */
function buildWarmupThenBreakoutSeries(): CanonicalCandle[] {
  const bars: CanonicalCandle[] = [];
  let t = 0;
  const push = (o: Partial<CanonicalCandle>) => {
    bars.push(candle({ openTime: t, ...o }));
    t += 3_600_000;
  };
  for (let i = 0; i < 20; i++) push({ open: 100, high: 100, low: 95, close: 100 }); // bars 0-19: warm-up channel
  push({ open: 100, high: 101, low: 99, close: 101 }); // bar 20: breakout signal
  push({ open: 101.5, high: 103, low: 101, close: 102.5 }); // bar 21: entry fill
  for (let i = 0; i < 5; i++) push({ open: 102.5 + i, high: 104 + i, low: 101 + i, close: 103 + i }); // trending up
  push({ open: 108, high: 108, low: 90, close: 90 }); // exit signal
  push({ open: 89, high: 90, low: 88, close: 89 }); // exit fill
  return bars;
}

/**
 * Same warm-up + single breakout shape, but flat/non-trending AFTER the
 * signal bar so the entry channel never re-breaks on a later bar. Used
 * specifically to prove a pre-window signal cannot leak into the window
 * WITHOUT that assertion being confounded by a second, legitimately
 * in-window breakout re-triggering on the following bars.
 */
function buildSingleNonRetriggeringSignalSeries(): CanonicalCandle[] {
  const bars: CanonicalCandle[] = [];
  let t = 0;
  const push = (o: Partial<CanonicalCandle>) => {
    bars.push(candle({ openTime: t, ...o }));
    t += 3_600_000;
  };
  for (let i = 0; i < 20; i++) push({ open: 100, high: 100, low: 95, close: 100 }); // bars 0-19: warm-up channel
  push({ open: 100, high: 101, low: 99, close: 101 }); // bar 20: breakout signal (close 101 > channel high 100)
  for (let i = 0; i < 10; i++) push({ open: 100.5, high: 100.5, low: 100, close: 100.5 }); // bars 21-30: flat, below 101, never re-breaks
  return bars;
}

describe("runSegmentBacktest (§6) — context candles up to segment end; trade window = [segmentStart, segmentEnd]", () => {
  it("a segment whose window starts AFTER the strategy's warm-up requirement can still use prior context to trade", () => {
    const candles = buildWarmupThenBreakoutSeries();
    // Window starts at bar 20 (the signal bar itself) - the 20-bar warm-up
    // channel (bars 0-19) is legal prior context, not part of the window.
    const result = runSegmentBacktest(candles, { startIndex: 20, endIndex: candles.length }, TRB_STRATEGY, paramSet, {
      risk: RISK,
      cost: ZERO_COST_MODEL,
    });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].entryCandleIndex).toBe(21);
  });

  it("a segment starting AFTER the signal bar cannot retroactively open that trade (no leak across the boundary)", () => {
    const candles = buildSingleNonRetriggeringSignalSeries();
    // Window starts at bar 21 (the fill bar) - the signal itself was at
    // bar 20, before the window, so it must not produce a trade here.
    const result = runSegmentBacktest(candles, { startIndex: 21, endIndex: candles.length }, TRB_STRATEGY, paramSet, {
      risk: RISK,
      cost: ZERO_COST_MODEL,
    });
    expect(result.trades).toHaveLength(0);
  });

  it("the segment's equity curve starts flat at initialEquity, at the window's own start time", () => {
    const candles = buildWarmupThenBreakoutSeries();
    const result = runSegmentBacktest(candles, { startIndex: 20, endIndex: candles.length }, TRB_STRATEGY, paramSet, {
      risk: RISK,
      cost: ZERO_COST_MODEL,
    });
    expect(result.equityCurve[0]).toEqual({ time: candles[20].openTime, equity: RISK.initialEquity });
  });

  it("no future data is visible even across the context/window split (no-lookahead holds)", () => {
    const candles = buildWarmupThenBreakoutSeries();
    let maxIndexSeen = -1;
    const spyStrategy = {
      ...TRB_STRATEGY,
      evaluateEntry(closedCandles: readonly CanonicalCandle[], params: typeof paramSet) {
        maxIndexSeen = Math.max(maxIndexSeen, closedCandles.length - 1);
        return TRB_STRATEGY.evaluateEntry(closedCandles, params);
      },
    };
    runSegmentBacktest(candles, { startIndex: 20, endIndex: 25 }, spyStrategy, paramSet, { risk: RISK, cost: ZERO_COST_MODEL });
    expect(maxIndexSeen).toBeLessThanOrEqual(24);
  });

  it("an empty window (startIndex === endIndex) is a deterministic no-op, never an engine call on an empty slice", () => {
    const candles = buildWarmupThenBreakoutSeries();
    const result = runSegmentBacktest(candles, { startIndex: 10, endIndex: 10 }, TRB_STRATEGY, paramSet, {
      risk: RISK,
      cost: ZERO_COST_MODEL,
    });
    expect(result.trades).toHaveLength(0);
    expect(result.finalEquity).toBe(RISK.initialEquity);
  });

  it("throws on an out-of-range window", () => {
    const candles = buildWarmupThenBreakoutSeries();
    expect(() =>
      runSegmentBacktest(candles, { startIndex: 0, endIndex: candles.length + 5 }, TRB_STRATEGY, paramSet, {
        risk: RISK,
        cost: ZERO_COST_MODEL,
      }),
    ).toThrow(/invalid window/);
  });
});
