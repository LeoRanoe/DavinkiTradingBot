import { describe, expect, it } from "vitest";
import { ingestNews } from "./ingest";
import { buildCandidateNewsContext, selectRelevantEvents } from "./candidate-context";
import {
  createFakeAnalyzer,
  createFakeNewsStore,
  createFakeProvider,
  makeItem,
  makeNewsDb,
  makeStoredEvent,
  SAMPLE_ANALYSIS,
} from "./__fixtures__/news-fakes";

const NOW = Date.parse("2026-01-10T12:00:00.000Z");
const now = () => NOW;

const MATERIAL_ITEM = makeItem({
  headline: "SEC approves spot Bitcoin ETF applications",
  canonicalUrl: "https://example.com/etf-approved",
  sourceQuality: "OFFICIAL",
  publishedAt: "2026-01-10T11:00:00.000Z",
});

const ROUTINE_ITEM = makeItem({
  headline: "Ethereum wallet app adds a new settings screen",
  canonicalUrl: "https://example.com/wallet-ui",
  publishedAt: "2026-01-10T11:30:00.000Z",
});

describe("ingestion", () => {
  it("stores new events and classifies them deterministically", async () => {
    const db = makeNewsDb();
    const analyzer = createFakeAnalyzer();
    const report = await ingestNews({
      providers: [createFakeProvider("p1", [MATERIAL_ITEM, ROUTINE_ITEM])],
      store: createFakeNewsStore(db),
      analyzer,
      now,
    });

    expect(report.newEvents).toBe(2);
    expect(db.events).toHaveLength(2);
    const etf = db.events.find((e) => e.headline.includes("SEC approves"))!;
    expect(etf.category).toBe("ETF");
    expect(etf.affectedAssets).toContain("BTC");
    expect(etf.newsRisk).toBe("HIGH");
  });

  it("is idempotent: re-running over the same feed stores nothing new", async () => {
    const db = makeNewsDb();
    const store = createFakeNewsStore(db);
    const analyzer = createFakeAnalyzer();
    const providers = [createFakeProvider("p1", [MATERIAL_ITEM, ROUTINE_ITEM])];

    const first = await ingestNews({ providers, store, analyzer, now });
    const second = await ingestNews({ providers, store, analyzer, now });
    const third = await ingestNews({ providers, store, analyzer, now });

    expect(first.newEvents).toBe(2);
    expect(second.newEvents).toBe(0);
    expect(third.newEvents).toBe(0);
    expect(second.duplicatesSkipped).toBe(2);
    expect(db.events).toHaveLength(2);
  });

  it("does not re-analyse an event on a repeated run - one event, one AI call", async () => {
    const db = makeNewsDb();
    const store = createFakeNewsStore(db);
    const analyzer = createFakeAnalyzer();
    const providers = [createFakeProvider("p1", [MATERIAL_ITEM])];

    await ingestNews({ providers, store, analyzer, now });
    await ingestNews({ providers, store, analyzer, now });
    await ingestNews({ providers, store, analyzer, now });

    expect(analyzer.calls).toBe(1);
  });

  it("collapses the same story syndicated by two providers into one event and one AI call", async () => {
    const db = makeNewsDb();
    const analyzer = createFakeAnalyzer();
    const syndicated = makeItem({
      headline: "SEC Approves Spot Bitcoin ETF Applications",
      canonicalUrl: "https://other-outlet.com/story",
      sourceQuality: "HIGH_QUALITY_MEDIA",
      publishedAt: "2026-01-10T11:20:00.000Z",
    });

    const report = await ingestNews({
      providers: [createFakeProvider("p1", [MATERIAL_ITEM]), createFakeProvider("p2", [syndicated])],
      store: createFakeNewsStore(db),
      analyzer,
      now,
    });

    expect(report.newEvents).toBe(1);
    expect(report.duplicatesSkipped).toBe(1);
    expect(analyzer.calls).toBe(1);
    expect(db.events[0].duplicateCount).toBe(1);
    // The reason is recorded so the decision can be explained later.
    expect(db.duplicates[0].reason).toBe("SAME_NORMALIZED_HEADLINE");
  });

  it("spends AI calls ONLY on material events - a routine item is never sent", async () => {
    const db = makeNewsDb();
    const analyzer = createFakeAnalyzer();
    await ingestNews({
      providers: [createFakeProvider("p1", [ROUTINE_ITEM])],
      store: createFakeNewsStore(db),
      analyzer,
      now,
    });

    expect(analyzer.calls).toBe(0);
    expect(db.events[0].analysisStatus).toBe("NOT_REQUIRED");
  });

  it("a routine ingestion run makes zero AI calls", async () => {
    const db = makeNewsDb();
    const analyzer = createFakeAnalyzer();
    // Genuinely distinct routine stories - nothing a trading system needs
    // an AI opinion about.
    const headlines = [
      "Wallet app ships a redesigned settings screen",
      "Conference announces its autumn speaker lineup",
      "Developer survey shows tooling preferences shifting",
      "Podcast episode discusses long term saving habits",
      "Startup opens a second engineering office abroad",
      "Community calls for better documentation practices",
      "Retail platform adds dark mode to its dashboard",
      "Analyst newsletter reviews quarterly reading list",
      "Museum exhibit explores the history of money",
      "University publishes a course on distributed systems",
      "Charity reports record participation this year",
      "Magazine profiles an independent hardware maker",
    ];
    const routine = headlines.map((headline, i) =>
      makeItem({ headline, canonicalUrl: `https://example.com/routine-${i}` }),
    );

    const report = await ingestNews({
      providers: [createFakeProvider("p1", routine)],
      store: createFakeNewsStore(db),
      analyzer,
      now,
    });

    expect(report.newEvents).toBe(12);
    expect(report.aiCalls).toBe(0);
    expect(analyzer.calls).toBe(0);
  });

  it("caps AI calls per run so one unusual cycle cannot burn the budget", async () => {
    const db = makeNewsDb();
    const analyzer = createFakeAnalyzer();
    // Nine DISTINCT material stories arriving in one unusual cycle.
    const materialHeadlines = [
      "SEC approves spot Bitcoin ETF applications",
      "Major crypto exchange confirms withdrawals halted after breach",
      "Federal Reserve raised interest rates at its policy meeting",
      "Regulator charges a large stablecoin issuer over reserves",
      "Ethereum bridge exploit drained user deposits overnight",
      "Court ruled against a crypto lender in bankruptcy case",
      "Treasury sanctions addresses linked to a hacking group",
      "Inflation data confirms consumer prices rose sharply",
      "Exchange announces delisting of several digital assets",
    ];
    const material = materialHeadlines.map((headline, i) =>
      makeItem({
        headline,
        canonicalUrl: `https://example.com/material-${i}`,
        sourceQuality: "OFFICIAL",
      }),
    );

    const report = await ingestNews({
      providers: [createFakeProvider("p1", material)],
      store: createFakeNewsStore(db),
      analyzer,
      now,
      maxAnalysesPerRun: 3,
    });

    expect(report.aiCalls).toBe(3);
    expect(analyzer.calls).toBe(3);
    // Nothing is left claiming PENDING forever.
    expect(db.events.filter((e) => e.analysisStatus === "PENDING")).toHaveLength(0);
  });
});

describe("ingestion failure isolation", () => {
  it("one provider failing does not lose the other provider's data", async () => {
    const db = makeNewsDb();
    const report = await ingestNews({
      providers: [
        createFakeProvider("broken", [], { fail: true }),
        createFakeProvider("working", [MATERIAL_ITEM]),
      ],
      store: createFakeNewsStore(db),
      analyzer: createFakeAnalyzer(),
      now,
    });

    expect(report.providers.find((p) => p.provider === "broken")?.status).toBe("FAILED");
    expect(report.providers.find((p) => p.provider === "working")?.status).toBe("OK");
    expect(report.newEvents).toBe(1);
    expect(db.events).toHaveLength(1);
  });

  it("an AI failure leaves the deterministic record intact", async () => {
    const db = makeNewsDb();
    const report = await ingestNews({
      providers: [createFakeProvider("p1", [MATERIAL_ITEM])],
      store: createFakeNewsStore(db),
      analyzer: createFakeAnalyzer({ status: "ERROR", message: "Rate limited" }),
      now,
    });

    expect(report.newEvents).toBe(1);
    expect(report.analysisFailures).toBe(1);
    // The event, its category, assets and deterministic risk all survive.
    expect(db.events[0].analysisStatus).toBe("FAILED");
    expect(db.events[0].newsRisk).toBe("HIGH");
    expect(db.events[0].category).toBe("ETF");
  });

  it("a missing AI credential marks analysis UNAVAILABLE, not failed data", async () => {
    const db = makeNewsDb();
    await ingestNews({
      providers: [createFakeProvider("p1", [MATERIAL_ITEM])],
      store: createFakeNewsStore(db),
      analyzer: createFakeAnalyzer({ status: "NOT_CONFIGURED" }),
      now,
    });
    expect(db.events[0].analysisStatus).toBe("UNAVAILABLE");
    expect(db.events).toHaveLength(1);
  });

  it("AI analysis may raise the stored risk, and only lowers it one step", async () => {
    const db = makeNewsDb();
    const routineButRelevant = makeItem({
      headline: "Crypto exchange confirms withdrawals halted after outage",
      canonicalUrl: "https://example.com/halt",
      sourceQuality: "HIGH_QUALITY_MEDIA",
    });

    await ingestNews({
      providers: [createFakeProvider("p1", [routineButRelevant])],
      store: createFakeNewsStore(db),
      analyzer: createFakeAnalyzer({
        status: "OK",
        analysis: { ...SAMPLE_ANALYSIS, potentialImpact: "LOW" },
        model: "qwen-turbo",
      }),
      now,
    });

    // Deterministic base was HIGH; a confident model cannot talk it down to LOW.
    expect(db.events[0].newsRisk).toBe("MEDIUM");
  });
});

describe("candidate news context", () => {
  const events = [
    makeStoredEvent({ id: "e1", newsRisk: "HIGH", affectedAssets: ["BTC", "CRYPTO_MARKET"], relevanceScore: 0.9 }),
    makeStoredEvent({
      id: "e2",
      headline: "Ethereum upgrade completes on mainnet",
      newsRisk: "LOW",
      affectedAssets: ["ETH"],
      relevanceScore: 0.6,
      category: "PROTOCOL",
      publishedAt: "2026-01-10T10:00:00.000Z",
    }),
  ];

  it("attaches relevant events for the candidate's symbol", () => {
    const ctx = buildCandidateNewsContext({ symbol: "BTCUSDT", events, nowMs: NOW });
    expect(ctx.status).toBe("OK");
    expect(ctx.newsRisk).toBe("HIGH");
    expect(ctx.events.map((e) => e.id)).toEqual(["e1"]);
    expect(ctx.headline).toBe(SAMPLE_ANALYSIS.summary);
  });

  it("does not attach another symbol's story", () => {
    const ctx = buildCandidateNewsContext({ symbol: "ETHUSDT", events: [events[1]], nowMs: NOW });
    expect(ctx.events.map((e) => e.id)).toEqual(["e2"]);
  });

  it("reports LOW with an explicit 'nothing found' when no event is relevant", () => {
    const ctx = buildCandidateNewsContext({ symbol: "BTCUSDT", events: [], nowMs: NOW });
    expect(ctx.status).toBe("NO_RELEVANT_EVENTS");
    expect(ctx.newsRisk).toBe("LOW");
    expect(ctx.events).toHaveLength(0);
    expect(ctx.headline).toBeNull();
  });

  it("reports UNKNOWN - not LOW - when the news layer could not be consulted", () => {
    const ctx = buildCandidateNewsContext({ symbol: "BTCUSDT", events, nowMs: NOW, unavailable: true });
    expect(ctx.status).toBe("UNAVAILABLE");
    expect(ctx.newsRisk).toBe("UNKNOWN");
    expect(ctx.events).toHaveLength(0);
  });

  it("ignores events outside the recency window", () => {
    const stale = makeStoredEvent({ id: "old", publishedAt: "2026-01-01T00:00:00.000Z" });
    const ctx = buildCandidateNewsContext({ symbol: "BTCUSDT", events: [stale], nowMs: NOW });
    expect(ctx.status).toBe("NO_RELEVANT_EVENTS");
  });

  it("attaches a concise set, not a feed dump", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      makeStoredEvent({ id: `m${i}`, canonicalUrl: `https://x.com/${i}` }),
    );
    const selected = selectRelevantEvents({ symbol: "BTCUSDT", events: many, nowMs: NOW });
    expect(selected.length).toBeLessThanOrEqual(3);
  });

  it("orders by risk first so the thing most likely to matter is on top", () => {
    const low = makeStoredEvent({ id: "low", newsRisk: "LOW", publishedAt: "2026-01-10T11:55:00.000Z" });
    const high = makeStoredEvent({ id: "high", newsRisk: "HIGH", publishedAt: "2026-01-10T09:00:00.000Z" });
    const selected = selectRelevantEvents({ symbol: "BTCUSDT", events: [low, high], nowMs: NOW });
    expect(selected[0].id).toBe("high");
  });

  it("the context is a snapshot: it never mutates after later events arrive", () => {
    const ctx = buildCandidateNewsContext({ symbol: "BTCUSDT", events, nowMs: NOW });
    const before = JSON.stringify(ctx);

    // A newer, scarier event arrives afterwards.
    events.push(makeStoredEvent({ id: "e3", headline: "Major exchange hacked", newsRisk: "HIGH" }));

    expect(JSON.stringify(ctx)).toBe(before);
    expect(ctx.events.map((e) => e.id)).not.toContain("e3");
  });
});
