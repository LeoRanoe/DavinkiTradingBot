import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SetupScore } from "@/components/dashboard/setup-score";
import { EmptyState } from "@/components/dashboard/empty-state";
import { MarketChart } from "@/components/charts/market-chart";
import { closedCandles } from "@/lib/analytics/chart-data";
import { LineChart } from "lucide-react";
import { STRATEGY_V1_PARAMS } from "@/lib/strategy/v1/config";

export default async function MarketsPage() {
  const supabase = await createClient();
  const markets = await Promise.all(STRATEGY_V1_PARAMS.symbols.map(async (symbol) => {
    const [{ data: candles }, { data: signal }] = await Promise.all([
      supabase.from("candles").select("open_time, open, high, low, close, volume, is_closed").eq("symbol", symbol).eq("timeframe", "15M").order("open_time", { ascending: false }).limit(300),
      supabase.from("signals").select("score, classification, regime, volatility_state, news_risk, candle_time, indicator_snapshot").eq("symbol", symbol).order("candle_time", { ascending: false }).limit(1).maybeSingle(),
    ]);
    return { symbol, signal, candles: closedCandles((candles ?? []).map((candle) => ({ time: new Date(candle.open_time).getTime(), open: Number(candle.open), high: Number(candle.high), low: Number(candle.low), close: Number(candle.close), volume: Number(candle.volume), isClosed: candle.is_closed }))) };
  }));
  return <div className="space-y-5"><div><h1 className="text-xl font-semibold tracking-tight">Markets</h1><p className="mt-1 text-sm text-muted-foreground">Closed 15-minute spot candles only. Price and volume are persisted scanner data.</p></div><div className="grid gap-5">{markets.map((market) => <Card key={market.symbol}><CardHeader className="flex flex-row items-start justify-between"><div><CardTitle className="text-base">{market.symbol}</CardTitle><p className="mt-1 font-mono text-sm tabular-nums">{market.candles.at(-1) ? "$" + market.candles.at(-1)!.close.toFixed(2) : "No price recorded"}</p></div>{market.signal ? <SetupScore score={market.signal.score} classification={market.signal.classification} /> : null}</CardHeader><CardContent>{market.candles.length ? <><MarketChart candles={market.candles} /><div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4"><div><span className="text-muted-foreground">1H regime</span><p className="mt-1 truncate font-medium">{market.signal?.regime ?? "Not analyzed"}</p></div><div><span className="text-muted-foreground">Volatility</span><p className="mt-1 font-medium">{market.signal?.volatility_state ?? "UNKNOWN"}</p></div><div><span className="text-muted-foreground">News risk</span><p className="mt-1 font-medium">{market.signal?.news_risk ?? "UNKNOWN"}</p></div><div><span className="text-muted-foreground">Last closed candle</span><p className="mt-1 font-mono">{market.candles.at(-1) ? new Date(market.candles.at(-1)!.time).toLocaleString() : "-"}</p></div></div></> : <EmptyState icon={LineChart} title="No persisted market history" description="The chart will appear after the scanner has stored closed candles for this market." />}</CardContent></Card>)}</div></div>;
}
