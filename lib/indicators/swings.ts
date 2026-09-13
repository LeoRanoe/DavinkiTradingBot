export type Bar = { high: number; low: number };

/**
 * Detects fractal swing highs/lows: a bar whose high (low) is strictly
 * greater (less) than `lookback` bars on each side. Returns indices into
 * the input array. Only bars with `lookback` bars of confirmation on both
 * sides can be classified - the most recent `lookback` bars are never
 * flagged (there is nothing yet to confirm them against).
 */
export function findSwingHighs(bars: Bar[], lookback = 3): number[] {
  const indices: number[] = [];
  for (let i = lookback; i < bars.length - lookback; i++) {
    const isSwingHigh = isLocalExtreme(bars, i, lookback, "high");
    if (isSwingHigh) indices.push(i);
  }
  return indices;
}

export function findSwingLows(bars: Bar[], lookback = 3): number[] {
  const indices: number[] = [];
  for (let i = lookback; i < bars.length - lookback; i++) {
    const isSwingLow = isLocalExtreme(bars, i, lookback, "low");
    if (isSwingLow) indices.push(i);
  }
  return indices;
}

function isLocalExtreme(bars: Bar[], i: number, lookback: number, kind: "high" | "low"): boolean {
  const value = bars[i][kind];
  for (let j = i - lookback; j <= i + lookback; j++) {
    if (j === i) continue;
    if (kind === "high" && bars[j].high >= value) return false;
    if (kind === "low" && bars[j].low <= value) return false;
  }
  return true;
}

/** Most recent confirmed swing high/low price, or null if none found. */
export function latestSwingHigh(bars: Bar[], lookback = 3): number | null {
  const idx = findSwingHighs(bars, lookback);
  return idx.length ? bars[idx[idx.length - 1]].high : null;
}

export function latestSwingLow(bars: Bar[], lookback = 3): number | null {
  const idx = findSwingLows(bars, lookback);
  return idx.length ? bars[idx[idx.length - 1]].low : null;
}
