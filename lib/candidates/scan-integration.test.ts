import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/bybit/types";
import { evaluateSignal } from "@/lib/strategy/v1/signal";
import { STRATEGY_V1_PARAMS, STRATEGY_V1_VERSION_LABEL } from "@/lib/strategy/v1/config";
import { candidateKey } from "@/lib/risk/duplicate-candidate";
import type { AccountState, InstrumentRules } from "@/lib/risk/types";
import {
  DEFAULT_RISK_SETTINGS,
  riskSettingsFromRow,
  riskSettingsUpdateSchema,
  RISK_PRESETS,
  type OwnerRiskSettings,
} from "@/lib/settings/risk-settings";
import { buildCandidateForScan } from "./from-settings";
import { buildSignalRow } from "./persistence";

/**
 * Integration coverage for the Milestone 1 scanner path:
 *
 *   owner settings -> real Strategy V1 evaluation over deterministic candles
 *   -> fresh reference price -> buildTradeCandidate() -> persisted signals row
 *
 * These deliberately run the REAL strategy/indicator/risk code (no stubbed
 * score object) so a regression anywhere in the chain fails here. Only the
 * two genuinely external things - the market feed and the database - are
 * represented by fixtures.
 */

const SYMBOL = "BTCUSDT";
const STRATEGY_VERSION_ID = "00000000-0000-0000-0000-0000000000v1";
const SIGNAL_ID = "11111111-1111-1111-1111-111111111111";

function makeCandles(timeframe: "1H" | "15M", closes: number[], volumes: number[]): Candle[] {
  const intervalMs = timeframe === "1H" ? 3_600_000 : 900_000;
  const baseTime = Date.parse("2026-01-01T00:00:00Z");
  return closes.map((close, i) => ({
    symbol: SYMBOL,
    timeframe,
    openTime: baseTime + i * intervalMs,
    open: close,
    high: close + 0.5,
    low: close - 0.5,
    close,
    volume: volumes[i],
    isClosed: true,
  }));
}

/**
 * A deterministic market fixture that genuinely scores as a CANDIDATE:
 * a steady 1H uptrend (bullish regime) with a clean 15M pullback into EMA20
 * on rising volume. Verified below to score 99 with entry 148.8 / stop 147.3
 * / target 151.8 (R/R 2, ~1.01% stop distance).
 *
 * Thresholds are NEVER lowered to manufacture a candidate - the fixture is
 * shaped to satisfy the production thresholds as they stand.
 */
function market(dip: number, dipLen: number): { candles1h: Candle[]; candles15m: Candle[] } {
  const n = 260;
  const closes15m: number[] = [];
  for (let i = 0; i < n; i++) closes15m.push(100 + i * 0.2);
  for (let k = 0; k < dipLen; k++) closes15m[n - dipLen + k] -= dip * ((k + 1) / dipLen);
  const volumes15m = closes15m.map((_, i) => (i >= n - 2 ? 140 : 100));

  const closes1h = Array.from({ length: n }, (_, i) => 100 + i * 0.2);
  return {
    candles1h: makeCandles("1H", closes1h, closes1h.map(() => 100)),
    candles15m: makeCandles("15M", closes15m, volumes15m),
  };
}

function candidateMarket() {
  return market(3, 5);
}

/**
 * The same bullish regime with a shallow, unconvincing pullback: a real
 * signal, but scored below CANDIDATE. It must never reach the risk layer.
 */
function weakSetupMarket() {
  return market(1, 3);
}

/** A flat market: the 1H regime gate refuses it outright - no signal at all. */
function flatMarket(): { candles1h: Candle[]; candles15m: Candle[] } {
  const flat = Array.from({ length: 260 }, () => 100);
  return {
    candles1h: makeCandles("1H", flat, flat.map(() => 100)),
    candles15m: makeCandles("15M", flat, flat.map(() => 100)),
  };
}

const instrument: InstrumentRules = {
  tickSize: 0.01,
  qtyStep: 0.0001,
  minOrderQty: 0.0001,
  minOrderAmt: 5,
  maxOrderQty: null,
};

function account(overrides: Partial<AccountState> = {}): AccountState {
  return {
    equity: 1000,
    availableBalance: 1000,
    openPositionsCount: 0,
    tradesOpenedTodayUtc: 0,
    losingTradesTodayUtc: 0,
    ...overrides,
  };
}

function settings(overrides: Partial<OwnerRiskSettings> = {}): OwnerRiskSettings {
  return { ...DEFAULT_RISK_SETTINGS, tradingMode: "PAPER", maxRiskPerTradePct: 0.005, ...overrides };
}

const NOW = Date.parse("2026-01-03T18:00:00Z");

/** Runs the real strategy evaluation, then the scanner's candidate pipeline. */
function runScan(opts: {
  market?: { candles1h: Candle[]; candles15m: Candle[] };
  settings?: OwnerRiskSettings;
  account?: AccountState;
  instrument?: InstrumentRules;
  referencePrice?: number;
  marketDataTimestampMs?: number;
  strategyApproved?: boolean;
  existingActiveCandidateKeys?: readonly string[];
}) {
  const market = opts.market ?? candidateMarket();
  const evaluation = evaluateSignal(SYMBOL, market.candles1h, market.candles15m);
  if (evaluation.kind !== "SIGNAL") throw new Error(`expected a signal, got ${evaluation.reason}`);

  const isCandidate = evaluation.score.classification === "CANDIDATE";
  const resolvedSettings = opts.settings ?? settings();
  const referencePrice = opts.referencePrice ?? evaluation.score.entryPrice;
  const marketDataTimestampMs = opts.marketDataTimestampMs ?? NOW;

  const result = isCandidate
    ? buildCandidateForScan({
        signalId: SIGNAL_ID,
        symbol: SYMBOL,
        strategyVersionId: STRATEGY_VERSION_ID,
        strategyVersionLabel: STRATEGY_V1_VERSION_LABEL,
        timeframe: STRATEGY_V1_PARAMS.entryTimeframe,
        closedCandleTimeMs: evaluation.candleTime,
        regime: evaluation.regime,
        score: evaluation.score,
        referencePrice,
        marketDataTimestampMs,
        nowMs: NOW,
        account: opts.account ?? account(),
        instrument: opts.instrument ?? instrument,
        settings: resolvedSettings,
        strategyApproved: opts.strategyApproved ?? true,
        existingActiveCandidateKeys: opts.existingActiveCandidateKeys,
      })
    : undefined;

  const row = buildSignalRow({
    strategyVersionId: STRATEGY_VERSION_ID,
    symbol: SYMBOL,
    timeframe: STRATEGY_V1_PARAMS.entryTimeframe,
    candleTimeMs: evaluation.candleTime,
    regime: evaluation.regime,
    score: evaluation.score,
    tradingMode: resolvedSettings.tradingMode,
    reason: "integration fixture",
    result,
    referencePrice: isCandidate ? referencePrice : undefined,
    referencePriceAtMs: isCandidate ? marketDataTimestampMs : undefined,
    signalExpiryMinutes: resolvedSettings.signalExpiryMinutes,
    candidateExpiryMinutes: resolvedSettings.candidateExpiryMinutes,
    nowMs: NOW,
  });

  return { evaluation, result, row };
}

describe("scanner integration: settings -> strategy -> fresh price -> candidate -> persistence", () => {
  it("the fixture really is a CANDIDATE under production thresholds", () => {
    const { evaluation } = runScan({});
    expect(evaluation.score.classification).toBe("CANDIDATE");
    expect(evaluation.score.total).toBeGreaterThanOrEqual(DEFAULT_RISK_SETTINGS.minCandidateScore);
    expect(evaluation.score.entryPrice).toBeCloseTo(148.8);
    expect(evaluation.score.stopPrice).toBeCloseTo(147.3);
    expect(evaluation.score.riskReward).toBeCloseTo(2);
  });

  it("produces a complete candidate and persists the full snapshot on the signals row", () => {
    const { result, row } = runScan({});
    expect(result?.kind).toBe("CANDIDATE");
    if (result?.kind !== "CANDIDATE") return;

    // Sized from the owner's configured risk budget (0.5% of $1000 = $5),
    // NOT from position size: $5 / ~1.008% stop distance ~= $496 notional.
    expect(result.candidate.risk.riskBudget).toBeCloseTo(5);
    expect(result.candidate.risk.positionNotional).toBeGreaterThan(400);
    expect(result.candidate.risk.positionNotional).toBeLessThan(600);
    expect(result.candidate.risk.modeledMaxLoss).toBeGreaterThan(result.candidate.risk.riskBudget * 0.9);

    // The persisted row carries everything Milestone 2 needs without
    // recomputing a historical decision.
    expect(row.approval_status).toBe("PENDING");
    expect(row.classification).toBe("CANDIDATE");
    expect(row.planned_entry).toBeCloseTo(148.8);
    expect(row.minimum_allowed_entry).toBeLessThan(row.planned_entry!);
    expect(row.maximum_allowed_entry).toBeGreaterThan(row.planned_entry!);
    expect(row.stop_pct).toBeGreaterThan(0);
    expect(row.reference_price).toBeCloseTo(148.8);
    expect(row.reference_price_at).toBe(new Date(NOW).toISOString());
    expect(row.volatility_state).toBe("NORMAL");
    expect(row.rejection_reason ?? null).toBeNull();
    expect(row.risk_snapshot).toBeTruthy();
    expect(row.indicator_snapshot).toBeTruthy();
    expect(row.expires_at).toBeTruthy();
    expect(row.trading_mode).toBe("PAPER");
  });

  it("expires a candidate at the stricter of the candidate expiry and the approval window", () => {
    const { row } = runScan({ settings: settings({ candidateExpiryMinutes: 10, signalExpiryMinutes: 30 }) });
    expect(new Date(row.expires_at!).getTime()).toBe(NOW + 10 * 60_000);

    const tightWindow = runScan({ settings: settings({ candidateExpiryMinutes: 30, signalExpiryMinutes: 5 }) });
    expect(new Date(tightWindow.row.expires_at!).getTime()).toBe(NOW + 5 * 60_000);
  });

  it("a non-candidate classification never reaches the risk layer and stores no candidate snapshot", () => {
    const { evaluation, result, row } = runScan({ market: weakSetupMarket() });
    expect(evaluation.score.classification).not.toBe("CANDIDATE");
    expect(result).toBeUndefined();
    expect(row.approval_status).toBe("NOT_APPLICABLE");
    expect(row.risk_snapshot ?? null).toBeNull();
    expect(row.planned_entry ?? null).toBeNull();
    expect(row.rejection_reason ?? null).toBeNull();
    expect(row.expires_at ?? null).toBeNull();
  });

  it("no bullish regime means no signal at all - the existing gate is unchanged", () => {
    const flat = flatMarket();
    const evaluation = evaluateSignal(SYMBOL, flat.candles1h, flat.candles15m);
    expect(evaluation.kind).toBe("NO_SIGNAL");
    if (evaluation.kind === "NO_SIGNAL") expect(evaluation.reason).toBe("NO_BULLISH_REGIME");
  });
});

describe("scanner integration: owner risk settings actually drive sizing", () => {
  it("PERCENT_OF_EQUITY risk is read from settings", () => {
    const half = runScan({ settings: settings({ maxRiskPerTradePct: 0.005 }) });
    const double = runScan({ settings: settings({ maxRiskPerTradePct: 0.01 }) });
    if (half.result?.kind !== "CANDIDATE" || double.result?.kind !== "CANDIDATE") throw new Error("expected candidates");

    expect(half.result.candidate.risk.riskBudget).toBeCloseTo(5);
    expect(double.result.candidate.risk.riskBudget).toBeCloseTo(10);
    expect(double.result.candidate.risk.positionNotional).toBeGreaterThan(
      half.result.candidate.risk.positionNotional,
    );
  });

  it("FIXED_AMOUNT risk is read from settings and ignores the percentage", () => {
    const { result } = runScan({
      settings: settings({ riskMode: "FIXED_AMOUNT", fixedRiskAmount: 2, maxRiskPerTradePct: 0.05 }),
    });
    if (result?.kind !== "CANDIDATE") throw new Error("expected a candidate");
    expect(result.candidate.risk.riskMode).toBe("FIXED_AMOUNT");
    expect(result.candidate.risk.riskBudget).toBe(2);
    // $2 / ~1.008% stop distance ~= $198 notional.
    expect(result.candidate.risk.positionNotional).toBeGreaterThan(150);
    expect(result.candidate.risk.positionNotional).toBeLessThan(250);
  });

  it("available capital caps the position, reducing risk rather than increasing exposure", () => {
    const { result } = runScan({ account: account({ equity: 1000, availableBalance: 50 }) });
    if (result?.kind !== "CANDIDATE") throw new Error("expected a candidate");
    expect(result.candidate.risk.positionNotional).toBeLessThanOrEqual(50);
    expect(result.candidate.risk.estimatedActualRisk).toBeLessThan(result.candidate.risk.riskBudget);
  });

  it("fee and slippage assumptions from settings reach the modeled max loss", () => {
    const cheap = runScan({ settings: settings({ feeBps: 0, slippageBps: 0 }) });
    const costly = runScan({ settings: settings({ feeBps: 20, slippageBps: 10 }) });
    if (cheap.result?.kind !== "CANDIDATE" || costly.result?.kind !== "CANDIDATE") throw new Error("expected candidates");
    expect(costly.result.candidate.risk.modeledMaxLoss).toBeGreaterThan(
      cheap.result.candidate.risk.modeledMaxLoss,
    );
    expect(costly.result.candidate.risk.estimatedTargetProfit).toBeLessThan(
      cheap.result.candidate.risk.estimatedTargetProfit,
    );
  });

  it("exchange metadata is applied dynamically, never hardcoded", () => {
    const coarse = runScan({ instrument: { ...instrument, qtyStep: 1 } });
    if (coarse.result?.kind !== "CANDIDATE") throw new Error("expected a candidate");
    expect(Number.isInteger(coarse.result.candidate.risk.roundedQuantity)).toBe(true);

    // A venue with a higher minimum rejects the very same setup.
    const strict = runScan({ instrument: { ...instrument, minOrderAmt: 10_000 } });
    expect(strict.result?.kind).toBe("REJECTED");
    if (strict.result?.kind === "REJECTED") {
      expect(strict.result.rejection.reason).toBe("MIN_ORDER_RISK_CONFLICT");
    }
  });
});

describe("scanner integration: typed rejections persist precisely", () => {
  function expectRejection(result: ReturnType<typeof runScan>, reason: string) {
    expect(result.result?.kind).toBe("REJECTED");
    expect(result.row.approval_status).toBe("REJECTED");
    expect(result.row.rejection_reason).toBe(reason);
    expect(result.row.rejection_detail).toBeTruthy();
    // A rejected candidate is never persisted as actionable.
    expect(result.row.expires_at ?? null).toBeNull();
    expect(result.row.risk_snapshot ?? null).toBeNull();
  }

  it("MIN_ORDER_RISK_CONFLICT: a $5 account cannot risk-comply with a $5 exchange minimum", () => {
    // equity $5, 1% risk -> $0.05 budget, ~1.008% stop -> ~$4.96 notional,
    // below the $5 minimum. Rejected, never inflated.
    const result = runScan({
      account: account({ equity: 5, availableBalance: 5 }),
      settings: settings({ maxRiskPerTradePct: 0.01 }),
    });
    expectRejection(result, "MIN_ORDER_RISK_CONFLICT");
  });

  it("STALE_MARKET_DATA: the reference price is older than the configured freshness bound", () => {
    const result = runScan({
      marketDataTimestampMs: NOW - 10 * 60_000,
      settings: settings({ maxMarketDataAgeSeconds: 120 }),
    });
    expectRejection(result, "STALE_MARKET_DATA");
  });

  it("ENTRY_OUTSIDE_ALLOWED_RANGE: price ran away from the planned entry (no chasing)", () => {
    const result = runScan({ referencePrice: 152, settings: settings({ maxEntryDriftPct: 0.002 }) });
    expectRejection(result, "ENTRY_OUTSIDE_ALLOWED_RANGE");
  });

  it("EXCESSIVE_VOLATILITY: ATR above the owner's configured ceiling", () => {
    const result = runScan({ settings: settings({ maxAtrPct: 0.005 }) });
    expectRejection(result, "EXCESSIVE_VOLATILITY");
    expect(result.row.volatility_state).toBe("EXCESSIVE");
  });

  it("MIN_RISK_REWARD_NOT_MET: R/R below the owner's configured minimum", () => {
    const result = runScan({ settings: settings({ minRiskReward: 3 }) });
    expectRejection(result, "MIN_RISK_REWARD_NOT_MET");
  });

  it("SCORE_TOO_LOW: score below the owner's configured minimum", () => {
    const result = runScan({ settings: settings({ minCandidateScore: 100 }) });
    expectRejection(result, "SCORE_TOO_LOW");
  });

  it("STRATEGY_NOT_APPROVED: a DRAFT strategy version produces a typed rejection, not a silent skip", () => {
    const result = runScan({ strategyApproved: false });
    expectRejection(result, "STRATEGY_NOT_APPROVED");
  });

  it("OPEN_POSITION_LIMIT / DAILY_TRADE_LIMIT: existing account limits still gate the scanner path", () => {
    expectRejection(runScan({ account: account({ openPositionsCount: 1 }) }), "OPEN_POSITION_LIMIT");
    expectRejection(runScan({ account: account({ tradesOpenedTodayUtc: 2 }) }), "DAILY_TRADE_LIMIT");
    expectRejection(runScan({ account: account({ losingTradesTodayUtc: 2 }) }), "DAILY_LOSS_LOCK");
  });
});

describe("scanner integration: idempotency and LIVE", () => {
  it("a duplicate scan of the same closed candle does not produce a second candidate", () => {
    const first = runScan({});
    expect(first.result?.kind).toBe("CANDIDATE");

    const key = candidateKey({
      strategyVersionId: STRATEGY_VERSION_ID,
      symbol: SYMBOL,
      timeframe: STRATEGY_V1_PARAMS.entryTimeframe,
      candleTimeMs: first.evaluation.kind === "SIGNAL" ? first.evaluation.candleTime : 0,
    });

    const second = runScan({ existingActiveCandidateKeys: [key] });
    expect(second.result?.kind).toBe("REJECTED");
    if (second.result?.kind === "REJECTED") {
      expect(second.result.rejection.reason).toBe("DUPLICATE_CANDIDATE");
    }
  });

  it("the dedup key matches the signals table's unique constraint tuple - one dedup mechanism, not two", () => {
    const { evaluation } = runScan({});
    if (evaluation.kind !== "SIGNAL") throw new Error("expected a signal");
    const key = candidateKey({
      strategyVersionId: STRATEGY_VERSION_ID,
      symbol: SYMBOL,
      timeframe: STRATEGY_V1_PARAMS.entryTimeframe,
      candleTimeMs: evaluation.candleTime,
    });
    // unique (strategy_version_id, symbol, timeframe, candle_time)
    expect(key).toBe(`${STRATEGY_VERSION_ID}:${SYMBOL}:15M:${evaluation.candleTime}`);
  });

  it("LIVE is refused even if a LIVE trading mode somehow reaches the scanner", () => {
    const result = runScan({ settings: settings({ tradingMode: "LIVE" }) });
    expect(result.result?.kind).toBe("REJECTED");
    if (result.result?.kind === "REJECTED") {
      expect(result.result.rejection.reason).toBe("TRADING_MODE_BLOCK");
    }
  });

  it("a LIVE row from the database is coerced to OBSERVE rather than trusted", () => {
    const parsed = riskSettingsFromRow({ trading_mode: "LIVE", execution_policy: "AUTO" });
    expect(parsed.tradingMode).toBe("OBSERVE");
    // AUTO can never combine with a non-PAPER/DEMO mode.
    expect(parsed.executionPolicy).toBe("APPROVAL_REQUIRED");
  });
});

describe("owner risk settings: server-side validation and presets", () => {
  it("loads settings from a database row, coercing numeric strings", () => {
    const parsed = riskSettingsFromRow({
      trading_mode: "PAPER",
      risk_mode: "FIXED_AMOUNT",
      max_risk_per_trade_pct: "0.0200",
      fixed_risk_amount: "2.5000",
      min_candidate_score: 85,
      min_risk_reward: "2.00",
      execution_policy: "APPROVAL_REQUIRED",
    });
    expect(parsed.riskMode).toBe("FIXED_AMOUNT");
    expect(parsed.maxRiskPerTradePct).toBe(0.02);
    expect(parsed.fixedRiskAmount).toBe(2.5);
    expect(parsed.minRiskReward).toBe(2);
  });

  it("falls back to documented defaults for a missing row rather than guessing", () => {
    expect(riskSettingsFromRow(null)).toEqual(DEFAULT_RISK_SETTINGS);
  });

  it("rejects out-of-bounds values server-side, mirroring the database CHECK constraints", () => {
    expect(riskSettingsUpdateSchema.safeParse({ maxRiskPerTradePct: 0.5 }).success).toBe(false);
    expect(riskSettingsUpdateSchema.safeParse({ maxRiskPerTradePct: 0 }).success).toBe(false);
    expect(riskSettingsUpdateSchema.safeParse({ fixedRiskAmount: -1 }).success).toBe(false);
    expect(riskSettingsUpdateSchema.safeParse({ minCandidateScore: 101 }).success).toBe(false);
    expect(riskSettingsUpdateSchema.safeParse({ maxOpenPositions: 0 }).success).toBe(false);
    expect(riskSettingsUpdateSchema.safeParse({ candidateExpiryMinutes: 0 }).success).toBe(false);
    expect(riskSettingsUpdateSchema.safeParse({ maxAtrPct: 2 }).success).toBe(false);
    expect(riskSettingsUpdateSchema.safeParse({ executionPolicy: "LIVE_AUTO" }).success).toBe(false);
    expect(riskSettingsUpdateSchema.safeParse({ maxRiskPerTradePct: 0.02 }).success).toBe(true);
  });

  it("every preset passes the same validation as a manual edit - presets never bypass a bound", () => {
    for (const [name, preset] of Object.entries(RISK_PRESETS)) {
      const parsed = riskSettingsUpdateSchema.safeParse(preset);
      expect(parsed.success, `${name} must validate`).toBe(true);
    }
  });

  it("no preset is selected automatically, and none escalates risk for a small account", () => {
    // The conservative preset risks less than the growth one; nothing in the
    // codebase picks either based on account size or progress toward a goal.
    expect(RISK_PRESETS.CONSERVATIVE.maxRiskPerTradePct).toBeLessThan(
      RISK_PRESETS.GROWTH_EXPERIMENT.maxRiskPerTradePct,
    );
    expect(DEFAULT_RISK_SETTINGS.maxRiskPerTradePct).toBe(RISK_PRESETS.BALANCED.maxRiskPerTradePct);

    // A $20 account and a $2000 account get the same configured risk fraction.
    const small = runScan({ account: account({ equity: 20, availableBalance: 20 }), settings: settings({ maxRiskPerTradePct: 0.01 }) });
    const large = runScan({ account: account({ equity: 2000, availableBalance: 2000 }), settings: settings({ maxRiskPerTradePct: 0.01 }) });
    if (small.result?.kind !== "CANDIDATE" || large.result?.kind !== "CANDIDATE") throw new Error("expected candidates");
    expect(small.result.candidate.risk.riskBudget).toBeCloseTo(0.2);
    expect(large.result.candidate.risk.riskBudget).toBeCloseTo(20);
  });
});
