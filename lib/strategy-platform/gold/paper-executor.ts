import type { Direction } from "../types";
import { GOLD_CONTRACT_SPEC, GOLD_DEFAULT_SPREAD_MODEL } from "./sizing";

/**
 * Direction-aware PAPER fill/exit simulation for JeanFX Gold.
 *
 * lib/trading/paper.ts's `checkExit` assumes LONG (stop below entry,
 * target above) - correct for V1's Bybit Spot pipeline, wrong for a
 * SHORT gold setup. This module is the SHORT-aware counterpart, scoped
 * to JeanFX Gold only; it never modifies or is called by lib/trading/paper.ts
 * or anything on the V1 path. No function in this file places a broker
 * order - "fill" here always means "simulated fill for research", and
 * there is no parameter that could make it otherwise (CLAUDE.md #1/#2).
 */

export type GoldFillCosts = {
  /** Price-unit half-spread applied against the trader on entry (and the full round-trip spread realized in PnL) - see GOLD_DEFAULT_SPREAD_MODEL. */
  spread: number;
  slippageBps: number;
  feeBps: number; // commission, if any - 0 is a valid, explicit "no commission modeled" choice, not an omission.
};

export const GOLD_DEFAULT_COSTS: GoldFillCosts = {
  spread: GOLD_DEFAULT_SPREAD_MODEL.defaultSpread,
  slippageBps: 2,
  feeBps: 0,
};

/**
 * Simulated entry fill: a LONG buys at ask (mid + half-spread), a SHORT
 * sells at bid (mid - half-spread) - the spread always costs the trader,
 * exactly like a real broker quote, then slippage is applied on top in the
 * unfavorable direction.
 */
export function simulateGoldEntryFill(midPrice: number, direction: Direction, costs: GoldFillCosts = GOLD_DEFAULT_COSTS): number {
  const halfSpread = costs.spread / 2;
  const quoted = direction === "LONG" ? midPrice + halfSpread : midPrice - halfSpread;
  const slippageFactor = costs.slippageBps / 10_000;
  return direction === "LONG" ? quoted * (1 + slippageFactor) : quoted * (1 - slippageFactor);
}

/** Simulated exit fill: a LONG sells (exits) at bid, a SHORT buys back (exits) at ask - the spread costs the trader again on the way out. */
export function simulateGoldExitFill(midPrice: number, direction: Direction, costs: GoldFillCosts = GOLD_DEFAULT_COSTS): number {
  const halfSpread = costs.spread / 2;
  const quoted = direction === "LONG" ? midPrice - halfSpread : midPrice + halfSpread;
  const slippageFactor = costs.slippageBps / 10_000;
  return direction === "LONG" ? quoted * (1 - slippageFactor) : quoted * (1 + slippageFactor);
}

export function computeGoldFee(notional: number, feeBps: number): number {
  return notional * (feeBps / 10_000);
}

export type OpenGoldPaperTrade = {
  direction: Direction;
  entryPrice: number; // already the simulated fill price (post spread+slippage)
  stopPrice: number;
  targetPrice: number;
  qty: number;
};

export type GoldExitCheck = { shouldExit: false } | { shouldExit: true; outcome: "STOP" | "TARGET"; exitPrice: number };

/**
 * Same conservative same-candle rule as lib/trading/paper.ts's checkExit
 * (stop wins if both are touched in one bar), but direction-aware: a SHORT's
 * stop is ABOVE entry and its target is BELOW entry.
 */
export function checkGoldExit(trade: OpenGoldPaperTrade, candle: { high: number; low: number }): GoldExitCheck {
  if (trade.direction === "LONG") {
    const hitStop = candle.low <= trade.stopPrice;
    const hitTarget = candle.high >= trade.targetPrice;
    if (hitStop) return { shouldExit: true, outcome: "STOP", exitPrice: trade.stopPrice };
    if (hitTarget) return { shouldExit: true, outcome: "TARGET", exitPrice: trade.targetPrice };
  } else {
    const hitStop = candle.high >= trade.stopPrice;
    const hitTarget = candle.low <= trade.targetPrice;
    if (hitStop) return { shouldExit: true, outcome: "STOP", exitPrice: trade.stopPrice };
    if (hitTarget) return { shouldExit: true, outcome: "TARGET", exitPrice: trade.targetPrice };
  }
  return { shouldExit: false };
}

export type GoldClosedTradeResult = {
  grossPnl: number;
  fees: number;
  pnl: number;
  rMultiple: number;
};

/**
 * Realized PnL/R for a closed gold PAPER trade. `qty` is denominated in
 * the sizing model's units (ounces - see sizing.ts's documented
 * assumption); `contractUnitValue` converts a price-unit move into a
 * dollar amount explicitly, never via a hidden leverage multiplier.
 */
export function closeGoldPaperTrade(trade: OpenGoldPaperTrade, exitPrice: number, entryFee: number, exitFee: number): GoldClosedTradeResult {
  const direction = trade.direction === "LONG" ? 1 : -1;
  const priceDelta = (exitPrice - trade.entryPrice) * direction;
  const grossPnl = priceDelta * trade.qty * GOLD_CONTRACT_SPEC.contractUnitValue;
  const fees = entryFee + exitFee;
  const pnl = grossPnl - fees;

  const stopDistance = Math.abs(trade.entryPrice - trade.stopPrice);
  const riskAmount = stopDistance * trade.qty * GOLD_CONTRACT_SPEC.contractUnitValue;
  const rMultiple = riskAmount > 0 ? pnl / riskAmount : 0;

  return { grossPnl, fees, pnl, rMultiple };
}
