import { describe, expect, it } from "vitest";
import { FakeForexMarketDataProvider } from "../adapters/fake-forex-market-data-provider";
import { FAKE_FOREX_INSTRUMENTS } from "../instruments/forex-fake";
import { assertLongOnlyPolicy } from "../instrument";
import { forexRiskCompliantLots } from "../position-sizing-contract";

const eurusd = FAKE_FOREX_INSTRUMENTS.find((i) => i.venueSymbol === "EUR_USD")!;
const usdjpy = FAKE_FOREX_INSTRUMENTS.find((i) => i.venueSymbol === "USD_JPY")!;

describe("FakeForexMarketDataProvider (forex readiness proof, no real broker)", () => {
  it("prices EUR/USD around 1.1050 with a bid/ask spread", async () => {
    // Wed 12:00 UTC - definitely open.
    const openMs = Date.parse("2026-09-16T12:00:00Z");
    const provider = new FakeForexMarketDataProvider(() => openMs);
    const ticker = await provider.getTicker(eurusd);
    expect(ticker.lastPrice).toBeCloseTo(1.105, 4);
    expect(ticker.bid).toBeLessThan(ticker.lastPrice);
    expect(ticker.ask).toBeGreaterThan(ticker.lastPrice);
  });

  it("prices USD/JPY around 150.25", async () => {
    const openMs = Date.parse("2026-09-16T12:00:00Z");
    const provider = new FakeForexMarketDataProvider(() => openMs);
    const ticker = await provider.getTicker(usdjpy);
    expect(ticker.lastPrice).toBeCloseTo(150.25, 2);
  });

  it("has distinct pip sizes for a USD pair vs a JPY pair", () => {
    expect(eurusd.pipSize).toBe(0.0001);
    expect(usdjpy.pipSize).toBe(0.01);
  });

  it("reports the market closed on a weekend (Saturday)", async () => {
    const saturdayMs = Date.parse("2026-09-19T12:00:00Z"); // a Saturday
    const provider = new FakeForexMarketDataProvider(() => saturdayMs);
    await expect(provider.getTicker(eurusd)).rejects.toThrow(/MARKET_CLOSED/);
  });

  it("reports the market open again just before the Sunday close boundary lifts", async () => {
    const sundayEveningMs = Date.parse("2026-09-20T23:00:00Z"); // Sunday 23:00 UTC, after the 22:00 reopen
    const provider = new FakeForexMarketDataProvider(() => sundayEveningMs);
    await expect(provider.getTicker(eurusd)).resolves.toBeDefined();
  });

  it("accepts a LONG EUR/USD opportunity under current platform policy but rejects SHORT (long-only across asset classes)", () => {
    expect(assertLongOnlyPolicy("LONG", eurusd).allowed).toBe(true);
    expect(assertLongOnlyPolicy("SHORT", eurusd).allowed).toBe(false);
  });
});

describe("forexRiskCompliantLots (does not reuse the crypto qty×price formula)", () => {
  it("sizes EUR/USD from riskBudgetAccountCurrency / lossPerLotAtStop, not qty×price", () => {
    // $100 risk budget, 20 pip stop, $10/pip/lot, USD account (no conversion needed).
    const lots = forexRiskCompliantLots({
      riskBudgetAccountCurrency: 100,
      stopDistancePips: 20,
      pipValuePerLot: 10,
      quoteToAccountConversionRate: 1,
    });
    expect(lots).toBeCloseTo(0.5, 5); // 100 / (20*10) = 0.5 lots
  });

  it("returns 0 rather than dividing by zero when stop distance is 0", () => {
    const lots = forexRiskCompliantLots({
      riskBudgetAccountCurrency: 100,
      stopDistancePips: 0,
      pipValuePerLot: 10,
      quoteToAccountConversionRate: 1,
    });
    expect(lots).toBe(0);
  });
});
