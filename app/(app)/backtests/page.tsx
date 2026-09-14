import { createClient } from "@/lib/supabase/server";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FlaskConical } from "lucide-react";

export default async function BacktestsPage() {
  const supabase = await createClient();
  const { data: backtests } = await supabase.from("backtests").select("*").order("created_at", { ascending: false }).limit(50);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Backtests</h1>
      {backtests && backtests.length > 0 ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead>
                <TableHead>Split</TableHead>
                <TableHead>Range</TableHead>
                <TableHead>Net Return</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {backtests.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>{b.symbol}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{b.split}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {new Date(b.date_from).toLocaleDateString()} - {new Date(b.date_to).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {(b.metrics as { netReturn?: number })?.netReturn?.toFixed(2) ?? "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState icon={FlaskConical} title="No result" />
      )}
    </div>
  );
}
