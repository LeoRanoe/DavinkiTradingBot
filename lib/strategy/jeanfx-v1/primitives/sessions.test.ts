import { describe, expect, it } from "vitest";
import { classifySession, JEANFX_DEFAULT_SESSION_WINDOWS } from "./sessions";

describe("session classification (DST-aware via IANA timezone, not fixed UTC offsets)", () => {
  it("classifies a UTC instant known to be within London hours in winter (GMT, UTC+0)", () => {
    // 2026-01-15 09:00 UTC = 09:00 London time in winter (GMT).
    const ms = Date.UTC(2026, 0, 15, 9, 0);
    expect(classifySession(ms, JEANFX_DEFAULT_SESSION_WINDOWS)).toContain("LONDON");
  });

  it("adjusts automatically across a DST boundary without hardcoded UTC hours", () => {
    // 2026-07-15 09:00 UTC = 10:00 London time in summer (BST, UTC+1) - still inside 08:00-17:00 local.
    const summerMs = Date.UTC(2026, 6, 15, 9, 0);
    expect(classifySession(summerMs, JEANFX_DEFAULT_SESSION_WINDOWS)).toContain("LONDON");

    // 2026-07-15 07:30 UTC = 08:30 London time in summer - inside the window,
    // whereas the same UTC hour in winter (07:30 UTC = 07:30 London) would be outside it.
    // This proves the classification follows local time, not a fixed UTC offset.
    const earlyMs = Date.UTC(2026, 6, 15, 7, 30);
    expect(classifySession(earlyMs, JEANFX_DEFAULT_SESSION_WINDOWS)).toContain("LONDON");
    const earlyWinterMs = Date.UTC(2026, 0, 15, 7, 30);
    expect(classifySession(earlyWinterMs, JEANFX_DEFAULT_SESSION_WINDOWS)).not.toContain("LONDON");
  });

  it("London and New York overlap for part of the day", () => {
    // 2026-01-15 15:00 UTC = 15:00 London / 10:00 New York (winter, both UTC-5/UTC+0) - inside both windows.
    const ms = Date.UTC(2026, 0, 15, 15, 0);
    const sessions = classifySession(ms, JEANFX_DEFAULT_SESSION_WINDOWS);
    expect(sessions).toEqual(expect.arrayContaining(["LONDON", "NEW_YORK"]));
  });

  it("returns an empty array outside every configured window", () => {
    // 03:00 UTC winter = 12:00 Tokyo (outside ASIA [0,9)), 03:00 London
    // (outside [8,17)), 22:00 prior-day New York (outside [8,17)).
    const ms = Date.UTC(2026, 0, 15, 3, 0);
    const sessions = classifySession(ms, JEANFX_DEFAULT_SESSION_WINDOWS);
    expect(sessions).toEqual([]);
  });
});
