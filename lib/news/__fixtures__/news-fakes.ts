import type { DuplicateCandidate } from "../dedupe";
import type { AnalysisOutcome, NewsAnalyzer, NewsStore } from "../ingest";
import type { NewsProvider } from "../providers";
import type { NewsAnalysis, NewsEvent, NormalizedNewsItem, SourceQuality } from "../types";

/** In-memory NewsStore modelling the unique constraint on event_hash. */
export type FakeNewsDb = {
  events: NewsEvent[];
  duplicates: Array<{ eventId: string; url: string; reason: string; similarity: number }>;
  analysisFailures: Array<{ eventId: string; status: string }>;
};

export function makeNewsDb(): FakeNewsDb {
  return { events: [], duplicates: [], analysisFailures: [] };
}

let counter = 0;

export function createFakeNewsStore(db: FakeNewsDb): NewsStore {
  return {
    async loadRecentEvents(sinceIso): Promise<DuplicateCandidate[]> {
      return db.events
        .filter((e) => e.publishedAt >= sinceIso)
        .map((e) => ({
          id: e.id,
          canonicalUrl: e.canonicalUrl,
          headline: e.headline,
          publishedAt: e.publishedAt,
        }));
    },
    async insertEvent({ eventHash, item, classification, newsRisk, analysisStatus }) {
      // The unique constraint on event_hash: a concurrent insert loses.
      if (db.events.some((e) => e.eventHash === eventHash)) return null;
      counter += 1;
      const id = `evt-${counter}`;
      db.events.push({
        id,
        eventHash,
        provider: item.provider,
        source: item.source,
        sourceQuality: item.sourceQuality,
        headline: item.headline,
        canonicalUrl: item.canonicalUrl,
        excerpt: item.excerpt,
        publishedAt: item.publishedAt,
        fetchedAt: item.fetchedAt,
        category: classification.category,
        affectedAssets: classification.affectedAssets,
        relevanceScore: classification.relevanceScore,
        newsRisk,
        analysisStatus,
        analysis: null,
        analysisModel: null,
        analyzedAt: null,
        duplicateCount: 0,
      });
      return id;
    },
    async recordDuplicate({ eventId, item, match }) {
      db.duplicates.push({
        eventId,
        url: item.canonicalUrl,
        reason: match.reason,
        similarity: match.similarity,
      });
      const event = db.events.find((e) => e.id === eventId);
      if (event) event.duplicateCount += 1;
    },
    async saveAnalysis({ eventId, analysis, model, newsRisk, analyzedAtIso }) {
      const event = db.events.find((e) => e.id === eventId);
      if (!event) return;
      event.analysis = analysis;
      event.analysisModel = model;
      event.analyzedAt = analyzedAtIso;
      event.analysisStatus = "COMPLETED";
      event.newsRisk = newsRisk;
    },
    async markAnalysisFailed({ eventId, status }) {
      db.analysisFailures.push({ eventId, status });
      const event = db.events.find((e) => e.id === eventId);
      if (event) event.analysisStatus = status;
    },
  };
}

export function makeItem(overrides: Partial<NormalizedNewsItem> = {}): NormalizedNewsItem {
  return {
    provider: "fake",
    source: "Fake Source",
    sourceQuality: "HIGH_QUALITY_MEDIA" as SourceQuality,
    headline: "Bitcoin news headline that is long enough",
    canonicalUrl: "https://example.com/a",
    publishedAt: "2026-01-10T11:00:00.000Z",
    fetchedAt: "2026-01-10T12:00:00.000Z",
    excerpt: null,
    externalId: null,
    ...overrides,
  };
}

export function createFakeProvider(
  name: string,
  items: NormalizedNewsItem[],
  opts: { fail?: boolean } = {},
): NewsProvider {
  return {
    name,
    source: name,
    sourceQuality: "HIGH_QUALITY_MEDIA",
    async fetchRecentNews() {
      if (opts.fail) throw new Error(`${name} is down`);
      return items;
    },
  };
}

export const SAMPLE_ANALYSIS: NewsAnalysis = {
  summary: "A regulator approved several spot Bitcoin ETF applications.",
  affectedAssets: ["BTC", "CRYPTO_MARKET"],
  sentiment: "POSITIVE",
  potentialImpact: "HIGH",
  timeHorizon: "IMMEDIATE",
  relevance: 0.9,
  reasoning: "A concrete regulatory decision affecting a major listed product.",
  uncertainty: "Market reaction may already be partly priced in.",
};

export function createFakeAnalyzer(
  outcome: AnalysisOutcome = { status: "OK", analysis: SAMPLE_ANALYSIS, model: "qwen-turbo" },
): NewsAnalyzer & { calls: number } {
  const analyzer = {
    calls: 0,
    async analyze(): Promise<AnalysisOutcome> {
      analyzer.calls += 1;
      return outcome;
    },
  };
  return analyzer;
}

export function makeStoredEvent(overrides: Partial<NewsEvent> = {}): NewsEvent {
  return {
    id: "evt-stored",
    eventHash: "hash",
    provider: "fake",
    source: "Fake Source",
    sourceQuality: "OFFICIAL",
    headline: "SEC approves spot Bitcoin ETF applications",
    canonicalUrl: "https://example.com/etf",
    excerpt: null,
    publishedAt: "2026-01-10T11:00:00.000Z",
    fetchedAt: "2026-01-10T11:05:00.000Z",
    category: "ETF",
    affectedAssets: ["BTC", "CRYPTO_MARKET"],
    relevanceScore: 0.9,
    newsRisk: "HIGH",
    analysisStatus: "COMPLETED",
    analysis: SAMPLE_ANALYSIS,
    analysisModel: "qwen-turbo",
    analyzedAt: "2026-01-10T11:06:00.000Z",
    duplicateCount: 0,
    ...overrides,
  };
}
