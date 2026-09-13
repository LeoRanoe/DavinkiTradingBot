import type { AffectedAsset, CandidateNewsContext, NewsEvent, NewsRisk } from "./types";

/**
 * Builds the news context attached to a candidate AT DECISION TIME.
 *
 * Two hard rules:
 *  1. This is a SNAPSHOT. Whatever is returned here is persisted with the
 *     candidate and never recomputed, so viewing an old trade shows what was
 *     known then - not what is known now.
 *  2. It is CONTEXT ONLY. Nothing derived here reaches position sizing, the
 *     stop, the target, the entry zone, eligibility or execution. The risk
 *     engine does not import this module, and a candidate that is otherwise
 *     valid stays valid when news is unavailable.
 */

/** How recent an event must be to count as context for a new candidate. */
export const DEFAULT_NEWS_WINDOW_MS = 12 * 60 * 60 * 1000;
/** Telegram stays readable: a handful of events, not a feed dump. */
export const MAX_CONTEXT_EVENTS = 3;
/** Below this, an event is noise rather than context. */
export const MIN_CONTEXT_RELEVANCE = 0.35;

const RISK_ORDER: NewsRisk[] = ["LOW", "MEDIUM", "HIGH"];

function assetsForSymbol(symbol: string): AffectedAsset[] {
  const upper = symbol.toUpperCase();
  const assets: AffectedAsset[] = ["CRYPTO_MARKET"];
  if (upper.startsWith("BTC")) assets.push("BTC");
  if (upper.startsWith("ETH")) assets.push("ETH");
  return assets;
}

export function selectRelevantEvents(input: {
  symbol: string;
  events: NewsEvent[];
  nowMs: number;
  windowMs?: number;
}): NewsEvent[] {
  const windowMs = input.windowMs ?? DEFAULT_NEWS_WINDOW_MS;
  const wanted = new Set(assetsForSymbol(input.symbol));

  return input.events
    .filter((event) => {
      const age = input.nowMs - Date.parse(event.publishedAt);
      if (!Number.isFinite(age) || age < 0 || age > windowMs) return false;
      if (event.relevanceScore < MIN_CONTEXT_RELEVANCE) return false;
      return event.affectedAssets.some((asset) => wanted.has(asset));
    })
    .sort((a, b) => {
      // Highest risk first, then most relevant, then most recent - the owner
      // should see the thing most likely to matter at the top.
      const riskDelta = RISK_ORDER.indexOf(b.newsRisk) - RISK_ORDER.indexOf(a.newsRisk);
      if (riskDelta !== 0) return riskDelta;
      if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore;
      return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
    })
    .slice(0, MAX_CONTEXT_EVENTS);
}

export function buildCandidateNewsContext(input: {
  symbol: string;
  events: NewsEvent[];
  nowMs: number;
  windowMs?: number;
  /** True when the news subsystem itself could not be consulted. */
  unavailable?: boolean;
}): CandidateNewsContext {
  const generatedAt = new Date(input.nowMs).toISOString();

  if (input.unavailable) {
    return {
      newsRisk: "UNKNOWN",
      headline: null,
      status: "UNAVAILABLE",
      generatedAt,
      events: [],
    };
  }

  const selected = selectRelevantEvents(input);

  if (selected.length === 0) {
    // Genuinely nothing relevant found is LOW, and is a different statement
    // from "we could not look", which is UNKNOWN above.
    return {
      newsRisk: "LOW",
      headline: null,
      status: "NO_RELEVANT_EVENTS",
      generatedAt,
      events: [],
    };
  }

  const highest = selected.reduce<NewsRisk>((worst, event) => {
    if (event.newsRisk === "UNKNOWN") return worst;
    return RISK_ORDER.indexOf(event.newsRisk) > RISK_ORDER.indexOf(worst) ? event.newsRisk : worst;
  }, "LOW");

  const lead = selected[0];

  return {
    newsRisk: highest,
    headline: lead.analysis?.summary ?? lead.headline,
    status: "OK",
    generatedAt,
    events: selected.map((event) => ({
      id: event.id,
      headline: event.headline,
      source: event.source,
      sourceQuality: event.sourceQuality,
      category: event.category,
      publishedAt: event.publishedAt,
      newsRisk: event.newsRisk,
      summary: event.analysis?.summary ?? null,
    })),
  };
}
