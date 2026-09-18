import { JEANFX_V1_PARAMS, JEANFX_V1_STATUS, JEANFX_V1_VERSION_LABEL, validateJeanfxUserConfig } from "@/lib/strategy/jeanfx-v1/config";
import { runJeanfxDirection } from "@/lib/strategy/jeanfx-v1/state-machine";
import type { StrategyContext, StrategyContract, StrategyDecision, StrategyMetadata } from "../types";

/**
 * Registry entry for JeanFX v1 - the featured built-in strategy.
 *
 * Wires the generic StrategyContract to lib/strategy/jeanfx-v1's state
 * machine and primitives. This file contains NO detection logic of its
 * own - it only adapts StrategyContext into the three closed-candle
 * timeframes the state machine needs and turns a JeanfxSetup into a
 * StrategyDecision. Every rule lives in lib/strategy/jeanfx-v1/ so it can
 * be unit tested independently of this platform wiring, and so the DSL
 * (lib/strategy-platform/dsl/) can reuse the exact same primitives.
 */
const JEANFX_V1_METADATA: StrategyMetadata = {
  slug: JEANFX_V1_VERSION_LABEL,
  displayName: "JeanFX Liquidity System",
  description:
    "Liquidity sweep -> MSS/BOS -> FVG -> retracement -> confirmation -> entry, targeting the next liquidity pool. See docs/strategies/jeanfx-v1-spec.md.",
  type: "BUILT_IN",
  status: JEANFX_V1_STATUS,
  requiredTimeframes: [JEANFX_V1_PARAMS.biasTimeframe, JEANFX_V1_PARAMS.structureTimeframe, JEANFX_V1_PARAMS.entryTimeframe],
  supportedAssetClasses: ["CRYPTO", "FOREX", "METAL"],
  supportedSides: ["LONG", "SHORT"],
  // IMPLEMENTATION ASSUMPTION: rough minimums to seat swing/ATR/EMA200 detection; not tuned.
  minimumHistoryRequirements: { H1: 210, M30: 210, M15: 50, M5: 50 },
  requiredFeatures: ["ATR14", "SWING_STRUCTURE", "LIQUIDITY_POOLS", "FVG"],
};

function evaluate(ctx: StrategyContext): StrategyDecision {
  const configResult = validateJeanfxUserConfig((ctx.strategyParameters as object) ?? {});
  const userConfig = configResult.ok
    ? configResult.value
    : { confirmationPatterns: "BOTH" as const, sessionFilter: "ALL" as const, biasTimeframe: JEANFX_V1_PARAMS.biasTimeframe, riskPct: JEANFX_V1_PARAMS.riskPct };

  // biasTimeframe is user-configurable (H1 | M30, spec S6); structure/entry timeframes are fixed.
  const biasCandles = (ctx.candlesByTimeframe[userConfig.biasTimeframe] ?? []).filter((c) => c.isClosed);
  const structureCandles = (ctx.candlesByTimeframe[JEANFX_V1_PARAMS.structureTimeframe] ?? []).filter((c) => c.isClosed);
  const entryCandles = (ctx.candlesByTimeframe[JEANFX_V1_PARAMS.entryTimeframe] ?? []).filter((c) => c.isClosed);

  if (biasCandles.length === 0 || structureCandles.length === 0 || entryCandles.length === 0) {
    return { type: "NO_ACTION", reason: "MISSING_MARKET_DATA" };
  }

  for (const direction of ["LONG", "SHORT"] as const) {
    const result = runJeanfxDirection(biasCandles, structureCandles, entryCandles, direction, JEANFX_V1_PARAMS, userConfig);
    if (result.state === "READY" && result.setup) {
      const setup = result.setup;
      return {
        type: direction === "LONG" ? "ENTER_LONG" : "ENTER_SHORT",
        entry: { price: setup.entry, kind: "FVG_FIRST_TOUCH" },
        stop: { price: setup.stop, kind: "BEYOND_SWEEP_EXTREME" },
        target: { price: setup.target.level, kind: "NEXT_LIQUIDITY_POOL", rMultiple: setup.rMultiple },
        partialExitPlan: null, // spec S14: excluded from jeanfx-v1 (Option A), unresolved source ambiguity
        reasonCodes: result.transitions.map((t) => t.reasonCode),
        featureSnapshot: {
          sweepPool: setup.sweep.pool,
          structureEvent: setup.structureEvent,
          fvg: setup.fvg,
          confirmation: setup.confirmation,
          transitions: result.transitions,
        },
        confidence: null, // JeanFX defines no mathematical confidence score - see spec, unlike V1's 100-point score
      };
    }
  }

  return { type: "NO_ACTION", reason: "NO_SETUP_READY" };
}

export const jeanfxV1BuiltInStrategy: StrategyContract = { metadata: JEANFX_V1_METADATA, evaluate };
