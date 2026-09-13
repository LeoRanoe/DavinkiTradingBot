import Link from "next/link";
import { Activity, ArrowUpRight, CircleDot, FlaskConical, GraduationCap, Newspaper, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { MetricCard } from "@/components/dashboard/metric-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { SetupScore } from "@/components/dashboard/setup-score";
import { ModeBadge } from "@/components/dashboard/mode-badge";
import { SystemStatusBadge, type SystemHealthLevel } from "@/components/dashboard/system-status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { STRATEGY_V1_PARAMS } from "@/lib/strategy/v1/config";
import { calculatePerformance } from "@/lib/learning/analytics";

const money = (value: number) => "$" + value.toFixed(2);
const timeLabel = (iso: string | null) => iso ? new Date(iso).toLocaleString() : "Not recorded";

function scannerHealth(status: string | undefined): SystemHealthLevel {
  if (status === "SUCCEEDED" || status === "NOOP") return "HEALTHY";
  if (status === "FAILED") return "ERROR";
  return status ? "WARNING" : "UNKNOWN";
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const [{ data: settings }, { data: snapshots }, { data: openTrades }, { data: pendingSignals }, { data: recentSignals }, { data: candles }, { data: lastJob }, { data: recentEvents }, { data: latestNews }, { data: closedTrades }] = await Promise.all([
    supabase.from("system_settings").select("*").eq("id", true).single(),
    supabase.from("portfolio_snapshots").select("equity, taken_at").eq("trading_mode", "PAPER").order("taken_at", { ascending: true }).limit(500),
    supabase.from("trades").select("*").eq("status", "OPEN").order("opened_at", { ascending: false }).limit(1),
    supabase.from("signals").select("*").eq("classification", "CANDIDATE").eq("approval_status", "PENDING").order("candle_time", { ascending: false }).limit(1),
    supabase.from("signals").select("id, symbol, candle_time, score, classification, regime, volatility_state, news_risk, approval_status, rejection_reason, reason").in("symbol", STRATEGY_V1_PARAMS.symbols as unknown as string[]).order("candle_time", { ascending: false }).limit(30),
    supabase.from("candles").select("symbol, close, open_time").eq("timeframe", "15M").in("symbol", STRATEGY_V1_PARAMS.symbols as unknown as string[]).order("open_time", { ascending: false }).limit(20),
    supabase.from("job_runs").select("status, started_at, completed_at, records_processed").eq("job_name", "scan").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("audit_events").select("id, action, created_at, metadata").order("created_at", { ascending: false }).limit(8),
    supabase.from("news_events").select("id, headline, news_risk, published_at").order("published_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("trades").select("*").eq("status", "CLOSED").order("closed_at", { ascending: false }).limit(500),
  ]);

  const startingEquity = 10;
  const targetEquity = 50;
  const equity = snapshots?.at(-1)?.equity ?? startingEquity;
  const peakEquity = Math.max(startingEquity, ...(snapshots ?? []).map((snapshot) => snapshot.equity));
  const drawdown = peakEquity > 0 ? ((equity - peakEquity) / peakEquity) * 100 : 0;
  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
  const todayPnl = (closedTrades ?? []).filter((trade) => trade.closed_at && new Date(trade.closed_at) >= todayStart).reduce((total, trade) => total + (trade.pnl ?? 0), 0);
  const totalPnl = (closedTrades ?? []).reduce((total, trade) => total + (trade.pnl ?? 0), 0);
  const openRisk = (openTrades ?? []).reduce((total, trade) => total + (trade.modeled_max_loss ?? trade.risk_amount ?? 0), 0);
  const performance = calculatePerformance((closedTrades ?? []).map((trade) => ({ id: trade.id, actual: true, symbol: trade.symbol, strategyVersion: trade.strategy_version_id, openedAt: trade.opened_at ? new Date(trade.opened_at).getTime() : 0, closedAt: trade.closed_at ? new Date(trade.closed_at).getTime() : null, pnl: trade.pnl, fees: trade.fees, slippage: trade.slippage, rMultiple: trade.r_multiple })));
  const latestBySymbol = STRATEGY_V1_PARAMS.symbols.map((symbol) => ({
    symbol,
    signal: recentSignals?.find((signal) => signal.symbol === symbol),
    candle: candles?.find((candle) => candle.symbol === symbol),
  }));
  const openTrade = openTrades?.[0];
  const pendingCandidate = pendingSignals?.[0];
  const latestRejection = recentSignals?.find((signal) => signal.rejection_reason);
  const health = scannerHealth(lastJob?.status);
  const progress = Math.max(0, Math.min(100, (equity / targetEquity) * 100));

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div><h1 className="text-2xl font-semibold tracking-tight">Trading command center</h1><p className="mt-1 text-sm text-muted-foreground">Current operating state, real PAPER activity, and evidence-backed research.</p></div>
        <div className="flex flex-wrap items-center gap-2"><ModeBadge mode={settings?.trading_mode ?? "OBSERVE"} /><Badge variant="outline">{settings?.execution_policy ?? "APPROVAL_REQUIRED"}</Badge><Badge variant="outline">Strategy V1: DRAFT</Badge><SystemStatusBadge level={health} label={"Scanner: " + (lastJob?.status ?? "UNKNOWN")} /></div>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard label="Paper equity" value={money(equity)} sublabel={"Started at " + money(startingEquity)} />
        <MetricCard label="Today P/L" value={(todayPnl >= 0 ? "+" : "") + money(todayPnl)} tone={todayPnl > 0 ? "positive" : todayPnl < 0 ? "negative" : "neutral"} />
        <MetricCard label="Total realized P/L" value={(totalPnl >= 0 ? "+" : "") + money(totalPnl)} tone={totalPnl > 0 ? "positive" : totalPnl < 0 ? "negative" : "neutral"} />
        <MetricCard label="Current drawdown" value={drawdown.toFixed(1) + "%"} tone={drawdown < 0 ? "negative" : "neutral"} sublabel={"Peak " + money(peakEquity)} />
        <MetricCard label="Risk in open positions" value={money(openRisk)} sublabel={"Per-trade setting " + (settings?.risk_mode === "FIXED_AMOUNT" ? money(settings.fixed_risk_amount ?? 0) : ((settings?.max_risk_per_trade_pct ?? 0) * 100).toFixed(1) + "%")} />
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <Card className="border-border/80 xl:col-span-2">
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><CircleDot className="size-4 text-info" />Current action</CardTitle></CardHeader>
          <CardContent>
            {openTrade ? <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center"><div><div className="flex flex-wrap items-center gap-2"><span className="text-lg font-semibold">{openTrade.symbol}</span><Badge variant="outline">{openTrade.trading_mode} OPEN</Badge></div><p className="mt-1 text-sm text-muted-foreground">Managed on every scan. Stop and target remain the current exit boundaries.</p><div className="mt-4 grid grid-cols-3 gap-4 text-sm"><div><span className="text-muted-foreground">Entry</span><p className="font-mono tabular-nums">{openTrade.entry_price === null ? "-" : money(openTrade.entry_price)}</p></div><div><span className="text-muted-foreground">Stop</span><p className="font-mono tabular-nums">{openTrade.stop_price === null ? "-" : money(openTrade.stop_price)}</p></div><div><span className="text-muted-foreground">Target</span><p className="font-mono tabular-nums">{openTrade.target_price === null ? "-" : money(openTrade.target_price)}</p></div></div></div><Button variant="outline" render={<Link href="/positions">View position</Link>} /></div> : pendingCandidate ? <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center"><div><div className="flex flex-wrap items-center gap-2"><span className="text-lg font-semibold">{pendingCandidate.symbol} candidate</span><SetupScore score={pendingCandidate.score} classification={pendingCandidate.classification} /></div><p className="mt-1 text-sm text-muted-foreground">Awaiting an explicit owner decision. Approval will re-run all deterministic checks against fresh market data.</p><p className="mt-3 font-mono text-sm tabular-nums">Entry {pendingCandidate.planned_entry === null ? "-" : money(pendingCandidate.planned_entry)} / Stop {pendingCandidate.stop_price === null ? "-" : money(pendingCandidate.stop_price)} / Target {pendingCandidate.target_price === null ? "-" : money(pendingCandidate.target_price)}</p></div><Button variant="outline" render={<Link href={"/signals/" + pendingCandidate.id}>Review candidate</Link>} /></div> : <EmptyState icon={ShieldCheck} title="No actionable setup right now" description={latestRejection?.rejection_reason ? "Latest evaluated setup was blocked: " + latestRejection.rejection_reason.replaceAll("_", " ") + "." : "Strategy V1 is DRAFT. The scanner will continue recording deterministic results without opening a trade."} />}
          </CardContent>
        </Card>
        <Card className="border-border/80">
          <CardHeader className="pb-3"><CardTitle className="text-base">Growth experiment</CardTitle><CardDescription>Recorded PAPER equity toward a $50.00 research target. This is not a forecast.</CardDescription></CardHeader>
          <CardContent className="space-y-3"><div className="font-mono text-3xl font-semibold tabular-nums">{progress.toFixed(0)}%</div><div className="grid grid-cols-2 gap-3 text-sm"><div><span className="text-muted-foreground">Current</span><p className="font-mono tabular-nums">{money(equity)}</p></div><div><span className="text-muted-foreground">Remaining</span><p className="font-mono tabular-nums">{money(Math.max(0, targetEquity - equity))}</p></div></div><p className="text-xs text-muted-foreground">Risk settings are not changed by progress.</p></CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2"><CardHeader className="flex flex-row items-center justify-between pb-3"><CardTitle className="text-base">Market status</CardTitle><Button size="sm" variant="ghost" render={<Link href="/markets">Markets <ArrowUpRight /></Link>} /></CardHeader><CardContent className="grid gap-3 md:grid-cols-2">{latestBySymbol.map(({ symbol, signal, candle }) => <div key={symbol} className="rounded-lg border p-4"><div className="flex items-start justify-between gap-3"><div><div className="font-semibold">{symbol}</div><div className="mt-1 font-mono text-sm tabular-nums">{candle ? money(candle.close) : "No reference price"}</div></div>{signal ? <SetupScore score={signal.score} classification={signal.classification} /> : <Badge variant="outline">Awaiting scan</Badge>}</div>{signal ? <div className="mt-4 grid grid-cols-2 gap-3 text-xs"><div><span className="text-muted-foreground">Regime</span><p className="mt-1 truncate font-medium" title={signal.regime}>{signal.regime}</p></div><div><span className="text-muted-foreground">Volatility</span><p className="mt-1 font-medium">{signal.volatility_state ?? "UNKNOWN"}</p></div><div><span className="text-muted-foreground">News risk</span><p className="mt-1 font-medium">{signal.news_risk ?? "UNKNOWN"}</p></div><div><span className="text-muted-foreground">Updated</span><p className="mt-1 font-mono">{new Date(signal.candle_time).toLocaleTimeString()}</p></div></div> : <p className="mt-4 text-sm text-muted-foreground">No closed-candle analysis has been stored.</p>}</div>)}</CardContent></Card>
        <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Newspaper className="size-4 text-info" />News context</CardTitle></CardHeader><CardContent>{latestNews ? <div><Badge variant="outline">{latestNews.news_risk}</Badge><p className="mt-3 text-sm font-medium leading-5">{latestNews.headline}</p><p className="mt-2 text-xs text-muted-foreground">{timeLabel(latestNews.published_at)}. News remains context only.</p><Button className="mt-4" size="sm" variant="ghost" render={<Link href="/news">Open news <ArrowUpRight /></Link>} /></div> : <EmptyState icon={Newspaper} title="No news event stored" description="News ingestion is separate from trading and may be unavailable without affecting it." />}</CardContent></Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2"><CardHeader className="flex flex-row items-center justify-between pb-3"><div><CardTitle className="text-base">Recent bot activity</CardTitle><CardDescription>Persisted operational events, newest first.</CardDescription></div><Button size="sm" variant="ghost" render={<Link href="/system">System <ArrowUpRight /></Link>} /></CardHeader><CardContent>{recentEvents?.length ? <div className="space-y-0">{recentEvents.map((event) => <div key={event.id} className="grid grid-cols-[10px_1fr_auto] items-center gap-3 border-b border-border/70 py-3 last:border-0"><span className="size-1.5 rounded-full bg-muted-foreground" aria-hidden /><div className="text-sm font-medium">{event.action.replaceAll("_", " ")}</div><div className="font-mono text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()}</div></div>)}</div> : <EmptyState icon={Activity} title="No activity has been recorded yet" description="Scans, decisions, trade events, and system changes will appear here once they occur." />}</CardContent></Card>
        <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><GraduationCap className="size-4 text-info" />Learning evidence</CardTitle></CardHeader><CardContent className="space-y-3"><Badge variant="outline">{performance.evidenceLevel}</Badge><div className="grid grid-cols-2 gap-3 text-sm"><div><span className="text-muted-foreground">Closed outcomes</span><p className="font-mono text-lg tabular-nums">{performance.sampleCount}</p></div><div><span className="text-muted-foreground">Expectancy</span><p className="font-mono text-lg tabular-nums">{performance.expectancyR === null ? "-" : performance.expectancyR.toFixed(2) + "R"}</p></div></div><p className="text-xs text-muted-foreground">{performance.sampleCount < 20 ? "Evidence is insufficient for profitability claims below 20 completed outcomes." : "Initial evidence threshold reached. Research still requires validation and holdout review."}</p><Button size="sm" variant="ghost" render={<Link href="/learn">Open learning <ArrowUpRight /></Link>} /></CardContent></Card>
      </section>

      <section className="rounded-lg border bg-muted/20 p-4 sm:flex sm:items-center sm:justify-between"><div><div className="flex items-center gap-2 font-medium"><FlaskConical className="size-4 text-warning" />Strategy V1 remains DRAFT</div><p className="mt-1 text-sm text-muted-foreground">Research evidence is not sufficient for PAPER approval. No activation control is available here.</p></div><Button className="mt-3 sm:mt-0" variant="outline" render={<Link href="/strategies">Review strategy readiness</Link>} /></section>
    </div>
  );
}
