import { getEnv } from "@/lib/config/env";
import { TwelveDataProvider } from "./providers/twelve-data";
import { resolveInstrument } from "./instruments";
import {
  MarketDataError,
  type CanonicalInstrument,
  type CanonicalInstrumentId,
  type MarketDataSource,
  type ProviderHealth,
  type ProviderId,
} from "./types";

/**
 * Provider registry - the single place a market data source is constructed.
 *
 * Credential resolution follows the project convention (lib/config/): env var
 * fallback today, with Supabase Vault layering available later. A missing
 * credential is reported as MISSING_CREDENTIALS with the exact env var name
 * an operator must set; it is never treated as a reason to substitute
 * another instrument or synthesise data.
 */

let cached: Map<ProviderId, MarketDataSource> | null = null;

function build(): Map<ProviderId, MarketDataSource> {
  const env = getEnv();
  const sources = new Map<ProviderId, MarketDataSource>();
  sources.set("TWELVEDATA", new TwelveDataProvider({ apiKey: env.TWELVE_DATA_API_KEY }));
  return sources;
}

export function getMarketDataSources(): Map<ProviderId, MarketDataSource> {
  if (!cached) cached = build();
  return cached;
}

/** Test seam - resets the memoised registry. */
export function resetMarketDataSources() {
  cached = null;
}

export function getProvider(providerId: ProviderId): MarketDataSource {
  const source = getMarketDataSources().get(providerId);
  if (!source) {
    throw new MarketDataError(`No market data source registered for '${providerId}'`, "PROVIDER_ERROR", providerId);
  }
  return source;
}

/** Resolves the instrument AND the source that serves it, or throws with an actionable message. */
export function resolveInstrumentSource(canonicalId: CanonicalInstrumentId): { instrument: CanonicalInstrument; source: MarketDataSource } {
  const instrument = resolveInstrument(canonicalId);
  if (!instrument) {
    throw new MarketDataError(`Unknown instrument '${canonicalId}'`, "UNSUPPORTED_INSTRUMENT", "TWELVEDATA");
  }
  return { instrument, source: getProvider(instrument.providerId) };
}

export async function allProviderHealth(): Promise<ProviderHealth[]> {
  return Promise.all([...getMarketDataSources().values()].map((s) => s.health()));
}
