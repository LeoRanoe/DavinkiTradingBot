import { describe, expect, it } from "vitest";
import type { CanonicalCandle } from "@/lib/domain/market-data-provider";
import { getTrbParameterSet, TRB_PARAMETER_SETS, TRB_STRATEGY, type TrbParams } from "../strategies/trb";
import type { StrategyParameterSet } from "../strategy";

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

function paramSet(entryLookback: number, exitLookback: number, timeframe: "1H" | "4H" = "1H"): StrategyParameterSet<TrbParams> {
  return { id: `TEST-${timeframe}-${entryLookback}-${exitLookback}`, strategyId: "v2-trb", timeframe, params: { entryLookback, exitLookback } };
}

/** N flat filler candles (high=low=open=close=100), oldest-first, hourly-spaced. */
function flatFiller(n: number, startOpenTime = 0): CanonicalCandle[] {
  return Array.from({ length: n }, (_, i) => candle({ openTime: startOpenTime + i * 3_600_000 }));
}

describe("V2 TRB — preregistered parameter matrix (§4)", () => {
  it("has exactly six configurations, no more, no less", () => {
    expect(TRB_PARAMETER_SETS).toHaveLength(6);
  });

  it("has exactly these six immutable ids", () => {
    const ids = TRB_PARAMETER_SETS.map((p) => p.id).sort();
    expect(ids).toEqual(
      ["TRB-1H-100-50", "TRB-1H-20-10", "TRB-1H-50-20", "TRB-4H-100-50", "TRB-4H-20-10", "TRB-4H-50-20"].sort(),
    );
  });

  it("each config has exactly one of the three preregistered entry/exit channel pairs", () => {
    const pairs = TRB_PARAMETER_SETS.map((p) => `${p.params.entryLookback}/${p.params.exitLookback}`);
    for (const pair of pairs) {
      expect(["20/10", "50/20", "100/50"]).toContain(pair);
    }
  });

  it("each config's timeframe is 1H or 4H, and both timeframes are present for all three pairs", () => {
    for (const p of TRB_PARAMETER_SETS) {
      expect(["1H", "4H"]).toContain(p.timeframe);
    }
    expect(TRB_PARAMETER_SETS.filter((p) => p.timeframe === "1H")).toHaveLength(3);
    expect(TRB_PARAMETER_SETS.filter((p) => p.timeframe === "4H")).toHaveLength(3);
  });

  it("no extra parameter (e.g. an ATR field) exists on any config", () => {
    for (const p of TRB_PARAMETER_SETS) {
      expect(Object.keys(p.params).sort()).toEqual(["entryLookback", "exitLookback"]);
    }
  });

  it("getTrbParameterSet resolves each preregistered id and returns undefined for anything else", () => {
    expect(getTrbParameterSet("TRB-1H-20-10")?.params).toEqual({ entryLookback: 20, exitLookback: 10 });
    expect(getTrbParameterSet("TRB-1H-17-8")).toBeUndefined(); // not a preregistered config
  });

  it("the strategy is DRAFT/RESEARCH_ONLY and never claims a supported PAPER/SHADOW/LIVE status", () => {
    expect(TRB_STRATEGY.status).toBe("RESEARCH_ONLY");
    expect(TRB_STRATEGY.id).toBe("v2-trb");
  });
});

describe("V2 TRB entry rule (§5)", () => {
  it("exact breakout: close above the prior-N-bar high channel produces an OPPORTUNITY", () => {
    const p = paramSet(20, 10);
    const prior = flatFiller(20).map((c) => ({ ...c, high: 100 }));
    const current = candle({ openTime: 20 * 3_600_000, close: 100.5, high: 100.5 }); // breaks the flat 100 channel
    const evaluation = TRB_STRATEGY.evaluateEntry([...prior, current], p);
    expect(evaluation.kind).toBe("OPPORTUNITY");
  });

  it("no breakout: close at or below the channel high produces NO_OPPORTUNITY", () => {
    const p = paramSet(20, 10);
    const prior = flatFiller(20).map((c) => ({ ...c, high: 100 }));
    const current = candle({ openTime: 20 * 3_600_000, close: 99.9, high: 99.9 });
    const evaluation = TRB_STRATEGY.evaluateEntry([...prior, current], p);
    expect(evaluation).toEqual({ kind: "NO_OPPORTUNITY", reason: "NO_BREAKOUT" });
  });

  it("entry channel excludes the current candle - an off-by-one that shifts the window to include bar t must not pass", () => {
    // entryLookback=3: window must be exactly indices [0,1,2] (highs 5,20,15 -> max 20),
    // NEVER including index 3 (current, high=999). close=20.5 breaks the correct
    // window (20.5 > 20) but would NOT break a buggy window that included the
    // current bar's own high=999.
    const p = paramSet(3, 2);
    const candles: CanonicalCandle[] = [
      candle({ openTime: 0, high: 5, low: 4 }),
      candle({ openTime: 3_600_000, high: 20, low: 19 }),
      candle({ openTime: 7_200_000, high: 15, low: 14 }),
      candle({ openTime: 10_800_000, high: 999, low: 18, close: 20.5 }), // current bar t
    ];
    const evaluation = TRB_STRATEGY.evaluateEntry(candles, p);
    expect(evaluation.kind).toBe("OPPORTUNITY");
  });

  it("unclosed current candle cannot generate a final signal even if it would otherwise break out", () => {
    const p = paramSet(20, 10);
    const prior = flatFiller(20).map((c) => ({ ...c, high: 100 }));
    const current = candle({ openTime: 20 * 3_600_000, close: 200, high: 200, isClosed: false });
    const evaluation = TRB_STRATEGY.evaluateEntry([...prior, current], p);
    expect(evaluation).toEqual({ kind: "NO_OPPORTUNITY", reason: "CURRENT_CANDLE_NOT_CLOSED" });
  });

  it("insufficient entry-lookback history (fewer than N+1 candles) produces NO_OPPORTUNITY, never a guess", () => {
    const p = paramSet(20, 10);
    const candles = flatFiller(15); // needs 21, only has 15
    const evaluation = TRB_STRATEGY.evaluateEntry(candles, p);
    expect(evaluation).toEqual({ kind: "NO_OPPORTUNITY", reason: "INSUFFICIENT_ENTRY_HISTORY" });
  });

  it("insufficient exit-lookback history for the risk reference (M > N, not enough bars) also produces NO_OPPORTUNITY", () => {
    const p = paramSet(10, 20); // exitLookback larger than entryLookback here
    const candles = flatFiller(15); // enough for entry (needs 11), not enough for exit risk ref (needs 21)
    const evaluation = TRB_STRATEGY.evaluateEntry(candles, p);
    expect(evaluation).toEqual({ kind: "NO_OPPORTUNITY", reason: "INSUFFICIENT_EXIT_HISTORY_FOR_RISK_REFERENCE" });
  });

  it("initialStop (§7) uses only the known prior exitLookback bars, excluding the current candle's own low", () => {
    const p = paramSet(3, 3);
    const candles: CanonicalCandle[] = [
      candle({ openTime: 0, high: 10, low: 30 }),
      candle({ openTime: 3_600_000, high: 12, low: 25 }),
      candle({ openTime: 7_200_000, high: 8, low: 28 }),
      candle({ openTime: 10_800_000, high: 50, low: 1, close: 50 }), // current bar: low=1 must NOT become initialStop
    ];
    const evaluation = TRB_STRATEGY.evaluateEntry(candles, p);
    expect(evaluation.kind).toBe("OPPORTUNITY");
    if (evaluation.kind === "OPPORTUNITY") {
      expect(evaluation.opportunity.initialStop.price).toBe(25); // min(30,25,28), NOT 1
    }
  });

  it("never invents a strength/score (§8) - Opportunity.strength stays undefined", () => {
    const p = paramSet(20, 10);
    const prior = flatFiller(20).map((c) => ({ ...c, high: 100 }));
    const current = candle({ openTime: 20 * 3_600_000, close: 100.5, high: 100.5 });
    const evaluation = TRB_STRATEGY.evaluateEntry([...prior, current], p);
    expect(evaluation.kind).toBe("OPPORTUNITY");
    if (evaluation.kind === "OPPORTUNITY") {
      expect(evaluation.opportunity.strength).toBeUndefined();
      expect(evaluation.opportunity.side).toBe("LONG");
      expect(evaluation.opportunity.features).toMatchObject({ entryLookback: 20, exitLookback: 10 });
    }
  });
});

describe("V2 TRB exit rule (§6)", () => {
  it("exit signal: close below the prior-M-bar low channel produces EXIT", () => {
    const p = paramSet(20, 10);
    const prior = flatFiller(10).map((c) => ({ ...c, low: 100 }));
    const current = candle({ openTime: 10 * 3_600_000, close: 99, low: 99 });
    const evaluation = TRB_STRATEGY.evaluateExit([...prior, current], p);
    expect(evaluation.kind).toBe("EXIT");
  });

  it("no exit signal while close stays above the channel low", () => {
    const p = paramSet(20, 10);
    const prior = flatFiller(10).map((c) => ({ ...c, low: 100 }));
    const current = candle({ openTime: 10 * 3_600_000, close: 101, low: 101 });
    const evaluation = TRB_STRATEGY.evaluateExit([...prior, current], p);
    expect(evaluation).toEqual({ kind: "HOLD" });
  });

  it("exit channel excludes the current candle - a huge favorable move on bar x itself must not trigger an exit off its own low", () => {
    const p = paramSet(3, 3);
    const candles: CanonicalCandle[] = [
      candle({ openTime: 0, low: 90 }),
      candle({ openTime: 3_600_000, low: 88 }),
      candle({ openTime: 7_200_000, low: 92 }),
      candle({ openTime: 10_800_000, low: 1, close: 95 }), // current: low=1 must not be the channel itself
    ];
    // channel = min(90,88,92) = 88; close=95 is above 88 -> HOLD, even though the
    // current bar's own low (1) is far below 88 (that low is irrelevant - only close matters, and only the prior window).
    const evaluation = TRB_STRATEGY.evaluateExit(candles, p);
    expect(evaluation).toEqual({ kind: "HOLD" });
  });

  it("has no fixed profit target - a huge favorable close alone never triggers an exit while the channel isn't broken", () => {
    const p = paramSet(20, 10);
    const prior = flatFiller(10).map((c) => ({ ...c, low: 100 }));
    const current = candle({ openTime: 10 * 3_600_000, close: 100_000, low: 100_000 }); // enormous winner
    const evaluation = TRB_STRATEGY.evaluateExit([...prior, current], p);
    expect(evaluation).toEqual({ kind: "HOLD" });
  });
});
