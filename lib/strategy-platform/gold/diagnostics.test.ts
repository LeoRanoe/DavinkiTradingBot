import { describe, expect, it } from "vitest";
import { accumulateTransitions, emptyFunnelCounts, mergeFunnelCounts } from "./diagnostics";
import type { JeanfxStateTransition } from "@/lib/strategy/jeanfx-v1/types";

function t(reasonCode: string): JeanfxStateTransition {
  return { state: "READY", direction: "LONG", reasonCode, timestamp: 0, priceLevel: null };
}

describe("accumulateTransitions", () => {
  it("counts each funnel-stage reason code exactly once per transition", () => {
    const transitions = [t("LIQUIDITY_SWEPT"), t("MSS_CONFIRMED"), t("FVG_FORMED"), t("RETRACED_INTO_FVG"), t("CONFIRMATION_CANDLE")];
    const counts = accumulateTransitions(emptyFunnelCounts(), transitions);
    expect(counts).toEqual({
      liquiditySweeps: 1,
      mssBos: 1,
      fvgs: 1,
      retraces: 1,
      confirmations: 1,
      readySetups: 0,
      rrRejected: 0,
      riskRejected: 0,
      executed: 0,
    });
  });

  it("ignores non-funnel reason codes (timeouts, invalidations, bias transitions)", () => {
    const counts = accumulateTransitions(emptyFunnelCounts(), [t("MSS_TIMEOUT"), t("FVG_TIMEOUT"), t("NO_HTF_BIAS"), t("HTF_BIAS_CONFIRMED"), t("OUTSIDE_SESSION"), t("NO_VALID_TARGET_RR")]);
    expect(counts).toEqual(emptyFunnelCounts());
  });

  it("accumulates across repeated calls (one call per direction per evaluation)", () => {
    let counts = emptyFunnelCounts();
    counts = accumulateTransitions(counts, [t("LIQUIDITY_SWEPT")]);
    counts = accumulateTransitions(counts, [t("LIQUIDITY_SWEPT"), t("MSS_CONFIRMED")]);
    expect(counts.liquiditySweeps).toBe(2);
    expect(counts.mssBos).toBe(1);
  });
});

describe("mergeFunnelCounts", () => {
  it("adds outcome-side counters (readySetups/rrRejected/riskRejected/executed) on top of transition counts", () => {
    const base = accumulateTransitions(emptyFunnelCounts(), [t("LIQUIDITY_SWEPT")]);
    const merged = mergeFunnelCounts(base, { readySetups: 1, executed: 1 });
    expect(merged.liquiditySweeps).toBe(1);
    expect(merged.readySetups).toBe(1);
    expect(merged.executed).toBe(1);
    expect(merged.rrRejected).toBe(0);
  });
});
