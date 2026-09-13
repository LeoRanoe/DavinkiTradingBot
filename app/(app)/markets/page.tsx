import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SetupScore } from "@/components/dashboard/setup-score";
import { EmptyState } from "@/components/dashboard/empty-state";
import { LineChart } from "lucide-react";
import { STRATEGY_V1_PARAMS } from "@/lib/strategy/v1/config";

export default async function MarketsPage() {
  const supabase = await createClient();

  const cards = await Promise.all(
    STRATEGY_V1_PARAMS.symbols.map(async (symbol) => {
      const { data: latestCandle } = await supabase
        .from("candles")
        .select("close, open_time")
        .eq("symbol", symbol)
        .eq("timeframe", "15M")
        .order("open_time", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: latestSignal } = await supabase
        .from("signals")
        .select("score, classification, regime, risk_reward, candle_time")
        .eq("symbol", symbol)
        .order("candle_time", { ascending: false })
        .limit(1)
        .maybeSingle();
      return { symbol, latestCandle, latestSignal };
    }),
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Markets</h1>
        <p className="text-muted-foreground text-sm">BTCUSDT and ETHUSDT - spot, long only.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {cards.map(({ symbol, latestCandle, latestSignal }) => (
          <Card key={symbol}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span>{symbol}</span>
                {latestCandle ? (
                  <span className="font-mono text-sm tabular-nums">${latestCandle.close.toFixed(2)}</span>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {latestSignal ? (
                <div className="space-y-2">
                  <SetupScore score={latestSignal.score} classification={latestSignal.classification} />
                  <p className="text-muted-foreground text-xs">
                    1H regime: {latestSignal.regime} · Last analyzed: {new Date(latestSignal.candle_time).toLocaleString()}
                  </p>
                  {latestSignal.risk_reward ? (
                    <p className="text-xs">R/R: {latestSignal.risk_reward.toFixed(1)}</p>
                  ) : null}
                </div>
              ) : (
                <EmptyState
                  icon={LineChart}
                  title="No analysis yet"
                  description="Waiting for the scanner to process a closed candle for this symbol."
                />
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
