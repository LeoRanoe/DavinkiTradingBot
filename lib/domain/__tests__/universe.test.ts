import { describe, expect, it } from "vitest";
import { InMemoryUniverseRepository, type UniverseMember } from "../universe";
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
    ...flags,
  };
}

describe("InMemoryUniverseRepository", () => {
  it("getResearchUniverse returns only researchEnabled members", async () => {
    const repo = new InMemoryUniverseRepository();
    const [btc, eth, sol] = CRYPTO_SPOT_INSTRUMENTS;
    repo.seedUniverse(
      { id: "u1", key: "crypto-core", name: "Crypto Core", purpose: "HISTORICAL", enabled: true },
      [
        member(btc, { researchEnabled: true }),
        member(eth, { researchEnabled: true }),
        member(sol, { researchEnabled: false }), // e.g. disabled pending eligibility review
      ],
    );

    const research = await repo.getResearchUniverse("crypto-core");
    expect(research.map((i) => i.venueSymbol).sort()).toEqual(["BTCUSDT", "ETHUSDT"]);
  });

  it("keeps research and paper permission strictly separate: research-enabled does not imply paper-enabled", async () => {
    const repo = new InMemoryUniverseRepository();
    const [, , sol] = CRYPTO_SPOT_INSTRUMENTS;
    repo.seedUniverse({ id: "u1", key: "crypto-core", name: "Crypto Core", purpose: "HISTORICAL", enabled: true }, [
      member(sol, { researchEnabled: true, paperEnabled: false }),
    ]);

    const members = await repo.listUniverseMembers("crypto-core");
    expect(members[0].researchEnabled).toBe(true);
    expect(members[0].paperEnabled).toBe(false);
  });

  it("setMemberFlags can enable research without touching paper, and vice versa", async () => {
    const repo = new InMemoryUniverseRepository();
    const [, , sol] = CRYPTO_SPOT_INSTRUMENTS;
    repo.seedUniverse({ id: "u1", key: "crypto-core", name: "Crypto Core", purpose: "HISTORICAL", enabled: true }, [
      member(sol),
    ]);

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

  it("can seed a FOREX universe with the fake fixtures without any schema change (forex readiness proof)", async () => {
    const repo = new InMemoryUniverseRepository();
    const [eurusd, usdjpy] = FAKE_FOREX_INSTRUMENTS;
    repo.seedUniverse(
      { id: "u2", key: "fx-fake-fixtures", name: "FX Fixtures (test-only)", purpose: "HISTORICAL", enabled: true },
      [member(eurusd, { researchEnabled: true }), member(usdjpy, { researchEnabled: true })],
    );

    const research = await repo.getResearchUniverse("fx-fake-fixtures");
    expect(research.map((i) => i.venueSymbol).sort()).toEqual(["EUR_USD", "USD_JPY"]);
  });
});
