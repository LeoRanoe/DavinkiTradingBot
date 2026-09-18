"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type { Direction } from "@/lib/strategy-platform/types";
import type { DslStopSpec, DslTargetSpec } from "@/lib/strategy-platform/dsl/types";

const STOP_KINDS_BY_SIDE: Record<Direction, { value: DslStopSpec["kind"]; label: string }[]> = {
  LONG: [
    { value: "FIXED_PERCENT", label: "Fixed % below entry" },
    { value: "ATR_MULTIPLE", label: "ATR multiple below entry" },
    { value: "BELOW_SWING", label: "Below the most recent swing low" },
    { value: "BELOW_SIGNAL_LOW", label: "Below the signal candle's low" },
  ],
  SHORT: [
    { value: "FIXED_PERCENT", label: "Fixed % above entry" },
    { value: "ATR_MULTIPLE", label: "ATR multiple above entry" },
    { value: "ABOVE_SWING", label: "Above the most recent swing high" },
    { value: "ABOVE_SIGNAL_HIGH", label: "Above the signal candle's high" },
  ],
};

function defaultStopForKind(kind: DslStopSpec["kind"]): DslStopSpec {
  switch (kind) {
    case "FIXED_PERCENT":
      return { kind: "FIXED_PERCENT", pct: 0.01 };
    case "ATR_MULTIPLE":
      return { kind: "ATR_MULTIPLE", atrPeriod: 14, multiple: 1.5 };
    case "BELOW_SWING":
      return { kind: "BELOW_SWING", leftRightBars: 2, bufferPct: 0.002 };
    case "ABOVE_SWING":
      return { kind: "ABOVE_SWING", leftRightBars: 2, bufferPct: 0.002 };
    case "BELOW_SIGNAL_LOW":
      return { kind: "BELOW_SIGNAL_LOW", bufferPct: 0.002 };
    case "ABOVE_SIGNAL_HIGH":
      return { kind: "ABOVE_SIGNAL_HIGH", bufferPct: 0.002 };
  }
}

export function StopEditor({ stop, side, onChange }: { stop: DslStopSpec; side: Direction; onChange: (s: DslStopSpec) => void }) {
  const options = STOP_KINDS_BY_SIDE[side];
  const current = options.some((o) => o.value === stop.kind) ? stop.kind : options[0].value;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={current} onValueChange={(kind) => onChange(defaultStopForKind(kind as DslStopSpec["kind"]))}>
        <SelectTrigger className="w-full sm:w-[280px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {stop.kind === "FIXED_PERCENT" && (
        <>
          <Input type="number" step="0.1" className="w-[100px]" value={stop.pct * 100} onChange={(e) => onChange({ kind: "FIXED_PERCENT", pct: Number(e.target.value) / 100 })} />
          <span className="text-muted-foreground text-xs">%</span>
        </>
      )}
      {stop.kind === "ATR_MULTIPLE" && (
        <>
          <Input type="number" step="0.1" className="w-[90px]" value={stop.multiple} onChange={(e) => onChange({ ...stop, multiple: Number(e.target.value) })} />
          <span className="text-muted-foreground text-xs">x ATR(</span>
          <Input type="number" className="w-[70px]" value={stop.atrPeriod} onChange={(e) => onChange({ ...stop, atrPeriod: Number(e.target.value) })} />
          <span className="text-muted-foreground text-xs">)</span>
        </>
      )}
      {(stop.kind === "BELOW_SIGNAL_LOW" || stop.kind === "ABOVE_SIGNAL_HIGH") && (
        <>
          <span className="text-muted-foreground text-xs">buffer</span>
          <Input type="number" step="0.1" className="w-[90px]" value={stop.bufferPct * 100} onChange={(e) => onChange({ ...stop, bufferPct: Number(e.target.value) / 100 })} />
          <span className="text-muted-foreground text-xs">%</span>
        </>
      )}
      {(stop.kind === "BELOW_SWING" || stop.kind === "ABOVE_SWING") && (
        <>
          <span className="text-muted-foreground text-xs">lookback</span>
          <Input type="number" className="w-[70px]" value={stop.leftRightBars} onChange={(e) => onChange({ ...stop, leftRightBars: Number(e.target.value) })} />
          <span className="text-muted-foreground text-xs">buffer</span>
          <Input type="number" step="0.1" className="w-[90px]" value={stop.bufferPct * 100} onChange={(e) => onChange({ ...stop, bufferPct: Number(e.target.value) / 100 })} />
          <span className="text-muted-foreground text-xs">%</span>
        </>
      )}
    </div>
  );
}

const TARGET_OPTIONS: { value: DslTargetSpec["kind"]; label: string }[] = [
  { value: "R_MULTIPLE", label: "R multiple (e.g. 2R, 3R)" },
  { value: "FIXED_PERCENT", label: "Fixed %" },
  { value: "NEXT_SWING", label: "Next swing high/low" },
  { value: "NEXT_LIQUIDITY_POOL", label: "Next liquidity pool" },
];

function defaultTargetForKind(kind: DslTargetSpec["kind"]): DslTargetSpec {
  switch (kind) {
    case "R_MULTIPLE":
      return { kind: "R_MULTIPLE", multiple: 2 };
    case "FIXED_PERCENT":
      return { kind: "FIXED_PERCENT", pct: 0.02 };
    case "NEXT_SWING":
      return { kind: "NEXT_SWING", leftRightBars: 2 };
    case "NEXT_LIQUIDITY_POOL":
      return { kind: "NEXT_LIQUIDITY_POOL", leftRightBars: 2, equalHighLowAtrMultiple: 0.1, atrPeriod: 14 };
  }
}

export function TargetEditor({ target, onChange }: { target: DslTargetSpec; onChange: (t: DslTargetSpec) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={target.kind} onValueChange={(kind) => onChange(defaultTargetForKind(kind as DslTargetSpec["kind"]))}>
        <SelectTrigger className="w-full sm:w-[240px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TARGET_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {target.kind === "R_MULTIPLE" && (
        <>
          <Input type="number" step="0.5" className="w-[90px]" value={target.multiple} onChange={(e) => onChange({ kind: "R_MULTIPLE", multiple: Number(e.target.value) })} />
          <span className="text-muted-foreground text-xs">R</span>
        </>
      )}
      {target.kind === "FIXED_PERCENT" && (
        <>
          <Input type="number" step="0.1" className="w-[100px]" value={target.pct * 100} onChange={(e) => onChange({ kind: "FIXED_PERCENT", pct: Number(e.target.value) / 100 })} />
          <span className="text-muted-foreground text-xs">%</span>
        </>
      )}
      {target.kind === "NEXT_SWING" && (
        <>
          <span className="text-muted-foreground text-xs">lookback</span>
          <Input type="number" className="w-[70px]" value={target.leftRightBars} onChange={(e) => onChange({ ...target, leftRightBars: Number(e.target.value) })} />
        </>
      )}
      {target.kind === "NEXT_LIQUIDITY_POOL" && (
        <>
          <span className="text-muted-foreground text-xs">lookback</span>
          <Input type="number" className="w-[70px]" value={target.leftRightBars} onChange={(e) => onChange({ ...target, leftRightBars: Number(e.target.value) })} />
        </>
      )}
    </div>
  );
}
