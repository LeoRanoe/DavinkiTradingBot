import type { VenueCapabilities } from "./orchestrator-types";
import type { Direction, Instrument, StrategyMetadata, Timeframe } from "./types";

/**
 * Strategy/instrument/venue compatibility checks (Prompt 3 S10), run
 * before an assignment is allowed to activate. Distinguishes RESEARCH
 * compatibility (can this strategy be evaluated/backtested at all) from
 * EXECUTION compatibility (can a resulting opportunity actually be sent to
 * a venue) - a SHORT JeanFX setup on Bybit spot is research-compatible but
 * not execution-compatible, and the reason says exactly that rather than
 * a bare "incompatible".
 */
export type CompatibilityCheck = {
  researchCompatible: boolean;
  executionCompatible: boolean;
  reasons: string[];
};

export type CompatibilityInput = {
  metadata: StrategyMetadata;
  instrument: Instrument;
  venue: VenueCapabilities;
  /** Direction the assignment intends to trade - checked against both the strategy and the venue. */
  side: Direction;
  /** Closed-candle counts actually available per timeframe (from the data already loaded for this evaluation). */
  availableHistoryBars: Partial<Record<Timeframe, number>>;
};

export function checkStrategyCompatibility(input: CompatibilityInput): CompatibilityCheck {
  const { metadata, instrument, venue, side, availableHistoryBars } = input;
  const reasons: string[] = [];
  let researchCompatible = true;
  let executionCompatible = true;

  if (!metadata.supportedAssetClasses.includes(instrument.assetClass)) {
    researchCompatible = false;
    executionCompatible = false;
    reasons.push(`${metadata.displayName} does not support ${instrument.assetClass} instruments.`);
  }

  if (!metadata.supportedSides.includes(side)) {
    researchCompatible = false;
    executionCompatible = false;
    reasons.push(`${metadata.displayName} does not define a ${side} setup.`);
  } else if (side === "SHORT" && !venue.supportsShort) {
    // Research still allowed - only execution is blocked (spec Prompt 2 S4 / Prompt 3 S10 example).
    executionCompatible = false;
    reasons.push(`${metadata.displayName} SHORT setups cannot currently execute on this venue because production execution here is long-only. Research/backtesting is still available.`);
  }

  for (const tf of metadata.requiredTimeframes) {
    const available = availableHistoryBars[tf] ?? 0;
    const required = metadata.minimumHistoryRequirements[tf] ?? 0;
    if (available < required) {
      researchCompatible = false;
      executionCompatible = false;
      reasons.push(`${metadata.displayName} requires ${required} closed ${tf} bars but only ${available} are available.`);
    }
  }

  return { researchCompatible, executionCompatible, reasons };
}
