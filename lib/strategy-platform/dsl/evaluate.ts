import { ema } from "@/lib/indicators/ema";
import { sma } from "@/lib/indicators/sma";
import { rsi } from "@/lib/indicators/rsi";
import { atr } from "@/lib/indicators/atr";
import { JEANFX_V1_PARAMS } from "@/lib/strategy/jeanfx-v1/config";
import { detectSwingHighs, detectSwingLows, latestSwingHigh, latestSwingLow, swingHighSeries, swingLowSeries } from "@/lib/strategy/jeanfx-v1/primitives/swings";
import { findEqualHighs, findEqualLows } from "@/lib/strategy/jeanfx-v1/primitives/equal-levels";
import { poolsFromEqualLevels, poolsFromUnclusteredSwings } from "@/lib/strategy/jeanfx-v1/primitives/liquidity";
import { detectSweep } from "@/lib/strategy/jeanfx-v1/primitives/sweep";
import { breaksStructure } from "@/lib/strategy/jeanfx-v1/primitives/structure";
import { detectFvgAt } from "@/lib/strategy/jeanfx-v1/primitives/fvg";
import { isBearishCandle, isBearishEngulfing, isBullishCandle, isBullishEngulfing, isHammer, isShootingStar } from "@/lib/strategy/jeanfx-v1/primitives/candles";
import type { CanonicalCandle, Timeframe, TradingSession } from "../types";
import type { DslDefinition, DslEvalResult, DslNode } from "./types";

/**
 * Deterministic, IO-free DSL evaluator. No eval(), no new Function(), no VM
 * - every node is interpreted by direct recursion over the typed DslNode
 * union (see dsl/registry.ts for the allow-list validate.ts already
 * enforced before any definition reaches here).
 *
 * Safety properties enforced here (see docs/architecture/strategy-platform.md
 * "DSL safety"):
 *  - lookahead: only isClosed candles are ever considered (filtered on entry).
 *  - NaN/Infinity: any non-finite value short-circuits to a typed failure,
 *    never a silent boolean.
 *  - division by zero (PERCENT_CHANGE): short-circuits to a typed failure.
 */

function ok<T>(value: T): DslEvalResult<T> {
  return { ok: true, value };
}
function err<T>(reason: string): DslEvalResult<T> {
  return { ok: false, reason };
}

function rollingExtreme(values: number[], period: number, mode: "max" | "min"): number[] {
  const result = new Array<number>(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    let acc = mode === "max" ? -Infinity : Infinity;
    let valid = true;
    for (let j = i - period + 1; j <= i; j++) {
      const v = values[j];
      if (!Number.isFinite(v)) {
        valid = false;
        break;
      }
      acc = mode === "max" ? Math.max(acc, v) : Math.min(acc, v);
    }
    result[i] = valid ? acc : NaN;
  }
  return result;
}

function evaluateSeries(node: DslNode, candles: CanonicalCandle[]): DslEvalResult<number[]> {
  switch (node.type) {
    case "PRICE":
      return ok(candles.map((c) => c[node.field]));
    case "VOLUME":
      return ok(candles.map((c) => c.volume));
    case "CONST":
      return ok(candles.map(() => node.value));
    case "EMA": {
      const src = node.child ? evaluateSeries(node.child, candles) : ok(candles.map((c) => c.close));
      if (!src.ok) return src;
      return ok(ema(src.value, node.period));
    }
    case "SMA": {
      const src = node.child ? evaluateSeries(node.child, candles) : ok(candles.map((c) => c.close));
      if (!src.ok) return src;
      return ok(sma(src.value, node.period));
    }
    case "RSI":
      return ok(rsi(candles.map((c) => c.close), node.period));
    case "HIGHEST": {
      const src = evaluateSeries(node.child, candles);
      if (!src.ok) return src;
      return ok(rollingExtreme(src.value, node.period, "max"));
    }
    case "LOWEST": {
      const src = evaluateSeries(node.child, candles);
      if (!src.ok) return src;
      return ok(rollingExtreme(src.value, node.period, "min"));
    }
    case "ATR":
      return ok(atr(candles, node.period));
    case "SWING_HIGH":
      return ok(swingHighSeries(candles, node.leftRightBars));
    case "SWING_LOW":
      return ok(swingLowSeries(candles, node.leftRightBars));
    default:
      return err(`'${node.type}' does not produce a value series`);
  }
}

type ConditionCtx = { candles: CanonicalCandle[]; marketSession: TradingSession[] | null };

function compare(comparator: string, left: number, right: number): boolean {
  switch (comparator) {
    case "GT":
      return left > right;
    case "GTE":
      return left >= right;
    case "LT":
      return left < right;
    case "LTE":
      return left <= right;
    case "EQ":
      return left === right;
    default:
      return false;
  }
}

function evaluateCondition(node: DslNode, ctx: ConditionCtx): DslEvalResult<boolean> {
  const index = ctx.candles.length - 1;
  if (index < 0) return err("MISSING_MARKET_DATA");

  switch (node.type) {
    case "ALL": {
      for (const child of node.children) {
        const r = evaluateCondition(child, ctx);
        if (!r.ok) return r;
        if (!r.value) return ok(false);
      }
      return ok(true);
    }
    case "ANY": {
      for (const child of node.children) {
        const r = evaluateCondition(child, ctx);
        if (!r.ok) return r;
        if (r.value) return ok(true);
      }
      return ok(false);
    }
    case "NOT": {
      const r = evaluateCondition(node.child, ctx);
      if (!r.ok) return r;
      return ok(!r.value);
    }
    case "COMPARE": {
      const left = evaluateSeries(node.left, ctx.candles);
      const right = evaluateSeries(node.right, ctx.candles);
      if (!left.ok) return left;
      if (!right.ok) return right;
      const l = left.value[index];
      const r = right.value[index];
      if (!Number.isFinite(l) || !Number.isFinite(r)) return err("NON_FINITE_VALUE");
      return ok(compare(node.comparator, l, r));
    }
    case "CROSS_ABOVE":
    case "CROSS_BELOW": {
      if (index < 1) return err("INSUFFICIENT_HISTORY");
      const left = evaluateSeries(node.left, ctx.candles);
      const right = evaluateSeries(node.right, ctx.candles);
      if (!left.ok) return left;
      if (!right.ok) return right;
      const lPrev = left.value[index - 1];
      const lNow = left.value[index];
      const rPrev = right.value[index - 1];
      const rNow = right.value[index];
      if (![lPrev, lNow, rPrev, rNow].every(Number.isFinite)) return err("NON_FINITE_VALUE");
      const crossedUp = lPrev <= rPrev && lNow > rNow;
      const crossedDown = lPrev >= rPrev && lNow < rNow;
      return ok(node.type === "CROSS_ABOVE" ? crossedUp : crossedDown);
    }
    case "SESSION": {
      if (!ctx.marketSession) return ok(false);
      return ok(node.sessions.some((s) => ctx.marketSession!.includes(s)));
    }
    case "PERCENT_CHANGE": {
      if (index < node.period) return err("INSUFFICIENT_HISTORY");
      const src = node.child ? evaluateSeries(node.child, ctx.candles) : ok(ctx.candles.map((c) => c.close));
      if (!src.ok) return src;
      const now = src.value[index];
      const then = src.value[index - node.period];
      if (!Number.isFinite(now) || !Number.isFinite(then)) return err("NON_FINITE_VALUE");
      if (then === 0) return err("DIVISION_BY_ZERO");
      const pct = ((now - then) / Math.abs(then)) * 100;
      if (!Number.isFinite(pct)) return err("NON_FINITE_VALUE");
      return ok(node.comparator === "GT" ? pct > node.valuePct : pct < node.valuePct);
    }
    case "BULLISH_CANDLE":
      return ok(isBullishCandle(ctx.candles[index]));
    case "BEARISH_CANDLE":
      return ok(isBearishCandle(ctx.candles[index]));
    case "CANDLE_PATTERN": {
      const current = ctx.candles[index];
      const prior = index > 0 ? ctx.candles[index - 1] : null;
      const params = JEANFX_V1_PARAMS.confirmation;
      switch (node.pattern) {
        case "BULLISH_ENGULFING":
          return ok(prior !== null && isBullishEngulfing(prior, current));
        case "BEARISH_ENGULFING":
          return ok(prior !== null && isBearishEngulfing(prior, current));
        case "HAMMER":
          return ok(isHammer(current, params));
        case "SHOOTING_STAR":
          return ok(isShootingStar(current, params));
      }
      return err("UNKNOWN_CANDLE_PATTERN");
    }
    case "BOS": {
      const priorCandles = ctx.candles.slice(0, index);
      const requiredSwing = node.direction === "LONG" ? latestSwingHigh(priorCandles, node.leftRightBars) : latestSwingLow(priorCandles, node.leftRightBars);
      if (!requiredSwing) return err("INSUFFICIENT_HISTORY");
      return ok(breaksStructure(ctx.candles[index], node.direction, requiredSwing));
    }
    case "LIQUIDITY_SWEEP": {
      const upTo = ctx.candles.slice(0, index + 1);
      const swings = node.side === "BUY_SIDE" ? detectSwingHighs(upTo, node.leftRightBars) : detectSwingLows(upTo, node.leftRightBars);
      const clusters = node.side === "BUY_SIDE" ? findEqualHighs(upTo, swings, node.equalHighLowAtrMultiple, node.atrPeriod) : findEqualLows(upTo, swings, node.equalHighLowAtrMultiple, node.atrPeriod);
      const pools = [...poolsFromEqualLevels(clusters), ...poolsFromUnclusteredSwings(swings, clusters, node.side)];
      return ok(detectSweep(upTo, index, pools) !== null);
    }
    case "FVG": {
      const fvg = detectFvgAt(ctx.candles, index);
      return ok(fvg !== null && fvg.direction === node.direction);
    }
    default:
      return err(`'${node.type}' does not produce a condition`);
  }
}

/**
 * Evaluates a validated DslDefinition's entry condition against the latest
 * CLOSED candle of its primary timeframe (def.timeframes[0]). Only ever
 * consults candlesByTimeframe entries the caller supplied - there is no
 * network or clock access, and unclosed candles are filtered out before any
 * node is evaluated, so a "future" candle appended by a caller by mistake
 * can never influence the result.
 */
export function evaluateDslEntry(
  def: DslDefinition,
  candlesByTimeframe: Partial<Record<Timeframe, CanonicalCandle[]>>,
  marketSession: TradingSession[] | null = null,
): DslEvalResult<boolean> {
  const primaryTf = def.timeframes[0];
  const raw = candlesByTimeframe[primaryTf] ?? [];
  const closed = raw.filter((c) => c.isClosed);
  if (closed.length === 0) return err("MISSING_MARKET_DATA");
  return evaluateCondition(def.entry, { candles: closed, marketSession });
}

export { evaluateSeries, evaluateCondition };
