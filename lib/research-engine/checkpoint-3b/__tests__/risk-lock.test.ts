import { describe, expect, it } from "vitest";
import { LOCKED_RISK } from "../risk-lock";
import { computeNormalizedPositionSize } from "../../position-sizing";

describe("Checkpoint 3B.0 locked risk assumption (§8)", () => {
  it("is exactly initialEquity=10000, riskPct=0.01 for every configuration", () => {
    expect(LOCKED_RISK).toEqual({ initialEquity: 10_000, riskPct: 0.01 });
  });

  it("the no-leverage capital cap (3A.1 §1) remains active under this risk lock", () => {
    // Narrow stop -> would be 2x leverage uncapped; must be capped to 1x equity.
    const result = computeNormalizedPositionSize(100, 99.5, LOCKED_RISK.initialEquity, LOCKED_RISK);
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.capitalCapped).toBe(true);
    expect(result.qty * 100).toBeLessThanOrEqual(LOCKED_RISK.initialEquity + 1e-9);
  });
});
