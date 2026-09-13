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
};

/** Maps our internal timeframe names to Bybit's kline "interval" values. */
export const BYBIT_INTERVAL: Record<"1H" | "15M", string> = {
  "1H": "60",
  "15M": "15",
};
