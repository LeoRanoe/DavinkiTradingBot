import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { ModeBadge } from "./mode-badge";
import { SystemStatusBadge, type SystemHealthLevel } from "./system-status-badge";
import type { TradingMode } from "@/lib/types/trading-mode";

export function DashboardHeader({
  mode,
  scannerHealth,
  lastScanLabel,
}: {
  mode: TradingMode;
  scannerHealth: SystemHealthLevel;
  lastScanLabel: string;
}) {
  return (
    <header className="bg-background/95 supports-[backdrop-filter]:bg-background/70 sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-5" />
      <div className="flex flex-1 items-center gap-3">
        <ModeBadge mode={mode} />
        <SystemStatusBadge level={scannerHealth} label={`Scanner: ${scannerHealth}`} />
        <span className="text-muted-foreground hidden text-xs sm:inline">Last scan: {lastScanLabel}</span>
      </div>
      <ThemeToggle />
    </header>
  );
}
