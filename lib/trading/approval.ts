import type { Candle } from "@/lib/bybit/types";
import { latestAtr } from "@/lib/indicators/atr";
import type { AccountState, InstrumentRules, RejectionReason } from "@/lib/risk/types";
import type { TradingMode } from "@/lib/types/trading-mode";
import type { OwnerRiskSettings } from "@/lib/settings/risk-settings";
import { toCostModel } from "@/lib/settings/risk-settings";
import { buildCandidateForScan } from "@/lib/candidates/from-settings";
import { reconstructScoreResult, type SignalRow } from "@/lib/candidates/persistence";
import type { TradeCandidate } from "@/lib/candidates/types";
import type { Database } from "@/lib/supabase/database.types";
import { isStrategyEligibleForPaper } from "@/lib/research/eligibility";
import { isResearchWindowActive, type ResearchWindow } from "@/lib/research/window";
import { computeOpenFill } from "./settlement";

/**
 * Where the authorization to execute came from.
 *
 * TELEGRAM / DASHBOARD - the owner individually approved this candidate.
 * AUTO                 - an active PAPER research window authorized it under
 *                        the owner's configured AUTO policy. Deliberately NOT
 *                        called "owner approved": the owner enabled a policy,
 *                        they did not decide this trade. `owner_decision` is
 *                        left NULL for AUTO so the two can never be conflated
 *                        in analysis.
 *
 * AUTO is ONLY an authorization source. It is not a faster path, not a
 * reduced-checks path, and not a second engine: every source below runs this
 * one function and therefore the identical revalidation pipeline.
 */
export type ApprovalSource = "TELEGRAM" | "DASHBOARD" | "AUTO";

/** True when the source is a policy rather than an individual owner decision. */
export function isAutomatedSource(source: ApprovalSource): boolean {
  return source === "AUTO";
}

export type ApprovalResult =
  | { kind: "EXECUTED"; tradeId: string; candidate: TradeCandidate }
  | { kind: "REJECTED"; reason: RejectionReason; detail: string }
  | { kind: "ALREADY_PROCESSED"; state: string }
  | { kind: "NOT_FOUND" };

export type RejectionResult =
  | { kind: "REJECTED_BY_OWNER"; symbol: string }
  | { kind: "ALREADY_PROCESSED"; state: string }
  | { kind: "NOT_FOUND" };

export type TradeInsert = Database["public"]["Tables"]["trades"]["Insert"];

export type InsertTradeResult =
  | { ok: true; tradeId: string }
  | { ok: false; duplicate: boolean; message: string };

/**
 * The database operations the approval flow needs, as a port. The Supabase
 * adapter lives in `approval-store.ts`; tests drive an in-memory fake, which
 * is how concurrency, idempotency and every revalidation branch are proven
 * deterministically.
 *
 * `claim` MUST be an atomic compare-and-set (PENDING -> OPENING). Everything
 * else in this flow depends on exactly one caller winning that transition.
 */
export interface ApprovalStore {
  claim(signalId: string, nowIso: string): Promise<SignalRow | null>;
  currentStatus(signalId: string): Promise<string | null>;
  finalizeRejection(args: {
    signalId: string;
    status: "REJECTED" | "EXPIRED" | "ERROR";
    reason: RejectionReason;
    detail: string;
    nowIso: string;
  }): Promise<void>;
  finalizeApproval(args: {
    signalId: string;
    source: ApprovalSource;
    nowIso: string;
    approvalDelayMs: number;
  }): Promise<void>;
  recordOwnerRejection(args: {
    signalId: string;
    source: ApprovalSource;
    nowIso: string;
  }): Promise<{ ok: true; symbol: string } | { ok: false; state: string | null }>;
  insertTrade(row: TradeInsert): Promise<InsertTradeResult>;
  insertTradeEvent(tradeId: string, eventType: string, payload: Record<string, unknown>): Promise<void>;
  loadSettings(): Promise<OwnerRiskSettings>;
  /**
   * The current PAPER research window, or null when none exists. Read on
   * every execution rather than passed in, so the executor decides strategy
   * eligibility from persisted server state at the moment of execution - a
   * window that closed between candidate creation and approval must block the
   * trade, not be remembered as open.
   */
  loadResearchWindow(): Promise<ResearchWindow | null>;
  loadStrategyVersion(strategyVersionId: string): Promise<{ status: string; versionLabel: string } | null>;
  loadInstrument(symbol: string): Promise<InstrumentRules | null>;
  loadAccount(mode: TradingMode): Promise<AccountState>;
  audit(actor: string, action: string, metadata: Record<string, unknown>): Promise<void>;
}

export interface MarketDataPort {
  ticker(symbol: string): Promise<{ lastPrice: number; serverTimeMs: number }>;
  candles(symbol: string, timeframe: "15M" | "1H", limit: number): Promise<Candle[]>;
}

export type ApprovalDeps = {
  store: ApprovalStore;
  market: MarketDataPort;
  now?: () => number;
};

/**
 * APPROVE means "re-evaluate this candidate now and execute only if it is
 * still valid" - never "open the stored proposal".
 *
 * Order matters and is deliberate:
 *  1. ATOMIC claim (PENDING -> OPENING). A double-tap, a webhook retry, a
 *     Vercel retry or two concurrent invocations: exactly one proceeds, the
 *     rest get ALREADY_PROCESSED.
 *  2. Expiry, trading mode, and execution eligibility.
 *  3. FRESH market data (ticker + candles). Any failure here rejects - we
 *     fail closed on financial uncertainty rather than trading blind.
 *  4. The full Milestone 1 deterministic pipeline re-run against current
 *     price, current ATR, current settings, current account and current
 *     exchange rules. The stored trade plan (stop/target/planned entry) is
 *     NOT recomputed - a genuinely new setup must become a new candidate,
 *     never a chased version of this one.
 *  5. The trade insert, protected by a unique index on signal_id, so one
 *     candidate can produce at most one position even if step 1 were ever
 *     bypassed.
 */
export async function approveCandidate(
  signalId: string,
  source: ApprovalSource,
  deps: ApprovalDeps,
): Promise<ApprovalResult> {
  const nowMs = deps.now?.() ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const { store, market } = deps;

  const claimed = await store.claim(signalId, nowIso);
  if (!claimed) {
    const state = await store.currentStatus(signalId);
    if (state === null) return { kind: "NOT_FOUND" };
    return { kind: "ALREADY_PROCESSED", state };
  }

  const reject = async (
    reason: RejectionReason,
    detail: string,
    status: "REJECTED" | "EXPIRED" | "ERROR" = "REJECTED",
  ): Promise<ApprovalResult> => {
    await store.finalizeRejection({ signalId, status, reason, detail, nowIso });
    await store.audit(source.toLowerCase(), "candidate_execution_rejected", { signalId, reason });
    return { kind: "REJECTED", reason, detail };
  };

  // --- Expiry -------------------------------------------------------------
  const expiresAtMs = claimed.expires_at ? new Date(claimed.expires_at).getTime() : null;
  if (expiresAtMs !== null && nowMs > expiresAtMs) {
    return reject(
      "CANDIDATE_EXPIRED",
      "This candidate expired before it was approved. An old candidate price is never executable later.",
      "EXPIRED",
    );
  }

  const settings = await store.loadSettings();

  // --- Trading mode -------------------------------------------------------
  // Only PAPER executes in this build. OBSERVE records but never trades, and
  // Bybit Demo execution is not implemented. LIVE is refused here, in the
  // risk engine, and by database constraints.
  if (settings.tradingMode !== "PAPER") {
    const detail =
      settings.tradingMode === "OBSERVE"
        ? "The system is in OBSERVE mode; candidates are recorded but no position is opened."
        : settings.tradingMode === "DEMO"
          ? "Bybit Demo execution is not implemented in this build."
          : "LIVE trading is disabled in this build.";
    return reject("TRADING_MODE_BLOCK", detail);
  }

  const strategyVersion = await store.loadStrategyVersion(claimed.strategy_version_id);

  // Strategy eligibility comes from ONE helper, shared with the scanner, so
  // the two can never disagree about whether this strategy may execute. A
  // DRAFT strategy passes only while a PAPER research window is genuinely
  // open right now - re-read here rather than trusted from candidate time, so
  // a window that closed in between blocks the trade.
  const researchWindow = await store.loadResearchWindow();
  const eligibility = isStrategyEligibleForPaper({
    strategyStatus: strategyVersion?.status,
    tradingMode: settings.tradingMode,
    researchWindow,
    now: nowMs,
  });

  if (!eligibility.eligible) {
    return reject("STRATEGY_NOT_APPROVED", eligibility.detail);
  }

  // Only a trade actually authorized by the research window carries its tag,
  // so the 14-day run can be analyzed in isolation and a PAPER_APPROVED
  // strategy's trades are never silently folded into research evidence.
  const researchSessionId =
    eligibility.basis === "PAPER_RESEARCH" && researchWindow ? researchWindow.id : null;

  // Defense in depth. The scanner already refuses to invoke AUTO outside an
  // active window (see lib/research/policy.ts), but an automated execution
  // must never be able to open a position on the strength of a caller's
  // assertion alone. A stale in-flight AUTO request that arrives after the
  // window closed is refused here, at the executor, against freshly read
  // state - the same way approval requests are never trusted to be current.
  if (source === "AUTO" && !isResearchWindowActive(researchWindow, nowMs)) {
    return reject(
      "STRATEGY_NOT_APPROVED",
      "Automatic execution was requested but no PAPER research window is active. The automatic research period has ended; approval is required again.",
    );
  }

  const instrument = await store.loadInstrument(claimed.symbol);
  if (!instrument) {
    return reject(
      "INVALID_EXCHANGE_METADATA",
      `No exchange metadata available for ${claimed.symbol}; refusing to size a position without live instrument rules.`,
    );
  }

  const account = await store.loadAccount(settings.tradingMode);

  // --- Fresh market data (fail closed) ------------------------------------
  let ticker: { lastPrice: number; serverTimeMs: number };
  let freshCandles: Candle[];
  try {
    [ticker, freshCandles] = await Promise.all([
      market.ticker(claimed.symbol),
      market.candles(claimed.symbol, "15M", 60),
    ]);
  } catch (err) {
    return reject(
      "MISSING_MARKET_DATA",
      `Could not obtain current market data: ${(err as Error).message}. No position was opened.`,
    );
  }

  if (!Number.isFinite(ticker.lastPrice) || ticker.lastPrice <= 0) {
    return reject("MISSING_MARKET_DATA", "The exchange returned an unusable price. No position was opened.");
  }

  // Re-measure volatility from CURRENT candles so the gate reflects
  // conditions now, not the conditions that produced the candidate.
  const closed = freshCandles.filter((c) => c.isClosed);
  const atrValue = closed.length > 0 ? latestAtr(closed.map((c) => ({ high: c.high, low: c.low, close: c.close }))) : null;
  const freshAtrPct = atrValue !== null ? atrValue / ticker.lastPrice : null;

  const score = reconstructScoreResult(claimed, { atrPctOverride: freshAtrPct });

  const revalidated = buildCandidateForScan({
    signalId,
    symbol: claimed.symbol,
    strategyVersionId: claimed.strategy_version_id,
    strategyVersionLabel: strategyVersion?.versionLabel ?? "unknown",
    timeframe: claimed.timeframe,
    closedCandleTimeMs: new Date(claimed.candle_time).getTime(),
    regime: claimed.regime,
    score,
    referencePrice: ticker.lastPrice,
    marketDataTimestampMs: ticker.serverTimeMs,
    nowMs,
    account,
    instrument,
    settings,
    // Already decided above by the shared eligibility helper, which is the
    // only place this question is answered for either caller.
    strategyApproved: eligibility.eligible,
  });

  if (revalidated.kind === "REJECTED") {
    return reject(revalidated.rejection.reason, revalidated.rejection.detail);
  }

  const { candidate } = revalidated;

  // --- Execute ------------------------------------------------------------
  const fill = computeOpenFill(ticker.lastPrice, candidate.risk.roundedQuantity, toCostModel(settings));

  const inserted = await store.insertTrade({
    signal_id: signalId,
    strategy_version_id: claimed.strategy_version_id,
    trading_mode: "PAPER",
    research_session_id: researchSessionId,
    symbol: claimed.symbol,
    side: "LONG",
    status: "OPEN",
    entry_price: fill.entryFillPrice,
    stop_price: candidate.position.stopPrice,
    target_price: candidate.position.targetPrice,
    qty: candidate.risk.roundedQuantity,
    notional: fill.notional,
    risk_amount: candidate.risk.estimatedActualRisk,
    risk_budget: candidate.risk.riskBudget,
    modeled_max_loss: candidate.risk.modeledMaxLoss,
    risk_reward: candidate.position.riskReward,
    entry_fee: fill.entryFee,
    fees: fill.entryFee,
    slippage: fill.entrySlippageCost,
    opened_at: nowIso,
  });

  if (!inserted.ok) {
    if (inserted.duplicate) {
      // The database refused a second position for this candidate. Execution
      // state is authoritative: report it as already processed rather than
      // unwinding a position that legitimately exists.
      await store.audit(source.toLowerCase(), "duplicate_execution_blocked", { signalId });
      return { kind: "ALREADY_PROCESSED", state: "APPROVED" };
    }
    return reject("INVALID_EXCHANGE_METADATA", `Could not record the position: ${inserted.message}`, "ERROR");
  }

  await store.insertTradeEvent(inserted.tradeId, "OPENED", {
    entryFillPrice: fill.entryFillPrice,
    qty: candidate.risk.roundedQuantity,
    entryFee: fill.entryFee,
    referencePrice: ticker.lastPrice,
    source,
  });

  const createdAtMs = new Date(claimed.created_at).getTime();
  await store.finalizeApproval({
    signalId,
    source,
    nowIso,
    // For AUTO this is time-to-execution, not a human's deliberation time.
    approvalDelayMs: Math.max(0, nowMs - createdAtMs),
  });

  await store.audit(
    source.toLowerCase(),
    // Named for what actually happened. An automatically executed candidate
    // must never be searchable as though the owner approved it.
    source === "AUTO" ? "paper_auto_execution" : "paper_position_opened",
    {
      signalId,
      tradeId: inserted.tradeId,
      symbol: claimed.symbol,
      executionBasis: eligibility.basis,
      researchSessionId,
    },
  );

  return { kind: "EXECUTED", tradeId: inserted.tradeId, candidate };
}

/**
 * REJECT: an atomic PENDING -> REJECTED transition recording that the OWNER
 * declined (rejection_reason stays null, which is what distinguishes this
 * from an engine rejection). The candidate data is retained for Milestone 4
 * counterfactual analysis; no position is opened and the candidate is never
 * offered again.
 */
export async function rejectCandidateByOwner(
  signalId: string,
  source: ApprovalSource,
  deps: { store: ApprovalStore; now?: () => number },
): Promise<RejectionResult> {
  const nowMs = deps.now?.() ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const result = await deps.store.recordOwnerRejection({ signalId, source, nowIso });
  if (result.ok) {
    await deps.store.audit(source.toLowerCase(), "candidate_rejected_by_owner", { signalId });
    return { kind: "REJECTED_BY_OWNER", symbol: result.symbol };
  }
  if (result.state === null) return { kind: "NOT_FOUND" };
  return { kind: "ALREADY_PROCESSED", state: result.state };
}
