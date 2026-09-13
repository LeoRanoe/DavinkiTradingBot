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
import { buildCandidateForScan } from "@/lib/candidates/from-settings";
import { buildSignalRow } from "@/lib/candidates/persistence";
import { INITIAL_PAPER_EQUITY, riskSettingsFromRow } from "@/lib/settings/risk-settings";
import { getAppUrl } from "@/lib/config/env";
import type { InstrumentRules } from "@/lib/risk/types";
import {
  sendTelegramMessage,
  formatCandidateMessage,
  formatTradeClosedMessage,
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

  // Only a strategy version explicitly approved for the active mode may
  // produce an actionable candidate. A DRAFT version still gets a complete,
  // deterministic evaluation - it is recorded as a typed
  // STRATEGY_NOT_APPROVED rejection rather than silently skipped.
  const strategyApproved =
    strategyVersion.status === "PAPER_APPROVED" || strategyVersion.status === "DEMO_APPROVED";

  let recordsProcessed = 0;
  let signalsFound = 0;
  let candidatesBuilt = 0;
  let candidatesRejected = 0;
  const errors: string[] = [];

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
    await sendTelegramMessage(formatTradeClosedMessage(closed, STRATEGY_V1_VERSION_LABEL)).catch(() => undefined);
  }

  // Lapse unattended candidates and reconcile any claim that died mid-flight.
  // Silent by design - the owner is not pinged every time one expires.
  try {
    await sweepStaleCandidates(admin);
  } catch (sweepErr) {
    errors.push(`candidate sweep: ${(sweepErr as Error).message}`);
  }

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

      const { data: insertedSignal, error: signalError } = await admin
        .from("signals")
        .insert({
          id: signalId,
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

        await sendTelegramMessage(
          formatCandidateMessage({ candidate, riskModeLabel, validForMinutes }),
          { replyMarkup: buildCandidateKeyboard(insertedSignal.id, getAppUrl()) },
        ).catch(() => undefined);
      }
    } catch (err) {
      errors.push(`${symbol}: ${(err as Error).message}`);
    }
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
  });

  return NextResponse.json({
    status,
    recordsProcessed,
    signalsFound,
    candidatesBuilt,
    candidatesRejected,
    tradesClosed,
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
