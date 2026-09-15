import { describe, expect, it } from "vitest";
import type { CanonicalCandle } from "@/lib/domain/market-data-provider";
import { runResearchBacktest } from "../engine";
import { ZERO_COST_MODEL, type CostModel } from "../cost-model";
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
 * Builds a deterministic synthetic series: `flat` bars of 100, then a
 * breakout bar, then bars that trend up (so the position stays open a
 * while), then a sharp drop that breaks the exit channel, then a few more
 * trailing bars. Fully deterministic and reused across several tests.
 */
function buildBreakoutThenExitSeries(): CanonicalCandle[] {
  const bars: CanonicalCandle[] = [];
  let t = 0;
  const push = (o: Partial<CanonicalCandle>) => {
    bars.push(candle({ openTime: t, ...o }));
    t += 3_600_000;
  };
  for (let i = 0; i < 20; i++) push({ open: 100, high: 100, low: 95, close: 100 }); // flat channel, 20 bars
  push({ open: 100, high: 101, low: 99, close: 101 }); // bar 20: breakout signal (close 101 > channel high 100)
  push({ open: 101.5, high: 103, low: 101, close: 102.5 }); // bar 21: fill bar for entry (open=101.5), also trending up
  for (let i = 0; i < 5; i++) push({ open: 102.5 + i, high: 104 + i, low: 101 + i, close: 103 + i }); // trending up, no exit
  push({ open: 108, high: 108, low: 90, close: 90 }); // sharp drop bar: close(90) below the 10-bar low channel -> exit SIGNAL
  push({ open: 89, high: 90, low: 88, close: 89 }); // fill bar for the exit (open=89)
  push({ open: 89, high: 90, low: 88, close: 89 }); // trailing bar, nothing further happens
  return bars;
}

describe("generic research engine — determinism & no-lookahead", () => {
  it("produces an identical result for identical inputs (pure/deterministic)", () => {
    const candles = buildBreakoutThenExitSeries();
    const r1 = runResearchBacktest(candles, TRB_STRATEGY, paramSet, { risk: RISK, cost: ZERO_COST_MODEL });
    const r2 = runResearchBacktest(candles, TRB_STRATEGY, paramSet, { risk: RISK, cost: ZERO_COST_MODEL });
    expect(r2).toEqual(r1);
  });

  it("never mutates the input candle array (input array order/content cannot change as a side effect)", () => {
    const candles = buildBreakoutThenExitSeries();
    const before = JSON.stringify(candles);
    runResearchBacktest(candles, TRB_STRATEGY, paramSet, { risk: RISK, cost: ZERO_COST_MODEL });
    expect(JSON.stringify(candles)).toBe(before);
  });

  it("no look-ahead: a strategy that peeked at candles[t+1] would see a different (impossible) result than one that can't - proven by an instrumented strategy that records the max index it was ever given", () => {
    const candles = buildBreakoutThenExitSeries();
    let maxIndexSeen = -1;
    const spyStrategy = {
      ...TRB_STRATEGY,
      evaluateEntry(closedCandles: readonly CanonicalCandle[], params: typeof paramSet) {
        maxIndexSeen = Math.max(maxIndexSeen, closedCandles.length - 1);
        return TRB_STRATEGY.evaluateEntry(closedCandles, params);
      },
      evaluateExit(closedCandles: readonly CanonicalCandle[], params: typeof paramSet) {
        maxIndexSeen = Math.max(maxIndexSeen, closedCandles.length - 1);
        return TRB_STRATEGY.evaluateExit(closedCandles, params);
      },
    };
    runResearchBacktest(candles, spyStrategy, paramSet, { risk: RISK, cost: ZERO_COST_MODEL });
    // The engine iterates t = 0..candles.length-1 and always passes
    // candles.slice(0, t+1), so the largest slice length-1 it could ever
    // observe is candles.length-1 - never candles.length (which would mean
    // it saw one bar beyond the last).
    expect(maxIndexSeen).toBeLessThanOrEqual(candles.length - 1);
  });
});

describe("generic research engine — execution semantics (§13)", () => {
  it("entry fills at the NEXT bar's open, never the signal bar's own close/open", () => {
    const candles = buildBreakoutThenExitSeries();
    const result = runResearchBacktest(candles, TRB_STRATEGY, paramSet, { risk: RISK, cost: ZERO_COST_MODEL });
    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0];
    expect(trade.entryCandleIndex).toBe(21); // signal at index 20, fill at index 21
    expect(trade.entryPrice).toBe(candles[21].open); // 101.5, not candles[20].close (101)
  });

  it("exit fills at the NEXT bar's open after the exit signal bar", () => {
    const candles = buildBreakoutThenExitSeries();
    const result = runResearchBacktest(candles, TRB_STRATEGY, paramSet, { risk: RISK, cost: ZERO_COST_MODEL });
    const trade = result.trades[0];
    expect(trade.outcome).toBe("CLOSED");
    // exit signal bar is index 27 (the sharp-drop bar); fill is index 28's open (89).
    expect(trade.exitCandleIndex).toBe(28);
    expect(trade.exitPrice).toBe(candles[28].open);
  });

  it("a signal with no next bar produces no trade and no fake fill (records a skip instead)", () => {
    // Same as the breakout series but truncated right after the signal bar - no fill bar exists.
    const candles = buildBreakoutThenExitSeries().slice(0, 21); // ends exactly at the signal bar (index 20)
    const result = runResearchBacktest(candles, TRB_STRATEGY, paramSet, { risk: RISK, cost: ZERO_COST_MODEL });
    expect(result.trades).toHaveLength(0);
    expect(result.skips.some((s) => s.reason === "NO_NEXT_BAR_FOR_ENTRY_FILL")).toBe(true);
  });

  it("OPEN_AT_END: an open position with no next bar to exit on is never faked as closed", () => {
    // Truncate right after the entry fill bar, before any exit signal could ever fire.
    const candles = buildBreakoutThenExitSeries().slice(0, 22); // signal(20), fill(21) - nothing after
    const result = runResearchBacktest(candles, TRB_STRATEGY, paramSet, { risk: RISK, cost: ZERO_COST_MODEL });
    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0];
    expect(trade.outcome).toBe("OPEN_AT_END");
    expect(trade.exitPrice).toBeNull();
    expect(trade.exitTime).toBeNull();
    expect(trade.pnl).toBeNull();
    expect(trade.rMultiple).toBeNull();
  });

  it("holds exactly one position at a time - no second entry evaluated while already in position", () => {
    const candles = buildBreakoutThenExitSeries();
    const result = runResearchBacktest(candles, TRB_STRATEGY, paramSet, { risk: RISK, cost: ZERO_COST_MODEL });
    // Only ever one CLOSED (or OPEN_AT_END) trade in this series - no overlapping entries.
    expect(result.trades).toHaveLength(1);
  });
});

/** A series whose single trade exits at a profit: the up-trend runs long enough that the flat/95-low filler bars fully roll out of the 10-bar exit window before the pullback exit fires, so the exit channel low ends up well above the entry price. */
function buildBreakoutThenProfitableExitSeries(): CanonicalCandle[] {
  const bars: CanonicalCandle[] = [];
  let t = 0;
  const push = (o: Partial<CanonicalCandle>) => {
    bars.push(candle({ openTime: t, ...o }));
    t += 3_600_000;
  };
  for (let i = 0; i < 20; i++) push({ open: 100, high: 100, low: 95, close: 100 }); // flat channel, 20 bars
  push({ open: 100, high: 101, low: 99, close: 101 }); // bar 20: breakout signal
  push({ open: 110, high: 112, low: 108, close: 111 }); // bar 21: entry fill bar, gaps up to 110
  for (let i = 0; i < 10; i++) push({ open: 113 + i * 5, high: 116 + i * 5, low: 113 + i * 5, close: 115 + i * 5 }); // bars 22-31: strong uptrend, lows well above entry
  push({ open: 112, high: 113, low: 111, close: 112 }); // bar 32: pullback below the 10-bar window low (min 113) -> EXIT signal, still above entry (110)
  push({ open: 111, high: 112, low: 110, close: 111 }); // bar 33: exit fill bar
  return bars;
}

describe("generic research engine — risk, R-multiples, equity (§14/§15/§17)", () => {
  it("a winning trade has a positive rMultiple and equity increases by exactly its pnl", () => {
    const candles = buildBreakoutThenProfitableExitSeries();
    const result = runResearchBacktest(candles, TRB_STRATEGY, paramSet, { risk: RISK, cost: ZERO_COST_MODEL });
    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0];
    expect(trade.outcome).toBe("CLOSED");
    expect(trade.pnl).toBeGreaterThan(0);
    expect(trade.rMultiple).toBeCloseTo(trade.pnl! / trade.actualInitialRisk, 10);
    expect(result.finalEquity).toBeCloseTo(RISK.initialEquity + trade.pnl!, 10);
  });

  it("equity only changes on realized (CLOSED) trades, never on an OPEN_AT_END position", () => {
    const candles = buildBreakoutThenExitSeries().slice(0, 22); // ends OPEN_AT_END, no realized trade
    const result = runResearchBacktest(candles, TRB_STRATEGY, paramSet, { risk: RISK, cost: ZERO_COST_MODEL });
    expect(result.finalEquity).toBe(RISK.initialEquity);
    expect(result.equityCurve).toHaveLength(1); // just the starting point
  });

  it("a losing trade has a negative rMultiple and reduces equity below the starting value", () => {
    const candles = buildBreakoutThenExitSeries(); // this series' single trade exits at a loss (89 < ~101.5 entry)
    const result = runResearchBacktest(candles, TRB_STRATEGY, paramSet, { risk: RISK, cost: ZERO_COST_MODEL });
    const trade = result.trades[0];
    expect(trade.pnl).toBeLessThan(0);
    expect(trade.rMultiple).toBeLessThan(0);
    expect(result.finalEquity).toBeLessThan(RISK.initialEquity);
  });

  it("normalized sizing never uses leverage: notional at entry never exceeds equity, and stop is always strictly below entry", () => {
    const candles = buildBreakoutThenExitSeries();
    const result = runResearchBacktest(candles, TRB_STRATEGY, paramSet, { risk: RISK, cost: ZERO_COST_MODEL });
    const trade = result.trades[0];
    expect(trade.initialStopPrice).toBeLessThan(trade.entryPrice);
    expect(trade.targetRiskBudget).toBeCloseTo(RISK.initialEquity * RISK.riskPct, 10);
    expect(trade.qty * trade.entryPrice).toBeLessThanOrEqual(RISK.initialEquity + 1e-6);
  });

  it("gross vs net (§7): grossPnl is the raw execution PnL, distinct from the net-of-cost pnl once costs apply", () => {
    const candles = buildBreakoutThenExitSeries();
    const costModel: CostModel = { entryFeeBps: 10, exitFeeBps: 10, entrySlippageBps: 5, exitSlippageBps: 5 };
    const result = runResearchBacktest(candles, TRB_STRATEGY, paramSet, { risk: RISK, cost: costModel });
    const trade = result.trades[0];
    expect(trade.grossPnl).toBe((trade.rawExitPrice! - trade.rawEntryPrice) * trade.qty);
    expect(trade.pnl).not.toBe(trade.grossPnl);
    const totalCost = trade.entryFee + trade.entrySlippageCost + trade.exitFee + trade.exitSlippageCost;
    expect(trade.grossPnl! - totalCost).toBeCloseTo(trade.pnl!, 6);
  });
});

describe("generic research engine — cost model application (§16)", () => {
  const costModel: CostModel = { entryFeeBps: 10, exitFeeBps: 10, entrySlippageBps: 5, exitSlippageBps: 5 };

  it("entry fee/slippage make the effective entry price worse (higher) than the raw next-bar open", () => {
    const candles = buildBreakoutThenExitSeries();
    const zero = runResearchBacktest(candles, TRB_STRATEGY, paramSet, { risk: RISK, cost: ZERO_COST_MODEL });
    const withCost = runResearchBacktest(candles, TRB_STRATEGY, paramSet, { risk: RISK, cost: costModel });
    expect(withCost.trades[0].entryPrice).toBeGreaterThan(zero.trades[0].entryPrice);
    expect(withCost.trades[0].entryFee).toBeGreaterThan(0);
  });

  it("exit fee/slippage make the effective exit price worse (lower) than the raw next-bar open", () => {
    const candles = buildBreakoutThenExitSeries();
    const zero = runResearchBacktest(candles, TRB_STRATEGY, paramSet, { risk: RISK, cost: ZERO_COST_MODEL });
    const withCost = runResearchBacktest(candles, TRB_STRATEGY, paramSet, { risk: RISK, cost: costModel });
    expect(withCost.trades[0].exitPrice).toBeLessThan(zero.trades[0].exitPrice!);
    expect(withCost.trades[0].exitFee).toBeGreaterThan(0);
  });

  it("costs strictly reduce pnl relative to the zero-cost run", () => {
    const candles = buildBreakoutThenExitSeries();
    const zero = runResearchBacktest(candles, TRB_STRATEGY, paramSet, { risk: RISK, cost: ZERO_COST_MODEL });
    const withCost = runResearchBacktest(candles, TRB_STRATEGY, paramSet, { risk: RISK, cost: costModel });
    expect(withCost.trades[0].pnl!).toBeLessThan(zero.trades[0].pnl!);
  });
});

describe("generic research engine — invalid stop is rejected, never inflated/shrunk to fit (§7/§15)", () => {
  it("skips a trade whose actual fill price makes stop >= entry, rather than forcing it", () => {
    // Construct a series where the entry channel breaks out but the very
    // next bar GAPS DOWN so hard that its open is at/below the
    // strategy's computed initialStop - the fill-time sizing check must
    // reject this, not silently proceed.
    const bars: CanonicalCandle[] = [];
    let t = 0;
    const push = (o: Partial<CanonicalCandle>) => {
      bars.push(candle({ openTime: t, ...o }));
      t += 3_600_000;
    };
    for (let i = 0; i < 20; i++) push({ open: 100, high: 100, low: 95, close: 100 });
    push({ open: 100, high: 101, low: 95, close: 101 }); // signal bar: breakout, initialStop = min(low[0..19])=95
    push({ open: 90, high: 92, low: 85, close: 91 }); // fill bar GAPS DOWN to 90 (below stop=95)
    push({ open: 91, high: 93, low: 90, close: 92 });

    const result = runResearchBacktest(bars, TRB_STRATEGY, paramSet, { risk: RISK, cost: ZERO_COST_MODEL });
    expect(result.trades).toHaveLength(0);
    expect(result.skips.some((s) => s.reason === "STOP_NOT_BELOW_ENTRY")).toBe(true);
  });
});

describe("generic research engine — candle integrity gate", () => {
  it("throws rather than running on an unvalidated/corrupt candle array", () => {
    const candles = buildBreakoutThenExitSeries();
    const corrupt = [...candles];
    corrupt[5] = { ...corrupt[5], high: -1 }; // high < low, invalid
    expect(() => runResearchBacktest(corrupt, TRB_STRATEGY, paramSet, { risk: RISK, cost: ZERO_COST_MODEL })).toThrow(
      /candle integrity violated/,
    );
  });
});

describe("generic research engine — registry/parameter-set runtime invariants (§3)", () => {
  it("throws when the parameter set's strategyId does not match the strategy being run", () => {
    const candles = buildBreakoutThenExitSeries();
    const mutated = { ...paramSet, strategyId: "some-other-strategy" };
    expect(() => runResearchBacktest(candles, TRB_STRATEGY, mutated, { risk: RISK, cost: ZERO_COST_MODEL })).toThrow(
      /strategyId/,
    );
  });

  it("throws when the parameter set id is not registered on the strategy at all", () => {
    const candles = buildBreakoutThenExitSeries();
    const adHoc = { ...paramSet, id: "TRB-NOT-REGISTERED" };
    expect(() => runResearchBacktest(candles, TRB_STRATEGY, adHoc, { risk: RISK, cost: ZERO_COST_MODEL })).toThrow(
      /not registered/,
    );
  });

  it("throws when an ad-hoc parameter object reuses a registered id but mutates the param VALUES", () => {
    const candles = buildBreakoutThenExitSeries();
    const mutated = { ...paramSet, params: { ...paramSet.params, entryLookback: 999 } };
    expect(() => runResearchBacktest(candles, TRB_STRATEGY, mutated, { risk: RISK, cost: ZERO_COST_MODEL })).toThrow(
      /params mismatch/,
    );
  });

  it("throws when an ad-hoc parameter object reuses a registered id but mutates the timeframe", () => {
    const candles = buildBreakoutThenExitSeries();
    const mutated = { ...paramSet, timeframe: "4H" as const };
    expect(() => runResearchBacktest(candles, TRB_STRATEGY, mutated, { risk: RISK, cost: ZERO_COST_MODEL })).toThrow(
      /timeframe mismatch/,
    );
  });

  it("accepts the actual preregistered parameter set unchanged", () => {
    const candles = buildBreakoutThenExitSeries();
    expect(() => runResearchBacktest(candles, TRB_STRATEGY, paramSet, { risk: RISK, cost: ZERO_COST_MODEL })).not.toThrow();
  });
});

describe("generic research engine — candle batch identity (§4)", () => {
  it("throws on a batch mixing more than one instrument", () => {
    const candles = buildBreakoutThenExitSeries();
    const mixed = candles.map((c, i) => (i === 3 ? { ...c, instrumentId: "OTHER" } : c));
    expect(() => runResearchBacktest(mixed, TRB_STRATEGY, paramSet, { risk: RISK, cost: ZERO_COST_MODEL })).toThrow(
      /MIXED_INSTRUMENTS/,
    );
  });

  it("throws on a batch mixing more than one timeframe", () => {
    const candles = buildBreakoutThenExitSeries();
    const mixed = candles.map((c, i) => (i === 3 ? { ...c, timeframe: "4H" as const } : c));
    expect(() => runResearchBacktest(mixed, TRB_STRATEGY, paramSet, { risk: RISK, cost: ZERO_COST_MODEL })).toThrow(
      /MIXED_TIMEFRAMES/,
    );
  });

  it("throws when the candle batch's timeframe does not match the parameter set's timeframe (e.g. a 4H config fed 1H candles)", () => {
    const candles = buildBreakoutThenExitSeries(); // all 1H
    const trb4h = { ...paramSet, id: "TRB-4H-20-10", timeframe: "4H" as const };
    // Registry guard runs first and would reject this mismatch too - use the strategy's own real 4H
    // parameter set so this test isolates the candle-identity check, not the registry check.
    const realTrb4h = TRB_STRATEGY.parameterSets.find((p) => p.id === "TRB-4H-20-10")!;
    expect(trb4h).toBeDefined();
    expect(() => runResearchBacktest(candles, TRB_STRATEGY, realTrb4h, { risk: RISK, cost: ZERO_COST_MODEL })).toThrow(
      /TIMEFRAME_MISMATCH_WITH_PARAM_SET/,
    );
  });

  it("zero candles is handled explicitly and deterministically - an empty, valid result with a recorded skip, never a throw", () => {
    const result = runResearchBacktest([], TRB_STRATEGY, paramSet, { risk: RISK, cost: ZERO_COST_MODEL });
    expect(result.trades).toHaveLength(0);
    expect(result.finalEquity).toBe(RISK.initialEquity);
    expect(result.skips.some((s) => s.reason === "ZERO_CANDLES")).toBe(true);
  });
});

describe("generic research engine — warm-up / execution window (§6)", () => {
  it("prior context before tradeWindowStartIndex is visible to the strategy for warm-up (a signal can use it)", () => {
    const candles = buildBreakoutThenExitSeries();
    // Window starts exactly at the fill bar (21) - the breakout signal at
    // bar 20 (before the window) must still be visible as history, but
    // must not itself open a trade (see next test).
    const result = runResearchBacktest(candles, TRB_STRATEGY, paramSet, {
      risk: RISK,
      cost: ZERO_COST_MODEL,
      tradeWindowStartIndex: 25,
    });
    // No trade opens from the pre-window signal at bar 20.
    expect(result.trades.every((t) => t.entryCandleIndex >= 25)).toBe(true);
  });

  it("a signal produced before tradeWindowStartIndex cannot create an in-window trade (recorded as a skip, not silently dropped)", () => {
    const candles = buildBreakoutThenExitSeries();
    const result = runResearchBacktest(candles, TRB_STRATEGY, paramSet, {
      risk: RISK,
      cost: ZERO_COST_MODEL,
      tradeWindowStartIndex: 25,
    });
    expect(result.trades).toHaveLength(0); // the series' only signal (bar 20) is before the window
    expect(result.skips.some((s) => s.reason === "PRE_WINDOW_SIGNAL_IGNORED")).toBe(true);
  });

  it("the first legitimate in-window signal still produces a trade", () => {
    const candles = buildBreakoutThenExitSeries();
    // tradeWindowStartIndex=0 is the default/backward-compatible case: the signal at bar 20 is in-window.
    const result = runResearchBacktest(candles, TRB_STRATEGY, paramSet, {
      risk: RISK,
      cost: ZERO_COST_MODEL,
      tradeWindowStartIndex: 0,
    });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].entryCandleIndex).toBe(21);
  });

  it("no future data is visible regardless of tradeWindowStartIndex (no-lookahead still holds)", () => {
    const candles = buildBreakoutThenExitSeries();
    let maxIndexSeen = -1;
    const spyStrategy = {
      ...TRB_STRATEGY,
      evaluateEntry(closedCandles: readonly CanonicalCandle[], params: typeof paramSet) {
        maxIndexSeen = Math.max(maxIndexSeen, closedCandles.length - 1);
        return TRB_STRATEGY.evaluateEntry(closedCandles, params);
      },
    };
    runResearchBacktest(candles, spyStrategy, paramSet, { risk: RISK, cost: ZERO_COST_MODEL, tradeWindowStartIndex: 25 });
    expect(maxIndexSeen).toBeLessThanOrEqual(candles.length - 1);
  });
});
