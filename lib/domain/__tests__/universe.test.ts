import { describe, expect, it } from "vitest";
import { InMemoryUniverseRepository, selectEligibleResearchInstruments, type UniverseDefinition, type UniverseMember } from "../universe";
import type { Instrument } from "../instrument";
import { CRYPTO_SPOT_INSTRUMENTS } from "../instruments/crypto";
import { FAKE_FOREX_INSTRUMENTS } from "../instruments/forex-fake";

function member(instrument: Instrument, flags: Partial<UniverseMember> = {}): UniverseMember {
  return {
    universeId: "u1",
    instrument,
    researchEnabled: false,
    shadowEnabled: false,
    paperEnabled: false,
    eligibilityStatus: "UNKNOWN",
    eligibilityCheckedAt: null,
    ...flags,
  };
}

function cryptoCoreDef(overrides: Partial<UniverseDefinition> = {}): UniverseDefinition {
  return {
    id: "u1",
    key: "crypto-core",
    name: "Crypto Core",
    purpose: "HISTORICAL",
    assetClass: "CRYPTO_SPOT",
    venueId: "BYBIT",
    enabled: true,
    ...overrides,
  };
}

describe("InMemoryUniverseRepository", () => {
  it("getResearchUniverse returns only researchEnabled members (selection, not eligibility)", async () => {
    const repo = new InMemoryUniverseRepository();
    const [btc, eth, sol] = CRYPTO_SPOT_INSTRUMENTS;
    repo.seedUniverse(cryptoCoreDef(), [
      member(btc, { researchEnabled: true }),
      member(eth, { researchEnabled: true }),
      member(sol, { researchEnabled: false }), // e.g. disabled pending eligibility review
    ]);

    const research = await repo.getResearchUniverse("crypto-core");
    expect(research.map((i) => i.venueSymbol).sort()).toEqual(["BTCUSDT", "ETHUSDT"]);
  });

  it("keeps research and paper permission strictly separate: research-enabled does not imply paper-enabled", async () => {
    const repo = new InMemoryUniverseRepository();
    const [, , sol] = CRYPTO_SPOT_INSTRUMENTS;
    repo.seedUniverse(cryptoCoreDef(), [member(sol, { researchEnabled: true, paperEnabled: false })]);

    const members = await repo.listUniverseMembers("crypto-core");
    expect(members[0].researchEnabled).toBe(true);
    expect(members[0].paperEnabled).toBe(false);
  });

  it("setMemberFlags can enable research without touching paper, and vice versa", async () => {
    const repo = new InMemoryUniverseRepository();
    const [, , sol] = CRYPTO_SPOT_INSTRUMENTS;
    repo.seedUniverse(cryptoCoreDef(), [member(sol)]);

    await repo.setMemberFlags("crypto-core", sol.id, { researchEnabled: true });
    let members = await repo.listUniverseMembers("crypto-core");
    expect(members[0].researchEnabled).toBe(true);
    expect(members[0].paperEnabled).toBe(false); // unchanged

    await repo.setMemberFlags("crypto-core", sol.id, { paperEnabled: true });
    members = await repo.listUniverseMembers("crypto-core");
    expect(members[0].researchEnabled).toBe(true); // still true, not clobbered
    expect(members[0].paperEnabled).toBe(true);
  });

  it("a disabled/absent universe member yields an empty research universe rather than throwing", async () => {
    const repo = new InMemoryUniverseRepository();
    expect(await repo.getResearchUniverse("does-not-exist")).toEqual([]);
    expect(await repo.listUniverseMembers("does-not-exist")).toEqual([]);
  });

  it("UniverseMember has no liveEnabled field to ever set true (LIVE stays impossible at the type level)", () => {
    const m = member(CRYPTO_SPOT_INSTRUMENTS[0]);
    expect(Object.keys(m)).not.toContain("liveEnabled");
  });

  it("carries the universe's assetClass and a nullable venueId, previously discarded", async () => {
    const repo = new InMemoryUniverseRepository();
    repo.seedUniverse(cryptoCoreDef(), [member(CRYPTO_SPOT_INSTRUMENTS[0])]);
    const universe = await repo.getUniverse("crypto-core");
    expect(universe?.assetClass).toBe("CRYPTO_SPOT");
    expect(universe?.venueId).toBe("BYBIT");
  });

  it("can seed a FOREX universe with the fake fixtures without any schema change (forex readiness proof)", async () => {
    const repo = new InMemoryUniverseRepository();
    const [eurusd, usdjpy] = FAKE_FOREX_INSTRUMENTS;
    repo.seedUniverse(cryptoCoreDef({ id: "u2", key: "fx-fake-fixtures", name: "FX Fixtures (test-only)", assetClass: "FOREX", venueId: "OANDA_FAKE" }), [
      member(eurusd, { researchEnabled: true }),
      member(usdjpy, { researchEnabled: true }),
    ]);

    const research = await repo.getResearchUniverse("fx-fake-fixtures");
    expect(research.map((i) => i.venueSymbol).sort()).toEqual(["EUR_USD", "USD_JPY"]);
  });

  describe("checked_at semantics (Checkpoint 2 review §1)", () => {
    it("a never-verified UNKNOWN member has eligibilityCheckedAt = null", async () => {
      const repo = new InMemoryUniverseRepository();
      const sol = CRYPTO_SPOT_INSTRUMENTS[2];
      repo.seedUniverse(cryptoCoreDef(), [member(sol, { researchEnabled: true })]);

      const [m] = await repo.listUniverseMembers("crypto-core");
      expect(m.eligibilityStatus).toBe("UNKNOWN");
      expect(m.eligibilityCheckedAt).toBeNull();
    });

    it("a real provider verification populates eligibilityCheckedAt with the timestamp it actually ran at", async () => {
      const repo = new InMemoryUniverseRepository();
      const sol = CRYPTO_SPOT_INSTRUMENTS[2];
      repo.seedUniverse(cryptoCoreDef(), [member(sol, { researchEnabled: true })]);

      const verifiedAtMs = Date.parse("2026-09-15T00:00:00.000Z");
      await repo.setEligibility("crypto-core", sol.id, "ELIGIBLE", verifiedAtMs);

      const [m] = await repo.listUniverseMembers("crypto-core");
      expect(m.eligibilityStatus).toBe("ELIGIBLE");
      expect(m.eligibilityCheckedAt).toBe(verifiedAtMs);
    });
  });

  describe("getEligibleResearchUniverse (fail-closed, Checkpoint 2 review §2)", () => {
    it("RESEARCH_ENABLED + UNKNOWN -> NOT eligible", async () => {
      const repo = new InMemoryUniverseRepository();
      const sol = CRYPTO_SPOT_INSTRUMENTS[2];
      repo.seedUniverse(cryptoCoreDef(), [member(sol, { researchEnabled: true, eligibilityStatus: "UNKNOWN" })]);
      expect(await repo.getEligibleResearchUniverse("crypto-core")).toEqual([]);
    });

    it("RESEARCH_ENABLED + INELIGIBLE -> NOT eligible", async () => {
      const repo = new InMemoryUniverseRepository();
      const sol = CRYPTO_SPOT_INSTRUMENTS[2];
      repo.seedUniverse(cryptoCoreDef(), [member(sol, { researchEnabled: true, eligibilityStatus: "INELIGIBLE" })]);
      expect(await repo.getEligibleResearchUniverse("crypto-core")).toEqual([]);
    });

    it("RESEARCH_ENABLED + ELIGIBLE -> eligible", async () => {
      const repo = new InMemoryUniverseRepository();
      const [btc] = CRYPTO_SPOT_INSTRUMENTS;
      repo.seedUniverse(cryptoCoreDef(), [member(btc, { researchEnabled: true, eligibilityStatus: "ELIGIBLE" })]);
      const eligible = await repo.getEligibleResearchUniverse("crypto-core");
      expect(eligible.map((i) => i.venueSymbol)).toEqual(["BTCUSDT"]);
    });

    it("disabled universe -> none eligible, even with an ELIGIBLE, research-selected member", async () => {
      const repo = new InMemoryUniverseRepository();
      const [btc] = CRYPTO_SPOT_INSTRUMENTS;
      repo.seedUniverse(cryptoCoreDef({ enabled: false }), [member(btc, { researchEnabled: true, eligibilityStatus: "ELIGIBLE" })]);
      expect(await repo.getEligibleResearchUniverse("crypto-core")).toEqual([]);
    });

    it("inactive instrument -> not eligible, even if ELIGIBLE and research-selected", async () => {
      const repo = new InMemoryUniverseRepository();
      const inactiveBtc: Instrument = { ...CRYPTO_SPOT_INSTRUMENTS[0], isActive: false };
      repo.seedUniverse(cryptoCoreDef(), [member(inactiveBtc, { researchEnabled: true, eligibilityStatus: "ELIGIBLE" })]);
      expect(await repo.getEligibleResearchUniverse("crypto-core")).toEqual([]);
    });

    it("not research-selected -> not eligible, even if ELIGIBLE", async () => {
      const repo = new InMemoryUniverseRepository();
      const [btc] = CRYPTO_SPOT_INSTRUMENTS;
      repo.seedUniverse(cryptoCoreDef(), [member(btc, { researchEnabled: false, eligibilityStatus: "ELIGIBLE" })]);
      expect(await repo.getEligibleResearchUniverse("crypto-core")).toEqual([]);
    });

    it("getEligibleResearchUniverse for an unknown universe key is empty, not a throw", async () => {
      const repo = new InMemoryUniverseRepository();
      expect(await repo.getEligibleResearchUniverse("does-not-exist")).toEqual([]);
    });
  });

  describe("selectEligibleResearchInstruments (pure helper, shared by both repository implementations)", () => {
    it("is the single source of truth for the fail-closed rule", () => {
      const universe = cryptoCoreDef();
      const eligibleMember = member(CRYPTO_SPOT_INSTRUMENTS[0], { researchEnabled: true, eligibilityStatus: "ELIGIBLE" });
      const unknownMember = member(CRYPTO_SPOT_INSTRUMENTS[1], { researchEnabled: true, eligibilityStatus: "UNKNOWN" });
      const result = selectEligibleResearchInstruments(universe, [eligibleMember, unknownMember]);
      expect(result.map((i) => i.venueSymbol)).toEqual(["BTCUSDT"]);
    });

    it("returns [] for a null universe", () => {
      const eligibleMember = member(CRYPTO_SPOT_INSTRUMENTS[0], { researchEnabled: true, eligibilityStatus: "ELIGIBLE" });
      expect(selectEligibleResearchInstruments(null, [eligibleMember])).toEqual([]);
    });
  });
});
