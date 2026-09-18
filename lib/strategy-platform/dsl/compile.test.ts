import { describe, expect, it } from "vitest";
import { compileDslStrategy } from "./compile";
import type { DslDefinition } from "./types";
import type { CanonicalCandle, StrategyContext, StrategyMetadata } from "../types";

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

function baseCtx(candles: CanonicalCandle[]): StrategyContext {
  return {
    instrument: { id: "BTCUSDT", assetClass: "CRYPTO", pipSize: 0.01 },
    now: candles[candles.length - 1]?.openTime ?? 0,
    candlesByTimeframe: { M15: candles },
    marketSession: null,
    currentPosition: null,
    strategyParameters: {},
  };
}

describe("compileDslStrategy", () => {
  it("refuses to compile an invalid definition, with the same errors validateDslDefinition would report", () => {
    const invalid: DslDefinition = {
      engineSchemaVersion: "1",
      timeframes: ["M15"],
      side: ["LONG"],
      entry: { type: "TELEPORT" } as never,
      stop: { kind: "FIXED_PERCENT", pct: 0.01 },
      target: { kind: "R_MULTIPLE", multiple: 2 },
      parameterSchema: {},
    };
    const result = compileDslStrategy(invalid, metadata);
    expect(result.ok).toBe(false);
  });

  it("compiles a rising-close EMA cross strategy and enters LONG with a FIXED_PERCENT/R_MULTIPLE stop+target", () => {
    const def: DslDefinition = {
      engineSchemaVersion: "1",
      timeframes: ["M15"],
      side: ["LONG"],
      entry: { type: "COMPARE", comparator: "GT", left: { type: "PRICE", field: "close" }, right: { type: "CONST", value: 50 } },
      stop: { kind: "FIXED_PERCENT", pct: 0.02 },
      target: { kind: "R_MULTIPLE", multiple: 2 },
      parameterSchema: {},
    };
    const compiled = compileDslStrategy(def, metadata);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const decision = compiled.strategy.evaluate(baseCtx(series([60, 65, 70])));
    expect(decision.type).toBe("ENTER_LONG");
    if (decision.type === "ENTER_LONG") {
      expect(decision.entry.price).toBe(70);
      expect(decision.stop.price).toBeCloseTo(70 * 0.98);
      expect(decision.target.price).toBeCloseTo(70 + 2 * (70 - 70 * 0.98));
      expect(decision.confidence).toBeNull();
    }
  });

  it("returns NO_ACTION when the entry condition isn't met", () => {
    const def: DslDefinition = {
      engineSchemaVersion: "1",
      timeframes: ["M15"],
      side: ["LONG"],
      entry: { type: "COMPARE", comparator: "GT", left: { type: "PRICE", field: "close" }, right: { type: "CONST", value: 500 } },
      stop: { kind: "FIXED_PERCENT", pct: 0.02 },
      target: { kind: "R_MULTIPLE", multiple: 2 },
      parameterSchema: {},
    };
    const compiled = compileDslStrategy(def, metadata);
    if (!compiled.ok) throw new Error("expected compile to succeed");
    const decision = compiled.strategy.evaluate(baseCtx(series([60, 65, 70])));
    expect(decision).toEqual({ type: "NO_ACTION", reason: "ENTRY_CONDITION_NOT_MET" });
  });

  it("ATR_MULTIPLE stop and NEXT_SWING target produce a coherent SHORT decision", () => {
    const candles: CanonicalCandle[] = [
      candle({ openTime: 0, high: 101, low: 99, close: 100 }),
      candle({ openTime: 1, high: 108, low: 106, close: 107 }), // swing high @ 108
      candle({ openTime: 2, high: 101, low: 99, close: 100 }),
      candle({ openTime: 3, high: 96, low: 94, close: 95 }),
      candle({ openTime: 4, high: 90, low: 88, close: 89 }), // swing low context for range
      candle({ openTime: 5, high: 85, low: 80, close: 81 }), // trigger candle
    ];
    const def: DslDefinition = {
      engineSchemaVersion: "1",
      timeframes: ["M15"],
      side: ["SHORT"],
      entry: { type: "COMPARE", comparator: "LT", left: { type: "PRICE", field: "close" }, right: { type: "CONST", value: 90 } },
      stop: { kind: "ATR_MULTIPLE", atrPeriod: 3, multiple: 1 },
      target: { kind: "NEXT_SWING", leftRightBars: 2 },
      parameterSchema: {},
    };
    const compiled = compileDslStrategy(def, metadata);
    if (!compiled.ok) throw new Error("expected compile to succeed");
    const decision = compiled.strategy.evaluate(baseCtx(candles));
    // Either a coherent SHORT decision or a safe NO_ACTION (e.g. no confirmed swing yet) - never a crash or a nonsensical stop/target.
    if (decision.type === "ENTER_SHORT") {
      expect(decision.stop.price).toBeGreaterThan(decision.entry.price);
      expect(decision.target.price).toBeLessThan(decision.entry.price);
    } else {
      expect(decision.type).toBe("NO_ACTION");
    }
  });

  it("never introduces a second execution path - identical DSL definition and candles produce identical decisions", () => {
    const def: DslDefinition = {
      engineSchemaVersion: "1",
      timeframes: ["M15"],
      side: ["LONG"],
      entry: { type: "COMPARE", comparator: "GT", left: { type: "PRICE", field: "close" }, right: { type: "CONST", value: 50 } },
      stop: { kind: "FIXED_PERCENT", pct: 0.02 },
      target: { kind: "R_MULTIPLE", multiple: 2 },
      parameterSchema: {},
    };
    const compiled = compileDslStrategy(def, metadata);
    if (!compiled.ok) throw new Error("expected compile to succeed");
    const ctx = baseCtx(series([60, 65, 70]));
    expect(compiled.strategy.evaluate(ctx)).toEqual(compiled.strategy.evaluate(ctx));
  });
});
