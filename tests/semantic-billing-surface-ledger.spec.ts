import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findUntrackedAppSemanticSchemaCopies,
  findUntrackedCompatibilitySurfaces,
  findUntrackedRetirementExports,
  parseRetirementSurfaceLedger,
  type RetirementSource,
  validateRetirementSurfaceLedger,
} from "../scripts/lib/retirement-surface-ledger.js";

const repoRoot = resolve(import.meta.dirname, "..");
const ledgerSource = readFileSync(
  resolve(repoRoot, "docs/architecture/retirement-surface-ledger.json"),
  "utf8",
);
const ledger = parseRetirementSurfaceLedger(ledgerSource);

function productionSources(directory: string): RetirementSource[] {
  const sources: RetirementSource[] = [];
  for (const name of readdirSync(directory)) {
    if (["dist", "node_modules", ".next", "test", "tests", "fixtures"].includes(name)) continue;
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) {
      sources.push(...productionSources(path));
      continue;
    }
    if (!/\.(?:c|m)?(?:j|t)sx?$/.test(name) || /\.(?:spec|test)\.[jt]sx?$/.test(name)) continue;
    sources.push({
      path: relative(repoRoot, path),
      source: readFileSync(path, "utf8"),
    });
  }
  return sources;
}

describe("repository retirement surface ledger", () => {
  it("strictly parses the authority and covers critical compatibility classes", () => {
    expect(
      validateRetirementSurfaceLedger(ledger, [
        "apps/web/src/lib/root-env.ts#env:DeepSeekAPIKey",
        "packages/agent-runtime/src/mastra/model-provider-adapter.ts#LEGACY_TEST_ONLY",
        "tests/fixtures/text2sql/legacy-characterization",
        "migration-history#duplicate-sequences-10673-10679",
        "migration-history#missing-checksum-headers",
        "migration-history#unverifiable-checksum-placeholders",
        "Relationship Index PostgreSQL fallback",
        "Server-configured direct Model Provider gateway",
      ]),
    ).toEqual([]);

    const authority = JSON.parse(ledgerSource) as { entries: unknown[] };
    expect(() =>
      parseRetirementSurfaceLedger(
        JSON.stringify({
          ...authority,
          entries: [{ ...(authority.entries[0] as object), surprise: true }],
        }),
      ),
    ).toThrow();
    expect(() =>
      parseRetirementSurfaceLedger(
        JSON.stringify({
          ...authority,
          entries: [{ ...(authority.entries[0] as object), disposition: "SOMEDAY" }],
        }),
      ),
    ).toThrow();
    const firstEntry = ledger[0];
    if (!firstEntry) throw new Error("retirement ledger must not be empty");
    expect(validateRetirementSurfaceLedger([firstEntry, firstEntry], [])).toContain(
      `duplicate surface: ${firstEntry.surface}`,
    );
  });

  it("rejects unregistered production compatibility markers", () => {
    const sources = ["apps", "packages", "scripts", "services"]
      .map((path) => resolve(repoRoot, path))
      .filter((path) => {
        try {
          return statSync(path).isDirectory();
        } catch {
          return false;
        }
      })
      .flatMap(productionSources);

    expect(findUntrackedCompatibilitySurfaces(sources, ledger)).toEqual([]);
    expect(
      findUntrackedCompatibilitySurfaces(
        [
          {
            path: "packages/example/src/index.ts",
            source: "/** @deprecated Compatibility alias. */ export const legacyAlias = current;",
          },
        ],
        ledger,
      ),
    ).toEqual(["packages/example/src/index.ts#legacyAlias"]);
  });

  it("rejects a newly exported compatibility module unless it is inventoried", () => {
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

  it("distinguishes characterized reliability fallbacks from migration debt", () => {
    const fake = ledger.map((entry) =>
      entry.surface === "Relationship Index PostgreSQL fallback"
        ? { ...entry, disposition: "MIGRATE_THEN_DELETE" as const, deadline: "2026-09-30" }
        : entry,
    );
    expect(validateRetirementSurfaceLedger(fake, [])).toContain(
      "reliability fallback needs explicit retention: Relationship Index PostgreSQL fallback",
    );
    expect(validateRetirementSurfaceLedger(ledger, [])).toEqual([]);
  });

  it("rejects new App-owned public Semantic schema copies", () => {
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
