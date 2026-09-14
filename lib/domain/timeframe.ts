/**
 * Canonical, venue-independent timeframes. See CLAUDE.md / TASKS.md
 * "Multi-market architecture" — Checkpoint 1.
 *
 * Venue adapters translate a CanonicalTimeframe to their own representation
 * (Bybit kline "interval" strings today; a future broker's own convention
 * later). Strategy code must only ever see CanonicalTimeframe.
 *
 * IMPORTANT: this list intentionally does not restrict Strategy V1, which
 * continues to hard-code "1H"/"15M" directly against lib/bybit/types.ts for
 * production-safety reasons (see docs/BUILD_STATE.md and the parity gate in
 * lib/domain/__tests__/bybit-adapter-parity.test.ts). New strategies should
 * declare their required timeframes from this set.
 */
export const CANONICAL_TIMEFRAMES = ["1M", "5M", "15M", "30M", "1H", "4H", "1D", "1W"] as const;

export type CanonicalTimeframe = (typeof CANONICAL_TIMEFRAMES)[number];

export function isCanonicalTimeframe(value: string): value is CanonicalTimeframe {
  return (CANONICAL_TIMEFRAMES as readonly string[]).includes(value);
}
