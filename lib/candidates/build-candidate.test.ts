import { describe, expect, it } from "vitest";
import { buildTradeCandidate, type BuildCandidateInput } from "./build-candidate";
import type { ScoreResult } from "@/lib/strategy/v1/score";
import type { AccountState, InstrumentRules, RiskLimits } from "@/lib/risk/types";

function baseScore(overrides: Partial<ScoreResult> = {}): ScoreResult {
  return {
    total: 85,
    classification: "CANDIDATE",
    entryPrice: 100,
    stopPrice: 97, // 3% stop
    targetPrice: 106, // R/R = 2
    riskReward: 2,
    components: [
      { name: "trend", pointsEarned: 25, pointsPossible: 25, detail: { ema20: 101, ema50: 99, ema200: 95 } },
      { name: "pullback", pointsEarned: 18, pointsPossible: 20, detail: { pullbackDistanceAtr: 0.3, ema20: 101 } },
      { name: "momentum", pointsEarned: 15, pointsPossible: 15, detail: { rsi: 55 } },
      { name: "volume", pointsEarned: 12, pointsPossible: 15, detail: { relativeVolume: 1.1 } },
      { name: "riskReward", pointsEarned: 15, pointsPossible: 15, detail: { stopPrice: 97, targetPrice: 106, riskReward: 2 } },
      { name: "volatility", pointsEarned: 10, pointsPossible: 10, detail: { atrPct: 0.01 } },
    ],
    ...overrides,
  };
}

const baseInstrument: InstrumentRules = {
  tickSize: 0.01,
  qtyStep: 0.0001,
  minOrderQty: 0.0001,
  minOrderAmt: 5,
  maxOrderQty: null,
};

const baseAccount: AccountState = {
  equity: 1000,
  availableBalance: 1000,
  openPositionsCount: 0,
  tradesOpenedTodayUtc: 0,
  losingTradesTodayUtc: 0,
};

const baseRiskLimits: RiskLimits = {
  maxRiskPerTradePct: 0.01,
  maxOpenPositions: 1,
  maxNewTradesPerDay: 2,
  maxLosingTradesPerDay: 2,
  riskMode: "PERCENT_OF_EQUITY",
  minCandidateScore: 80,
  minRiskReward: 1.5,
};

const NOW = 1_800_000_000_000;

function baseInput(overrides: Partial<BuildCandidateInput> = {}): BuildCandidateInput {
  return {
    candidateId: "candidate-1",
    signalId: "signal-1",
    symbol: "BTCUSDT",
    strategyVersionId: "strategy-v1",
    strategyVersionLabel: "v1",
    timeframe: "15M",
    closedCandleTimeMs: NOW - 60_000,
    regime: "EMA50_ABOVE_EMA200_AND_PRICE_ABOVE_EMA50",
    score: baseScore(),
    referencePrice: 100,
    marketDataTimestampMs: NOW,
    nowMs: NOW,
    account: baseAccount,
    instrument: baseInstrument,
    riskLimits: baseRiskLimits,
    costModel: { feeBps: 10, slippageBps: 5 },
    entryProtection: { maxEntryDriftPct: 0.002, candidateExpiryMinutes: 10, maxMarketDataAgeMs: 60_000 },
    volatility: { maxAtrPct: 0.05 },
    tradingMode: "PAPER",
    strategyApproved: true,
    ...overrides,
  };
}

describe("buildTradeCandidate - Milestone 1 acceptance criterion", () => {
  it("produces a COMPLETE, financially valid trade candidate for a clean deterministic fixture", () => {
    const result = buildTradeCandidate(baseInput());
    expect(result.kind).toBe("CANDIDATE");
    if (result.kind !== "CANDIDATE") return;
    const c = result.candidate;

    expect(c.lifecycle.state).toBe("CANDIDATE");
    expect(c.lifecycle.rejectionReason).toBeNull();
    expect(c.symbol).toBe("BTCUSDT");
    expect(c.side).toBe("LONG");
    expect(c.position.stopPrice).toBeLessThan(c.position.plannedEntry);
    expect(c.position.targetPrice).toBeGreaterThan(c.position.plannedEntry);
    expect(c.position.riskReward).toBeCloseTo(2);
    expect(c.risk.equity).toBe(1000);
    expect(c.risk.riskBudget).toBeCloseTo(10);
    expect(c.risk.positionNotional).toBeGreaterThan(0);
    expect(c.risk.quantity).toBeGreaterThan(0);
    expect(c.risk.modeledMaxLoss).toBeGreaterThan(0);
    expect(c.risk.estimatedTargetProfit).toBeGreaterThan(0);
    // News stays structurally present but empty until the News milestone.
    expect(c.news.riskLevel).toBeNull();
  });

  it("otherwise produces a precise typed rejection - never a partial candidate", () => {
    const result = buildTradeCandidate(baseInput({ score: baseScore({ total: 50 }) }));
    expect(result.kind).toBe("REJECTED");
    if (result.kind !== "REJECTED") return;
    expect(result.rejection.reason).toBe("SCORE_TOO_LOW");
    expect(result.rejection.detail.length).toBeGreaterThan(0);
  });
});

describe("buildTradeCandidate - typed rejections", () => {
  it("SCORE_TOO_LOW: below the owner-configured minimum score", () => {
    const result = buildTradeCandidate(baseInput({ score: baseScore({ total: 79 }) }));
    expect(result.kind).toBe("REJECTED");
    if (result.kind === "REJECTED") expect(result.rejection.reason).toBe("SCORE_TOO_LOW");
  });

  it("INVALID_RISK_REWARD: strategy could not compute a stop/target", () => {
    const result = buildTradeCandidate(baseInput({ score: baseScore({ stopPrice: null, targetPrice: null, riskReward: null }) }));
    expect(result.kind).toBe("REJECTED");
    if (result.kind === "REJECTED") expect(result.rejection.reason).toBe("INVALID_RISK_REWARD");
  });

  it("MIN_RISK_REWARD_NOT_MET: R/R below the owner-configured minimum", () => {
    const result = buildTradeCandidate(
      baseInput({ score: baseScore({ targetPrice: 101, riskReward: 0.33 }) }), // 1:0.33 R/R
    );
    expect(result.kind).toBe("REJECTED");
    if (result.kind === "REJECTED") expect(result.rejection.reason).toBe("MIN_RISK_REWARD_NOT_MET");
  });

  it("DUPLICATE_CANDIDATE: an active candidate already exists for this signal key", () => {
    const result = buildTradeCandidate(
      baseInput({ existingActiveCandidateKeys: ["strategy-v1:BTCUSDT:15M:" + (NOW - 60_000)] }),
    );
    expect(result.kind).toBe("REJECTED");
    if (result.kind === "REJECTED") expect(result.rejection.reason).toBe("DUPLICATE_CANDIDATE");
  });

  it("ENTRY_OUTSIDE_ALLOWED_RANGE: reference price drifted too far from the planned entry (no chasing)", () => {
    const result = buildTradeCandidate(baseInput({ referencePrice: 102 })); // +2%, band is 0.2%
    expect(result.kind).toBe("REJECTED");
    if (result.kind === "REJECTED") expect(result.rejection.reason).toBe("ENTRY_OUTSIDE_ALLOWED_RANGE");
  });

  it("STALE_MARKET_DATA: market data older than the configured freshness bound", () => {
    const result = buildTradeCandidate(baseInput({ marketDataTimestampMs: NOW - 5 * 60_000 }));
    expect(result.kind).toBe("REJECTED");
    if (result.kind === "REJECTED") expect(result.rejection.reason).toBe("STALE_MARKET_DATA");
  });

  it("EXCESSIVE_VOLATILITY: ATR/price above the configured maximum, even with a technically valid setup", () => {
    const result = buildTradeCandidate(
      baseInput({
        score: baseScore({
          components: baseScore().components.map((c) => (c.name === "volatility" ? { ...c, detail: { atrPct: 0.09 } } : c)),
        }),
      }),
    );
    expect(result.kind).toBe("REJECTED");
    if (result.kind === "REJECTED") expect(result.rejection.reason).toBe("EXCESSIVE_VOLATILITY");
  });

  it("MIN_ORDER_RISK_CONFLICT (spec #42 restated through the full candidate pipeline): rejects rather than inflating or shrinking the stop", () => {
    const result = buildTradeCandidate(
      baseInput({
        account: { equity: 10, availableBalance: 10, openPositionsCount: 0, tradesOpenedTodayUtc: 0, losingTradesTodayUtc: 0 },
        riskLimits: { ...baseRiskLimits, maxRiskPerTradePct: 0.01 },
      }),
    );
    // equity=10, risk=1% -> $0.10 budget, 3% stop -> ~$3.33 compliant notional, $5 exchange minimum.
    expect(result.kind).toBe("REJECTED");
    if (result.kind === "REJECTED") {
      expect(result.rejection.reason).toBe("MIN_ORDER_RISK_CONFLICT");
      expect(result.rejection.detail).not.toMatch(/\$5\.00\)/);
    }
  });

  it("OPEN_POSITION_LIMIT: existing owner-configured limits still apply through the candidate pipeline", () => {
    const result = buildTradeCandidate(baseInput({ account: { ...baseAccount, openPositionsCount: 1 } }));
    expect(result.kind).toBe("REJECTED");
    if (result.kind === "REJECTED") expect(result.rejection.reason).toBe("OPEN_POSITION_LIMIT");
  });

  it("DAILY_TRADE_LIMIT: existing daily trade cap still applies", () => {
    const result = buildTradeCandidate(baseInput({ account: { ...baseAccount, tradesOpenedTodayUtc: 2 } }));
    expect(result.kind).toBe("REJECTED");
    if (result.kind === "REJECTED") expect(result.rejection.reason).toBe("DAILY_TRADE_LIMIT");
  });

  it("TRADING_MODE_BLOCK: LIVE remains impossible even through the full candidate pipeline", () => {
    const result = buildTradeCandidate(baseInput({ tradingMode: "LIVE" }));
    expect(result.kind).toBe("REJECTED");
    if (result.kind === "REJECTED") expect(result.rejection.reason).toBe("TRADING_MODE_BLOCK");
  });
});

describe("buildTradeCandidate - tick size and quantity rounding", () => {
  it("rounds planned entry/stop/target to the instrument tick size", () => {
    const offGridScore = baseScore({ entryPrice: 100.3, stopPrice: 97.2, targetPrice: 106.1, riskReward: 1.87 });
    const result = buildTradeCandidate(
      baseInput({ score: offGridScore, referencePrice: 100.3, instrument: { ...baseInstrument, tickSize: 0.5 } }),
    );
    expect(result.kind).toBe("CANDIDATE");
    if (result.kind !== "CANDIDATE") return;
    for (const price of [result.candidate.position.plannedEntry, result.candidate.position.stopPrice, result.candidate.position.targetPrice]) {
      const steps = price / 0.5;
      expect(Number.isInteger(Math.round(steps * 1e8) / 1e8)).toBe(true);
    }
  });

  it("rounds quantity down to the exchange qty step, never up", () => {
    const result = buildTradeCandidate(baseInput({ instrument: { ...baseInstrument, qtyStep: 0.01 } }));
    expect(result.kind).toBe("CANDIDATE");
    if (result.kind !== "CANDIDATE") return;
    const steps = result.candidate.risk.roundedQuantity / 0.01;
    expect(Number.isInteger(Math.round(steps * 1e8) / 1e8)).toBe(true);
  });
});
