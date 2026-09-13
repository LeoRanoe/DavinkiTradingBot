"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { TradingMode } from "@/lib/types/trading-mode";

const MODE_DESCRIPTIONS: Record<TradingMode, string> = {
  OBSERVE: "The scanner records signals but never opens a trade. Default and safest.",
  PAPER: "Approved CANDIDATE signals open simulated trades against a $10 virtual portfolio. No real money.",
  DEMO: "Not yet implemented in this build - Bybit Demo credentials are required first.",
  LIVE: "Permanently disabled in this build.",
};

export function TradingModeCard({ currentMode }: { currentMode: TradingMode }) {
  const router = useRouter();
  const [pendingMode, setPendingMode] = useState<TradingMode | null>(null);
  const [saving, setSaving] = useState(false);

  async function confirmChange() {
    if (!pendingMode) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/trading-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: pendingMode }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Failed to change mode");
      toast.success(`Trading mode switched to ${pendingMode}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to change mode");
    } finally {
      setSaving(false);
      setPendingMode(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Trading mode</CardTitle>
        <CardDescription>
          Controls whether approved signals ever open a trade. LIVE is not selectable - it is disabled in this
          build at the database level and in the risk engine.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Select
          value={currentMode}
          onValueChange={(value) => setPendingMode(value as TradingMode)}
          disabled={saving}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="OBSERVE">OBSERVE</SelectItem>
            <SelectItem value="PAPER">PAPER</SelectItem>
            <SelectItem value="DEMO">DEMO</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-muted-foreground text-sm">{MODE_DESCRIPTIONS[currentMode]}</p>
      </CardContent>

      <AlertDialog open={pendingMode !== null} onOpenChange={(open) => !open && setPendingMode(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to {pendingMode}?</AlertDialogTitle>
            <AlertDialogDescription>{pendingMode ? MODE_DESCRIPTIONS[pendingMode] : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmChange} disabled={saving}>
              {saving ? "Switching..." : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
