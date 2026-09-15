import { describe, expect, it } from "vitest";
import { computeNormalizedPositionSize, type NormalizedRiskConfig } from "../position-sizing";

const config: NormalizedRiskConfig = { initialEquity: 10_000, riskPct: 0.01 };

describe("computeNormalizedPositionSize (§14/§15)", () => {
  it("riskBudget = equity * riskPct, stopDistancePct = (entry-stop)/entry, qty = (riskBudget/stopDistancePct)/entry", () => {
    const result = computeNormalizedPositionSize(100, 97, 10_000, config); // 3% stop
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.riskBudget).toBeCloseTo(100, 10); // 10000*0.01
      expect(result.stopDistancePct).toBeCloseTo(0.03, 10);
      const expectedQty = (100 / 0.03) / 100;
      expect(result.qty).toBeCloseTo(expectedQty, 10);
    }
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

  it("uses no leverage: sizing is a pure function of riskBudget and stop distance, never scaled beyond that", () => {
    const result = computeNormalizedPositionSize(100, 90, 10_000, config);
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      const notional = result.qty * 100;
      expect(notional).toBeCloseTo(result.riskBudget / result.stopDistancePct, 6);
    }
  });

  it("rejects non-finite inputs rather than propagating NaN/Infinity", () => {
    expect(computeNormalizedPositionSize(Number.NaN, 90, 10_000, config).accepted).toBe(false);
    expect(computeNormalizedPositionSize(100, 90, Number.POSITIVE_INFINITY, config).accepted).toBe(false);
  });

  it("risk budget scales with current equity, not the initial equity (compounding convention)", () => {
    const grown = computeNormalizedPositionSize(100, 97, 20_000, config);
    expect(grown.accepted).toBe(true);
    if (grown.accepted) expect(grown.riskBudget).toBeCloseTo(200, 10);
  });
});
