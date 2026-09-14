import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import type { TradingMode } from "@/lib/types/trading-mode";
import { getUserRole } from "@/lib/auth/authorization";
import { scannerHealthLevel } from "@/lib/health/scanner";

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

  const role = getUserRole(user);

  // Both tables are readable by any authenticated user via RLS - no need
  // for the privileged admin client just to render header status badges.
  const [{ data: settings }, { data: lastJob }] = await Promise.all([
    supabase.from("system_settings").select("trading_mode").eq("id", true).single(),
    supabase.from("job_runs").select("status, completed_at, started_at").eq("job_name", "scan").order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const mode: TradingMode = settings?.trading_mode ?? "OBSERVE";

  // Server Component: evaluated once per request so a scanner that has
  // stopped advancing is correctly detected as stale, not just by status.
  // eslint-disable-next-line react-hooks/purity
  const layoutNow = Date.now();
  const scannerHealth = scannerHealthLevel(
    lastJob ? { status: lastJob.status, startedAt: lastJob.started_at } : null,
    layoutNow,
  );

  return (
    <SidebarProvider>
      <AppSidebar role={role} />
      <div className="flex min-h-svh flex-1 flex-col">
        <DashboardHeader
          mode={mode}
          scannerHealth={scannerHealth}
          lastScanLabel={relativeTime(lastJob?.started_at ?? null)}
          email={user.email ?? "Signed in"}
          role={role}
        />
        <main className="flex-1 p-4 md:p-6">
          <div className="mx-auto w-full max-w-[1440px]">{children}</div>
        </main>
      </div>
    </SidebarProvider>
  );
}
