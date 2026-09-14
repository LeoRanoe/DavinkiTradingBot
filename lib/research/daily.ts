import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { evidenceLevel } from "@/lib/learning/analytics";
import { sendTelegramMessage } from "@/lib/telegram/client";
import { loadResearchTrades, loadPaperEquity } from "./evidence";
import { summarizeShadows } from "./shadow";
import { researchProgress, type ResearchWindow } from "./window";

/**
 * End-of-UTC-day research snapshot and the single daily summary.
 *
 * EXACTLY ONCE, structurally: the snapshot row carries a unique constraint on
 * (research_session_id, utc_date), so a second run on the same day cannot
 * insert - and because the notification is only sent by the caller that
 * actually won the insert, it cannot send a second message either. No
 * in-memory flag or timestamp comparison is relied upon.
 *
 * This is longitudinal record-keeping, not a daily verdict. A single day of a
 * one-position-at-a-time strategy is noise, and the summary is worded so it
 * cannot be read as a daily judgement.
 */

export type DailySnapshotInput = {
  window: ResearchWindow;
  /** The UTC day being closed. Defaults to the day containing `nowMs`. */
  nowMs: number;
};

export type DailySnapshot = {
  utcDate: string;
  dayNumber: number;
  totalDays: number;
  candidates: number;
  tradesOpened: number;
  tradesClosed: number;
  wins: number;
  losses: number;
  realizedPnl: number;
  realizedR: number | null;
  cumulativeR: number | null;
  equity: number | null;
  maxDrawdown: number | null;
  averageMfeR: number | null;
  averageMaeR: number | null;
  counterfactualTotal: number;
  counterfactualSettled: number;
  scannerHealth: string;
  newsHealth: string;
  qwenHealth: string;
  evidence: string;
  bySymbol: Record<string, { trades: number; netPnl: number; r: number | null }>;
};

function utcDayBounds(nowMs: number): { start: number; end: number; date: string } {
  const d = new Date(nowMs);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return { start, end: start + 24 * 60 * 60 * 1000, date: new Date(start).toISOString().slice(0, 10) };
}

/** Reports a job's health from its most recent run, never assumed healthy. */
async function jobHealth(client: SupabaseClient<Database>, jobName: string, staleMs: number): Promise<string> {
  const { data } = await client
    .from("job_runs")
    .select("status, started_at")
    .eq("job_name", jobName)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return "NEVER_RUN";
  const age = Date.now() - Date.parse(data.started_at);
  if (age > staleMs) return `STALE (${Math.round(age / 60_000)}m)`;
  if (data.status === "FAILED") return "FAILED";
  return "OK";
}

async function qwenHealth(client: SupabaseClient<Database>): Promise<string> {
  const { data } = await client
    .from("ai_usage_events")
    .select("success, created_at")
    .order("created_at", { ascending: false })
    .limit(10);

  if (!data || data.length === 0) return "NO_CALLS";
  const failures = data.filter((r) => !r.success).length;
  return failures === 0 ? "OK" : `${failures}/${data.length} recent failures`;
}

export async function buildDailySnapshot(
  client: SupabaseClient<Database>,
  input: DailySnapshotInput,
): Promise<DailySnapshot> {
  const { window, nowMs } = input;
  const { start, end, date } = utcDayBounds(nowMs);
  const progress = researchProgress(window, nowMs);

  // ACTUAL trades only. Counterfactuals are counted separately below and
  // never mixed into these figures.
  const trades = await loadResearchTrades(client, window.id);
  const closedToday = trades.filter((t) => t.closedAt !== null && t.closedAt >= start && t.closedAt < end);
  const openedToday = trades.filter((t) => t.openedAt >= start && t.openedAt < end);
  const allClosed = trades.filter((t) => t.closedAt !== null);

  const wins = closedToday.filter((t) => (t.pnl ?? 0) > 0).length;
  const losses = closedToday.filter((t) => (t.pnl ?? 0) <= 0).length;
  const realizedPnl = closedToday.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const realizedR = closedToday.length
    ? closedToday.reduce((s, t) => s + (t.rMultiple ?? 0), 0)
    : null;
  const cumulativeR = allClosed.length ? allClosed.reduce((s, t) => s + (t.rMultiple ?? 0), 0) : null;

  // Drawdown across the window's realized curve so far.
  let running = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const t of [...allClosed].sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0))) {
    running += t.pnl ?? 0;
    peak = Math.max(peak, running);
    maxDrawdown = Math.max(maxDrawdown, peak - running);
  }

  const { count: candidateCount } = await client
    .from("signals")
    .select("id", { count: "exact", head: true })
    .eq("research_session_id", window.id)
    .eq("classification", "CANDIDATE")
    .gte("candle_time", new Date(start).toISOString())
    .lt("candle_time", new Date(end).toISOString());

  const shadows = await summarizeShadows(client, window.id).catch(() => ({
    total: 0, settled: 0, bySource: {}, byBand: {}, byOutcome: {},
  }));

  const bySymbol: DailySnapshot["bySymbol"] = {};
  for (const t of allClosed) {
    const entry = bySymbol[t.symbol] ?? { trades: 0, netPnl: 0, r: 0 };
    entry.trades += 1;
    entry.netPnl += t.pnl ?? 0;
    entry.r = (entry.r ?? 0) + (t.rMultiple ?? 0);
    bySymbol[t.symbol] = entry;
  }

  const [scannerHealth, newsHealth, qwen, equity] = await Promise.all([
    jobHealth(client, "scan", 20 * 60_000),
    jobHealth(client, "news", 60 * 60_000),
    qwenHealth(client),
    loadPaperEquity(client),
  ]);

  const excursions = allClosed.map((t) => t.excursions).filter((e): e is NonNullable<typeof e> => Boolean(e));
  const mfe = excursions.map((e) => e.mfeR).filter((v): v is number => typeof v === "number");
  const mae = excursions.map((e) => e.maeR).filter((v): v is number => typeof v === "number");

  return {
    utcDate: date,
    dayNumber: progress.day,
    totalDays: progress.totalDays,
    candidates: candidateCount ?? 0,
    tradesOpened: openedToday.length,
    tradesClosed: closedToday.length,
    wins,
    losses,
    realizedPnl,
    realizedR,
    cumulativeR,
    equity,
    maxDrawdown,
    averageMfeR: mfe.length ? mfe.reduce((a, b) => a + b, 0) / mfe.length : null,
    averageMaeR: mae.length ? mae.reduce((a, b) => a + b, 0) / mae.length : null,
    counterfactualTotal: shadows.total,
    counterfactualSettled: shadows.settled,
    scannerHealth,
    newsHealth,
    qwenHealth: qwen,
    evidence: evidenceLevel(allClosed.length),
    bySymbol,
  };
}

export type DailyOutcome =
  | { kind: "RECORDED"; snapshot: DailySnapshot; notified: boolean }
  | { kind: "ALREADY_RECORDED" }
  | { kind: "NOT_DUE" };

/**
 * Persists the snapshot and, only if this caller actually created it, sends
 * the one daily summary.
 *
 * The insert IS the lock. Losing the race returns ALREADY_RECORDED and sends
 * nothing, so overlapping scans cannot double-notify.
 */
export async function recordDailySnapshot(
  client: SupabaseClient<Database>,
  window: ResearchWindow,
  nowMs: number,
  options: { notify?: boolean } = {},
): Promise<DailyOutcome> {
  const { date } = utcDayBounds(nowMs);

  // Cadence is the caller's decision: pass a timestamp inside the day being
  // closed. The unique (session, date) constraint is what guarantees the day
  // is only ever recorded - and notified - once.
  const snapshot = await buildDailySnapshot(client, { window, nowMs });

  const { data, error } = await client
    .from("research_daily_snapshots")
    .insert({
      research_session_id: window.id,
      utc_date: date,
      day_number: snapshot.dayNumber,
      total_days: snapshot.totalDays,
      candidates: snapshot.candidates,
      trades_opened: snapshot.tradesOpened,
      trades_closed: snapshot.tradesClosed,
      wins: snapshot.wins,
      losses: snapshot.losses,
      realized_pnl: snapshot.realizedPnl,
      realized_r: snapshot.realizedR,
      cumulative_r: snapshot.cumulativeR,
      equity: snapshot.equity,
      max_drawdown: snapshot.maxDrawdown,
      average_mfe_r: snapshot.averageMfeR,
      average_mae_r: snapshot.averageMaeR,
      counterfactual_total: snapshot.counterfactualTotal,
      counterfactual_settled: snapshot.counterfactualSettled,
      scanner_health: snapshot.scannerHealth,
      news_health: snapshot.newsHealth,
      qwen_health: snapshot.qwenHealth,
      evidence_level: snapshot.evidence,
      detail: { bySymbol: snapshot.bySymbol } as never,
    } as never)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    // A unique violation means another caller already recorded this day.
    return { kind: "ALREADY_RECORDED" };
  }

  let notified = false;
  if (options.notify !== false) {
    // Telegram is optional and never authoritative: an unavailable integration
    // silently skips the summary and changes nothing about the recorded data
    // or about trading.
    const result = await sendTelegramMessage(formatDailySummary(snapshot)).catch(() => ({ ok: false as const }));
    notified = result.ok === true;
    if (notified) {
      await client
        .from("research_daily_snapshots")
        .update({ notified_at: new Date().toISOString() } as never)
        .eq("id", data.id)
        .then(() => undefined, () => undefined);
    }
  }

  return { kind: "RECORDED", snapshot, notified };
}

/** The one daily message. Concise, factual, and never a daily verdict. */
export function formatDailySummary(s: DailySnapshot): string {
  const money = (v: number | null) => (v === null ? "n/a" : `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}`);
  const r = (v: number | null) => (v === null ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}R`);

  const symbolLines = Object.entries(s.bySymbol).map(
    ([symbol, v]) => `${symbol.padEnd(9)} ${v.trades} trades, ${money(v.netPnl)}, ${r(v.r)}`,
  );

  const health = [
    s.scannerHealth !== "OK" ? `Scanner: ${s.scannerHealth}` : null,
    s.newsHealth !== "OK" ? `News: ${s.newsHealth}` : null,
    s.qwenHealth !== "OK" ? `Qwen: ${s.qwenHealth}` : null,
  ].filter(Boolean) as string[];

  return [
    "Davinki Trading - PAPER Research",
    `Day ${s.dayNumber} / ${s.totalDays}`,
    "",
    `Candidates today   ${s.candidates}`,
    `Trades opened      ${s.tradesOpened}`,
    `Trades closed      ${s.tradesClosed} (${s.wins}W / ${s.losses}L)`,
    `Today              ${money(s.realizedPnl)} ${s.realizedR === null ? "" : r(s.realizedR)}`.trimEnd(),
    `Cumulative         ${r(s.cumulativeR)}`,
    `Equity             ${money(s.equity)}`,
    `Max drawdown       ${money(s.maxDrawdown)}`,
    ...(s.averageMfeR !== null ? [`Avg MFE / MAE      ${s.averageMfeR.toFixed(2)}R / ${(s.averageMaeR ?? 0).toFixed(2)}R`] : []),
    "",
    ...(symbolLines.length ? [...symbolLines, ""] : []),
    "Research samples",
    `Actual             ${s.tradesClosed === 0 && s.cumulativeR === null ? 0 : totalActual(s)}`,
    `Counterfactual     ${s.counterfactualTotal} (${s.counterfactualSettled} settled)`,
    "",
    `Evidence           ${s.evidence}`,
    ...(health.length ? ["", ...health] : []),
    "",
    "One day is not a result. This is a record, not a verdict.",
  ].join("\n");
}

function totalActual(s: DailySnapshot): number {
  // Cumulative R is derived from every closed trade in the window, so its
  // presence is the honest signal that actual trades exist.
  return s.cumulativeR === null ? 0 : Object.values(s.bySymbol).reduce((n, v) => n + v.trades, 0);
}
