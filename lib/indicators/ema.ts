/**
 * Exponential Moving Average.
 * Returns an array aligned with the input (same length), with `NaN` for
 * indices before the series has enough data to seed the EMA (first `period`
 * values use a simple-average seed, standard practice).
 */
export function ema(values: number[], period: number): number[] {
  if (period <= 0) throw new Error("EMA period must be positive");
  const result = new Array<number>(values.length).fill(NaN);
  if (values.length < period) return result;

  const k = 2 / (period + 1);
  const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = seed;

  for (let i = period; i < values.length; i++) {
    result[i] = values[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

/** Convenience: latest (last) EMA value, or null if insufficient data. */
export function latestEma(values: number[], period: number): number | null {
  const series = ema(values, period);
  const last = series[series.length - 1];
  return Number.isNaN(last) ? null : last;
}
