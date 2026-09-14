import { describe, expect, it } from "vitest";
import { STRATEGY_V1_PARAMS } from "@/lib/strategy/v1/config";

/**
 * Checkpoint 2 regression guard (CLAUDE.md non-negotiable invariants,
 * Checkpoint 2 "non-negotiable safety"): the frozen V1 production universe
 * and parameters must be untouched by anything added in lib/domain/ or the
 * proposed (unapplied) migration.
 */
describe("Strategy V1 production config is unchanged by the Checkpoint 2 universe work", () => {
  it("still hard-codes exactly BTCUSDT, ETHUSDT as its production symbols", () => {
    expect(STRATEGY_V1_PARAMS.symbols).toEqual(["BTCUSDT", "ETHUSDT"]);
  });

  it("still targets the frozen 1H/15M timeframe pair", () => {
    expect(STRATEGY_V1_PARAMS.regimeTimeframe).toBe("1H");
    expect(STRATEGY_V1_PARAMS.entryTimeframe).toBe("15M");
  });

  it("still sums score weights to 100 (unchanged scoring model)", () => {
    const total = Object.values(STRATEGY_V1_PARAMS.weights).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });
});
