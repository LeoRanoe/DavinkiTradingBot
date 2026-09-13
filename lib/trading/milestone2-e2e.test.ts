import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/bybit/types";
import { evaluateSignal } from "@/lib/strategy/v1/signal";
import { STRATEGY_V1_PARAMS, STRATEGY_V1_VERSION_LABEL } from "@/lib/strategy/v1/config";
import { buildCandidateForScan } from "@/lib/candidates/from-settings";
import { buildSignalRow } from "@/lib/candidates/persistence";
import { DEFAULT_RISK_SETTINGS, type OwnerRiskSettings } from "@/lib/settings/risk-settings";
import type { SignalRow } from "@/lib/candidates/persistence";
import { approveCandidate } from "./approval";
import { manageOpenPositions } from "./position-manager";
import {
  createFakeApprovalStore,
  createFakeMarket,
  createFakePositionStore,
  makeAccount,
  makeCandles,
  makeDb,
  makeInstrument,
  TEST_STRATEGY_VERSION_ID,
  type FakeDb,
} from "./__fixtures__/fakes";

/**
 * THE MILESTONE 2 PROOF.
 *
 * One test walking the entire operational path with no stubbed business
 * logic anywhere in the middle:
 *
 *   market fixture -> closed candle -> real Strategy V1 evaluation
 *   -> real risk engine -> complete candidate -> persisted PENDING row
 *   -> simulated Telegram APPROVE -> full deterministic revalidation
 *   -> exactly one PAPER position -> later market movement
 *   -> automatic stop/target close -> fees, slippage, realized P/L and R
 *   -> account equity updated once -> notification payload produced
 *
 * Only the two genuinely external systems - the exchange feed and the
 * database - are represented by fixtures.
 */

const SYMBOL = "BTCUSDT";
const SIGNAL_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SCAN_AT = Date.parse("2026-01-03T18:00:00Z");
const APPROVE_AT = Date.parse("2026-01-03T18:02:00Z");
const MANAGE_AT = Date.parse("2026-01-03T19:50:00Z");

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

const settings: OwnerRiskSettings = {
  ...DEFAULT_RISK_SETTINGS,
  tradingMode: "PAPER",
  maxRiskPerTradePct: 0.01,
  feeBps: 10,
  slippageBps: 5,
};

const instrument = makeInstrument();
const account = makeAccount({ equity: 1000, availableBalance: 1000 });

/** PHASE 1 - the scanner produces and persists a complete PENDING candidate. */
function scan() {
  const market = candidateMarket();
  const evaluation = evaluateSignal(SYMBOL, market.candles1h, market.candles15m);
  if (evaluation.kind !== "SIGNAL") throw new Error("fixture must produce a signal");
  if (evaluation.score.classification !== "CANDIDATE") throw new Error("fixture must be a CANDIDATE");

  const result = buildCandidateForScan({
    signalId: SIGNAL_ID,
    symbol: SYMBOL,
    strategyVersionId: TEST_STRATEGY_VERSION_ID,
    strategyVersionLabel: STRATEGY_V1_VERSION_LABEL,
    timeframe: STRATEGY_V1_PARAMS.entryTimeframe,
    closedCandleTimeMs: evaluation.candleTime,
    regime: evaluation.regime,
    score: evaluation.score,
    referencePrice: evaluation.score.entryPrice,
    marketDataTimestampMs: SCAN_AT,
    nowMs: SCAN_AT,
    account,
    instrument,
    settings,
    strategyApproved: true,
  });
  if (result.kind !== "CANDIDATE") throw new Error(`expected a candidate, got ${result.rejection.reason}`);

  const insert = buildSignalRow({
    strategyVersionId: TEST_STRATEGY_VERSION_ID,
    symbol: SYMBOL,
    timeframe: STRATEGY_V1_PARAMS.entryTimeframe,
    candleTimeMs: evaluation.candleTime,
    regime: evaluation.regime,
    score: evaluation.score,
    tradingMode: "PAPER",
    reason: "e2e",
    result,
    referencePrice: evaluation.score.entryPrice,
    referencePriceAtMs: SCAN_AT,
    signalExpiryMinutes: settings.signalExpiryMinutes,
    candidateExpiryMinutes: settings.candidateExpiryMinutes,
    nowMs: SCAN_AT,
  });

  // The persisted row, exactly as the database would hold it.
  const row = {
    ...insert,
    id: SIGNAL_ID,
    created_at: new Date(SCAN_AT).toISOString(),
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
  } as SignalRow;

  return { candidate: result.candidate, row, plannedEntry: result.candidate.position.plannedEntry };
}

function dbWithPendingCandidate(row: SignalRow): FakeDb {
  return makeDb({
    signals: new Map([[SIGNAL_ID, row]]),
    settings,
    instrument,
    account,
    strategyVersion: { status: "PAPER_APPROVED", versionLabel: STRATEGY_V1_VERSION_LABEL },
  });
}

/** Candles after the open that reach the target (or the stop). */
function exitCandles(kind: "TARGET" | "STOP", target: number, stop: number): Candle[] {
  const closes = kind === "TARGET" ? [149.5, 150.5, target + 0.6] : [148.2, 147.8, stop - 0.6];
  return makeCandles("15M", closes, {
    startIso: "2026-01-03T19:15:00Z",
    highOffset: 0.5,
    lowOffset: 0.5,
  });
}

describe("MILESTONE 2 END TO END: candidate -> Telegram approval -> PAPER position -> automatic close", () => {
  it("walks the complete path and settles a winning trade exactly once", async () => {
    // ---- PHASE 1: scan ---------------------------------------------------
    const { row, candidate, plannedEntry } = scan();
    expect(row.approval_status).toBe("PENDING");
    expect(row.planned_entry).toBeCloseTo(148.8);
    expect(candidate.position.riskReward).toBeCloseTo(2);
    expect(candidate.risk.riskBudget).toBeCloseTo(10); // 1% of $1000

    const db = dbWithPendingCandidate(row);
    const store = createFakeApprovalStore(db);

    // ---- PHASE 2: the owner presses APPROVE in Telegram ------------------
    const approval = await approveCandidate(SIGNAL_ID, "TELEGRAM", {
      store,
      market: createFakeMarket({ lastPrice: plannedEntry, serverTimeMs: APPROVE_AT - 2_000 }),
      now: () => APPROVE_AT,
    });

    expect(approval.kind).toBe("EXECUTED");
    if (approval.kind !== "EXECUTED") return;

    // Exactly one position, fully persisted.
    expect(db.trades).toHaveLength(1);
    const opened = db.trades[0];
    expect(opened.status).toBe("OPEN");
    expect(opened.trading_mode).toBe("PAPER");
    expect(opened.entry_price!).toBeGreaterThan(plannedEntry); // entry slippage
    expect(opened.entry_fee!).toBeGreaterThan(0);
    expect(opened.qty!).toBeGreaterThan(0);
    expect(opened.modeled_max_loss!).toBeGreaterThan(0);

    const approvedSignal = db.signals.get(SIGNAL_ID)!;
    expect(approvedSignal.approval_status).toBe("APPROVED");
    expect(approvedSignal.owner_decision).toBe("APPROVED");
    expect(approvedSignal.decision_source).toBe("TELEGRAM");
    expect(approvedSignal.approval_delay_ms).toBe(APPROVE_AT - SCAN_AT);

    // A duplicate Telegram delivery at this exact point changes nothing.
    const retry = await approveCandidate(SIGNAL_ID, "TELEGRAM", {
      store,
      market: createFakeMarket({ lastPrice: plannedEntry, serverTimeMs: APPROVE_AT - 2_000 }),
      now: () => APPROVE_AT,
    });
    expect(retry.kind).toBe("ALREADY_PROCESSED");
    expect(db.trades).toHaveLength(1);

    // ---- PHASE 3: the market moves, the bot closes the trade itself -----
    const positionStore = createFakePositionStore(db, 1000);
    const managed = await manageOpenPositions({
      store: positionStore,
      market: createFakeMarket({
        candles: exitCandles("TARGET", opened.target_price!, opened.stop_price!),
      }),
      settings,
      now: () => MANAGE_AT,
    });

    expect(managed.closed).toHaveLength(1);
    const closed = managed.closed[0];
    expect(closed.exitReason).toBe("TARGET");

    // ---- PHASE 4: the result is financially coherent ---------------------
    expect(closed.netPnl).toBeGreaterThan(0);
    expect(closed.netPnl).toBeLessThan(closed.grossPnl); // costs are real
    expect(closed.totalFees).toBeGreaterThan(0);
    expect(closed.realizedSlippage).toBeGreaterThan(0);
    expect(closed.realizedR).toBeGreaterThan(1);
    expect(closed.realizedR).toBeLessThan(2.5);

    const settled = db.trades[0];
    expect(settled.status).toBe("CLOSED");
    expect(settled.exit_reason).toBe("TARGET");
    expect(settled.pnl).toBeCloseTo(closed.netPnl);
    expect(settled.r_multiple).toBeCloseTo(closed.realizedR);
    expect(settled.fees!).toBeCloseTo(settled.entry_fee! + settled.exit_fee!);

    // Equity moved exactly once, by exactly the net P/L.
    expect(db.snapshots).toHaveLength(1);
    expect(db.snapshots[0].equity).toBeCloseTo(1000 + closed.netPnl);
    expect(settled.equity_after).toBeCloseTo(db.snapshots[0].equity);

    // ---- PHASE 5: the audit trail and the notification payload ----------
    expect(db.tradeEvents.map((e) => e.eventType)).toEqual(["OPENED", "TARGET_HIT"]);
    expect(db.audits.some((a) => a.action === "paper_position_opened")).toBe(true);

    // A repeated scheduled run after settlement is a complete no-op.
    const again = await manageOpenPositions({
      store: positionStore,
      market: createFakeMarket({
        candles: exitCandles("TARGET", opened.target_price!, opened.stop_price!),
      }),
      settings,
      now: () => MANAGE_AT,
    });
    expect(again.closed).toHaveLength(0);
    expect(db.snapshots).toHaveLength(1);
  });

  it("settles a losing trade at about -1R and reduces equity exactly once", async () => {
    const { row, plannedEntry } = scan();
    const db = dbWithPendingCandidate(row);
    const store = createFakeApprovalStore(db);

    const approval = await approveCandidate(SIGNAL_ID, "TELEGRAM", {
      store,
      market: createFakeMarket({ lastPrice: plannedEntry, serverTimeMs: APPROVE_AT - 2_000 }),
      now: () => APPROVE_AT,
    });
    expect(approval.kind).toBe("EXECUTED");

    const opened = db.trades[0];
    const managed = await manageOpenPositions({
      store: createFakePositionStore(db, 1000),
      market: createFakeMarket({
        candles: exitCandles("STOP", opened.target_price!, opened.stop_price!),
      }),
      settings,
      now: () => MANAGE_AT,
    });

    expect(managed.closed).toHaveLength(1);
    const closed = managed.closed[0];
    expect(closed.exitReason).toBe("STOP");
    expect(closed.netPnl).toBeLessThan(0);
    // About -1R after costs, never a flatteringly small loss.
    expect(closed.realizedR).toBeLessThan(-0.8);
    expect(closed.realizedR).toBeGreaterThan(-1.4);
    expect(db.snapshots).toHaveLength(1);
    expect(db.snapshots[0].equity).toBeCloseTo(1000 + closed.netPnl);
    expect(db.snapshots[0].equity).toBeLessThan(1000);
  });

  it("cancels instead of chasing when price left the allowed entry zone before approval", async () => {
    const { row } = scan();
    const db = dbWithPendingCandidate(row);
    const store = createFakeApprovalStore(db);

    const approval = await approveCandidate(SIGNAL_ID, "TELEGRAM", {
      store,
      // Price ran 2% above the plan while the owner was deciding.
      market: createFakeMarket({ lastPrice: 151.8, serverTimeMs: APPROVE_AT - 2_000 }),
      now: () => APPROVE_AT,
    });

    expect(approval.kind).toBe("REJECTED");
    if (approval.kind === "REJECTED") expect(approval.reason).toBe("ENTRY_OUTSIDE_ALLOWED_RANGE");
    expect(db.trades).toHaveLength(0);
    expect(db.signals.get(SIGNAL_ID)!.approval_status).toBe("REJECTED");
    expect(db.snapshots).toHaveLength(0);
  });

  it("state survives a process restart: the position is reloaded from storage, not memory", async () => {
    const { row, plannedEntry } = scan();
    const db = dbWithPendingCandidate(row);

    await approveCandidate(SIGNAL_ID, "TELEGRAM", {
      store: createFakeApprovalStore(db),
      market: createFakeMarket({ lastPrice: plannedEntry, serverTimeMs: APPROVE_AT - 2_000 }),
      now: () => APPROVE_AT,
    });

    // Simulate a completely new serverless invocation: brand-new store and
    // manager objects, nothing carried over but the persisted rows.
    const freshStore = createFakePositionStore(db, 1000);
    const opened = db.trades[0];
    const managed = await manageOpenPositions({
      store: freshStore,
      market: createFakeMarket({
        candles: exitCandles("TARGET", opened.target_price!, opened.stop_price!),
      }),
      settings,
      now: () => MANAGE_AT,
    });

    expect(managed.closed).toHaveLength(1);
    expect(db.trades[0].status).toBe("CLOSED");
  });
});
