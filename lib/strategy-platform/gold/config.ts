import type { JeanfxUserConfig } from "@/lib/strategy/jeanfx-v1/config";
import { JEANFX_V1_PARAMS } from "@/lib/strategy/jeanfx-v1/config";
import type { Timeframe } from "../types";

/**
 * JeanFX Gold configuration profiles.
 *
 * IMPORTANT: this file adds NO new strategy logic. `lib/strategy/jeanfx-v1/`
 * (the immutable, versioned strategy core - see CLAUDE.md "Strategy
 * versions are immutable") is untouched. Every knob below is already a
 * user-tunable field of `JeanfxUserConfig`
 * (lib/strategy/jeanfx-v1/config.ts) that ships with the existing
 * `jeanfx-v1` strategy version: this file only picks values for those
 * existing fields and documents why, for the Gold activation. A gold
 * StrategyConfiguration's `parameters` column is one of these objects
 * (or a user override validated against the same `validateJeanfxUserConfig`
 * every other configuration goes through).
 */

/**
 * ACTIVE profile (brief S2/S3): M30 bias by default, London + New York
 * sessions only (never the crypto-style ALL-session default), 1% risk cap
 * (brief S9 - sourced, not an assumption; see JEANFX_V1_PARAMS.riskPct).
 */
export const JEANFX_GOLD_ACTIVE_CONFIG: JeanfxUserConfig = {
  biasTimeframe: "M30",
  riskPct: 0.01,
  sessionFilter: "LONDON_AND_NEW_YORK",
  confirmationPatterns: "BOTH",
};

/**
 * SELECTIVE profile (brief: "Allow H1 bias as the SELECTIVE profile") -
 * same session/risk discipline, higher-timeframe bias for fewer, more
 * selective setups. Structure (M15) and entry (M5) timeframes are fixed by
 * the strategy version itself either way (JEANFX_V1_PARAMS), never
 * user-configurable - see lib/strategy/jeanfx-v1/config.ts's comment on
 * why that surface stays small.
 */
export const JEANFX_GOLD_SELECTIVE_CONFIG: JeanfxUserConfig = {
  biasTimeframe: "H1",
  riskPct: 0.01,
  sessionFilter: "LONDON_AND_NEW_YORK",
  confirmationPatterns: "BOTH",
};

/** Gold-specific risk/session limits that live OUTSIDE JeanfxUserConfig (brief S9/S13) - enforced by lib/strategy-platform/gold/sizing.ts and scan.ts, never inside the immutable strategy core. */
export const JEANFX_GOLD_RISK_LIMITS = {
  riskPctMax: 0.01,
  rrMinimum: 3.0,
  maxTradesPerSession: 3,
} as const;

/**
 * Explicit M30/M15/M5 (or H1/M15/M5 under SELECTIVE) synchronization
 * (brief S2): which real market-data timeframe a gold scan's "bias" slot
 * must be filled with, plus the structure/entry timeframes - which are
 * ALWAYS M15/M5, fixed by the immutable strategy version itself
 * (JEANFX_V1_PARAMS), never user-configurable. A caller wiring real
 * candles into `scan.ts`'s `GoldScanInput.candlesByTimeframe.{bias,
 * structure, entry}` must fetch exactly these three timeframes for the
 * chosen profile - this function is the single place that mapping is
 * decided, so ACTIVE and SELECTIVE can never accidentally desynchronize
 * bias from structure/entry.
 */
export function selectGoldTimeframes(userConfig: JeanfxUserConfig): { bias: Timeframe; structure: Timeframe; entry: Timeframe } {
  return { bias: userConfig.biasTimeframe, structure: JEANFX_V1_PARAMS.structureTimeframe, entry: JEANFX_V1_PARAMS.entryTimeframe };
}
