import { describe, expect, it } from "vitest";
import { InMemoryUniverseRepository } from "@/lib/domain/universe";
import { CRYPTO_SPOT_INSTRUMENTS } from "@/lib/domain/instruments/crypto";
import { getApprovedResearchInstruments } from "../eligible-universe-gate";

const UNIVERSE_DEF = {
  id: "u1",
  key: "crypto-core",
  name: "Crypto Core",
  purpose: "HISTORICAL" as const,
  assetClass: "CRYPTO_SPOT" as const,
  venueId: "BYBIT",
  enabled: true,
};

describe("getApprovedResearchInstruments (§20-§22) — never bypasses eligibility", () => {
  it("returns zero instruments and a clear blocker report when all research-selected members are UNKNOWN (the live-database state today)", async () => {
    const repo = new InMemoryUniverseRepository();
    repo.seedUniverse(
      UNIVERSE_DEF,
      CRYPTO_SPOT_INSTRUMENTS.map((instrument) => ({
        universeId: "u1",
        instrument,
        researchEnabled: true,
        shadowEnabled: false,
        paperEnabled: false,
        eligibilityStatus: "UNKNOWN" as const,
        eligibilityCheckedAt: null,
      })),
    );

    const result = await getApprovedResearchInstruments(repo, "crypto-core");
    expect(result.eligibleInstruments).toEqual([]);
    expect(result.researchSelectedCount).toBe(CRYPTO_SPOT_INSTRUMENTS.length);
    expect(result.blockedByEligibilityCount).toBe(CRYPTO_SPOT_INSTRUMENTS.length);
    expect(result.report).toMatch(/0\//);
    expect(result.report).toMatch(/runtime provider verification/);
  });

  it("only returns instruments that are actually ELIGIBLE (with a real checkedAt), never UNKNOWN or INELIGIBLE ones", async () => {
    const repo = new InMemoryUniverseRepository();
    const [btc, eth, sol] = CRYPTO_SPOT_INSTRUMENTS;
    repo.seedUniverse(UNIVERSE_DEF, [
      { universeId: "u1", instrument: btc, researchEnabled: true, shadowEnabled: false, paperEnabled: false, eligibilityStatus: "ELIGIBLE", eligibilityCheckedAt: Date.now() },
      { universeId: "u1", instrument: eth, researchEnabled: true, shadowEnabled: false, paperEnabled: false, eligibilityStatus: "UNKNOWN", eligibilityCheckedAt: null },
      { universeId: "u1", instrument: sol, researchEnabled: true, shadowEnabled: false, paperEnabled: false, eligibilityStatus: "INELIGIBLE", eligibilityCheckedAt: Date.now() },
    ]);

    const result = await getApprovedResearchInstruments(repo, "crypto-core");
    expect(result.eligibleInstruments.map((i) => i.venueSymbol)).toEqual(["BTCUSDT"]);
    expect(result.researchSelectedCount).toBe(3);
    expect(result.blockedByEligibilityCount).toBe(2);
  });

  it("this function's own source calls getEligibleResearchUniverse, never getResearchUniverse, as its instrument source (static guard against a future silent bypass)", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../eligible-universe-gate.ts", import.meta.url), "utf8"),
    );
    expect(source).toMatch(/getEligibleResearchUniverse/);
    expect(source).not.toMatch(/\.getResearchUniverse\(/);
  });
});
