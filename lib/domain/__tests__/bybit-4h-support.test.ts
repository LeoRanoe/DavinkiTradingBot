import { describe, expect, it, vi } from "vitest";
import { BYBIT_INTERVAL, BYBIT_INTERVAL_MS } from "@/lib/bybit/types";

/**
 * Checkpoint 3A §9: 4H support added to the Bybit adapter for V2 TRB
 * research. V1's 1H/15M mapping must be byte-identical to before.
 */
describe("BYBIT_INTERVAL / BYBIT_INTERVAL_MS (4H addition, §9)", () => {
  it("keeps V1's existing 1H/15M mapping unchanged", () => {
    expect(BYBIT_INTERVAL["1H"]).toBe("60");
    expect(BYBIT_INTERVAL["15M"]).toBe("15");
    expect(BYBIT_INTERVAL_MS["1H"]).toBe(3_600_000);
    expect(BYBIT_INTERVAL_MS["15M"]).toBe(900_000);
  });

  it("adds the correct Bybit kline interval and bucket length for 4H", () => {
    expect(BYBIT_INTERVAL["4H"]).toBe("240"); // Bybit kline "interval" is in minutes
    expect(BYBIT_INTERVAL_MS["4H"]).toBe(14_400_000); // 4 * 3_600_000
  });
});

vi.mock("@/lib/bybit/client", () => ({
  getCandles: vi.fn(),
  getInstrumentMetadata: vi.fn(),
  getTicker: vi.fn(),
}));

import { getCandles } from "@/lib/bybit/client";
import { BybitMarketDataProvider } from "../adapters/bybit-market-data-provider";
import { CRYPTO_SPOT_INSTRUMENTS } from "../instruments/crypto";

const btc = CRYPTO_SPOT_INSTRUMENTS.find((i) => i.venueSymbol === "BTCUSDT")!;

describe("BybitMarketDataProvider 4H support", () => {
  it("delegates getCandles(instrument, '4H', ...) to the client with the venue-native '4H' timeframe", async () => {
    (getCandles as ReturnType<typeof vi.fn>).mockResolvedValue([
      { symbol: "BTCUSDT", timeframe: "4H", openTime: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1, isClosed: true },
    ]);
    const provider = new BybitMarketDataProvider();
    const mapped = await provider.getCandles(btc, "4H", 500, 999);

    expect(getCandles).toHaveBeenCalledWith("BTCUSDT", "4H", 500, 999);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].timeframe).toBe("4H");
  });

  it("still supports 1H/15M identically (regression - unaffected by the 4H addition)", async () => {
    (getCandles as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const provider = new BybitMarketDataProvider();
    await provider.getCandles(btc, "1H", 260);
    expect(getCandles).toHaveBeenCalledWith("BTCUSDT", "1H", 260, undefined);
    await provider.getCandles(btc, "15M", 260);
    expect(getCandles).toHaveBeenCalledWith("BTCUSDT", "15M", 260, undefined);
  });

  it("still rejects an unsupported canonical timeframe (e.g. 1D) rather than mis-mapping it", async () => {
    const provider = new BybitMarketDataProvider();
    await expect(provider.getCandles(btc, "1D")).rejects.toThrow(/does not support canonical timeframe/);
  });
});
