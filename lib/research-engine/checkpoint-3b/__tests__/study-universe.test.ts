import { describe, expect, it } from "vitest";
import { EXPECTED_CONFIGURATION_COUNT, STUDY_INSTRUMENTS, STUDY_PARAMETER_SETS, STUDY_VENUE_SYMBOLS } from "../study-universe";

describe("Checkpoint 3B.0 study universe (§1/§3) — locked before any real result", () => {
  it("is exactly the five preregistered instruments", () => {
    expect(STUDY_VENUE_SYMBOLS).toEqual(["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT"]);
    expect(STUDY_INSTRUMENTS).toHaveLength(5);
    expect(STUDY_INSTRUMENTS.map((i) => i.venueSymbol)).toEqual([...STUDY_VENUE_SYMBOLS]);
  });

  it("every study instrument is CRYPTO_SPOT on BYBIT", () => {
    for (const instrument of STUDY_INSTRUMENTS) {
      expect(instrument.assetClass).toBe("CRYPTO_SPOT");
      expect(instrument.venue).toBe("BYBIT");
    }
  });

  it("is exactly the six frozen TRB parameter sets, re-exported from strategies/trb.ts (never redefined)", () => {
    expect(STUDY_PARAMETER_SETS).toHaveLength(6);
    expect(STUDY_PARAMETER_SETS.map((p) => p.id).sort()).toEqual(
      [
        "TRB-1H-20-10",
        "TRB-1H-50-20",
        "TRB-1H-100-50",
        "TRB-4H-20-10",
        "TRB-4H-50-20",
        "TRB-4H-100-50",
      ].sort(),
    );
  });

  it("the base experiment size is exactly 30 (5 instruments x 6 configs)", () => {
    expect(EXPECTED_CONFIGURATION_COUNT).toBe(30);
  });
});
