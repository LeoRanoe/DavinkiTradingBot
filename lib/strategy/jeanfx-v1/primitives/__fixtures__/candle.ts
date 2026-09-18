import type { CanonicalCandle, Timeframe } from "@/lib/strategy-platform/types";

export function candle(overrides: Partial<CanonicalCandle> & { openTime: number }): CanonicalCandle {
  return {
    instrumentId: "BTCUSDT",
    timeframe: "M15" as Timeframe,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 10,
    isClosed: true,
    ...overrides,
  };
}

/** A flat series of OHLC candles spaced 15 minutes apart, one per close price given. */
export function series(closes: number[], timeframe: Timeframe = "M15"): CanonicalCandle[] {
  return closes.map((c, i) =>
    candle({ openTime: i * 15 * 60_000, timeframe, open: c, high: c + 0.5, low: c - 0.5, close: c }),
  );
}
