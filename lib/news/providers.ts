import { parseFeed } from "./rss";
import { normalizeItem } from "./normalize";
import type { NormalizedNewsItem, SourceQuality } from "./types";

/**
 * Provider abstraction. Nothing downstream knows or cares whether an item
 * came from RSS, an official announcement endpoint, or a commercial API -
 * it only ever sees `NormalizedNewsItem`. Swapping or adding a provider
 * must not touch classification, deduplication, storage or the UI.
 */
export interface NewsProvider {
  readonly name: string;
  readonly source: string;
  readonly sourceQuality: SourceQuality;
  fetchRecentNews(opts: { nowIso: string; signal?: AbortSignal }): Promise<NormalizedNewsItem[]>;
}

export type FeedDefinition = {
  /** Stable provider key stored on every event. */
  name: string;
  /** Human-readable outlet/organisation name. */
  source: string;
  sourceQuality: SourceQuality;
  url: string;
  /** Why this source is included, so the list stays reviewable. */
  rationale: string;
};

/**
 * The configured feed list.
 *
 * Selection policy: public, publisher-provided RSS/Atom endpoints from
 * official organisations and established financial/crypto outlets. No
 * scraping, no browser automation, no rumor aggregators, and no source that
 * requires a paid credential - the system must work without one.
 *
 * Each entry is the publisher's own syndication feed, which is what those
 * feeds exist for. We store headline, link and a short excerpt only; full
 * article text is never copied.
 */
export const DEFAULT_FEEDS: FeedDefinition[] = [
  {
    name: "sec-press",
    source: "U.S. Securities and Exchange Commission",
    sourceQuality: "OFFICIAL",
    url: "https://www.sec.gov/news/pressreleases.rss",
    rationale: "Primary regulatory source: enforcement actions and ETF decisions, first-party.",
  },
  {
    name: "federalreserve-press",
    source: "U.S. Federal Reserve",
    sourceQuality: "OFFICIAL",
    url: "https://www.federalreserve.gov/feeds/press_all.xml",
    rationale: "Primary macro source: FOMC statements and rate decisions. Also the basis for future XAUUSD macro events.",
  },
  {
    name: "coindesk",
    source: "CoinDesk",
    sourceQuality: "HIGH_QUALITY_MEDIA",
    url: "https://www.coindesk.com/arc/outboundfeeds/rss/",
    rationale: "Established crypto trade publication with a public RSS feed.",
  },
  {
    name: "cointelegraph",
    source: "Cointelegraph",
    sourceQuality: "HIGH_QUALITY_MEDIA",
    url: "https://cointelegraph.com/rss",
    rationale: "Broad crypto coverage; used for corroboration rather than as a primary source.",
  },
];

/**
 * A polite, identifiable User-Agent. Several publishers (the SEC in
 * particular) ask automated clients to identify themselves with a contact
 * address; sending a generic or spoofed agent would be both rude and a
 * policy violation.
 */
export const USER_AGENT =
  "DavinkiTradingBot/1.0 (personal trading research; +https://davinki-trading-bot.vercel.app)";

const FETCH_TIMEOUT_MS = 12_000;

export class RssNewsProvider implements NewsProvider {
  readonly name: string;
  readonly source: string;
  readonly sourceQuality: SourceQuality;
  private readonly url: string;
  private readonly fetchImpl: typeof fetch;

  constructor(definition: FeedDefinition, fetchImpl: typeof fetch = fetch) {
    this.name = definition.name;
    this.source = definition.source;
    this.sourceQuality = definition.sourceQuality;
    this.url = definition.url;
    this.fetchImpl = fetchImpl;
  }

  async fetchRecentNews({ nowIso }: { nowIso: string; signal?: AbortSignal }): Promise<NormalizedNewsItem[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(this.url, {
        signal: controller.signal,
        headers: { Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8", "User-Agent": USER_AGENT },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const xml = await res.text();
      const raw = parseFeed(xml);

      const normalized: NormalizedNewsItem[] = [];
      for (const item of raw) {
        // One malformed entry never costs us the rest of the feed.
        const result = normalizeItem({
          item,
          provider: this.name,
          source: this.source,
          sourceQuality: this.sourceQuality,
          fetchedAtIso: nowIso,
        });
        if (result) normalized.push(result);
      }
      return normalized;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createDefaultProviders(fetchImpl: typeof fetch = fetch): NewsProvider[] {
  return DEFAULT_FEEDS.map((definition) => new RssNewsProvider(definition, fetchImpl));
}
