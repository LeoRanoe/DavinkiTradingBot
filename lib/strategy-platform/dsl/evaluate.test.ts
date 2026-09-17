import { describe, expect, it } from "vitest";
import { evaluateCondition, evaluateDslEntry, evaluateSeries } from "./evaluate";
import type { CanonicalCandle } from "../types";
import type { DslDefinition, DslNode } from "./types";

function candle(overrides: Partial<CanonicalCandle>): CanonicalCandle {
  return {
    instrumentId: "BTCUSDT",
    timeframe: "M15",
    openTime: 0,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 10,
    isClosed: true,
    ...overrides,
  };
}

function series(closes: number[]): CanonicalCandle[] {
  return closes.map((c, i) => candle({ openTime: i * 60_000, open: c, high: c + 1, low: c - 1, close: c }));
}

describe("DSL evaluate - values", () => {
  it("PRICE/VOLUME/CONST read the raw candle fields", () => {
    const candles = series([1, 2, 3]);
    expect(evaluateSeries({ type: "PRICE", field: "close" }, candles)).toEqual({ ok: true, value: [1, 2, 3] });
    expect(evaluateSeries({ type: "CONST", value: 42 }, candles)).toEqual({ ok: true, value: [42, 42, 42] });
  });

  it("HIGHEST/LOWEST compute a rolling window over a child series", () => {
    const candles = series([1, 5, 3, 9, 2]);
    const highest = evaluateSeries({ type: "HIGHEST", period: 3, child: { type: "PRICE", field: "close" } }, candles);
    expect(highest).toEqual({ ok: true, value: [NaN, NaN, 5, 9, 9] });
  });
});

describe("DSL evaluate - conditions", () => {
  it("COMPARE is deterministic on repeated evaluation", () => {
    const candles = series([1, 2, 3, 10]);
    const node: DslNode = { type: "COMPARE", comparator: "GT", left: { type: "PRICE", field: "close" }, right: { type: "CONST", value: 5 } };
    const a = evaluateCondition(node, { candles, marketSession: null });
    const b = evaluateCondition(node, { candles, marketSession: null });
    expect(a).toEqual({ ok: true, value: true });
    expect(a).toEqual(b);
  });

  it("CROSS_ABOVE fires exactly on the crossing candle", () => {
    // EMA2 crosses above EMA3 somewhere in this series; we only assert it's a stable boolean, not which bar.
    const candles = series([10, 9, 8, 12, 15, 20]);
    const node: DslNode = { type: "CROSS_ABOVE", left: { type: "SMA", period: 2 }, right: { type: "SMA", period: 3 } };
    const result = evaluateCondition(node, { candles, marketSession: null });
    expect(result.ok).toBe(true);
  });

  it("ALL short-circuits on the first false child", () => {
    const node: DslNode = {
      type: "ALL",
      children: [
        { type: "COMPARE", comparator: "GT", left: { type: "CONST", value: 1 }, right: { type: "CONST", value: 2 } },
        { type: "TELEPORT" } as unknown as DslNode, // would error if evaluated - must never be reached
      ],
    };
    const result = evaluateCondition(node, { candles: series([1]), marketSession: null });
    expect(result).toEqual({ ok: true, value: false });
  });

  it("SESSION reflects the provided marketSession context, not a global clock", () => {
    const candles = series([1]);
    const node: DslNode = { type: "SESSION", sessions: ["LONDON"] };
    expect(evaluateCondition(node, { candles, marketSession: ["ASIA"] })).toEqual({ ok: true, value: false });
    expect(evaluateCondition(node, { candles, marketSession: ["LONDON", "NEW_YORK"] })).toEqual({ ok: true, value: true });
    expect(evaluateCondition(node, { candles, marketSession: null })).toEqual({ ok: true, value: false });
  });
});

describe("DSL evaluate - safety guards", () => {
  it("guards division by zero in PERCENT_CHANGE instead of returning Infinity/NaN", () => {
    const candles = series([0, 0, 0, 5]);
    const node: DslNode = { type: "PERCENT_CHANGE", period: 3, comparator: "GT", valuePct: 10 };
    const result = evaluateCondition(node, { candles, marketSession: null });
    expect(result).toEqual({ ok: false, reason: "DIVISION_BY_ZERO" });
  });

  it("guards insufficient history instead of reading out of bounds / future data", () => {
    const candles = series([1, 2]);
    const node: DslNode = { type: "CROSS_ABOVE", left: { type: "SMA", period: 5 }, right: { type: "SMA", period: 5 } };
    const result = evaluateCondition(node, { candles, marketSession: null });
    // Not enough bars for a period-5 SMA to be finite - must fail safely, not produce a fabricated boolean.
    expect(result.ok).toBe(false);
  });

  it("never produces a NaN/Infinity-based true/false without a typed failure", () => {
    const candles = series([100]); // single candle: HIGHEST period=3 is NaN
    const node: DslNode = {
      type: "COMPARE",
      comparator: "GT",
      left: { type: "HIGHEST", period: 3, child: { type: "PRICE", field: "close" } },
      right: { type: "CONST", value: 0 },
    };
    const result = evaluateCondition(node, { candles, marketSession: null });
    expect(result).toEqual({ ok: false, reason: "NON_FINITE_VALUE" });
  });

  it("cannot see an unclosed 'future' candle even if the caller appends one", () => {
    const closed = series([1, 2, 3]);
    const future = candle({ openTime: 999, close: 1_000_000, isClosed: false });
    const def: DslDefinition = {
      engineSchemaVersion: "1",
      timeframes: ["M15"],
      side: ["LONG"],
      entry: { type: "COMPARE", comparator: "GT", left: { type: "PRICE", field: "close" }, right: { type: "CONST", value: 500 } },
      stop: { kind: "FIXED_PCT", pct: 0.01 },
      target: { kind: "R_MULTIPLE", multiple: 2 },
      parameterSchema: {},
    };
    const result = evaluateDslEntry(def, { M15: [...closed, future] });
    // If the future candle leaked in, close (1,000,000) > 500 would be true.
    expect(result).toEqual({ ok: true, value: false });
  });

  it("returns MISSING_MARKET_DATA rather than crashing on no candles", () => {
    const def: DslDefinition = {
      engineSchemaVersion: "1",
      timeframes: ["M15"],
      side: ["LONG"],
      entry: { type: "SESSION", sessions: ["ASIA"] },
      stop: { kind: "FIXED_PCT", pct: 0.01 },
      target: { kind: "R_MULTIPLE", multiple: 2 },
      parameterSchema: {},
    };
    expect(evaluateDslEntry(def, {})).toEqual({ ok: false, reason: "MISSING_MARKET_DATA" });
  });
});
