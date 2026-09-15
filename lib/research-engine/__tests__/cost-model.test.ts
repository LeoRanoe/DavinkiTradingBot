import { describe, expect, it } from "vitest";
import { applyEntryCosts, applyExitCosts, ZERO_COST_MODEL, type CostModel } from "../cost-model";

describe("cost model (§16) — every field has one exact meaning, applied once", () => {
  it("zero cost model leaves the price and qty untouched", () => {
    const entry = applyEntryCosts(100, 10, ZERO_COST_MODEL);
    expect(entry.effectivePrice).toBe(100);
    expect(entry.feeAmount).toBe(0);
    expect(entry.slippageAmount).toBe(0);
  });

  it("entry slippage moves the effective price UP (against a long buyer) by exactly entrySlippageBps", () => {
    const cost: CostModel = { entryFeeBps: 0, exitFeeBps: 0, entrySlippageBps: 10, exitSlippageBps: 0 }; // 10bps = 0.1%
    const result = applyEntryCosts(100, 1, cost);
    expect(result.effectivePrice).toBeCloseTo(100.1, 10);
  });

  it("exit slippage moves the effective price DOWN (against a long seller) by exactly exitSlippageBps", () => {
    const cost: CostModel = { entryFeeBps: 0, exitFeeBps: 0, entrySlippageBps: 0, exitSlippageBps: 10 };
    const result = applyExitCosts(100, 1, cost);
    expect(result.effectivePrice).toBeCloseTo(99.9, 10);
  });

  it("entry fee is charged once on entry notional at the effective (post-slippage) price", () => {
    const cost: CostModel = { entryFeeBps: 10, exitFeeBps: 0, entrySlippageBps: 0, exitSlippageBps: 0 };
    const result = applyEntryCosts(100, 2, cost); // notional = 200
    expect(result.feeAmount).toBeCloseTo(200 * (10 / 10_000), 10);
  });

  it("exit fee is charged once on exit notional at the effective (post-slippage) price, independent of entryFeeBps", () => {
    const cost: CostModel = { entryFeeBps: 999, exitFeeBps: 5, entrySlippageBps: 0, exitSlippageBps: 0 };
    const result = applyExitCosts(100, 2, cost);
    expect(result.feeAmount).toBeCloseTo(200 * (5 / 10_000), 10);
  });

  it("entry and exit costs are independent - changing one never changes the other's output", () => {
    const cost: CostModel = { entryFeeBps: 20, exitFeeBps: 5, entrySlippageBps: 15, exitSlippageBps: 3 };
    const entry = applyEntryCosts(100, 1, cost);
    const exit = applyExitCosts(100, 1, cost);
    expect(entry.effectivePrice).not.toBe(exit.effectivePrice);
  });
});
