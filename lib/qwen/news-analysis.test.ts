import { afterEach, describe, expect, it, vi } from "vitest";
import { qwenNewsAnalysisSchema } from "./news-schema";
import { classifyAiError } from "@/lib/ai/usage";

vi.mock("@/lib/config/integrations", () => ({
  getQwenConfiguration: vi.fn(async () => mockConfig),
}));

let mockConfig: { apiKey: string; baseUrl: string; model: string; source: string } | null = {
  apiKey: "test-key",
  baseUrl: "https://example.invalid/v1",
  model: "qwen-turbo",
  source: "env",
};

const { analyzeNewsEvent } = await import("./client");

const VALID = {
  summary: "A regulator approved several spot Bitcoin ETF applications.",
  affectedAssets: ["BTC", "CRYPTO_MARKET"],
  sentiment: "POSITIVE",
  potentialImpact: "HIGH",
  timeHorizon: "IMMEDIATE",
  relevance: 0.9,
  reasoning: "A concrete regulatory decision affecting a major listed product.",
  uncertainty: "Reaction may already be partly priced in.",
};

const INPUT = {
  headline: "SEC approves spot Bitcoin ETF applications",
  source: "SEC",
  sourceQuality: "OFFICIAL",
  category: "ETF",
  publishedAt: "2026-01-10T11:00:00.000Z",
  excerpt: null,
};

function mockFetchJson(body: unknown, init: { status?: number } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: (init.status ?? 200) < 400,
      status: init.status ?? 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    })),
  );
}

function completion(content: unknown, usage?: Record<string, number>) {
  return {
    choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
    usage: usage ?? { prompt_tokens: 320, completion_tokens: 95, total_tokens: 415 },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  mockConfig = { apiKey: "test-key", baseUrl: "https://example.invalid/v1", model: "qwen-turbo", source: "env" };
});

describe("structured output schema", () => {
  it("accepts a well-formed analysis", () => {
    expect(qwenNewsAnalysisSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects an out-of-range relevance", () => {
    expect(qwenNewsAnalysisSchema.safeParse({ ...VALID, relevance: 7 }).success).toBe(false);
  });

  it("rejects an invented enum value", () => {
    expect(qwenNewsAnalysisSchema.safeParse({ ...VALID, potentialImpact: "CATASTROPHIC" }).success).toBe(false);
    expect(qwenNewsAnalysisSchema.safeParse({ ...VALID, sentiment: "BUY" }).success).toBe(false);
  });

  it("rejects an unknown affected asset rather than coercing it", () => {
    expect(qwenNewsAnalysisSchema.safeParse({ ...VALID, affectedAssets: ["DOGE"] }).success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const withoutSummary: Record<string, unknown> = { ...VALID };
    delete withoutSummary.summary;
    expect(qwenNewsAnalysisSchema.safeParse(withoutSummary).success).toBe(false);
  });
});

describe("analyzeNewsEvent", () => {
  it("returns validated data and token accounting on success", async () => {
    mockFetchJson(completion(VALID));
    const result = await analyzeNewsEvent(INPUT);

    expect(result.status).toBe("OK");
    if (result.status !== "OK") return;
    expect(result.data.potentialImpact).toBe("HIGH");
    expect(result.usage?.inputTokens).toBe(320);
    expect(result.usage?.outputTokens).toBe(95);
    expect(result.usage?.totalTokens).toBe(415);
    expect(result.usage?.model).toBe("qwen-turbo");
    expect(result.usage?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reports a clean error for content that is not JSON at all - and never evaluates it", async () => {
    mockFetchJson(completion("I think you should buy bitcoin now!"));
    const result = await analyzeNewsEvent(INPUT);
    expect(result.status).toBe("ERROR");
    if (result.status === "ERROR") expect(result.message).toContain("non-JSON");
  });

  it("rejects structurally valid JSON that fails the schema", async () => {
    mockFetchJson(completion({ summary: "ok", sentiment: "BUY NOW" }));
    const result = await analyzeNewsEvent(INPUT);
    expect(result.status).toBe("ERROR");
    if (result.status === "ERROR") expect(result.message).toContain("malformed structured output");
  });

  it("classifies an authentication failure", async () => {
    mockFetchJson({}, { status: 401 });
    const result = await analyzeNewsEvent(INPUT);
    expect(result.status).toBe("ERROR");
    if (result.status === "ERROR") expect(classifyAiError(result.message)).toBe("AUTH");
  });

  it("classifies rate limiting", async () => {
    mockFetchJson({}, { status: 429 });
    const result = await analyzeNewsEvent(INPUT);
    expect(result.status).toBe("ERROR");
    if (result.status === "ERROR") expect(classifyAiError(result.message)).toBe("RATE_LIMIT");
  });

  it("classifies a timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const err = new Error("The operation was aborted");
        err.name = "AbortError";
        throw err;
      }),
    );
    const result = await analyzeNewsEvent(INPUT);
    expect(result.status).toBe("ERROR");
    if (result.status === "ERROR") expect(classifyAiError(result.message)).toBe("TIMEOUT");
  });

  it("returns NOT_CONFIGURED without calling the provider when no credential exists", async () => {
    mockConfig = null;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await analyzeNewsEvent(INPUT);
    expect(result.status).toBe("NOT_CONFIGURED");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("handles an empty completion without throwing", async () => {
    mockFetchJson({ choices: [], usage: {} });
    const result = await analyzeNewsEvent(INPUT);
    expect(result.status).toBe("ERROR");
  });

  it("copes with a provider that reports no usage block", async () => {
    mockFetchJson({ choices: [{ message: { content: JSON.stringify(VALID) } }] });
    const result = await analyzeNewsEvent(INPUT);
    expect(result.status).toBe("OK");
    if (result.status === "OK") {
      expect(result.usage?.totalTokens).toBeNull();
      expect(result.usage?.model).toBe("qwen-turbo");
    }
  });
});

describe("AI error classification", () => {
  it("maps provider messages to coarse classes without echoing them", () => {
    expect(classifyAiError("Authentication failed")).toBe("AUTH");
    expect(classifyAiError("Rate limited")).toBe("RATE_LIMIT");
    expect(classifyAiError("Provider unavailable (timeout)")).toBe("TIMEOUT");
    expect(classifyAiError("Provider returned malformed structured output")).toBe("MALFORMED_OUTPUT");
    expect(classifyAiError("something else entirely")).toBe("UNAVAILABLE");
  });
});
