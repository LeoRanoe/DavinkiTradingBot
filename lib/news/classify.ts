import type {
  AffectedAsset,
  NewsCategory,
  NewsClassification,
  NewsRisk,
  NormalizedNewsItem,
  SourceQuality,
} from "./types";

/**
 * Deterministic news classification. Runs BEFORE any AI is considered, and
 * is what decides whether an item is even worth an AI call.
 *
 * Everything here is keyword/heuristic based and therefore honest about its
 * limits: it produces a BASE risk and a relevance score, not a verdict. The
 * AI layer may refine the summary and impact; it can never make an
 * irrelevant story relevant to the trading engine, because the engine never
 * reads news at all.
 */

type TermRule = { terms: string[]; category?: NewsCategory; assets?: AffectedAsset[]; weight: number };

/** Matched as substrings - long and unambiguous. */
const BTC_TERMS = ["bitcoin", "satoshi"];
const ETH_TERMS = ["ethereum", "vitalik"];
/**
 * Matched on word boundaries ONLY. Substring matching here is actively
 * wrong: "together" contains "ether", and "ethics"/"methods" sit one
 * character away from "eth".
 */
const BTC_TICKERS = ["btc"];
const ETH_TICKERS = ["eth", "ether"];
const CRYPTO_MARKET_TERMS = [
  "crypto",
  "cryptocurrency",
  "digital asset",
  "digital assets",
  "blockchain",
  "stablecoin",
  "altcoin",
  "defi",
  "web3",
  "token",
];

/**
 * Macro/FX vocabulary. Not traded today - these classify an event as
 * MACRO/USD so the same framework already works for a future XAUUSD
 * instrument, and so macro events can still raise crypto-market risk.
 */
const MACRO_TERMS = [
  "federal reserve",
  "fed ",
  "fomc",
  "interest rate",
  "rate cut",
  "rate hike",
  "cpi",
  "inflation",
  "pce",
  "nonfarm",
  "non-farm",
  "nfp",
  "jobs report",
  "treasury yield",
  "central bank",
  "ecb",
  "bank of japan",
  "recession",
];

const CATEGORY_RULES: TermRule[] = [
  { terms: ["etf", "exchange-traded fund", "spot etf"], category: "ETF", weight: 0.35 },
  {
    terms: ["sec ", "cftc", "regulator", "regulation", "regulatory", "enforcement", "subpoena", "sanction"],
    category: "REGULATION",
    weight: 0.3,
  },
  { terms: ["lawsuit", "court", "judge", "settlement", "indictment", "plea", "appeal"], category: "LEGAL", weight: 0.25 },
  {
    terms: ["hack", "hacked", "exploit", "breach", "stolen", "drained", "vulnerability"],
    category: "SECURITY_HACK",
    weight: 0.35,
  },
  {
    terms: ["exchange halts", "withdrawals", "insolvency", "bankrupt", "delisting", "outage"],
    category: "EXCHANGE",
    weight: 0.3,
  },
  { terms: ["upgrade", "hard fork", "mainnet", "testnet", "protocol"], category: "PROTOCOL", weight: 0.2 },
  { terms: ["halving", "burn", "unlock", "supply", "issuance"], category: "TOKEN_SUPPLY", weight: 0.2 },
  { terms: ["adoption", "partnership", "integration", "launches", "accepts"], category: "ADOPTION", weight: 0.15 },
  { terms: ["war", "conflict", "strike", "military", "tariff", "election"], category: "GEOPOLITICAL", weight: 0.2 },
  { terms: ["inflow", "outflow", "liquidation", "open interest", "funding rate"], category: "MARKET_FLOW", weight: 0.2 },
  { terms: ["cpi", "inflation", "pce"], category: "INFLATION", weight: 0.25 },
  { terms: ["interest rate", "rate cut", "rate hike", "fomc", "federal reserve"], category: "INTEREST_RATES", weight: 0.25 },
];

/**
 * Categories whose events are CAPABLE of being high-impact. Membership alone
 * never makes an event HIGH - the source must also be credible and the
 * language must indicate a concrete action rather than speculation.
 */
const POTENTIALLY_HIGH_IMPACT: NewsCategory[] = [
  "REGULATION",
  "ETF",
  "SECURITY_HACK",
  "EXCHANGE",
  "INTEREST_RATES",
  "INFLATION",
  "GEOPOLITICAL",
];

/**
 * Language indicating something has actually happened, not that it might.
 * Stored as STEMS so tense and number variants all match - "approves",
 * "approved" and "approval" are the same signal.
 */
const CONCRETE_TERMS = [
  "approv",
  "reject",
  "announc",
  "filed",
  "filing",
  "rule",
  "launch",
  "halt",
  "suspend",
  "hack",
  "breach",
  "raise",
  "seiz",
  "sue",
  "charg",
  "confirm",
  "ban ",
  "banned",
];

/** Language indicating speculation. Keeps rumor out of the HIGH bucket. */
const SPECULATIVE_TERMS = [
  "could",
  "may ",
  "might",
  "rumor",
  "rumour",
  "reportedly",
  "sources say",
  "expected to",
  "predicts",
  "forecast",
  "analyst",
  "speculation",
  "eyes ",
  "weighs",
];

function haystack(item: Pick<NormalizedNewsItem, "headline" | "excerpt">): string {
  return `${item.headline} ${item.excerpt ?? ""}`.toLowerCase();
}

function matches(text: string, terms: string[]): string[] {
  return terms.filter((t) => text.includes(t));
}

/**
 * Word-boundary aware check for short, ambiguous tickers. "eth" must not
 * match "ethics" or "together", and "btc" should still match "btc/usd".
 */
function matchesTicker(text: string, ticker: string): boolean {
  return new RegExp(`(^|[^a-z])${ticker}([^a-z]|$)`, "i").test(text);
}

export function classifyNewsItem(item: NormalizedNewsItem): NewsClassification {
  const text = haystack(item);
  const matchedTerms: string[] = [];
  const assets = new Set<AffectedAsset>();
  let relevance = 0;

  // --- Asset relevance --------------------------------------------------
  const btcHits = [...matches(text, BTC_TERMS), ...BTC_TICKERS.filter((t) => matchesTicker(text, t))];
  if (btcHits.length > 0) {
    assets.add("BTC");
    relevance += 0.45;
    matchedTerms.push(...btcHits);
  }

  const ethHits = [...matches(text, ETH_TERMS), ...ETH_TICKERS.filter((t) => matchesTicker(text, t))];
  if (ethHits.length > 0) {
    assets.add("ETH");
    relevance += 0.45;
    matchedTerms.push(...ethHits);
  }

  const marketHits = matches(text, CRYPTO_MARKET_TERMS);
  if (marketHits.length > 0) {
    assets.add("CRYPTO_MARKET");
    relevance += 0.3;
    matchedTerms.push(...marketHits);
  }

  const macroHits = matches(text, MACRO_TERMS);
  if (macroHits.length > 0) {
    assets.add("MACRO");
    assets.add("USD");
    matchedTerms.push(...macroHits);
    // Macro moves crypto too, but less directly than a crypto-specific story.
    relevance += assets.has("BTC") || assets.has("ETH") ? 0.2 : 0.25;
    if (!assets.has("BTC") && !assets.has("ETH")) assets.add("CRYPTO_MARKET");
  }

  // --- Category ---------------------------------------------------------
  let category: NewsCategory = "OTHER";
  let bestWeight = 0;
  for (const rule of CATEGORY_RULES) {
    const hits = matches(text, rule.terms);
    if (hits.length === 0) continue;
    matchedTerms.push(...hits);
    relevance += rule.weight * 0.4;
    if (rule.weight > bestWeight && rule.category) {
      bestWeight = rule.weight;
      category = rule.category;
    }
  }
  if (category === "OTHER" && macroHits.length > 0) category = "MACRO";

  // --- Source quality contribution --------------------------------------
  relevance += sourceQualityBoost(item.sourceQuality);

  const relevanceScore = Math.max(0, Math.min(1, Number(relevance.toFixed(3))));

  return {
    category,
    affectedAssets: [...assets],
    relevanceScore,
    baseRisk: baseRiskFor({ category, text, sourceQuality: item.sourceQuality, relevanceScore }),
    matchedTerms: [...new Set(matchedTerms)],
  };
}

function sourceQualityBoost(quality: SourceQuality): number {
  switch (quality) {
    case "OFFICIAL":
      return 0.15;
    case "HIGH_QUALITY_MEDIA":
      return 0.08;
    case "SECONDARY":
      return 0;
    case "UNKNOWN":
      return -0.05;
  }
}

/**
 * Deterministic base risk.
 *
 * Deliberately conservative in BOTH directions: an important-sounding
 * category alone is not HIGH (that would make every regulatory headline an
 * alarm), and speculation is never HIGH no matter how dramatic the wording.
 */
function baseRiskFor(input: {
  category: NewsCategory;
  text: string;
  sourceQuality: SourceQuality;
  relevanceScore: number;
}): NewsRisk {
  const { category, text, sourceQuality, relevanceScore } = input;

  if (relevanceScore < 0.2) return "LOW";

  const speculative = matches(text, SPECULATIVE_TERMS).length > 0;
  const concrete = matches(text, CONCRETE_TERMS).length > 0;
  const capableOfHighImpact = POTENTIALLY_HIGH_IMPACT.includes(category);
  const credible = sourceQuality === "OFFICIAL" || sourceQuality === "HIGH_QUALITY_MEDIA";

  if (capableOfHighImpact && concrete && credible && !speculative) return "HIGH";
  if (capableOfHighImpact && (concrete || credible)) return "MEDIUM";
  if (category === "OTHER") return "LOW";
  return relevanceScore >= 0.5 ? "MEDIUM" : "LOW";
}

/**
 * Whether an item is worth spending an AI call on. Most items must fail this
 * check - the scanner runs every few minutes and routine ingestion should
 * produce zero AI calls.
 */
export function shouldAnalyzeWithAi(classification: NewsClassification): boolean {
  const touchesTradedAssets =
    classification.affectedAssets.includes("BTC") ||
    classification.affectedAssets.includes("ETH") ||
    classification.affectedAssets.includes("CRYPTO_MARKET");

  if (!touchesTradedAssets) return false;
  if (classification.relevanceScore < 0.5) return false;
  if (classification.baseRisk === "LOW" || classification.baseRisk === "UNKNOWN") return false;

  // A MEDIUM rating alone is not enough: routine adoption/partnership items
  // clear the relevance bar easily and would quietly turn every ingestion
  // run into an AI run. Only categories genuinely capable of moving the
  // market earn a call at MEDIUM.
  if (classification.baseRisk === "MEDIUM") {
    return POTENTIALLY_HIGH_IMPACT.includes(classification.category);
  }
  return true;
}

/** Combines the deterministic baseline with a validated AI impact reading. */
export function combineRisk(baseRisk: NewsRisk, aiImpact: NewsAnalysisImpact | null): NewsRisk {
  if (aiImpact === null || aiImpact === "UNKNOWN") return baseRisk;
  const order: NewsRisk[] = ["LOW", "MEDIUM", "HIGH"];
  const baseIndex = order.indexOf(baseRisk);
  const aiIndex = order.indexOf(aiImpact);
  if (baseIndex === -1) return baseRisk;
  // Take the more cautious of the two: AI may raise concern, and may only
  // lower it by one step, so a confident model cannot talk the system out of
  // a deterministic warning.
  if (aiIndex > baseIndex) return order[aiIndex];
  if (aiIndex < baseIndex) return order[Math.max(0, baseIndex - 1)];
  return baseRisk;
}

export type NewsAnalysisImpact = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
