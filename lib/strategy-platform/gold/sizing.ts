import type { Direction } from "../types";
import { JEANFX_GOLD_RISK_LIMITS } from "./config";

/**
 * Normalized Gold (XAU/USD) position-sizing model for PAPER research.
 *
 * lib/risk/position-sizing.ts is NOT reused here: it hard-codes long-only
 * validation (`stopPrice >= entryPrice` is always rejected - see its
 * validateProposal) because it backs the real V1 Bybit Spot pipeline,
 * which genuinely cannot short. The brief is explicit that Gold PAPER
 * research "must not inherit the current Bybit Spot long-only
 * restriction" and must support both LONG and SHORT - so this is a
 * separate, direction-aware module, scoped only to JeanFX Gold PAPER
 * trades. It never touches lib/risk/engine.ts or lib/risk/position-sizing.ts,
 * and it has no LIVE code path anywhere in it (CLAUDE.md #1) - "PAPER" is
 * not a parameter here, it is the only mode this module knows how to
 * produce.
 *
 * IMPLEMENTATION ASSUMPTION (documented per CLAUDE.md's spirit for
 * undocumented values - see docs/strategies/jeanfx-gold-activation.md
 * "Sizing model assumptions"): no real broker contract metadata for gold
 * is available in this build. Until one is, a position is sized as a
 * direct notional exposure in OUNCES (the standard XAU/USD quotation
 * unit: 1 unit of "qty" = 1 troy ounce = $1 of price move per $1 move in
 * XAU/USD), in a single USD account currency. This intentionally avoids
 * any leverage or CFD "lot" (e.g. 100oz/lot) assumption - `contractUnitValue`
 * below is explicit and swappable the moment real broker metadata exists,
 * rather than hidden inside a leverage multiplier (brief S9: "No leverage
 * assumptions hidden inside sizing").
 */
export const GOLD_CONTRACT_SPEC = {
  /** USD value of a 1.00 XAU/USD price move per 1 unit of qty. Ounces: contractUnitValue = 1 (documented assumption above). */
  contractUnitValue: 1,
  /** Smallest tradable unit increment (documented PAPER-only assumption; a real broker's lot step would replace this). */
  unitStep: 0.01,
  /** Minimum quoted price increment (matches instrument.ts's GOLD_PIP_SIZE). */
  pricePrecision: 0.01,
  accountCurrency: "USD",
} as const;

export type GoldSpreadModel = {
  /** IMPLEMENTATION ASSUMPTION: a typical retail XAU/USD spread, in price units (not pips) - see docs/strategies/jeanfx-gold-activation.md. Overridden by a live quote's actual bid/ask when one is available (see paper-executor.ts). */
  defaultSpread: number;
};

export const GOLD_DEFAULT_SPREAD_MODEL: GoldSpreadModel = { defaultSpread: 0.3 };

export type GoldSizingInput = {
  direction: Direction;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  equity: number;
  /** Defaults to JEANFX_GOLD_RISK_LIMITS.riskPctMax; a caller may pass a smaller (never larger) value. */
  riskPct?: number;
};

export type GoldSizingResult =
  | {
      ok: true;
      qty: number;
      riskAmount: number;
      rMultiple: number;
      stopDistance: number;
      rewardDistance: number;
    }
  | { ok: false; reason: "INVALID_PRICES" | "RISK_PCT_EXCEEDS_MAX" | "ZERO_STOP_DISTANCE" | "RR_BELOW_MINIMUM" };

/**
 * Sizes ONE gold PAPER position, direction-aware (LONG or SHORT), never
 * inflating a below-minimum size and never shrinking the stop to fit
 * (CLAUDE.md #4's invariant, mirrored here for the gold sizing path):
 * a trade whose risk-compliant qty rounds to <= 0 is rejected outright by
 * `unitStep` flooring, not bumped up.
 */
export function sizeGoldPosition(input: GoldSizingInput): GoldSizingResult {
  const { direction, entryPrice, stopPrice, targetPrice, equity } = input;
  const riskPct = input.riskPct ?? JEANFX_GOLD_RISK_LIMITS.riskPctMax;

  if (entryPrice <= 0 || stopPrice <= 0 || targetPrice <= 0 || equity <= 0) return { ok: false, reason: "INVALID_PRICES" };
  if (riskPct <= 0 || riskPct > JEANFX_GOLD_RISK_LIMITS.riskPctMax) return { ok: false, reason: "RISK_PCT_EXCEEDS_MAX" };

  if (direction === "LONG") {
    if (!(stopPrice < entryPrice && targetPrice > entryPrice)) return { ok: false, reason: "INVALID_PRICES" };
  } else {
    if (!(stopPrice > entryPrice && targetPrice < entryPrice)) return { ok: false, reason: "INVALID_PRICES" };
  }

  const stopDistance = Math.abs(entryPrice - stopPrice);
  const rewardDistance = Math.abs(targetPrice - entryPrice);
  if (stopDistance <= 0) return { ok: false, reason: "ZERO_STOP_DISTANCE" };

  const rMultiple = rewardDistance / stopDistance;
  if (rMultiple < JEANFX_GOLD_RISK_LIMITS.rrMinimum) return { ok: false, reason: "RR_BELOW_MINIMUM" };

  const riskAmount = equity * riskPct;
  const rawQty = riskAmount / (stopDistance * GOLD_CONTRACT_SPEC.contractUnitValue);
  const qty = Math.floor(rawQty / GOLD_CONTRACT_SPEC.unitStep) * GOLD_CONTRACT_SPEC.unitStep;

  if (qty <= 0) return { ok: false, reason: "ZERO_STOP_DISTANCE" };

  return { ok: true, qty, riskAmount, rMultiple, stopDistance, rewardDistance };
}
