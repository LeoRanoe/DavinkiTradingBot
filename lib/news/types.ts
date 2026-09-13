/**
 * News Intelligence domain model (Task A / Milestone 3).
 *
 * News is CONTEXT, never a trading engine. Nothing in this module may
 * create a trade, resize a position, move a stop or target, or turn an
 * invalid candidate into a valid one. The deterministic strategy and risk
 * layers decide; news only helps the owner understand conditions.
 *
 * The model is deliberately instrument-agnostic: `AffectedAsset` and
 * `NewsCategory` already carry the macro/FX vocabulary a future XAUUSD
 * instrument would need (Fed decisions, CPI, yields, geopolitics), even
 * though only BTC/ETH/CRYPTO_MARKET are used today.
 */

export const AFFECTED_ASSETS = [
  "BTC",
  "ETH",
  "CRYPTO_MARKET",
  // Not traded today. Present so macro events can already be modeled and a
  // future metals/FX instrument reuses this exact event framework.
  "USD",
  "MACRO",
  "XAUUSD",
] as const;
export type AffectedAsset = (typeof AFFECTED_ASSETS)[number];

export const NEWS_CATEGORIES = [
  "REGULATION",
  "ETF",
  "MACRO",
  "INTEREST_RATES",
  "INFLATION",
  "EXCHANGE",
  "SECURITY_HACK",
  "PROTOCOL",
  "TOKEN_SUPPLY",
  "ADOPTION",
  "LEGAL",
  "GEOPOLITICAL",
  "MARKET_FLOW",
  "OTHER",
] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

/**
 * Confidence in the SOURCE, never a view on market direction. A rumor from
 * a secondary outlet stays uncertain no matter how dramatic it sounds.
 */
export const SOURCE_QUALITIES = ["OFFICIAL", "HIGH_QUALITY_MEDIA", "SECONDARY", "UNKNOWN"] as const;
export type SourceQuality = (typeof SOURCE_QUALITIES)[number];

/**
 * How much uncertainty / event risk this information may introduce around a
 * candidate. Explicitly NOT a buy or sell signal.
 */
export const NEWS_RISKS = ["LOW", "MEDIUM", "HIGH", "UNKNOWN"] as const;
export type NewsRisk = (typeof NEWS_RISKS)[number];

export const ANALYSIS_STATUSES = [
  "NOT_REQUIRED",
  "PENDING",
  "COMPLETED",
  "FAILED",
  "UNAVAILABLE",
] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

/** A single item as it arrived from one provider, before deduplication. */
export type NormalizedNewsItem = {
  provider: string;
  source: string;
  sourceQuality: SourceQuality;
  headline: string;
  canonicalUrl: string;
  publishedAt: string; // ISO
  fetchedAt: string; // ISO
  /** Short plain-text excerpt. Never a full article - storage stays compact and copying stays minimal. */
  excerpt: string | null;
  /** Provider-supplied identifier when present (RSS guid / Atom id). */
  externalId: string | null;
};

/** The deterministic classification applied before any AI is considered. */
export type NewsClassification = {
  category: NewsCategory;
  affectedAssets: AffectedAsset[];
  /** 0..1. Higher means more likely to matter to the traded instruments. */
  relevanceScore: number;
  /** Deterministic baseline. AI analysis may refine it, never override it downward without evidence. */
  baseRisk: NewsRisk;
  /** Which deterministic signals fired, so a classification can be explained. */
  matchedTerms: string[];
};

/** A deduplicated real-world event, as persisted. */
export type NewsEvent = {
  id: string;
  eventHash: string;
  provider: string;
  source: string;
  sourceQuality: SourceQuality;
  headline: string;
  canonicalUrl: string;
  excerpt: string | null;
  publishedAt: string;
  fetchedAt: string;
  category: NewsCategory;
  affectedAssets: AffectedAsset[];
  relevanceScore: number;
  newsRisk: NewsRisk;
  analysisStatus: AnalysisStatus;
  analysis: NewsAnalysis | null;
  analysisModel: string | null;
  analyzedAt: string | null;
  duplicateCount: number;
};

/** Validated structured output from the AI layer. Never free-form prose used as state. */
export type NewsAnalysis = {
  summary: string;
  affectedAssets: AffectedAsset[];
  sentiment: "POSITIVE" | "NEGATIVE" | "MIXED" | "NEUTRAL" | "UNKNOWN";
  potentialImpact: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
  timeHorizon: "IMMEDIATE" | "SHORT_TERM" | "MEDIUM_TERM" | "UNKNOWN";
  relevance: number;
  reasoning: string;
  uncertainty: string;
};

/**
 * The immutable news context attached to a candidate at decision time.
 *
 * This is a SNAPSHOT on purpose: viewing an old candidate must show what was
 * known then, never what is known now. Milestone 4 depends on that.
 */
export type CandidateNewsContext = {
  newsRisk: NewsRisk;
  /** One short line for Telegram. Null when there is nothing worth saying. */
  headline: string | null;
  status: "OK" | "NO_RELEVANT_EVENTS" | "UNAVAILABLE";
  generatedAt: string;
  events: Array<{
    id: string;
    headline: string;
    source: string;
    sourceQuality: SourceQuality;
    category: NewsCategory;
    publishedAt: string;
    newsRisk: NewsRisk;
    summary: string | null;
  }>;
};
