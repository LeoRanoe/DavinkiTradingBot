import { computeEventHash, computeHeadlineHash, normalizeHeadline } from "./normalize";
import type { NormalizedNewsItem } from "./types";

/**
 * Deduplication. One real-world event must produce ONE stored event and at
 * most ONE AI analysis, however many outlets syndicate it.
 *
 * Three deterministic layers, cheapest first:
 *   1. identical canonical URL  -> the same article, re-fetched
 *   2. identical normalized headline within the window -> syndicated copy
 *   3. high token overlap between normalized headlines -> reworded copy
 *
 * Deliberately NOT semantic/embedding clustering: hashing plus token overlap
 * is sufficient here, is explainable, and costs nothing per item.
 */

export type DuplicateCandidate = {
  id: string;
  canonicalUrl: string;
  headline: string;
  publishedAt: string;
};

export type DuplicateMatch = {
  eventId: string;
  reason: "SAME_CANONICAL_URL" | "SAME_NORMALIZED_HEADLINE" | "SIMILAR_HEADLINE";
  similarity: number;
};

/** Window within which two similar headlines are treated as one event. */
export const DEFAULT_DEDUPE_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Similarity of two normalized headlines, as the greater of:
 *  - Jaccard overlap of their significant tokens, and
 *  - containment (shared / smaller set), which catches the common
 *    syndication pattern of appending a clause: "SEC approves X" vs
 *    "SEC approves X from issuers".
 *
 * Containment needs at least 3 significant tokens on the smaller side, so a
 * two-word headline cannot be swallowed by a longer unrelated one. The bias
 * throughout is conservative: a false MERGE loses information and could
 * attach the wrong context to a candidate, while a false SPLIT costs only
 * one extra stored event.
 */
export function headlineSimilarity(a: string, b: string): number {
  // Significant tokens: words longer than three characters, plus multi-digit
  // numbers. Numbers matter - "SEC fines firm $4 billion" and
  // "SEC fines firm $40 billion" are different stories, and dropping the
  // figure would merge them.
  const tokenize = (s: string) =>
    new Set(
      normalizeHeadline(s)
        .split(" ")
        .filter((t) => t.length > 3 || (/^\d+$/.test(t) && t.length >= 2)),
    );
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;

  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared += 1;

  const union = setA.size + setB.size - shared;
  const jaccard = union === 0 ? 0 : shared / union;

  const smaller = Math.min(setA.size, setB.size);
  const containment = smaller >= 3 ? shared / smaller : 0;

  return Number(Math.max(jaccard, containment).toFixed(3));
}

export const SIMILARITY_THRESHOLD = 0.7;

/**
 * Finds an existing event that the incoming item duplicates, or null.
 * `existing` should already be scoped to a recent window by the caller.
 */
export function findDuplicate(
  item: NormalizedNewsItem,
  existing: DuplicateCandidate[],
  opts: { windowMs?: number; nowMs?: number } = {},
): DuplicateMatch | null {
  const windowMs = opts.windowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
  const itemTime = Date.parse(item.publishedAt);

  for (const candidate of existing) {
    if (candidate.canonicalUrl === item.canonicalUrl) {
      return { eventId: candidate.id, reason: "SAME_CANONICAL_URL", similarity: 1 };
    }
  }

  const inWindow = existing.filter((candidate) => {
    const delta = Math.abs(Date.parse(candidate.publishedAt) - itemTime);
    return Number.isFinite(delta) && delta <= windowMs;
  });

  const itemHeadlineHash = computeHeadlineHash(item.headline);
  for (const candidate of inWindow) {
    if (computeHeadlineHash(candidate.headline) === itemHeadlineHash) {
      return { eventId: candidate.id, reason: "SAME_NORMALIZED_HEADLINE", similarity: 1 };
    }
  }

  let best: DuplicateMatch | null = null;
  for (const candidate of inWindow) {
    const similarity = headlineSimilarity(item.headline, candidate.headline);
    if (similarity >= SIMILARITY_THRESHOLD && (best === null || similarity > best.similarity)) {
      best = { eventId: candidate.id, reason: "SIMILAR_HEADLINE", similarity };
    }
  }
  return best;
}

export { computeEventHash, computeHeadlineHash };
