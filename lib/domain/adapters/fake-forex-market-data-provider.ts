import type { CanonicalCandle, CanonicalTicker, MarketDataProvider } from "../market-data-provider";
import type { Instrument } from "../instrument";
import type { CanonicalTimeframe } from "../timeframe";
import { FAKE_FOREX_INSTRUMENTS } from "../instruments/forex-fake";
import { isMarketOpen } from "../calendar";

const FIXED_PRICES: Record<string, { mid: number; spread: number }> = {
  EUR_USD: { mid: 1.105, spread: 0.0001 },
  USD_JPY: { mid: 150.25, spread: 0.01 },
};

/**
 * A deterministic, no-network FX provider used only to prove the domain
 * model (CLAUDE.md §40). It is never wired into any real strategy,
 * scanner, research job, or execution path. No forex trading exists.
 */
export class FakeForexMarketDataProvider implements MarketDataProvider {
  readonly venue = "OANDA_FAKE" as const;

  constructor(private readonly nowMs: () => number = () => Date.now()) {}

  async listInstruments(): Promise<Instrument[]> {
    return [...FAKE_FOREX_INSTRUMENTS];
  }

  async getInstrument(instrumentId: string): Promise<Instrument | null> {
    return FAKE_FOREX_INSTRUMENTS.find((i) => i.id === instrumentId) ?? null;
  }

  async getServerTimeMs(): Promise<number> {
    return this.nowMs();
  }

  async getTicker(instrument: Instrument): Promise<CanonicalTicker> {
    const now = this.nowMs();
    if (!isMarketOpen(instrument.tradingCalendarId, now)) {
      throw new Error(`MARKET_CLOSED: ${instrument.id} (FX weekend)`);
    }
    const p = FIXED_PRICES[instrument.venueSymbol];
    if (!p) throw new Error(`No fixture price for ${instrument.venueSymbol}`);
    return {
      instrumentId: instrument.id,
      lastPrice: p.mid,
      bid: p.mid - p.spread / 2,
      ask: p.mid + p.spread / 2,
      serverTimeMs: now,
    };
  }

  async getCandles(
    instrument: Instrument,
    timeframe: CanonicalTimeframe,
    limit = 10,
  ): Promise<CanonicalCandle[]> {
    const p = FIXED_PRICES[instrument.venueSymbol];
    if (!p) throw new Error(`No fixture price for ${instrument.venueSymbol}`);
    const now = this.nowMs();
    const out: CanonicalCandle[] = [];
    for (let i = limit - 1; i >= 0; i--) {
      const openTime = now - i * 60_000;
      out.push({
        instrumentId: instrument.id,
        timeframe,
        openTime,
        open: p.mid,
        high: p.mid + p.spread,
        low: p.mid - p.spread,
        close: p.mid,
        volume: 0,
        isClosed: i > 0,
      });
    }
    return out;
  }
}
