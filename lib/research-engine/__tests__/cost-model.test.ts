import { describe, expect, it } from "vitest";
import {
  assertValidCostModel,
  computeEffectiveEntryPrice,
  computeEffectiveExitPrice,
  computeEntryFillCosts,
  computeExitFillCosts,
  validateCostModel,
  ZERO_COST_MODEL,
  type CostModel,
} from "../cost-model";

describe("cost model (§16) — every field has one exact meaning, applied once", () => {
  it("zero cost model leaves the price and qty untouched", () => {
    const entry = computeEntryFillCosts(100, 10, ZERO_COST_MODEL);
    expect(entry.effectivePrice).toBe(100);
    expect(entry.feeAmount).toBe(0);
    expect(entry.slippageAmount).toBe(0);
  });

  it("entry slippage moves the effective price UP (against a long buyer) by exactly entrySlippageBps", () => {
    const cost: CostModel = { entryFeeBps: 0, exitFeeBps: 0, entrySlippageBps: 10, exitSlippageBps: 0 }; // 10bps = 0.1%
    const result = computeEntryFillCosts(100, 1, cost);
    expect(result.effectivePrice).toBeCloseTo(100.1, 10);
  });

  it("exit slippage moves the effective price DOWN (against a long seller) by exactly exitSlippageBps", () => {
    const cost: CostModel = { entryFeeBps: 0, exitFeeBps: 0, entrySlippageBps: 0, exitSlippageBps: 10 };
    const result = computeExitFillCosts(100, 1, cost);
    expect(result.effectivePrice).toBeCloseTo(99.9, 10);
  });

  it("entry fee is charged once on entry notional at the effective (post-slippage) price", () => {
    const cost: CostModel = { entryFeeBps: 10, exitFeeBps: 0, entrySlippageBps: 0, exitSlippageBps: 0 };
    const result = computeEntryFillCosts(100, 2, cost); // notional = 200
    expect(result.feeAmount).toBeCloseTo(200 * (10 / 10_000), 10);
  });

  it("exit fee is charged once on exit notional at the effective (post-slippage) price, independent of entryFeeBps", () => {
    const cost: CostModel = { entryFeeBps: 999, exitFeeBps: 5, entrySlippageBps: 0, exitSlippageBps: 0 };
    const result = computeExitFillCosts(100, 2, cost);
    expect(result.feeAmount).toBeCloseTo(200 * (5 / 10_000), 10);
  });

  it("entry and exit costs are independent - changing one never changes the other's output", () => {
    const cost: CostModel = { entryFeeBps: 20, exitFeeBps: 5, entrySlippageBps: 15, exitSlippageBps: 3 };
    const entry = computeEntryFillCosts(100, 1, cost);
    const exit = computeExitFillCosts(100, 1, cost);
    expect(entry.effectivePrice).not.toBe(exit.effectivePrice);
  });

  it("§2: effective entry/exit price functions are price-only, independent of qty, so sizing can use them before qty exists", () => {
    const cost: CostModel = { entryFeeBps: 20, exitFeeBps: 5, entrySlippageBps: 15, exitSlippageBps: 3 };
    expect(computeEffectiveEntryPrice(100, cost)).toBeCloseTo(100.15, 10);
    expect(computeEffectiveExitPrice(100, cost)).toBeCloseTo(99.97, 10);
    // Matches what computeEntryFillCosts/computeExitFillCosts derive internally, for any qty.
    expect(computeEntryFillCosts(100, 7, cost).effectivePrice).toBe(computeEffectiveEntryPrice(100, cost));
    expect(computeExitFillCosts(100, 7, cost).effectivePrice).toBe(computeEffectiveExitPrice(100, cost));
  });
});

describe("cost model validation (§9) — no field can create artificial alpha via a negative cost", () => {
  it("accepts the zero-cost model", () => {
    expect(validateCostModel(ZERO_COST_MODEL)).toEqual({ valid: true, reasons: [] });
    expect(() => assertValidCostModel(ZERO_COST_MODEL)).not.toThrow();
  });

  it("rejects a negative entryFeeBps", () => {
    const cost: CostModel = { entryFeeBps: -1, exitFeeBps: 0, entrySlippageBps: 0, exitSlippageBps: 0 };
    expect(validateCostModel(cost).valid).toBe(false);
    expect(() => assertValidCostModel(cost)).toThrow(/entryFeeBps/);
  });

  it("rejects a negative exitFeeBps", () => {
    const cost: CostModel = { entryFeeBps: 0, exitFeeBps: -5, entrySlippageBps: 0, exitSlippageBps: 0 };
    expect(validateCostModel(cost).valid).toBe(false);
  });

  it("rejects a negative entrySlippageBps", () => {
    const cost: CostModel = { entryFeeBps: 0, exitFeeBps: 0, entrySlippageBps: -2, exitSlippageBps: 0 };
    expect(validateCostModel(cost).valid).toBe(false);
  });

  it("rejects a negative exitSlippageBps", () => {
    const cost: CostModel = { entryFeeBps: 0, exitFeeBps: 0, entrySlippageBps: 0, exitSlippageBps: -2 };
    expect(validateCostModel(cost).valid).toBe(false);
  });

  it("rejects NaN and Infinity in any field", () => {
    expect(validateCostModel({ entryFeeBps: Number.NaN, exitFeeBps: 0, entrySlippageBps: 0, exitSlippageBps: 0 }).valid).toBe(
      false,
    );
    expect(
      validateCostModel({ entryFeeBps: 0, exitFeeBps: Number.POSITIVE_INFINITY, entrySlippageBps: 0, exitSlippageBps: 0 })
        .valid,
    ).toBe(false);
  });

  it("reports one reason per invalid field, not just the first", () => {
    const cost: CostModel = { entryFeeBps: -1, exitFeeBps: -2, entrySlippageBps: -3, exitSlippageBps: -4 };
    const result = validateCostModel(cost);
    expect(result.reasons).toHaveLength(4);
  });
});
