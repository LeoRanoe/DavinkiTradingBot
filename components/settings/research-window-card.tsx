"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ExecutionPolicy } from "@/lib/settings/risk-settings";
import type { ResearchWindowState } from "@/lib/research/window";

export type ResearchWindowView = {
  state: ResearchWindowState;
  startedAt: string | null;
  endsAt: string | null;
  day: number | null;
  totalDays: number | null;
  timeRemaining: string | null;
  startingEquity: number | null;
  targetEquity: number | null;
  strategyLabel: string;
  strategyStatus: string;
  configuredPolicy: ExecutionPolicy;
  /** What the system will actually do right now, which may differ. */
  effectivePolicy: ExecutionPolicy;
};

function formatTimestamp(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

/**
 * Owner control and status for the time-bounded PAPER research window.
 *
 * The copy here is doing real work: a DRAFT strategy executing under a
 * research window must never read as an approved or profitable strategy, so
 * the status is always stated as "DRAFT - research only" and never as
 * PAPER_APPROVED.
 */
export function ResearchWindowCard({ view }: { view: ResearchWindowView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState("14");
  const [startingEquity, setStartingEquity] = useState(
    view.startingEquity !== null ? String(view.startingEquity) : "20",
  );
  const [targetEquity, setTargetEquity] = useState(
    view.targetEquity !== null ? String(view.targetEquity) : "50",
  );

  const active = view.state === "ACTIVE";

  async function post(body: Record<string, unknown>, successMessage: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Request failed.");
        return;
      }
      toast.success(successMessage);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Automatic PAPER research</CardTitle>
          <Badge variant={active ? "default" : "secondary"}>
            {active ? "Active" : view.state === "EXPIRED" ? "Expired" : "Not configured"}
          </Badge>
        </div>
        <CardDescription>
          A research window is the only thing that lets a DRAFT strategy execute in PAPER. It is
          time-bounded, expires on its own, and never means the strategy has been validated or is
          profitable.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {active ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Started</dt>
              <dd className="font-mono">{formatTimestamp(view.startedAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Ends</dt>
              <dd className="font-mono">{formatTimestamp(view.endsAt)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Progress</dt>
              <dd>
                Day {view.day} of {view.totalDays}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Time remaining</dt>
              <dd>{view.timeRemaining}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Strategy</dt>
              <dd>
                {view.strategyLabel} ({view.strategyStatus} - research only)
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Starting equity</dt>
              <dd>
                ${view.startingEquity?.toFixed(2) ?? "-"}
                {view.targetEquity !== null ? (
                  <span className="text-muted-foreground">
                    {" "}
                    - target ${view.targetEquity.toFixed(2)} (informational only)
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>
        ) : (
          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              No research window is active, so a DRAFT strategy is not executable. Starting one lets the
              scanner execute PAPER trades under the deterministic rules already configured above.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="researchDays">Duration (days)</Label>
                <Input
                  id="researchDays"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  disabled={busy}
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="researchStartEquity">Starting PAPER equity</Label>
                <Input
                  id="researchStartEquity"
                  value={startingEquity}
                  onChange={(e) => setStartingEquity(e.target.value)}
                  disabled={busy}
                  inputMode="decimal"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="researchTargetEquity">Target (informational)</Label>
                <Input
                  id="researchTargetEquity"
                  value={targetEquity}
                  onChange={(e) => setTargetEquity(e.target.value)}
                  disabled={busy}
                  inputMode="decimal"
                />
              </div>
            </div>
          </div>
        )}

        {view.configuredPolicy === "AUTO" && view.effectivePolicy !== "AUTO" ? (
          <p className="text-sm text-amber-600 dark:text-amber-500">
            Execution mode is set to Fully automated, but automatic execution is NOT in force: it requires
            PAPER mode and an active research window. Candidates currently require your approval.
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          {active ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => post({ action: "stop" }, "Research window stopped. Approval is required again.")}
            >
              {busy ? "Working..." : "Stop research window"}
            </Button>
          ) : (
            <Button
              disabled={busy}
              onClick={() =>
                post(
                  {
                    action: "start",
                    days: Number(days),
                    startingEquity: Number(startingEquity),
                    targetEquity: targetEquity.trim() === "" ? null : Number(targetEquity),
                  },
                  "Research window started.",
                )
              }
            >
              {busy ? "Starting..." : "Start research window"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
