"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * "Use this strategy" (spec Prompt 2 S16): select strategy version (fixed
 * by the caller) -> instruments -> mode. PAPER is shown but disabled with
 * an explanation - it requires separate owner authorization the create
 * flow never grants (see supabase/migrations/*_strategy_platform.sql
 * strategy_assignments_protect_authorization). LIVE is never offered.
 */
export function UseStrategyForm({ strategyVersionId, defaultName }: { strategyVersionId: string; defaultName: string }) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [instruments, setInstruments] = useState("BTCUSDT");
  const [mode, setMode] = useState<"RESEARCH" | "SHADOW">("RESEARCH");
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    setSaving(true);
    try {
      const res = await fetch("/api/strategies/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategyVersionId,
          configurationName: name,
          instrumentIds: instruments.split(",").map((s) => s.trim()).filter(Boolean),
          mode,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Failed to create assignment");
        return;
      }
      toast.success("Strategy assigned - it will now be evaluated in " + mode.toLowerCase() + " mode.");
      router.refresh();
    } catch {
      toast.error("Network error while assigning.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="space-y-1">
        <Label htmlFor="config-name">Configuration name</Label>
        <Input id="config-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="instruments">Instruments (comma-separated)</Label>
        <Input id="instruments" value={instruments} onChange={(e) => setInstruments(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label>Mode</Label>
          <Select value={mode} onValueChange={(v) => setMode(v as "RESEARCH" | "SHADOW")}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="RESEARCH">RESEARCH</SelectItem>
              <SelectItem value="SHADOW">SHADOW</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="button" disabled={saving} onClick={handleSubmit}>
          Use this strategy
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        PAPER requires separate owner authorization and LIVE is disabled in this build - neither is offered here.
      </p>
    </div>
  );
}
