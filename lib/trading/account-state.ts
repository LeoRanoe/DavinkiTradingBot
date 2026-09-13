import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { AccountState } from "@/lib/risk/types";
import type { TradingMode } from "@/lib/types/trading-mode";

function utcDayBounds(now = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Computes the current account state for the risk engine directly from the
 * database - equity from the latest portfolio snapshot (falling back to the
 * configured initial equity), open positions, and today's (UTC) trade/loss
 * counts. Always derived fresh; never cached, so retries/duplicates can't
 * see stale limits.
 */
export async function computeAccountState(
  admin: SupabaseClient<Database>,
  tradingMode: TradingMode,
  initialEquity: number,
): Promise<AccountState> {
  const { start, end } = utcDayBounds();

  const [{ data: snapshot }, { count: openCount }, { data: todaysTrades }] = await Promise.all([
    admin
      .from("portfolio_snapshots")
      .select("equity")
      .eq("trading_mode", tradingMode)
      .order("taken_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("trades")
      .select("id", { count: "exact", head: true })
      .eq("trading_mode", tradingMode)
      .eq("status", "OPEN"),
    admin
      .from("trades")
      .select("status, pnl, opened_at")
      .eq("trading_mode", tradingMode)
      .gte("opened_at", start)
      .lt("opened_at", end),
  ]);

  const equity = snapshot?.equity ?? initialEquity;
  const tradesOpenedTodayUtc = todaysTrades?.length ?? 0;
  const losingTradesTodayUtc = (todaysTrades ?? []).filter(
    (t) => t.status === "CLOSED" && (t.pnl ?? 0) <= 0,
  ).length;

  return {
    equity,
    openPositionsCount: openCount ?? 0,
    tradesOpenedTodayUtc,
    losingTradesTodayUtc,
  };
}
