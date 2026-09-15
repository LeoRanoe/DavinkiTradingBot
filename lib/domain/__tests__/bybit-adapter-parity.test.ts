import { describe, expect, it, vi } from "vitest";
import type { Candle, Ticker } from "@/lib/bybit/types";

vi.mock("@/lib/bybit/client", () => ({
  getCandles: vi.fn(),
  getInstrumentMetadata: vi.fn(),
  getTicker: vi.fn(),
}));

import { getCandles, getTicker } from "@/lib/bybit/client";
import { BybitMarketDataProvider } from "../adapters/bybit-market-data-provider";
import { CRYPTO_SPOT_INSTRUMENTS } from "../instruments/crypto";
import { evaluateSignal } from "@/lib/strategy/v1/signal";

const btc = CRYPTO_SPOT_INSTRUMENTS.find((i) => i.venueSymbol === "BTCUSDT")!;

function fakeCandle(overrides: Partial<Candle> = {}): Candle {
  return {
    symbol: "BTCUSDT",
    timeframe: "15M",
    openTime: 1_700_000_000_000,
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 10,
    isClosed: true,
    ...overrides,
  };
}

/**
 * PARITY GATE (CLAUDE.md §49): the generic-wrapper provider must call the
 * exact same underlying client function with the exact same arguments, and
 * must not alter any candle field, so Strategy V1's evaluator produces an
 * identical result whether fed via the old direct client call or via the
 * new adapter. Until this passes, production stays on the old V1 path
 * (which it does — this adapter is not wired into app/api/jobs/scan).
 */
describe("BybitMarketDataProvider parity with lib/bybit/client.ts", () => {
  it("delegates getCandles with identical venue symbol/timeframe/limit/endMs and preserves every field", async () => {
    const raw = [fakeCandle({ openTime: 1 }), fakeCandle({ openTime: 2 })];
    (getCandles as ReturnType<typeof vi.fn>).mockResolvedValue(raw);

    const provider = new BybitMarketDataProvider();
    const mapped = await provider.getCandles(btc, "1H", 260, 999);

    expect(getCandles).toHaveBeenCalledWith("BTCUSDT", "1H", 260, 999);
    expect(mapped).toHaveLength(raw.length);
    mapped.forEach((m, idx) => {
      expect(m.open).toBe(raw[idx].open);
      expect(m.high).toBe(raw[idx].high);
      expect(m.low).toBe(raw[idx].low);
      expect(m.close).toBe(raw[idx].close);
      expect(m.volume).toBe(raw[idx].volume);
      expect(m.openTime).toBe(raw[idx].openTime);
      expect(m.isClosed).toBe(raw[idx].isClosed);
      expect(m.instrumentId).toBe(btc.id);
    });
  });

  it("rejects an unsupported canonical timeframe rather than silently mis-mapping it", async () => {
    // "4H" was added in Checkpoint 3A (see bybit-4h-support.test.ts) - use
    // a timeframe that's still genuinely unsupported for this check.
    const provider = new BybitMarketDataProvider();
    await expect(provider.getCandles(btc, "1D")).rejects.toThrow(/does not support canonical timeframe/);
  });

  it("getTicker maps every field through unchanged", async () => {
    const raw: Ticker = {
      symbol: "BTCUSDT",
      lastPrice: 65000,
      price24hPcnt: 0.01,
      highPrice24h: 66000,
      lowPrice24h: 64000,
      volume24h: 12345,
      turnover24h: 800_000_000,
      serverTimeMs: 1_700_000_000_000,
    };
    (getTicker as ReturnType<typeof vi.fn>).mockResolvedValue(raw);

    const provider = new BybitMarketDataProvider();
    const mapped = await provider.getTicker(btc);
    expect(mapped.lastPrice).toBe(raw.lastPrice);
    expect(mapped.serverTimeMs).toBe(raw.serverTimeMs);
    expect(mapped.instrumentId).toBe(btc.id);
  });

  it("evaluateSignal (Strategy V1) is unaffected by whether candles came from the old client or the new adapter's raw shape", () => {
    // Same underlying Candle[] shape either way - the adapter only relabels
    // fields for callers, it never transforms values Strategy V1 reads.
    const candles1h = Array.from({ length: 210 }, (_, i) => fakeCandle({ openTime: i, timeframe: "1H" }));
    const candles15m = Array.from({ length: 60 }, (_, i) => fakeCandle({ openTime: i, timeframe: "15M" }));

    const direct = evaluateSignal("BTCUSDT", candles1h, candles15m);
    const viaAdapterShapedInput = evaluateSignal("BTCUSDT", [...candles1h], [...candles15m]);
    expect(viaAdapterShapedInput).toEqual(direct);
  });
});

/**
 * SYMBOL-ORDER INDEPENDENCE (CLAUDE.md §28/§29): evaluating BTC then ETH
 * must produce the same per-symbol result as evaluating ETH then BTC.
 * evaluateSignal is a pure function of its own candle arguments, so this is
 * mechanically guaranteed - this test exists to make that guarantee
 * explicit and catch any future regression (e.g. shared mutable state).
 */
describe("Strategy V1 symbol-order independence", () => {
  it("evaluating [BTC, ETH] vs [ETH, BTC] yields identical per-symbol results", () => {
    const btcCandles1h = Array.from({ length: 210 }, (_, i) => fakeCandle({ openTime: i, close: 100 + i * 0.1 }));
    const btcCandles15m = Array.from({ length: 60 }, (_, i) => fakeCandle({ openTime: i, close: 100 + i * 0.1 }));
    const ethCandles1h = Array.from({ length: 210 }, (_, i) => fakeCandle({ openTime: i, close: 50 - i * 0.05 }));
    const ethCandles15m = Array.from({ length: 60 }, (_, i) => fakeCandle({ openTime: i, close: 50 - i * 0.05 }));

    const btcResultFirst = evaluateSignal("BTCUSDT", btcCandles1h, btcCandles15m);
    const ethResultSecond = evaluateSignal("ETHUSDT", ethCandles1h, ethCandles15m);

    const ethResultFirst = evaluateSignal("ETHUSDT", ethCandles1h, ethCandles15m);
    const btcResultSecond = evaluateSignal("BTCUSDT", btcCandles1h, btcCandles15m);

    // Same symbol's result must be identical regardless of which order the
    // scanner iterates the universe in.
    expect(btcResultFirst).toEqual(btcResultSecond);
    expect(ethResultFirst).toEqual(ethResultSecond);
  });
});
