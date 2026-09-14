import { describe, expect, it } from "vitest";

import type { OutcomeCandle } from "@/lib/learning/types";
import { researchPlanFor, settleShadowPlan } from "./shadow";
import { DEFAULT_RISK_SETTINGS } from "@/lib/settings/risk-settings";

const CANDLE_TIME = "2026-01-03T18:00:00Z";
const settings = {
  maxEntryDriftPct: DEFAULT_RISK_SETTINGS.maxEntryDriftPct,
  candidateExpiryMinutes: DEFAULT_RISK_SETTINGS.candidateExpiryMinutes,
};

function bar(openTime: number, high: number, low: number, open = (high + low) / 2): OutcomeCandle {
  return { openTime, open, high, low, close: (high + low) / 2, isClosed: true };
}

describe("research plan reconstruction", () => {
  it("derives the allowed entry range from the OWNER'S configured drift", () => {
    // Deliberately not a friendlier rule: a shadow trade must face the same
    // entry discipline a real candidate would, or the comparison is rigged.
    const plan = researchPlanFor(
      { entry_price: 100, stop_price: 98, target_price: 104, candle_time: CANDLE_TIME },
      settings,
    );

    expect(plan).not.toBeNull();
    expect(plan!.allowedEntryMin).toBeCloseTo(100 * (1 - settings.maxEntryDriftPct), 8);
    expect(plan!.allowedEntryMax).toBeCloseTo(100 * (1 + settings.maxEntryDriftPct), 8);
  });

  it("expires a shadow plan on the owner's candidate expiry, not an invented one", () => {
    const plan = researchPlanFor(
      { entry_price: 100, stop_price: 98, target_price: 104, candle_time: CANDLE_TIME },
      settings,
    );
    expect(plan!.expiresAt).toBe(Date.parse(CANDLE_TIME) + settings.candidateExpiryMinutes * 60_000);
  });

  it("refuses a plan that is not a coherent long", () => {
    const bad = [
      { entry_price: 100, stop_price: 101, target_price: 104 }, // stop above entry
      { entry_price: 100, stop_price: 98, target_price: 99 }, // target below entry
      { entry_price: null, stop_price: 98, target_price: 104 },
      { entry_price: 100, stop_price: null, target_price: 104 },
      { entry_price: 0, stop_price: 98, target_price: 104 },
    ];
    for (const row of bad) {
      expect(researchPlanFor({ ...row, candle_time: CANDLE_TIME } as never, settings)).toBeNull();
    }
  });

  it("refuses a plan with an unparseable candle time", () => {
    expect(
      researchPlanFor(
        { entry_price: 100, stop_price: 98, target_price: 104, candle_time: "not-a-date" },
        settings,
      ),
    ).toBeNull();
  });
});

/**
 * Shadow settlement keeps every conservative assumption the real track uses,
 * so the shadow can never look better purely because it was modelled more
 * kindly. These pin exactly those properties.
 */
describe("shadow settlement stays conservative", () => {
  const plan = researchPlanFor(
    { entry_price: 100, stop_price: 98, target_price: 104, candle_time: CANDLE_TIME },
    settings,
  )!;
  const t0 = Date.parse(CANDLE_TIME);

  it("fills a mere range touch at the WORST permitted entry, not the best", () => {
    // The bar dips through the range from above; a generous model would fill
    // at the low. This one fills at the range's upper boundary.
    const candles = [bar(t0, 100.5, 99.0, 100.5)];
    const outcome = settleShadowPlan(plan, candles);

    expect(outcome.entryPrice).toBeCloseTo(plan.allowedEntryMax, 8);
    expect(outcome.entryPrice).toBeGreaterThan(plan.allowedEntryMin);
  });

  it("resolves an ambiguous bar as a STOP and flags it", () => {
    const candles = [bar(t0, 100.1, 100.0, 100.05), bar(t0 + 900_000, 105, 97)];
    const outcome = settleShadowPlan(plan, candles);

    expect(outcome.kind).toBe("STOP");
    expect(outcome.conservativeAmbiguousCandle).toBe(true);
  });

  it("records NO_ENTRY when price never enters the allowed range", () => {
    const candles = [bar(t0, 120, 115), bar(t0 + 900_000, 125, 121)];
    const outcome = settleShadowPlan(plan, candles);

    expect(outcome.kind).toBe("NO_ENTRY");
    expect(outcome.entryPrice).toBeNull();
    expect(outcome.rMultiple).toBeNull();
  });

  it("never enters after the plan expired", () => {
    const afterExpiry = plan.expiresAt + 60 * 60 * 1000;
    const outcome = settleShadowPlan(plan, [bar(afterExpiry, 100.1, 99.9)]);
    expect(outcome.kind).toBe("NO_ENTRY");
  });

  it("follows an entered trade past its expiry until it resolves", () => {
    // Expiry gates ENTRY, not the exit search - otherwise a 10-minute expiry
    // against 15-minute candles would resolve almost everything as expired.
    const candles = [bar(t0, 100.1, 99.9), bar(t0 + 900_000, 105, 104.5)];
    const outcome = settleShadowPlan(plan, candles);
    expect(outcome.kind).toBe("TARGET");
    expect(outcome.exitTime).toBeGreaterThan(plan.expiresAt);
  });

  it("reports an entered but unresolved trade with a null R", () => {
    const candles = [bar(t0, 100.1, 99.9), bar(t0 + 900_000, 101, 99.5)];
    const outcome = settleShadowPlan(plan, candles);
    expect(outcome.kind).toBe("UNRESOLVED");
    expect(outcome.rMultiple).toBeNull();
  });

  it("marks every outcome hypothetical, without exception", () => {
    const scenarios: OutcomeCandle[][] = [
      [bar(t0, 100.1, 99.9), bar(t0 + 900_000, 105, 104.5)], // target
      [bar(t0, 100.1, 99.9), bar(t0 + 900_000, 100, 97)], // stop
      [bar(t0, 120, 115)], // no entry
    ];
    for (const candles of scenarios) {
      expect(settleShadowPlan(plan, candles).isHypothetical).toBe(true);
    }
  });

  it("measures R from the actual hypothetical fill, not the planned entry", () => {
    const candles = [bar(t0, 100.5, 99.0, 100.5), bar(t0 + 900_000, 105, 104.5)];
    const outcome = settleShadowPlan(plan, candles);

    expect(outcome.kind).toBe("TARGET");
    // Filled at the worse boundary, so realized R is below the nominal 2R.
    const nominalR = (plan.targetPrice - plan.entryPrice) / (plan.entryPrice - plan.stopPrice);
    expect(outcome.rMultiple).toBeLessThan(nominalR);
    expect(outcome.rMultiple).toBeGreaterThan(0);
  });

  it("captures excursions for a shadow trade, same as a real one", () => {
    const candles = [bar(t0, 100.1, 99.9), bar(t0 + 900_000, 103, 98.5), bar(t0 + 1_800_000, 105, 104.5)];
    const outcome = settleShadowPlan(plan, candles);
    expect(outcome.excursions).not.toBeNull();
    expect(outcome.excursions!.mfePrice).toBeGreaterThan(0);
  });
});
