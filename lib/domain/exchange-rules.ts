import type { Instrument } from "./instrument";

/**
 * Fail-closed guard for provider-dependent exchange rules (Checkpoint 2
 * review §3). Any FUTURE generic execution/sizing code that needs
 * `priceIncrement`/`sizeIncrement`/`minSize` must call this first and
 * refuse to proceed on failure - never default a missing rule to 0/1.
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
  | { available: false; missing: string[] };

export function checkExchangeRulesAvailable(instrument: Instrument): ExchangeRulesCheck {
  const missing: string[] = [];
  if (instrument.priceIncrement === undefined) missing.push("priceIncrement");
  if (instrument.sizeIncrement === undefined) missing.push("sizeIncrement");
  if (instrument.minSize === undefined) missing.push("minSize");

  if (missing.length > 0) {
    return { available: false, missing };
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
      `Exchange rules unavailable for ${instrument.id}: missing ${check.missing.join(", ")}. ` +
        `Refusing to guess - fetch live rules from the venue's market-data provider first.`,
    );
  }
  return check.rules;
}
