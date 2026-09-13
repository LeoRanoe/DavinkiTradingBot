"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ClassificationBadge } from "@/components/dashboard/setup-score";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export type SignalRow = {
  id: string;
  symbol: string;
  candle_time: string;
  score: number;
  classification: string;
  regime: string;
  risk_reward: number | null;
  approval_status: string;
  reason: string | null;
};

const columns: ColumnDef<SignalRow>[] = [
  {
    accessorKey: "candle_time",
    header: "Time",
    cell: ({ row }) => (
      <span className="text-muted-foreground font-mono text-xs whitespace-nowrap">
        {new Date(row.original.candle_time).toLocaleString()}
      </span>
    ),
  },
  { accessorKey: "symbol", header: "Symbol" },
  {
    accessorKey: "score",
    header: "Score",
    cell: ({ row }) => <span className="font-mono tabular-nums">{row.original.score}/100</span>,
  },
  {
    accessorKey: "classification",
    header: "Classification",
    cell: ({ row }) => <ClassificationBadge classification={row.original.classification} />,
  },
  { accessorKey: "regime", header: "Regime" },
  {
    accessorKey: "risk_reward",
    header: "R/R",
    cell: ({ row }) => (
      <span className="font-mono tabular-nums">{row.original.risk_reward?.toFixed(1) ?? "-"}</span>
    ),
  },
  {
    accessorKey: "approval_status",
    header: "Status",
    cell: ({ row }) => <Badge variant="outline">{row.original.approval_status}</Badge>,
  },
];

export function SignalsTable({ data, canManage }: { data: SignalRow[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });

  async function act(id: string, action: "approve" | "reject") {
    setPending(id);
    try {
      const res = await fetch(`/api/signals/${id}/${action}`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Request failed");
      if (body.kind === "EXECUTED") toast.success("Paper trade opened");
      else if (body.kind === "REJECTED") toast.warning(`Rejected: ${body.reason}`);
      else toast.info(body.reason ?? "No action taken");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id}>
              {hg.headers.map((header) => (
                <TableHead key={header.id}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
              {canManage ? <TableHead className="text-right">Actions</TableHead> : null}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
              ))}
              {canManage ? <TableCell className="text-right">
                {row.original.approval_status === "PENDING" ? (
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending === row.original.id}
                      onClick={() => act(row.original.id, "approve")}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending === row.original.id}
                      onClick={() => act(row.original.id, "reject")}
                    >
                      Reject
                    </Button>
                  </div>
                ) : null}
              </TableCell> : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
