import { describe, expect, it } from "vitest";
import { checkEntryProtection, computeEntryZone, computeExpiry } from "./entry-protection";

describe("entry protection (spec Milestone 1: no chasing, no stale prices)", () => {
  it("builds a symmetric allowed entry zone around the planned entry", () => {
    const zone = computeEntryZone(100, 0.001); // 0.1%
    expect(zone.minimumAllowedEntry).toBeCloseTo(99.9);
    expect(zone.maximumAllowedEntry).toBeCloseTo(100.1);
  });

  it("rejects entry outside the allowed range (price drifted too far since the signal candle closed)", () => {
    const zone = computeEntryZone(100, 0.001);
    const now = 1_000_000;
    const reason = checkEntryProtection({
      referencePrice: 101, // +1%, well outside a 0.1% band
      marketDataTimestampMs: now,
      zone,
      createdAtMs: now,
      expiresAtMs: computeExpiry(now, 10),
      nowMs: now,
      maxMarketDataAgeMs: 60_000,
    });
    expect(reason).toBe("ENTRY_OUTSIDE_ALLOWED_RANGE");
  });

  it("accepts a reference price within the allowed range", () => {
    const zone = computeEntryZone(100, 0.001);
    const now = 1_000_000;
    const reason = checkEntryProtection({
      referencePrice: 100.05,
      marketDataTimestampMs: now,
      zone,
      createdAtMs: now,
      expiresAtMs: computeExpiry(now, 10),
      nowMs: now,
      maxMarketDataAgeMs: 60_000,
    });
    expect(reason).toBeNull();
  });

  it("rejects a candidate whose expiration has passed - an old price is never executable later", () => {
    const zone = computeEntryZone(100, 0.01);
    const createdAtMs = 0;
    const expiresAtMs = computeExpiry(createdAtMs, 10); // 10 minutes
    const reason = checkEntryProtection({
      referencePrice: 100,
      marketDataTimestampMs: 11 * 60_000,
      zone,
      createdAtMs,
      expiresAtMs,
      nowMs: 11 * 60_000, // 11 minutes later
      maxMarketDataAgeMs: 60_000,
    });
    expect(reason).toBe("CANDIDATE_EXPIRED");
  });

  it("rejects stale market data even if the price itself is within range", () => {
    const zone = computeEntryZone(100, 0.01);
    const now = 1_000_000;
    const reason = checkEntryProtection({
      referencePrice: 100,
      marketDataTimestampMs: now - 5 * 60_000, // 5 minutes old
      zone,
      createdAtMs: now,
      expiresAtMs: computeExpiry(now, 10),
      nowMs: now,
      maxMarketDataAgeMs: 60_000, // only 1 minute tolerated
    });
    expect(reason).toBe("STALE_MARKET_DATA");
  });
});
