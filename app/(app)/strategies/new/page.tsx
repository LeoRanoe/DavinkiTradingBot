"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { RuleGroupEditor } from "@/components/strategy-builder/rule-group-editor";
import { StopEditor, TargetEditor } from "@/components/strategy-builder/stop-target-editor";
import { dslNodeToGroup, emptyGroup, groupToDslNode, type ConditionGroup } from "@/lib/strategy-platform/dsl/editor-model";
import { validateDslDefinition } from "@/lib/strategy-platform/dsl/validate";
import { describeDslDefinition } from "@/lib/strategy-platform/dsl/describe";
import { exportDslDefinition } from "@/lib/strategy-platform/import-export";
import { STRATEGY_TEMPLATES } from "@/lib/strategy-platform/templates";
import type { DslDefinition, DslStopSpec, DslTargetSpec } from "@/lib/strategy-platform/dsl/types";
import type { Direction, Timeframe } from "@/lib/strategy-platform/types";

const TIMEFRAMES: Timeframe[] = ["H1", "M30", "M15", "M5"];

/**
 * Strategy Builder wizard (spec Prompt 2 S8-S14, S26-S27). A single
 * scrolling flow rather than 12 separate route-per-step screens - Basics,
 * Markets & Timeframes, Entry Conditions, Stop, Target and Preview/
 * Validate/Save are each one section here; "Exit conditions" and "Risk
 * compatibility" are folded into Stop/Target and the validation panel
 * respectively, since this checkpoint's DSL has no separate exit-condition
 * node type beyond stop/target (see docs/architecture/strategy-platform.md).
 * Every field maps 1:1 onto a real DslNode via
 * lib/strategy-platform/dsl/editor-model.ts - there is no hidden state that
 * "Save" could serialize differently than what Validate/Preview show.
 */
export default function NewStrategyPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [side, setSide] = useState<Direction>("LONG");
  const [timeframe, setTimeframe] = useState<Timeframe>("M15");
  const [entryGroup, setEntryGroup] = useState<ConditionGroup>(() => emptyGroup("ALL"));
  const [stop, setStop] = useState<DslStopSpec>({ kind: "FIXED_PERCENT", pct: 0.01 });
  const [target, setTarget] = useState<DslTargetSpec>({ kind: "R_MULTIPLE", multiple: 2 });
  const [saving, setSaving] = useState(false);

  const definition: DslDefinition = useMemo(
    () => ({
      engineSchemaVersion: "1",
      timeframes: [timeframe],
      side: [side],
      entry: groupToDslNode(entryGroup),
      stop,
      target,
      parameterSchema: {},
    }),
    [entryGroup, timeframe, side, stop, target],
  );

  const validation = useMemo(() => validateDslDefinition(definition), [definition]);
  const summary = useMemo(() => (validation.ok ? describeDslDefinition(definition) : null), [definition, validation.ok]);

  function applyTemplate(templateId: string) {
    const template = STRATEGY_TEMPLATES.find((t) => t.id === templateId);
    if (!template) return;
    const def = template.definition;
    setTimeframe(def.timeframes[0]);
    setSide(def.side[0]);
    setStop(def.stop);
    setTarget(def.target);
    // Re-derive editor state from the template's DslNode via the same bridge Save uses.
    setEntryGroup(dslNodeToGroup(def.entry));
    if (!name) setName(template.name);
    if (!description) setDescription(template.description);
  }

  async function handleSave(publish: boolean) {
    if (!name.trim()) {
      toast.error("Name your strategy before saving.");
      return;
    }
    if (!validation.ok) {
      toast.error("Fix the validation errors before saving.");
      return;
    }
    setSaving(true);
    try {
      const slug = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      const res = await fetch("/api/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, displayName: name.trim(), description: description.trim() || undefined, definition }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Failed to save strategy", { description: body.issues?.join("; ") });
        return;
      }
      toast.success(publish ? "Strategy version created" : "Draft saved");
      router.push(`/strategies/${slug}`);
    } catch {
      toast.error("Network error while saving.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Create Strategy</h1>
        <p className="text-muted-foreground text-sm">Build a custom strategy visually - no JSON required. New strategies always start in RESEARCH mode.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Start from a template (optional)</CardTitle>
          <CardDescription>Duplicate a starter template, then customize it below.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {STRATEGY_TEMPLATES.map((t) => (
            <Button key={t.id} type="button" variant="outline" size="sm" onClick={() => applyTemplate(t.id)}>
              {t.name}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Basics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="My EMA cross strategy" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Markets &amp; Timeframes</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          <div className="space-y-1">
            <Label>Side</Label>
            <Select value={side} onValueChange={(v) => setSide(v as Direction)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LONG">LONG</SelectItem>
                <SelectItem value="SHORT">SHORT (research only)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Timeframe</Label>
            <Select value={timeframe} onValueChange={(v) => setTimeframe(v as Timeframe)}>
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEFRAMES.map((tf) => (
                  <SelectItem key={tf} value={tf}>
                    {tf}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {side === "SHORT" && (
            <p className="text-muted-foreground w-full text-xs">
              SHORT strategies can be researched and backtested here, but never execute against this build&apos;s spot-only PAPER/LIVE venue.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">3. Entry Conditions</CardTitle>
          <CardDescription>Build visual rule groups - ALL/ANY, with optional NOT and nested groups.</CardDescription>
        </CardHeader>
        <CardContent>
          <RuleGroupEditor group={entryGroup} onChange={setEntryGroup} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">4. Stop</CardTitle>
        </CardHeader>
        <CardContent>
          <StopEditor stop={stop} side={side} onChange={setStop} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">5. Target</CardTitle>
        </CardHeader>
        <CardContent>
          <TargetEditor target={target} onChange={setTarget} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">6. Preview &amp; Validate</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Status:</span>
            {validation.ok ? <Badge>Valid</Badge> : <Badge variant="destructive">{validation.errors.length} issue(s)</Badge>}
          </div>
          {!validation.ok && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-red-600 dark:text-red-400">
              {validation.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          {summary && (
            <div className="bg-muted rounded-md p-3">
              <p className="mb-1 text-xs font-medium tracking-wide uppercase">Plain-English summary</p>
              <pre className="text-sm whitespace-pre-wrap">{summary}</pre>
            </div>
          )}
          <details className="text-xs">
            <summary className="text-muted-foreground cursor-pointer">View DSL JSON (export)</summary>
            <pre className="bg-muted mt-2 overflow-x-auto rounded-md p-3">{exportDslDefinition(definition)}</pre>
          </details>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2 pb-8">
        <Button type="button" disabled={saving} onClick={() => handleSave(false)}>
          Save Draft
        </Button>
        <Button type="button" variant="secondary" disabled={saving || !validation.ok} onClick={() => handleSave(true)}>
          Create Version
        </Button>
      </div>
    </div>
  );
}
