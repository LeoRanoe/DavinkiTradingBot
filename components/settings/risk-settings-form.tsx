"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { OwnerRiskSettings, RiskPresetName } from "@/lib/settings/risk-settings";

type FormState = {
  riskMode: OwnerRiskSettings["riskMode"];
  maxRiskPerTradePct: string;
  fixedRiskAmount: string;
  maxOpenPositions: string;
  maxNewTradesPerDay: string;
  maxLosingTradesPerDay: string;
  minCandidateScore: string;
  minRiskReward: string;
  maxEntryDriftPct: string;
  candidateExpiryMinutes: string;
  maxMarketDataAgeSeconds: string;
  maxAtrPct: string;
  feeBps: string;
  slippageBps: string;
  executionPolicy: OwnerRiskSettings["executionPolicy"];
  signalExpiryMinutes: string;
};

function toForm(s: OwnerRiskSettings): FormState {
  return {
    riskMode: s.riskMode,
    maxRiskPerTradePct: (s.maxRiskPerTradePct * 100).toString(),
    fixedRiskAmount: s.fixedRiskAmount.toString(),
    maxOpenPositions: s.maxOpenPositions.toString(),
    maxNewTradesPerDay: s.maxNewTradesPerDay.toString(),
    maxLosingTradesPerDay: s.maxLosingTradesPerDay.toString(),
    minCandidateScore: s.minCandidateScore.toString(),
    minRiskReward: s.minRiskReward.toString(),
    maxEntryDriftPct: (s.maxEntryDriftPct * 100).toString(),
    candidateExpiryMinutes: s.candidateExpiryMinutes.toString(),
    maxMarketDataAgeSeconds: s.maxMarketDataAgeSeconds.toString(),
    maxAtrPct: (s.maxAtrPct * 100).toString(),
    feeBps: s.feeBps.toString(),
    slippageBps: s.slippageBps.toString(),
    executionPolicy: s.executionPolicy,
    signalExpiryMinutes: s.signalExpiryMinutes.toString(),
  };
}

const PRESET_LABELS: Record<RiskPresetName, string> = {
  CONSERVATIVE: "Conservative",
  BALANCED: "Balanced",
  GROWTH_EXPERIMENT: "Growth experiment",
};

export function RiskSettingsForm({ settings }: { settings: OwnerRiskSettings }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(toForm(settings));
  const [saving, setSaving] = useState(false);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function post(body: unknown, successMessage: string) {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/risk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(
          Array.isArray(payload?.issues) && payload.issues.length > 0
            ? payload.issues.join("; ")
            : (payload?.error ?? "Failed to save risk settings"),
        );
      }
      toast.success(successMessage);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save risk settings");
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    // Percent-style inputs are entered as percentages and sent as fractions.
    await post(
      {
        riskMode: form.riskMode,
        maxRiskPerTradePct: Number(form.maxRiskPerTradePct) / 100,
        fixedRiskAmount: Number(form.fixedRiskAmount),
        maxOpenPositions: Number(form.maxOpenPositions),
        maxNewTradesPerDay: Number(form.maxNewTradesPerDay),
        maxLosingTradesPerDay: Number(form.maxLosingTradesPerDay),
        minCandidateScore: Number(form.minCandidateScore),
        minRiskReward: Number(form.minRiskReward),
        maxEntryDriftPct: Number(form.maxEntryDriftPct) / 100,
        candidateExpiryMinutes: Number(form.candidateExpiryMinutes),
        maxMarketDataAgeSeconds: Number(form.maxMarketDataAgeSeconds),
        maxAtrPct: Number(form.maxAtrPct) / 100,
        feeBps: Number(form.feeBps),
        slippageBps: Number(form.slippageBps),
        executionPolicy: form.executionPolicy,
        signalExpiryMinutes: Number(form.signalExpiryMinutes),
      },
      "Risk settings saved",
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Risk is not position size</CardTitle>
          <CardDescription>
            Risk is the approximate amount you intend to lose if the stop is hit. Position size is calculated
            from that risk and the stop distance: a $0.20 risk budget with a 4% stop produces roughly a $5
            position. A trade whose risk-compliant size falls below the exchange minimum is rejected, never
            inflated, and a legitimate technical stop is never tightened to make an order fit.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Presets</CardTitle>
          <CardDescription>
            A preset only fills in the fields below. It is validated exactly like a manual edit, and nothing
            ever selects one for you - a small or slow-growing account never escalates its own risk.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(Object.keys(PRESET_LABELS) as RiskPresetName[]).map((preset) => (
            <Button
              key={preset}
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() => post({ preset }, `${PRESET_LABELS[preset]} preset applied`)}
            >
              {PRESET_LABELS[preset]}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Risk per trade</CardTitle>
          <CardDescription>How much of the account a single stop-out is allowed to cost.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="riskMode">Risk mode</Label>
            <Select
              value={form.riskMode}
              onValueChange={(value) => set("riskMode", value as FormState["riskMode"])}
              disabled={saving}
            >
              <SelectTrigger id="riskMode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PERCENT_OF_EQUITY">Percentage of equity</SelectItem>
                <SelectItem value="FIXED_AMOUNT">Fixed amount</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.riskMode === "PERCENT_OF_EQUITY" ? (
            <NumberField
              id="maxRiskPerTradePct"
              label="Risk per trade (%)"
              hint="Max 10%. Applied to current equity."
              value={form.maxRiskPerTradePct}
              onChange={(v) => set("maxRiskPerTradePct", v)}
              disabled={saving}
              step="0.05"
            />
          ) : (
            <NumberField
              id="fixedRiskAmount"
              label="Fixed risk per trade ($)"
              hint="Capped at current equity when a trade is sized."
              value={form.fixedRiskAmount}
              onChange={(v) => set("fixedRiskAmount", v)}
              disabled={saving}
              step="0.01"
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account limits</CardTitle>
          <CardDescription>Hard stops that apply before any trade is sized.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <NumberField
            id="maxOpenPositions"
            label="Max open positions"
            value={form.maxOpenPositions}
            onChange={(v) => set("maxOpenPositions", v)}
            disabled={saving}
          />
          <NumberField
            id="maxNewTradesPerDay"
            label="Max trades per day (UTC)"
            value={form.maxNewTradesPerDay}
            onChange={(v) => set("maxNewTradesPerDay", v)}
            disabled={saving}
          />
          <NumberField
            id="maxLosingTradesPerDay"
            label="Daily loss lock (losing trades)"
            hint="After this many losses in a UTC day, no new trades until the next day."
            value={form.maxLosingTradesPerDay}
            onChange={(v) => set("maxLosingTradesPerDay", v)}
            disabled={saving}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Candidate quality</CardTitle>
          <CardDescription>
            Filters a setup must clear before the risk engine will size it at all. No valid setup means no
            trade - these are never relaxed automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <NumberField
            id="minCandidateScore"
            label="Minimum candidate score"
            hint="0-100. Strategy V1 classifies 80+ as CANDIDATE."
            value={form.minCandidateScore}
            onChange={(v) => set("minCandidateScore", v)}
            disabled={saving}
          />
          <NumberField
            id="minRiskReward"
            label="Minimum R/R"
            value={form.minRiskReward}
            onChange={(v) => set("minRiskReward", v)}
            disabled={saving}
            step="0.1"
          />
          <NumberField
            id="maxAtrPct"
            label="Max volatility (ATR as % of price)"
            hint="Above this, a technically valid setup is rejected as too volatile."
            value={form.maxAtrPct}
            onChange={(v) => set("maxAtrPct", v)}
            disabled={saving}
            step="0.1"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Entry protection</CardTitle>
          <CardDescription>
            Prevents chasing a price that has already moved. A candidate is only executable inside its allowed
            entry zone, while its market data is fresh, and before it expires.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <NumberField
            id="maxEntryDriftPct"
            label="Max entry drift (%)"
            hint="Allowed entry zone around the planned entry."
            value={form.maxEntryDriftPct}
            onChange={(v) => set("maxEntryDriftPct", v)}
            disabled={saving}
            step="0.05"
          />
          <NumberField
            id="candidateExpiryMinutes"
            label="Candidate expiry (minutes)"
            value={form.candidateExpiryMinutes}
            onChange={(v) => set("candidateExpiryMinutes", v)}
            disabled={saving}
          />
          <NumberField
            id="maxMarketDataAgeSeconds"
            label="Max market data age (seconds)"
            value={form.maxMarketDataAgeSeconds}
            onChange={(v) => set("maxMarketDataAgeSeconds", v)}
            disabled={saving}
          />
          <NumberField
            id="signalExpiryMinutes"
            label="Approval window (minutes)"
            hint="Outer bound on an approval. The stricter of this and the candidate expiry always wins."
            value={form.signalExpiryMinutes}
            onChange={(v) => set("signalExpiryMinutes", v)}
            disabled={saving}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cost assumptions and execution</CardTitle>
          <CardDescription>
            Fees and slippage are modeled conservatively into the estimated max loss so the number you approve
            is not optimistic.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <NumberField
            id="feeBps"
            label="Fee assumption (bps)"
            hint="Applied to both entry and exit."
            value={form.feeBps}
            onChange={(v) => set("feeBps", v)}
            disabled={saving}
            step="0.5"
          />
          <NumberField
            id="slippageBps"
            label="Slippage assumption (bps)"
            hint="Applied round-trip."
            value={form.slippageBps}
            onChange={(v) => set("slippageBps", v)}
            disabled={saving}
            step="0.5"
          />
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="executionPolicy">Execution mode</Label>
            <Select
              value={form.executionPolicy}
              onValueChange={(value) => set("executionPolicy", value as FormState["executionPolicy"])}
              disabled={saving}
            >
              <SelectTrigger id="executionPolicy" className="w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AUTO">Fully automated</SelectItem>
                <SelectItem value="APPROVAL_REQUIRED">Ask for approval</SelectItem>
              </SelectContent>
            </Select>
            {form.executionPolicy === "AUTO" ? (
              <p className="text-muted-foreground text-sm">
                Automatic mode uses the same deterministic risk and revalidation rules. It does not bypass
                trade safety checks. Automatic execution additionally requires PAPER mode and an active
                research window - it stops on its own when that window ends, and it can never apply to real
                money, which stays disabled at the database, risk-engine and UI layers alike.
              </p>
            ) : (
              <p className="text-muted-foreground text-sm">
                Qualified candidates are sent to Telegram for approval. A candidate is only ever a
                recommendation until you approve it, and approving re-runs every check against fresh market
                data before anything opens.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Separator />

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save risk settings"}
        </Button>
      </div>
    </div>
  );
}

function NumberField({
  id,
  label,
  hint,
  value,
  onChange,
  disabled,
  step,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  step?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={step ?? "1"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}
