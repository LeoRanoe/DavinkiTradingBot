import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/auth/authorization";
import { riskSettingsFromRow } from "@/lib/settings/risk-settings";
import { RiskSettingsForm } from "@/components/settings/risk-settings-form";

export default async function RiskSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Guests can read the data but never reach this surface; the API route and
  // the RLS policy refuse their writes independently of this redirect.
  if (!user || !isOwner(user)) redirect("/dashboard");

  const { data: row } = await supabase.from("system_settings").select("*").eq("id", true).single();
  const settings = riskSettingsFromRow(row);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Risk settings</h1>
        <p className="text-muted-foreground text-sm">
          Owner-only. These values drive every candidate the scanner produces: the risk budget, the position
          size derived from it, which setups qualify at all, and how long a candidate stays executable.
        </p>
      </div>

      <RiskSettingsForm settings={settings} />
    </div>
  );
}
