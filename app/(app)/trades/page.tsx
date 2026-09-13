import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Receipt } from "lucide-react";

export default async function TradesPage() {
  const supabase = await createClient();
  const { data: trades } = await supabase.from("trades").select("*").order("created_at", { ascending: false }).limit(100);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Trades</h1>
        <p className="text-muted-foreground text-sm">
          All trades are PAPER (simulated) in this build. Never treated as real-money results.
        </p>
      </div>
      {trades && trades.length > 0 ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Entry</TableHead>
                <TableHead>Exit</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>P/L</TableHead>
                <TableHead>R</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trades.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>{t.symbol}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{t.trading_mode}</Badge>
                  </TableCell>
                  <TableCell>{t.status}</TableCell>
                  <TableCell className="font-mono tabular-nums">{t.entry_price?.toFixed(2) ?? "-"}</TableCell>
                  <TableCell className="font-mono tabular-nums">{t.exit_price?.toFixed(2) ?? "-"}</TableCell>
                  <TableCell className="font-mono tabular-nums">{t.qty ?? "-"}</TableCell>
                  <TableCell
                    className={`font-mono tabular-nums ${t.pnl != null ? (t.pnl >= 0 ? "text-positive" : "text-negative") : ""}`}
                  >
                    {t.pnl != null ? `${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(2)}` : "-"}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">{t.r_multiple?.toFixed(2) ?? "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState
          icon={Receipt}
          title="Paper trading has not started yet"
          description="Switch to PAPER mode in Settings and approve a candidate setup to open the first simulated trade."
        />
      )}
    </div>
  );
}
