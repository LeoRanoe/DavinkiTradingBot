"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { StatusDot } from "@/components/dashboard/primitives";
import type { SystemHealthLevel } from "./system-status-badge";
import type { TradingMode } from "@/lib/types/trading-mode";
import type { ExecutionPolicy } from "@/lib/settings/risk-settings";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const SCANNER_DOT_TONE: Record<SystemHealthLevel, "positive" | "negative" | "warning" | "neutral"> = {
  HEALTHY: "positive",
  WARNING: "warning",
  ERROR: "negative",
  UNKNOWN: "neutral",
};

const SCANNER_LABEL: Record<SystemHealthLevel, string> = {
  HEALTHY: "Online",
  WARNING: "Delayed",
  ERROR: "Offline",
  UNKNOWN: "Unknown",
};

export function DashboardHeader({
  mode,
  executionPolicy,
  scannerHealth,
  email,
  role,
}: {
  mode: TradingMode;
  executionPolicy: ExecutionPolicy;
  scannerHealth: SystemHealthLevel;
  email: string;
  role: "owner" | "guest";
}) {
  const router = useRouter();

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="bg-background sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-5" />
      <div className="flex flex-1 items-center gap-2 text-sm">
        <span className="font-medium">{mode}</span>
        <span className="text-muted-foreground">·</span>
        <span className={cn(executionPolicy === "AUTO" ? "text-brand font-medium" : "text-muted-foreground")}>
          {executionPolicy === "AUTO" ? "AUTO" : "APPROVAL"}
        </span>
        <span className="text-muted-foreground mx-1">•</span>
        <span className="text-muted-foreground inline-flex items-center gap-1.5">
          <StatusDot tone={SCANNER_DOT_TONE[scannerHealth]} />
          {SCANNER_LABEL[scannerHealth]}
        </span>
      </div>
      <div className="text-muted-foreground hidden text-right text-xs md:block">
        <div className="text-foreground max-w-48 truncate">{email}</div>
        <div className="capitalize">{role}</div>
      </div>
      <ThemeToggle />
      <Button size="icon-sm" variant="ghost" onClick={signOut} aria-label="Sign out" title="Sign out">
        <LogOut />
      </Button>
    </header>
  );
}
