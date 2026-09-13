import { describe, expect, it } from "vitest";
import { parseFeed, cleanText, decodeEntities } from "./rss";
import { canonicalizeUrl, normalizeHeadline, normalizeItem, parseTimestamp, truncate, MAX_EXCERPT_LENGTH } from "./normalize";
import { findDuplicate, headlineSimilarity, type DuplicateCandidate } from "./dedupe";
import { classifyNewsItem, combineRisk, shouldAnalyzeWithAi } from "./classify";
import type { NormalizedNewsItem, SourceQuality } from "./types";

const FETCHED_AT = "2026-01-10T12:00:00.000Z";

function item(overrides: Partial<NormalizedNewsItem> = {}): NormalizedNewsItem {
  return {
    provider: "test",
    source: "Test Source",
    sourceQuality: "HIGH_QUALITY_MEDIA",
    headline: "Bitcoin ETF approved by regulator",
    canonicalUrl: "https://example.com/a",
    publishedAt: "2026-01-10T11:00:00.000Z",
    fetchedAt: FETCHED_AT,
    excerpt: null,
    externalId: null,
    ...overrides,
  };
}

const RSS_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Example Feed</title>
  <item>
    <title><![CDATA[SEC approves spot Bitcoin ETF applications]]></title>
    <link>https://example.com/news/etf-approved?utm_source=rss&amp;utm_medium=feed</link>
    <pubDate>Fri, 10 Jan 2026 10:30:00 GMT</pubDate>
    <description><![CDATA[<p>The regulator <b>approved</b> the filings.</p>]]></description>
    <guid isPermaLink="false">abc-123</guid>
  </item>
  <item>
    <title>Ethereum upgrade ships on mainnet</title>
    <link>https://example.com/news/eth-upgrade</link>
    <pubDate>Fri, 10 Jan 2026 09:00:00 GMT</pubDate>
    <description>Short summary &amp; details</description>
  </item>
  <item>
    <title>Broken item with no link</title>
  </item>
</channel></rss>`;

const ATOM_SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Federal Reserve holds interest rates steady</title>
    <link rel="alternate" href="https://fed.example.gov/press/a1"/>
    <published>2026-01-10T14:00:00Z</published>
    <summary>The FOMC kept the target range unchanged.</summary>
    <id>urn:uuid:1</id>
  </entry>
</feed>`;

describe("feed parsing", () => {
  it("parses RSS items including CDATA and entities", () => {
    const items = parseFeed(RSS_SAMPLE);
    expect(items).toHaveLength(2); // the third has no link and is skipped
    expect(items[0].title).toBe("SEC approves spot Bitcoin ETF applications");
    expect(items[0].description).toBe("The regulator approved the filings.");
    expect(items[0].id).toBe("abc-123");
    expect(items[1].description).toBe("Short summary & details");
  });

  it("parses Atom entries, taking the link from the href attribute", () => {
    const items = parseFeed(ATOM_SAMPLE);
    expect(items).toHaveLength(1);
    expect(items[0].link).toBe("https://fed.example.gov/press/a1");
    expect(items[0].publishedAt).toBe("2026-01-10T14:00:00Z");
  });

  it("skips a malformed entry instead of failing the whole feed", () => {
    const mixed = RSS_SAMPLE.replace("<title>Ethereum upgrade ships on mainnet</title>", "<title></title>");
    const items = parseFeed(mixed);
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.some((i) => i.title.includes("SEC approves"))).toBe(true);
  });

  it("returns nothing for junk input rather than throwing", () => {
    expect(parseFeed("not xml at all")).toEqual([]);
    expect(parseFeed("")).toEqual([]);
  });

  it("strips tags and decodes numeric entities", () => {
    expect(cleanText("<p>a &amp; b</p>")).toBe("a & b");
    expect(decodeEntities("&#8217;")).toBe("’");
  });
});

describe("normalization", () => {
  it("normalizes a raw item, stripping tracking parameters from the URL", () => {
    const raw = parseFeed(RSS_SAMPLE)[0];
    const normalized = normalizeItem({
      item: raw,
      provider: "test",
      source: "Test Source",
      sourceQuality: "OFFICIAL",
      fetchedAtIso: FETCHED_AT,
    });
    expect(normalized).not.toBeNull();
    expect(normalized!.canonicalUrl).toBe("https://example.com/news/etf-approved");
    expect(normalized!.publishedAt).toBe("2026-01-10T10:30:00.000Z");
    expect(normalized!.sourceQuality).toBe("OFFICIAL");
  });

  it("rejects an item with no usable headline or URL", () => {
    const base = { title: "Hi", link: "https://x.com/a", publishedAt: null, description: null, id: null };
    expect(
      normalizeItem({ item: base, provider: "p", source: "s", sourceQuality: "UNKNOWN", fetchedAtIso: FETCHED_AT }),
    ).toBeNull();
    expect(
      normalizeItem({
        item: { ...base, title: "A long enough headline", link: "not-a-url" },
        provider: "p",
        source: "s",
        sourceQuality: "UNKNOWN",
        fetchedAtIso: FETCHED_AT,
      }),
    ).toBeNull();
  });

  it("canonicalizes URLs consistently", () => {
    expect(canonicalizeUrl("http://WWW.Example.com/path/?utm_source=x#frag")).toBe("https://example.com/path");
    expect(canonicalizeUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    // An unparseable URL comes back untouched rather than throwing.
    expect(canonicalizeUrl("::::")).toBe("::::");
  });

  it("falls back to fetch time for a missing or absurd timestamp", () => {
    expect(parseTimestamp(null, FETCHED_AT)).toBe(FETCHED_AT);
    expect(parseTimestamp("nonsense", FETCHED_AT)).toBe(FETCHED_AT);
    expect(parseTimestamp("2030-01-01T00:00:00Z", FETCHED_AT)).toBe(FETCHED_AT);
  });

  it("caps the excerpt so a full article is never stored", () => {
    const long = "x".repeat(1000);
    expect(truncate(long, MAX_EXCERPT_LENGTH).length).toBeLessThanOrEqual(MAX_EXCERPT_LENGTH);
  });

  it("normalizes headlines by dropping punctuation and outlet suffixes", () => {
    expect(normalizeHeadline("SEC Approves Bitcoin ETF! - CoinDesk")).toBe("sec approves bitcoin etf");
  });
});

describe("deduplication", () => {
  const existing: DuplicateCandidate[] = [
    {
      id: "evt-1",
      canonicalUrl: "https://example.com/news/etf-approved",
      headline: "SEC approves spot Bitcoin ETF applications",
      publishedAt: "2026-01-10T10:30:00.000Z",
    },
  ];

  it("collapses the identical article re-fetched on the next run", () => {
    const match = findDuplicate(item({ canonicalUrl: "https://example.com/news/etf-approved" }), existing);
    expect(match?.reason).toBe("SAME_CANONICAL_URL");
    expect(match?.eventId).toBe("evt-1");
  });

  it("collapses a syndicated copy with the same headline at a different URL", () => {
    const match = findDuplicate(
      item({
        canonicalUrl: "https://other-outlet.com/story/123",
        headline: "SEC Approves Spot Bitcoin ETF Applications!",
        publishedAt: "2026-01-10T11:15:00.000Z",
      }),
      existing,
    );
    expect(match?.reason).toBe("SAME_NORMALIZED_HEADLINE");
  });

  it("collapses a reworded syndicated copy above the similarity threshold", () => {
    const match = findDuplicate(
      item({
        canonicalUrl: "https://third.com/x",
        headline: "SEC approves spot Bitcoin ETF applications from issuers",
        publishedAt: "2026-01-10T11:20:00.000Z",
      }),
      existing,
    );
    expect(match?.reason).toBe("SIMILAR_HEADLINE");
    expect(match!.similarity).toBeGreaterThanOrEqual(0.7);
  });

  it("does NOT collapse a genuinely different story", () => {
    const match = findDuplicate(
      item({ canonicalUrl: "https://x.com/y", headline: "Ethereum upgrade ships on mainnet" }),
      existing,
    );
    expect(match).toBeNull();
  });

  it("does not collapse a similar headline from far outside the window", () => {
    const match = findDuplicate(
      item({
        canonicalUrl: "https://later.com/z",
        headline: "SEC approves spot Bitcoin ETF applications",
        publishedAt: "2026-02-20T10:30:00.000Z",
      }),
      existing,
    );
    expect(match).toBeNull();
  });

  it("similarity is symmetric and bounded", () => {
    const a = "SEC approves spot Bitcoin ETF applications";
    const b = "Bitcoin ETF applications approved by the SEC";
    expect(headlineSimilarity(a, b)).toBe(headlineSimilarity(b, a));
    expect(headlineSimilarity(a, a)).toBe(1);
    expect(headlineSimilarity(a, "")).toBe(0);
  });
});

describe("relevance and classification", () => {
  it("identifies a BTC-specific story", () => {
    const c = classifyNewsItem(item({ headline: "Bitcoin falls after regulator announcement" }));
    expect(c.affectedAssets).toContain("BTC");
    expect(c.relevanceScore).toBeGreaterThan(0.3);
  });

  it("identifies an ETH-specific story", () => {
    const c = classifyNewsItem(item({ headline: "Ethereum protocol upgrade launched on mainnet" }));
    expect(c.affectedAssets).toContain("ETH");
    expect(c.category).toBe("PROTOCOL");
  });

  it("identifies a crypto-market-wide story", () => {
    const c = classifyNewsItem(item({ headline: "Crypto exchange halts withdrawals after outage" }));
    expect(c.affectedAssets).toContain("CRYPTO_MARKET");
    expect(c.category).toBe("EXCHANGE");
  });

  it("treats a macro story as MACRO/USD and still crypto-relevant", () => {
    const c = classifyNewsItem(
      item({ headline: "Federal Reserve raised interest rates at the FOMC meeting", sourceQuality: "OFFICIAL" }),
    );
    expect(c.affectedAssets).toContain("MACRO");
    expect(c.affectedAssets).toContain("USD");
    expect(c.affectedAssets).toContain("CRYPTO_MARKET");
  });

  it("excludes an obviously irrelevant story", () => {
    const c = classifyNewsItem(item({ headline: "Local bakery wins regional pastry competition" }));
    expect(c.affectedAssets).toHaveLength(0);
    expect(c.relevanceScore).toBeLessThan(0.2);
    expect(shouldAnalyzeWithAi(c)).toBe(false);
  });

  it("does not match short tickers inside unrelated words", () => {
    const c = classifyNewsItem(item({ headline: "Ethics committee together reviews methods" }));
    expect(c.affectedAssets).not.toContain("ETH");
  });
});

describe("news risk", () => {
  it("a concrete regulatory action from an official source is HIGH", () => {
    const c = classifyNewsItem(
      item({
        headline: "SEC approves spot Bitcoin ETF applications",
        sourceQuality: "OFFICIAL",
      }),
    );
    expect(c.baseRisk).toBe("HIGH");
  });

  it("speculation about the same topic is NOT high, however dramatic", () => {
    const c = classifyNewsItem(
      item({
        headline: "Analyst says SEC could approve a Bitcoin ETF, reportedly weighs options",
        sourceQuality: "SECONDARY",
      }),
    );
    expect(c.baseRisk).not.toBe("HIGH");
  });

  it("an irrelevant story is LOW", () => {
    expect(classifyNewsItem(item({ headline: "Local bakery wins regional pastry competition" })).baseRisk).toBe("LOW");
  });

  it("source quality describes the source, not direction", () => {
    const official = classifyNewsItem(item({ headline: "Bitcoin ETF approved", sourceQuality: "OFFICIAL" }));
    const unknown = classifyNewsItem(item({ headline: "Bitcoin ETF approved", sourceQuality: "UNKNOWN" as SourceQuality }));
    expect(official.relevanceScore).toBeGreaterThan(unknown.relevanceScore);
  });

  it("AI impact may raise risk, and may only lower it one step", () => {
    expect(combineRisk("LOW", "HIGH")).toBe("HIGH");
    expect(combineRisk("HIGH", "LOW")).toBe("MEDIUM"); // cannot be talked all the way down
    expect(combineRisk("MEDIUM", "UNKNOWN")).toBe("MEDIUM");
    expect(combineRisk("MEDIUM", null)).toBe("MEDIUM");
  });
});

describe("AI call gating", () => {
  it("sends a material, relevant event for analysis", () => {
    const c = classifyNewsItem(
      item({ headline: "SEC approves spot Bitcoin ETF applications", sourceQuality: "OFFICIAL" }),
    );
    expect(shouldAnalyzeWithAi(c)).toBe(true);
  });

  it("does NOT send routine or low-relevance items", () => {
    expect(shouldAnalyzeWithAi(classifyNewsItem(item({ headline: "Bakery wins pastry competition" })))).toBe(false);
    expect(
      shouldAnalyzeWithAi(classifyNewsItem(item({ headline: "Ethereum adoption partnership announced by a startup" }))),
    ).toBe(false);
  });

  it("never sends a macro-only story with no crypto relevance", () => {
    const c = classifyNewsItem(item({ headline: "Local council debates parking rules" }));
    expect(shouldAnalyzeWithAi(c)).toBe(false);
  });
});
