import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findUntrackedAppSemanticSchemaCopies,
  findUntrackedRetirementExports,
  parseRetirementSurfaceLedger,
  validateRetirementSurfaceLedger,
} from "../scripts/lib/retirement-surface-ledger.js";

const repoRoot = resolve(import.meta.dirname, "..");
const ledger = parseRetirementSurfaceLedger(
  readFileSync(resolve(repoRoot, "docs/architecture/semantic-billing-surface-ledger.md"), "utf8"),
);

describe("Semantic and Billing retirement surface ledger", () => {
  it("covers every critical cutover surface with an executable final disposition", () => {
    expect(
      validateRetirementSurfaceLedger(ledger, [
        "./billing/billing-gated-model-provider.js",
        "./pricing/postgres-pricing-control.js",
        "packages/contracts/src/artifacts/semantic-control-plane.ts",
        "packages/semantic/src/compiler/u5-compiler.ts",
        "apps/web/src/lib/semantic-authoring-public.ts",
        "/semantic and /data-link",
        "/w/[workspaceId]/semantic",
        "Billing ledger and settlement tables",
        "Semantic V1 database objects and rows",
        "Relationship Index PostgreSQL fallback",
        "Server-configured direct Model Provider gateway",
      ]),
    ).toEqual([]);
  });

  it("rejects a newly exported billing or compatibility module unless it is inventoried", () => {
    const platformIndex = readFileSync(resolve(repoRoot, "packages/platform/src/index.ts"), "utf8");
    const contractsWorkspaceIndex = readFileSync(
      resolve(repoRoot, "packages/contracts/src/workspaces/index.ts"),
      "utf8",
    );

    expect(findUntrackedRetirementExports(platformIndex, ledger)).toEqual([]);
    expect(findUntrackedRetirementExports(contractsWorkspaceIndex, ledger)).toEqual([]);
    expect(
      findUntrackedRetirementExports('export * from "./billing/compat-v1.js";', ledger),
    ).toEqual(["./billing/compat-v1.js"]);
  });

  it("rejects compatibility transition plans but permits characterized reliability fallback", () => {
    const fake = ledger.map((entry) =>
      entry.surface === "Monetary provider admission and UNBILLABLE"
        ? { ...entry, finalTarget: "redirect through compatibility adapter" }
        : entry,
    );

    expect(validateRetirementSurfaceLedger(fake, [])).toContain(
      "compatibility transition is forbidden: Monetary provider admission and UNBILLABLE",
    );
    expect(validateRetirementSurfaceLedger(ledger, [])).toEqual([]);
  });

  it("rejects new App-owned public Semantic schema copies", () => {
    const trackedPath = "apps/web/src/lib/semantic-authoring-public.ts";
    const trackedSource = readFileSync(resolve(repoRoot, trackedPath), "utf8");

    expect(
      findUntrackedAppSemanticSchemaCopies([{ path: trackedPath, source: trackedSource }], ledger),
    ).toEqual([]);
    expect(
      findUntrackedAppSemanticSchemaCopies(
        [
          {
            path: "apps/web/src/lib/new-semantic-copy.ts",
            source:
              'import { z } from "zod"; export const semanticCopiedSchema = z.strictObject({});',
          },
        ],
        ledger,
      ),
    ).toEqual(["apps/web/src/lib/new-semantic-copy.ts"]);
  });
});
