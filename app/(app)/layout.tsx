import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import type { SystemHealthLevel } from "@/components/dashboard/system-status-badge";
import type { TradingMode } from "@/lib/types/trading-mode";

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const admin = createAdminClient();
  const [{ data: settings }, { data: lastJob }] = await Promise.all([
    admin.from("system_settings").select("trading_mode").eq("id", true).single(),
    admin.from("job_runs").select("status, completed_at, started_at").eq("job_name", "scan").order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const mode: TradingMode = settings?.trading_mode ?? "OBSERVE";

  let scannerHealth: SystemHealthLevel = "UNKNOWN";
  if (lastJob) {
    if (lastJob.status === "SUCCEEDED") scannerHealth = "HEALTHY";
    else if (lastJob.status === "FAILED") scannerHealth = "ERROR";
    else scannerHealth = "WARNING";
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <div className="flex min-h-svh flex-1 flex-col">
        <DashboardHeader
          mode={mode}
          scannerHealth={scannerHealth}
          lastScanLabel={relativeTime(lastJob?.started_at ?? null)}
        />
        <main className="flex-1 space-y-6 p-4 md:p-6">{children}</main>
      </div>
    </SidebarProvider>
  );
}
