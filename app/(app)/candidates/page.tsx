import { CircleDot } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/auth/authorization";
import { EmptyState } from "@/components/dashboard/empty-state";
import { CandidatesTable } from "@/components/tables/candidates-table";

export default async function CandidatesPage() {
  const supabase = await createClient();
  const [{ data: { user } }, { data: candidates }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("signals").select("id, symbol, candle_time, score, regime, planned_entry, stop_price, target_price, risk_reward, approval_status, owner_decision, rejection_reason, news_risk, strategy_version_id").eq("classification", "CANDIDATE").order("candle_time", { ascending: false }).limit(250),
  ]);

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold tracking-tight">Candidates</h1>
      {candidates?.length ? <CandidatesTable data={candidates} canManage={user ? getUserRole(user) === "owner" : false} /> : <EmptyState icon={CircleDot} title="No candidates yet" />}
    </div>
  );
}
