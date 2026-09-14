import { describe, expect, it, vi } from "vitest";
import type { InstrumentMetadata } from "@/lib/bybit/types";

vi.mock("@/lib/bybit/client", () => ({
  listSpotInstruments: vi.fn(),
  getTicker: vi.fn(),
  getListingStatus: vi.fn((meta: InstrumentMetadata) => (meta.raw as { status?: string })?.status ?? null),
}));

import { listSpotInstruments, getTicker } from "@/lib/bybit/client";
import {
  checkBybitResearchEligibility,
  discoverBybitInstrument,
  discoverBybitSpotInstruments,
  isLikelyLeveragedTokenBase,
  isStablecoinVsStablecoin,
} from "../discovery/bybit-instrument-discovery";

function meta(overrides: Partial<InstrumentMetadata> & { status?: string } = {}): InstrumentMetadata {
  const { status = "Trading", ...rest } = overrides;
  return {
    symbol: "BTCUSDT",
    baseCoin: "BTC",
    quoteCoin: "USDT",
    tickSize: 0.01,
    qtyStep: 0.000001,
    minOrderQty: 0,
    minOrderAmt: 5,
    maxOrderQty: null,
    priceScale: 2,
    raw: { status },
    ...rest,
  };
}

describe("naming-convention heuristics (documented as heuristic, not authoritative)", () => {
  it("flags leveraged-token base coins like BTC3L / ETH3S", () => {
    expect(isLikelyLeveragedTokenBase("BTC3L")).toBe(true);
    expect(isLikelyLeveragedTokenBase("ETH3S")).toBe(true);
    expect(isLikelyLeveragedTokenBase("BTC")).toBe(false);
    expect(isLikelyLeveragedTokenBase("SOL")).toBe(false);
  });

  it("flags a stablecoin-vs-stablecoin pair", () => {
    expect(isStablecoinVsStablecoin("USDC", "USDT")).toBe(true);
    expect(isStablecoinVsStablecoin("BTC", "USDT")).toBe(false);
  });
});

describe("discoverBybitSpotInstruments / discoverBybitInstrument", () => {
  it("maps raw metadata to the venue-neutral shape without leaking the raw blob", async () => {
    (listSpotInstruments as ReturnType<typeof vi.fn>).mockResolvedValue([
      meta({ symbol: "SOLUSDT", baseCoin: "SOL" }),
      meta({ symbol: "BTC3LUSDT", baseCoin: "BTC3L" }),
    ]);

    const discovered = await discoverBybitSpotInstruments();
    expect(discovered).toHaveLength(2);
    expect(discovered[0]).not.toHaveProperty("raw");
    expect(discovered[1].isLikelyLeveragedToken).toBe(true);
  });

  it("returns null for a symbol that isn't listed at all", async () => {
    (listSpotInstruments as ReturnType<typeof vi.fn>).mockResolvedValue([meta({ symbol: "BTCUSDT" })]);
    const found = await discoverBybitInstrument("NOPEUSDT");
    expect(found).toBeNull();
  });
});

describe("checkBybitResearchEligibility", () => {
  it("is INELIGIBLE with NOT_LISTED_ON_VENUE when the venue doesn't have the symbol", async () => {
    (listSpotInstruments as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const result = await checkBybitResearchEligibility({
      venueSymbol: "SOLUSDT",
      historyBarCount: 1000,
      minHistoryBarCount: 500,
      minTurnoverUsd24h: 1_000_000,
    });
    expect(result.status).toBe("INELIGIBLE");
    expect(result.reasons).toContain("NOT_LISTED_ON_VENUE");
  });

  it("classifies ELIGIBLE using live turnover once every other check passes", async () => {
    (listSpotInstruments as ReturnType<typeof vi.fn>).mockResolvedValue([meta({ symbol: "SOLUSDT", baseCoin: "SOL" })]);
    (getTicker as ReturnType<typeof vi.fn>).mockResolvedValue({
      symbol: "SOLUSDT",
      lastPrice: 150,
      price24hPcnt: 0.01,
      highPrice24h: 155,
      lowPrice24h: 145,
      volume24h: 1000,
      turnover24h: 50_000_000,
      serverTimeMs: Date.now(),
    });

    const result = await checkBybitResearchEligibility({
      venueSymbol: "SOLUSDT",
      historyBarCount: 1000,
      minHistoryBarCount: 500,
      minTurnoverUsd24h: 1_000_000,
    });
    expect(result.status).toBe("ELIGIBLE");
  });
});
