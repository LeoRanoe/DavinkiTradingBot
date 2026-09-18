import type { DslDefinition } from "./dsl/types";

/**
 * Starter templates for the Strategy Builder (spec Prompt 2 S23). Each is a
 * plain, valid DslDefinition - clearly labeled as a template, never a
 * built-in strategy. "Duplicate as custom strategy" (the UI action) is
 * just: take one of these (or any existing USER_DEFINED definition),
 * deep-clone it, and hand it to the normal strategy-creation flow under a
 * new name/owner - there is no separate "template engine".
 */
export type StrategyTemplate = {
  id: string;
  name: string;
  description: string;
  definition: DslDefinition;
};

export const STRATEGY_TEMPLATES: readonly StrategyTemplate[] = [
  {
    id: "ema-trend",
    name: "EMA Trend",
    description: "Enters long when the fast EMA crosses above the slow EMA, riding the trend with an ATR-based stop.",
    definition: {
      engineSchemaVersion: "1",
      timeframes: ["M15"],
      side: ["LONG"],
      entry: { type: "CROSS_ABOVE", left: { type: "EMA", period: 20 }, right: { type: "EMA", period: 50 } },
      stop: { kind: "ATR_MULTIPLE", atrPeriod: 14, multiple: 2 },
      target: { kind: "R_MULTIPLE", multiple: 2 },
      parameterSchema: {
        fastEmaPeriod: { type: "number", default: 20 },
        slowEmaPeriod: { type: "number", default: 50 },
      },
    },
  },
  {
    id: "rsi-pullback",
    name: "RSI Pullback",
    description: "Enters long on an oversold RSI reading during an established uptrend (price above its 200 SMA).",
    definition: {
      engineSchemaVersion: "1",
      timeframes: ["M15"],
      side: ["LONG"],
      entry: {
        type: "ALL",
        children: [
          { type: "COMPARE", comparator: "GT", left: { type: "PRICE", field: "close" }, right: { type: "SMA", period: 200 } },
          { type: "COMPARE", comparator: "LT", left: { type: "RSI", period: 14 }, right: { type: "CONST", value: 35 } },
        ],
      },
      stop: { kind: "BELOW_SIGNAL_LOW", bufferPct: 0.002 },
      target: { kind: "R_MULTIPLE", multiple: 1.5 },
      parameterSchema: {
        rsiPeriod: { type: "number", default: 14 },
        rsiThreshold: { type: "number", default: 35 },
      },
    },
  },
  {
    id: "breakout",
    name: "Breakout",
    description: "Enters long when price closes at a new 20-bar high (a strong close, not just an intrabar poke) with above-average volume.",
    definition: {
      engineSchemaVersion: "1",
      timeframes: ["M15"],
      side: ["LONG"],
      entry: {
        // GTE, not GT: HIGHEST(20, high)'s own window includes the current
        // bar, so a strictly-greater comparison against its own high could
        // never be true. GTE fires exactly when the close matches a fresh
        // 20-bar high (a strong close on the breakout bar itself).
        type: "ALL",
        children: [
          { type: "COMPARE", comparator: "GTE", left: { type: "PRICE", field: "close" }, right: { type: "HIGHEST", period: 20, child: { type: "PRICE", field: "high" } } },
          { type: "COMPARE", comparator: "GT", left: { type: "VOLUME" }, right: { type: "SMA", period: 20, child: { type: "VOLUME" } } },
        ],
      },
      stop: { kind: "BELOW_SWING", leftRightBars: 3, bufferPct: 0.002 },
      target: { kind: "R_MULTIPLE", multiple: 2.5 },
      parameterSchema: {
        breakoutLookback: { type: "number", default: 20 },
      },
    },
  },
];

export function getStrategyTemplate(id: string): StrategyTemplate | undefined {
  return STRATEGY_TEMPLATES.find((t) => t.id === id);
}

/** Deep-clones a definition for "duplicate as custom strategy" / "duplicate JeanFX configuration" style actions - never mutates the source. */
export function cloneDefinition<T>(definition: T): T {
  return JSON.parse(JSON.stringify(definition)) as T;
}
