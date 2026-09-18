"use client";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, FolderPlus } from "lucide-react";
import { LeafConditionEditor } from "./leaf-condition-editor";
import { defaultLeaf, nextEditorId, type ConditionGroup, type ConditionRow } from "@/lib/strategy-platform/dsl/editor-model";

const MAX_DEPTH = 4; // stays comfortably under DSL_LIMITS.maxRuleDepth (6) even after ALL/ANY + NOT wrapping

export function RuleGroupEditor({ group, onChange, onRemove, depth = 0 }: { group: ConditionGroup; onChange: (group: ConditionGroup) => void; onRemove?: () => void; depth?: number }) {
  function updateChild(index: number, child: ConditionRow | ConditionGroup) {
    const children = [...group.children];
    children[index] = child;
    onChange({ ...group, children });
  }

  function removeChild(index: number) {
    const children = group.children.filter((_, i) => i !== index);
    onChange({ ...group, children: children.length ? children : [{ kind: "row", id: nextEditorId(), negate: false, leaf: defaultLeaf() }] });
  }

  function addRow() {
    onChange({ ...group, children: [...group.children, { kind: "row", id: nextEditorId(), negate: false, leaf: defaultLeaf() }] });
  }

  function addSubgroup() {
    onChange({ ...group, children: [...group.children, { kind: "group", id: nextEditorId(), op: "ALL", children: [{ kind: "row", id: nextEditorId(), negate: false, leaf: defaultLeaf() }] }] });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Match</span>
          <Select value={group.op} onValueChange={(op) => onChange({ ...group, op: op as "ALL" | "ANY" })}>
            <SelectTrigger className="w-[110px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ALL of</SelectItem>
              <SelectItem value="ANY">ANY of</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-muted-foreground text-sm">these conditions:</span>
        </div>
        {onRemove && (
          <Button type="button" variant="ghost" size="icon" onClick={onRemove} aria-label="Remove group">
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2 pl-2 sm:pl-4">
        {group.children.map((child, i) =>
          child.kind === "group" ? (
            depth < MAX_DEPTH ? (
              <RuleGroupEditor key={child.id} group={child} depth={depth + 1} onChange={(g) => updateChild(i, g)} onRemove={() => removeChild(i)} />
            ) : null
          ) : (
            <div key={child.id} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-2">
              <label className="flex items-center gap-1 pt-3 text-xs whitespace-nowrap">
                <input type="checkbox" checked={child.negate} onChange={(e) => updateChild(i, { ...child, negate: e.target.checked })} />
                NOT
              </label>
              <div className="min-w-0 flex-1">
                <LeafConditionEditor leaf={child.leaf} onChange={(leaf) => updateChild(i, { ...child, leaf })} />
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => removeChild(i)} aria-label="Remove condition">
                <Trash2 className="size-4" />
              </Button>
            </div>
          ),
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          <Plus className="size-4" /> Add condition
        </Button>
        {depth < MAX_DEPTH && (
          <Button type="button" variant="outline" size="sm" onClick={addSubgroup}>
            <FolderPlus className="size-4" /> Add nested group
          </Button>
        )}
      </div>
    </div>
  );
}
