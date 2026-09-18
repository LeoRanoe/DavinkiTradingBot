"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ValuePicker } from "./value-picker";
import type { ConditionLeaf } from "@/lib/strategy-platform/dsl/editor-model";
import type { TradingSession } from "@/lib/strategy-platform/types";

type LeafKind = ConditionLeaf["type"];

const LEAF_LABELS: Record<LeafKind, string> = {
  COMPARE: "Compare two values",
  CROSS_ABOVE: "Crosses above",
  CROSS_BELOW: "Crosses below",
  SESSION: "Trading session",
  PERCENT_CHANGE: "Percent change",
  BULLISH_CANDLE: "Bullish candle",
  BEARISH_CANDLE: "Bearish candle",
  CANDLE_PATTERN: "Candle pattern",
  BOS: "Break of structure (BOS)",
  LIQUIDITY_SWEEP: "Liquidity sweep",
  FVG: "Fair value gap (FVG)",
};

function defaultForKind(kind: LeafKind): ConditionLeaf {
  switch (kind) {
    case "COMPARE":
      return { type: "COMPARE", comparator: "GT", left: { type: "PRICE", field: "close" }, right: { type: "CONST", value: 0 } };
    case "CROSS_ABOVE":
      return { type: "CROSS_ABOVE", left: { type: "EMA", period: 20 }, right: { type: "EMA", period: 50 } };
    case "CROSS_BELOW":
      return { type: "CROSS_BELOW", left: { type: "EMA", period: 20 }, right: { type: "EMA", period: 50 } };
    case "SESSION":
      return { type: "SESSION", sessions: ["LONDON"] };
    case "PERCENT_CHANGE":
      return { type: "PERCENT_CHANGE", period: 10, comparator: "GT", valuePct: 2 };
    case "BULLISH_CANDLE":
      return { type: "BULLISH_CANDLE" };
    case "BEARISH_CANDLE":
      return { type: "BEARISH_CANDLE" };
    case "CANDLE_PATTERN":
      return { type: "CANDLE_PATTERN", pattern: "BULLISH_ENGULFING" };
    case "BOS":
      return { type: "BOS", direction: "LONG", leftRightBars: 2 };
    case "LIQUIDITY_SWEEP":
      return { type: "LIQUIDITY_SWEEP", side: "SELL_SIDE", leftRightBars: 2, equalHighLowAtrMultiple: 0.1, atrPeriod: 14 };
    case "FVG":
      return { type: "FVG", direction: "LONG" };
  }
}

const COMPARATORS = [
  { value: "GT", label: "is above" },
  { value: "GTE", label: "is at or above" },
  { value: "LT", label: "is below" },
  { value: "LTE", label: "is at or below" },
  { value: "EQ", label: "equals" },
] as const;

const ALL_SESSIONS: TradingSession[] = ["ASIA", "LONDON", "NEW_YORK"];

export function LeafConditionEditor({ leaf, onChange }: { leaf: ConditionLeaf; onChange: (leaf: ConditionLeaf) => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <Select value={leaf.type} onValueChange={(kind) => onChange(defaultForKind(kind as LeafKind))}>
        <SelectTrigger className="w-full sm:w-[240px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(LEAF_LABELS) as LeafKind[]).map((k) => (
            <SelectItem key={k} value={k}>
              {LEAF_LABELS[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {leaf.type === "COMPARE" && (
        <div className="flex flex-col gap-2">
          <ValuePicker label="Left" value={leaf.left} onChange={(left) => onChange({ ...leaf, left })} />
          <Select value={leaf.comparator} onValueChange={(comparator) => onChange({ ...leaf, comparator: comparator as typeof leaf.comparator })}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMPARATORS.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ValuePicker label="Right" value={leaf.right} onChange={(right) => onChange({ ...leaf, right })} />
        </div>
      )}

      {(leaf.type === "CROSS_ABOVE" || leaf.type === "CROSS_BELOW") && (
        <div className="flex flex-col gap-2">
          <ValuePicker label="Line 1" value={leaf.left} onChange={(left) => onChange({ ...leaf, left })} />
          <ValuePicker label="Line 2" value={leaf.right} onChange={(right) => onChange({ ...leaf, right })} />
        </div>
      )}

      {leaf.type === "SESSION" && (
        <div className="flex flex-wrap gap-2">
          {ALL_SESSIONS.map((s) => (
            <label key={s} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={leaf.sessions.includes(s)}
                onChange={(e) => {
                  const sessions = e.target.checked ? [...leaf.sessions, s] : leaf.sessions.filter((x) => x !== s);
                  onChange({ ...leaf, sessions: sessions.length ? sessions : [s] });
                }}
              />
              {s}
            </label>
          ))}
        </div>
      )}

      {leaf.type === "PERCENT_CHANGE" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs">Over</span>
          <Input type="number" className="w-[80px]" min={1} value={leaf.period} onChange={(e) => onChange({ ...leaf, period: Number(e.target.value) })} />
          <span className="text-muted-foreground text-xs">bars, change is</span>
          <Select value={leaf.comparator} onValueChange={(c) => onChange({ ...leaf, comparator: c as "GT" | "LT" })}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="GT">more than</SelectItem>
              <SelectItem value="LT">less than</SelectItem>
            </SelectContent>
          </Select>
          <Input type="number" className="w-[90px]" value={leaf.valuePct} onChange={(e) => onChange({ ...leaf, valuePct: Number(e.target.value) })} />
          <span className="text-muted-foreground text-xs">%</span>
        </div>
      )}

      {leaf.type === "CANDLE_PATTERN" && (
        <Select value={leaf.pattern} onValueChange={(pattern) => onChange({ ...leaf, pattern: pattern as typeof leaf.pattern })}>
          <SelectTrigger className="w-full sm:w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="BULLISH_ENGULFING">Bullish engulfing</SelectItem>
            <SelectItem value="BEARISH_ENGULFING">Bearish engulfing</SelectItem>
            <SelectItem value="HAMMER">Hammer</SelectItem>
            <SelectItem value="SHOOTING_STAR">Shooting star</SelectItem>
          </SelectContent>
        </Select>
      )}

      {leaf.type === "BOS" && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={leaf.direction} onValueChange={(d) => onChange({ ...leaf, direction: d as "LONG" | "SHORT" })}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="LONG">to the upside</SelectItem>
              <SelectItem value="SHORT">to the downside</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-muted-foreground text-xs">swing lookback</span>
          <Input type="number" className="w-[80px]" min={1} value={leaf.leftRightBars} onChange={(e) => onChange({ ...leaf, leftRightBars: Number(e.target.value) })} />
        </div>
      )}

      {leaf.type === "LIQUIDITY_SWEEP" && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={leaf.side} onValueChange={(side) => onChange({ ...leaf, side: side as "BUY_SIDE" | "SELL_SIDE" })}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="SELL_SIDE">sell-side (below)</SelectItem>
              <SelectItem value="BUY_SIDE">buy-side (above)</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-muted-foreground text-xs">swing lookback</span>
          <Input type="number" className="w-[80px]" min={1} value={leaf.leftRightBars} onChange={(e) => onChange({ ...leaf, leftRightBars: Number(e.target.value) })} />
        </div>
      )}

      {leaf.type === "FVG" && (
        <Select value={leaf.direction} onValueChange={(d) => onChange({ ...leaf, direction: d as "LONG" | "SHORT" })}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="LONG">Bullish FVG</SelectItem>
            <SelectItem value="SHORT">Bearish FVG</SelectItem>
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
