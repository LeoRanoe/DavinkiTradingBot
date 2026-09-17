/**
 * Simple Moving Average.
 * Returns an array aligned with the input (same length), with `NaN` for
 * indices before the series has `period` values.
 */
export function sma(values: number[], period: number): number[] {
  if (period <= 0) throw new Error("SMA period must be positive");
  const result = new Array<number>(values.length).fill(NaN);
  let windowSum = 0;
  for (let i = 0; i < values.length; i++) {
    windowSum += values[i];
    if (i >= period) windowSum -= values[i - period];
    if (i >= period - 1) result[i] = windowSum / period;
  }
  return result;
}

/** Convenience: latest (last) SMA value, or null if insufficient data. */
export function latestSma(values: number[], period: number): number | null {
  const series = sma(values, period);
  const last = series[series.length - 1];
  return Number.isNaN(last) ? null : last;
}
