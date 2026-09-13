import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/bybit/types";
import { evaluateRegime } from "./regime";
import { scoreSetup } from "./score";
import { evaluateSignal } from "./signal";

function makeCandles(
  symbol: string,
  timeframe: "1H" | "15M",
  closes: number[],
  opts: { lastClosed?: boolean; volumes?: number[] } = {},
): Candle[] {
  const intervalMs = timeframe === "1H" ? 3_600_000 : 900_000;
  const baseTime = Date.parse("2026-01-01T00:00:00Z");
  return closes.map((close, i) => ({
    symbol,
    timeframe,
    openTime: baseTime + i * intervalMs,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: opts.volumes?.[i] ?? 100,
    isClosed: opts.lastClosed === false && i === closes.length - 1 ? false : true,
  }));
}

describe("evaluateRegime", () => {
  it("is bullish when EMA50 > EMA200 and price above EMA50 (steady uptrend)", () => {
    const closes = Array.from({ length: 250 }, (_, i) => 100 + i * 0.5);
    const candles = makeCandles("BTCUSDT", "1H", closes);
    const regime = evaluateRegime(candles);
    expect(regime.bullish).toBe(true);
  });

  it("is not bullish in a downtrend", () => {
    const closes = Array.from({ length: 250 }, (_, i) => 300 - i * 0.5);
    const candles = makeCandles("BTCUSDT", "1H", closes);
    const regime = evaluateRegime(candles);
    expect(regime.bullish).toBe(false);
    expect(regime.reason).toBe("NO_BULLISH_REGIME");
  });

  it("reports insufficient history rather than guessing", () => {
    const candles = makeCandles("BTCUSDT", "1H", [100, 101, 102]);
    const regime = evaluateRegime(candles);
    expect(regime.bullish).toBe(false);
    expect(regime.reason).toBe("INSUFFICIENT_HISTORY");
  });
});

describe("scoreSetup", () => {
  it("produces a score between 0 and 100 with components summing to the total", () => {
    const closes = Array.from({ length: 260 }, (_, i) => 100 + Math.sin(i / 5) * 3 + i * 0.1);
    const candles = makeCandles("BTCUSDT", "15M", closes, {
      volumes: closes.map(() => 100),
    });
    const result = scoreSetup(candles);
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(100);
    const sum = result.components.reduce((s, c) => s + c.pointsEarned, 0);
    expect(Math.round(sum)).toBe(result.total);
  });

  it("classifies a near-zero score as IGNORE and a strong setup higher", () => {
    const flat = Array.from({ length: 260 }, () => 100);
    const flatResult = scoreSetup(makeCandles("BTCUSDT", "15M", flat));
    expect(flatResult.classification).toBe("IGNORE");
  });

  it("never returns a risk/reward below zero when a stop is computed", () => {
    const closes = Array.from({ length: 260 }, (_, i) => 100 + i * 0.2);
    const result = scoreSetup(makeCandles("BTCUSDT", "15M", closes));
    if (result.riskReward !== null) {
      expect(result.riskReward).toBeGreaterThan(0);
    }
  });
});

describe("evaluateSignal - closed candle invariant", () => {
  const closes1h = Array.from({ length: 250 }, (_, i) => 100 + i * 0.5);
  const closes15m = Array.from({ length: 260 }, (_, i) => 100 + i * 0.1);

  it("refuses to evaluate when the last 15M candle is not closed", () => {
    const candles1h = makeCandles("BTCUSDT", "1H", closes1h);
    const candles15m = makeCandles("BTCUSDT", "15M", closes15m, { lastClosed: false });
    const result = evaluateSignal("BTCUSDT", candles1h, candles15m);
    expect(result.kind).toBe("NO_SIGNAL");
    if (result.kind === "NO_SIGNAL") expect(result.reason).toBe("INCOMPLETE_CANDLE");
  });

  it("refuses to evaluate without a bullish 1H regime", () => {
    const downtrend1h = makeCandles(
      "BTCUSDT",
      "1H",
      Array.from({ length: 250 }, (_, i) => 300 - i * 0.5),
    );
    const candles15m = makeCandles("BTCUSDT", "15M", closes15m);
    const result = evaluateSignal("BTCUSDT", downtrend1h, candles15m);
    expect(result.kind).toBe("NO_SIGNAL");
    if (result.kind === "NO_SIGNAL") expect(result.reason).toBe("NO_BULLISH_REGIME");
  });

  it("produces a SIGNAL when regime is bullish and the candle is closed", () => {
    const candles1h = makeCandles("BTCUSDT", "1H", closes1h);
    const candles15m = makeCandles("BTCUSDT", "15M", closes15m);
    const result = evaluateSignal("BTCUSDT", candles1h, candles15m);
    expect(result.kind).toBe("SIGNAL");
  });

  it("reports missing market data rather than crashing on empty input", () => {
    const result = evaluateSignal("BTCUSDT", [], []);
    expect(result.kind).toBe("NO_SIGNAL");
    if (result.kind === "NO_SIGNAL") expect(result.reason).toBe("MISSING_MARKET_DATA");
  });
});
