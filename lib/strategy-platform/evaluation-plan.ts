import type { AssignmentInput, DataRequirement, MarketDataProvider } from "./orchestrator-types";
import type { CanonicalCandle, StrategyContract, Timeframe } from "./types";

/**
 * The timeframes an assignment ACTUALLY needs.
 *
 * Prefers the strategy's parameter-aware resolver over its static metadata,
 * so a configuration-dependent timeframe (e.g. JeanFX M30 vs H1 bias) causes
 * the matching candles to be fetched rather than silently receiving the
 * metadata default.
 */
export function resolveTimeframesFor(strategy: StrategyContract, parameters: Record<string, unknown>): Timeframe[] {
  const resolved = strategy.resolveRequiredTimeframes?.(parameters);
  return resolved && resolved.length > 0 ? resolved : strategy.metadata.requiredTimeframes;
}

/**
 * Requirements union (Prompt 3 S28): assignments × instruments produces a
 * lot of overlap - JeanFX and a custom strategy can both need BTCUSDT H1.
 * `buildEvaluationPlan` computes the DISTINCT (instrument, timeframe) pairs
 * across every assignment × its instruments × its strategy's
 * requiredTimeframes, so `loadMarketData` fetches each pair exactly once
 * regardless of how many assignments/strategies need it.
 */
export function buildEvaluationPlan(assignments: AssignmentInput[]): DataRequirement[] {
  const seen = new Map<string, DataRequirement>();
  for (const assignment of assignments) {
    for (const instrumentId of assignment.instrumentIds) {
      for (const timeframe of resolveTimeframesFor(assignment.strategy, assignment.parameters)) {
        const key = `${instrumentId}::${timeframe}`;
        if (!seen.has(key)) seen.set(key, { instrumentId, timeframe });
      }
    }
  }
  return [...seen.values()];
}

/** One candle set per distinct requirement, keyed the same way buildEvaluationPlan dedupes - `distributeMarketData` reads from this map, never triggers a second fetch. */
export type LoadedMarketData = Map<string, CanonicalCandle[]>;

export function requirementKey(instrumentId: string, timeframe: Timeframe): string {
  return `${instrumentId}::${timeframe}`;
}

/**
 * Loads every requirement exactly once via `provider`, however many
 * assignments/instruments needed it. This is the single point where a
 * provider call count can be asserted in tests (Prompt 3 S28/S35 "market
 * data dedupe").
 */
export async function loadMarketData(requirements: DataRequirement[], provider: MarketDataProvider): Promise<LoadedMarketData> {
  const result: LoadedMarketData = new Map();
  for (const req of requirements) {
    const candles = await provider(req);
    result.set(requirementKey(req.instrumentId, req.timeframe), candles);
  }
  return result;
}

/** Builds the candlesByTimeframe slice for one (assignment, instrument) evaluation from the already-loaded, deduplicated data - pure lookup, no fetch. */
export function distributeMarketData(loaded: LoadedMarketData, instrumentId: string, timeframes: Timeframe[]): Partial<Record<Timeframe, CanonicalCandle[]>> {
  const out: Partial<Record<Timeframe, CanonicalCandle[]>> = {};
  for (const tf of timeframes) {
    out[tf] = loaded.get(requirementKey(instrumentId, tf)) ?? [];
  }
  return out;
}
