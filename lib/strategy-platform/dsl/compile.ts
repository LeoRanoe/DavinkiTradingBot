import { atr } from "@/lib/indicators/atr";
import { detectSwingHighs, detectSwingLows, latestSwingHigh, latestSwingLow } from "@/lib/strategy/jeanfx-v1/primitives/swings";
import { findEqualHighs, findEqualLows } from "@/lib/strategy/jeanfx-v1/primitives/equal-levels";
import { poolsFromEqualLevels, poolsFromUnclusteredSwings } from "@/lib/strategy/jeanfx-v1/primitives/liquidity";
import { evaluateDslEntry } from "./evaluate";
import { validateDslDefinition } from "./validate";
import type { DslDefinition, DslStopSpec, DslTargetSpec } from "./types";
import type { CanonicalCandle, Direction, StrategyContext, StrategyContract, StrategyDecision, StrategyMetadata } from "../types";

/**
 * Compiles a validated DslDefinition into a StrategyContract - the thing
 * that makes user-defined strategies run through the exact same generic
 * engine as any built-in (see docs/architecture/strategy-platform.md
 * "Generic backtest engine"). No new execution path is introduced: the
 * compiled evaluate() calls evaluateDslEntry() (the same evaluator DSL
 * tests exercise directly) and one of the closed-set stop/target builders
 * below - never eval()/Function()/dynamic code of any kind.
 *
 * Validation happens ONCE here, at compile time (mirroring "a strategy
 * version is validated once, at creation, then immutable") - not on every
 * evaluate() call.
 */
export function compileDslStrategy(
  definition: DslDefinition,
  metadata: StrategyMetadata,
): { ok: true; strategy: StrategyContract } | { ok: false; errors: string[] } {
  const validation = validateDslDefinition(definition);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  function evaluate(ctx: StrategyContext): StrategyDecision {
    const primaryTf = definition.timeframes[0];
    const candles = (ctx.candlesByTimeframe[primaryTf] ?? []).filter((c) => c.isClosed);

    const entryResult = evaluateDslEntry(definition, ctx.candlesByTimeframe, ctx.marketSession);
    if (!entryResult.ok) return { type: "NO_ACTION", reason: entryResult.reason };
    if (!entryResult.value) return { type: "NO_ACTION", reason: "ENTRY_CONDITION_NOT_MET" };
    if (candles.length === 0) return { type: "NO_ACTION", reason: "MISSING_MARKET_DATA" };

    for (const direction of definition.side) {
      const signalCandle = candles[candles.length - 1];
      const entryPrice = signalCandle.close;

      const stopResult = computeStop(definition.stop, candles, direction, entryPrice, signalCandle);
      if (!stopResult.ok) continue;

      const targetResult = computeTarget(definition.target, candles, direction, entryPrice, stopResult.value);
      if (!targetResult.ok) continue;

      const risk = Math.abs(entryPrice - stopResult.value);
      const reward = Math.abs(targetResult.value - entryPrice);
      if (risk <= 0) continue;

      return {
        type: direction === "LONG" ? "ENTER_LONG" : "ENTER_SHORT",
        entry: { price: entryPrice, kind: "DSL_ENTRY_CONDITION" },
        stop: { price: stopResult.value, kind: definition.stop.kind },
        target: { price: targetResult.value, kind: definition.target.kind, rMultiple: reward / risk },
        partialExitPlan: null,
        reasonCodes: ["DSL_ENTRY_CONDITION_MET"],
        featureSnapshot: {},
        confidence: null, // a DSL strategy defines no mathematical confidence unless a future primitive adds one
      };
    }

    return { type: "NO_ACTION", reason: "NO_VALID_STOP_TARGET" };
  }

  return { ok: true, strategy: { metadata, evaluate } };
}

type Computed = { ok: true; value: number } | { ok: false };

function computeStop(spec: DslStopSpec, candles: CanonicalCandle[], direction: Direction, entryPrice: number, signalCandle: CanonicalCandle): Computed {
  switch (spec.kind) {
    case "FIXED_PERCENT":
      return { ok: true, value: direction === "LONG" ? entryPrice * (1 - spec.pct) : entryPrice * (1 + spec.pct) };
    case "ATR_MULTIPLE": {
      const series = atr(candles, spec.atrPeriod);
      const a = series[series.length - 1];
      if (!Number.isFinite(a)) return { ok: false };
      return { ok: true, value: direction === "LONG" ? entryPrice - spec.multiple * a : entryPrice + spec.multiple * a };
    }
    case "BELOW_SWING": {
      if (direction !== "LONG") return { ok: false };
      const swing = latestSwingLow(candles, spec.leftRightBars);
      if (!swing) return { ok: false };
      return { ok: true, value: swing.price * (1 - spec.bufferPct) };
    }
    case "ABOVE_SWING": {
      if (direction !== "SHORT") return { ok: false };
      const swing = latestSwingHigh(candles, spec.leftRightBars);
      if (!swing) return { ok: false };
      return { ok: true, value: swing.price * (1 + spec.bufferPct) };
    }
    case "BELOW_SIGNAL_LOW":
      if (direction !== "LONG") return { ok: false };
      return { ok: true, value: signalCandle.low * (1 - spec.bufferPct) };
    case "ABOVE_SIGNAL_HIGH":
      if (direction !== "SHORT") return { ok: false };
      return { ok: true, value: signalCandle.high * (1 + spec.bufferPct) };
  }
}

function computeTarget(spec: DslTargetSpec, candles: CanonicalCandle[], direction: Direction, entryPrice: number, stopPrice: number): Computed {
  const risk = Math.abs(entryPrice - stopPrice);
  switch (spec.kind) {
    case "R_MULTIPLE":
      if (risk <= 0) return { ok: false };
      return { ok: true, value: direction === "LONG" ? entryPrice + spec.multiple * risk : entryPrice - spec.multiple * risk };
    case "FIXED_PERCENT":
      return { ok: true, value: direction === "LONG" ? entryPrice * (1 + spec.pct) : entryPrice * (1 - spec.pct) };
    case "NEXT_SWING": {
      const swing = direction === "LONG" ? latestSwingHigh(candles, spec.leftRightBars) : latestSwingLow(candles, spec.leftRightBars);
      if (!swing) return { ok: false };
      const valid = direction === "LONG" ? swing.price > entryPrice : swing.price < entryPrice;
      return valid ? { ok: true, value: swing.price } : { ok: false };
    }
    case "NEXT_LIQUIDITY_POOL": {
      const side = direction === "LONG" ? "BUY_SIDE" : "SELL_SIDE";
      const swings = side === "BUY_SIDE" ? detectSwingHighs(candles, spec.leftRightBars) : detectSwingLows(candles, spec.leftRightBars);
      const clusters = side === "BUY_SIDE" ? findEqualHighs(candles, swings, spec.equalHighLowAtrMultiple, spec.atrPeriod) : findEqualLows(candles, swings, spec.equalHighLowAtrMultiple, spec.atrPeriod);
      const pools = [...poolsFromEqualLevels(clusters), ...poolsFromUnclusteredSwings(swings, clusters, side)].filter((p) => !p.swept);
      const candidates = pools.filter((p) => (direction === "LONG" ? p.level > entryPrice : p.level < entryPrice));
      if (candidates.length === 0) return { ok: false };
      const nearest = candidates.reduce((best, p) => (Math.abs(p.level - entryPrice) < Math.abs(best.level - entryPrice) ? p : best));
      return { ok: true, value: nearest.level };
    }
  }
}
