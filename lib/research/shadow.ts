import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { calculateLongExcursions } from "@/lib/learning/outcomes";
import type { CandidatePlan, CounterfactualOutcome, OutcomeCandle } from "@/lib/learning/types";
import type { OwnerRiskSettings } from "@/lib/settings/risk-settings";
import { scoreBand } from "./report";

/**
 * Live shadow / counterfactual capture.
 *
 * THE INVARIANT: nothing here can ever touch PAPER equity, realized P/L or
 * actual strategy performance. It is enforced three deep -
 *   1. these rows live in `counterfactual_outcomes`, which carries
 *      CHECK (is_hypothetical) at the database level,
 *   2. `toLearningTrades` marks them actual: false,
 *   3. the evidence report filters on `actual` before aggregating.
 *
 * WHAT IT IS FOR: learning whether the filters are rejecting noise or
 * rejecting edge. A setup V1 declined is a data point about V1's judgement,
 * and throwing it away means never finding out the thresholds were wrong.
 *
 * WHAT IT IS NOT FOR: justifying a bypass. A profitable counterfactual is
 * never a reason to loosen a risk rule - it is a reason to research the rule.
 */

export type ShadowSource =
  | "SCORE_BAND_SHADOW"
  | "CANDIDATE_EXPIRED"
  | "ENTRY_DRIFT"
  | "RISK_BLOCKED"
  | "OWNER_REJECTED";

export type ShadowCandidate = {
  signalId: string;
  symbol: string;
  source: ShadowSource;
  /** The exact reason it was not traded, preserved verbatim. */
  rejectionReason: string | null;
  score: number;
  regime: string | null;
  plan: CandidatePlan;
  researchSessionId: string | null;
};

/**
 * Derives a research plan for a setup that never became a real candidate.
 *
 * A sub-threshold signal has an entry, stop and target but no allowed-entry
 * range or expiry - those are produced by the candidate pipeline, which it
 * never reached. Reconstructing them from the OWNER'S OWN configured drift
 * and expiry is the honest choice: it asks "what would have happened had this
 * been treated exactly like a real candidate", rather than inventing a
 * friendlier entry rule that would flatter the shadow track.
 */
export function researchPlanFor(
  row: { entry_price: number | null; stop_price: number | null; target_price: number | null; candle_time: string },
  settings: Pick<OwnerRiskSettings, "maxEntryDriftPct" | "candidateExpiryMinutes">,
): CandidatePlan | null {
  const { entry_price: entry, stop_price: stop, target_price: target } = row;
  if (entry === null || stop === null || target === null) return null;
  if (!(entry > 0) || !(stop > 0) || !(target > 0)) return null;
  if (stop >= entry || target <= entry) return null;

  const drift = settings.maxEntryDriftPct;
  const candleTimeMs = Date.parse(row.candle_time);
  if (!Number.isFinite(candleTimeMs)) return null;

  return {
    entryPrice: entry,
    allowedEntryMin: entry * (1 - drift),
    allowedEntryMax: entry * (1 + drift),
    stopPrice: stop,
    targetPrice: target,
    expiresAt: candleTimeMs + settings.candidateExpiryMinutes * 60_000,
  };
}


/**
 * Settles one shadow plan.
 *
 * WHY THIS IS NOT `calculateCounterfactualOutcome`
 * ------------------------------------------------
 * That engine bounds BOTH the entry search and the exit search by
 * `expiresAt`. For a real candidate that is fine - it models "did this get
 * taken during its short approval window". But a candidate expiry is ten
 * minutes and the entry timeframe is fifteen, so applying the same bound to
 * the EXIT means a shadow trade can essentially never reach its stop or
 * target: almost every row would resolve as EXPIRED and the research would
 * learn nothing.
 *
 * Expiry governs whether the trade is ENTERED. Once entered, the position is
 * followed until it resolves, exactly as a real position would be. The
 * existing engine is deliberately left untouched - it is tested and used
 * elsewhere - and this is documented as a different question, not a fix.
 *
 * Every conservative assumption is preserved:
 *   - a mere range touch fills at the WORST permitted long entry,
 *   - STOP wins any bar that touches both stop and target,
 *   - R is measured from the actual hypothetical fill.
 */
export function settleShadowPlan(plan: CandidatePlan, candles: OutcomeCandle[]): CounterfactualOutcome {
  const closed = candles.filter((c) => c.isClosed).sort((a, b) => a.openTime - b.openTime);

  // --- Entry: only inside the range, and only before expiry --------------
  let entryIndex = -1;
  let entryPrice: number | null = null;

  for (let i = 0; i < closed.length; i += 1) {
    const bar = closed[i];
    if (bar.openTime > plan.expiresAt) break; // the window closed
    if (bar.low <= plan.allowedEntryMax && bar.high >= plan.allowedEntryMin) {
      entryIndex = i;
      entryPrice =
        bar.open >= plan.allowedEntryMin && bar.open <= plan.allowedEntryMax ? bar.open : plan.allowedEntryMax;
      break;
    }
  }

  if (entryIndex === -1 || entryPrice === null) {
    return {
      kind: "NO_ENTRY", isHypothetical: true, entryTime: null, exitTime: null,
      entryPrice: null, exitPrice: null, rMultiple: null, excursions: null,
      conservativeAmbiguousCandle: false,
    };
  }

  // --- Exit: followed forward until it resolves --------------------------
  const path: OutcomeCandle[] = [];
  for (let i = entryIndex; i < closed.length; i += 1) {
    const bar = closed[i];
    path.push(bar);
    const hitStop = bar.low <= plan.stopPrice;
    const hitTarget = bar.high >= plan.targetPrice;
    if (hitStop || hitTarget) {
      const ambiguous = hitStop && hitTarget;
      const exitPrice = hitStop ? plan.stopPrice : plan.targetPrice;
      const risk = entryPrice - plan.stopPrice;
      return {
        kind: hitStop ? "STOP" : "TARGET", isHypothetical: true,
        entryTime: closed[entryIndex].openTime, exitTime: bar.openTime, entryPrice, exitPrice,
        rMultiple: risk > 0 ? (exitPrice - entryPrice) / risk : null,
        excursions: calculateLongExcursions(entryPrice, plan.stopPrice, path),
        conservativeAmbiguousCandle: ambiguous,
      };
    }
  }

  // Entered, but the available data ends before it resolved. Reported as
  // UNRESOLVED with a null R so it can never be counted as a win or a loss.
  return {
    kind: "UNRESOLVED", isHypothetical: true, entryTime: closed[entryIndex].openTime,
    exitTime: null, entryPrice, exitPrice: null, rMultiple: null,
    excursions: calculateLongExcursions(entryPrice, plan.stopPrice, path),
    conservativeAmbiguousCandle: false,
  };
}

/**
 * Queues shadow rows for setups that were not traded.
 *
 * Idempotent: the unique index on signal_id means re-queuing the same setup
 * is a no-op, so an overlapping or repeated scan writes nothing new.
 */
export async function queueShadowCandidates(
  client: SupabaseClient<Database>,
  candidates: readonly ShadowCandidate[],
): Promise<{ queued: number; skipped: number }> {
  if (candidates.length === 0) return { queued: 0, skipped: 0 };

  const rows = candidates.map((c) => ({
    signal_id: c.signalId,
    source: c.source,
    rejection_reason: c.rejectionReason,
    // Structurally hypothetical; the DB CHECK refuses anything else.
    is_hypothetical: true,
    plan_snapshot: {
      entryPrice: c.plan.entryPrice,
      allowedEntryMin: c.plan.allowedEntryMin,
      allowedEntryMax: c.plan.allowedEntryMax,
      stopPrice: c.plan.stopPrice,
      targetPrice: c.plan.targetPrice,
      expiresAt: c.plan.expiresAt,
    } as never,
    symbol: c.symbol,
    score: c.score,
    score_band: scoreBand(c.score),
    regime: c.regime,
    research_session_id: c.researchSessionId,
  }));

  const { error } = await client
    .from("counterfactual_outcomes")
    .upsert(rows as never, { onConflict: "signal_id", ignoreDuplicates: true });

  if (error) return { queued: 0, skipped: candidates.length };
  return { queued: rows.length, skipped: 0 };
}

export type UnsettledShadow = {
  id: string;
  signalId: string;
  symbol: string;
  plan: CandidatePlan;
};

/** Loads queued shadow rows whose hypothetical outcome has not been resolved. */
export async function loadUnsettledShadows(
  client: SupabaseClient<Database>,
  limit = 200,
): Promise<UnsettledShadow[]> {
  const { data } = await client
    .from("counterfactual_outcomes")
    .select("id, signal_id, symbol, plan_snapshot")
    .is("outcome", null)
    .not("plan_snapshot", "is", null)
    .limit(limit);

  const rows: UnsettledShadow[] = [];
  for (const row of data ?? []) {
    const plan = readPlan(row.plan_snapshot);
    if (!plan) continue;
    rows.push({ id: row.id, signalId: row.signal_id, symbol: row.symbol ?? "", plan });
  }
  return rows;
}

function readPlan(snapshot: unknown): CandidatePlan | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const s = snapshot as Record<string, unknown>;
  const numbers = ["entryPrice", "allowedEntryMin", "allowedEntryMax", "stopPrice", "targetPrice", "expiresAt"];
  for (const key of numbers) {
    if (typeof s[key] !== "number" || !Number.isFinite(s[key] as number)) return null;
  }
  return {
    entryPrice: s.entryPrice as number,
    allowedEntryMin: s.allowedEntryMin as number,
    allowedEntryMax: s.allowedEntryMax as number,
    stopPrice: s.stopPrice as number,
    targetPrice: s.targetPrice as number,
    expiresAt: s.expiresAt as number,
  };
}

/**
 * Settles queued shadows against stored candles using the EXISTING
 * conservative counterfactual engine - the same one that assumes a range
 * touch fills at the least favourable permitted entry and that STOP wins an
 * ambiguous bar. Using a gentler model here would make the shadow track look
 * better than the real one for no reason other than the model.
 *
 * Failures are isolated per row: a research failure never rolls back an
 * actual outcome, equity, or scanner state.
 */
export async function settleShadows(
  client: SupabaseClient<Database>,
  rows: readonly UnsettledShadow[],
  loadCandles: (symbol: string, fromMs: number, toMs: number) => Promise<OutcomeCandle[]>,
  options: { lookaheadMs?: number } = {},
): Promise<{ settled: number; failures: number }> {
  const lookahead = options.lookaheadMs ?? 48 * 60 * 60 * 1000;
  let settled = 0;
  let failures = 0;

  for (const row of rows) {
    try {
      const candles = await loadCandles(row.symbol, row.plan.expiresAt - 60 * 60 * 1000, row.plan.expiresAt + lookahead);
      // Not enough forward data yet: leave it queued rather than resolving it
      // as a non-entry it never was.
      if (candles.length === 0) continue;

      const outcome = settleShadowPlan(row.plan, candles);

      const { error } = await client
        .from("counterfactual_outcomes")
        .update({
          outcome: outcome.kind,
          entry_time: outcome.entryTime ? new Date(outcome.entryTime).toISOString() : null,
          exit_time: outcome.exitTime ? new Date(outcome.exitTime).toISOString() : null,
          entry_price: outcome.entryPrice,
          exit_price: outcome.exitPrice,
          r_multiple: outcome.rMultiple,
          mfe_price: outcome.excursions?.mfePrice ?? null,
          mae_price: outcome.excursions?.maePrice ?? null,
          mfe_r: outcome.excursions?.mfeR ?? null,
          mae_r: outcome.excursions?.maeR ?? null,
          conservative_ambiguous_candle: outcome.conservativeAmbiguousCandle,
          evaluated_at: new Date().toISOString(),
        } as never)
        .eq("id", row.id);

      if (error) failures += 1;
      else settled += 1;
    } catch {
      failures += 1;
    }
  }

  return { settled, failures };
}

/** Reads stored candles for settlement. Research only; no exchange call. */
export function createCandleLoader(client: SupabaseClient<Database>) {
  return async (symbol: string, fromMs: number, toMs: number): Promise<OutcomeCandle[]> => {
    const { data } = await client
      .from("candles")
      .select("open_time, open, high, low, close, is_closed")
      .eq("symbol", symbol)
      .eq("timeframe", "15M")
      .gte("open_time", new Date(fromMs).toISOString())
      .lte("open_time", new Date(toMs).toISOString())
      .order("open_time", { ascending: true });

    return (data ?? []).map((c) => ({
      openTime: Date.parse(c.open_time),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      isClosed: c.is_closed,
    }));
  };
}

export type ShadowSummary = {
  total: number;
  settled: number;
  bySource: Record<string, number>;
  byBand: Record<string, number>;
  byOutcome: Record<string, number>;
};

export async function summarizeShadows(
  client: SupabaseClient<Database>,
  researchSessionId: string | null,
): Promise<ShadowSummary> {
  let query = client.from("counterfactual_outcomes").select("source, score_band, outcome");
  if (researchSessionId) query = query.eq("research_session_id", researchSessionId);

  const { data } = await query;
  const rows = data ?? [];

  const bySource: Record<string, number> = {};
  const byBand: Record<string, number> = {};
  const byOutcome: Record<string, number> = {};

  for (const row of rows) {
    if (row.source) bySource[row.source] = (bySource[row.source] ?? 0) + 1;
    if (row.score_band) byBand[row.score_band] = (byBand[row.score_band] ?? 0) + 1;
    if (row.outcome) byOutcome[row.outcome] = (byOutcome[row.outcome] ?? 0) + 1;
  }

  return {
    total: rows.length,
    settled: rows.filter((r) => r.outcome !== null).length,
    bySource,
    byBand,
    byOutcome,
  };
}
