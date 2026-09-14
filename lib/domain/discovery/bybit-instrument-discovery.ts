import { getListingStatus, getTicker, listSpotInstruments } from "@/lib/bybit/client";
import type { InstrumentMetadata } from "@/lib/bybit/types";
import { classifyResearchEligibility, type ResearchEligibilityResult } from "../eligibility";

/**
 * Discovery capability behind the Bybit adapter (CLAUDE.md §7 / Checkpoint 2
 * §7): lets a caller verify a candidate research pair actually exists on
 * the venue and get a first-pass eligibility read, WITHOUT leaking Bybit's
 * raw instrument shape into core domain code — everything below returns
 * plain booleans/numbers/strings, never Bybit's `raw` blob.
 *
 * Heuristic, not authoritative: leveraged-token and stablecoin-pair
 * detection here is a naming-convention heuristic (documented inline),
 * not a Bybit-provided flag. It exists so an obviously-wrong candidate
 * (e.g. "BTC3LUSDT", "USDCUSDT") is never silently treated as ELIGIBLE
 * for lack of a check, but a human should still confirm before promoting
 * any instrument out of research.
 */

const KNOWN_STABLECOINS = new Set(["USDT", "USDC", "DAI", "TUSD", "FDUSD", "USDE", "PYUSD"]);

/** Matches Bybit's leveraged-token naming convention, e.g. BTC3L, ETH3S, BTC5L. */
const LEVERAGED_TOKEN_BASE_PATTERN = /^[A-Z0-9]+\d[LS]$/;

export function isLikelyLeveragedTokenBase(baseCoin: string): boolean {
  return LEVERAGED_TOKEN_BASE_PATTERN.test(baseCoin);
}

export function isStablecoinVsStablecoin(baseCoin: string, quoteCoin: string): boolean {
  return KNOWN_STABLECOINS.has(baseCoin) && KNOWN_STABLECOINS.has(quoteCoin);
}

export type DiscoveredInstrument = {
  venueSymbol: string;
  baseAsset: string;
  quoteAsset: string;
  listingStatus: string | null;
  isLikelyLeveragedToken: boolean;
  isStablecoinPair: boolean;
};

function toDiscovered(meta: InstrumentMetadata): DiscoveredInstrument {
  return {
    venueSymbol: meta.symbol,
    baseAsset: meta.baseCoin,
    quoteAsset: meta.quoteCoin,
    listingStatus: getListingStatus(meta),
    isLikelyLeveragedToken: isLikelyLeveragedTokenBase(meta.baseCoin),
    isStablecoinPair: isStablecoinVsStablecoin(meta.baseCoin, meta.quoteCoin),
  };
}

/** Lists every Bybit spot instrument, mapped to the venue-neutral shape above. */
export async function discoverBybitSpotInstruments(): Promise<DiscoveredInstrument[]> {
  const all = await listSpotInstruments();
  return all.map(toDiscovered);
}

/** Looks up one candidate venue symbol; returns null if it isn't listed at all. */
export async function discoverBybitInstrument(venueSymbol: string): Promise<DiscoveredInstrument | null> {
  const all = await discoverBybitSpotInstruments();
  return all.find((i) => i.venueSymbol === venueSymbol) ?? null;
}

export type EligibilityCheckInput = {
  venueSymbol: string;
  historyBarCount: number | null;
  minHistoryBarCount: number;
  minTurnoverUsd24h: number | null;
  /** Marks a synthetic/wrapped duplicate not explicitly selected for research (CLAUDE.md §13). */
  isUnselectedSyntheticDuplicate?: boolean;
};

/**
 * Fetches live listing status + turnover for one candidate and classifies
 * it. Network errors propagate (fail closed) rather than defaulting to any
 * eligibility status.
 */
export async function checkBybitResearchEligibility(
  input: EligibilityCheckInput,
): Promise<ResearchEligibilityResult> {
  const discovered = await discoverBybitInstrument(input.venueSymbol);
  if (!discovered) {
    return { status: "INELIGIBLE", reasons: ["NOT_LISTED_ON_VENUE"] };
  }

  const ticker = await getTicker(input.venueSymbol).catch(() => null);

  return classifyResearchEligibility({
    listingStatus: discovered.listingStatus,
    hasInstrumentMetadata: true,
    historyBarCount: input.historyBarCount,
    minHistoryBarCount: input.minHistoryBarCount,
    turnoverUsd24h: ticker?.turnover24h ?? null,
    minTurnoverUsd24h: input.minTurnoverUsd24h,
    isLeveragedToken: discovered.isLikelyLeveragedToken,
    isStablecoinPair: discovered.isStablecoinPair,
    isUnselectedSyntheticDuplicate: input.isUnselectedSyntheticDuplicate ?? false,
  });
}
