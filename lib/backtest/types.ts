import type { RejectionReason } from "@/lib/risk/types";

export type BacktestSplit = "DEVELOPMENT" | "VALIDATION" | "HOLDOUT";

export type BacktestConfig = {
  symbol: string;
  split: BacktestSplit;
  initialEquity: number;
  maxRiskPerTradePct: number;
  maxOpenPositions: number;
  maxNewTradesPerDay: number;
  maxLosingTradesPerDay: number;
  feeBps: number; // round-trip fee in basis points, applied each side
  slippageBps: number; // applied against the trader on entry and on exit
  instrument: {
    tickSize: number;
    qtyStep: number;
    minOrderQty: number;
    minOrderAmt: number;
    maxOrderQty: number | null;
  };
};

export type BacktestTradeRecord = {
  entryTime: number;
  exitTime: number | null;
  entryPrice: number;
  exitPrice: number | null;
  stopPrice: number;
  targetPrice: number;
  qty: number;
  fees: number;
  pnl: number | null;
  rMultiple: number | null;
  score: number;
  regime: string;
  outcome: "STOP" | "TARGET" | "OPEN_AT_END" | null;
};

export type BacktestSkip = {
  candleTime: number;
  reason: RejectionReason | "NO_SIGNAL";
};

export type BacktestMetrics = {
  tradeCount: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgWinR: number | null;
  avgLossR: number | null;
  expectancyR: number | null;
  profitFactor: number | null;
  grossReturn: number;
  netReturn: number;
  totalFees: number;
  maxDrawdownPct: number;
  maxLosingStreak: number;
  finalEquity: number;
  insufficientSample: boolean;
};

export type BacktestResult = {
  config: BacktestConfig;
  trades: BacktestTradeRecord[];
  skips: BacktestSkip[];
  metrics: BacktestMetrics;
};
