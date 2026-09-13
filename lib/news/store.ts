import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { DuplicateCandidate } from "./dedupe";
import type { NewsStore } from "./ingest";
import type {
  AffectedAsset,
  AnalysisStatus,
  NewsAnalysis,
  NewsCategory,
  NewsEvent,
  NewsRisk,
  SourceQuality,
} from "./types";

type NewsEventRow = Database["public"]["Tables"]["news_events"]["Row"];

export function rowToNewsEvent(row: NewsEventRow): NewsEvent {
  return {
    id: row.id,
    eventHash: row.event_hash,
    provider: row.provider,
    source: row.source,
    sourceQuality: row.source_quality as SourceQuality,
    headline: row.headline,
    canonicalUrl: row.canonical_url,
    excerpt: row.excerpt,
    publishedAt: row.published_at,
    fetchedAt: row.fetched_at,
    category: row.category as NewsCategory,
    affectedAssets: (row.affected_assets ?? []) as AffectedAsset[],
    relevanceScore: Number(row.relevance_score ?? 0),
    newsRisk: row.news_risk as NewsRisk,
    analysisStatus: row.analysis_status as AnalysisStatus,
    analysis: (row.analysis as NewsAnalysis | null) ?? null,
    analysisModel: row.analysis_model,
    analyzedAt: row.analyzed_at,
    duplicateCount: row.duplicate_count ?? 0,
  };
}

export function createNewsStore(client: SupabaseClient<Database>): NewsStore {
  return {
    async loadRecentEvents(sinceIso): Promise<DuplicateCandidate[]> {
      const { data } = await client
        .from("news_events")
        .select("id, canonical_url, headline, published_at")
        .gte("published_at", sinceIso)
        .order("published_at", { ascending: false })
        .limit(500);
      return (data ?? []).map((row) => ({
        id: row.id,
        canonicalUrl: row.canonical_url,
        headline: row.headline,
        publishedAt: row.published_at,
      }));
    },

    async insertEvent({ eventHash, item, classification, newsRisk, analysisStatus }) {
      const { data, error } = await client
        .from("news_events")
        .insert({
          event_hash: eventHash,
          provider: item.provider,
          source: item.source,
          source_quality: item.sourceQuality,
          headline: item.headline,
          canonical_url: item.canonicalUrl,
          excerpt: item.excerpt,
          published_at: item.publishedAt,
          fetched_at: item.fetchedAt,
          category: classification.category,
          affected_assets: classification.affectedAssets,
          relevance_score: classification.relevanceScore,
          news_risk: newsRisk,
          analysis_status: analysisStatus,
          matched_terms: classification.matchedTerms.slice(0, 20),
        })
        .select("id")
        .single();

      // A unique violation on event_hash means a concurrent run stored it
      // first - that is the idempotent path, not an error.
      if (error) return null;

      await client.from("news_event_sources").insert({
        news_event_id: data.id,
        provider: item.provider,
        source: item.source,
        canonical_url: item.canonicalUrl,
        headline: item.headline,
        match_reason: "ORIGINAL",
      });

      return data.id;
    },

    async recordDuplicate({ eventId, item, match }) {
      // Records WHY this copy was considered a duplicate. Idempotent: the
      // unique (news_event_id, canonical_url) makes a repeated fetch a no-op.
      const { error } = await client.from("news_event_sources").insert({
        news_event_id: eventId,
        provider: item.provider,
        source: item.source,
        canonical_url: item.canonicalUrl,
        headline: item.headline,
        match_reason: match.reason,
        similarity: match.similarity,
      });

      // Only count a genuinely new syndicated copy.
      if (!error) {
        const { data: current } = await client
          .from("news_events")
          .select("duplicate_count")
          .eq("id", eventId)
          .maybeSingle();
        await client
          .from("news_events")
          .update({ duplicate_count: (current?.duplicate_count ?? 0) + 1 })
          .eq("id", eventId);
      }
    },

    async saveAnalysis({ eventId, analysis, model, newsRisk, analyzedAtIso }) {
      await client
        .from("news_events")
        .update({
          analysis: analysis as never,
          analysis_model: model,
          analyzed_at: analyzedAtIso,
          analysis_status: "COMPLETED",
          news_risk: newsRisk,
        })
        .eq("id", eventId);
    },

    async markAnalysisFailed({ eventId, status }) {
      await client.from("news_events").update({ analysis_status: status }).eq("id", eventId);
    },
  };
}

/** Recent events for candidate context, newest first. */
export async function loadRecentNewsEvents(
  client: SupabaseClient<Database>,
  sinceIso: string,
  limit = 50,
): Promise<NewsEvent[]> {
  const { data } = await client
    .from("news_events")
    .select("*")
    .gte("published_at", sinceIso)
    .order("published_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map(rowToNewsEvent);
}
