import {
  JEANFX_GOLD_PROFILES,
  JEANFX_V1_PARAMS,
  JEANFX_V1_STATUS,
  JEANFX_V1_VERSION_LABEL,
  resolveBiasTimeframe,
  validateJeanfxUserConfig,
} from "@/lib/strategy/jeanfx-v1/config";
import { runJeanfxDirection, type JeanfxWalkResult } from "@/lib/strategy/jeanfx-v1/state-machine";
import type { Direction, StrategyContext, StrategyContract, StrategyDecision, StrategyMetadata, Timeframe } from "../types";

/**
 * Registry entry for JeanFX v1 - the featured built-in strategy.
 *
 * Wires the generic StrategyContract to lib/strategy/jeanfx-v1's state
 * machine and primitives. This file contains NO detection logic of its
 * own - it only adapts StrategyContext into the three closed-candle
 * timeframes the state machine needs and turns a JeanfxSetup into a
 * StrategyDecision.
 */
const JEANFX_V1_METADATA: StrategyMetadata = {
  slug: JEANFX_V1_VERSION_LABEL,
  displayName: "JeanFX Gold",
  description:
    "Liquidity -> sweep -> MSS/BOS -> FVG -> retracement into FVG -> candle confirmation -> entry, targeting the next liquidity pool. Primary instrument XAU/USD.",
  type: "BUILT_IN",
  status: JEANFX_V1_STATUS,
  // Superset across both profiles; resolveRequiredTimeframes narrows this to
  // the timeframes a given configuration actually needs.
  requiredTimeframes: ["H1", "M30", JEANFX_V1_PARAMS.structureTimeframe, JEANFX_V1_PARAMS.entryTimeframe],
  supportedAssetClasses: ["METAL", "FOREX", "CRYPTO"],
  supportedSides: ["LONG", "SHORT"],
  // IMPLEMENTATION ASSUMPTION: enough history to seat swing/ATR/session
  // liquidity mapping. No EMA200 seeding is needed any more - JeanFX bias is
  // a liquidity read, not a moving-average read.
  minimumHistoryRequirements: { H1: 120, M30: 120, M15: 120, M5: 120 },
  requiredFeatures: ["ATR14", "SWING_STRUCTURE", "LIQUIDITY_POOLS", "FVG", "SESSION_WINDOWS"],
};

/**
 * The timeframes this configuration ACTUALLY needs.
 *
 * Without this, metadata's static list decided the fetch and selecting the
 * M30 (Active) profile would silently be evaluated on H1 candles.
 */
function resolveRequiredTimeframes(parameters: Record<string, unknown>): Timeframe[] {
  return [resolveBiasTimeframe(parameters), JEANFX_V1_PARAMS.structureTimeframe, JEANFX_V1_PARAMS.entryTimeframe];
}

function toDecision(direction: Direction, result: JeanfxWalkResult): StrategyDecision {
  const setup = result.setup!;
  return {
    type: direction === "LONG" ? "ENTER_LONG" : "ENTER_SHORT",
    entry: { price: setup.entry, kind: "FVG_FIRST_TOUCH" },
    stop: { price: setup.stop, kind: "BEYOND_SWEEP_EXTREME" },
    target: { price: setup.target.level, kind: "NEXT_LIQUIDITY_POOL", rMultiple: setup.rMultiple },
    // SOURCE AMBIGUITY: the source says "Break-even after partial profit" but
    // specifies neither fraction nor trigger. These are versioned
    // implementation assumptions (config.ts JEANFX_IMPLEMENTATION_ASSUMPTIONS),
    // NOT JeanFX rules, and are surfaced as such in the frontend.
    partialExitPlan: { sizePct: JEANFX_V1_PARAMS.partialExit.sizePct, atRMultiple: JEANFX_V1_PARAMS.partialExit.atRMultiple },
    reasonCodes: result.transitions.map((t) => t.reasonCode),
    featureSnapshot: {
      biasTimeframe: setup.biasTimeframe ?? null,
      liquidityPool: setup.sweep.pool,
      sweep: setup.sweep,
      structureEvent: setup.structureEvent,
      fvg: setup.fvg,
      confirmation: setup.confirmation,
      target: setup.target,
      rMultiple: setup.rMultiple,
      transitions: result.transitions,
    },
    confidence: null, // JeanFX defines no mathematical confidence score.
  };
}

function evaluate(ctx: StrategyContext): StrategyDecision {
  const configResult = validateJeanfxUserConfig((ctx.strategyParameters as object) ?? {});
  if (!configResult.ok) {
    // Fail closed: an invalid configuration must never fall back to defaults
    // and trade as though it were valid.
    return { type: "NO_ACTION", reason: `INVALID_CONFIGURATION: ${configResult.errors.join("; ")}` };
  }
  const userConfig = configResult.value;

  const biasTimeframe = userConfig.biasTimeframe;
  const biasCandles = (ctx.candlesByTimeframe[biasTimeframe] ?? []).filter((c) => c.isClosed);
  const structureCandles = (ctx.candlesByTimeframe[JEANFX_V1_PARAMS.structureTimeframe] ?? []).filter((c) => c.isClosed);
  const entryCandles = (ctx.candlesByTimeframe[JEANFX_V1_PARAMS.entryTimeframe] ?? []).filter((c) => c.isClosed);

  if (biasCandles.length === 0 || structureCandles.length === 0 || entryCandles.length === 0) {
    return { type: "NO_ACTION", reason: "MISSING_MARKET_DATA" };
  }

  // Evaluate BOTH directions before deciding anything. The previous
  // implementation returned the first READY direction from a ["LONG","SHORT"]
  // loop, which gave LONG a systematic structural advantage purely from
  // array order.
  const params = { ...JEANFX_V1_PARAMS, biasTimeframe } as typeof JEANFX_V1_PARAMS;
  const results: Record<Direction, JeanfxWalkResult> = {
    LONG: runJeanfxDirection(biasCandles, structureCandles, entryCandles, "LONG", params, userConfig),
    SHORT: runJeanfxDirection(biasCandles, structureCandles, entryCandles, "SHORT", params, userConfig),
  };

  const ready = (["LONG", "SHORT"] as const).filter((d) => results[d].state === "READY" && results[d].setup);

  if (ready.length === 0) {
    // Surface the more advanced of the two walks so the UI can show real
    // deterministic progress ("waiting for MSS") rather than a bare no-op.
    const furthest = STATE_RANK[results.LONG.state] >= STATE_RANK[results.SHORT.state] ? results.LONG : results.SHORT;
    return { type: "NO_ACTION", reason: furthest.transitions[furthest.transitions.length - 1]?.reasonCode ?? "NO_SETUP_READY" };
  }

  if (ready.length === 1) return toDecision(ready[0], results[ready[0]]);

  /**
   * Both directions ready simultaneously. JeanFX bias is a single liquidity
   * draw, so a genuine LONG and SHORT cannot both be correct - reaching here
   * means the evidence is contradictory. The source offers no tie-break, so
   * rather than inventing one (or silently taking LONG because it is first in
   * the array) the ambiguity is REJECTED. Rejecting is the economically
   * sensible policy: an opposing pair would otherwise open two positions that
   * net to no exposure while paying spread and risking both stops.
   */
  return { type: "NO_ACTION", reason: "AMBIGUOUS_OPPOSING_SETUPS" };
}

/** How far through the JeanFX sequence a walk got - used only for reporting the more informative of two non-ready walks. */
const STATE_RANK: Record<string, number> = {
  INVALIDATED: 0,
  WAITING_FOR_BIAS: 1,
  WAITING_FOR_LIQUIDITY_SWEEP: 2,
  WAITING_FOR_STRUCTURE_CONFIRMATION: 3,
  WAITING_FOR_FVG: 4,
  WAITING_FOR_RETRACE: 5,
  WAITING_FOR_CONFIRMATION: 6,
  READY: 7,
};

export const jeanfxV1BuiltInStrategy: StrategyContract = {
  metadata: JEANFX_V1_METADATA,
  evaluate,
  resolveRequiredTimeframes,
};

export { JEANFX_GOLD_PROFILES };
