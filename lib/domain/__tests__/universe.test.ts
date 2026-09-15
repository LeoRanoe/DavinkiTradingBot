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

  it("setMemberFlags can enable research without touching shadow, and vice versa - and never touches paper (final guardrail patch §6)", async () => {
    const repo = new InMemoryUniverseRepository();
    const [, , sol] = CRYPTO_SPOT_INSTRUMENTS;
    repo.seedUniverse(cryptoCoreDef(), [member(sol)]);

    await repo.setMemberFlags("crypto-core", sol.id, { researchEnabled: true });
    let members = await repo.listUniverseMembers("crypto-core");
    expect(members[0].researchEnabled).toBe(true);
    expect(members[0].shadowEnabled).toBe(false); // unchanged
    expect(members[0].paperEnabled).toBe(false); // never settable via this method

    await repo.setMemberFlags("crypto-core", sol.id, { shadowEnabled: true });
    members = await repo.listUniverseMembers("crypto-core");
    expect(members[0].researchEnabled).toBe(true); // still true, not clobbered
    expect(members[0].shadowEnabled).toBe(true);
    expect(members[0].paperEnabled).toBe(false); // still untouched
  });

  it("setMemberFlags's TypeScript signature has no paperEnabled key to pass at all", () => {
    // Compile-time proof, not a runtime assertion: this line would fail
    // `npm run typecheck` if paperEnabled were ever re-added to the
    // Partial<Pick<...>> flags parameter.
    type Flags = Parameters<InMemoryUniverseRepository["setMemberFlags"]>[2];
    type HasPaperEnabled = "paperEnabled" extends keyof Flags ? true : false;
    const hasPaperEnabled: HasPaperEnabled = false;
    expect(hasPaperEnabled).toBe(false);
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

    it("RESEARCH_ENABLED + ELIGIBLE + a real checkedAt -> eligible", async () => {
      const repo = new InMemoryUniverseRepository();
      const [btc] = CRYPTO_SPOT_INSTRUMENTS;
      repo.seedUniverse(cryptoCoreDef(), [
        member(btc, { researchEnabled: true, eligibilityStatus: "ELIGIBLE", eligibilityCheckedAt: Date.now() }),
      ]);
      const eligible = await repo.getEligibleResearchUniverse("crypto-core");
      expect(eligible.map((i) => i.venueSymbol)).toEqual(["BTCUSDT"]);
    });

    it("RESEARCH_ENABLED + ELIGIBLE but checkedAt still null -> NOT eligible (final guardrail patch §1 - a data bug, not trusted anyway)", async () => {
      const repo = new InMemoryUniverseRepository();
      const [btc] = CRYPTO_SPOT_INSTRUMENTS;
      repo.seedUniverse(cryptoCoreDef(), [
        member(btc, { researchEnabled: true, eligibilityStatus: "ELIGIBLE", eligibilityCheckedAt: null }),
      ]);
      expect(await repo.getEligibleResearchUniverse("crypto-core")).toEqual([]);
    });

    it("disabled universe -> none eligible, even with an ELIGIBLE, research-selected, checked member", async () => {
      const repo = new InMemoryUniverseRepository();
      const [btc] = CRYPTO_SPOT_INSTRUMENTS;
      repo.seedUniverse(cryptoCoreDef({ enabled: false }), [
        member(btc, { researchEnabled: true, eligibilityStatus: "ELIGIBLE", eligibilityCheckedAt: Date.now() }),
      ]);
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
      const eligibleMember = member(CRYPTO_SPOT_INSTRUMENTS[0], {
        researchEnabled: true,
        eligibilityStatus: "ELIGIBLE",
        eligibilityCheckedAt: Date.now(),
      });
      const unknownMember = member(CRYPTO_SPOT_INSTRUMENTS[1], { researchEnabled: true, eligibilityStatus: "UNKNOWN" });
      const result = selectEligibleResearchInstruments(universe, [eligibleMember, unknownMember]);
      expect(result.map((i) => i.venueSymbol)).toEqual(["BTCUSDT"]);
    });

    it("returns [] for a null universe", () => {
      const eligibleMember = member(CRYPTO_SPOT_INSTRUMENTS[0], {
        researchEnabled: true,
        eligibilityStatus: "ELIGIBLE",
        eligibilityCheckedAt: Date.now(),
      });
      expect(selectEligibleResearchInstruments(null, [eligibleMember])).toEqual([]);
    });

    it("returns [] for an ELIGIBLE member with a null eligibilityCheckedAt (final guardrail patch §1)", () => {
      const universe = cryptoCoreDef();
      const corruptMember = member(CRYPTO_SPOT_INSTRUMENTS[0], {
        researchEnabled: true,
        eligibilityStatus: "ELIGIBLE",
        eligibilityCheckedAt: null,
      });
      expect(selectEligibleResearchInstruments(universe, [corruptMember])).toEqual([]);
    });

    describe("asset-class/venue defense in depth (cross-table invariant completion §5)", () => {
      it("excludes a member whose instrument.assetClass doesn't match universe.assetClass, even if flagged ELIGIBLE", () => {
        const universe = cryptoCoreDef(); // CRYPTO_SPOT
        const [eurusd] = FAKE_FOREX_INSTRUMENTS; // FOREX - a mismatched pairing that should be structurally impossible
        const mismatched = member(eurusd, {
          researchEnabled: true,
          eligibilityStatus: "ELIGIBLE",
          eligibilityCheckedAt: Date.now(),
        });
        expect(selectEligibleResearchInstruments(universe, [mismatched])).toEqual([]);
      });

      it("excludes a member whose instrument.venue doesn't match a universe-pinned venueId, even if flagged ELIGIBLE", () => {
        const universe = cryptoCoreDef({ venueId: "BYBIT" });
        const wrongVenueInstrument: Instrument = { ...CRYPTO_SPOT_INSTRUMENTS[0], venue: "KRAKEN" };
        const mismatched = member(wrongVenueInstrument, {
          researchEnabled: true,
          eligibilityStatus: "ELIGIBLE",
          eligibilityCheckedAt: Date.now(),
        });
        expect(selectEligibleResearchInstruments(universe, [mismatched])).toEqual([]);
      });

      it("allows any venue when universe.venueId is null (venue-agnostic universe)", () => {
        const universe = cryptoCoreDef({ venueId: null });
        const krakenInstrument: Instrument = { ...CRYPTO_SPOT_INSTRUMENTS[0], venue: "KRAKEN" };
        const eligible = member(krakenInstrument, {
          researchEnabled: true,
          eligibilityStatus: "ELIGIBLE",
          eligibilityCheckedAt: Date.now(),
        });
        const result = selectEligibleResearchInstruments(universe, [eligible]);
        expect(result.map((i) => i.venue)).toEqual(["KRAKEN"]);
      });
    });
  });
});
