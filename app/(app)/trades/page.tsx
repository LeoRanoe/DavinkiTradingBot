import { Receipt } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Badge } from "@/components/ui/badge";

const money = (value: number | null) => value === null ? "-" : (value >= 0 ? "+" : "") + "$" + Math.abs(Number(value)).toFixed(2);

function duration(openedAt: string | null, closedAt: string | null) {
  if (!openedAt || !closedAt) return "-";
  const minutes = Math.max(0, Math.round((new Date(closedAt).getTime() - new Date(openedAt).getTime()) / 60_000));
  return minutes < 60 ? minutes + "m" : (minutes / 60).toFixed(1) + "h";
}

export default async function TradesPage() {
  const supabase = await createClient();
  const { data: trades } = await supabase.from("trades").select("*").order("created_at", { ascending: false }).limit(100);

  return (
    <div className="space-y-5">
      <div><h1 className="text-xl font-semibold tracking-tight">Trades</h1><p className="mt-1 text-sm text-muted-foreground">Historical PAPER execution. Results are simulated and never represent live-money performance.</p></div>
      {trades?.length ? (
        <>
          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Time</th><th className="px-3 py-3 font-medium">Symbol</th><th className="px-3 py-3 font-medium">Mode</th><th className="px-3 py-3 font-medium">Entry</th><th className="px-3 py-3 font-medium">Exit</th><th className="px-3 py-3 font-medium">Result</th><th className="px-3 py-3 font-medium">R</th><th className="px-3 py-3 font-medium">Fees</th><th className="px-4 py-3 font-medium">Exit reason</th></tr></thead>
              <tbody>{trades.map((trade) => <tr key={trade.id} className="border-t border-border/70 hover:bg-muted/30"><td className="px-4 py-3 font-mono text-xs text-muted-foreground">{new Date(trade.created_at).toLocaleString()}</td><td className="px-3 py-3 font-medium">{trade.symbol}</td><td className="px-3 py-3"><Badge variant="outline">{trade.trading_mode}</Badge></td><td className="px-3 py-3 font-mono tabular-nums">{trade.entry_price === null ? "-" : "$" + Number(trade.entry_price).toFixed(2)}</td><td className="px-3 py-3 font-mono tabular-nums">{trade.exit_price === null ? "-" : "$" + Number(trade.exit_price).toFixed(2)}</td><td className={"px-3 py-3 font-mono tabular-nums " + (trade.pnl === null ? "" : trade.pnl >= 0 ? "text-positive" : "text-negative")}>{money(trade.pnl)}</td><td className="px-3 py-3 font-mono tabular-nums">{trade.r_multiple === null ? "-" : Number(trade.r_multiple).toFixed(2) + "R"}</td><td className="px-3 py-3 font-mono tabular-nums">{"$" + Number(trade.fees ?? 0).toFixed(2)}</td><td className="px-4 py-3"><Badge variant="outline">{trade.exit_reason ?? trade.status}</Badge></td></tr>)}</tbody>
            </table>
          </div>
          <div className="grid gap-2 md:hidden">{trades.map((trade) => <div key={trade.id} className="rounded-lg border p-3"><div className="flex items-start justify-between gap-3"><div><div className="font-medium">{trade.symbol} <span className="text-muted-foreground">{trade.trading_mode}</span></div><div className="mt-1 text-xs text-muted-foreground">{new Date(trade.created_at).toLocaleString()} · {duration(trade.opened_at, trade.closed_at)}</div></div><Badge variant="outline">{trade.exit_reason ?? trade.status}</Badge></div><div className="mt-3 grid grid-cols-3 gap-2 text-sm"><div><span className="text-muted-foreground">Entry</span><p className="font-mono tabular-nums">{trade.entry_price === null ? "-" : "$" + Number(trade.entry_price).toFixed(2)}</p></div><div><span className="text-muted-foreground">Result</span><p className={"font-mono tabular-nums " + (trade.pnl === null ? "" : trade.pnl >= 0 ? "text-positive" : "text-negative")}>{money(trade.pnl)}</p></div><div><span className="text-muted-foreground">R</span><p className="font-mono tabular-nums">{trade.r_multiple === null ? "-" : Number(trade.r_multiple).toFixed(2) + "R"}</p></div></div></div>)}</div>
        </>
      ) : <EmptyState icon={Receipt} title="No PAPER trades yet" description="Strategy V1 remains DRAFT. When evidence supports approval, completed PAPER positions will appear here." />}
    </div>
  );
}
