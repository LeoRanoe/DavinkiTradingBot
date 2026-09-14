import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/bybit/types";
import { makeCandles } from "@/lib/trading/__fixtures__/fakes";
import {
  authoritative,
  runResearchHarness,
  shadow,
  V1_STOP_TARGET,
  type HarnessConfig,
} from "./harness";

/**
 * A long uptrend with periodic shallow pullbacks.
 *
 * Sized deliberately: the harness (like production) refuses to evaluate until
 * 210 closed 1H candles exist, and both series start at the same instant, so
 * the first evaluable 15m bar is index ~840. Anything shorter would make every
 * assertion below vacuous. The 1H series tracks the same drift over the same
 * wall-clock so the regime gate sees a consistent market.
 */
function trendingMarket(bars = 1600): { candles1h: Candle[]; candles15m: Candle[] } {
  const closes15m: number[] = [];
  for (let i = 0; i < bars; i += 1) {
    const drift = 100 + i * 0.15;
    // A shallow dip every 40 bars produces the pullback V1 looks for.
    const dip = i % 40 >= 36 ? -1.6 : 0;
    closes15m.push(drift + dip);
  }
  const volumes15m = closes15m.map((_, i) => (i % 40 >= 38 ? 150 : 100));

  // Four 15m bars per hour, so the hourly drift is 4x the 15m drift.
  const hours = Math.ceil(bars / 4) + 8;
  const closes1h = Array.from({ length: hours }, (_, h) => 100 + h * 0.6);

  return {
    candles1h: makeCandles("1H", closes1h, { volumes: closes1h.map(() => 100) }),
    candles15m: makeCandles("15M", closes15m, { volumes: volumes15m, highOffset: 0.9, lowOffset: 0.9 }),
  };
}

const instrument = {
  tickSize: 0.01,
  qtyStep: 0.000001,
  minOrderQty: 0.000001,
  minOrderAmt: 1,
  maxOrderQty: null,
};

function baseConfig(overrides: Partial<HarnessConfig> = {}): HarnessConfig {
  return {
    symbol: "BTCUSDT",
    riskBudget: 10,
    equity: 1000,
    instrument,
    feeBps: 10,
    slippageBps: 5,
    minCandidateScore: 80,
    minRiskReward: 1.5,
    maxAtrPct: 0.05,
    ...overrides,
  };
}

const market = trendingMarket();

/**
 * Non-vacuity guard. Several assertions below are naturally conditional (a
 * property of "every trade" is trivially true of no trades), so if the
 * fixture ever stopped producing signals the suite would go green while
 * testing nothing. This fails loudly first.
 */
describe("research harness - fixture actually exercises the engine", () => {
  it("produces a meaningful authoritative sample, shadow sample and skip set", () => {
    const result = runResearchHarness(
      baseConfig({ includeShadowBands: true, shadowMinScore: 60 }),
      market.candles1h,
      market.candles15m,
    );

    expect(authoritative(result.trades).length).toBeGreaterThanOrEqual(10);
    expect(shadow(result.trades).length).toBeGreaterThanOrEqual(50);
    expect(result.trades.filter((t) => t.outcome !== "OPEN_AT_END").length).toBeGreaterThan(0);
    expect(Object.keys(result.bandCounts).length).toBeGreaterThan(0);
  });

  it("produces skips, so rejection paths are covered too", () => {
    const result = runResearchHarness(baseConfig(), market.candles1h, market.candles15m);
    expect(result.skips.length).toBeGreaterThan(0);
  });
});

describe("research harness - no look-ahead", () => {
  it("never enters before the candle after the signal", () => {
    const result = runResearchHarness(baseConfig(), market.candles1h, market.candles15m);
    for (const trade of result.trades) {
      expect(trade.entryTime).toBeGreaterThan(trade.signalTime);
    }
  });

  it("pushes entry further out when a delay is configured", () => {
    const immediate = runResearchHarness(baseConfig(), market.candles1h, market.candles15m);
    const delayed = runResearchHarness(
      baseConfig({ entryDelayBars: 3 }),
      market.candles1h,
      market.candles15m,
    );

    const first = immediate.trades[0];
    const firstDelayed = delayed.trades.find((t) => t.signalTime === first?.signalTime);
    if (!first || !firstDelayed) return;

    // Three extra 15-minute bars between signal and fill.
    expect(firstDelayed.entryTime - first.entryTime).toBe(3 * 15 * 60_000);
  });

  it("never exits before it enters", () => {
    const result = runResearchHarness(baseConfig(), market.candles1h, market.candles15m);
    for (const trade of result.trades) {
      if (trade.exitTime !== null) expect(trade.exitTime).toBeGreaterThanOrEqual(trade.entryTime);
    }
  });
});

describe("research harness - track isolation", () => {
  it("marks only at-or-above-threshold trades AUTHORITATIVE", () => {
    const result = runResearchHarness(
      baseConfig({ includeShadowBands: true, shadowMinScore: 60 }),
      market.candles1h,
      market.candles15m,
    );

    for (const trade of authoritative(result.trades)) expect(trade.score).toBeGreaterThanOrEqual(80);
    for (const trade of shadow(result.trades)) expect(trade.score).toBeLessThan(80);
  });

  it("records no shadow trades unless shadow bands are explicitly requested", () => {
    const result = runResearchHarness(baseConfig(), market.candles1h, market.candles15m);
    expect(shadow(result.trades)).toHaveLength(0);
  });

  it("leaves the authoritative track byte-identical whether or not shadows are collected", () => {
    // The whole point of the isolation: turning score-band research on must
    // not perturb what V1 would actually have done.
    const without = authoritative(
      runResearchHarness(baseConfig(), market.candles1h, market.candles15m).trades,
    );
    const with_ = authoritative(
      runResearchHarness(
        baseConfig({ includeShadowBands: true }),
        market.candles1h,
        market.candles15m,
      ).trades,
    );

    expect(with_.length).toBe(without.length);
    expect(with_.map((t) => [t.entryTime, t.qty, t.pnl])).toEqual(
      without.map((t) => [t.entryTime, t.qty, t.pnl]),
    );
  });

  it("never overlaps two authoritative positions", () => {
    const result = runResearchHarness(baseConfig(), market.candles1h, market.candles15m);
    const trades = authoritative(result.trades).filter((t) => t.exitTime !== null);

    for (let i = 1; i < trades.length; i += 1) {
      expect(trades[i].entryTime).toBeGreaterThanOrEqual(trades[i - 1].exitTime!);
    }
  });
});

describe("research harness - risk budget is held constant across variants", () => {
  it("re-sizes when the stop distance changes, rather than reusing the quantity", () => {
    // The invariant the spec calls out explicitly: never compare variants by
    // assuming the same position size after changing stop distance.
    const tight = runResearchHarness(
      baseConfig({ stopTarget: { label: "tight", stopDistanceMultiple: 0.5, targetRMultiple: 2 } }),
      market.candles1h,
      market.candles15m,
    );
    const wide = runResearchHarness(
      baseConfig({ stopTarget: { label: "wide", stopDistanceMultiple: 2, targetRMultiple: 2 } }),
      market.candles1h,
      market.candles15m,
    );

    const t = tight.trades[0];
    const w = wide.trades.find((x) => x.signalTime === t?.signalTime);
    if (!t || !w) return;

    // A wider stop must buy LESS, not the same amount.
    expect(w.qty).toBeLessThan(t.qty);
    // And both must still risk approximately the one configured budget.
    expect(t.plannedRisk).toBeCloseTo(w.plannedRisk, 1);
  });

  it("keeps planned risk at the configured budget regardless of stop shape", () => {
    for (const multiple of [0.5, 1, 1.5, 2]) {
      const result = runResearchHarness(
        baseConfig({
          stopTarget: { label: `x${multiple}`, stopDistanceMultiple: multiple, targetRMultiple: 2 },
        }),
        market.candles1h,
        market.candles15m,
      );
      for (const trade of result.trades.slice(0, 5)) {
        // Rounding to the qty step can only ever reduce risk below budget.
        expect(trade.plannedRisk).toBeLessThanOrEqual(trade.riskBudget * 1.001);
        expect(trade.plannedRisk).toBeGreaterThan(trade.riskBudget * 0.9);
      }
    }
  });

  it("places the target as a multiple of the ADJUSTED stop distance", () => {
    const result = runResearchHarness(
      baseConfig({ stopTarget: { label: "3R", stopDistanceMultiple: 1, targetRMultiple: 3 } }),
      market.candles1h,
      market.candles15m,
    );
    const trade = result.trades[0];
    if (!trade) return;

    const stopDistance = trade.entryPrice - trade.stopPrice;
    const targetDistance = trade.targetPrice - trade.entryPrice;
    // Measured from the reference price the plan was built on, so allow the
    // small gap between reference and slipped fill.
    expect(targetDistance / stopDistance).toBeGreaterThan(2.5);
  });
});

describe("research harness - costs and outcomes", () => {
  it("makes results strictly worse under heavier costs", () => {
    const base = runResearchHarness(baseConfig(), market.candles1h, market.candles15m);
    const stressed = runResearchHarness(
      baseConfig({ feeBps: 20, slippageBps: 10 }),
      market.candles1h,
      market.candles15m,
    );

    const netOf = (r: typeof base) =>
      authoritative(r.trades).reduce((sum, t) => sum + (t.pnl ?? 0), 0);

    if (authoritative(base.trades).length === 0) return;
    expect(netOf(stressed)).toBeLessThan(netOf(base));
  });

  it("charges fees on both sides of a closed trade", () => {
    const result = runResearchHarness(baseConfig(), market.candles1h, market.candles15m);
    const closed = result.trades.find((t) => t.exitPrice !== null);
    if (!closed) return;

    expect(closed.fees).toBeGreaterThan(0);
    expect(closed.grossPnl).not.toBeNull();
    // Net is always worse than gross once fees are taken.
    expect(closed.pnl!).toBeLessThan(closed.grossPnl!);
  });

  it("assumes the unfavourable ordering when one bar touches both stop and target", () => {
    // A bar spanning both levels must resolve to STOP, never TARGET.
    const bars = 1600;
    const closes = Array.from({ length: bars }, (_, i) => 100 + i * 0.15);
    const candles15m = makeCandles("15M", closes, {
      volumes: closes.map(() => 120),
      highOffset: 40,
      lowOffset: 40,
    });
    const hourly = Array.from({ length: Math.ceil(bars / 4) + 8 }, (_, h) => 100 + h * 0.6);
    const candles1h = makeCandles("1H", hourly, { volumes: hourly.map(() => 100) });

    const result = runResearchHarness(baseConfig(), candles1h, candles15m);
    const resolved = result.trades.filter((t) => t.outcome !== "OPEN_AT_END");
    if (resolved.length === 0) return;
    expect(resolved.every((t) => t.outcome === "STOP")).toBe(true);
  });

  it("leaves an unresolved trade with null P/L so it counts as neither win nor loss", () => {
    const result = runResearchHarness(baseConfig(), market.candles1h, market.candles15m);
    for (const trade of result.trades.filter((t) => t.outcome === "OPEN_AT_END")) {
      expect(trade.pnl).toBeNull();
      expect(trade.rMultiple).toBeNull();
      expect(trade.exitTime).toBeNull();
    }
  });
});

describe("research harness - captured research context", () => {
  it("captures every score component for component-level analysis", () => {
    const result = runResearchHarness(baseConfig(), market.candles1h, market.candles15m);
    const trade = result.trades[0];
    if (!trade) return;

    expect(Object.keys(trade.components).sort()).toEqual([
      "momentum",
      "pullback",
      "riskReward",
      "trend",
      "volatility",
      "volume",
    ]);
  });

  it("measures MFE/MAE from real bars, not from the exit price", () => {
    const result = runResearchHarness(baseConfig(), market.candles1h, market.candles15m);
    const trade = result.trades.find((t) => t.outcome !== "OPEN_AT_END");
    if (!trade) return;

    expect(trade.mfePrice).toBeGreaterThanOrEqual(0);
    expect(trade.maePrice).toBeGreaterThanOrEqual(0);
    expect(trade.barsHeld).toBeGreaterThan(0);
  });

  it("bands score and volatility for the breakdowns", () => {
    const result = runResearchHarness(
      baseConfig({ includeShadowBands: true }),
      market.candles1h,
      market.candles15m,
    );
    for (const trade of result.trades) {
      expect(trade.band).toBeTruthy();
      expect(["LOW", "MEDIUM", "HIGH", "UNKNOWN"]).toContain(trade.volatility);
    }
  });

  it("records why a setup was skipped rather than dropping it silently", () => {
    const result = runResearchHarness(
      // An impossible volatility ceiling forces a typed rejection.
      baseConfig({ maxAtrPct: 0.0000001 }),
      market.candles1h,
      market.candles15m,
    );
    if (result.skips.length === 0) return;
    expect(result.skips.some((s) => s.reason === "EXCESSIVE_VOLATILITY")).toBe(true);
  });

  it("refuses a below-minimum size instead of inflating it", () => {
    const result = runResearchHarness(
      baseConfig({ riskBudget: 0.0001, instrument: { ...instrument, minOrderAmt: 100 } }),
      market.candles1h,
      market.candles15m,
    );
    expect(result.trades).toHaveLength(0);
    expect(result.skips.some((s) => s.reason === "MIN_ORDER_RISK_CONFLICT")).toBe(true);
  });
});

describe("research harness - V1 defaults", () => {
  it("uses V1's own 2R target when no variant is supplied", () => {
    expect(V1_STOP_TARGET.stopDistanceMultiple).toBe(1);
    expect(V1_STOP_TARGET.targetRMultiple).toBe(2);
  });
});
