import type { Direction } from "@/lib/strategy-platform/types";
import type { CanonicalInstrument, Quote } from "./types";

/**
 * Gold PAPER sizing and execution modelling.
 *
 * Deliberately NOT a reuse of crypto sizing. Size derives from paper equity,
 * the risk percentage, and the entry-to-stop distance measured in the
 * instrument's own units - never from a notional/leverage assumption.
 *
 * For XAU/USD one unit is one troy ounce quoted in USD (see instruments.ts),
 * so a $1 move on 1 unit is $1 of PnL. No contract multiplier, no leverage.
 */

export type SizingInput = {
  instrument: CanonicalInstrument;
  equity: number;
  riskPct: number;
  entryPrice: number;
  stopPrice: number;
};

export type SizingResult =
  | { ok: true; units: number; riskAmount: number; stopDistance: number; riskPerUnit: number }
  | { ok: false; reasonCode: "INVALID_INPUT" | "INVALID_STOP_DISTANCE" | "MIN_ORDER_RISK_CONFLICT"; message: string };

/**
 * Fails closed on every invalid input.
 *
 * A risk-compliant size below the instrument minimum is REJECTED with
 * MIN_ORDER_RISK_CONFLICT - the trade is never inflated to meet the minimum
 * and the stop is never shrunk to fit, matching the platform-wide invariant
 * in lib/risk/position-sizing.ts.
 */
export function sizeGoldPosition(input: SizingInput): SizingResult {
  const { instrument, equity, riskPct, entryPrice, stopPrice } = input;

  for (const [name, value] of Object.entries({ equity, riskPct, entryPrice, stopPrice })) {
    if (!Number.isFinite(value)) return { ok: false, reasonCode: "INVALID_INPUT", message: `${name} must be a finite number` };
  }
  if (equity <= 0) return { ok: false, reasonCode: "INVALID_INPUT", message: "equity must be positive" };
  if (riskPct <= 0) return { ok: false, reasonCode: "INVALID_INPUT", message: "riskPct must be positive" };
  if (entryPrice <= 0) return { ok: false, reasonCode: "INVALID_INPUT", message: "entryPrice must be positive" };

  const stopDistance = Math.abs(entryPrice - stopPrice);
  if (stopDistance <= 0) {
    return { ok: false, reasonCode: "INVALID_STOP_DISTANCE", message: "stop must differ from entry" };
  }

  const riskAmount = equity * riskPct;
  const riskPerUnit = stopDistance * instrument.unitsPerContract;
  const units = riskAmount / riskPerUnit;

  if (units < instrument.minOrderUnits) {
    return {
      ok: false,
      reasonCode: "MIN_ORDER_RISK_CONFLICT",
      message: `Risk-compliant size ${units.toFixed(4)} ${instrument.unitLabel} is below the ${instrument.minOrderUnits} minimum. Rejected rather than inflated.`,
    };
  }

  return { ok: true, units, riskAmount, stopDistance, riskPerUnit };
}

export type FillCosts = {
  /** Per-unit slippage applied against the trader, in quote currency. */
  slippagePerUnit: number;
  /** Commission per unit, per side, in quote currency. */
  commissionPerUnit: number;
};

export const NO_COST_MODEL: FillCosts = { slippagePerUnit: 0, commissionPerUnit: 0 };

/**
 * Bid/ask semantics - never a free mid-price fill.
 *
 *   LONG  enters at ASK, exits at BID
 *   SHORT enters at BID, exits at ASK
 *
 * Slippage is always applied AGAINST the trader on both sides, so a wider
 * spread or more slippage can only ever worsen PnL.
 */
export function entryFillPrice(direction: Direction, quote: Quote, costs: FillCosts = NO_COST_MODEL): number {
  return direction === "LONG" ? quote.ask + costs.slippagePerUnit : quote.bid - costs.slippagePerUnit;
}

export function exitFillPrice(direction: Direction, quote: Quote, costs: FillCosts = NO_COST_MODEL): number {
  return direction === "LONG" ? quote.bid - costs.slippagePerUnit : quote.ask + costs.slippagePerUnit;
}

export type PaperTradeResult = {
  entryFill: number;
  exitFill: number;
  units: number;
  grossPnl: number;
  commission: number;
  spreadCost: number;
  netPnl: number;
  rMultiple: number;
};

/**
 * Settles one PAPER Gold trade with full cost attribution.
 *
 * `riskAmount` is the intended risk in quote currency (equity * riskPct),
 * which is what the R multiple is measured against - so R reflects the risk
 * actually taken, including the cost of crossing the spread.
 */
export function settleGoldPaperTrade(params: {
  direction: Direction;
  units: number;
  entryQuote: Quote;
  exitQuote: Quote;
  riskAmount: number;
  costs?: FillCosts;
}): PaperTradeResult {
  const costs = params.costs ?? NO_COST_MODEL;
  const { direction, units } = params;

  const entryFill = entryFillPrice(direction, params.entryQuote, costs);
  const exitFill = exitFillPrice(direction, params.exitQuote, costs);

  const grossPnl = direction === "LONG" ? (exitFill - entryFill) * units : (entryFill - exitFill) * units;
  const commission = costs.commissionPerUnit * units * 2; // entry + exit
  // What crossing the spread cost relative to a (fictional) mid-price fill,
  // reported for transparency - it is already inside grossPnl.
  const entryMid = (params.entryQuote.bid + params.entryQuote.ask) / 2;
  const exitMid = (params.exitQuote.bid + params.exitQuote.ask) / 2;
  const spreadCost = (Math.abs(entryFill - entryMid) + Math.abs(exitFill - exitMid)) * units;

  const netPnl = grossPnl - commission;

  return {
    entryFill,
    exitFill,
    units,
    grossPnl,
    commission,
    spreadCost,
    netPnl,
    rMultiple: params.riskAmount > 0 ? netPnl / params.riskAmount : 0,
  };
}
