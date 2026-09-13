"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpRight, Check, X } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { SetupScore } from "@/components/dashboard/setup-score";

export type CandidateRow = {
  id: string;
  symbol: string;
  candle_time: string;
  score: number;
  regime: string;
  planned_entry: number | null;
  stop_price: number | null;
  target_price: number | null;
  risk_reward: number | null;
  approval_status: string;
  owner_decision: string | null;
  rejection_reason: string | null;
  news_risk: string | null;
  strategy_version_id: string;
};

function status(row: CandidateRow) {
  if (row.approval_status === "REJECTED" && row.owner_decision === "REJECTED") return "OWNER REJECTED";
  return row.rejection_reason ? "RISK BLOCKED" : row.approval_status;
}

function money(value: number | null) {
  return value === null ? "-" : "$" + Number(value).toFixed(2);
}

export function CandidatesTable({ data, canManage }: { data: CandidateRow[]; canManage: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [state, setState] = useState("ALL");
  const [pending, setPending] = useState<string | null>(null);
  const filtered = useMemo(
    () => data.filter((row) => {
      const matchQuery = [row.symbol, row.regime, row.news_risk, status(row)].filter(Boolean).join(" ").toLowerCase().includes(query.toLowerCase());
      return matchQuery && (state === "ALL" || status(row) === state);
    }),
    [data, query, state],
  );

  async function act(id: string, action: "approve" | "reject") {
    setPending(id);
    try {
      const response = await fetch("/api/signals/" + id + "/" + action, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? "Request failed");
      toast.success(action === "approve" ? "Approval revalidation completed" : "Candidate rejected");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1">
          {["ALL", "PENDING", "APPROVED", "REJECTED", "EXPIRED", "RISK BLOCKED"].map((item) => (
            <Button key={item} size="sm" variant={state === item ? "secondary" : "ghost"} onClick={() => setState(item)}>
              {item === "ALL" ? "All" : item}
            </Button>
          ))}
        </div>
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter BTC, ETH, regime, news..." className="sm:max-w-64" aria-label="Filter candidates" />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No candidates match this view.</div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr><th className="px-4 py-3 font-medium">Time</th><th className="px-3 py-3 font-medium">Symbol</th><th className="px-3 py-3 font-medium">Score</th><th className="px-3 py-3 font-medium">Plan</th><th className="px-3 py-3 font-medium">R/R</th><th className="px-3 py-3 font-medium">News</th><th className="px-3 py-3 font-medium">Status</th><th className="px-4 py-3 text-right font-medium">Details</th></tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr key={row.id} className="border-t border-border/70 hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{new Date(row.candle_time).toLocaleString()}</td>
                    <td className="px-3 py-3 font-medium">{row.symbol}</td>
                    <td className="px-3 py-3"><SetupScore score={row.score} classification="CANDIDATE" /></td>
                    <td className="px-3 py-3 font-mono text-xs tabular-nums">{money(row.planned_entry)} / {money(row.stop_price)} / {money(row.target_price)}</td>
                    <td className="px-3 py-3 font-mono tabular-nums">{row.risk_reward?.toFixed(1) ?? "-"}R</td>
                    <td className="px-3 py-3"><Badge variant="outline">{row.news_risk ?? "UNKNOWN"}</Badge></td>
                    <td className="px-3 py-3"><Badge variant="outline">{status(row)}</Badge></td>
                    <td className="px-4 py-3"><div className="flex justify-end gap-1">
                      {canManage && row.approval_status === "PENDING" ? <><Button size="icon-sm" variant="ghost" disabled={pending === row.id} onClick={() => act(row.id, "approve")} aria-label="Approve candidate"><Check /></Button><Button size="icon-sm" variant="ghost" disabled={pending === row.id} onClick={() => act(row.id, "reject")} aria-label="Reject candidate"><X /></Button></> : null}
                      <Button size="icon-sm" variant="ghost" render={<Link href={"/signals/" + row.id} />} aria-label="View candidate"><ArrowUpRight /></Button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-2 md:hidden">
            {filtered.map((row) => (
              <div key={row.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3"><div><div className="font-medium">{row.symbol}</div><div className="mt-1 text-xs text-muted-foreground">{new Date(row.candle_time).toLocaleString()}</div></div><Badge variant="outline">{status(row)}</Badge></div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm"><div><span className="text-muted-foreground">Entry</span><p className="font-mono tabular-nums">{money(row.planned_entry)}</p></div><div><span className="text-muted-foreground">R/R</span><p className="font-mono tabular-nums">{row.risk_reward?.toFixed(1) ?? "-"}R</p></div></div>
                <div className="mt-3 flex items-center justify-between"><SetupScore score={row.score} classification="CANDIDATE" /><Button size="sm" variant="outline" render={<Link href={"/signals/" + row.id}>View</Link>} /></div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
