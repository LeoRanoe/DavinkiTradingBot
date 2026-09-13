import { classifyNewsItem, combineRisk, shouldAnalyzeWithAi } from "./classify";
import { findDuplicate, type DuplicateCandidate, type DuplicateMatch } from "./dedupe";
import { computeEventHash } from "./normalize";
import type { NewsProvider } from "./providers";
import type { NewsAnalysis, NewsClassification, NewsRisk, NormalizedNewsItem } from "./types";

/**
 * News ingestion. Deliberately separate from the market scanner: the
 * strategy path must never wait on a news fetch, and news failures must
 * never touch trading.
 *
 * Runs as: fetch (per provider, isolated) -> normalize -> deduplicate ->
 * deterministic classify -> AI analysis ONLY where it earns its cost ->
 * persist.
 */

export type StoredEventRef = { id: string; isNew: boolean };

export interface NewsStore {
  /** Recent events used as the deduplication corpus. */
  loadRecentEvents(sinceIso: string): Promise<DuplicateCandidate[]>;
  insertEvent(input: {
    eventHash: string;
    item: NormalizedNewsItem;
    classification: NewsClassification;
    newsRisk: NewsRisk;
    analysisStatus: "NOT_REQUIRED" | "PENDING";
  }): Promise<string | null>;
  /** Records a syndicated copy against an existing event, explaining the match. */
  recordDuplicate(input: {
    eventId: string;
    item: NormalizedNewsItem;
    match: DuplicateMatch;
  }): Promise<void>;
  saveAnalysis(input: {
    eventId: string;
    analysis: NewsAnalysis;
    model: string | null;
    newsRisk: NewsRisk;
    analyzedAtIso: string;
  }): Promise<void>;
  markAnalysisFailed(input: { eventId: string; status: "FAILED" | "UNAVAILABLE" }): Promise<void>;
}

export type AnalysisOutcome =
  | { status: "OK"; analysis: NewsAnalysis; model: string | null }
  | { status: "NOT_CONFIGURED" }
  | { status: "ERROR"; message: string };

export interface NewsAnalyzer {
  analyze(input: {
    headline: string;
    source: string;
    sourceQuality: string;
    category: string;
    publishedAt: string;
    excerpt: string | null;
  }): Promise<AnalysisOutcome>;
}

export type ProviderReport = {
  provider: string;
  status: "OK" | "FAILED";
  fetched: number;
  stored: number;
  duplicates: number;
  error?: string;
};

export type IngestReport = {
  providers: ProviderReport[];
  newEvents: number;
  duplicatesSkipped: number;
  analyzed: number;
  analysisFailures: number;
  aiCalls: number;
};

export type IngestDeps = {
  providers: NewsProvider[];
  store: NewsStore;
  analyzer: NewsAnalyzer;
  now?: () => number;
  /** How far back to look for duplicates. */
  dedupeWindowMs?: number;
  /** Safety valve so one unusual ingestion cycle cannot burn the AI budget. */
  maxAnalysesPerRun?: number;
};

export const DEFAULT_MAX_ANALYSES_PER_RUN = 5;

export async function ingestNews(deps: IngestDeps): Promise<IngestReport> {
  const nowMs = deps.now?.() ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const windowMs = deps.dedupeWindowMs ?? 48 * 60 * 60 * 1000;
  const maxAnalyses = deps.maxAnalysesPerRun ?? DEFAULT_MAX_ANALYSES_PER_RUN;

  const report: IngestReport = {
    providers: [],
    newEvents: 0,
    duplicatesSkipped: 0,
    analyzed: 0,
    analysisFailures: 0,
    aiCalls: 0,
  };

  // The deduplication corpus is loaded once and kept current in memory, so
  // two syndicated copies arriving in the SAME run still collapse.
  const recent = await deps.store.loadRecentEvents(new Date(nowMs - windowMs).toISOString());
  const corpus: DuplicateCandidate[] = [...recent];

  // Events worth an AI call, collected during ingestion and analysed after,
  // so a slow model never holds up deterministic persistence.
  const pendingAnalysis: Array<{
    eventId: string;
    item: NormalizedNewsItem;
    classification: NewsClassification;
  }> = [];

  for (const provider of deps.providers) {
    const providerReport: ProviderReport = {
      provider: provider.name,
      status: "OK",
      fetched: 0,
      stored: 0,
      duplicates: 0,
    };

    let items: NormalizedNewsItem[] = [];
    try {
      items = await provider.fetchRecentNews({ nowIso });
      providerReport.fetched = items.length;
    } catch (err) {
      // One provider failing must not erase or block the others.
      providerReport.status = "FAILED";
      providerReport.error = (err as Error).message;
      report.providers.push(providerReport);
      continue;
    }

    for (const item of items) {
      try {
        const match = findDuplicate(item, corpus, { windowMs, nowMs });
        if (match) {
          await deps.store.recordDuplicate({ eventId: match.eventId, item, match });
          providerReport.duplicates += 1;
          report.duplicatesSkipped += 1;
          continue; // one event, one analysis - never re-analyse a syndicated copy
        }

        const classification = classifyNewsItem(item);
        const wantsAi = shouldAnalyzeWithAi(classification);

        const eventId = await deps.store.insertEvent({
          eventHash: computeEventHash(item.canonicalUrl),
          item,
          classification,
          newsRisk: classification.baseRisk,
          analysisStatus: wantsAi ? "PENDING" : "NOT_REQUIRED",
        });

        if (!eventId) {
          // A concurrent run stored the same event first; treat it as the
          // duplicate it is rather than failing the batch.
          providerReport.duplicates += 1;
          report.duplicatesSkipped += 1;
          continue;
        }

        corpus.push({
          id: eventId,
          canonicalUrl: item.canonicalUrl,
          headline: item.headline,
          publishedAt: item.publishedAt,
        });
        providerReport.stored += 1;
        report.newEvents += 1;

        if (wantsAi) pendingAnalysis.push({ eventId, item, classification });
      } catch (err) {
        // One malformed item never fails the provider or the job.
        providerReport.error = (err as Error).message;
      }
    }

    report.providers.push(providerReport);
  }

  // --- AI analysis, strictly rationed ------------------------------------
  // Most runs analyse nothing at all: an item must be relevant to a traded
  // asset AND deterministically material before it is ever sent.
  for (const pending of pendingAnalysis.slice(0, maxAnalyses)) {
    report.aiCalls += 1;
    const outcome = await deps.analyzer.analyze({
      headline: pending.item.headline,
      source: pending.item.source,
      sourceQuality: pending.item.sourceQuality,
      category: pending.classification.category,
      publishedAt: pending.item.publishedAt,
      excerpt: pending.item.excerpt,
    });

    if (outcome.status === "OK") {
      await deps.store.saveAnalysis({
        eventId: pending.eventId,
        analysis: outcome.analysis,
        model: outcome.model,
        newsRisk: combineRisk(pending.classification.baseRisk, outcome.analysis.potentialImpact),
        analyzedAtIso: nowIso,
      });
      report.analyzed += 1;
    } else {
      // The deterministic classification stands on its own; a failed
      // analysis only means we have no extra colour for this event.
      await deps.store.markAnalysisFailed({
        eventId: pending.eventId,
        status: outcome.status === "NOT_CONFIGURED" ? "UNAVAILABLE" : "FAILED",
      });
      report.analysisFailures += 1;
    }
  }

  // Anything beyond the per-run cap keeps its deterministic classification
  // and is simply not AI-analysed; it is never left claiming PENDING forever.
  for (const skipped of pendingAnalysis.slice(maxAnalyses)) {
    await deps.store.markAnalysisFailed({ eventId: skipped.eventId, status: "UNAVAILABLE" });
  }

  return report;
}
