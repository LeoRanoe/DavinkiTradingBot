/** Simple moving average of volume over `period` bars. */
export function volumeAverage(volumes: number[], period = 20): number[] {
  const result = new Array<number>(volumes.length).fill(NaN);
  for (let i = period - 1; i < volumes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += volumes[j];
    result[i] = sum / period;
  }
  return result;
}

/** Ratio of the latest volume bar to its trailing average ("relative volume"). */
export function relativeVolume(volumes: number[], period = 20): number | null {
  const avgSeries = volumeAverage(volumes, period);
  const avg = avgSeries[avgSeries.length - 1];
  const latest = volumes[volumes.length - 1];
  if (Number.isNaN(avg) || avg === 0) return null;
  return latest / avg;
}
