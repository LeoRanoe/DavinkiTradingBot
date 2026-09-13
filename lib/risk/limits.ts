import type { AccountState, RejectionReason, RiskLimits } from "./types";

/**
 * Static account-level risk locks (spec #43):
 *   - max one open position
 *   - max two new trades per UTC day
 *   - after two losing trades in one UTC day, block new trades until the
 *     next UTC day
 * Callers must compute `tradesOpenedTodayUtc` / `losingTradesTodayUtc` using
 * UTC day boundaries - never local time.
 */
export function checkAccountLimits(account: AccountState, limits: RiskLimits): RejectionReason | null {
  if (account.openPositionsCount >= limits.maxOpenPositions) {
    return "OPEN_POSITION_LIMIT";
  }
  if (account.losingTradesTodayUtc >= limits.maxLosingTradesPerDay) {
    return "DAILY_LOSS_LOCK";
  }
  if (account.tradesOpenedTodayUtc >= limits.maxNewTradesPerDay) {
    return "DAILY_TRADE_LIMIT";
  }
  return null;
}
