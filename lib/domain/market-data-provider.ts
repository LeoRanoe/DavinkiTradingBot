import type { Instrument } from "./instrument";
import type { CanonicalTimeframe } from "./timeframe";

/** Venue-independent candle. Mirrors lib/bybit/types.ts Candle shape 1:1. */
export type CanonicalCandle = {
  instrumentId: string;
  timeframe: CanonicalTimeframe;
  openTime: number; // ms epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
};

export type CanonicalTicker = {
  instrumentId: string;
  lastPrice: number;
  /** Bid/ask are optional: crypto spot venues often only expose last price. */
  bid?: number;
  ask?: number;
  serverTimeMs: number;
};

/**
 * Generic market-data contract (CLAUDE.md §5). Strategy/risk/research code
 * should depend on this interface, not on lib/bybit/* directly, except
 * where Strategy V1's frozen production path still does so intentionally
 * for backwards compatibility during migration (see docs/BUILD_STATE.md).
 */
export interface MarketDataProvider {
  readonly venue: Instrument["venue"];
  listInstruments(): Promise<Instrument[]>;
  getInstrument(instrumentId: string): Promise<Instrument | null>;
  getTicker(instrument: Instrument): Promise<CanonicalTicker>;
  getCandles(
    instrument: Instrument,
    timeframe: CanonicalTimeframe,
    limit?: number,
    endMs?: number,
  ): Promise<CanonicalCandle[]>;
  getServerTimeMs(): Promise<number>;
}
