import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Architectural guard: NEWS IS CONTEXT, NEVER AN ENGINE.
 *
 * The Milestone 3 invariant is that news cannot create a trade, change
 * position size, move a stop or target, bypass a risk rejection, or
 * authorise execution. The strongest way to guarantee that is structural -
 * the deterministic layers simply cannot see the news module.
 *
 * This test fails if anyone ever wires the two together, which is exactly
 * the mistake that would be easy to make and hard to notice in review.
 */

const ROOT = join(process.cwd(), "lib");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
}

describe("news isolation", () => {
  it("the deterministic trading layers never import the news module", () => {
    const protectedDirs = ["risk", "strategy", "backtest", "indicators"];
    const offenders: string[] = [];

    for (const dir of protectedDirs) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        for (const specifier of importsOf(file)) {
          if (specifier.includes("news") || specifier.includes("qwen")) {
            offenders.push(`${file} -> ${specifier}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("the news module never imports the risk engine or sizing logic", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(ROOT, "news"))) {
      for (const specifier of importsOf(file)) {
        if (
          specifier.includes("lib/risk/engine") ||
          specifier.includes("lib/risk/position-sizing") ||
          specifier.includes("lib/trading/approval") ||
          specifier.includes("lib/trading/execute")
        ) {
          offenders.push(`${file} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the candidate builder - which decides eligibility - never reads news", () => {
    const decisionFiles = [
      join(ROOT, "candidates", "build-candidate.ts"),
      join(ROOT, "candidates", "from-settings.ts"),
    ];
    for (const file of decisionFiles) {
      for (const specifier of importsOf(file)) {
        expect(specifier, `${file} must not import news`).not.toContain("news");
      }
    }
  });
});
