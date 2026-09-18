"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type { DslNode } from "@/lib/strategy-platform/dsl/types";

/** VALUE-producing DslNode types the visual builder exposes. A subset of dsl/registry.ts's VALUE primitives, chosen for what a non-programmer would actually reach for. */
type ValueKind = "PRICE" | "CONST" | "EMA" | "SMA" | "RSI" | "ATR" | "VOLUME" | "HIGHEST" | "LOWEST" | "SWING_HIGH" | "SWING_LOW";

const VALUE_LABELS: Record<ValueKind, string> = {
  PRICE: "Price",
  CONST: "Fixed number",
  EMA: "EMA (moving average)",
  SMA: "SMA (moving average)",
  RSI: "RSI",
  ATR: "ATR (volatility)",
  VOLUME: "Volume",
  HIGHEST: "Highest over N bars",
  LOWEST: "Lowest over N bars",
  SWING_HIGH: "Most recent swing high",
  SWING_LOW: "Most recent swing low",
};

function defaultForKind(kind: ValueKind): DslNode {
  switch (kind) {
    case "PRICE":
      return { type: "PRICE", field: "close" };
    case "CONST":
      return { type: "CONST", value: 0 };
    case "EMA":
      return { type: "EMA", period: 20 };
    case "SMA":
      return { type: "SMA", period: 20 };
    case "RSI":
      return { type: "RSI", period: 14 };
    case "ATR":
      return { type: "ATR", period: 14 };
    case "VOLUME":
      return { type: "VOLUME" };
    case "HIGHEST":
      return { type: "HIGHEST", period: 20, child: { type: "PRICE", field: "high" } };
    case "LOWEST":
      return { type: "LOWEST", period: 20, child: { type: "PRICE", field: "low" } };
    case "SWING_HIGH":
      return { type: "SWING_HIGH", leftRightBars: 2 };
    case "SWING_LOW":
      return { type: "SWING_LOW", leftRightBars: 2 };
  }
}

export function ValuePicker({ value, onChange, label }: { value: DslNode; onChange: (node: DslNode) => void; label: string }) {
  const kind = (value.type in VALUE_LABELS ? value.type : "PRICE") as ValueKind;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground w-full text-xs sm:w-auto">{label}</span>
      <Select value={kind} onValueChange={(next) => onChange(defaultForKind(next as ValueKind))}>
        <SelectTrigger className="w-full sm:w-[200px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(VALUE_LABELS) as ValueKind[]).map((k) => (
            <SelectItem key={k} value={k}>
              {VALUE_LABELS[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {value.type === "PRICE" && (
        <Select value={value.field} onValueChange={(field) => onChange({ type: "PRICE", field: field as "open" | "high" | "low" | "close" })}>
          <SelectTrigger className="w-[110px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["open", "high", "low", "close"] as const).map((f) => (
              <SelectItem key={f} value={f}>
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {value.type === "CONST" && (
        <Input
          type="number"
          className="w-[110px]"
          value={value.value}
          onChange={(e) => onChange({ type: "CONST", value: Number(e.target.value) })}
        />
      )}

      {(value.type === "EMA" || value.type === "SMA" || value.type === "RSI" || value.type === "ATR") && (
        <Input
          type="number"
          className="w-[90px]"
          min={1}
          value={value.period}
          onChange={(e) => onChange({ ...value, period: Number(e.target.value) })}
        />
      )}

      {(value.type === "HIGHEST" || value.type === "LOWEST") && (
        <Input
          type="number"
          className="w-[90px]"
          min={1}
          value={value.period}
          onChange={(e) => onChange({ ...value, period: Number(e.target.value) })}
        />
      )}

      {(value.type === "SWING_HIGH" || value.type === "SWING_LOW") && (
        <Input
          type="number"
          className="w-[90px]"
          min={1}
          value={value.leftRightBars}
          onChange={(e) => onChange({ ...value, leftRightBars: Number(e.target.value) })}
        />
      )}
    </div>
  );
}
