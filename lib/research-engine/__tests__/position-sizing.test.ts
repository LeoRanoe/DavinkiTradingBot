import { describe, expect, it } from "vitest";
import { computeNormalizedPositionSize, type NormalizedRiskConfig } from "../position-sizing";

const config: NormalizedRiskConfig = { initialEquity: 10_000, riskPct: 0.01 };

describe("computeNormalizedPositionSize (§14/§15, no-leverage hardening §1)", () => {
  it("wide stop -> normal risk-sized position, not capital capped", () => {
    // 3% stop distance: riskSizedNotional = 100/0.03 = 3333.33, well under equity=10000.
    const result = computeNormalizedPositionSize(100, 97, 10_000, config);
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.targetRiskBudget).toBeCloseTo(100, 10); // 10000*0.01
    expect(result.stopDistancePct).toBeCloseTo(0.03, 10);
    const expectedQty = (100 / 0.03) / 100;
    expect(result.qty).toBeCloseTo(expectedQty, 10);
    expect(result.capitalCapped).toBe(false);
    expect(result.actualInitialRisk).toBeCloseTo(result.targetRiskBudget, 10);
  });

  it("narrow stop -> capital capped to available equity, no leverage", () => {
    // 0.5% stop distance: riskSizedNotional = 100/0.005 = 20000 = 2x equity(10000) if uncapped.
    const result = computeNormalizedPositionSize(100, 99.5, 10_000, config);
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.capitalCapped).toBe(true);
    const notional = result.qty * 100;
    expect(notional).toBeCloseTo(10_000, 6); // capped to exactly 1x equity
    expect(notional).toBeLessThanOrEqual(10_000 + 1e-9);
  });

  it("notional is never greater than available equity, across a range of stop distances", () => {
    for (const stopDistancePct of [0.0001, 0.001, 0.005, 0.01, 0.02, 0.05, 0.1, 0.5]) {
      const stop = 100 * (1 - stopDistancePct);
      const result = computeNormalizedPositionSize(100, stop, 10_000, config);
      expect(result.accepted).toBe(true);
      if (!result.accepted) continue;
      const notional = result.qty * 100;
      expect(notional).toBeLessThanOrEqual(10_000 + 1e-9);
    }
  });

  it("actualInitialRisk is strictly less than targetRiskBudget when capital capped", () => {
    const result = computeNormalizedPositionSize(100, 99.5, 10_000, config);
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.capitalCapped).toBe(true);
    expect(result.actualInitialRisk).toBeLessThan(result.targetRiskBudget);
    // actualInitialRisk = qty * (entry - stop) directly, sanity-check the formula.
    expect(result.actualInitialRisk).toBeCloseTo(result.qty * (100 - 99.5), 10);
  });

  it("actualInitialRisk equals targetRiskBudget when NOT capital capped (wide stop)", () => {
    const result = computeNormalizedPositionSize(100, 97, 10_000, config);
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.capitalCapped).toBe(false);
    expect(result.actualInitialRisk).toBeCloseTo(result.targetRiskBudget, 10);
  });

  it("rejects when stop >= entry, never inflating or shrinking to force a fit", () => {
    expect(computeNormalizedPositionSize(100, 100, 10_000, config)).toEqual({
      accepted: false,
      reason: "STOP_NOT_BELOW_ENTRY",
    });
    expect(computeNormalizedPositionSize(100, 105, 10_000, config)).toEqual({
      accepted: false,
      reason: "STOP_NOT_BELOW_ENTRY",
    });
  });

  it("rejects non-finite inputs rather than propagating NaN/Infinity", () => {
    expect(computeNormalizedPositionSize(Number.NaN, 90, 10_000, config).accepted).toBe(false);
    expect(computeNormalizedPositionSize(100, 90, Number.POSITIVE_INFINITY, config).accepted).toBe(false);
    expect(computeNormalizedPositionSize(100, Number.NaN, 10_000, config).accepted).toBe(false);
    expect(computeNormalizedPositionSize(100, 90, 10_000, { initialEquity: 10_000, riskPct: Number.NaN }).accepted).toBe(
      false,
    );
  });

  it("rejects zero or negative equity", () => {
    expect(computeNormalizedPositionSize(100, 90, 0, config)).toEqual({
      accepted: false,
      reason: "NON_POSITIVE_EQUITY",
    });
    expect(computeNormalizedPositionSize(100, 90, -100, config)).toEqual({
      accepted: false,
      reason: "NON_POSITIVE_EQUITY",
    });
  });

  it("rejects riskPct <= 0", () => {
    expect(computeNormalizedPositionSize(100, 90, 10_000, { initialEquity: 10_000, riskPct: 0 })).toEqual({
      accepted: false,
      reason: "RISK_PCT_OUT_OF_RANGE",
    });
    expect(computeNormalizedPositionSize(100, 90, 10_000, { initialEquity: 10_000, riskPct: -0.01 })).toEqual({
      accepted: false,
      reason: "RISK_PCT_OUT_OF_RANGE",
    });
  });

  it("rejects riskPct > 1 (more than 100% of equity risked per trade)", () => {
    expect(computeNormalizedPositionSize(100, 90, 10_000, { initialEquity: 10_000, riskPct: 1.5 })).toEqual({
      accepted: false,
      reason: "RISK_PCT_OUT_OF_RANGE",
    });
  });

  it("accepts riskPct exactly 1 (boundary, not out of range)", () => {
    const result = computeNormalizedPositionSize(100, 90, 10_000, { initialEquity: 10_000, riskPct: 1 });
    expect(result.accepted).toBe(true);
  });

  it("no leverage: notional is always <= equity, never the uncapped riskBudget/stopDistancePct when that exceeds equity", () => {
    const result = computeNormalizedPositionSize(100, 90, 10_000, config); // 10% stop -> riskSizedNotional = 100/0.10 = 1000, under equity
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    const notional = result.qty * 100;
    expect(notional).toBeCloseTo(result.targetRiskBudget / result.stopDistancePct, 6);
    expect(result.capitalCapped).toBe(false);
  });

  it("risk budget scales with current equity, not the initial equity (compounding convention)", () => {
    const grown = computeNormalizedPositionSize(100, 97, 20_000, config);
    expect(grown.accepted).toBe(true);
    if (grown.accepted) expect(grown.targetRiskBudget).toBeCloseTo(200, 10);
  });
});
