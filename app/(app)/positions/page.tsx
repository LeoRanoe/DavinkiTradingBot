import Link from "next/link";
import { ReceiptText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const money = (value: number | null) => value === null ? "-" : "$" + Number(value).toFixed(2);
const elapsed = (started: string | null) => !started ? "-" : Math.max(0, Math.floor((Date.now() - new Date(started).getTime()) / 3_600_000)) + "h";

export default async function PositionsPage() {
  const supabase = await createClient();
  const [{ data: open }, { data: pending }, { data: closed }] = await Promise.all([
    supabase.from("trades").select("*").eq("status", "OPEN").order("opened_at", { ascending: false }),
    supabase.from("signals").select("id, symbol, score, planned_entry, stop_price, target_price, risk_reward, expires_at, news_risk").eq("approval_status", "PENDING").order("candle_time", { ascending: false }).limit(10),
    supabase.from("trades").select("*").eq("status", "CLOSED").order("closed_at", { ascending: false }).limit(30),
  ]);

  return (
    <div className="space-y-6">
      <div><h1 className="text-xl font-semibold tracking-tight">Positions</h1><p className="mt-1 text-sm text-muted-foreground">PAPER position state is authoritative. No live execution is available.</p></div>
      <section className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Open positions</h2><Badge variant="outline">{open?.length ?? 0} active</Badge></div>
        {open?.length ? <div className="grid gap-3 lg:grid-cols-2">{open.map((trade) => <Card key={trade.id} className="border-warning/35"><CardHeader className="pb-2"><CardTitle className="flex items-center justify-between text-base"><span>{trade.symbol}</span><Badge variant="outline">{trade.trading_mode}</Badge></CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-x-5 gap-y-3 text-sm sm:grid-cols-4"><div><span className="text-muted-foreground">Entry</span><p className="font-mono tabular-nums">{money(trade.entry_price)}</p></div><div><span className="text-muted-foreground">Stop</span><p className="font-mono tabular-nums">{money(trade.stop_price)}</p></div><div><span className="text-muted-foreground">Target</span><p className="font-mono tabular-nums">{money(trade.target_price)}</p></div><div><span className="text-muted-foreground">Duration</span><p className="font-mono tabular-nums">{elapsed(trade.opened_at)}</p></div><div><span className="text-muted-foreground">Qty</span><p className="font-mono tabular-nums">{trade.qty ?? "-"}</p></div><div><span className="text-muted-foreground">Notional</span><p className="font-mono tabular-nums">{money(trade.notional)}</p></div><div><span className="text-muted-foreground">Risk</span><p className="font-mono tabular-nums">{money(trade.modeled_max_loss)}</p></div><div><span className="text-muted-foreground">Planned R</span><p className="font-mono tabular-nums">{trade.risk_reward?.toFixed(1) ?? "-"}R</p></div></CardContent></Card>)}</div> : <EmptyState icon={ReceiptText} title="No PAPER position is open" description="Open positions are managed automatically by the scanner on every run." />}
      </section>
      <section className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Pending approval</h2><Badge variant="outline">{pending?.length ?? 0} awaiting decision</Badge></div>
        {pending?.length ? <div className="grid gap-2 md:grid-cols-2">{pending.map((signal) => <Card key={signal.id}><CardContent className="flex items-center justify-between gap-3 p-4"><div><div className="font-medium">{signal.symbol} <span className="font-mono text-sm">{signal.score}/100</span></div><div className="mt-1 text-xs text-muted-foreground">Entry {money(signal.planned_entry)} / Stop {money(signal.stop_price)} / Target {money(signal.target_price)}</div></div><Button size="sm" variant="outline" render={<Link href={"/signals/" + signal.id}>Review</Link>} /></CardContent></Card>)}</div> : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No candidate is waiting for approval.</p>}
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Recently closed</h2>
        {closed?.length ? <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[680px] text-sm"><thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Closed</th><th className="px-3 py-3 font-medium">Symbol</th><th className="px-3 py-3 font-medium">Result</th><th className="px-3 py-3 font-medium">R</th><th className="px-3 py-3 font-medium">Fees</th><th className="px-4 py-3 font-medium">Exit</th></tr></thead><tbody>{closed.map((trade) => <tr key={trade.id} className="border-t border-border/70"><td className="px-4 py-3 font-mono text-xs text-muted-foreground">{trade.closed_at ? new Date(trade.closed_at).toLocaleString() : "-"}</td><td className="px-3 py-3 font-medium">{trade.symbol}</td><td className={"px-3 py-3 font-mono tabular-nums " + ((trade.pnl ?? 0) >= 0 ? "text-positive" : "text-negative")}>{trade.pnl === null ? "-" : (trade.pnl >= 0 ? "+" : "") + money(trade.pnl)}</td><td className="px-3 py-3 font-mono tabular-nums">{trade.r_multiple?.toFixed(2) ?? "-"}R</td><td className="px-3 py-3 font-mono tabular-nums">{money(trade.fees)}</td><td className="px-4 py-3"><Badge variant="outline">{trade.exit_reason ?? "CLOSED"}</Badge></td></tr>)}</tbody></table></div> : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No closed PAPER positions yet.</p>}
      </section>
    </div>
  );
}
