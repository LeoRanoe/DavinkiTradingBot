import { describe, expect, it } from "vitest";
import { checkExchangeRulesAvailable, requireExchangeRules } from "../exchange-rules";
import { CRYPTO_SPOT_INSTRUMENTS } from "../instruments/crypto";

describe("exchange-rules fail-closed guard (Checkpoint 2 review §3)", () => {
  it("reports unavailable, naming every missing field, for the canonical registry (no fabricated values anywhere)", () => {
    for (const instrument of CRYPTO_SPOT_INSTRUMENTS) {
      const check = checkExchangeRulesAvailable(instrument);
      expect(check.available).toBe(false);
      if (!check.available) {
        expect(check.missing).toEqual(["priceIncrement", "sizeIncrement", "minSize"]);
      }
    }
  });

  it("requireExchangeRules throws rather than defaulting a missing rule to 0/1", () => {
    const btc = CRYPTO_SPOT_INSTRUMENTS[0];
    expect(() => requireExchangeRules(btc)).toThrow(/Exchange rules unavailable/);
  });

  it("reports available once every field is actually present (a real provider verification would supply these)", () => {
    const verified = { ...CRYPTO_SPOT_INSTRUMENTS[0], priceIncrement: 0.01, sizeIncrement: 0.000001, minSize: 0 };
    const check = checkExchangeRulesAvailable(verified);
    expect(check.available).toBe(true);
    expect(requireExchangeRules(verified)).toEqual({
      priceIncrement: 0.01,
      sizeIncrement: 0.000001,
      minSize: 0,
    });
  });
});
