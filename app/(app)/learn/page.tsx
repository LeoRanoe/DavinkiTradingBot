import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GraduationCap } from "lucide-react";
import { calculatePerformance } from "@/lib/learning/analytics";

export default async function LearnPage() {
  const supabase = await createClient();
  const [{ data: lessons }, { data: trades }] = await Promise.all([
    supabase.from("lessons").select("*").order("created_at", { ascending: false }).limit(50),
    supabase.from("trades").select("*").eq("status", "CLOSED").order("closed_at", { ascending: false }).limit(500),
  ]);
  const actualMetrics = calculatePerformance((trades ?? []).map((trade) => ({
    id: trade.id, actual: true, symbol: trade.symbol, strategyVersion: trade.strategy_version_id,
    openedAt: trade.opened_at ? new Date(trade.opened_at).getTime() : 0,
    closedAt: trade.closed_at ? new Date(trade.closed_at).getTime() : null,
    pnl: trade.pnl, fees: trade.fees, slippage: trade.slippage, rMultiple: trade.r_multiple,
  })));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Learn</h1>
        <p className="text-muted-foreground text-sm">Actual PAPER outcomes are distinct from rejected-candidate counterfactual research.</p>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="text-sm font-medium">Actual performance</CardTitle><Badge variant="outline">{actualMetrics.evidenceLevel}</Badge></CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-4"><span>Closed: <strong>{actualMetrics.sampleCount}</strong></span><span>Expectancy: <strong>{actualMetrics.expectancyR === null ? "—" : `${actualMetrics.expectancyR.toFixed(2)}R`}</strong></span><span>Win rate: <strong>{actualMetrics.winRate === null ? "—" : `${(actualMetrics.winRate * 100).toFixed(0)}%`}</strong></span><span>Net P/L: <strong>${actualMetrics.netPnl.toFixed(2)}</strong></span></CardContent>
      </Card>
      {actualMetrics.evidenceLevel !== "INITIAL_EVIDENCE" && <p className="rounded-md border p-3 text-sm text-muted-foreground">Insufficient evidence: no condition is described as profitable below 20 closed outcomes.</p>}
      {lessons && lessons.length > 0 ? (
        <div className="grid gap-3">
          {lessons.map((l) => (
            <Card key={l.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-medium">{l.title}</CardTitle>
                <Badge variant="outline">{l.status}</Badge>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">{l.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={GraduationCap}
          title="No lessons yet"
          description="Lessons are generated from real signals and trades - check back after the scanner has run a few times."
        />
      )}
    </div>
  );
}
