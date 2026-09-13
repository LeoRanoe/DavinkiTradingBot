import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/bybit/types";
import { evaluateSignal } from "@/lib/strategy/v1/signal";
import { STRATEGY_V1_PARAMS, STRATEGY_V1_VERSION_LABEL } from "@/lib/strategy/v1/config";
import { buildCandidateForScan } from "@/lib/candidates/from-settings";
import { buildSignalRow } from "@/lib/candidates/persistence";
import { DEFAULT_RISK_SETTINGS, type OwnerRiskSettings } from "@/lib/settings/risk-settings";
import { formatCandidateMessage } from "@/lib/telegram/client";
import { makeCandles, makeAccount, makeInstrument } from "@/lib/trading/__fixtures__/fakes";
import { parseFeed } from "./rss";
import { normalizeItem } from "./normalize";
import { ingestNews } from "./ingest";
import { buildCandidateNewsContext } from "./candidate-context";
import {
  createFakeAnalyzer,
  createFakeNewsStore,
  createFakeProvider,
  makeNewsDb,
} from "./__fixtures__/news-fakes";
import type { CandidateNewsContext } from "./types";

/**
 * THE MILESTONE 3 PROOF.
 *
 * Raw provider feed -> normalization -> deduplication -> BTC relevance ->
 * structured AI analysis -> stored event -> a REAL deterministic trade
 * candidate (real Strategy V1, real risk engine) -> candidate/news
 * association -> Telegram formatting.
 *
 * Then the same run with the AI layer unavailable, proving the identical
 * deterministic candidate still appears, with News Risk UNKNOWN.
 */

const NOW = Date.parse("2026-01-10T12:00:00.000Z");

/** A realistic publisher feed, in the wire format an RSS provider returns. */
const LIVE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Example Regulator Press Releases</title>
  <item>
    <title><![CDATA[SEC approves spot Bitcoin ETF applications]]></title>
    <link>https://regulator.example.gov/news/2026-01?utm_source=rss</link>
    <pubDate>Sat, 10 Jan 2026 11:00:00 GMT</pubDate>
    <description><![CDATA[<p>The Commission <b>approved</b> the listing applications.</p>]]></description>
    <guid>rel-2026-01</guid>
  </item>
  <item>
    <title>Wallet app ships a redesigned settings screen</title>
    <link>https://media.example.com/wallet-ui</link>
    <pubDate>Sat, 10 Jan 2026 10:00:00 GMT</pubDate>
    <description>A routine product update.</description>
  </item>
</channel></rss>`;

/** The same story, syndicated by a second outlet under a different URL. */
const SYNDICATED_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title>SEC Approves Spot Bitcoin ETF Applications</title>
    <link>https://media.example.com/story/etf-approved</link>
    <pubDate>Sat, 10 Jan 2026 11:20:00 GMT</pubDate>
    <description>Coverage of the regulator's decision.</description>
  </item>
</channel></rss>`;

function itemsFrom(xml: string, provider: string, source: string, quality: "OFFICIAL" | "HIGH_QUALITY_MEDIA") {
  return parseFeed(xml)
    .map((raw) =>
      normalizeItem({
        item: raw,
        provider,
        source,
        sourceQuality: quality,
        fetchedAtIso: new Date(NOW).toISOString(),
      }),
    )
    .filter((i): i is NonNullable<typeof i> => i !== null);
}

const settings: OwnerRiskSettings = {
  ...DEFAULT_RISK_SETTINGS,
  tradingMode: "PAPER",
  maxRiskPerTradePct: 0.01,
};

/** The Milestone 1 fixture that genuinely scores as a CANDIDATE. */
function candidateMarket(): { candles1h: Candle[]; candles15m: Candle[] } {
  const n = 260;
  const closes15m: number[] = [];
  for (let i = 0; i < n; i++) closes15m.push(100 + i * 0.2);
  for (let k = 0; k < 5; k++) closes15m[n - 5 + k] -= 3 * ((k + 1) / 5);
  const volumes15m = closes15m.map((_, i) => (i >= n - 2 ? 140 : 100));
  const closes1h = Array.from({ length: n }, (_, i) => 100 + i * 0.2);
  return {
    candles1h: makeCandles("1H", closes1h, { volumes: closes1h.map(() => 100) }),
    candles15m: makeCandles("15M", closes15m, { volumes: volumes15m }),
  };
}

/** Runs the real strategy + risk pipeline and attaches the given news context. */
function buildCandidateWithNews(news: CandidateNewsContext | undefined) {
  const market = candidateMarket();
  const evaluation = evaluateSignal("BTCUSDT", market.candles1h, market.candles15m);
  if (evaluation.kind !== "SIGNAL") throw new Error("fixture must produce a signal");

  const result = buildCandidateForScan({
    signalId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    symbol: "BTCUSDT",
    strategyVersionId: "strategy-v1",
    strategyVersionLabel: STRATEGY_V1_VERSION_LABEL,
    timeframe: STRATEGY_V1_PARAMS.entryTimeframe,
    closedCandleTimeMs: evaluation.candleTime,
    regime: evaluation.regime,
    score: evaluation.score,
    referencePrice: evaluation.score.entryPrice,
    marketDataTimestampMs: NOW,
    nowMs: NOW,
    account: makeAccount({ equity: 1000, availableBalance: 1000 }),
    instrument: makeInstrument(),
    settings,
    strategyApproved: true,
  });
  if (result.kind !== "CANDIDATE") throw new Error(`expected a candidate, got ${result.rejection.reason}`);

  const row = buildSignalRow({
    strategyVersionId: "strategy-v1",
    symbol: "BTCUSDT",
    timeframe: STRATEGY_V1_PARAMS.entryTimeframe,
    candleTimeMs: evaluation.candleTime,
    regime: evaluation.regime,
    score: evaluation.score,
    tradingMode: "PAPER",
    reason: "e2e",
    result,
    referencePrice: evaluation.score.entryPrice,
    referencePriceAtMs: NOW,
    signalExpiryMinutes: settings.signalExpiryMinutes,
    candidateExpiryMinutes: settings.candidateExpiryMinutes,
    nowMs: NOW,
    newsContext: news,
  });

  return { candidate: result.candidate, row };
}

describe("MILESTONE 3 END TO END: feed -> event -> analysis -> candidate context -> Telegram", () => {
  it("walks the full path and attaches real news context to a real candidate", async () => {
    // ---- PHASE 1: ingest two providers carrying the same story ----------
    const db = makeNewsDb();
    const analyzer = createFakeAnalyzer();
    const report = await ingestNews({
      providers: [
        createFakeProvider("regulator", itemsFrom(LIVE_FEED, "regulator", "Example Regulator", "OFFICIAL")),
        createFakeProvider("media", itemsFrom(SYNDICATED_FEED, "media", "Example Media", "HIGH_QUALITY_MEDIA")),
      ],
      store: createFakeNewsStore(db),
      analyzer,
      now: () => NOW,
    });

    // Two feeds, three items, one of them a syndicated copy: two events.
    expect(report.newEvents).toBe(2);
    expect(report.duplicatesSkipped).toBe(1);
    // Only the material one was worth an AI call.
    expect(analyzer.calls).toBe(1);
    expect(report.analyzed).toBe(1);

    const etf = db.events.find((e) => e.headline.includes("SEC approves"))!;
    expect(etf.affectedAssets).toContain("BTC");
    expect(etf.category).toBe("ETF");
    expect(etf.newsRisk).toBe("HIGH");
    expect(etf.analysisStatus).toBe("COMPLETED");
    expect(etf.analysis?.summary).toBeTruthy();
    // Storage stays compact: an excerpt, never the article.
    expect((etf.excerpt ?? "").length).toBeLessThanOrEqual(280);

    // ---- PHASE 2: a real deterministic candidate picks it up ------------
    const news = buildCandidateNewsContext({ symbol: "BTCUSDT", events: db.events, nowMs: NOW });
    expect(news.status).toBe("OK");
    expect(news.newsRisk).toBe("HIGH");
    expect(news.events.map((e) => e.id)).toEqual([etf.id]);

    const { candidate, row } = buildCandidateWithNews(news);

    // The candidate itself is unchanged by news - this is the invariant.
    expect(candidate.position.riskReward).toBeCloseTo(2);
    expect(candidate.risk.riskBudget).toBeCloseTo(10);

    // ---- PHASE 3: the association is persisted immutably ----------------
    expect(row.news_risk).toBe("HIGH");
    const snapshot = row.news_snapshot as unknown as CandidateNewsContext;
    expect(snapshot.events.map((e) => e.id)).toEqual([etf.id]);
    expect(snapshot.generatedAt).toBe(new Date(NOW).toISOString());

    // ---- PHASE 4: Telegram shows concise context ------------------------
    const message = formatCandidateMessage({
      candidate,
      riskModeLabel: "1.00% of equity",
      validForMinutes: 7,
      news,
    });
    expect(message).toContain("- - - NEWS - - -");
    expect(message).toContain("Risk           HIGH");
    expect(message).toContain("Context");
    expect(message).toContain("SEC approves spot Bitcoin ETF applications");
    // Still an approval surface, not a newsfeed.
    expect(message.split("\n").length).toBeLessThan(60);
  });

  it("with the AI layer unavailable, the SAME deterministic candidate still appears", async () => {
    const db = makeNewsDb();
    const report = await ingestNews({
      providers: [
        createFakeProvider("regulator", itemsFrom(LIVE_FEED, "regulator", "Example Regulator", "OFFICIAL")),
      ],
      store: createFakeNewsStore(db),
      // Qwen is completely unavailable.
      analyzer: createFakeAnalyzer({ status: "NOT_CONFIGURED" }),
      now: () => NOW,
    });

    // Deterministic ingestion is entirely unaffected.
    expect(report.newEvents).toBe(2);
    expect(db.events.find((e) => e.headline.includes("SEC approves"))!.analysisStatus).toBe("UNAVAILABLE");
    // The deterministic classification still stands on its own.
    expect(db.events.find((e) => e.headline.includes("SEC approves"))!.newsRisk).toBe("HIGH");

    // Now the harder case: the news subsystem cannot be consulted AT ALL.
    const unavailable = buildCandidateNewsContext({
      symbol: "BTCUSDT",
      events: [],
      nowMs: NOW,
      unavailable: true,
    });
    expect(unavailable.newsRisk).toBe("UNKNOWN");

    const withNews = buildCandidateWithNews(unavailable);
    const withoutNewsAtAll = buildCandidateWithNews(undefined);

    // The candidate is IDENTICAL in every financial respect.
    expect(withNews.candidate.risk).toEqual(withoutNewsAtAll.candidate.risk);
    expect(withNews.candidate.position).toEqual(withoutNewsAtAll.candidate.position);
    expect(withNews.row.approval_status).toBe("PENDING");
    expect(withNews.row.news_risk).toBe("UNKNOWN");

    const message = formatCandidateMessage({
      candidate: withNews.candidate,
      riskModeLabel: "1.00% of equity",
      validForMinutes: 7,
      news: unavailable,
    });
    expect(message).toContain("Risk           UNKNOWN");
    expect(message).toContain("News analysis temporarily unavailable");
    expect(message).toContain("Technical and risk checks are independent");
  });

  it("news NEVER changes risk, sizing, stop, target or eligibility", () => {
    const high = buildCandidateWithNews({
      newsRisk: "HIGH",
      headline: "Something alarming happened",
      status: "OK",
      generatedAt: new Date(NOW).toISOString(),
      events: [
        {
          id: "e1",
          headline: "Something alarming happened",
          source: "S",
          sourceQuality: "OFFICIAL",
          category: "REGULATION",
          publishedAt: new Date(NOW - 60_000).toISOString(),
          newsRisk: "HIGH",
          summary: "Alarming",
        },
      ],
    });
    const none = buildCandidateWithNews(undefined);

    // Every financial field is byte-identical regardless of news risk.
    expect(high.candidate.risk).toEqual(none.candidate.risk);
    expect(high.candidate.position).toEqual(none.candidate.position);
    expect(high.row.stop_price).toBe(none.row.stop_price);
    expect(high.row.target_price).toBe(none.row.target_price);
    expect(high.row.minimum_allowed_entry).toBe(none.row.minimum_allowed_entry);
    expect(high.row.maximum_allowed_entry).toBe(none.row.maximum_allowed_entry);
    expect(high.row.risk_snapshot).toEqual(none.row.risk_snapshot);
    // HIGH news risk does not block an otherwise valid candidate.
    expect(high.row.approval_status).toBe("PENDING");
  });

  it("a historical candidate keeps the news it was shown, not today's news", () => {
    const original = buildCandidateNewsContext({
      symbol: "BTCUSDT",
      events: [],
      nowMs: NOW,
    });
    const { row } = buildCandidateWithNews(original);
    const stored = JSON.stringify(row.news_snapshot);

    // Time passes and dramatic new events arrive.
    const later = buildCandidateNewsContext({
      symbol: "BTCUSDT",
      events: [],
      nowMs: NOW + 86_400_000,
      unavailable: true,
    });
    expect(later.newsRisk).toBe("UNKNOWN");

    // The persisted snapshot is untouched.
    expect(JSON.stringify(row.news_snapshot)).toBe(stored);
    expect((row.news_snapshot as unknown as CandidateNewsContext).newsRisk).toBe("LOW");
  });
});
