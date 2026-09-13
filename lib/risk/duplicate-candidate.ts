/**
 * A candidate is uniquely identified by the same key the `signals` table
 * enforces at the database level (unique on strategy_version_id, symbol,
 * timeframe, candle_time - see supabase/migrations). This helper exists so
 * the deterministic candidate pipeline can reject a duplicate in-process
 * (double scan, retried cron tick) using the exact same key, without a
 * round trip to the database.
 */
export function candidateKey(input: {
  strategyVersionId: string;
  symbol: string;
  timeframe: string;
  candleTimeMs: number;
}): string {
  return `${input.strategyVersionId}:${input.symbol}:${input.timeframe}:${input.candleTimeMs}`;
}

export function isDuplicateCandidate(
  key: string,
  existingActiveCandidateKeys: ReadonlySet<string> | readonly string[],
): boolean {
  const set = existingActiveCandidateKeys instanceof Set ? existingActiveCandidateKeys : new Set(existingActiveCandidateKeys);
  return set.has(key);
}
