import { createHash } from "node:crypto";
import type { NormalizedNewsItem, SourceQuality } from "./types";
import type { RawFeedItem } from "./rss";

/** Excerpts are capped hard: we store context, never a copy of the article. */
export const MAX_EXCERPT_LENGTH = 280;
const MAX_HEADLINE_LENGTH = 300;

/**
 * Tracking parameters carried by syndicated links. Stripping them is what
 * lets the same story from two places collapse to one canonical URL.
 */
const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "source",
  "__source",
];

/**
 * Canonicalizes a URL for deduplication: lowercase host, no tracking
 * parameters, no fragment, no trailing slash, http upgraded to https.
 * Returns the input untouched when it cannot be parsed - a weird URL should
 * not throw away an otherwise usable item.
 */
export function canonicalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl.trim());
    url.protocol = url.protocol === "http:" ? "https:" : url.protocol;
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.hash = "";
    for (const param of TRACKING_PARAMS) url.searchParams.delete(param);
    let out = url.toString();
    if (out.endsWith("/") && url.pathname !== "/") out = out.slice(0, -1);
    return out;
  } catch {
    return rawUrl.trim();
  }
}

/**
 * Normalizes a headline for comparison: lowercase, punctuation removed,
 * common outlet suffixes dropped, whitespace collapsed. Two syndicated
 * copies of the same story usually normalize to the same string.
 */
export function normalizeHeadline(headline: string): string {
  return headline
    .toLowerCase()
    .replace(/\s*[|\-–—]\s*[^|\-–—]{0,40}$/u, "") // trailing " - Outlet Name"
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseTimestamp(value: string | null, fallbackIso: string): string {
  if (!value) return fallbackIso;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return fallbackIso;
  // A feed claiming a far-future date is not trustworthy for recency logic.
  const now = Date.parse(fallbackIso);
  if (parsed > now + 24 * 60 * 60 * 1000) return fallbackIso;
  return new Date(parsed).toISOString();
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export type NormalizeInput = {
  item: RawFeedItem;
  provider: string;
  source: string;
  sourceQuality: SourceQuality;
  fetchedAtIso: string;
};

/**
 * Turns one raw feed entry into the normalized model, or null when the entry
 * is unusable. Returning null (rather than throwing) is what keeps one bad
 * item from failing an entire provider.
 */
export function normalizeItem(input: NormalizeInput): NormalizedNewsItem | null {
  const headline = input.item.title.trim();
  if (headline.length < 8) return null;

  const canonicalUrl = canonicalizeUrl(input.item.link);
  if (!/^https?:\/\//i.test(canonicalUrl)) return null;

  const excerpt = input.item.description ? truncate(input.item.description.trim(), MAX_EXCERPT_LENGTH) : null;

  return {
    provider: input.provider,
    source: input.source,
    sourceQuality: input.sourceQuality,
    headline: truncate(headline, MAX_HEADLINE_LENGTH),
    canonicalUrl,
    publishedAt: parseTimestamp(input.item.publishedAt, input.fetchedAtIso),
    fetchedAt: input.fetchedAtIso,
    excerpt: excerpt && excerpt.length > 0 ? excerpt : null,
    externalId: input.item.id?.trim() || null,
  };
}

/**
 * The deduplication key for a real-world event.
 *
 * Built from the canonical URL AND the normalized headline so that:
 *  - the identical article re-fetched on the next run collapses (same URL),
 *  - the same story syndicated under different URLs collapses when the
 *    headline normalizes identically (see `findDuplicate`).
 *
 * The hash itself is URL-based; headline matching is handled separately
 * because it needs to compare against already-stored events.
 */
export function computeEventHash(canonicalUrl: string): string {
  return createHash("sha256").update(canonicalUrl).digest("hex").slice(0, 32);
}

export function computeHeadlineHash(headline: string): string {
  return createHash("sha256").update(normalizeHeadline(headline)).digest("hex").slice(0, 32);
}
