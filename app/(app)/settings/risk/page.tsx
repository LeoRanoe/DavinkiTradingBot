import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isOwner } from "@/lib/auth/authorization";
import { riskSettingsFromRow } from "@/lib/settings/risk-settings";
import { RiskSettingsForm } from "@/components/settings/risk-settings-form";
import { ResearchWindowCard, type ResearchWindowView } from "@/components/settings/research-window-card";
import { loadCurrentResearchWindow } from "@/lib/research/store";
import { effectiveExecutionPolicy } from "@/lib/research/policy";
import { researchProgress, researchWindowState, formatTimeRemaining } from "@/lib/research/window";

export default async function RiskSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Guests can read the data but never reach this surface; the API route and
  // the RLS policy refuse their writes independently of this redirect.
  if (!user || !isOwner(user)) redirect("/dashboard");

  const [{ data: row }, { data: strategy }] = await Promise.all([
    supabase.from("system_settings").select("*").eq("id", true).single(),
    supabase.from("strategy_versions").select("version_label, status").eq("version_label", "v1").maybeSingle(),
  ]);

  const settings = riskSettingsFromRow(row);
  const window = await loadCurrentResearchWindow(supabase);

  // Server Component: evaluated once per request, deliberately. See the
  // dashboard for why the window's state must be read against real time.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const state = researchWindowState(window, now);
  const progress = window ? researchProgress(window, now) : null;
  const effective = effectiveExecutionPolicy({
    configuredPolicy: settings.executionPolicy,
    tradingMode: settings.tradingMode,
    researchWindow: window,
    now,
  });

  const view: ResearchWindowView = {
    state,
    startedAt: window?.startedAt ?? null,
    endsAt: window?.endsAt ?? null,
    day: state === "ACTIVE" ? (progress?.day ?? null) : null,
    totalDays: progress?.totalDays ?? null,
    timeRemaining: progress ? formatTimeRemaining(progress.msRemaining) : null,
    startingEquity: window?.startingEquity ?? null,
    targetEquity: window?.targetEquity ?? null,
    strategyLabel: strategy?.version_label ?? "v1",
    strategyStatus: strategy?.status ?? "UNKNOWN",
    configuredPolicy: settings.executionPolicy,
    effectivePolicy: effective.policy,
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Trading &amp; risk settings</h1>
        <p className="text-muted-foreground text-sm">
          Owner-only. These values drive every candidate the scanner produces: the risk budget, the position
          size derived from it, which setups qualify at all, and how long a candidate stays executable.
        </p>
      </div>

      <ResearchWindowCard view={view} />

      <RiskSettingsForm settings={settings} />
    </div>
  );
}
