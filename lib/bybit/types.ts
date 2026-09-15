export type Candle = {
  symbol: string;
  timeframe: string;
  openTime: number; // ms epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
};

export type InstrumentMetadata = {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  tickSize: number;
  qtyStep: number;
  minOrderQty: number;
  minOrderAmt: number;
  maxOrderQty: number | null;
  priceScale: number;
  raw: unknown;
};

export type Ticker = {
  symbol: string;
  lastPrice: number;
  price24hPcnt: number;
  highPrice24h: number;
  lowPrice24h: number;
  volume24h: number;
  /**
   * 24h turnover in quote currency (e.g. USDT). Additive field - added for
   * the Checkpoint 2 research-eligibility turnover check
   * (lib/domain/eligibility.ts); not read by Strategy V1 or any existing
   * candidate/risk code.
   */
  turnover24h: number;
  /**
   * Exchange server time (ms epoch) from the response envelope. Used as the
   * market-data freshness stamp so a candidate can never be priced off a
   * stale quote - see lib/risk/entry-protection.ts.
   */
  serverTimeMs: number;
};

/**
 * Maps our internal timeframe names to Bybit's kline "interval" values.
 * "4H" added for Checkpoint 3A research (V2 TRB) - purely additive, does
 * not change "1H"/"15M" (V1's only timeframes).
 */
export const BYBIT_INTERVAL: Record<"1H" | "15M" | "4H", string> = {
  "1H": "60",
  "15M": "15",
  "4H": "240",
};

/** Bucket length in ms per supported timeframe - used to determine candle closure and detect gaps. */
export const BYBIT_INTERVAL_MS: Record<"1H" | "15M" | "4H", number> = {
  "1H": 3_600_000,
  "15M": 900_000,
  "4H": 14_400_000,
};
