import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const productionRoots = [
  resolve(root, "apps"),
  resolve(root, "packages"),
  resolve(root, "scripts"),
];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json"]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = resolve(directory, entry);
    if (["dist", "node_modules", ".next"].includes(entry)) return [];
    if (entry === "migration-manifests.json") return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return sourceExtensions.has(extname(entry)) ? [path] : [];
  });
}

describe("unique semantic lifecycle runtime", () => {
  it("contains no legacy semantic context or analysis plan identifiers", () => {
    const violations = productionRoots.flatMap(sourceFiles).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return /ResolvedContext|resolved-context|resolved_context|AnalysisPlan|analysis-plan|analysis_plan/u.test(
        source,
      )
        ? [path.slice(root.length + 1)]
        : [];
    });
    expect(violations).toEqual([]);
  });

  it("exposes exactly the canonical context compiler and analysis program runtime files", () => {
    const required = [
      "packages/contracts/src/context/semantic-context-package.ts",
      "packages/semantic/src/context/semantic-context-compiler.ts",
      "packages/semantic/src/context/semantic-context-core.ts",
      "packages/semantic/src/context/semantic-context-service.ts",
      "apps/worker/src/analysis/default-program.ts",
      "apps/worker/src/analysis/program-gate.ts",
    ];
    const forbidden = [
      "packages/contracts/src/context/resolved-context-package.ts",
      "packages/semantic/src/context/resolver.ts",
      "packages/semantic/src/context/hybrid-retrieval.ts",
      "apps/worker/src/analysis/default-plan.ts",
      "apps/worker/src/analysis/plan-gate.ts",
    ];
    expect(required.filter((path) => !existsSync(resolve(root, path)))).toEqual([]);
    expect(forbidden.filter((path) => existsSync(resolve(root, path)))).toEqual([]);
  });
});
