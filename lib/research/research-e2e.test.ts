import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/bybit/types";
import { evaluateSignal } from "@/lib/strategy/v1/signal";
import { STRATEGY_V1_PARAMS, STRATEGY_V1_VERSION_LABEL } from "@/lib/strategy/v1/config";
import { buildCandidateForScan } from "@/lib/candidates/from-settings";
import { buildSignalRow, type SignalRow } from "@/lib/candidates/persistence";
import { DEFAULT_RISK_SETTINGS, type OwnerRiskSettings } from "@/lib/settings/risk-settings";
import { approveCandidate } from "@/lib/trading/approval";
import { manageOpenPositions } from "@/lib/trading/position-manager";
import {
  createFakeApprovalStore,
  createFakeMarket,
  createFakePositionStore,
  makeAccount,
  makeCandles,
  makeDb,
  makeInstrument,
  makeResearchWindow,
  TEST_STRATEGY_VERSION_ID,
  type FakeDb,
} from "@/lib/trading/__fixtures__/fakes";
import { isStrategyEligibleForPaper } from "./eligibility";
import { effectiveExecutionPolicy } from "./policy";
import { buildResearchReport } from "./report";
import { DAY_MS, formatResearchDay, needsExpiryReconciliation } from "./window";
import { calculateLongExcursions } from "@/lib/learning/outcomes";
import type { LearningTrade } from "@/lib/learning/types";

/**
 * THE 14-DAY AUTOMATIC PAPER RESEARCH PROOF.
 *
 * One test walking the whole thing with no stubbed business logic in the
 * middle - real Strategy V1, real risk engine, real candidate builder, real
 * approval/revalidation engine, real position manager, real analytics:
 *
 *   Strategy V1 DRAFT + active research window + execution policy AUTO
 *   -> deterministic candidate off a closed candle
 *   -> persisted candidate
 *   -> AUTOMATIC revalidation through the same engine APPROVE uses
 *   -> exactly one PAPER position, with NO approval ever requested
 *   -> market reaches target
 *   -> automatic close, equity updated once, MFE/MAE recorded
 *   -> learning/analytics see it as an ACTUAL outcome
 *
 * then the clock advances past day 14:
 *
 *   -> the window is due for expiry
 *   -> effective policy falls back to APPROVAL_REQUIRED
 *   -> the next valid candidate does NOT execute automatically
 *   -> the owner gets the normal approval flow, which still works
 *
 * Only the exchange feed and the database are fixtures.
 */

const SYMBOL = "BTCUSDT";
const SIGNAL_ID = "cccccccc-dddd-4eee-8fff-000000000001";
const LATER_SIGNAL_ID = "cccccccc-dddd-4eee-8fff-000000000002";

const RESEARCH_START = Date.parse("2026-01-01T00:00:00Z");
const RESEARCH_END = RESEARCH_START + 14 * DAY_MS;

/** Day 3 of the window - comfortably inside it. */
const SCAN_AT = Date.parse("2026-01-03T18:00:00Z");
const EXECUTE_AT = Date.parse("2026-01-03T18:02:00Z");
const MANAGE_AT = Date.parse("2026-01-03T19:50:00Z");
/**
 * A candidate created legitimately 5 minutes BEFORE the window closes, and an
 * execution attempt 1 minute AFTER it closes. The candidate is still within
 * its own 10-minute expiry at that point, so this isolates the research
 * window as the thing that stops execution - not candidate staleness.
 */
const LATE_SCAN_AT = RESEARCH_END - 5 * 60_000;
const AFTER_EXPIRY = RESEARCH_END + 60_000;

const settings: OwnerRiskSettings = {
  ...DEFAULT_RISK_SETTINGS,
  tradingMode: "PAPER",
  executionPolicy: "AUTO",
  maxRiskPerTradePct: 0.01,
  feeBps: 10,
  slippageBps: 5,
};

const instrument = makeInstrument();
const account = makeAccount({ equity: 1000, availableBalance: 1000 });

const researchWindow = makeResearchWindow({
  startedAt: new Date(RESEARCH_START).toISOString(),
  endsAt: new Date(RESEARCH_END).toISOString(),
  startingEquity: 20,
  targetEquity: 50,
});

/** A market fixture that produces a genuine Strategy V1 CANDIDATE. */
function candidateMarket(): { candles1h: Candle[]; candles15m: Candle[] } {
  const n = 260;
  const closes15m: number[] = [];
  for (let i = 0; i < n; i++) closes15m.push(100 + i * 0.2);
  for (let k = 0; k < 5; k++) closes15m[n - 5 + k] -= 3 * ((k + 1) / 5);
  const volumes15m = closes15m.map((_, i) => (i >= n - 2 ? 140 : 100));
  const closes1h = Array.from({ length: n }, (_, i) => 100 + i * 0.2);
  return {
    candles1h: makeCandles("1H", closes1h, { volumes: closes1h.map(() => 100) }),
    candles15m: makeCandles("15M", closes15m, { volumes: volumes15m }),
  };
}

/**
 * The scanner's real work: evaluate a closed candle, run the deterministic
 * candidate pipeline, and produce the row that would be persisted. Strategy
 * eligibility is decided by the SHARED helper, exactly as the scanner does.
 */
function scan(signalId: string, nowMs: number) {
  const market = candidateMarket();
  const evaluation = evaluateSignal(SYMBOL, market.candles1h, market.candles15m);
  if (evaluation.kind !== "SIGNAL") throw new Error("fixture must produce a signal");
  if (evaluation.score.classification !== "CANDIDATE") throw new Error("fixture must be a CANDIDATE");

  const eligibility = isStrategyEligibleForPaper({
    strategyStatus: "DRAFT",
    tradingMode: settings.tradingMode,
    researchWindow,
    now: nowMs,
  });

  const result = buildCandidateForScan({
    signalId,
    symbol: SYMBOL,
    strategyVersionId: TEST_STRATEGY_VERSION_ID,
    strategyVersionLabel: STRATEGY_V1_VERSION_LABEL,
    timeframe: STRATEGY_V1_PARAMS.entryTimeframe,
    closedCandleTimeMs: evaluation.candleTime,
    regime: evaluation.regime,
    score: evaluation.score,
    referencePrice: evaluation.score.entryPrice,
    marketDataTimestampMs: nowMs,
    nowMs,
    account,
    instrument,
    settings,
    strategyApproved: eligibility.eligible,
  });

  const insert = buildSignalRow({
    strategyVersionId: TEST_STRATEGY_VERSION_ID,
    symbol: SYMBOL,
    timeframe: STRATEGY_V1_PARAMS.entryTimeframe,
    candleTimeMs: evaluation.candleTime,
    regime: evaluation.regime,
    score: evaluation.score,
    tradingMode: "PAPER",
    reason: "research-e2e",
    result,
    referencePrice: evaluation.score.entryPrice,
    referencePriceAtMs: nowMs,
    signalExpiryMinutes: settings.signalExpiryMinutes,
    candidateExpiryMinutes: settings.candidateExpiryMinutes,
    nowMs,
  });

  const row = {
    ...insert,
    id: signalId,
    created_at: new Date(nowMs).toISOString(),
    approved_at: null,
    ai_explanation: null,
    owner_decision: null,
    decision_at: null,
    decision_source: null,
    approval_delay_ms: null,
    processed_at: null,
    rejection_reason: insert.rejection_reason ?? null,
    rejection_detail: insert.rejection_detail ?? null,
    planned_entry: insert.planned_entry ?? null,
    minimum_allowed_entry: insert.minimum_allowed_entry ?? null,
    maximum_allowed_entry: insert.maximum_allowed_entry ?? null,
    stop_pct: insert.stop_pct ?? null,
    reference_price: insert.reference_price ?? null,
    reference_price_at: insert.reference_price_at ?? null,
    volatility_state: insert.volatility_state ?? null,
    risk_snapshot: insert.risk_snapshot ?? null,
    indicator_snapshot: insert.indicator_snapshot ?? null,
    trading_mode: insert.trading_mode ?? null,
    news_risk: null,
    news_snapshot: null,
    research_session_id: null,
  } as SignalRow;

  return { result, row, eligibility };
}

function dbWith(row: SignalRow, overrides: Partial<FakeDb> = {}): FakeDb {
  return makeDb({
    signals: new Map([[row.id, row]]),
    settings,
    instrument,
    account,
    // DRAFT throughout. Nothing in this test ever promotes it.
    strategyVersion: { status: "DRAFT", versionLabel: STRATEGY_V1_VERSION_LABEL },
    researchWindow,
    ...overrides,
  });
}

/** Candles after the open that run up through the target. */
function targetCandles(target: number): Candle[] {
  return makeCandles("15M", [149.5, 150.5, target + 0.6], {
    startIso: "2026-01-03T19:15:00Z",
    highOffset: 0.5,
    lowOffset: 0.5,
  });
}

describe("14-DAY AUTOMATIC PAPER RESEARCH - end to end", () => {
  it("executes automatically inside the window, settles, and stops automatically after day 14", async () => {
    // ================= PHASE 1: inside the research window ================
    expect(formatResearchDay(researchWindow, SCAN_AT)).toBe("Day 3 of 14");

    // A DRAFT strategy is eligible, and ONLY on the research basis.
    const { result, row, eligibility } = scan(SIGNAL_ID, SCAN_AT);
    expect(eligibility.eligible).toBe(true);
    expect(eligibility.basis).toBe("PAPER_RESEARCH");

    expect(result.kind).toBe("CANDIDATE");
    if (result.kind !== "CANDIDATE") return;
    expect(row.approval_status).toBe("PENDING");

    const { candidate } = result;
    const plannedEntry = candidate.position.plannedEntry;

    // AUTO is genuinely in force at scan time.
    const policy = effectiveExecutionPolicy({
      configuredPolicy: settings.executionPolicy,
      tradingMode: settings.tradingMode,
      researchWindow,
      now: SCAN_AT,
    });
    expect(policy.policy).toBe("AUTO");

    // ---- PHASE 2: automatic execution, no approval requested -------------
    const db = dbWith(row);
    const store = createFakeApprovalStore(db);

    const executed = await approveCandidate(SIGNAL_ID, "AUTO", {
      store,
      market: createFakeMarket({ lastPrice: plannedEntry, serverTimeMs: EXECUTE_AT - 2_000 }),
      now: () => EXECUTE_AT,
    });

    expect(executed.kind).toBe("EXECUTED");
    if (executed.kind !== "EXECUTED") return;

    // EXACTLY one position.
    expect(db.trades).toHaveLength(1);
    const opened = db.trades[0];
    expect(opened.status).toBe("OPEN");
    expect(opened.trading_mode).toBe("PAPER");
    expect(opened.entry_price!).toBeGreaterThan(plannedEntry); // slippage against us
    expect(opened.entry_fee!).toBeGreaterThan(0);
    expect(opened.research_session_id).toBe(researchWindow.id);

    // Attributed accurately: a policy authorized it, not a person.
    const executedSignal = db.signals.get(SIGNAL_ID)!;
    expect(executedSignal.approval_status).toBe("APPROVED");
    expect(executedSignal.decision_source).toBe("AUTO");
    expect(executedSignal.owner_decision).toBeNull();
    expect(db.audits.map((a) => a.action)).toContain("paper_auto_execution");

    // A duplicate scan at this exact point opens nothing further.
    const duplicate = await approveCandidate(SIGNAL_ID, "AUTO", {
      store,
      market: createFakeMarket({ lastPrice: plannedEntry, serverTimeMs: EXECUTE_AT - 2_000 }),
      now: () => EXECUTE_AT,
    });
    expect(duplicate.kind).toBe("ALREADY_PROCESSED");
    expect(db.trades).toHaveLength(1);

    // ---- PHASE 3: the market reaches target; automatic close -------------
    const target = opened.target_price!;
    const positionStore = createFakePositionStore(db);
    const managed = await manageOpenPositions({
      store: positionStore,
      market: createFakeMarket({ candles: targetCandles(target), serverTimeMs: MANAGE_AT }),
      settings,
      now: () => MANAGE_AT,
    });

    expect(managed.closed).toHaveLength(1);
    const closed = managed.closed[0];
    expect(closed.exitReason).toBe("TARGET");
    expect(closed.netPnl).toBeGreaterThan(0);

    // The close carries the research tag, so it is reported as an AUTO result.
    expect(closed.researchSessionId).toBe(researchWindow.id);

    // Settled exactly once, in the database.
    const settled = db.trades[0];
    expect(settled.status).toBe("CLOSED");
    expect(settled.pnl).not.toBeNull();
    expect(settled.r_multiple).not.toBeNull();

    // MFE/MAE captured.
    expect(closed.mfeR ?? 0).toBeGreaterThan(0);
    expect(settled.mfe_price).not.toBeNull();
    expect(settled.mae_price).not.toBeNull();

    // Equity moved ONCE, by exactly the realized net P/L.
    expect(db.snapshots).toHaveLength(1);
    expect(db.snapshots[0].equity).toBeCloseTo(closed.equityBefore + closed.netPnl, 8);
    expect(closed.equityAfter).toBeCloseTo(db.snapshots[0].equity, 8);

    // A repeated management pass cannot double-settle or double-count equity.
    const again = await manageOpenPositions({
      store: positionStore,
      market: createFakeMarket({ candles: targetCandles(target), serverTimeMs: MANAGE_AT }),
      settings,
      now: () => MANAGE_AT,
    });
    expect(again.closed).toHaveLength(0);
    expect(db.snapshots).toHaveLength(1);

    // ---- PHASE 4: it counts as ACTUAL research evidence ------------------
    const learningTrade: LearningTrade = {
      id: settled.id,
      actual: true,
      symbol: settled.symbol,
      strategyVersion: STRATEGY_V1_VERSION_LABEL,
      score: row.score,
      regime: row.regime,
      newsRisk: "UNKNOWN",
      openedAt: Date.parse(settled.opened_at!),
      closedAt: Date.parse(settled.closed_at!),
      pnl: settled.pnl,
      fees: settled.fees ?? 0,
      slippage: settled.slippage ?? 0,
      rMultiple: settled.r_multiple,
      excursions: {
        mfePrice: settled.mfe_price ?? 0,
        maePrice: settled.mae_price ?? 0,
        mfePct: 0,
        maePct: 0,
        mfeR: settled.mfe_r,
        maeR: settled.mae_r,
      },
    };

    const report = buildResearchReport({
      window: researchWindow,
      trades: [learningTrade],
      funnel: { candidates: 1, riskValidCandidates: 1, executed: 1, executedAutomatically: 1 },
      endingEquity: db.snapshots[0].equity,
    });

    expect(report.overall.sampleCount).toBe(1);
    expect(report.overall.wins).toBe(1);
    expect(report.funnel.executedAutomatically).toBe(1);
    // One trade proves nothing, and the report says so plainly.
    expect(report.recommendation).toBe("KEEP_DRAFT");
    expect(report.evidenceStatement).toContain("Insufficient evidence");

    // ================= PHASE 5: past day 14 ===============================
    // The window is now due for reconciliation, and is already treated as
    // closed by every decision below - no write was needed for that.
    expect(needsExpiryReconciliation(researchWindow, AFTER_EXPIRY)).toBe(true);

    const laterPolicy = effectiveExecutionPolicy({
      configuredPolicy: "AUTO", // the column still says AUTO
      tradingMode: "PAPER",
      researchWindow,
      now: AFTER_EXPIRY,
    });
    expect(laterPolicy.policy).toBe("APPROVAL_REQUIRED");
    expect(laterPolicy.degraded).toBe(true);

    // The DRAFT strategy is no longer executable.
    const laterEligibility = isStrategyEligibleForPaper({
      strategyStatus: "DRAFT",
      tradingMode: "PAPER",
      researchWindow,
      now: AFTER_EXPIRY,
    });
    expect(laterEligibility.eligible).toBe(false);

    // ---- PHASE 6: the next valid candidate does NOT auto-execute ---------
    // Created while the window was still open, so it is a genuine PENDING
    // candidate and is NOT yet expired in its own right.
    const later = scan(LATER_SIGNAL_ID, LATE_SCAN_AT);
    expect(later.eligibility.eligible).toBe(true);
    expect(later.row.approval_status).toBe("PENDING");

    const laterDb = dbWith(later.row);
    const laterStore = createFakeApprovalStore(laterDb);

    const laterAuto = await approveCandidate(LATER_SIGNAL_ID, "AUTO", {
      store: laterStore,
      market: createFakeMarket({ lastPrice: plannedEntry, serverTimeMs: AFTER_EXPIRY - 2_000 }),
      now: () => AFTER_EXPIRY,
    });

    expect(laterAuto.kind).toBe("REJECTED");
    expect(laterDb.trades).toHaveLength(0);

    // ---- PHASE 7: the owner approval flow still works --------------------
    // With the window closed, a DRAFT strategy is not executable by ANY
    // route - including the owner's. That is the point of the expiry: DRAFT
    // becomes non-executable again unless the owner changes its status.
    const freshRow = { ...later.row, approval_status: "PENDING" } as SignalRow;
    const approvalDb = dbWith(freshRow);
    const approvalStore = createFakeApprovalStore(approvalDb);

    const ownerAttempt = await approveCandidate(LATER_SIGNAL_ID, "TELEGRAM", {
      store: approvalStore,
      market: createFakeMarket({ lastPrice: plannedEntry, serverTimeMs: AFTER_EXPIRY - 2_000 }),
      now: () => AFTER_EXPIRY,
    });
    expect(ownerAttempt.kind).toBe("REJECTED");
    if (ownerAttempt.kind !== "REJECTED") return;
    expect(ownerAttempt.reason).toBe("STRATEGY_NOT_APPROVED");

    // And once the owner formally promotes the strategy, the ordinary
    // approval flow executes again - with no research window involved.
    const promotedRow = { ...later.row, approval_status: "PENDING" } as SignalRow;
    const promotedDb = dbWith(promotedRow, {
      strategyVersion: { status: "PAPER_APPROVED", versionLabel: STRATEGY_V1_VERSION_LABEL },
      researchWindow: null,
    });
    const promotedStore = createFakeApprovalStore(promotedDb);

    const promotedApproval = await approveCandidate(LATER_SIGNAL_ID, "TELEGRAM", {
      store: promotedStore,
      market: createFakeMarket({ lastPrice: plannedEntry, serverTimeMs: AFTER_EXPIRY - 2_000 }),
      now: () => AFTER_EXPIRY,
    });

    expect(promotedApproval.kind).toBe("EXECUTED");
    expect(promotedDb.trades).toHaveLength(1);
    expect(promotedDb.signals.get(LATER_SIGNAL_ID)!.owner_decision).toBe("APPROVED");
    // Not research evidence: no window authorized it.
    expect(promotedDb.trades[0].research_session_id).toBeNull();
  });

  it("never opens a LIVE position at any point in the research flow", async () => {
    const { row } = scan(SIGNAL_ID, SCAN_AT);
    const db = dbWith(row, {
      settings: { ...settings, tradingMode: "LIVE" as never },
    });

    const result = await approveCandidate(SIGNAL_ID, "AUTO", {
      store: createFakeApprovalStore(db),
      market: createFakeMarket({ serverTimeMs: EXECUTE_AT - 2_000 }),
      now: () => EXECUTE_AT,
    });

    expect(result.kind).toBe("REJECTED");
    if (result.kind !== "REJECTED") return;
    expect(result.reason).toBe("TRADING_MODE_BLOCK");
    expect(db.trades).toHaveLength(0);
  });

  it("measures excursions from real candles rather than assuming them", () => {
    // Guards the MFE/MAE the research period depends on for its excursion
    // questions: they come from candle highs/lows, not from the exit price.
    const candles = makeCandles("15M", [100, 103, 99], {
      startIso: "2026-01-03T19:15:00Z",
      highOffset: 1,
      lowOffset: 1,
    });
    const excursions = calculateLongExcursions(100, 98, candles);

    expect(excursions.mfePrice).toBeGreaterThan(0);
    expect(excursions.maePrice).toBeGreaterThan(0);
    expect(excursions.mfeR).not.toBeNull();
  });
});
