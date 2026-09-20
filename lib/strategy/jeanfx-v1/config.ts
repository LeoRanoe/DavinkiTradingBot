/**
 * JeanFX v1 - versioned strategy parameters.
 *
 * SOURCE: JeanFX_Final_Complete ("JeanFX Complete Trading System" /
 * "JEANFX: MASTERING GOLD - MASTER EDITION"). Every value below is tagged
 * SOURCE (stated by that document) or ASSUMPTION (chosen here because the
 * document does not specify a number). See JEANFX_IMPLEMENTATION_ASSUMPTIONS
 * at the bottom of this file for the machine-readable registry that the
 * frontend renders on the strategy detail page.
 *
 * Nothing here may be presented to a user as "a JeanFX rule" unless it is
 * tagged SOURCE. Assumptions belong to the VERSION: changing one ships a new
 * strategy_versions row, never a mutation of this one.
 */
export const JEANFX_V1_VERSION_LABEL = "jeanfx-v1";
export const JEANFX_V1_STATUS = "RESEARCH_ONLY" as const;

/**
 * SOURCE (Risk Management table): risk per trade 0.5-1%.
 * These bounds are enforced server-side; the browser is never trusted.
 */
export const JEANFX_RISK_PCT_MIN = 0.005;
export const JEANFX_RISK_PCT_MAX = 0.01;
export const JEANFX_RISK_PCT_DEFAULT = 0.01;

/** SOURCE (Risk Management table): "Max trades per session 3". */
export const JEANFX_MAX_TRADES_PER_SESSION = 3;

/** SOURCE (Risk Management table): "Risk Reward - Minimum 1:3". */
export const JEANFX_RR_MINIMUM = 3.0;

export const JEANFX_V1_PARAMS = {
  // SOURCE (Multi-Timeframe Trading Framework): "H1 or M30 identifies market
  // bias. M15 confirms structure shifts. M5 provides precise entries."
  // biasTimeframe is per-PROFILE (see JEANFX_GOLD_PROFILES); this is the default.
  biasTimeframe: "M30" as const,
  structureTimeframe: "M15" as const,
  entryTimeframe: "M5" as const,

  atrPeriod: 14, // ASSUMPTION

  swing: { leftBars: 2, rightBars: 2 }, // ASSUMPTION

  // ASSUMPTION: ATR-relative so tolerance scales across instruments.
  equalHighLowAtrMultiple: 0.1,

  // ASSUMPTION: the source says "price moves aggressively" / "strong impulse"
  // but gives no threshold.
  displacementAtrMultiple: 1.5,

  // ASSUMPTION: stop sits beyond the sweep extreme by this ATR buffer.
  stopBufferAtrMultiple: 0.1,

  // ASSUMPTION: the source describes hammer/shooting star qualitatively
  // ("long lower wick, small body at top") with no ratios.
  confirmation: {
    minWickBodyRatio: 2.0,
    maxOppositeWickRatio: 0.5,
  },

  // ASSUMPTION: bias is ambiguous when both sides' nearest liquidity is
  // within this ATR multiple of equidistant - resolve to NONE, never guess.
  biasAmbiguityAtrMultiple: 0.25,

  // ASSUMPTION: the source gives no staleness bound for a pending setup.
  mssTimeoutBars: 20,
  fvgTimeoutBars: 20,

  // SOURCE.
  rrMinimum: JEANFX_RR_MINIMUM,
  riskPct: JEANFX_RISK_PCT_DEFAULT,
  maxTradesPerSession: JEANFX_MAX_TRADES_PER_SESSION,

  /**
   * SOURCE AMBIGUITY (Risk Management table): "Break-even - After partial
   * profit". The source states that a partial is taken and that the stop
   * moves to break-even afterwards, but specifies NEITHER the fraction
   * closed NOR the trigger. The values below are therefore a conservative,
   * deterministic, VERSIONED implementation assumption - they are NOT a
   * JeanFX rule and must never be presented as one.
   *
   * Chosen conservatively: half off at the midpoint of the minimum 3R
   * requirement, which is reachable on any setup that qualified at all.
   */
  partialExit: { sizePct: 0.5, atRMultiple: 1.5, moveStopToBreakEven: true },

  sessionFilter: null as null | { sessions: TradingSessionWindow[] },
} as const;

export type TradingSessionWindow = {
  session: "ASIA" | "LONDON" | "NEW_YORK";
  timezone: string; // IANA tz name - DST-aware by construction
  startLocalHour: number;
  endLocalHour: number;
};

export type JeanfxV1Params = typeof JEANFX_V1_PARAMS;

/**
 * Gold profiles (PRIMARY INSTRUMENT: XAU/USD, asset class METAL).
 *
 * SOURCE: "H1 or M30 identifies market bias" - the source offers both, so
 * both ship as named profiles rather than one being silently preferred.
 * Structure (M15) and entry (M5) are fixed by the source for both.
 */
export type JeanfxProfileName = "JEANFX_GOLD_ACTIVE" | "JEANFX_GOLD_SELECTIVE";

export const JEANFX_GOLD_PROFILES: Record<JeanfxProfileName, { biasTimeframe: "M30" | "H1"; label: string; description: string }> = {
  JEANFX_GOLD_ACTIVE: {
    biasTimeframe: "M30",
    label: "JeanFX Gold Active",
    description: "M30 bias / M15 structure / M5 entry. More setups, lower selectivity.",
  },
  JEANFX_GOLD_SELECTIVE: {
    biasTimeframe: "H1",
    label: "JeanFX Gold Selective",
    description: "H1 bias / M15 structure / M5 entry. Fewer setups, higher selectivity.",
  },
};

/**
 * User-tunable configuration. Deliberately a SMALL surface: every
 * ASSUMPTION threshold above belongs to the immutable VERSION, not to a
 * user's StrategyConfiguration - exposing those would let a user quietly
 * overfit JeanFX into a different strategy while still calling it JeanFX.
 */
export type JeanfxSessionFilterChoice = "LONDON" | "NEW_YORK" | "LONDON_AND_NEW_YORK" | "ALL";
export type JeanfxConfirmationPatternsChoice = "ENGULFING" | "HAMMER_SHOOTING_STAR" | "BOTH";

export type JeanfxUserConfig = {
  profile: JeanfxProfileName;
  biasTimeframe: "H1" | "M30";
  riskPct: number;
  sessionFilter: JeanfxSessionFilterChoice;
  confirmationPatterns: JeanfxConfirmationPatternsChoice;
};

/**
 * SOURCE (Trading Sessions / London Killzone / New York Expansion): the
 * tradeable sequence is London sweeps Asian liquidity, then New York
 * expands. Gold therefore defaults to LONDON_AND_NEW_YORK, never ALL - the
 * Asian range is liquidity CONTEXT (it supplies session pools), not a
 * session JeanFX takes entries in.
 */
export const JEANFX_DEFAULT_USER_CONFIG: JeanfxUserConfig = {
  profile: "JEANFX_GOLD_ACTIVE",
  biasTimeframe: JEANFX_GOLD_PROFILES.JEANFX_GOLD_ACTIVE.biasTimeframe,
  riskPct: JEANFX_RISK_PCT_DEFAULT,
  sessionFilter: "LONDON_AND_NEW_YORK",
  confirmationPatterns: "BOTH",
};

export function validateJeanfxUserConfig(
  config: Partial<JeanfxUserConfig>,
): { ok: true; value: JeanfxUserConfig } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const merged: JeanfxUserConfig = { ...JEANFX_DEFAULT_USER_CONFIG, ...config };

  if (!(merged.profile in JEANFX_GOLD_PROFILES)) {
    errors.push(`profile must be one of ${Object.keys(JEANFX_GOLD_PROFILES).join(", ")}`);
  } else if (config.biasTimeframe === undefined) {
    // The profile is authoritative unless the caller explicitly overrode the
    // bias timeframe, so selecting a profile can never silently disagree with
    // the timeframe actually loaded.
    merged.biasTimeframe = JEANFX_GOLD_PROFILES[merged.profile].biasTimeframe;
  }

  if (merged.biasTimeframe !== "H1" && merged.biasTimeframe !== "M30") {
    errors.push("biasTimeframe must be 'H1' or 'M30'");
  }

  // SOURCE: 0.5%-1%. Enforced here, server-side - never in the browser alone.
  if (!Number.isFinite(merged.riskPct) || merged.riskPct < JEANFX_RISK_PCT_MIN || merged.riskPct > JEANFX_RISK_PCT_MAX) {
    errors.push(
      `riskPct must be between ${JEANFX_RISK_PCT_MIN} (0.5%) and ${JEANFX_RISK_PCT_MAX} (1%) - JeanFX source rule`,
    );
  }
  if (!["LONDON", "NEW_YORK", "LONDON_AND_NEW_YORK", "ALL"].includes(merged.sessionFilter)) {
    errors.push("sessionFilter must be one of LONDON, NEW_YORK, LONDON_AND_NEW_YORK, ALL");
  }
  if (!["ENGULFING", "HAMMER_SHOOTING_STAR", "BOTH"].includes(merged.confirmationPatterns)) {
    errors.push("confirmationPatterns must be one of ENGULFING, HAMMER_SHOOTING_STAR, BOTH");
  }

  return errors.length === 0 ? { ok: true, value: merged } : { ok: false, errors };
}

/** Resolves the bias timeframe a given configuration will ACTUALLY load data for. */
export function resolveBiasTimeframe(parameters: Record<string, unknown> | null | undefined): "H1" | "M30" {
  const result = validateJeanfxUserConfig((parameters as Partial<JeanfxUserConfig>) ?? {});
  return result.ok ? result.value.biasTimeframe : JEANFX_DEFAULT_USER_CONFIG.biasTimeframe;
}

/**
 * Machine-readable registry of every numeric choice JeanFX v1 makes that the
 * source does NOT specify. Rendered verbatim in the frontend so an operator
 * can always see which numbers are JeanFX's and which are ours.
 */
export type JeanfxAssumption = {
  key: string;
  value: string;
  origin: "SOURCE" | "IMPLEMENTATION_ASSUMPTION" | "SOURCE_AMBIGUITY";
  note: string;
};

export const JEANFX_IMPLEMENTATION_ASSUMPTIONS: JeanfxAssumption[] = [
  { key: "riskPct", value: "0.5% - 1.0%", origin: "SOURCE", note: "Risk Management table: 'Risk per trade 0.5-1%'." },
  { key: "rrMinimum", value: "3.0", origin: "SOURCE", note: "Risk Management table: 'Risk Reward Minimum 1:3'." },
  { key: "maxTradesPerSession", value: "3", origin: "SOURCE", note: "Risk Management table: 'Max trades per session 3'." },
  { key: "biasTimeframe", value: "M30 (Active) / H1 (Selective)", origin: "SOURCE", note: "'H1 or M30 identifies market bias'." },
  { key: "structureTimeframe", value: "M15", origin: "SOURCE", note: "'M15 confirms structure shifts'." },
  { key: "entryTimeframe", value: "M5", origin: "SOURCE", note: "'M5 provides precise entries with tight risk'." },
  { key: "htfBiasMethod", value: "nearest unswept liquidity pool = draw; true direction is away from it", origin: "SOURCE", note: "'Determine bias by observing where liquidity sits relative to price.' EMA50/EMA200 is NOT used - it appears nowhere in the source." },
  { key: "targetSelection", value: "next (nearest) unswept opposing liquidity pool", origin: "SOURCE", note: "'Targets are placed at the next liquidity pool.' A setup whose NEXT pool yields < 3R is rejected, never re-targeted further out." },
  { key: "sessionDefault", value: "LONDON_AND_NEW_YORK", origin: "SOURCE", note: "'London sweeps liquidity, New York expands.' Asian range is liquidity context only." },
  { key: "swing.leftBars / rightBars", value: "2 / 2", origin: "IMPLEMENTATION_ASSUMPTION", note: "Source names swing highs/lows but gives no fractal lookback." },
  { key: "equalHighLowAtrMultiple", value: "0.10 x ATR14", origin: "IMPLEMENTATION_ASSUMPTION", note: "Source says 'equal highs/lows' with no tolerance for 'equal'." },
  { key: "displacementAtrMultiple", value: "1.50 x ATR14", origin: "IMPLEMENTATION_ASSUMPTION", note: "Source says 'strong impulse' / 'moves aggressively' with no threshold." },
  { key: "stopBufferAtrMultiple", value: "0.10 x ATR14", origin: "IMPLEMENTATION_ASSUMPTION", note: "Source does not specify stop placement distance beyond the sweep extreme." },
  { key: "confirmation.minWickBodyRatio", value: "2.0", origin: "IMPLEMENTATION_ASSUMPTION", note: "Source: 'long lower wick, small body at top' - qualitative only." },
  { key: "confirmation.maxOppositeWickRatio", value: "0.5", origin: "IMPLEMENTATION_ASSUMPTION", note: "Source gives no opposite-wick bound." },
  { key: "biasAmbiguityAtrMultiple", value: "0.25 x ATR14", origin: "IMPLEMENTATION_ASSUMPTION", note: "Tie-break guard so an equidistant draw resolves to NONE instead of being decided by rounding." },
  { key: "mssTimeoutBars / fvgTimeoutBars", value: "20 / 20 M15 bars", origin: "IMPLEMENTATION_ASSUMPTION", note: "Source gives no staleness bound for a pending setup." },
  { key: "partialExit", value: "50% at +1.5R, then stop to break-even", origin: "SOURCE_AMBIGUITY", note: "Source states 'Break-even after partial profit' but specifies NEITHER the fraction NOR the trigger. This is our conservative versioned assumption, NOT a JeanFX rule." },
  { key: "sessionClockWindows", value: "London 08-17 Europe/London, New York 08-17 America/New_York, Asia 00-09 Asia/Tokyo", origin: "IMPLEMENTATION_ASSUMPTION", note: "Source names the sessions but gives no killzone clock hours. DST-aware via IANA timezones." },
  { key: "obviousSupportResistance", value: "not implemented as a distinct pool kind", origin: "SOURCE_AMBIGUITY", note: "Source lists 'obvious support/resistance' as liquidity but never defines it numerically; such levels surface as equal highs/lows or prior swings instead." },
];
