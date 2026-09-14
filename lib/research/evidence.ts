import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { LearningTrade } from "@/lib/learning/types";
import { buildResearchReport, type CandidateFunnel, type ResearchReport } from "./report";
import type { ResearchWindow } from "./window";

/**
 * Loads the ACTUAL PAPER trades belonging to one research window, together
 * with the signal context the breakdowns need (score, regime, news risk,
 * volatility).
 *
 * Scoped by `research_session_id`, not by timestamp range. A trade opened
 * inside the window under a formally PAPER_APPROVED strategy carries no
 * research tag and is correctly excluded, and nothing outside the window can
 * drift in because a clock or a timezone was read differently.
 *
 * Counterfactual rows live in `counterfactual_outcomes` and are deliberately
 * never read here: hypothetical fills are research data, but they are not
 * PAPER performance and must never be aggregated with it.
 */
export async function loadResearchTrades(
  client: SupabaseClient<Database>,
  windowId: string,
): Promise<LearningTrade[]> {
  const { data: trades } = await client
    .from("trades")
    .select(
      "id, symbol, strategy_version_id, signal_id, opened_at, closed_at, pnl, gross_pnl, fees, slippage, r_multiple, mfe_price, mae_price, mfe_r, mae_r, entry_price, trading_mode",
    )
    .eq("research_session_id", windowId)
    .eq("trading_mode", "PAPER");

  if (!trades || trades.length === 0) return [];

  const signalIds = trades.map((t) => t.signal_id).filter((id): id is string => Boolean(id));
  const signalContext = new Map<
    string,
    { score: number | null; regime: string | null; newsRisk: string | null; stopPct: number | null; riskReward: number | null }
  >();

  if (signalIds.length > 0) {
    const { data: signals } = await client
      .from("signals")
      .select("id, score, regime, news_risk, stop_pct, risk_reward")
      .in("id", signalIds);

    for (const s of signals ?? []) {
      signalContext.set(s.id, {
        score: s.score,
        regime: s.regime,
        newsRisk: s.news_risk,
        stopPct: s.stop_pct,
        riskReward: s.risk_reward,
      });
    }
  }

  return trades.map((t) => {
    const ctx = t.signal_id ? signalContext.get(t.signal_id) : undefined;
    const entry = t.entry_price ?? 0;

    return {
      id: t.id,
      // Every row here opened as a real PAPER position and settled against
      // real candles. That is what `actual` means.
      actual: true,
      symbol: t.symbol,
      strategyVersion: t.strategy_version_id,
      score: ctx?.score ?? null,
      regime: ctx?.regime ?? null,
      newsRisk: normalizeNewsRisk(ctx?.newsRisk),
      // Stop distance doubles as the volatility proxy for banding when no ATR
      // snapshot is available; it is the same quantity the sizing used.
      volatility: ctx?.stopPct ?? null,
      stopDistancePct: ctx?.stopPct ?? null,
      plannedRiskReward: ctx?.riskReward ?? null,
      executionMode: "PAPER" as const,
      openedAt: t.opened_at ? Date.parse(t.opened_at) : 0,
      closedAt: t.closed_at ? Date.parse(t.closed_at) : null,
      pnl: t.pnl,
      grossPnl: t.gross_pnl,
      fees: t.fees ?? 0,
      slippage: t.slippage ?? 0,
      rMultiple: t.r_multiple,
      excursions:
        t.mfe_price !== null || t.mae_price !== null
          ? {
              mfePrice: t.mfe_price ?? 0,
              maePrice: t.mae_price ?? 0,
              mfePct: entry > 0 ? (t.mfe_price ?? 0) / entry : 0,
              maePct: entry > 0 ? (t.mae_price ?? 0) / entry : 0,
              mfeR: t.mfe_r,
              maeR: t.mae_r,
            }
          : null,
    } satisfies LearningTrade;
  });
}

function normalizeNewsRisk(value: string | null | undefined): LearningTrade["newsRisk"] {
  if (value === "LOW" || value === "MEDIUM" || value === "HIGH") return value;
  return "UNKNOWN";
}

/**
 * Counts the candidate funnel for a window. Answers "how selective was the
 * system?" - which is the question that makes a low trade count
 * interpretable rather than alarming.
 */
export async function loadResearchFunnel(
  client: SupabaseClient<Database>,
  windowId: string,
): Promise<CandidateFunnel> {
  const { data: signals } = await client
    .from("signals")
    .select("classification, rejection_reason, approval_status, decision_source")
    .eq("research_session_id", windowId);

  const rows = signals ?? [];
  const candidates = rows.filter((s) => s.classification === "CANDIDATE");

  return {
    candidates: candidates.length,
    // A candidate that reached PENDING cleared the entire deterministic
    // pipeline; one carrying a rejection_reason was stopped by it.
    riskValidCandidates: candidates.filter((s) => !s.rejection_reason).length,
    executed: candidates.filter((s) => s.approval_status === "APPROVED").length,
    executedAutomatically: candidates.filter(
      (s) => s.approval_status === "APPROVED" && s.decision_source === "AUTO",
    ).length,
  };
}

/** Current PAPER equity, used only to report where the experiment stands. */
export async function loadPaperEquity(client: SupabaseClient<Database>): Promise<number | null> {
  const { data } = await client
    .from("portfolio_snapshots")
    .select("equity")
    .eq("trading_mode", "PAPER")
    .order("taken_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.equity ?? null;
}

/** Assembles the full evidence report for a window from persisted state. */
export async function buildResearchReportFor(
  client: SupabaseClient<Database>,
  window: ResearchWindow,
): Promise<ResearchReport> {
  const [trades, funnel, endingEquity] = await Promise.all([
    loadResearchTrades(client, window.id),
    loadResearchFunnel(client, window.id),
    loadPaperEquity(client),
  ]);

  return buildResearchReport({ window, trades, funnel, endingEquity });
}
