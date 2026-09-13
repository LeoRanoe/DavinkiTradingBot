import { z } from "zod";

/**
 * Zod schemas for Bybit V5 public market-data endpoints.
 * Reference: https://bybit-exchange.github.io/docs/v5/market/kline
 * and https://bybit-exchange.github.io/docs/v5/market/instrument
 *
 * Bybit wraps every response in a common envelope: { retCode, retMsg, result, time }.
 * retCode === 0 means success. We validate both the envelope and result shape,
 * and fail closed (throw) on anything unexpected rather than guessing.
 */
export const bybitEnvelopeSchema = z.object({
  retCode: z.number(),
  retMsg: z.string(),
  time: z.number(),
});

// Kline row: [startTime, open, high, low, close, volume, turnover] - all strings.
export const bybitKlineRowSchema = z.tuple([
  z.string(), // start time (ms)
  z.string(), // open
  z.string(), // high
  z.string(), // low
  z.string(), // close
  z.string(), // volume
  z.string(), // turnover
]);

export const bybitKlineResponseSchema = bybitEnvelopeSchema.extend({
  result: z.object({
    symbol: z.string(),
    category: z.string(),
    list: z.array(bybitKlineRowSchema),
  }),
});

export const bybitInstrumentInfoSchema = z.object({
  symbol: z.string(),
  baseCoin: z.string(),
  quoteCoin: z.string(),
  status: z.string(),
  lotSizeFilter: z.object({
    basePrecision: z.string(),
    quotePrecision: z.string().optional(),
    minOrderQty: z.string(),
    maxOrderQty: z.string(),
    minOrderAmt: z.string().optional(),
    maxOrderAmt: z.string().optional(),
    qtyStep: z.string().optional(),
  }),
  priceFilter: z.object({
    tickSize: z.string(),
  }),
});

export const bybitInstrumentsResponseSchema = bybitEnvelopeSchema.extend({
  result: z.object({
    category: z.string(),
    list: z.array(bybitInstrumentInfoSchema),
  }),
});

export const bybitTickerSchema = z.object({
  symbol: z.string(),
  lastPrice: z.string(),
  price24hPcnt: z.string(),
  highPrice24h: z.string(),
  lowPrice24h: z.string(),
  volume24h: z.string(),
  turnover24h: z.string(),
});

export const bybitTickersResponseSchema = bybitEnvelopeSchema.extend({
  result: z.object({
    category: z.string(),
    list: z.array(bybitTickerSchema),
  }),
});

export type BybitKlineRow = z.infer<typeof bybitKlineRowSchema>;
export type BybitInstrumentInfo = z.infer<typeof bybitInstrumentInfoSchema>;
export type BybitTicker = z.infer<typeof bybitTickerSchema>;
