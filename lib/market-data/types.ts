import type { AssetClass, CanonicalCandle, Instrument, Timeframe } from "@/lib/strategy-platform/types";

/**
 * Market data provider abstraction.
 *
 * Strategy logic must never know a vendor's ticker spelling. A strategy asks
 * for a CanonicalInstrument; an adapter translates that into whatever symbol
 * its vendor uses. XAU/USD is "XAU/USD" to Twelve Data, "C:XAUUSD" to
 * Polygon and "XAU_USD" to OANDA - none of those strings may appear in
 * lib/strategy/.
 */

/**
 * Canonical instrument id: `<ASSET_CLASS>:<PROVIDER>:<SYMBOL>`, e.g.
 * "METAL:TWELVEDATA:XAU/USD". The provider segment is part of the identity
 * because the same nominal instrument from two vendors is not the same
 * series - different session coverage, different spreads, different
 * timestamps - and mixing them inside one research session would
 * invalidate the evidence.
 */
export type CanonicalInstrumentId = string;

export type CanonicalInstrument = Instrument & {
  canonicalId: CanonicalInstrumentId;
  providerId: ProviderId;
  /** Vendor-specific ticker. Adapters only. */
  providerSymbol: string;
  displayName: string;
  assetClass: AssetClass;
  /**
   * What ONE unit means for position sizing. For normalized PAPER research on
   * XAU/USD this is 1 troy ounce, so PnL = (exit - entry) * units directly in
   * USD, with no hidden leverage or broker contract multiplier.
   */
  unitLabel: string;
  unitsPerContract: number;
  /** Minimum tradeable size. A risk-compliant size below this is REJECTED, never inflated. */
  minOrderUnits: number;
  quoteCurrency: string;
};

export type ProviderId = "TWELVEDATA" | "BYBIT";

export type Quote = {
  canonicalId: CanonicalInstrumentId;
  bid: number;
  ask: number;
  /** ask - bid, in quote currency. Never assumed to be zero. */
  spread: number;
  /** The PROVIDER's timestamp for this quote, not our clock. */
  providerTimestamp: number;
  receivedAt: number;
};

export type CandleRequest = {
  instrument: CanonicalInstrument;
  timeframe: Timeframe;
  /** Maximum number of candles to return, most recent last. */
  limit: number;
  /** Optional inclusive start/end for historical backfill, ms epoch. */
  startTime?: number;
  endTime?: number;
};

export type ProviderStatus = "CONNECTED" | "DEGRADED" | "DISCONNECTED" | "MISSING_CREDENTIALS";

export type ProviderHealth = {
  providerId: ProviderId;
  status: ProviderStatus;
  /** Whether a credential is present. NEVER the credential itself. */
  credentialConfigured: boolean;
  /** The exact env var an operator must set when credentials are missing. */
  requiredEnvVars: string[];
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastErrorMessage: string | null;
  latencyMs: number | null;
  supportedInstruments: CanonicalInstrumentId[];
  supportedTimeframes: Timeframe[];
};

export class MarketDataError extends Error {
  constructor(
    message: string,
    readonly code:
      | "MISSING_CREDENTIALS"
      | "PROVIDER_ERROR"
      | "UNSUPPORTED_INSTRUMENT"
      | "UNSUPPORTED_TIMEFRAME"
      | "INVALID_RESPONSE"
      | "RATE_LIMITED",
    readonly providerId: ProviderId,
  ) {
    super(message);
    this.name = "MarketDataError";
  }
}

/**
 * A market data source. Every method FAILS CLOSED: an adapter must throw
 * rather than return a partial, stale or synthesised series. Nothing in this
 * codebase may generate candles - a missing series is an error, never
 * fabricated data.
 */
export interface MarketDataSource {
  readonly providerId: ProviderId;
  readonly supportedTimeframes: Timeframe[];
  supports(instrument: CanonicalInstrument): boolean;
  /** Closed candles only. An adapter must drop the in-progress bar. */
  fetchCandles(request: CandleRequest): Promise<CanonicalCandle[]>;
  fetchQuote(instrument: CanonicalInstrument): Promise<Quote>;
  health(): Promise<ProviderHealth>;
}
