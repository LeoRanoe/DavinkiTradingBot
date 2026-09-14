import { describe, expect, it } from "vitest";
import { checkExchangeRulesAvailable, requireExchangeRules } from "../exchange-rules";
import { CRYPTO_SPOT_INSTRUMENTS } from "../instruments/crypto";

describe("exchange-rules fail-closed guard (Checkpoint 2 review §3; final guardrail patch §7)", () => {
  it("reports unavailable, naming every missing field, for the canonical registry (no fabricated values anywhere)", () => {
    for (const instrument of CRYPTO_SPOT_INSTRUMENTS) {
      const check = checkExchangeRulesAvailable(instrument);
      expect(check.available).toBe(false);
      if (!check.available) {
        expect(check.problems).toEqual(["priceIncrement: missing", "sizeIncrement: missing", "minSize: missing"]);
      }
    }
  });

  it("requireExchangeRules throws rather than defaulting a missing rule to 0/1", () => {
    const btc = CRYPTO_SPOT_INSTRUMENTS[0];
    expect(() => requireExchangeRules(btc)).toThrow(/Exchange rules unavailable or invalid/);
  });

  it("reports available once every field is actually present and valid (a real provider verification would supply these)", () => {
    const verified = { ...CRYPTO_SPOT_INSTRUMENTS[0], priceIncrement: 0.01, sizeIncrement: 0.000001, minSize: 0 };
    const check = checkExchangeRulesAvailable(verified);
    expect(check.available).toBe(true);
    expect(requireExchangeRules(verified)).toEqual({
      priceIncrement: 0.01,
      sizeIncrement: 0.000001,
      minSize: 0,
    });
  });

  describe("rejects present-but-malformed values rather than trusting them", () => {
    const base = { ...CRYPTO_SPOT_INSTRUMENTS[0], priceIncrement: 0.01, sizeIncrement: 0.000001, minSize: 0 };

    it("zero priceIncrement", () => {
      const check = checkExchangeRulesAvailable({ ...base, priceIncrement: 0 });
      expect(check.available).toBe(false);
    });

    it("negative sizeIncrement", () => {
      const check = checkExchangeRulesAvailable({ ...base, sizeIncrement: -0.01 });
      expect(check.available).toBe(false);
    });

    it("negative minSize", () => {
      const check = checkExchangeRulesAvailable({ ...base, minSize: -1 });
      expect(check.available).toBe(false);
    });

    it("NaN priceIncrement", () => {
      const check = checkExchangeRulesAvailable({ ...base, priceIncrement: Number.NaN });
      expect(check.available).toBe(false);
    });

    it("Infinity sizeIncrement", () => {
      const check = checkExchangeRulesAvailable({ ...base, sizeIncrement: Number.POSITIVE_INFINITY });
      expect(check.available).toBe(false);
    });

    it("accepts minSize = 0 (a legitimate 'no exchange minimum')", () => {
      const check = checkExchangeRulesAvailable({ ...base, minSize: 0 });
      expect(check.available).toBe(true);
    });

    it("requireExchangeRules throws on a malformed value, not just a missing one", () => {
      expect(() => requireExchangeRules({ ...base, priceIncrement: -1 })).toThrow(/must be a finite positive number/);
    });
  });
});
