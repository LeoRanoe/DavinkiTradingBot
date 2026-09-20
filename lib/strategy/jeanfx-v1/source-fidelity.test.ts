import { describe, expect, it } from "vitest";
import {
  JEANFX_DEFAULT_USER_CONFIG,
  JEANFX_GOLD_PROFILES,
  JEANFX_IMPLEMENTATION_ASSUMPTIONS,
  JEANFX_MAX_TRADES_PER_SESSION,
  JEANFX_RISK_PCT_MAX,
  JEANFX_RISK_PCT_MIN,
  JEANFX_RR_MINIMUM,
  JEANFX_V1_PARAMS,
  resolveBiasTimeframe,
  validateJeanfxUserConfig,
} from "./config";
import { determineLiquidityBias } from "./primitives/bias";
import { checkSessionTradeLimit, describeSessionLimitRejection, sessionInstanceKey } from "./session-limits";
import { jeanfxV1BuiltInStrategy } from "@/lib/strategy-platform/built-in/jeanfx-v1";
import { resolveTimeframesFor } from "@/lib/strategy-platform/evaluation-plan";
import type { LiquidityPool } from "./types";
import { candle } from "./primitives/__fixtures__/candle";

/**
 * Source-fidelity suite: every assertion here traces to a statement in
 * JeanFX_Final_Complete. Each test names the source line it enforces, so a
 * future change that quietly drifts from the document fails loudly.
 */

const pool = (side: "BUY_SIDE" | "SELL_SIDE", level: number): LiquidityPool => ({
  side,
  level,
  sourceCandleTimes: [0],
  kind: "PRIOR_SWING",
  swept: false,
});

const biasCandle = (close: number) => [candle({ openTime: 0, open: close, close, high: close + 1, low: close - 1 })];

describe("SOURCE: risk per trade is 0.5%-1%", () => {
  it("accepts the source's bounds and the 1% default", () => {
    expect(JEANFX_RISK_PCT_MIN).toBe(0.005);
    expect(JEANFX_RISK_PCT_MAX).toBe(0.01);
    for (const riskPct of [0.005, 0.0075, 0.01]) {
      expect(validateJeanfxUserConfig({ riskPct }).ok).toBe(true);
    }
  });

  it("REJECTS 5% - the previous bound let a user risk 5x the source maximum", () => {
    const result = validateJeanfxUserConfig({ riskPct: 0.05 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/riskPct/);
  });

  it("rejects anything below 0.5% or non-finite, server-side", () => {
    for (const riskPct of [0.004, 0, -0.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(validateJeanfxUserConfig({ riskPct }).ok).toBe(false);
    }
  });
});

describe("SOURCE: 'Risk Reward - Minimum 1:3'", () => {
  it("pins the minimum at 3.0", () => {
    expect(JEANFX_RR_MINIMUM).toBe(3);
    expect(JEANFX_V1_PARAMS.rrMinimum).toBe(3);
  });
});

describe("SOURCE: 'Max trades per session - 3', enforced not merely configured", () => {
  const LONDON_1000 = Date.UTC(2026, 0, 12, 10, 0); // 10:00 UTC = London session, winter
  const limit = JEANFX_MAX_TRADES_PER_SESSION;

  it("allows trades up to the limit and blocks the next one", () => {
    const trades = [{ openedAt: LONDON_1000 }, { openedAt: LONDON_1000 + 60_000 }];
    expect(checkSessionTradeLimit(LONDON_1000 + 120_000, trades, ["LONDON"], limit).allowed).toBe(true);

    const atLimit = [...trades, { openedAt: LONDON_1000 + 120_000 }];
    const decision = checkSessionTradeLimit(LONDON_1000 + 180_000, atLimit, ["LONDON"], limit);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reasonCode).toBe("SESSION_TRADE_LIMIT_REACHED");
      expect(describeSessionLimitRejection(decision)).toBe("Maximum 3 trades reached for the London session.");
    }
  });

  it("is derived from durable trade records, so repeated scanner runs cannot reset the count", () => {
    const atLimit = [0, 1, 2].map((i) => ({ openedAt: LONDON_1000 + i * 60_000 }));
    // Five successive "scanner runs" at five different instants: every one
    // must still see the limit as reached.
    for (let run = 1; run <= 5; run++) {
      const decision = checkSessionTradeLimit(LONDON_1000 + 300_000 * run, atLimit, ["LONDON"], limit);
      expect(decision.allowed).toBe(false);
    }
  });

  it("counts London and New York separately", () => {
    const londonFull = [0, 1, 2].map((i) => ({ openedAt: LONDON_1000 + i * 60_000 }));
    // 19:00 UTC = 14:00 New York, outside London's 08-17 local window.
    const nyInstant = Date.UTC(2026, 0, 12, 19, 0);
    const decision = checkSessionTradeLimit(nyInstant, londonFull, ["LONDON", "NEW_YORK"], limit);
    expect(decision.allowed).toBe(true);
  });

  it("rejects instants outside the sessions the configuration trades", () => {
    const asia = Date.UTC(2026, 0, 12, 1, 0); // 01:00 UTC - neither London nor New York
    const decision = checkSessionTradeLimit(asia, [], ["LONDON", "NEW_YORK"], limit);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reasonCode).toBe("OUTSIDE_TRADED_SESSION");
  });

  it("keys session instances per local calendar day, DST-aware", () => {
    // 1 Jan (GMT) and 1 Jul (BST) both resolve via the IANA zone, so no
    // manual clock shifting is ever needed.
    expect(sessionInstanceKey("LONDON", Date.UTC(2026, 0, 12, 10, 0))).toBe("LONDON:2026-01-12");
    expect(sessionInstanceKey("LONDON", Date.UTC(2026, 6, 12, 10, 0))).toBe("LONDON:2026-07-12");
    // 23:30 UTC in July is already the next local day in London (00:30 BST).
    expect(sessionInstanceKey("LONDON", Date.UTC(2026, 6, 12, 23, 30))).toBe("LONDON:2026-07-13");
  });
});

describe("SOURCE: bias is read from liquidity, never from a moving average", () => {
  it("liquidity BELOW price (sell-side draw) => BULLISH", () => {
    const result = determineLiquidityBias(biasCandle(100), [pool("SELL_SIDE", 95), pool("BUY_SIDE", 130)], 0);
    expect(result.bias).toBe("BULLISH");
    expect(result.draw?.level).toBe(95);
  });

  it("liquidity ABOVE price (buy-side draw) => BEARISH", () => {
    const result = determineLiquidityBias(biasCandle(100), [pool("SELL_SIDE", 70), pool("BUY_SIDE", 105)], 0);
    expect(result.bias).toBe("BEARISH");
    expect(result.draw?.level).toBe(105);
  });

  it("ignores pools behind price - only liquidity still in front can be sought", () => {
    // A buy-side pool BELOW price has already been passed; it is not a draw.
    const result = determineLiquidityBias(biasCandle(100), [pool("BUY_SIDE", 80)], 0);
    expect(result.bias).toBe("NONE");
    expect(result.reasonCode).toBe("NO_LIQUIDITY_MAPPED");
  });

  it("refuses to guess when both draws are equidistant", () => {
    const result = determineLiquidityBias(biasCandle(100), [pool("SELL_SIDE", 90), pool("BUY_SIDE", 110)], 1);
    expect(result.bias).toBe("NONE");
    expect(result.reasonCode).toBe("AMBIGUOUS_DRAW");
  });

  it("never treats an already-swept pool as a draw", () => {
    const swept = { ...pool("SELL_SIDE", 95), swept: true };
    expect(determineLiquidityBias(biasCandle(100), [swept], 0).bias).toBe("NONE");
  });
});

describe("SOURCE: 'H1 or M30 identifies market bias. M15 confirms structure. M5 provides entries.'", () => {
  it("the ACTIVE profile is M30 and the SELECTIVE profile is H1", () => {
    expect(JEANFX_GOLD_PROFILES.JEANFX_GOLD_ACTIVE.biasTimeframe).toBe("M30");
    expect(JEANFX_GOLD_PROFILES.JEANFX_GOLD_SELECTIVE.biasTimeframe).toBe("H1");
  });

  it("selecting the M30 profile ACTUALLY causes M30 candles to be requested", () => {
    const timeframes = resolveTimeframesFor(jeanfxV1BuiltInStrategy, { profile: "JEANFX_GOLD_ACTIVE" });
    expect(timeframes).toContain("M30");
    expect(timeframes).not.toContain("H1");
    expect(timeframes).toEqual(expect.arrayContaining(["M15", "M5"]));
  });

  it("selecting the H1 profile ACTUALLY causes H1 candles to be requested", () => {
    const timeframes = resolveTimeframesFor(jeanfxV1BuiltInStrategy, { profile: "JEANFX_GOLD_SELECTIVE" });
    expect(timeframes).toContain("H1");
    expect(timeframes).not.toContain("M30");
  });

  it("structure is always M15 and entry is always M5, for both profiles", () => {
    expect(JEANFX_V1_PARAMS.structureTimeframe).toBe("M15");
    expect(JEANFX_V1_PARAMS.entryTimeframe).toBe("M5");
    for (const profile of ["JEANFX_GOLD_ACTIVE", "JEANFX_GOLD_SELECTIVE"] as const) {
      expect(resolveTimeframesFor(jeanfxV1BuiltInStrategy, { profile })).toEqual(
        expect.arrayContaining(["M15", "M5"]),
      );
    }
  });

  it("an explicit biasTimeframe override still drives the fetch", () => {
    expect(resolveBiasTimeframe({ biasTimeframe: "M30" })).toBe("M30");
    expect(resolveBiasTimeframe({ biasTimeframe: "H1" })).toBe("H1");
  });
});

describe("SOURCE: 'London sweeps liquidity, New York expands' - Gold does not trade every session", () => {
  it("defaults Gold to LONDON_AND_NEW_YORK, not ALL", () => {
    expect(JEANFX_DEFAULT_USER_CONFIG.sessionFilter).toBe("LONDON_AND_NEW_YORK");
  });
});

describe("implementation assumptions are declared, never passed off as JeanFX rules", () => {
  it("tags every documented parameter with its origin", () => {
    for (const assumption of JEANFX_IMPLEMENTATION_ASSUMPTIONS) {
      expect(["SOURCE", "IMPLEMENTATION_ASSUMPTION", "SOURCE_AMBIGUITY"]).toContain(assumption.origin);
      expect(assumption.note.length).toBeGreaterThan(10);
    }
  });

  it("declares the numeric choices the source does not specify", () => {
    const keys = JEANFX_IMPLEMENTATION_ASSUMPTIONS.filter((a) => a.origin !== "SOURCE").map((a) => a.key);
    for (const expected of [
      "swing.leftBars / rightBars",
      "equalHighLowAtrMultiple",
      "displacementAtrMultiple",
      "stopBufferAtrMultiple",
      "confirmation.minWickBodyRatio",
      "mssTimeoutBars / fvgTimeoutBars",
      "partialExit",
      "sessionClockWindows",
    ]) {
      expect(keys).toContain(expected);
    }
  });

  it("records the partial-profit trigger as a SOURCE AMBIGUITY, not a JeanFX rule", () => {
    const partial = JEANFX_IMPLEMENTATION_ASSUMPTIONS.find((a) => a.key === "partialExit");
    expect(partial?.origin).toBe("SOURCE_AMBIGUITY");
    expect(partial?.note).toMatch(/NOT a JeanFX rule/i);
    // And it is actually implemented, rather than left as partialExitPlan: null.
    expect(JEANFX_V1_PARAMS.partialExit.sizePct).toBeGreaterThan(0);
    expect(JEANFX_V1_PARAMS.partialExit.moveStopToBreakEven).toBe(true);
  });

  it("does not claim EMA50/EMA200 as a JeanFX bias rule", () => {
    const biasEntry = JEANFX_IMPLEMENTATION_ASSUMPTIONS.find((a) => a.key === "htfBiasMethod");
    expect(biasEntry?.origin).toBe("SOURCE");
    expect(biasEntry?.note).toMatch(/EMA50\/EMA200 is NOT used/);
  });
});
