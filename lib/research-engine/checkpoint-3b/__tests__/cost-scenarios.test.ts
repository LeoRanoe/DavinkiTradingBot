import { describe, expect, it } from "vitest";
import { COST_BASELINE, COST_FEE_ONLY, COST_HEAVY_STRESS, COST_STRESS, LOCKED_COST_SCENARIOS } from "../cost-scenarios";
import { validateCostModel } from "../../cost-model";

describe("Checkpoint 3B.0 locked cost scenarios (§9)", () => {
  it("COST_FEE_ONLY is exactly the public fee floor, zero slippage", () => {
    expect(COST_FEE_ONLY).toEqual({ entryFeeBps: 10, exitFeeBps: 10, entrySlippageBps: 0, exitSlippageBps: 0 });
  });

  it("COST_BASELINE is the primary evaluation assumption: fee + 2bps slippage each side", () => {
    expect(COST_BASELINE).toEqual({ entryFeeBps: 10, exitFeeBps: 10, entrySlippageBps: 2, exitSlippageBps: 2 });
  });

  it("COST_STRESS is fee + 5bps slippage each side", () => {
    expect(COST_STRESS).toEqual({ entryFeeBps: 10, exitFeeBps: 10, entrySlippageBps: 5, exitSlippageBps: 5 });
  });

  it("COST_HEAVY_STRESS is fee + 10bps slippage each side", () => {
    expect(COST_HEAVY_STRESS).toEqual({ entryFeeBps: 10, exitFeeBps: 10, entrySlippageBps: 10, exitSlippageBps: 10 });
  });

  it("exactly four locked scenarios, all valid cost models", () => {
    expect(Object.keys(LOCKED_COST_SCENARIOS)).toHaveLength(4);
    for (const model of Object.values(LOCKED_COST_SCENARIOS)) {
      expect(validateCostModel(model).valid).toBe(true);
    }
  });

  it("slippage strictly increases fee-only -> baseline -> stress -> heavy_stress", () => {
    expect(COST_FEE_ONLY.entrySlippageBps).toBeLessThan(COST_BASELINE.entrySlippageBps);
    expect(COST_BASELINE.entrySlippageBps).toBeLessThan(COST_STRESS.entrySlippageBps);
    expect(COST_STRESS.entrySlippageBps).toBeLessThan(COST_HEAVY_STRESS.entrySlippageBps);
  });
});
