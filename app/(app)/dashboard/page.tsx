import { createClient } from "@/lib/supabase/server";
import { MetricCard } from "@/components/dashboard/metric-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { SetupScore } from "@/components/dashboard/setup-score";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Radar, Activity, GraduationCap } from "lucide-react";
import { STRATEGY_V1_PARAMS } from "@/lib/strategy/v1/config";

export default async function DashboardPage() {
  const supabase = await createClient();

  const [{ data: settings }, { data: snapshot }, { data: openTrades }, { data: recentSignals }, { data: recentEvents }] =
    await Promise.all([
      supabase.from("system_settings").select("*").eq("id", true).single(),
      supabase
        .from("portfolio_snapshots")
        .select("equity, balance")
        .eq("trading_mode", "PAPER")
        .order("taken_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("trades").select("*").eq("status", "OPEN"),
      supabase
        .from("signals")
        .select("*")
        .in("symbol", STRATEGY_V1_PARAMS.symbols as unknown as string[])
        .order("candle_time", { ascending: false })
        .limit(5),
      supabase.from("audit_events").select("*").order("created_at", { ascending: false }).limit(8),
    ]);

  const equity = snapshot?.equity ?? 10; // initial PAPER equity
  const { data: closedTradesToday } = await supabase
    .from("trades")
    .select("pnl, status")
    .eq("status", "CLOSED")
    .gte("closed_at", new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString());
  const dailyPnl = (closedTradesToday ?? []).reduce((s, t) => s + (t.pnl ?? 0), 0);

  const { data: allClosed } = await supabase.from("trades").select("pnl").eq("status", "CLOSED");
  const totalPnl = (allClosed ?? []).reduce((s, t) => s + (t.pnl ?? 0), 0);

  const openRisk = (openTrades ?? []).reduce((s, t) => s + (t.risk_amount ?? 0), 0);

  const latestCandidate = recentSignals?.find((s) => s.classification === "CANDIDATE");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <MetricCard label="Paper Equity" value={`$${equity.toFixed(2)}`} sublabel="Initial: $10.00" />
        <MetricCard
          label="Daily P/L"
          value={`${dailyPnl >= 0 ? "+" : ""}$${dailyPnl.toFixed(2)}`}
          tone={dailyPnl > 0 ? "positive" : dailyPnl < 0 ? "negative" : "neutral"}
        />
        <MetricCard
          label="Total P/L"
          value={`${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(2)}`}
          tone={totalPnl > 0 ? "positive" : totalPnl < 0 ? "negative" : "neutral"}
        />
        <MetricCard label="Risk Used" value={`$${openRisk.toFixed(2)}`} sublabel={`Max/trade: ${((settings?.max_risk_per_trade_pct ?? 0.01) * 100).toFixed(0)}%`} />
        <MetricCard label="Open Positions" value={`${openTrades?.length ?? 0}`} sublabel={`Max: ${settings?.max_open_positions ?? 1}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Recent candidate</CardTitle>
          </CardHeader>
          <CardContent>
            {latestCandidate ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{latestCandidate.symbol}</div>
                  <SetupScore score={latestCandidate.score} classification={latestCandidate.classification} />
                </div>
                <p className="text-muted-foreground text-sm">{latestCandidate.reason}</p>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <div className="text-muted-foreground text-xs">Entry</div>
                    <div className="font-mono tabular-nums">{latestCandidate.entry_price?.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">Stop</div>
                    <div className="font-mono tabular-nums">{latestCandidate.stop_price?.toFixed(2)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">R/R</div>
                    <div className="font-mono tabular-nums">{latestCandidate.risk_reward?.toFixed(1)}</div>
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={Radar}
                title="No candidate setups yet"
                description="The scanner runs on a schedule and will record qualifying closed candles. Candidates appear here once Strategy V1 finds one."
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Today&apos;s lesson</CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={GraduationCap}
              title="No lesson yet"
              description="Lessons are generated from real signals and trades as the system observes them."
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          {recentEvents && recentEvents.length > 0 ? (
            <ul className="divide-border divide-y text-sm">
              {recentEvents.map((e) => (
                <li key={e.id} className="flex items-center justify-between py-2">
                  <span>{e.action.replace(/_/g, " ")}</span>
                  <span className="text-muted-foreground font-mono text-xs">
                    {new Date(e.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Activity}
              title="No activity yet"
              description="System events (mode changes, approvals, trades) will appear here."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
