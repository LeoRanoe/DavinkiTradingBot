import { z } from "zod";
import { AFFECTED_ASSETS } from "@/lib/news/types";

/**
 * Structured news analysis. The model's prose is NEVER application state -
 * only this validated shape is, and even then it can influence one thing:
 * the displayed news-risk label. It cannot reach sizing, stops, targets,
 * eligibility or execution, because none of those read it.
 */
export const qwenNewsAnalysisSchema = z.object({
  summary: z.string().min(1).max(400),
  affectedAssets: z.array(z.enum(AFFECTED_ASSETS)).max(6).default([]),
  sentiment: z.enum(["POSITIVE", "NEGATIVE", "MIXED", "NEUTRAL", "UNKNOWN"]),
  potentialImpact: z.enum(["LOW", "MEDIUM", "HIGH", "UNKNOWN"]),
  timeHorizon: z.enum(["IMMEDIATE", "SHORT_TERM", "MEDIUM_TERM", "UNKNOWN"]),
  relevance: z.number().min(0).max(1),
  reasoning: z.string().min(1).max(600),
  uncertainty: z.string().min(1).max(400),
});

export type QwenNewsAnalysis = z.infer<typeof qwenNewsAnalysisSchema>;
