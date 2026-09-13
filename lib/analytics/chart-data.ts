export type ChartCandle = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type EquityPoint = { time: number; equity: number };
export type TradePoint = { time: number; r: number | null; pnl: number | null; symbol: string };

export function closedCandles(rows: Array<ChartCandle & { isClosed?: boolean }>): ChartCandle[] {
  return rows.filter((row) => row.isClosed !== false).sort((a, b) => a.time - b.time);
}

export function drawdownSeries(points: EquityPoint[]) {
  let peak = Number.NEGATIVE_INFINITY;
  return points.map((point) => {
    peak = Math.max(peak, point.equity);
    return { time: point.time, drawdown: peak > 0 ? ((point.equity - peak) / peak) * 100 : 0 };
  });
}

export function cumulativeR(points: TradePoint[]) {
  let total = 0;
  return points.filter((point) => point.r !== null).sort((a, b) => a.time - b.time).map((point, index) => {
    total += point.r ?? 0;
    return { ...point, index: index + 1, cumulativeR: total };
  });
}
