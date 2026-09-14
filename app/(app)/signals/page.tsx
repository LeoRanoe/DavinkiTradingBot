import { createClient } from "@/lib/supabase/server";
import { SignalsTable } from "@/components/tables/signals-table";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Radar } from "lucide-react";
import { getUserRole } from "@/lib/auth/authorization";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function SignalsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: signals } = await supabase
    .from("signals")
    .select("id, symbol, candle_time, score, classification, regime, risk_reward, approval_status, reason")
    .order("candle_time", { ascending: false })
    .limit(100);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Signals</h1>
        <Button variant="outline" size="sm" render={<Link href="/candidates">Candidates</Link>} />
      </div>
      {signals && signals.length > 0 ? (
        <SignalsTable data={signals} canManage={user ? getUserRole(user) === "owner" : false} />
      ) : (
        <EmptyState icon={Radar} title="No signals yet" />
      )}
    </div>
  );
}
