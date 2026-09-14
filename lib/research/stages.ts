import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { STRATEGY_V1_PARAMS } from "@/lib/strategy/v1/config";
import type { OwnerRiskSettings } from "@/lib/settings/risk-settings";
import { analyzeComponents, analyzeExcursions, analyzeRegimes, analyzeScoreBands } from "./analysis";
import type { HarnessConfig } from "./harness";
import { configFromSettings, loadHistory, loadInstrumentRules } from "./run";
import {
  costStressScenarios,
  defaultParameterVariants,
  entryDelayScenarios,
  metricsFor,
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
 * Staged execution of the historical research programme.
 *
 * WHY STAGED: a full year of 15m candles is ~35,000 evaluations per symbol,
 * and the complete suite - baseline plus nine parameter variants plus cost,
 * delay and stop/target scenarios - is several minutes of CPU. The job runtime
 * available here is a single minute, so the suite is addressable one stage at
 * a time and each stage persists its own slice. The report is assembled from
 * the stored stages afterwards.
 *
 * Splitting it this way changes no result: every stage runs the same harness
 * over the same stored candles with the same config, so a staged run and a
 * hypothetical single-shot run would produce identical numbers.
 */

export type ResearchStage =
  | "BASELINE"
  | "ROBUSTNESS"
  | "COST_STRESS"
  | "ENTRY_DELAY"
  | "STOP_TARGET";

export const RESEARCH_STAGES: readonly ResearchStage[] = [
  "BASELINE",
  "ROBUSTNESS",
  "COST_STRESS",
  "ENTRY_DELAY",
  "STOP_TARGET",
];

export type StageContext = {
  histories: MarketHistory[];
  config: Omit<HarnessConfig, "symbol">;
  coverage: Array<{ symbol: string; candles15m: number; candles1h: number; from: string | null; to: string | null }>;
  warnings: string[];
};

/** Loads the stored history and builds the shared config once per invocation. */
export async function prepareStageContext(
  client: SupabaseClient<Database>,
  settings: OwnerRiskSettings,
  options: { equity?: number; maxCandles?: number } = {},
): Promise<StageContext> {
  const equity = options.equity ?? 1000;
  const maxCandles = options.maxCandles ?? 50_000;
  const warnings: string[] = [];
  const histories: MarketHistory[] = [];
  const coverage: StageContext["coverage"] = [];
  let instrument = null;

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
      warnings.push(`${symbol}: too little stored history (${candles15m.length} x 15m, ${candles1h.length} x 1h).`);
      continue;
    }

    histories.push({ symbol, candles1h, candles15m });
    instrument = instrument ?? (await loadInstrumentRules(client, symbol));
  }

  if (!instrument) {
    // Fail closed: inventing exchange rules would silently change which
    // trades are possible and make every number meaningless.
    throw new Error("No instrument metadata stored; refusing to size a research run against invented exchange rules.");
  }

  return { histories, config: configFromSettings(settings, instrument, equity), coverage, warnings };
}

export type StageResult = {
  stage: ResearchStage;
  generatedAt: string;
  coverage: StageContext["coverage"];
  payload: unknown;
  warnings: string[];
};

/**
 * Runs one stage. The BASELINE stage is the only one that also produces the
 * descriptive analysis, because it is the only one whose trades represent
 * unchanged V1 - running the breakdowns on a variant's trades would describe
 * a strategy that does not exist.
 */
export function runStage(stage: ResearchStage, context: StageContext): StageResult {
  const { histories, config } = context;
  const base = { stage, generatedAt: new Date().toISOString(), coverage: context.coverage, warnings: [...context.warnings] };

  switch (stage) {
    case "BASELINE": {
      const baseline = runBaseline(histories, config);
      const authoritativeTrades = baseline.allTrades;
      const allTrades = [...baseline.allTrades, ...baseline.shadowTrades];

      let splits;
      try {
        splits = runSplits(authoritativeTrades, 0.6, 0.2);
      } catch {
        base.warnings.push("Too few trades for a chronological development/validation/holdout split.");
        splits = null;
      }

      const devSize = Math.max(20, Math.floor(authoritativeTrades.length * 0.3));
      const valSize = Math.max(10, Math.floor(authoritativeTrades.length * 0.1));
      const walkForward =
        authoritativeTrades.length >= devSize + valSize
          ? runWalkForward(authoritativeTrades, devSize, valSize)
          : null;
      if (!walkForward) {
        base.warnings.push(`Not enough trades (${authoritativeTrades.length}) for walk-forward.`);
      }

      const regimes = analyzeRegimes(authoritativeTrades);
      if (regimes.concentrationWarning) base.warnings.push(regimes.concentrationWarning);

      return {
        ...base,
        payload: {
          combined: baseline.combined,
          perSymbol: Object.fromEntries(
            Object.entries(baseline.perSymbol).map(([k, v]) => [k, { metrics: v.metrics, trades: v.trades, skips: v.skips }]),
          ),
          authoritativeCount: authoritativeTrades.length,
          shadowCount: baseline.shadowTrades.length,
          bandCounts: baseline.bandCounts,
          skipReasons: baseline.skipReasons,
          splits,
          walkForward: walkForward
            ? { windows: walkForward.windows, unseen: walkForward.unseen }
            : null,
          scoreBands: analyzeScoreBands(allTrades),
          shadowMetrics: metricsFor(baseline.shadowTrades),
          components: analyzeComponents(authoritativeTrades),
          regimes: {
            bySymbol: regimes.bySymbol,
            byRegime: regimes.byRegime,
            byVolatility: regimes.byVolatility,
            concentrationWarning: regimes.concentrationWarning,
          },
          excursions: analyzeExcursions(authoritativeTrades),
        },
      };
    }

    case "ROBUSTNESS":
      return { ...base, payload: runRobustness(histories, config, defaultParameterVariants(config)) };

    case "COST_STRESS":
      return { ...base, payload: runStress(histories, config, costStressScenarios(config)) };

    case "ENTRY_DELAY":
      return { ...base, payload: runStress(histories, config, entryDelayScenarios()) };

    case "STOP_TARGET":
      return { ...base, payload: runStopTargetResearch(histories, config, stopTargetVariants()) };
  }
}

/** Persists one stage's result so the report can be assembled later. */
export async function persistStage(
  client: SupabaseClient<Database>,
  result: StageResult,
  jobRunId: string | undefined,
): Promise<void> {
  if (!jobRunId) return;
  await client
    .from("job_runs")
    .update({
      status: "SUCCEEDED",
      completed_at: new Date().toISOString(),
      error_summary: result.warnings.join("; ") || null,
      metadata: {
        stage: result.stage,
        generatedAt: result.generatedAt,
        coverage: result.coverage,
        payload: result.payload,
      } as never,
    })
    .eq("id", jobRunId);
}

/** Reads back the most recent successful result for each stage. */
export async function loadLatestStages(
  client: SupabaseClient<Database>,
): Promise<Partial<Record<ResearchStage, StageResult>>> {
  const { data } = await client
    .from("job_runs")
    .select("metadata, started_at, status")
    .eq("job_name", "research_run")
    .eq("status", "SUCCEEDED")
    .order("started_at", { ascending: false })
    .limit(60);

  const out: Partial<Record<ResearchStage, StageResult>> = {};
  for (const row of data ?? []) {
    const meta = row.metadata as { stage?: ResearchStage; generatedAt?: string; coverage?: never; payload?: unknown } | null;
    if (!meta?.stage || out[meta.stage]) continue;
    out[meta.stage] = {
      stage: meta.stage,
      generatedAt: meta.generatedAt ?? row.started_at,
      coverage: (meta.coverage ?? []) as StageContext["coverage"],
      payload: meta.payload,
      warnings: [],
    };
  }
  return out;
}
