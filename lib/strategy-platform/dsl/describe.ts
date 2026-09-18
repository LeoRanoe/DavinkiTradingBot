import type { DslDefinition, DslNode, DslStopSpec, DslTargetSpec } from "./types";

/**
 * Renders a DslNode/DslDefinition as a plain-English sentence (spec Prompt
 * 2 S26: show both "visual rules" and a "plain English summary"). Pure,
 * read-only - never used to evaluate anything, only to describe it.
 */

function describeValue(node: DslNode): string {
  switch (node.type) {
    case "PRICE":
      return node.field;
    case "VOLUME":
      return "volume";
    case "CONST":
      return String(node.value);
    case "EMA":
      return `the ${node.period}-period EMA${node.child ? ` of ${describeValue(node.child)}` : ""}`;
    case "SMA":
      return `the ${node.period}-period SMA${node.child ? ` of ${describeValue(node.child)}` : ""}`;
    case "RSI":
      return `RSI(${node.period})`;
    case "ATR":
      return `ATR(${node.period})`;
    case "HIGHEST":
      return `the highest ${describeValue(node.child)} over the last ${node.period} bars`;
    case "LOWEST":
      return `the lowest ${describeValue(node.child)} over the last ${node.period} bars`;
    case "SWING_HIGH":
      return "the most recent swing high";
    case "SWING_LOW":
      return "the most recent swing low";
    default:
      return node.type;
  }
}

const COMPARATOR_WORDS: Record<string, string> = { GT: "is above", GTE: "is at or above", LT: "is below", LTE: "is at or below", EQ: "equals" };
const CANDLE_PATTERN_WORDS: Record<string, string> = {
  BULLISH_ENGULFING: "a bullish engulfing candle forms",
  BEARISH_ENGULFING: "a bearish engulfing candle forms",
  HAMMER: "a hammer candle forms",
  SHOOTING_STAR: "a shooting star candle forms",
};

export function describeCondition(node: DslNode, indent = 0): string {
  const pad = "  ".repeat(indent);
  switch (node.type) {
    case "ALL":
      return `${pad}all of:\n${node.children.map((c) => describeCondition(c, indent + 1)).join("\n")}`;
    case "ANY":
      return `${pad}any of:\n${node.children.map((c) => describeCondition(c, indent + 1)).join("\n")}`;
    case "NOT":
      return `${pad}NOT (${describeCondition(node.child, 0).trim()})`;
    case "COMPARE":
      return `${pad}${describeValue(node.left)} ${COMPARATOR_WORDS[node.comparator] ?? node.comparator} ${describeValue(node.right)}`;
    case "CROSS_ABOVE":
      return `${pad}${describeValue(node.left)} crosses above ${describeValue(node.right)}`;
    case "CROSS_BELOW":
      return `${pad}${describeValue(node.left)} crosses below ${describeValue(node.right)}`;
    case "SESSION":
      return `${pad}it is currently the ${node.sessions.join(" or ")} session`;
    case "PERCENT_CHANGE":
      return `${pad}${node.child ? describeValue(node.child) : "price"} changed ${node.comparator === "GT" ? "more than" : "less than"} ${node.valuePct}% over the last ${node.period} bars`;
    case "BULLISH_CANDLE":
      return `${pad}the candle closed bullish (close above open)`;
    case "BEARISH_CANDLE":
      return `${pad}the candle closed bearish (close below open)`;
    case "CANDLE_PATTERN":
      return `${pad}${CANDLE_PATTERN_WORDS[node.pattern] ?? node.pattern}`;
    case "BOS":
      return `${pad}price breaks structure to the ${node.direction === "LONG" ? "upside" : "downside"}`;
    case "LIQUIDITY_SWEEP":
      return `${pad}a ${node.side === "SELL_SIDE" ? "sell-side" : "buy-side"} liquidity sweep occurs`;
    case "FVG":
      return `${pad}a ${node.direction === "LONG" ? "bullish" : "bearish"} fair value gap forms`;
    default:
      return `${pad}${node.type}`;
  }
}

function describeStop(spec: DslStopSpec): string {
  switch (spec.kind) {
    case "FIXED_PERCENT":
      return `${(spec.pct * 100).toFixed(2)}% from entry`;
    case "ATR_MULTIPLE":
      return `${spec.multiple}x ATR(${spec.atrPeriod}) from entry`;
    case "BELOW_SWING":
      return `below the most recent swing low, with a ${(spec.bufferPct * 100).toFixed(2)}% buffer`;
    case "ABOVE_SWING":
      return `above the most recent swing high, with a ${(spec.bufferPct * 100).toFixed(2)}% buffer`;
    case "BELOW_SIGNAL_LOW":
      return `below the signal candle's low, with a ${(spec.bufferPct * 100).toFixed(2)}% buffer`;
    case "ABOVE_SIGNAL_HIGH":
      return `above the signal candle's high, with a ${(spec.bufferPct * 100).toFixed(2)}% buffer`;
  }
}

function describeTarget(spec: DslTargetSpec): string {
  switch (spec.kind) {
    case "R_MULTIPLE":
      return `${spec.multiple}R (${spec.multiple}x the stop distance)`;
    case "FIXED_PERCENT":
      return `${(spec.pct * 100).toFixed(2)}% from entry`;
    case "NEXT_SWING":
      return "the next swing high/low in the trade's direction";
    case "NEXT_LIQUIDITY_POOL":
      return "the next unswept liquidity pool in the trade's direction";
  }
}

export function describeDslDefinition(def: DslDefinition): string {
  const sides = def.side.join(" or ");
  const timeframe = def.timeframes.join("/");
  return [
    `Trades ${sides} on the ${timeframe} chart when:`,
    describeCondition(def.entry, 1),
    `Stop: ${describeStop(def.stop)}.`,
    `Target: ${describeTarget(def.target)}.`,
  ].join("\n");
}
