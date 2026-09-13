import { analyzeNewsEvent } from "@/lib/qwen/client";
import { classifyAiError, nullUsageRecorder, type AiUsageRecorder } from "@/lib/ai/usage";
import type { AnalysisOutcome, NewsAnalyzer } from "./ingest";
import type { AffectedAsset } from "./types";

/**
 * The Qwen-backed news analyzer, with usage accounting attached.
 *
 * Every failure mode - missing credential, auth, rate limit, timeout,
 * malformed structured output - resolves to a plain outcome the caller can
 * handle. Nothing here throws, because news analysis failing must never
 * reach the scanner, the risk engine, Telegram or PAPER management.
 */
export function createQwenNewsAnalyzer(recorder: AiUsageRecorder = nullUsageRecorder): NewsAnalyzer {
  return {
    async analyze(input): Promise<AnalysisOutcome> {
      const result = await analyzeNewsEvent(input);

      if (result.status === "NOT_CONFIGURED") {
        await recorder.record({ feature: "NEWS_ANALYSIS", success: false, errorKind: "NOT_CONFIGURED" });
        return { status: "NOT_CONFIGURED" };
      }

      if (result.status === "ERROR") {
        await recorder.record({
          feature: "NEWS_ANALYSIS",
          success: false,
          usage: result.usage,
          errorKind: classifyAiError(result.message),
        });
        return { status: "ERROR", message: result.message };
      }

      await recorder.record({ feature: "NEWS_ANALYSIS", success: true, usage: result.usage });

      return {
        status: "OK",
        model: result.usage?.model ?? null,
        analysis: {
          summary: result.data.summary,
          affectedAssets: result.data.affectedAssets as AffectedAsset[],
          sentiment: result.data.sentiment,
          potentialImpact: result.data.potentialImpact,
          timeHorizon: result.data.timeHorizon,
          relevance: result.data.relevance,
          reasoning: result.data.reasoning,
          uncertainty: result.data.uncertainty,
        },
      };
    },
  };
}

/** Used when the AI layer is deliberately not consulted. */
export const unavailableNewsAnalyzer: NewsAnalyzer = {
  async analyze(): Promise<AnalysisOutcome> {
    return { status: "NOT_CONFIGURED" };
  },
};
