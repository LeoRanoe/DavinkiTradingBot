import { validateDslDefinition } from "./dsl/validate";
import type { DslDefinition } from "./dsl/types";

/**
 * Safe JSON export/import for USER_DEFINED strategy DSL definitions (spec
 * Prompt 2 S22). Import never executes anything - the payload is parsed as
 * JSON (never eval'd), then run through the exact same schema + primitive
 * + limits validation a freshly-authored strategy goes through
 * (validateDslDefinition, lib/strategy-platform/dsl/validate.ts). A
 * definition that fails any of those checks is rejected, not partially
 * imported.
 */

const EXPORT_SCHEMA_VERSION = "1" as const;

export type DslExportEnvelope = {
  exportSchemaVersion: typeof EXPORT_SCHEMA_VERSION;
  exportedAt: string; // ISO
  definition: DslDefinition;
};

export function exportDslDefinition(definition: DslDefinition): string {
  const envelope: DslExportEnvelope = {
    exportSchemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    definition,
  };
  return JSON.stringify(envelope, null, 2);
}

export type ImportResult = { ok: true; definition: DslDefinition } | { ok: false; errors: string[] };

/**
 * Parses and validates an exported definition. Never returns a
 * StrategyDefinition or writes anything - the caller is responsible for
 * wrapping the result in a NEW `USER_DEFINED` strategy (never `BUILT_IN`;
 * see `assertImportTargetSlugIsSafe` below) and persisting it through the
 * normal creation path, so this function alone cannot be used to overwrite
 * anything.
 */
export function importDslDefinition(json: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, errors: ["invalid JSON"] };
  }

  if (typeof parsed !== "object" || parsed === null) return { ok: false, errors: ["payload must be a JSON object"] };
  const envelope = parsed as Partial<DslExportEnvelope>;

  if (envelope.exportSchemaVersion !== EXPORT_SCHEMA_VERSION) {
    return { ok: false, errors: [`unsupported exportSchemaVersion '${String(envelope.exportSchemaVersion)}'`] };
  }
  if (typeof envelope.definition !== "object" || envelope.definition === null) {
    return { ok: false, errors: ["missing 'definition'"] };
  }

  const validation = validateDslDefinition(envelope.definition as DslDefinition);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  return { ok: true, definition: envelope.definition as DslDefinition };
}

/**
 * A strategy slug is derived from its (owner, name) at creation time, never
 * from an imported file - but as a second line of defense, an import flow
 * must call this before reusing any slug: built-in slugs (from the
 * registry, lib/strategy-platform/registry.ts) can never be the target of
 * an import.
 */
export function assertImportTargetSlugIsSafe(targetSlug: string, builtInSlugs: readonly string[]): { ok: true } | { ok: false; reason: string } {
  if (builtInSlugs.includes(targetSlug)) {
    return { ok: false, reason: `'${targetSlug}' is a built-in strategy slug and can never be overwritten by import` };
  }
  return { ok: true };
}
