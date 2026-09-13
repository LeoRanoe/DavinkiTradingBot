/**
 * Paper trading fill simulation. Deterministic, no external calls - models
 * the same fee/slippage assumptions the backtester uses so paper results are
 * comparable to backtest results.
 */
export function simulateEntryFill(price: number, slippageBps: number): number {
  return price * (1 + slippageBps / 10_000);
}

export function simulateExitFill(price: number, slippageBps: number): number {
  return price * (1 - slippageBps / 10_000);
}

export function computeFee(notional: number, feeBps: number): number {
  return notional * (feeBps / 10_000);
}

export type OpenPaperTrade = {
  id: string;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  qty: number;
};

export type ExitCheck =
  | { shouldExit: false }
  | { shouldExit: true; outcome: "STOP" | "TARGET"; exitPrice: number };

/**
 * Checks a single closed candle against an open paper position's stop/target.
 * Same conservative same-candle rule as the backtester: if both are touched
 * in one candle, assume the unfavorable ordering (stop wins).
 */
export function checkExit(trade: OpenPaperTrade, candle: { high: number; low: number }): ExitCheck {
  const hitStop = candle.low <= trade.stopPrice;
  const hitTarget = candle.high >= trade.targetPrice;
  if (hitStop) return { shouldExit: true, outcome: "STOP", exitPrice: trade.stopPrice };
  if (hitTarget) return { shouldExit: true, outcome: "TARGET", exitPrice: trade.targetPrice };
  return { shouldExit: false };
}
