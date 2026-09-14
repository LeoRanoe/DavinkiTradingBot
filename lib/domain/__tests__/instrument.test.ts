import { describe, expect, it } from "vitest";
import { assertLongOnlyPolicy, KNOWN_VENUE_IDS, makeInstrumentId, type Instrument, type VenueId } from "../instrument";
import { CRYPTO_SPOT_INSTRUMENTS } from "../instruments/crypto";
import { FAKE_FOREX_INSTRUMENTS } from "../instruments/forex-fake";

describe("makeInstrumentId", () => {
  it("builds venue-independent canonical ids", () => {
    expect(makeInstrumentId("CRYPTO_SPOT", "BYBIT", "BTC", "USDT")).toBe("CRYPTO:BYBIT:BTC/USDT");
    expect(makeInstrumentId("FOREX", "OANDA_FAKE", "EUR", "USD")).toBe("FOREX:OANDA_FAKE:EUR/USD");
  });
});

describe("assertLongOnlyPolicy", () => {
  it("allows LONG on every current instrument", () => {
    for (const i of [...CRYPTO_SPOT_INSTRUMENTS, ...FAKE_FOREX_INSTRUMENTS]) {
      expect(assertLongOnlyPolicy("LONG", i).allowed).toBe(true);
    }
  });

  it("rejects SHORT on a crypto-spot instrument (allowsShort=false)", () => {
    const btc = CRYPTO_SPOT_INSTRUMENTS[0];
    const decision = assertLongOnlyPolicy("SHORT", btc);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("INSTRUMENT_DOES_NOT_ALLOW_SHORT");
  });

  it("STILL rejects SHORT on an instrument whose convention allows it (platform-wide long-only policy)", () => {
    const eurusd = FAKE_FOREX_INSTRUMENTS[0];
    expect(eurusd.allowsShort).toBe(true); // the convention permits it...
    const decision = assertLongOnlyPolicy("SHORT", eurusd);
    expect(decision.allowed).toBe(false); // ...but platform policy still refuses it
    expect(decision.reason).toBe("PLATFORM_LONG_ONLY_POLICY");
  });
});

describe("VenueId is extensible (Checkpoint 2 review §7)", () => {
  it("accepts a brand-new venue id with no type change - adding a real venue is data, not a union-widening edit", () => {
    const futureVenue: VenueId = "KRAKEN"; // not in KNOWN_VENUE_IDS and never will be added there
    const instrument: Instrument = {
      id: makeInstrumentId("CRYPTO_SPOT", futureVenue, "BTC", "USD"),
      assetClass: "CRYPTO_SPOT",
      venue: futureVenue,
      venueSymbol: "XBTUSD",
      baseAsset: "BTC",
      quoteAsset: "USD",
      settlementAsset: "USD",
      allowsLong: true,
      allowsShort: false,
      tradingCalendarId: "CRYPTO_24_7",
      isActive: true,
    };
    expect(instrument.venue).toBe("KRAKEN");
  });

  it("KNOWN_VENUE_IDS still names the venues fixtures/tests actually use, for typo-safety", () => {
    expect(KNOWN_VENUE_IDS.BYBIT).toBe("BYBIT");
    expect(KNOWN_VENUE_IDS.OANDA_FAKE).toBe("OANDA_FAKE");
    expect(KNOWN_VENUE_IDS.IBKR_FAKE).toBe("IBKR_FAKE");
  });
});

describe("crypto instrument registry", () => {
  it("keeps the frozen V1 production pair (BTC/USDT, ETH/USDT) present and long-only", () => {
    const ids = CRYPTO_SPOT_INSTRUMENTS.map((i) => i.venueSymbol);
    expect(ids).toContain("BTCUSDT");
    expect(ids).toContain("ETHUSDT");
    for (const i of CRYPTO_SPOT_INSTRUMENTS) {
      expect(i.allowsShort).toBe(false);
      expect(i.assetClass).toBe("CRYPTO_SPOT");
    }
  });

  it("marks new research-candidate instruments as not PAPER-enabled", () => {
    const candidates = CRYPTO_SPOT_INSTRUMENTS.filter((i) => i.metadata?.researchCandidate);
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c.metadata?.paperEnabled).toBe(false);
    }
  });

  it("does NOT hard-code fabricated exchange rules for ANY crypto instrument, including BTC/ETH (Checkpoint 2 review §3)", () => {
    for (const i of CRYPTO_SPOT_INSTRUMENTS) {
      expect(i.priceIncrement).toBeUndefined();
      expect(i.sizeIncrement).toBeUndefined();
      expect(i.minSize).toBeUndefined();
    }
  });

  it("keeps metadata.verifiedOnVenue false for every research candidate until runtime provider verification", () => {
    const candidates = CRYPTO_SPOT_INSTRUMENTS.filter((i) => i.metadata?.researchCandidate);
    for (const c of candidates) {
      expect(c.metadata?.verifiedOnVenue).toBe(false);
    }
  });
});
