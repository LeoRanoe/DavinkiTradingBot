import { createClient } from "@/lib/supabase/server";
import { SignalsTable } from "@/components/tables/signals-table";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Radar } from "lucide-react";

export default async function SignalsPage() {
  const supabase = await createClient();
  const { data: signals } = await supabase
    .from("signals")
    .select("id, symbol, candle_time, score, classification, regime, risk_reward, approval_status, reason")
    .order("candle_time", { ascending: false })
    .limit(100);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Signals</h1>
        <p className="text-muted-foreground text-sm">
          Every candle Strategy V1 scored LOG or above. IGNORE-level candles are not stored, to avoid noise.
        </p>
      </div>
      {signals && signals.length > 0 ? (
        <SignalsTable data={signals} />
      ) : (
        <EmptyState
          icon={Radar}
          title="No signals yet"
          description="The scanner is running and will record qualifying closed candles as they occur."
        />
      )}
    </div>
  );
}
