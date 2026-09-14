import { describe, expect, it } from "vitest";
import { assertLongOnlyPolicy, makeInstrumentId } from "../instrument";
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
    expect(decision.reason).toBe("CRYPTO_SPOT_LONG_ONLY_POLICY");
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
});
