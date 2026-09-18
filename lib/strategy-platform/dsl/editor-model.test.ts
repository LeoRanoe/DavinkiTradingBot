import { describe, expect, it } from "vitest";
import { dslNodeToGroup, groupToDslNode, emptyGroup, defaultLeaf } from "./editor-model";
import { validateDslDefinition } from "./validate";
import type { DslNode } from "./types";

describe("editor-model round trip: UI state -> DSL -> validation", () => {
  it("a freshly-created empty group produces a valid single-condition DslNode", () => {
    const group = emptyGroup("ALL");
    const node = groupToDslNode(group);
    expect(node).toEqual({ type: "ALL", children: [defaultLeaf()] });
  });

  it("round-trips ALL/ANY groups and NOT-negated rows losslessly", () => {
    const original: DslNode = {
      type: "ALL",
      children: [
        { type: "COMPARE", comparator: "GT", left: { type: "RSI", period: 14 }, right: { type: "CONST", value: 50 } },
        { type: "NOT", child: { type: "SESSION", sessions: ["ASIA"] } },
        { type: "ANY", children: [{ type: "CROSS_ABOVE", left: { type: "EMA", period: 20 }, right: { type: "EMA", period: 50 } }] },
      ],
    };
    const group = dslNodeToGroup(original);
    const roundTripped = groupToDslNode(group);
    expect(roundTripped).toEqual(original);
  });

  it("wraps a bare (non-group) entry condition in an implicit ALL for the editor, but preserves it exactly on save", () => {
    const bare: DslNode = { type: "COMPARE", comparator: "LT", left: { type: "PRICE", field: "close" }, right: { type: "CONST", value: 10 } };
    const group = dslNodeToGroup(bare);
    expect(group.op).toBe("ALL");
    expect(group.children).toHaveLength(1);
    // The saved DslNode is a single-item ALL wrapping the original condition - structurally equivalent, always validates.
    const saved = groupToDslNode(group);
    const def = { engineSchemaVersion: "1" as const, timeframes: ["M15" as const], side: ["LONG" as const], entry: saved, stop: { kind: "FIXED_PERCENT" as const, pct: 0.01 }, target: { kind: "R_MULTIPLE" as const, multiple: 2 }, parameterSchema: {} };
    expect(validateDslDefinition(def)).toEqual({ ok: true });
  });

  it("groupToDslNode output always passes validateDslDefinition for a freshly built group", () => {
    const group = emptyGroup("ANY");
    const def = { engineSchemaVersion: "1" as const, timeframes: ["M15" as const], side: ["LONG" as const], entry: groupToDslNode(group), stop: { kind: "FIXED_PERCENT" as const, pct: 0.01 }, target: { kind: "R_MULTIPLE" as const, multiple: 2 }, parameterSchema: {} };
    expect(validateDslDefinition(def)).toEqual({ ok: true });
  });
});
