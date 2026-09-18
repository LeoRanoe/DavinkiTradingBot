"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function AssignmentRowControls({ assignmentId, enabled, mode }: { assignmentId: string; enabled: boolean; mode: "RESEARCH" | "SHADOW" | "PAPER" | "LIVE" }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    try {
      const res = await fetch(`/api/strategies/assignments/${assignmentId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Failed to update assignment");
        return;
      }
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  const modeIsSwitchable = mode === "RESEARCH" || mode === "SHADOW";

  return (
    <div className="flex items-center gap-3">
      {modeIsSwitchable ? (
        <Select value={mode} disabled={saving} onValueChange={(v) => patch({ mode: v })}>
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="RESEARCH">RESEARCH</SelectItem>
            <SelectItem value="SHADOW">SHADOW</SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <span className="text-muted-foreground text-xs">{mode} (requires owner authorization to change)</span>
      )}
      <Switch checked={enabled} disabled={saving} onCheckedChange={(checked) => patch({ enabled: checked })} />
    </div>
  );
}
