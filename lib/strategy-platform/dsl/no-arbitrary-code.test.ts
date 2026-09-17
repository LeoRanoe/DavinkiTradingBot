import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Structural regression guard for DSL safety (S12 of the platform brief:
 * "No eval(). No Function(). No VM execution."). The evaluator interprets a
 * typed, registry-validated tree by direct recursion - there is no textual
 * code path here at all. This test makes that a checked invariant, not just
 * a claim in a comment: it fails the build the moment any dsl/*.ts file
 * introduces eval, the Function constructor, or Node's vm module.
 */
describe("DSL has no arbitrary code execution surface", () => {
  const dir = join(__dirname);
  const forbidden = [/\beval\s*\(/, /new\s+Function\s*\(/, /require\(\s*["']vm["']\s*\)/, /from\s+["']vm["']/, /['"]child_process['"]/];

  it("contains no eval/Function/vm/child_process usage anywhere under lib/strategy-platform/dsl", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      // Strip comments first: this file's own doc-comments describe the
      // absence of eval/Function/VM in prose, which would otherwise
      // false-positive against the very patterns below.
      const source = readFileSync(join(dir, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      for (const pattern of forbidden) {
        expect(source, `${file} matched forbidden pattern ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
