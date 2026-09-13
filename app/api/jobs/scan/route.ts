import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCandles, getInstrumentMetadata } from "@/lib/bybit/client";
import { createAdminClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { evaluateSignal } from "@/lib/strategy/v1/signal";
import { STRATEGY_V1_PARAMS, STRATEGY_V1_VERSION_LABEL } from "@/lib/strategy/v1/config";
import { checkAndCloseOpenTrades } from "@/lib/trading/monitor";
import { sendTelegramMessage, formatCandidateMessage } from "@/lib/telegram/client";

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
 * Auth: `Authorization: Bearer <CRON_SECRET>`. Missing/invalid -> 401.
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured on the server." }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: jobRun } = await admin
    .from("job_runs")
    .insert({ job_name: "scan", status: "RUNNING" })
    .select("id")
    .single();

  const { data: strategyVersion } = await admin
    .from("strategy_versions")
    .select("id")
    .eq("version_label", STRATEGY_V1_VERSION_LABEL)
    .single();

  if (!strategyVersion) {
    await finishJob(admin, jobRun?.id, "FAILED", 0, "Strategy V1 version row not found - run the seed migration.");
    return NextResponse.json({ error: "Strategy version not seeded" }, { status: 500 });
  }

  const { data: settings } = await admin.from("system_settings").select("signal_expiry_minutes").eq("id", true).single();
  const expiryMinutes = settings?.signal_expiry_minutes ?? 30;

  let recordsProcessed = 0;
  let signalsFound = 0;
  let tradesClosed = 0;
  const errors: string[] = [];

  for (const symbol of STRATEGY_V1_PARAMS.symbols) {
    try {
      const [candles1h, candles15m] = await Promise.all([
        getCandles(symbol, "1H", 260),
        getCandles(symbol, "15M", 260),
      ]);

      // Best-effort instrument metadata refresh (dynamic, never hard-coded).
      try {
        const meta = await getInstrumentMetadata(symbol);
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

      tradesClosed += await checkAndCloseOpenTrades(admin, symbol, candles15m);

      const evaluation = evaluateSignal(symbol, candles1h, candles15m);
      recordsProcessed += 1;

      if (evaluation.kind !== "SIGNAL") continue;
      if (evaluation.score.classification === "IGNORE") continue; // don't clutter the DB with noise

      const candleTimeIso = new Date(evaluation.candleTime).toISOString();
      const isCandidate = evaluation.score.classification === "CANDIDATE";

      const { data: insertedSignal, error: signalError } = await admin
        .from("signals")
        .insert({
          strategy_version_id: strategyVersion.id,
          symbol,
          timeframe: STRATEGY_V1_PARAMS.entryTimeframe,
          candle_time: candleTimeIso,
          regime: evaluation.regime,
          score: evaluation.score.total,
          classification: evaluation.score.classification,
          entry_price: evaluation.score.entryPrice,
          stop_price: evaluation.score.stopPrice,
          target_price: evaluation.score.targetPrice,
          risk_reward: evaluation.score.riskReward,
          reason: describeReason(evaluation.score.components),
          approval_status: isCandidate ? "PENDING" : "NOT_APPLICABLE",
          expires_at: isCandidate ? new Date(Date.now() + expiryMinutes * 60_000).toISOString() : null,
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

      if (isCandidate && insertedSignal) {
        // Best-effort notification - never blocks the scan on failure.
        await sendTelegramMessage(
          formatCandidateMessage({
            symbol,
            score: evaluation.score.total,
            regime: evaluation.regime,
            riskAmount: 0,
            riskReward: evaluation.score.riskReward,
            reason: describeReason(evaluation.score.components),
          }),
        ).catch(() => undefined);
      }
    } catch (err) {
      errors.push(`${symbol}: ${(err as Error).message}`);
    }
  }

  const status = errors.length > 0 && recordsProcessed === 0 ? "FAILED" : "SUCCEEDED";
  await finishJob(admin, jobRun?.id, status, recordsProcessed, errors.join("; ") || null, {
    signalsFound,
    tradesClosed,
  });

  return NextResponse.json({ status, recordsProcessed, signalsFound, tradesClosed, errors });
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
