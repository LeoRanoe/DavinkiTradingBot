import Link from "next/link";
import { ArrowUpRight, Newspaper } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/dashboard/empty-state";
import { SetupScore } from "@/components/dashboard/setup-score";
import { SystemStatusBadge } from "@/components/dashboard/system-status-badge";
import { Stat, TradingPair, Timestamp } from "@/components/dashboard/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { STRATEGY_V1_PARAMS } from "@/lib/strategy/v1/config";
import { calculatePerformance } from "@/lib/learning/analytics";
import { loadCurrentResearchWindow } from "@/lib/research/store";
import { effectiveExecutionPolicy } from "@/lib/research/policy";
import { formatResearchDay, researchWindowState } from "@/lib/research/window";
import { INITIAL_PAPER_EQUITY, riskSettingsFromRow } from "@/lib/settings/risk-settings";
import { scannerHealthLevel } from "@/lib/health/scanner";

const money = (value: number) => "$" + value.toFixed(2);

export default async function DashboardPage() {
  const supabase = await createClient();
  const [
    { data: settings },
    { data: latestSnapshot },
    { data: peakSnapshot },
    { data: openTrades },
    { data: pendingSignals },
    { data: recentSignals },
    { data: candles },
    { data: lastJob },
    { data: recentEvents },
    { data: latestNews },
    { data: closedTrades },
    { data: strategyVersion },
  ] = await Promise.all([
    supabase.from("system_settings").select("*").eq("id", true).single(),
    // Only the latest and peak equity are rendered here - the full history
    // (used for the equity curve) is loaded on /performance instead, so this
    // reads 2 rows rather than up to 500.
    supabase.from("portfolio_snapshots").select("equity, taken_at").eq("trading_mode", "PAPER").order("taken_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("portfolio_snapshots").select("equity").eq("trading_mode", "PAPER").order("equity", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("trades").select("id, symbol, trading_mode, entry_price, stop_price, target_price, opened_at, modeled_max_loss, risk_amount").eq("status", "OPEN").order("opened_at", { ascending: false }).limit(1),
    supabase.from("signals").select("id, symbol, score, classification, planned_entry, stop_price, target_price").eq("classification", "CANDIDATE").eq("approval_status", "PENDING").order("candle_time", { ascending: false }).limit(1),
    supabase.from("signals").select("id, symbol, candle_time, score, classification, regime, volatility_state, news_risk, approval_status, rejection_reason, reason").in("symbol", STRATEGY_V1_PARAMS.symbols as unknown as string[]).order("candle_time", { ascending: false }).limit(30),
    supabase.from("candles").select("symbol, close, open_time").eq("timeframe", "15M").in("symbol", STRATEGY_V1_PARAMS.symbols as unknown as string[]).order("open_time", { ascending: false }).limit(20),
    supabase.from("job_runs").select("status, started_at, completed_at, records_processed").eq("job_name", "scan").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("audit_events").select("id, action, created_at, metadata").order("created_at", { ascending: false }).limit(8),
    supabase.from("news_events").select("id, headline, news_risk, published_at").order("published_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("trades").select("id, symbol, strategy_version_id, opened_at, closed_at, pnl, fees, slippage, r_multiple").eq("status", "CLOSED").order("closed_at", { ascending: false }).limit(500),
    // Read, never assumed: the badge must show the real status, so a DRAFT
    // strategy in a research window is never displayed as PAPER_APPROVED.
    supabase.from("strategy_versions").select("version_label, status").eq("version_label", "v1").maybeSingle(),
  ]);

  // The research session, when one exists, is the authority on what this
  // experiment started from and what it is aiming at - so the dashboard can
  // never quietly rebase a run onto a different starting point.
  const researchWindow = await loadCurrentResearchWindow(supabase);
  // Server Component: evaluated once per request. The research window's
  // state is a function of real time, so this is read here rather than
  // memoized - a stale value would misreport whether AUTO is in force.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const windowState = researchWindowState(researchWindow, now);
  const researchActive = windowState === "ACTIVE";
  const parsedSettings = riskSettingsFromRow(settings);
  const effectivePolicy = effectiveExecutionPolicy({
    configuredPolicy: parsedSettings.executionPolicy,
    tradingMode: parsedSettings.tradingMode,
    researchWindow,
    now,
  });

  const startingEquity = researchWindow?.startingEquity ?? INITIAL_PAPER_EQUITY;
  const targetEquity = researchWindow?.targetEquity ?? 50;
  const equity = latestSnapshot?.equity ?? startingEquity;
  const peakEquity = Math.max(startingEquity, peakSnapshot?.equity ?? startingEquity);
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
  const health = scannerHealthLevel(
    lastJob ? { status: lastJob.status, startedAt: lastJob.started_at } : null,
    now,
  );
  const progress = Math.max(0, Math.min(100, (equity / targetEquity) * 100));

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{settings?.trading_mode ?? "OBSERVE"}</Badge>
          <Badge variant="outline">{effectivePolicy.policy === "AUTO" ? "AUTO" : "APPROVAL"}</Badge>
          <Badge variant="outline">{strategyVersion?.version_label ?? "V1"} {strategyVersion?.status ?? "DRAFT"}</Badge>
          {researchActive && researchWindow ? (
            <Badge variant="outline">Research · {formatResearchDay(researchWindow, now)}</Badge>
          ) : null}
          <SystemStatusBadge level={health} label={health === "HEALTHY" ? "Scanner online" : `Scanner ${health.toLowerCase()}`} />
        </div>
      </section>

      <section className="grid grid-cols-2 gap-x-6 gap-y-4 border-y py-4 sm:grid-cols-5">
        <Stat label="Paper equity" value={money(equity)} sublabel={"from " + money(startingEquity)} />
        <Stat label="Today" value={(todayPnl >= 0 ? "+" : "") + money(todayPnl)} tone={todayPnl > 0 ? "positive" : todayPnl < 0 ? "negative" : "neutral"} />
        <Stat label="Total P/L" value={(totalPnl >= 0 ? "+" : "") + money(totalPnl)} tone={totalPnl > 0 ? "positive" : totalPnl < 0 ? "negative" : "neutral"} />
        <Stat label="Drawdown" value={drawdown.toFixed(1) + "%"} tone={drawdown < 0 ? "negative" : "neutral"} sublabel={"peak " + money(peakEquity)} />
        <Stat label="Open risk" value={money(openRisk)} />
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-lg border p-4 xl:col-span-2">
          <h2 className="text-sm font-medium">Current position</h2>
          {openTrade ? (
            <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <TradingPair symbol={openTrade.symbol} className="text-lg" />
                <Badge variant="outline">LONG · OPEN</Badge>
              </div>
              <div className="grid grid-cols-3 gap-6 font-mono text-sm tabular-nums">
                <div><span className="text-muted-foreground text-xs">Entry</span><p>{openTrade.entry_price === null ? "-" : money(openTrade.entry_price)}</p></div>
                <div><span className="text-muted-foreground text-xs">Stop</span><p>{openTrade.stop_price === null ? "-" : money(openTrade.stop_price)}</p></div>
                <div><span className="text-muted-foreground text-xs">Target</span><p>{openTrade.target_price === null ? "-" : money(openTrade.target_price)}</p></div>
              </div>
              <Button size="sm" variant="outline" render={<Link href="/positions">View</Link>} />
            </div>
          ) : pendingCandidate ? (
            <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <TradingPair symbol={pendingCandidate.symbol} className="text-lg" />
                <SetupScore score={pendingCandidate.score} classification={pendingCandidate.classification} />
              </div>
              <div className="font-mono text-sm tabular-nums text-muted-foreground">
                {pendingCandidate.planned_entry === null ? "-" : money(pendingCandidate.planned_entry)} / {pendingCandidate.stop_price === null ? "-" : money(pendingCandidate.stop_price)} / {pendingCandidate.target_price === null ? "-" : money(pendingCandidate.target_price)}
              </div>
              <Button size="sm" variant="outline" render={<Link href={"/signals/" + pendingCandidate.id}>Review</Link>} />
            </div>
          ) : (
            <p className="text-muted-foreground mt-3 text-sm">Waiting for setup</p>
          )}
        </div>
        <div className="rounded-lg border p-4">
          <h2 className="text-sm font-medium">Research target</h2>
          <div className="mt-2 font-mono text-2xl font-semibold tabular-nums">{progress.toFixed(0)}%</div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-muted-foreground text-xs">Current</span><p className="font-mono tabular-nums">{money(equity)}</p></div>
            <div><span className="text-muted-foreground text-xs">Target</span><p className="font-mono tabular-nums">{money(targetEquity)}</p></div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-lg border p-4 xl:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Markets</h2>
            <Button size="sm" variant="ghost" render={<Link href="/markets">All markets <ArrowUpRight /></Link>} />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {latestBySymbol.map(({ symbol, signal, candle }) => (
              <div key={symbol} className="rounded-md border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <TradingPair symbol={symbol} />
                    <div className="mt-0.5 font-mono text-sm tabular-nums">{candle ? money(candle.close) : "-"}</div>
                  </div>
                  {signal ? <SetupScore score={signal.score} classification={signal.classification} /> : <span className="text-muted-foreground text-xs">Awaiting scan</span>}
                </div>
                {signal ? (
                  <div className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span>{signal.regime}</span>
                    <span>{signal.volatility_state ?? "-"} volatility</span>
                    <span>{signal.news_risk ?? "-"} news</span>
                    <Timestamp iso={signal.candle_time} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">News</h2>
            <Button size="sm" variant="ghost" render={<Link href="/news">All <ArrowUpRight /></Link>} />
          </div>
          {latestNews ? (
            <div className="mt-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{latestNews.news_risk}</Badge>
                <Timestamp iso={latestNews.published_at} />
              </div>
              <p className="mt-2 text-sm leading-5">{latestNews.headline}</p>
            </div>
          ) : (
            <EmptyState icon={Newspaper} title="No recent news" />
          )}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <div className="rounded-lg border p-4 xl:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Activity</h2>
            <Button size="sm" variant="ghost" render={<Link href="/system">System <ArrowUpRight /></Link>} />
          </div>
          {recentEvents?.length ? (
            <div className="mt-1">
              {recentEvents.map((event) => (
                <div key={event.id} className="flex items-center justify-between gap-3 border-b py-2.5 text-sm last:border-0">
                  <span className="capitalize">{event.action.replaceAll("_", " ").toLowerCase()}</span>
                  <Timestamp iso={event.created_at} />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground mt-3 text-sm">No activity yet</p>
          )}
        </div>
        <div className="rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Learning evidence</h2>
            <Badge variant="outline">{performance.evidenceLevel.replaceAll("_", " ")}</Badge>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-muted-foreground text-xs">Closed</span><p className="font-mono text-lg tabular-nums">{performance.sampleCount}</p></div>
            <div><span className="text-muted-foreground text-xs">Expectancy</span><p className="font-mono text-lg tabular-nums">{performance.expectancyR === null ? "-" : performance.expectancyR.toFixed(2) + "R"}</p></div>
          </div>
          <Button className="mt-2" size="sm" variant="ghost" render={<Link href="/learn">Open <ArrowUpRight /></Link>} />
        </div>
      </section>
    </div>
  );
}
