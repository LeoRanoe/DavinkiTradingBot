import { describe, expect, it } from "vitest";
import { computeOpenFill, computeSettlement } from "./settlement";

const costModel = { feeBps: 10, slippageBps: 5 };

describe("open fill", () => {
  it("fills a long ABOVE the reference price - slippage always works against us", () => {
    const fill = computeOpenFill(100, 2, costModel);
    expect(fill.entryFillPrice).toBeGreaterThan(100);
    expect(fill.entryFillPrice).toBeCloseTo(100 * 1.0005);
    expect(fill.entrySlippageCost).toBeCloseTo(0.1); // (100.05 - 100) * 2
  });

  it("charges the entry fee on the filled notional", () => {
    const fill = computeOpenFill(100, 2, costModel);
    expect(fill.entryFee).toBeCloseTo(fill.notional * 0.001);
  });
});

describe("settlement cost accounting", () => {
  const base = {
    entryFillPrice: 100,
    rawExitPrice: 110,
    qty: 2,
    entryFee: 0.2,
    entrySlippageCost: 0.1,
    costModel,
    riskBasis: 10,
  };

  it("exits a long BELOW the stop/target price - slippage works against us on the way out too", () => {
    const s = computeSettlement(base);
    expect(s.exitFillPrice).toBeLessThan(110);
    expect(s.exitFillPrice).toBeCloseTo(110 * 0.9995);
  });

  it("subtracts each fee exactly once and never subtracts slippage twice", () => {
    const s = computeSettlement(base);
    // Slippage is already inside the fill prices, so net = gross - fees only.
    expect(s.netPnl).toBeCloseTo(s.grossPnl - base.entryFee - s.exitFee);
    // Explicitly assert the double-count would be different, so a future
    // change that subtracts slippage again fails here.
    expect(s.netPnl).not.toBeCloseTo(s.grossPnl - base.entryFee - s.exitFee - s.realizedSlippage);
  });

  it("reports round-trip slippage for auditing without deducting it from P/L", () => {
    const s = computeSettlement(base);
    const exitLeg = (110 - s.exitFillPrice) * 2;
    expect(s.realizedSlippage).toBeCloseTo(base.entrySlippageCost + exitLeg);
  });

  it("totalFees is the entry plus the exit fee", () => {
    const s = computeSettlement(base);
    expect(s.totalFees).toBeCloseTo(base.entryFee + s.exitFee);
  });

  it("a winning trade nets less than its gross move once costs are applied", () => {
    const s = computeSettlement(base);
    expect(s.grossPnl).toBeGreaterThan(0);
    expect(s.netPnl).toBeLessThan(s.grossPnl);
  });
});

describe("realized R", () => {
  it("a clean stop-out lands near -1R when risk basis is the modeled max loss", () => {
    // Entry reference 100 with 5bps slippage -> fill 100.05, stop 97.
    const qty = 3;
    const fill = computeOpenFill(100, qty, costModel);
    const priceRisk = qty * (100 - 97);
    const modeledMaxLoss =
      priceRisk + fill.entryFee + fill.entryFee + (100 * qty * (costModel.slippageBps / 10_000)) * 2;

    const s = computeSettlement({
      entryFillPrice: fill.entryFillPrice,
      rawExitPrice: 97,
      qty,
      entryFee: fill.entryFee,
      entrySlippageCost: fill.entrySlippageCost,
      costModel,
      riskBasis: modeledMaxLoss,
    });

    expect(s.netPnl).toBeLessThan(0);
    expect(s.realizedR).toBeLessThan(0);
    // Close to -1R, and never flatteringly small.
    expect(s.realizedR).toBeGreaterThan(-1.2);
    expect(s.realizedR).toBeLessThan(-0.85);
  });

  it("a 2R target yields roughly +2R after costs, not more", () => {
    const qty = 3;
    const fill = computeOpenFill(100, qty, costModel);
    const priceRisk = qty * (100 - 97);
    const modeledMaxLoss =
      priceRisk + fill.entryFee * 2 + (100 * qty * (costModel.slippageBps / 10_000)) * 2;

    const s = computeSettlement({
      entryFillPrice: fill.entryFillPrice,
      rawExitPrice: 106, // 2x the 3-point stop distance
      qty,
      entryFee: fill.entryFee,
      entrySlippageCost: fill.entrySlippageCost,
      costModel,
      riskBasis: modeledMaxLoss,
    });

    expect(s.realizedR).toBeGreaterThan(1.5);
    expect(s.realizedR).toBeLessThan(2.05);
  });

  it("never divides by zero when no risk basis was recorded", () => {
    const s = computeSettlement({ ...{ entryFillPrice: 100, rawExitPrice: 110, qty: 1, entryFee: 0, entrySlippageCost: 0, costModel }, riskBasis: 0 });
    expect(s.realizedR).toBe(0);
  });
});
