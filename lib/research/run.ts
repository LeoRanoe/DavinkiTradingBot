import type { SupabaseClient } from "@supabase/supabase-js";
import type { Candle } from "@/lib/bybit/types";
import type { Database } from "@/lib/supabase/database.types";
import { STRATEGY_V1_PARAMS } from "@/lib/strategy/v1/config";
import { resolveRiskBudget } from "@/lib/risk/position-sizing";
import { toRiskLimits, type OwnerRiskSettings } from "@/lib/settings/risk-settings";
import type { InstrumentRules } from "@/lib/risk/types";
import { analyzeComponents, analyzeExcursions, analyzeRegimes, analyzeScoreBands } from "./analysis";
import { authoritative, shadow, type HarnessConfig, type ResearchTrade } from "./harness";
import {
  costStressScenarios,
  defaultParameterVariants,
  entryDelayScenarios,
  runBaseline,
  runRobustness,
  runSplits,
  runStopTargetResearch,
  runStress,
  runWalkForward,
  stopTargetVariants,
  type MarketHistory,
} from "./suite";

/**
 * Orchestrates one complete historical research pass.
 *
 * Order is deliberate and mirrors the research discipline: the UNCHANGED
 * baseline is established first, and only then is anything varied. Running
 * the sweeps first and picking a baseline afterwards would make every
 * subsequent number a selection effect.
 */

export type HistoricalResearchResult = {
  generatedAt: string;
  coverage: Array<{ symbol: string; candles15m: number; candles1h: number; from: string | null; to: string | null }>;
  config: Omit<HarnessConfig, "symbol">;
  baseline: ReturnType<typeof runBaseline>;
  splits: ReturnType<typeof runSplits>;
  walkForward: ReturnType<typeof runWalkForward> | null;
  robustness: ReturnType<typeof runRobustness>;
  costStress: ReturnType<typeof runStress>;
  entryDelay: ReturnType<typeof runStress>;
  stopTarget: ReturnType<typeof runStopTargetResearch>;
  scoreBands: ReturnType<typeof analyzeScoreBands>;
  components: ReturnType<typeof analyzeComponents>;
  regimes: ReturnType<typeof analyzeRegimes>;
  excursions: ReturnType<typeof analyzeExcursions>;
  warnings: string[];
};

/** Loads stored candles for one symbol/timeframe. Research only. */
export async function loadHistory(
  client: SupabaseClient<Database>,
  symbol: string,
  timeframe: "15M" | "1H",
  limit = 50_000,
): Promise<Candle[]> {
  const rows: Candle[] = [];
  const pageSize = 1000;

  // Paged: PostgREST caps a single response, and a year of 15m candles is
  // ~35k rows. Ordered ascending so the result is already chronological.
  for (let offset = 0; offset < limit; offset += pageSize) {
    const { data, error } = await client
      .from("candles")
      .select("symbol, timeframe, open_time, open, high, low, close, volume, is_closed")
      .eq("symbol", symbol)
      .eq("timeframe", timeframe)
      .order("open_time", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error || !data || data.length === 0) break;

    for (const c of data) {
      rows.push({
        symbol: c.symbol,
        timeframe: c.timeframe,
        openTime: Date.parse(c.open_time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        isClosed: c.is_closed,
      });
    }

    if (data.length < pageSize) break;
  }

  return rows;
}

export async function loadInstrumentRules(
  client: SupabaseClient<Database>,
  symbol: string,
): Promise<InstrumentRules | null> {
  const { data } = await client
    .from("instrument_metadata")
    .select("tick_size, qty_step, min_order_qty, min_order_amt, max_order_qty")
    .eq("symbol", symbol)
    .maybeSingle();

  if (!data) return null;
  return {
    tickSize: data.tick_size,
    qtyStep: data.qty_step,
    minOrderQty: data.min_order_qty,
    minOrderAmt: data.min_order_amt,
    maxOrderQty: data.max_order_qty,
  };
}

export type ResearchRunOptions = {
  /** Equity the historical run is sized against. */
  equity?: number;
  /** Collect sub-threshold bands. On by default - it is the point. */
  includeShadowBands?: boolean;
  /** Cap on candles per symbol, to bound runtime. */
  maxCandles?: number;
  walkForwardDevelopment?: number;
  walkForwardValidation?: number;
};

/**
 * Builds the harness config from the OWNER'S OWN live settings.
 *
 * Using the real configured risk mode, thresholds and costs is what makes the
 * historical numbers comparable to the live PAPER run. Inventing friendlier
 * research settings would produce a result about a strategy nobody is
 * actually running.
 */
export function configFromSettings(
  settings: OwnerRiskSettings,
  instrument: InstrumentRules,
  equity: number,
): Omit<HarnessConfig, "symbol"> {
  const riskBudget = resolveRiskBudget(
    { equity, availableBalance: equity, openPositionsCount: 0, tradesOpenedTodayUtc: 0, losingTradesTodayUtc: 0 },
    toRiskLimits(settings),
  );

  return {
    riskBudget,
    equity,
    instrument,
    feeBps: settings.feeBps,
    slippageBps: settings.slippageBps,
    minCandidateScore: settings.minCandidateScore,
    minRiskReward: settings.minRiskReward,
    maxAtrPct: settings.maxAtrPct,
    includeShadowBands: true,
    shadowMinScore: 60,
  };
}

/**
 * Runs the full historical programme.
 *
 * Every stage is kept separate in the result. They are never blended into a
 * single performance number: an in-sample development figure and an untouched
 * holdout figure mean completely different things, and averaging them would
 * destroy exactly the information the exercise exists to produce.
 */
export async function runHistoricalResearch(
  client: SupabaseClient<Database>,
  settings: OwnerRiskSettings,
  options: ResearchRunOptions = {},
): Promise<HistoricalResearchResult> {
  const warnings: string[] = [];
  const equity = options.equity ?? 1000;
  const maxCandles = options.maxCandles ?? 50_000;

  const histories: MarketHistory[] = [];
  const coverage: HistoricalResearchResult["coverage"] = [];
  let instrument: InstrumentRules | null = null;

  for (const symbol of STRATEGY_V1_PARAMS.symbols) {
    const [candles15m, candles1h] = await Promise.all([
      loadHistory(client, symbol, "15M", maxCandles),
      loadHistory(client, symbol, "1H", maxCandles),
    ]);

    coverage.push({
      symbol,
      candles15m: candles15m.length,
      candles1h: candles1h.length,
      from: candles15m[0] ? new Date(candles15m[0].openTime).toISOString() : null,
      to: candles15m.at(-1) ? new Date(candles15m.at(-1)!.openTime).toISOString() : null,
    });

    if (candles15m.length < 1000 || candles1h.length < 250) {
      warnings.push(
        `${symbol}: only ${candles15m.length} 15m and ${candles1h.length} 1h candles stored - too little history for a meaningful run.`,
      );
      continue;
    }

    histories.push({ symbol, candles1h, candles15m });
    instrument = instrument ?? (await loadInstrumentRules(client, symbol));
  }

  if (!instrument) {
    // Fail closed rather than invent exchange rules: a fabricated minimum
    // order size would silently change which trades are possible.
    throw new Error("No instrument metadata stored; refusing to size a research run against invented exchange rules.");
  }

  const config = configFromSettings(settings, instrument, equity);

  // ---- F. The untouched baseline, FIRST -------------------------------
  const baseline = runBaseline(histories, config);
  const authoritativeTrades = baseline.allTrades;
  const allTrades: ResearchTrade[] = [...baseline.allTrades, ...baseline.shadowTrades];

  if (authoritativeTrades.length === 0) {
    warnings.push("The unchanged Strategy V1 produced no executable trades over the stored history.");
  }

  // ---- G. Chronological splits ----------------------------------------
  let splits: ReturnType<typeof runSplits>;
  try {
    splits = runSplits(authoritativeTrades, 0.6, 0.2);
  } catch {
    splits = {
      development: emptyMetrics(),
      validation: emptyMetrics(),
      holdout: emptyMetrics(),
      counts: { development: 0, validation: 0, holdout: 0 },
      boundaries: { developmentEnd: null, validationEnd: null },
    };
    warnings.push("Too few trades to form a chronological development/validation/holdout split.");
  }

  // ---- H. Walk-forward -------------------------------------------------
  const devSize = options.walkForwardDevelopment ?? Math.max(20, Math.floor(authoritativeTrades.length * 0.3));
  const valSize = options.walkForwardValidation ?? Math.max(10, Math.floor(authoritativeTrades.length * 0.1));
  let walkForward: ReturnType<typeof runWalkForward> | null = null;
  if (authoritativeTrades.length >= devSize + valSize) {
    walkForward = runWalkForward(authoritativeTrades, devSize, valSize);
  } else {
    warnings.push(
      `Not enough trades (${authoritativeTrades.length}) for walk-forward with a ${devSize}/${valSize} window.`,
    );
  }

  // ---- I / J / K / N. Variants and stress ------------------------------
  const robustness = runRobustness(histories, config, defaultParameterVariants(config));
  const costStress = runStress(histories, config, costStressScenarios(config));
  const entryDelay = runStress(histories, config, entryDelayScenarios());
  const stopTarget = runStopTargetResearch(histories, config, stopTargetVariants());

  // ---- C / D / L / M. Descriptive analysis -----------------------------
  const scoreBands = analyzeScoreBands(allTrades);
  const components = analyzeComponents(authoritativeTrades);
  const regimes = analyzeRegimes(authoritativeTrades);
  const excursions = analyzeExcursions(authoritativeTrades);

  if (regimes.concentrationWarning) warnings.push(regimes.concentrationWarning);
  if (!costStress.survivesAll) {
    warnings.push("The measured edge does not survive every hostile cost scenario.");
  }

  return {
    generatedAt: new Date().toISOString(),
    coverage,
    config,
    baseline,
    splits,
    walkForward,
    robustness,
    costStress,
    entryDelay,
    stopTarget,
    scoreBands,
    components,
    regimes,
    excursions,
    warnings,
  };
}

function emptyMetrics() {
  return {
    sampleCount: 0, wins: 0, losses: 0, breakeven: 0, winRate: null,
    averageWin: null, averageLoss: null, averageR: null, medianR: null,
    expectancyR: null, profitFactor: null, grossProfit: 0, grossLoss: 0,
    netPnl: 0, fees: 0, slippage: 0, maxDrawdown: 0, maxLosingStreak: 0,
    averageMfeR: null, averageMaeR: null, averageDurationMinutes: null,
    evidenceLevel: "NO_DATA" as const,
  };
}

/**
 * Persists the run's findings as research hypotheses for OWNER review.
 *
 * A hypothesis is a recorded observation, never an instruction. Nothing in
 * this system reads these rows back and acts on them: promoting one into a
 * parameter change is a human decision.
 */
export async function persistHypotheses(
  client: SupabaseClient<Database>,
  result: HistoricalResearchResult,
): Promise<number> {
  const sampleCount = result.baseline.combined.sampleCount;
  const statements: string[] = [
    ...result.components.hypotheses,
    ...result.excursions.observations,
    result.scoreBands.correlationNote,
    ...Object.values(result.robustness.stability).map((s) => `${s.parameter}: ${s.note}`),
    ...result.warnings,
  ].filter((s) => s && s.length > 0);

  if (statements.length === 0) return 0;

  const rows = statements.map((description) => ({
    // The existing vocabulary already fits: these come from deterministic
    // analysis, and PROPOSED is exactly what an unreviewed observation is.
    source: "DETERMINISTIC_ANALYTICS",
    description: description.slice(0, 2000),
    supporting_metrics: {
      sampleCount,
      expectancyR: result.baseline.combined.expectancyR,
      profitFactor: result.baseline.combined.profitFactor,
      holdoutExpectancyR: result.splits.holdout.expectancyR,
      walkForwardExpectancyR: result.walkForward?.unseen.expectancyR ?? null,
    } as never,
    sample_count: sampleCount,
    evidence_level: result.baseline.combined.evidenceLevel,
    status: "PROPOSED",
  }));

  const { error } = await client.from("research_hypotheses").insert(rows as never);
  return error ? 0 : rows.length;
}

export { authoritative, shadow };
