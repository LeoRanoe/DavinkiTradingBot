import { describe, expect, it } from "vitest";
import type { CanonicalCandle } from "@/lib/domain/market-data-provider";
import { validateCandleIntegrity } from "../candle-integrity";

function candle(overrides: Partial<CanonicalCandle> = {}): CanonicalCandle {
  return {
    instrumentId: "TEST",
    timeframe: "1H",
    openTime: 0,
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 10,
    isClosed: true,
    ...overrides,
  };
}

describe("validateCandleIntegrity (§11)", () => {
  it("valid strictly-increasing, well-formed closed candles pass with no issues", () => {
    const candles = [candle({ openTime: 0 }), candle({ openTime: 3_600_000 }), candle({ openTime: 7_200_000 })];
    expect(validateCandleIntegrity(candles)).toEqual({ valid: true, issues: [] });
  });

  it("flags a duplicate openTime", () => {
    const candles = [candle({ openTime: 0 }), candle({ openTime: 0 })];
    const report = validateCandleIntegrity(candles);
    expect(report.valid).toBe(false);
    expect(report.issues.some((i) => i.reason === "DUPLICATE_OPEN_TIME")).toBe(true);
  });

  it("flags a non-increasing openTime (out of order)", () => {
    const candles = [candle({ openTime: 3_600_000 }), candle({ openTime: 0 })];
    const report = validateCandleIntegrity(candles);
    expect(report.issues.some((i) => i.reason === "OPEN_TIME_NOT_STRICTLY_INCREASING")).toBe(true);
  });

  it("flags an unclosed candle", () => {
    const candles = [candle({ isClosed: false })];
    expect(validateCandleIntegrity(candles).issues.some((i) => i.reason === "UNCLOSED_CANDLE")).toBe(true);
  });

  it("flags non-finite OHLCV values", () => {
    const candles = [candle({ high: Number.NaN }), candle({ openTime: 3_600_000, volume: Number.POSITIVE_INFINITY })];
    const report = validateCandleIntegrity(candles);
    expect(report.issues.some((i) => i.reason === "NON_FINITE_HIGH")).toBe(true);
    expect(report.issues.some((i) => i.reason === "NON_FINITE_VOLUME")).toBe(true);
  });

  it("flags high < max(open, close)", () => {
    const candles = [candle({ open: 100, close: 105, high: 102 })];
    expect(validateCandleIntegrity(candles).issues.some((i) => i.reason === "HIGH_BELOW_OPEN_OR_CLOSE")).toBe(true);
  });

  it("flags low > min(open, close)", () => {
    const candles = [candle({ open: 100, close: 95, low: 98 })];
    expect(validateCandleIntegrity(candles).issues.some((i) => i.reason === "LOW_ABOVE_OPEN_OR_CLOSE")).toBe(true);
  });

  it("flags high < low", () => {
    const candles = [candle({ high: 50, low: 60, open: 55, close: 55 })];
    expect(validateCandleIntegrity(candles).issues.some((i) => i.reason === "HIGH_BELOW_LOW")).toBe(true);
  });

  it("flags negative volume", () => {
    const candles = [candle({ volume: -1 })];
    expect(validateCandleIntegrity(candles).issues.some((i) => i.reason === "NEGATIVE_VOLUME")).toBe(true);
  });

  it("never mutates or manufactures candles - just reports", () => {
    const candles = [candle({ volume: -1 })];
    const before = JSON.stringify(candles);
    validateCandleIntegrity(candles);
    expect(JSON.stringify(candles)).toBe(before);
  });

  it("an empty array is valid (nothing to validate)", () => {
    expect(validateCandleIntegrity([])).toEqual({ valid: true, issues: [] });
  });
});
