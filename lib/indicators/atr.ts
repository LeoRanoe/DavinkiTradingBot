export type OHLC = { high: number; low: number; close: number };

/** True Range for a single bar, given the previous bar's close. */
export function trueRange(bar: OHLC, prevClose: number | null): number {
  if (prevClose === null) return bar.high - bar.low;
  return Math.max(
    bar.high - bar.low,
    Math.abs(bar.high - prevClose),
    Math.abs(bar.low - prevClose),
  );
}

/** Wilder's ATR (Average True Range), smoothed the same way as RSI. */
export function atr(bars: OHLC[], period = 14): number[] {
  const result = new Array<number>(bars.length).fill(NaN);
  if (bars.length <= period) return result;

  const trs: number[] = bars.map((bar, i) => trueRange(bar, i === 0 ? null : bars[i - 1].close));

  let avg = trs.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  result[period] = avg;

  for (let i = period + 1; i < bars.length; i++) {
    avg = (avg * (period - 1) + trs[i]) / period;
    result[i] = avg;
  }

  return result;
}

export function latestAtr(bars: OHLC[], period = 14): number | null {
  const series = atr(bars, period);
  const last = series[series.length - 1];
  return Number.isNaN(last) ? null : last;
}
