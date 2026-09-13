import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/auth/authorization";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { CandidateRisk, IndicatorSnapshot } from "@/lib/candidates/types";
import type { CandidateNewsContext } from "@/lib/news/types";

export const dynamic = "force-dynamic";

function money(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return "-";
  return `$${Number(value).toFixed(digits)}`;
}

function num(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return "-";
  return Number(value).toFixed(digits);
}

/**
 * Reading the clock is part of loading this page's data, not part of
 * rendering it. Keeping it out of the render path is also what the React
 * Compiler's purity rule requires.
 */
async function currentTimeMs(): Promise<number> {
  return Date.now();
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="font-mono text-sm tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Candidate detail - the target of the Telegram "VIEW" button.
 *
 * Authentication is required (the Telegram link is public, the page is not).
 * Guests may read; only the owner ever sees decision controls, and the API
 * routes plus RLS refuse their writes regardless of what this page renders.
 */
export default async function SignalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/signals/${id}`);

  const [{ data: signal }, { data: components }] = await Promise.all([
    supabase.from("signals").select("*").eq("id", id).maybeSingle(),
    supabase.from("signal_components").select("*").eq("signal_id", id),
  ]);

  if (!signal) notFound();

  const { data: trade } = await supabase
    .from("trades")
    .select("*")
    .eq("signal_id", id)
    .maybeSingle();

  const risk = (signal.risk_snapshot ?? null) as CandidateRisk | null;
  const news = (signal.news_snapshot ?? null) as CandidateNewsContext | null;
  const indicators = (signal.indicator_snapshot ?? null) as IndicatorSnapshot | null;

  const nowMs = await currentTimeMs();
  const expiresAt = signal.expires_at ? new Date(signal.expires_at) : null;
  const isExpiredNow = expiresAt !== null && expiresAt.getTime() < nowMs;
  const statusLabel =
    signal.approval_status === "REJECTED" && signal.owner_decision === "REJECTED"
      ? "REJECTED_BY_OWNER"
      : signal.approval_status === "PENDING" && isExpiredNow
        ? "EXPIRED"
        : signal.approval_status;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">
            {signal.symbol} <span className="text-muted-foreground">- {signal.classification}</span>
          </h1>
          <p className="text-muted-foreground text-sm">
            Candle {new Date(signal.candle_time).toISOString()} - {signal.timeframe}
          </p>
        </div>
        <Badge variant={statusLabel === "APPROVED" ? "default" : "secondary"}>{statusLabel}</Badge>
      </div>

      {signal.rejection_reason ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Not traded: {signal.rejection_reason}</CardTitle>
            <CardDescription>{signal.rejection_detail ?? ""}</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Setup</CardTitle>
            <CardDescription>Strategy {signal.regime}</CardDescription>
          </CardHeader>
          <CardContent>
            <Row label="Score" value={`${signal.score} / 100`} />
            <Row label="Classification" value={signal.classification} />
            <Row label="Regime" value={signal.regime} />
            <Row label="Volatility" value={signal.volatility_state ?? "-"} />
            <Separator className="my-2" />
            {(components ?? []).map((c) => (
              <Row
                key={c.id}
                label={c.component_name}
                value={`${num(c.points_earned, 1)} / ${num(c.points_possible, 0)}`}
              />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Trade plan</CardTitle>
            <CardDescription>Entry is only valid inside the allowed range.</CardDescription>
          </CardHeader>
          <CardContent>
            <Row label="Planned entry" value={money(signal.planned_entry, 4)} />
            <Row
              label="Allowed entry"
              value={`${money(signal.minimum_allowed_entry, 4)} - ${money(signal.maximum_allowed_entry, 4)}`}
            />
            <Row label="Reference price" value={money(signal.reference_price, 4)} />
            <Row label="Stop" value={money(signal.stop_price, 4)} />
            <Row
              label="Stop distance"
              value={signal.stop_pct !== null ? `${(Number(signal.stop_pct) * 100).toFixed(2)}%` : "-"}
            />
            <Row label="Target" value={money(signal.target_price, 4)} />
            <Row label="R/R" value={num(signal.risk_reward)} />
            <Row label="Expires" value={expiresAt ? expiresAt.toISOString() : "-"} />
          </CardContent>
        </Card>
      </div>

      {risk ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Risk</CardTitle>
            <CardDescription>
              Risk is the intended loss if the stop is hit - position size is derived from it.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-x-8 sm:grid-cols-2">
            <div>
              <Row label="Equity" value={money(risk.equity)} />
              <Row label="Available balance" value={money(risk.availableBalance)} />
              <Row label="Risk mode" value={risk.riskMode} />
              <Row label="Risk budget" value={money(risk.riskBudget, 4)} />
              <Row label="Estimated actual risk" value={money(risk.estimatedActualRisk, 4)} />
            </div>
            <div>
              <Row label="Position size" value={money(risk.positionNotional)} />
              <Row label="Quantity" value={String(risk.roundedQuantity)} />
              <Row label="Entry fee" value={money(risk.expectedEntryFee, 4)} />
              <Row label="Exit fee" value={money(risk.expectedExitFee, 4)} />
              <Row label="Slippage" value={money(risk.expectedSlippage, 4)} />
              <Row label="Modeled max loss" value={money(risk.modeledMaxLoss, 4)} />
              <Row label="Target profit" value={money(risk.estimatedTargetProfit, 4)} />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {indicators ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Indicators at the closed candle</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-x-8 sm:grid-cols-2">
            <div>
              <Row label="EMA20" value={num(indicators.ema20, 4)} />
              <Row label="EMA50" value={num(indicators.ema50, 4)} />
              <Row label="EMA200" value={num(indicators.ema200, 4)} />
            </div>
            <div>
              <Row label="RSI14" value={num(indicators.rsi14, 1)} />
              <Row label="ATR14" value={num(indicators.atr14, 4)} />
              <Row
                label="ATR %"
                value={indicators.atrPct !== null ? `${(indicators.atrPct * 100).toFixed(2)}%` : "-"}
              />
              <Row label="Relative volume" value={num(indicators.relativeVolume, 2)} />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {news ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">News context at decision time</CardTitle>
            <CardDescription>
              Exactly what was known when this candidate was created - not today&apos;s news. Context only: it never
              affected the risk, sizing, stop or target above.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Row label="News risk" value={news.newsRisk} />
            <Row label="Status" value={news.status} />
            <Row label="Captured" value={news.generatedAt} />
            {news.events.length > 0 ? (
              <div className="mt-3 space-y-3">
                {news.events.map((event) => (
                  <div key={event.id} className="border-t pt-3 text-sm">
                    <div className="font-medium">{event.headline}</div>
                    <div className="text-muted-foreground text-xs">
                      {event.source} · {event.sourceQuality} · {event.category} · {event.newsRisk} ·{" "}
                      {new Date(event.publishedAt).toLocaleString()}
                    </div>
                    {event.summary ? <p className="text-muted-foreground mt-1 text-xs">{event.summary}</p> : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground mt-2 text-sm">
                {news.status === "UNAVAILABLE"
                  ? "The news layer could not be consulted when this candidate was created."
                  : "No relevant recent events were found."}
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {trade ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Position</CardTitle>
            <CardDescription>{trade.status}{trade.exit_reason ? ` - ${trade.exit_reason}` : ""}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-x-8 sm:grid-cols-2">
            <div>
              <Row label="Entry fill" value={money(trade.entry_price, 4)} />
              <Row label="Quantity" value={num(trade.qty, 6)} />
              <Row label="Notional" value={money(trade.notional)} />
              <Row label="Opened" value={trade.opened_at ?? "-"} />
            </div>
            <div>
              <Row label="Exit fill" value={money(trade.exit_price, 4)} />
              <Row label="Net P/L" value={money(trade.pnl, 4)} />
              <Row label="Realized R" value={trade.r_multiple !== null ? `${num(trade.r_multiple)}R` : "-"} />
              <Row label="Fees" value={money(trade.fees, 4)} />
              <Row label="Equity after" value={money(trade.equity_after)} />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {isOwner(user) && signal.approval_status === "PENDING" && !isExpiredNow ? (
        <p className="text-muted-foreground text-sm">
          This candidate is awaiting your decision. Approving re-runs every deterministic check against fresh
          market data before a position opens - it never executes the stored proposal blindly.
        </p>
      ) : null}
    </div>
  );
}
