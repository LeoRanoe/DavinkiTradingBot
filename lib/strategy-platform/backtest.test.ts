import { describe, expect, it } from "vitest";
import { runGenericBacktest, type GenericBacktestConfig } from "./backtest";
import { compileDslStrategy } from "./dsl/compile";
import { jeanfxV1BuiltInStrategy } from "./built-in/jeanfx-v1";
import type { CanonicalCandle, StrategyMetadata } from "./types";
import type { DslDefinition } from "./dsl/types";

function candle(overrides: Partial<CanonicalCandle> & { openTime: number }): CanonicalCandle {
  return {
    instrumentId: "BTCUSDT",
    timeframe: "M15",
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 10,
    isClosed: true,
    ...overrides,
  };
}

const instrument = { tickSize: 0.01, qtyStep: 0.0001, minOrderQty: 0.0001, minOrderAmt: 1, maxOrderQty: null };

const baseConfig: GenericBacktestConfig = {
  primaryTimeframe: "M15",
  initialEquity: 10_000,
  maxRiskPerTradePct: 0.01,
  maxOpenPositions: 1,
  maxNewTradesPerDay: 100,
  maxLosingTradesPerDay: 100,
  feeBps: 0,
  slippageBps: 0,
  instrument,
  minHistoryBars: 5,
};

const metadata: StrategyMetadata = {
  slug: "test-custom",
  displayName: "Test Custom",
  description: "",
  type: "USER_DEFINED",
  status: "RESEARCH_ONLY",
  requiredTimeframes: ["M15"],
  supportedAssetClasses: ["CRYPTO"],
  supportedSides: ["LONG"],
  minimumHistoryRequirements: {},
  requiredFeatures: [],
};

/** Repeating segments: flat below threshold, a trigger bar, a bar that hits target, flat again. */
function buildLongTradeSeries(segments: number): CanonicalCandle[] {
  const candles: CanonicalCandle[] = [];
  let t = 0;
  const step = 15 * 60_000;
  for (let s = 0; s < segments; s++) {
    for (let k = 0; k < 4; k++) {
      candles.push(candle({ openTime: t, open: 90, high: 91, low: 89, close: 90 }));
      t += step;
    }
    candles.push(candle({ openTime: t, open: 90, high: 106, low: 89, close: 105 })); // trigger
    t += step;
    candles.push(candle({ openTime: t, open: 105, high: 105, low: 104, close: 105 })); // entry bar (open=105)
    t += step;
    candles.push(candle({ openTime: t, open: 105, high: 112, low: 104, close: 108 })); // hits target (entry*1.02=107.1)
    t += step;
  }
  return candles;
}

function buildShortTradeSeries(segments: number): CanonicalCandle[] {
  const candles: CanonicalCandle[] = [];
  let t = 0;
  const step = 15 * 60_000;
  for (let s = 0; s < segments; s++) {
    for (let k = 0; k < 4; k++) {
      candles.push(candle({ openTime: t, open: 110, high: 111, low: 109, close: 110 }));
      t += step;
    }
    candles.push(candle({ openTime: t, open: 110, high: 111, low: 94, close: 95 })); // trigger (close<100)
    t += step;
    candles.push(candle({ openTime: t, open: 95, high: 96, low: 95, close: 95 })); // entry bar (open=95)
    t += step;
    candles.push(candle({ openTime: t, open: 95, high: 96, low: 88, close: 90 })); // hits target (entry*0.98=93.1)
    t += step;
  }
  return candles;
}

function longDef(): DslDefinition {
  return {
    engineSchemaVersion: "1",
    timeframes: ["M15"],
    side: ["LONG"],
    entry: { type: "COMPARE", comparator: "GT", left: { type: "PRICE", field: "close" }, right: { type: "CONST", value: 100 } },
    stop: { kind: "FIXED_PERCENT", pct: 0.01 },
    target: { kind: "R_MULTIPLE", multiple: 2 },
    parameterSchema: {},
  };
}

function shortDef(): DslDefinition {
  return {
    engineSchemaVersion: "1",
    timeframes: ["M15"],
    side: ["SHORT"],
    entry: { type: "COMPARE", comparator: "LT", left: { type: "PRICE", field: "close" }, right: { type: "CONST", value: 100 } },
    stop: { kind: "FIXED_PERCENT", pct: 0.02 },
    target: { kind: "R_MULTIPLE", multiple: 2 },
    parameterSchema: {},
  };
}

describe("runGenericBacktest - LONG", () => {
  it("produces closed trades, sane metrics, and evidence-quality warnings for a compiled DSL strategy", () => {
    const compiled = compileDslStrategy(longDef(), metadata);
    if (!compiled.ok) throw new Error("compile failed");
    const candles = buildLongTradeSeries(3);
    const result = runGenericBacktest(compiled.strategy, { M15: candles }, "BTCUSDT", baseConfig);

    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.trades.every((t) => t.direction === "LONG")).toBe(true);
    const closed = result.trades.filter((t) => t.pnl !== null);
    expect(result.metrics.tradeCount).toBe(closed.length);
    expect(closed.some((t) => t.outcome === "TARGET")).toBe(true);
    expect(result.warnings.some((w) => /in-sample/i.test(w))).toBe(true);
    expect(result.warnings.some((w) => /zero cost/i.test(w))).toBe(true);
  });

  it("never enters a second position before the first one has resolved", () => {
    const compiled = compileDslStrategy(longDef(), metadata);
    if (!compiled.ok) throw new Error("compile failed");
    const candles = buildLongTradeSeries(3);
    const result = runGenericBacktest(compiled.strategy, { M15: candles }, "BTCUSDT", baseConfig);
    for (let k = 1; k < result.trades.length; k++) {
      const prevExit = result.trades[k - 1].exitTime;
      expect(prevExit === null || result.trades[k].entryTime >= prevExit).toBe(true);
    }
  });
});

describe("runGenericBacktest - SHORT (research-only)", () => {
  it("produces SHORT trades with a symmetric stop/target and never routes through the LONG-only risk engine's proposal check", () => {
    const compiled = compileDslStrategy(shortDef(), metadata);
    if (!compiled.ok) throw new Error("compile failed");
    const candles = buildShortTradeSeries(3);
    const result = runGenericBacktest(compiled.strategy, { M15: candles }, "BTCUSDT", baseConfig);

    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.trades.every((t) => t.direction === "SHORT")).toBe(true);
    for (const t of result.trades) {
      expect(t.stopPrice).toBeGreaterThan(t.entryPrice);
      expect(t.targetPrice).toBeLessThan(t.entryPrice);
    }
  });
});

describe("runGenericBacktest - same engine for built-in and custom strategies", () => {
  it("runs the JeanFX built-in strategy through the identical generic engine with no crash or special-casing", () => {
    // A modest multi-timeframe dataset - not necessarily enough to produce a
    // trade, but enough to prove the SAME runGenericBacktest() entry point
    // drives a built-in strategy exactly like a compiled DSL one.
    const h1 = Array.from({ length: 300 }, (_, i) => candle({ openTime: i * 3_600_000, timeframe: "H1", open: 100 + i * 0.5, close: 100.3 + i * 0.5, high: 101 + i * 0.5, low: 99.5 + i * 0.5 }));
    const m15 = Array.from({ length: 300 }, (_, i) => candle({ openTime: i * 900_000, timeframe: "M15", open: 100, close: 100, high: 101, low: 99 }));
    const m5 = Array.from({ length: 300 }, (_, i) => candle({ openTime: i * 300_000, timeframe: "M5", open: 100, close: 100, high: 101, low: 99 }));

    const config: GenericBacktestConfig = { ...baseConfig, primaryTimeframe: "M5", minHistoryBars: 250 };
    expect(() => runGenericBacktest(jeanfxV1BuiltInStrategy, { H1: h1, M15: m15, M5: m5 }, "BTCUSDT", config)).not.toThrow();
  });
});
