import { describe, expect, it } from "vitest";
import { sizeGoldPosition, GOLD_CONTRACT_SPEC } from "./sizing";
import { JEANFX_GOLD_RISK_LIMITS } from "./config";

const EQUITY = 100_000;

describe("sizeGoldPosition - LONG", () => {
  it("sizes a valid LONG setup within the 1% risk cap at RR >= 3.0", () => {
    const result = sizeGoldPosition({ direction: "LONG", entryPrice: 2400, stopPrice: 2390, targetPrice: 2430, equity: EQUITY });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rMultiple).toBeCloseTo(3.0, 5);
    expect(result.riskAmount).toBeCloseTo(EQUITY * JEANFX_GOLD_RISK_LIMITS.riskPctMax, 5);
    // riskAmount / stopDistance, floored to unitStep, never inflated above the budget.
    const rawQty = result.riskAmount / (10 * GOLD_CONTRACT_SPEC.contractUnitValue);
    expect(result.qty).toBeLessThanOrEqual(rawQty);
    expect(result.qty).toBeGreaterThan(0);
  });

  it("rejects a stop on the wrong side of entry for LONG", () => {
    const result = sizeGoldPosition({ direction: "LONG", entryPrice: 2400, stopPrice: 2410, targetPrice: 2430, equity: EQUITY });
    expect(result).toEqual({ ok: false, reason: "INVALID_PRICES" });
  });
});

describe("sizeGoldPosition - SHORT", () => {
  it("sizes a valid SHORT setup (stop above entry, target below)", () => {
    const result = sizeGoldPosition({ direction: "SHORT", entryPrice: 2400, stopPrice: 2410, targetPrice: 2370, equity: EQUITY });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rMultiple).toBeCloseTo(3.0, 5);
    expect(result.qty).toBeGreaterThan(0);
  });

  it("rejects a stop on the wrong side of entry for SHORT", () => {
    const result = sizeGoldPosition({ direction: "SHORT", entryPrice: 2400, stopPrice: 2390, targetPrice: 2370, equity: EQUITY });
    expect(result).toEqual({ ok: false, reason: "INVALID_PRICES" });
  });
});

describe("sizeGoldPosition - risk/RR discipline", () => {
  it("rejects RR below the 3.0 minimum", () => {
    const result = sizeGoldPosition({ direction: "LONG", entryPrice: 2400, stopPrice: 2390, targetPrice: 2415, equity: EQUITY }); // R = 1.5
    expect(result).toEqual({ ok: false, reason: "RR_BELOW_MINIMUM" });
  });

  it("rejects a riskPct above the 1% maximum - never silently clamped", () => {
    const result = sizeGoldPosition({ direction: "LONG", entryPrice: 2400, stopPrice: 2390, targetPrice: 2430, equity: EQUITY, riskPct: 0.02 });
    expect(result).toEqual({ ok: false, reason: "RISK_PCT_EXCEEDS_MAX" });
  });

  it("rejects zero stop distance rather than dividing by zero", () => {
    const result = sizeGoldPosition({ direction: "LONG", entryPrice: 2400, stopPrice: 2400, targetPrice: 2430, equity: EQUITY });
    expect(result.ok).toBe(false);
  });

  it("never inflates a below-minimum-unit size - rejects instead (mirrors CLAUDE.md #4)", () => {
    // Tiny equity - riskAmount so small the floored qty rounds to 0.
    const result = sizeGoldPosition({ direction: "LONG", entryPrice: 2400, stopPrice: 2399.99, targetPrice: 2400.06, equity: 0.001 });
    expect(result.ok).toBe(false);
  });

  it("rejects non-positive prices/equity", () => {
    expect(sizeGoldPosition({ direction: "LONG", entryPrice: 0, stopPrice: 2390, targetPrice: 2430, equity: EQUITY })).toEqual({ ok: false, reason: "INVALID_PRICES" });
    expect(sizeGoldPosition({ direction: "LONG", entryPrice: 2400, stopPrice: 2390, targetPrice: 2430, equity: 0 })).toEqual({ ok: false, reason: "INVALID_PRICES" });
  });
});
