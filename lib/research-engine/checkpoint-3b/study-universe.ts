import { CRYPTO_SPOT_INSTRUMENTS } from "@/lib/domain/instruments/crypto";
import type { Instrument } from "@/lib/domain/instrument";
import { TRB_STRATEGY } from "../strategies/trb";

/**
 * Checkpoint 3B.0 §1/§3: the frozen study universe and frozen parameter
 * sets, locked BEFORE any real-data run. Both are re-derived from the
 * existing preregistered sources (lib/domain/instruments/crypto.ts,
 * lib/research-engine/strategies/trb.ts) rather than re-declared here, so
 * there is exactly one place either could ever change - and a module-load
 * assertion below fails loudly if either source ever drifts from what
 * this checkpoint locked.
 */
export const STUDY_VENUE_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT"] as const;

export const STUDY_INSTRUMENTS: readonly Instrument[] = STUDY_VENUE_SYMBOLS.map((symbol) => {
  const instrument = CRYPTO_SPOT_INSTRUMENTS.find((i) => i.venueSymbol === symbol);
  if (!instrument) {
    throw new Error(
      `Checkpoint 3B.0 study-universe: expected instrument "${symbol}" to exist in CRYPTO_SPOT_INSTRUMENTS, but it does not. ` +
        "The five-instrument study universe is locked and must not silently change shape.",
    );
  }
  return instrument;
});

if (STUDY_INSTRUMENTS.length !== 5) {
  throw new Error(`Checkpoint 3B.0 study-universe: expected exactly 5 study instruments, got ${STUDY_INSTRUMENTS.length}.`);
}
if (STUDY_INSTRUMENTS.some((i) => i.assetClass !== "CRYPTO_SPOT" || i.venue !== "BYBIT")) {
  throw new Error("Checkpoint 3B.0 study-universe: every study instrument must be CRYPTO_SPOT on BYBIT.");
}

export const STUDY_TIMEFRAMES = ["1H", "4H"] as const;

/** The exactly-six frozen TRB parameter sets (Checkpoint 3A §4 / 3A.1 §11) - re-exported, never redefined, for convenience at this checkpoint's call sites. */
export const STUDY_PARAMETER_SETS = TRB_STRATEGY.parameterSets;

if (STUDY_PARAMETER_SETS.length !== 6) {
  throw new Error(`Checkpoint 3B.0 study-universe: expected exactly 6 frozen TRB parameter sets, got ${STUDY_PARAMETER_SETS.length}.`);
}

/** 5 instruments x 6 parameter sets = 30 strategy x instrument configurations (§10/§16). */
export const EXPECTED_CONFIGURATION_COUNT = STUDY_INSTRUMENTS.length * STUDY_PARAMETER_SETS.length;
