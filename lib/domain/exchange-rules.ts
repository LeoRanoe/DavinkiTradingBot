import type { Instrument } from "./instrument";

/**
 * Fail-closed guard for provider-dependent exchange rules (Checkpoint 2
 * review §3; final pre-apply guardrail patch §7). Any FUTURE generic
 * execution/sizing code that needs `priceIncrement`/`sizeIncrement`/
 * `minSize` must call this first and refuse to proceed on failure - never
 * default a missing OR malformed rule to 0/1.
 *
 * NOT used by Strategy V1's execution/risk path today: that path continues
 * to size orders exclusively off live `lib/bybit/client.ts
 * getInstrumentMetadata()` / the `instrument_metadata` table, never off
 * `Instrument`. This guard exists for the generic pipeline this checkpoint
 * is laying groundwork for, which does not execute anything yet.
 */
export type ExchangeRules = {
  priceIncrement: number;
  sizeIncrement: number;
  minSize: number;
};

export type ExchangeRulesCheck =
  | { available: true; rules: ExchangeRules }
  | { available: false; problems: string[] };

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/**
 * Present AND well-formed: a value that exists but is NaN, Infinity, zero,
 * or negative (where the field requires positive) is treated exactly like
 * a missing value - it is refused, never silently used.
 */
export function checkExchangeRulesAvailable(instrument: Instrument): ExchangeRulesCheck {
  const problems: string[] = [];

  if (instrument.priceIncrement === undefined) {
    problems.push("priceIncrement: missing");
  } else if (!isFinitePositive(instrument.priceIncrement)) {
    problems.push(`priceIncrement: must be a finite positive number (got ${instrument.priceIncrement})`);
  }

  if (instrument.sizeIncrement === undefined) {
    problems.push("sizeIncrement: missing");
  } else if (!isFinitePositive(instrument.sizeIncrement)) {
    problems.push(`sizeIncrement: must be a finite positive number (got ${instrument.sizeIncrement})`);
  }

  // minSize may legitimately be 0 (no exchange-imposed minimum) - only
  // negative/NaN/Infinity values are refused.
  if (instrument.minSize === undefined) {
    problems.push("minSize: missing");
  } else if (!isFiniteNonNegative(instrument.minSize)) {
    problems.push(`minSize: must be a finite, non-negative number (got ${instrument.minSize})`);
  }

  if (problems.length > 0) {
    return { available: false, problems };
  }

  return {
    available: true,
    rules: {
      priceIncrement: instrument.priceIncrement!,
      sizeIncrement: instrument.sizeIncrement!,
      minSize: instrument.minSize!,
    },
  };
}

/** Throws rather than returning a guessed value - the "fail closed" entrypoint. */
export function requireExchangeRules(instrument: Instrument): ExchangeRules {
  const check = checkExchangeRulesAvailable(instrument);
  if (!check.available) {
    throw new Error(
      `Exchange rules unavailable or invalid for ${instrument.id}: ${check.problems.join("; ")}. ` +
        `Refusing to guess - fetch valid live rules from the venue's market-data provider first.`,
    );
  }
  return check.rules;
}
