/**
 * JeanFX v1 - versioned strategy parameters.
 *
 * Spec-only checkpoint: see docs/strategies/jeanfx-v1-spec.md for the source
 * of every value below. Values marked "assumption" in that document's
 * threshold table are proposed defaults pending review, not values taken
 * from a JeanFX source document. Values marked "sourced" come directly from
 * the task brief (1:3 minimum R:R, 1% normalized risk lock, 3 trades/session).
 *
 * Like STRATEGY_V1_PARAMS, these are versioned: a parameter change ships as
 * a NEW strategy_versions row, never a mutation of this one.
 */
export const JEANFX_V1_VERSION_LABEL = "jeanfx-v1";
export const JEANFX_V1_STATUS = "RESEARCH_ONLY" as const;

export const JEANFX_V1_PARAMS = {
  biasTimeframe: "H1" as const, // spec S3: brief allows H1 or M30; H1 defaulted
  structureTimeframe: "M15" as const,
  entryTimeframe: "M5" as const,

  atrPeriod: 14,

  swing: { leftBars: 2, rightBars: 2 },

  // ATR-relative so tolerance scales across instruments (spec S5.2).
  equalHighLowAtrMultiple: 0.1,

  // Displacement leg must be this many ATRs to count as impulsive (spec S5.7).
  displacementAtrMultiple: 1.5,

  // Stop = sweep extreme +/- this many ATRs (spec S11).
  stopBufferAtrMultiple: 0.1,

  // Candle confirmation thresholds (spec S7).
  confirmation: {
    minWickBodyRatio: 2.0,
    maxOppositeWickRatio: 0.5,
  },

  // Sourced directly from the brief, not an assumption.
  rrMinimum: 3.0,
  riskPct: 0.01,
  maxTradesPerSession: 3,

  // Optional; null disables session gating (crypto default, spec S9/S18).
  sessionFilter: null as null | {
    sessions: TradingSessionWindow[];
  },
} as const;

export type TradingSessionWindow = {
  session: "ASIA" | "LONDON" | "NEW_YORK";
  timezone: string; // IANA tz name, e.g. "Europe/London" - DST-aware (spec S9)
  startLocalHour: number;
  endLocalHour: number;
};

// Proposed session windows (spec S9) - not wired into JEANFX_V1_PARAMS.sessionFilter
// by default; kept here for when session gating is explicitly enabled and tested.
export const JEANFX_V1_PROPOSED_SESSIONS: TradingSessionWindow[] = [
  { session: "ASIA", timezone: "Asia/Tokyo", startLocalHour: 0, endLocalHour: 9 },
  { session: "LONDON", timezone: "Europe/London", startLocalHour: 8, endLocalHour: 17 },
  { session: "NEW_YORK", timezone: "America/New_York", startLocalHour: 8, endLocalHour: 17 },
];

export type JeanfxV1Params = typeof JEANFX_V1_PARAMS;
