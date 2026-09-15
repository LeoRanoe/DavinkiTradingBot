import { describe, expect, it } from "vitest";
import type { CanonicalCandle } from "@/lib/domain/market-data-provider";
import { computeBuyAndHoldBenchmark } from "../benchmark";

function candle(overrides: Partial<CanonicalCandle> = {}): CanonicalCandle {
  return { instrumentId: "TEST", timeframe: "1H", openTime: 0, open: 100, high: 100, low: 100, close: 100, volume: 1, isClosed: true, ...overrides };
}

describe("computeBuyAndHoldBenchmark (§23)", () => {
  it("buys at the first bar's open and holds to the last bar's close", () => {
    const candles = [
      candle({ openTime: 0, open: 100, close: 105 }),
      candle({ openTime: 1, open: 105, close: 110 }),
      candle({ openTime: 2, open: 110, close: 120 }),
    ];
    const result = computeBuyAndHoldBenchmark(candles);
    expect(result.startPrice).toBe(100);
    expect(result.endPrice).toBe(120);
    expect(result.totalReturn).toBeCloseTo(0.2, 10);
  });

  it("computes max drawdown on the close series", () => {
    const candles = [
      candle({ openTime: 0, open: 100, close: 100 }),
      candle({ openTime: 1, close: 120 }), // peak
      candle({ openTime: 2, close: 90 }), // trough: dd = (120-90)/120 = 0.25
      candle({ openTime: 3, close: 130 }),
    ];
    const result = computeBuyAndHoldBenchmark(candles);
    expect(result.maxDrawdownPct).toBeCloseTo(0.25, 10);
  });

  it("throws on an empty candle array rather than fabricating a result", () => {
    expect(() => computeBuyAndHoldBenchmark([])).toThrow();
  });

  it("never claims to be a strategy result - has no rMultiple, riskBudget, or trade fields", () => {
    const result = computeBuyAndHoldBenchmark([candle({ openTime: 0 }), candle({ openTime: 1 })]);
    expect(result).not.toHaveProperty("rMultiple");
    expect(result).not.toHaveProperty("riskBudget");
  });
});
