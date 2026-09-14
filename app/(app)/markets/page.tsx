import { createClient } from "@/lib/supabase/server";
import { SetupScore } from "@/components/dashboard/setup-score";
import { EmptyState } from "@/components/dashboard/empty-state";
import { DataRow, Timestamp, TradingPair } from "@/components/dashboard/primitives";
import { MarketChart } from "@/components/charts/market-chart";
import { closedCandles } from "@/lib/analytics/chart-data";
import { LineChart } from "lucide-react";
import { STRATEGY_V1_PARAMS } from "@/lib/strategy/v1/config";

export default async function MarketsPage() {
  const supabase = await createClient();
  const markets = await Promise.all(
    STRATEGY_V1_PARAMS.symbols.map(async (symbol) => {
      const [{ data: candles }, { data: signal }] = await Promise.all([
        supabase.from("candles").select("open_time, open, high, low, close, volume, is_closed").eq("symbol", symbol).eq("timeframe", "15M").order("open_time", { ascending: false }).limit(300),
        supabase.from("signals").select("score, classification, regime, volatility_state, news_risk, candle_time").eq("symbol", symbol).order("candle_time", { ascending: false }).limit(1).maybeSingle(),
      ]);
      return {
        symbol,
        signal,
        candles: closedCandles((candles ?? []).map((candle) => ({ time: new Date(candle.open_time).getTime(), open: Number(candle.open), high: Number(candle.high), low: Number(candle.low), close: Number(candle.close), volume: Number(candle.volume), isClosed: candle.is_closed }))),
      };
    }),
  );

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold tracking-tight">Markets</h1>
      <div className="grid gap-5">
        {markets.map((market) => (
          <div key={market.symbol} className="rounded-lg border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <TradingPair symbol={market.symbol} className="text-base" />
                <div className="mt-0.5 font-mono text-xl font-semibold tabular-nums">
                  {market.candles.at(-1) ? "$" + market.candles.at(-1)!.close.toFixed(2) : "-"}
                </div>
              </div>
              {market.signal ? <SetupScore score={market.signal.score} classification={market.signal.classification} /> : null}
            </div>
            {market.candles.length ? (
              <>
                <div className="mt-3">
                  <MarketChart candles={market.candles} />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-6 sm:grid-cols-4">
                  <DataRow label="Regime" value={market.signal?.regime ?? "-"} />
                  <DataRow label="Volatility" value={market.signal?.volatility_state ?? "-"} />
                  <DataRow label="News" value={market.signal?.news_risk ?? "-"} />
                  <DataRow label="Updated" value={<Timestamp iso={market.signal?.candle_time} />} />
                </div>
              </>
            ) : (
              <div className="mt-3">
                <EmptyState icon={LineChart} title="No chart data yet" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
