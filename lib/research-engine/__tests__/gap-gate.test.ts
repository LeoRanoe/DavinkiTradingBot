import { describe, expect, it } from "vitest";
import { assertRealTrialGapGate, checkRealTrialGapGate, type GapGateInput } from "../gap-gate";

const NO_GAPS: GapGateInput = { gaps: [], truncated: false };
const ONE_GAP: GapGateInput = {
  gaps: [{ afterOpenTime: 0, beforeOpenTime: 7_200_000, expectedIntervalMs: 3_600_000, actualIntervalMs: 7_200_000 }],
  truncated: false,
};

describe("checkRealTrialGapGate (§5) — a gapped CRYPTO_24_7 dataset must never silently enter a real trial", () => {
  it("allows a gap-free, non-truncated CRYPTO_24_7 load", () => {
    expect(checkRealTrialGapGate(NO_GAPS, { assetCalendarClass: "CRYPTO_24_7" })).toEqual({ allowed: true });
  });

  it("blocks a CRYPTO_24_7 load with an unexplained gap", () => {
    const result = checkRealTrialGapGate(ONE_GAP, { assetCalendarClass: "CRYPTO_24_7" });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.gapCount).toBe(1);
      expect(result.reason).toMatch(/gap/i);
    }
  });

  it("allows a gapped CRYPTO_24_7 load ONLY with an explicit reviewed exception", () => {
    const result = checkRealTrialGapGate(ONE_GAP, {
      assetCalendarClass: "CRYPTO_24_7",
      reviewedGapException: "Documented Bybit outage 2024-01-01, confirmed via status page.",
    });
    expect(result.allowed).toBe(true);
  });

  it("an empty-string reviewedGapException does not count as an exception", () => {
    const result = checkRealTrialGapGate(ONE_GAP, { assetCalendarClass: "CRYPTO_24_7", reviewedGapException: "" });
    expect(result.allowed).toBe(false);
  });

  it("blocks a truncated load even with zero detected gaps - truncation can hide gaps beyond the covered range", () => {
    const result = checkRealTrialGapGate({ gaps: [], truncated: true }, { assetCalendarClass: "CRYPTO_24_7" });
    expect(result.allowed).toBe(false);
  });

  it("truncation blocks even with a reviewed gap exception supplied (the exception is about gaps, not truncation)", () => {
    const result = checkRealTrialGapGate(
      { gaps: [], truncated: true },
      { assetCalendarClass: "CRYPTO_24_7", reviewedGapException: "reviewed" },
    );
    expect(result.allowed).toBe(false);
  });

  it("does not gate a non-CRYPTO_24_7 calendar class - out of scope by design (§5)", () => {
    expect(checkRealTrialGapGate(ONE_GAP, { assetCalendarClass: "SESSIONED" })).toEqual({ allowed: true });
  });

  it("assertRealTrialGapGate throws exactly when checkRealTrialGapGate disallows, and is silent otherwise", () => {
    expect(() => assertRealTrialGapGate(NO_GAPS, { assetCalendarClass: "CRYPTO_24_7" })).not.toThrow();
    expect(() => assertRealTrialGapGate(ONE_GAP, { assetCalendarClass: "CRYPTO_24_7" })).toThrow(/gap/i);
  });
});
