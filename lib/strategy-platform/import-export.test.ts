import { describe, expect, it } from "vitest";
import { assertImportTargetSlugIsSafe, exportDslDefinition, importDslDefinition } from "./import-export";
import { getStrategyTemplate } from "./templates";
import { BUILT_IN_STRATEGIES } from "./registry";

const validDefinition = getStrategyTemplate("ema-trend")!.definition;

describe("export/import round trip", () => {
  it("exports and re-imports an identical definition", () => {
    const json = exportDslDefinition(validDefinition);
    const result = importDslDefinition(json);
    expect(result).toEqual({ ok: true, definition: validDefinition });
  });
});

describe("import safety", () => {
  it("rejects invalid JSON without throwing", () => {
    expect(importDslDefinition("{not json")).toEqual({ ok: false, errors: ["invalid JSON"] });
  });

  it("rejects a payload missing the export envelope", () => {
    const result = importDslDefinition(JSON.stringify({ foo: "bar" }));
    expect(result.ok).toBe(false);
  });

  it("rejects an unsupported export schema version", () => {
    const result = importDslDefinition(JSON.stringify({ exportSchemaVersion: "999", definition: validDefinition }));
    expect(result.ok).toBe(false);
  });

  it("rejects an imported definition that fails schema/primitive/limits validation - never partially imports it", () => {
    const badDefinition = { ...validDefinition, entry: { type: "TELEPORT" } };
    const json = JSON.stringify({ exportSchemaVersion: "1", exportedAt: new Date().toISOString(), definition: badDefinition });
    const result = importDslDefinition(json);
    expect(result.ok).toBe(false);
  });

  it("rejects a definition referencing a future-looking primitive on import, same as authoring one", () => {
    const badDefinition = { ...validDefinition, entry: { type: "MSS" } };
    const json = JSON.stringify({ exportSchemaVersion: "1", exportedAt: new Date().toISOString(), definition: badDefinition });
    const result = importDslDefinition(json);
    expect(result.ok).toBe(false);
  });

  it("never executes anything from the payload - a string containing JS source is inert data, not code", () => {
    const sneaky = JSON.stringify({
      exportSchemaVersion: "1",
      exportedAt: new Date().toISOString(),
      definition: { ...validDefinition, entry: { type: "CONST", value: "require('fs').readFileSync('/etc/passwd')" } },
    });
    const result = importDslDefinition(sneaky);
    // CONST at the entry position fails the CONDITION-kind check - it is
    // parsed as an inert string value, never evaluated as code either way.
    expect(result.ok).toBe(false);
  });
});

describe("assertImportTargetSlugIsSafe", () => {
  it("refuses to let an import target a built-in slug", () => {
    const builtInSlugs = BUILT_IN_STRATEGIES.map((s) => s.metadata.slug);
    for (const slug of builtInSlugs) {
      expect(assertImportTargetSlugIsSafe(slug, builtInSlugs).ok).toBe(false);
    }
  });

  it("allows a fresh, non-built-in slug", () => {
    const builtInSlugs = BUILT_IN_STRATEGIES.map((s) => s.metadata.slug);
    expect(assertImportTargetSlugIsSafe("my-custom-strategy", builtInSlugs)).toEqual({ ok: true });
  });
});
