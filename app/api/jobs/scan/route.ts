import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCandles, getInstrumentMetadata, getTicker } from "@/lib/bybit/client";
import { createAdminClient, createBearerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { evaluateSignal } from "@/lib/strategy/v1/signal";
import { STRATEGY_V1_PARAMS, STRATEGY_V1_VERSION_LABEL } from "@/lib/strategy/v1/config";
import { computeAccountState } from "@/lib/trading/account-state";
import { manageOpenPositions } from "@/lib/trading/position-manager";
import { createPositionStore, sweepStaleCandidates } from "@/lib/trading/position-store";
import { bybitMarketData } from "@/lib/trading/execute";
import { captureClosedTradeLearning } from "@/lib/learning/persistence";
import { buildCandidateForScan } from "@/lib/candidates/from-settings";
import { buildSignalRow } from "@/lib/candidates/persistence";
import { INITIAL_PAPER_EQUITY, riskSettingsFromRow } from "@/lib/settings/risk-settings";
import { getAppUrl } from "@/lib/config/env";
import { loadCurrentResearchWindow } from "@/lib/research/store";
import { reconcileResearchExpiry } from "@/lib/research/expiry";
import { effectiveExecutionPolicy } from "@/lib/research/policy";
import { isStrategyEligibleForPaper } from "@/lib/research/eligibility";
import { formatResearchDay } from "@/lib/research/window";
import {
  createCandleLoader,
  loadUnsettledShadows,
  queueShadowCandidates,
  researchPlanFor,
  settleShadows,
  type ShadowCandidate,
} from "@/lib/research/shadow";
import { executeCandidate } from "@/lib/trading/execute";
import { loadRecentNewsEvents } from "@/lib/news/store";
import { buildCandidateNewsContext, DEFAULT_NEWS_WINDOW_MS } from "@/lib/news/candidate-context";
import type { CandidateNewsContext } from "@/lib/news/types";
import type { NewsEvent } from "@/lib/news/types";
import type { InstrumentRules } from "@/lib/risk/types";
import {
  sendTelegramMessage,
  formatCandidateMessage,
  formatTradeClosedMessage,
  formatAutoPositionOpenedMessage,
  buildCandidateKeyboard,
} from "@/lib/telegram/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
// Bybit's public API geo-blocks several regions/countries at the CloudFront
// layer (confirmed during development: "The Amazon CloudFront distribution
// is configured to block access from your country"). Vercel's default
// region (iad1, US East) is commonly affected. The function region is
// pinned to Singapore via vercel.json (`preferredRegion` is deprecated in
// Next.js 16 in favor of vercel.json's `regions`). If job_runs still shows
// Bybit errors after deploying, change the Vercel project's Function
// Region in the dashboard (Project Settings -> Functions) to
// Singapore/Tokyo/Frankfurt.

/**
 * Supabase Cron entrypoint (spec #52). Runs roughly every 5 minutes.
 * Idempotent: re-running with no new closed candle is a no-op; a duplicate
 * signal is prevented by the DB unique constraint on
 * (strategy_version_id, symbol, timeframe, candle_time).
 *
 * Auth: a short-lived JWT for the dedicated Supabase scanner principal.
 * `CRON_SECRET` remains available only as a manual fallback.
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  let admin: SupabaseClient<Database> | null = null;
  if (bearerToken) {
    const scoped = createBearerClient(bearerToken);
    const { data: { user } } = await scoped.auth.getUser(bearerToken);
    if (user?.app_metadata?.role === "scanner") admin = scoped;
  }
  // Backward-compatible manual trigger. Scheduled production runs use the
  // short-lived scanner JWT above and do not need a Vercel service-role key.
  if (!admin && cronSecret && authHeader === `Bearer ${cronSecret}`) {
    admin = createAdminClient();
  }
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: jobRun, error: jobRunError } = await admin
    .from("job_runs")
    .insert({ job_name: "scan", status: "RUNNING" })
    .select("id")
    .single();

  if (jobRunError) {
    // Surface the database error instead of letting downstream queries fail
    // with a misleading "not found" message. Scheduled runs use the scoped
    // scanner principal; only the manual fallback uses the admin client.
    return NextResponse.json(
      { error: "Failed to write job_runs", detail: jobRunError.message },
      { status: 500 },
    );
  }

  const { data: strategyVersion, error: strategyError } = await admin
    .from("strategy_versions")
    .select("id, status")
    .eq("version_label", STRATEGY_V1_VERSION_LABEL)
    .single();

  if (!strategyVersion) {
    await finishJob(
      admin,
      jobRun?.id,
      "FAILED",
      0,
      `Strategy V1 version row not found: ${strategyError?.message ?? "unknown error"}`,
    );
    return NextResponse.json(
      { error: "Strategy version not seeded", detail: strategyError?.message },
      { status: 500 },
    );
  }

  // The owner's stored risk configuration drives every candidate this run
  // produces. Read once per scan so all symbols in one cycle are evaluated
  // against exactly the same settings.
  const { data: settingsRow } = await admin.from("system_settings").select("*").eq("id", true).single();
  const settings = riskSettingsFromRow(settingsRow);

  const scanStartedMs = Date.now();

  let recordsProcessed = 0;
  let signalsFound = 0;
  let candidatesBuilt = 0;
  let candidatesRejected = 0;
  const errors: string[] = [];
  let autoExecuted = 0;
  let autoRejected = 0;
  // Setups that were NOT traded, collected for counterfactual research.
  // Strictly hypothetical: these can never affect equity or actual results.
  const shadowCandidates: ShadowCandidate[] = [];
  let shadowsQueued = 0;
  let shadowsSettled = 0;

  // ---------------------------------------------------------------------
  // PHASE 0 - reconcile the research window BEFORE anything can execute.
  //
  // If the 14-day window elapsed since the last run, it is expired here, the
  // stored policy is reverted to APPROVAL_REQUIRED and the owner is notified
  // exactly once - all before a single candidate is evaluated below. So the
  // very first scan after day 14 already behaves as an approval-mode scan.
  //
  // Correctness does not depend on this having run: `effectiveExecutionPolicy`
  // refuses AUTO on elapsed time alone. This makes the stored state agree.
  // ---------------------------------------------------------------------
  let researchWindow = await loadCurrentResearchWindow(admin).catch(() => null);
  try {
    const expiry = await reconcileResearchExpiry(admin, researchWindow, scanStartedMs);
    if (expiry.kind === "EXPIRED" || expiry.kind === "ALREADY_HANDLED") {
      researchWindow = await loadCurrentResearchWindow(admin).catch(() => null);
    }
  } catch (expiryErr) {
    // A failure here must never stop position management or candidate
    // generation. The window is still treated as closed by the policy check.
    errors.push(`research expiry: ${(expiryErr as Error).message}`);
  }

  // Strategy eligibility comes from ONE shared helper, also used by the
  // executor, so the scanner can never advertise a candidate the executor
  // would refuse. A DRAFT version is eligible ONLY inside an active research
  // window; outside one it still gets a complete deterministic evaluation and
  // is recorded as a typed STRATEGY_NOT_APPROVED rejection, never skipped.
  const eligibility = isStrategyEligibleForPaper({
    strategyStatus: strategyVersion.status,
    tradingMode: settings.tradingMode,
    researchWindow,
    now: scanStartedMs,
  });
  const strategyApproved = eligibility.eligible;

  // What the system will ACTUALLY do, which is not simply what the owner
  // configured: AUTO additionally requires PAPER and a live research window.
  const effectivePolicy = effectiveExecutionPolicy({
    configuredPolicy: settings.executionPolicy,
    tradingMode: settings.tradingMode,
    researchWindow,
    now: scanStartedMs,
  });
  const autoExecutionActive = effectivePolicy.policy === "AUTO";

  // Only tag rows the research window actually authorized, so a
  // PAPER_APPROVED strategy's trades never enter the research evidence set.
  const researchSessionId =
    eligibility.basis === "PAPER_RESEARCH" && researchWindow ? researchWindow.id : null;
  const researchDay = researchWindow ? formatResearchDay(researchWindow, scanStartedMs) : null;


  // ---------------------------------------------------------------------
  // PHASE 1 - manage what is already open.
  //
  // This runs on the job's own cadence and is deliberately NOT gated on a
  // new closed 15m strategy candle: an open position must be monitored every
  // run, whether or not a new setup candle has arrived. Settlement is
  // idempotent (atomic OPEN -> CLOSED), so overlapping runs are safe.
  // ---------------------------------------------------------------------
  const positionOutcome = await manageOpenPositions({
    store: createPositionStore(admin),
    market: bybitMarketData,
    settings,
  });
  const tradesClosed = positionOutcome.closed.length;
  errors.push(...positionOutcome.errors);

  for (const closed of positionOutcome.closed) {
    // Described the same way it was opened: a position opened under the
    // research window is reported as an AUTO result, read from the trade
    // itself rather than from whatever policy happens to be in force now.
    await sendTelegramMessage(
      formatTradeClosedMessage(closed, STRATEGY_V1_VERSION_LABEL, {
        automatic: Boolean(closed.researchSessionId),
        researchDay: closed.researchSessionId ? researchDay : null,
      }),
    ).catch(() => undefined);
    // Settlement and the equity snapshot already committed. Learning is
    // post-settlement and best-effort: a research/AI failure cannot undo an
    // actual PAPER result or destabilize the scan.
    await captureClosedTradeLearning(admin, closed).catch((error) => {
      errors.push(`learning ${closed.tradeId}: ${(error as Error).message}`);
    });
  }

  // Lapse unattended candidates and reconcile any claim that died mid-flight.
  // Silent by design - the owner is not pinged every time one expires.
  try {
    await sweepStaleCandidates(admin);
  } catch (sweepErr) {
    errors.push(`candidate sweep: ${(sweepErr as Error).message}`);
  }

  // News context is CONTEXT ONLY and is loaded lazily: a scan with no
  // candidate never touches the news tables, and a news failure can never
  // stop a candidate from being produced (it becomes UNKNOWN instead).
  let newsEvents: NewsEvent[] | null = null;
  let newsUnavailable = false;
  const newsContextFor = async (symbol: string, nowMs: number): Promise<CandidateNewsContext> => {
    if (newsEvents === null && !newsUnavailable) {
      try {
        newsEvents = await loadRecentNewsEvents(
          admin,
          new Date(nowMs - DEFAULT_NEWS_WINDOW_MS).toISOString(),
        );
      } catch {
        newsUnavailable = true;
      }
    }
    return buildCandidateNewsContext({
      symbol,
      events: newsEvents ?? [],
      nowMs,
      unavailable: newsUnavailable,
    });
  };

  // ---------------------------------------------------------------------
  // PHASE 2 - evaluate new closed strategy candles.
  // ---------------------------------------------------------------------

  for (const symbol of STRATEGY_V1_PARAMS.symbols) {
    try {
      const [candles1h, candles15m] = await Promise.all([
        getCandles(symbol, "1H", 260),
        getCandles(symbol, "15M", 260),
      ]);

      const latestClosed15m = candles15m.findLast((candle) => candle.isClosed);
      if (!latestClosed15m) {
        errors.push(`${symbol}: no closed 15-minute candle returned`);
        continue;
      }

      // Check this before persisting the fetched batch. The candles table is
      // also our durable scan watermark, including IGNORE outcomes for which
      // no signal row is intentionally stored.
      const { data: existingCandle } = await admin
        .from("candles")
        .select("id")
        .eq("symbol", symbol)
        .eq("timeframe", "15M")
        .eq("open_time", new Date(latestClosed15m.openTime).toISOString())
        .maybeSingle();

      // Best-effort instrument metadata refresh (dynamic, never hard-coded).
      let instrumentRules: InstrumentRules | null = null;
      try {
        const meta = await getInstrumentMetadata(symbol);
        instrumentRules = {
          tickSize: meta.tickSize,
          qtyStep: meta.qtyStep,
          minOrderQty: meta.minOrderQty,
          minOrderAmt: meta.minOrderAmt,
          maxOrderQty: meta.maxOrderQty,
        };
        await admin.from("instrument_metadata").upsert(
          {
            symbol: meta.symbol,
            base_coin: meta.baseCoin,
            quote_coin: meta.quoteCoin,
            tick_size: meta.tickSize,
            qty_step: meta.qtyStep,
            min_order_qty: meta.minOrderQty,
            min_order_amt: meta.minOrderAmt,
            max_order_qty: meta.maxOrderQty,
            price_scale: meta.priceScale,
            raw: meta.raw as never,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "symbol" },
        );
      } catch (metaErr) {
        errors.push(`${symbol} instrument metadata: ${(metaErr as Error).message}`);
      }

      // Persist candles (idempotent via unique constraint) for audit/backtesting reuse.
      const candleRows = [...candles1h, ...candles15m]
        .filter((c) => c.isClosed)
        .map((c) => ({
          symbol: c.symbol,
          timeframe: c.timeframe,
          open_time: new Date(c.openTime).toISOString(),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          is_closed: true,
        }));
      if (candleRows.length > 0) {
        await admin.from("candles").upsert(candleRows, { onConflict: "symbol,timeframe,open_time", ignoreDuplicates: true });
      }

      // Open positions were already managed in phase 1, on the job's own
      // cadence rather than this per-symbol candle loop.
      if (existingCandle) continue;

      const evaluation = evaluateSignal(symbol, candles1h, candles15m);
      recordsProcessed += 1;

      if (evaluation.kind !== "SIGNAL") continue;
      if (evaluation.score.classification === "IGNORE") continue; // don't clutter the DB with noise

      const isCandidate = evaluation.score.classification === "CANDIDATE";
      const nowMs = Date.now();
      // Generated up front so candidateId === signalId === the persisted row.
      const signalId = crypto.randomUUID();

      // A CANDIDATE classification is a STRATEGY opinion, not a financial
      // decision. Everything below re-derives the trade from current market
      // data and the owner's risk settings; the deterministic risk/candidate
      // layer has final eligibility authority. No AI is consulted here.
      let candidateResult = undefined;
      let referencePrice: number | undefined;
      let referencePriceAtMs: number | undefined;

      if (isCandidate) {
        // Never price a candidate off the (already closed, already stale)
        // signal candle - fetch the current market price and stamp it.
        const ticker = await getTicker(symbol);
        referencePrice = ticker.lastPrice;
        referencePriceAtMs = ticker.serverTimeMs;

        const rules =
          instrumentRules ??
          (await (async (): Promise<InstrumentRules | null> => {
            const { data: stored } = await admin
              .from("instrument_metadata")
              .select("tick_size, qty_step, min_order_qty, min_order_amt, max_order_qty")
              .eq("symbol", symbol)
              .maybeSingle();
            return stored
              ? {
                  tickSize: stored.tick_size,
                  qtyStep: stored.qty_step,
                  minOrderQty: stored.min_order_qty,
                  minOrderAmt: stored.min_order_amt,
                  maxOrderQty: stored.max_order_qty,
                }
              : null;
          })());

        if (!rules) {
          // Fail closed: without live exchange rules there is no honest way
          // to size or validate an order. Never fall back to a guess.
          candidateResult = {
            kind: "REJECTED" as const,
            rejection: {
              signalId,
              symbol,
              strategyVersionId: strategyVersion.id,
              strategyVersionLabel: STRATEGY_V1_VERSION_LABEL,
              timeframe: STRATEGY_V1_PARAMS.entryTimeframe,
              closedCandleTime: new Date(evaluation.candleTime).toISOString(),
              reason: "INVALID_EXCHANGE_METADATA" as const,
              detail: `No exchange metadata available for ${symbol}; refusing to size a position without live instrument rules.`,
            },
          };
        } else {
          const account = await computeAccountState(admin, settings.tradingMode, INITIAL_PAPER_EQUITY);
          candidateResult = buildCandidateForScan({
            signalId,
            symbol,
            strategyVersionId: strategyVersion.id,
            strategyVersionLabel: STRATEGY_V1_VERSION_LABEL,
            timeframe: STRATEGY_V1_PARAMS.entryTimeframe,
            closedCandleTimeMs: evaluation.candleTime,
            regime: evaluation.regime,
            score: evaluation.score,
            referencePrice,
            marketDataTimestampMs: referencePriceAtMs,
            nowMs,
            account,
            instrument: rules,
            settings,
            strategyApproved,
          });
        }

        if (candidateResult.kind === "CANDIDATE") candidatesBuilt += 1;
        else candidatesRejected += 1;
      }

      const newsContext =
        candidateResult?.kind === "CANDIDATE" ? await newsContextFor(symbol, nowMs) : undefined;

      const { data: insertedSignal, error: signalError } = await admin
        .from("signals")
        .insert({
          id: signalId,
          // Tagged at creation so the funnel (candidates, risk-valid,
          // executed) can be measured for the research period, not just the
          // trades that came out of it.
          research_session_id: researchSessionId,
          ...buildSignalRow({
            strategyVersionId: strategyVersion.id,
            symbol,
            timeframe: STRATEGY_V1_PARAMS.entryTimeframe,
            candleTimeMs: evaluation.candleTime,
            regime: evaluation.regime,
            score: evaluation.score,
            tradingMode: settings.tradingMode,
            reason: describeReason(evaluation.score.components),
            result: candidateResult,
            referencePrice,
            referencePriceAtMs,
            signalExpiryMinutes: settings.signalExpiryMinutes,
            candidateExpiryMinutes: settings.candidateExpiryMinutes,
            nowMs,
            newsContext,
          }),
        })
        .select("id")
        .single();

      // A unique-constraint violation here means this exact candle was
      // already processed - that is the expected, idempotent no-op path,
      // not an error.
      if (signalError) {
        if (!signalError.message.includes("duplicate key")) {
          errors.push(`${symbol} signal insert: ${signalError.message}`);
        }
        continue;
      }

      signalsFound += 1;

      if (insertedSignal) {
        await admin.from("signal_components").insert(
          evaluation.score.components.map((c) => ({
            signal_id: insertedSignal.id,
            component_name: c.name,
            points_earned: c.pointsEarned,
            points_possible: c.pointsPossible,
            detail: c.detail as never,
          })),
        );
      }

      // ---- Shadow capture (research only) -------------------------------
      // Every setup that was evaluated but not traded becomes a
      // counterfactual: sub-threshold bands, and candidates the deterministic
      // risk layer refused. The exact reason is preserved so the research can
      // tell "we filtered noise" from "we filtered edge".
      //
      // Nothing queued here can ever reach PAPER equity: these rows live in
      // counterfactual_outcomes, which carries CHECK (is_hypothetical).
      if (insertedSignal) {
        const plan = researchPlanFor(
          {
            entry_price: evaluation.score.entryPrice,
            stop_price: evaluation.score.stopPrice,
            target_price: evaluation.score.targetPrice,
            candle_time: new Date(evaluation.candleTime).toISOString(),
          },
          settings,
        );

        if (plan) {
          if (!isCandidate) {
            // LOG / WATCH: below the CANDIDATE threshold. This is what makes
            // the score-band question answerable at all.
            shadowCandidates.push({
              signalId: insertedSignal.id,
              symbol,
              source: "SCORE_BAND_SHADOW",
              rejectionReason: `BELOW_CANDIDATE_THRESHOLD_${evaluation.score.classification}`,
              score: evaluation.score.total,
              regime: evaluation.regime,
              plan,
              researchSessionId,
            });
          } else if (candidateResult?.kind === "REJECTED") {
            // Strategy-valid but refused by the deterministic risk layer.
            shadowCandidates.push({
              signalId: insertedSignal.id,
              symbol,
              source:
                candidateResult.rejection.reason === "ENTRY_OUTSIDE_ALLOWED_RANGE" ? "ENTRY_DRIFT" : "RISK_BLOCKED",
              rejectionReason: candidateResult.rejection.reason,
              score: evaluation.score.total,
              regime: evaluation.regime,
              plan,
              researchSessionId,
            });
          }
        }
      }

      // Relational index of which events this candidate used. The immutable
      // snapshot on the signal row remains the authority for display.
      if (insertedSignal && newsContext && newsContext.events.length > 0) {
        await admin
          .from("candidate_news_links")
          .insert(
            newsContext.events.map((event, index) => ({
              signal_id: insertedSignal.id,
              news_event_id: event.id,
              position: index,
            })),
          )
          .then(
            () => undefined,
            () => undefined, // context linkage must never fail a scan
          );
      }

      // An ACTIONABLE recommendation is sent only for a candidate that is
      // strategy-valid, risk-valid, exchange-valid, unexpired, fresh, unique
      // and permitted by the current mode - i.e. exactly the rows that
      // reached PENDING. IGNORE/LOG/WATCH classifications, risk-rejected
      // candidates, duplicates and NOOP runs never notify.
      if (insertedSignal && candidateResult?.kind === "CANDIDATE") {
        const { candidate } = candidateResult;
        const validForMinutes = Math.max(
          1,
          Math.round((new Date(candidate.lifecycle.expiresAt).getTime() - nowMs) / 60_000),
        );
        const riskModeLabel =
          settings.riskMode === "FIXED_AMOUNT"
            ? `$${settings.fixedRiskAmount.toFixed(2)} fixed`
            : `${(settings.maxRiskPerTradePct * 100).toFixed(2)}% of equity`;

        if (autoExecutionActive) {
          // AUTO: the candidate is already persisted above. Execution goes
          // through the SAME function the owner's APPROVE button calls, so it
          // re-claims the candidate atomically and re-validates everything
          // against fresh market data before anything opens. The scan code
          // never inserts a trade itself.
          //
          // Notification happens strictly AFTER execution has committed, and
          // its failure is swallowed: a Telegram outage must not duplicate,
          // unwind or cancel a correctly persisted position.
          const executed = await executeCandidate(insertedSignal.id, "AUTO", admin).catch((err) => ({
            kind: "REJECTED" as const,
            reason: "MISSING_MARKET_DATA" as const,
            detail: (err as Error).message,
          }));

          if (executed.kind === "EXECUTED") {
            autoExecuted += 1;
            await sendTelegramMessage(
              formatAutoPositionOpenedMessage({
                symbol: candidate.symbol,
                side: candidate.side,
                entryPrice: candidate.position.referencePrice,
                qty: candidate.risk.roundedQuantity,
                stopPrice: candidate.position.stopPrice,
                targetPrice: candidate.position.targetPrice,
                modeledMaxLoss: candidate.risk.modeledMaxLoss,
                positionNotional: candidate.risk.positionNotional,
                riskReward: candidate.position.riskReward,
                strategyLabel: STRATEGY_V1_VERSION_LABEL,
                researchDay,
              }),
            ).catch(() => undefined);
          } else if (executed.kind === "REJECTED") {
            // The exact deterministic reason is already persisted on the
            // signal row by the executor. Counted here, not notified: a
            // candidate that failed revalidation is routine and notifying on
            // it would make Telegram unusable.
            autoRejected += 1;
          }
        } else {
          // APPROVAL_REQUIRED: unchanged behaviour. The owner decides, and
          // approving re-runs this identical pipeline before anything opens.
          await sendTelegramMessage(
            formatCandidateMessage({ candidate, riskModeLabel, validForMinutes, news: newsContext }),
            { replyMarkup: buildCandidateKeyboard(insertedSignal.id, getAppUrl()) },
          ).catch(() => undefined);
        }
      }
    } catch (err) {
      errors.push(`${symbol}: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------
  // PHASE 3 - shadow research (counterfactual only).
  //
  // Runs LAST, after every trading decision is already committed, and every
  // failure is swallowed. Research must never be able to delay, block or
  // unwind an actual position - it is strictly an observer of decisions
  // already made.
  // ---------------------------------------------------------------------
  try {
    const queued = await queueShadowCandidates(admin, shadowCandidates);
    shadowsQueued = queued.queued;
  } catch (shadowErr) {
    errors.push(`shadow queue: ${(shadowErr as Error).message}`);
  }

  try {
    // Bounded per run so research can never crowd out the trading path.
    const unsettled = await loadUnsettledShadows(admin, 100);
    const settled = await settleShadows(admin, unsettled, createCandleLoader(admin));
    shadowsSettled = settled.settled;
    if (settled.failures > 0) errors.push(`shadow settle: ${settled.failures} failed`);
  } catch (settleErr) {
    errors.push(`shadow settle: ${(settleErr as Error).message}`);
  }

  const status = errors.length > 0 && recordsProcessed === 0
    ? "FAILED"
    : recordsProcessed === 0 && tradesClosed === 0
      ? "NOOP"
      : "SUCCEEDED";
  await finishJob(admin, jobRun?.id, status, recordsProcessed, errors.join("; ") || null, {
    signalsFound,
    candidatesBuilt,
    candidatesRejected,
    tradesClosed,
    executionPolicy: effectivePolicy.policy,
    autoExecuted,
    autoRejected,
    researchSessionId,
    shadowsQueued,
    shadowsSettled,
  });

  return NextResponse.json({
    status,
    recordsProcessed,
    signalsFound,
    candidatesBuilt,
    candidatesRejected,
    tradesClosed,
    // Reported so a scan's behaviour is never ambiguous after the fact:
    // configured policy alone does not tell you whether AUTO was in force.
    executionPolicy: effectivePolicy.policy,
    configuredExecutionPolicy: settings.executionPolicy,
    researchWindowActive: Boolean(researchSessionId),
    autoExecuted,
    autoRejected,
    shadowsQueued,
    shadowsSettled,
    errors,
  });
}

function describeReason(components: { name: string; pointsEarned: number; pointsPossible: number }[]): string {
  return components.map((c) => `${c.name} ${c.pointsEarned}/${c.pointsPossible}`).join(", ");
}

async function finishJob(
  admin: SupabaseClient<Database>,
  jobRunId: string | undefined,
  status: "SUCCEEDED" | "FAILED" | "NOOP",
  recordsProcessed: number,
  errorSummary: string | null,
  metadata?: Record<string, unknown>,
) {
  if (!jobRunId) return;
  await admin
    .from("job_runs")
    .update({
      status,
      completed_at: new Date().toISOString(),
      records_processed: recordsProcessed,
      error_summary: errorSummary,
      metadata: metadata as never,
    })
    .eq("id", jobRunId);
}
