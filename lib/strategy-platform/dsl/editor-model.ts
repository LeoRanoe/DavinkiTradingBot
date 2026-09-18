import type { DslNode } from "./types";

/**
 * A friendlier tree shape for the visual rule builder UI
 * (components/strategy-builder/rule-builder.tsx) - never written to
 * storage directly. `groupToDslNode`/`dslNodeToGroup` are the only bridge
 * to the real DslNode the DSL validator/evaluator/compiler operate on, so
 * the UI can never drift from what actually gets saved: what the user sees
 * IS the DslNode, just rendered as nested boxes instead of JSON.
 */
export type ConditionLeaf = Extract<
  DslNode,
  { type: "COMPARE" | "CROSS_ABOVE" | "CROSS_BELOW" | "SESSION" | "PERCENT_CHANGE" | "BULLISH_CANDLE" | "BEARISH_CANDLE" | "CANDLE_PATTERN" | "BOS" | "LIQUIDITY_SWEEP" | "FVG" }
>;

export type ConditionRow = { kind: "row"; id: string; negate: boolean; leaf: ConditionLeaf };
export type ConditionGroup = { kind: "group"; id: string; op: "ALL" | "ANY"; children: (ConditionRow | ConditionGroup)[] };

let idCounter = 0;
export function nextEditorId(): string {
  idCounter += 1;
  return `n${idCounter}`;
}

export function defaultLeaf(): ConditionLeaf {
  return { type: "COMPARE", comparator: "GT", left: { type: "PRICE", field: "close" }, right: { type: "CONST", value: 0 } };
}

export function emptyGroup(op: "ALL" | "ANY" = "ALL"): ConditionGroup {
  return { kind: "group", id: nextEditorId(), op, children: [{ kind: "row", id: nextEditorId(), negate: false, leaf: defaultLeaf() }] };
}

export function groupToDslNode(group: ConditionGroup): DslNode {
  const children = group.children.map((c) => (c.kind === "group" ? groupToDslNode(c) : rowToDslNode(c)));
  return { type: group.op, children };
}

function rowToDslNode(row: ConditionRow): DslNode {
  return row.negate ? { type: "NOT", child: row.leaf } : row.leaf;
}

export function dslNodeToGroup(node: DslNode): ConditionGroup {
  if (node.type === "ALL" || node.type === "ANY") {
    return { kind: "group", id: nextEditorId(), op: node.type, children: node.children.map(dslNodeToChild) };
  }
  // A bare (non-group) entry condition is wrapped in an implicit ALL with one row, so the editor always has a group at the root.
  return { kind: "group", id: nextEditorId(), op: "ALL", children: [dslNodeToRow(node)] };
}

function dslNodeToChild(node: DslNode): ConditionRow | ConditionGroup {
  if (node.type === "ALL" || node.type === "ANY") return dslNodeToGroup(node);
  return dslNodeToRow(node);
}

function dslNodeToRow(node: DslNode): ConditionRow {
  if (node.type === "NOT") return { kind: "row", id: nextEditorId(), negate: true, leaf: node.child as ConditionLeaf };
  return { kind: "row", id: nextEditorId(), negate: false, leaf: node as ConditionLeaf };
}
