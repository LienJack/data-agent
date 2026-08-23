import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyMigrationInventory } from "../scripts/lib/workspace-migration-inventory.js";

const root = resolve(import.meta.dirname, "..");
const migrationRoot = resolve(root, "infra/supabase/apps/data-agent/migrations");
const sourceRoot = resolve(root, "infra/supabase/apps/data-agent/migration-sources/10705");
const migrationName = "20260725010705_app_data_agent_resolved_context_lexicon.sql";
const migration = readFileSync(resolve(migrationRoot, migrationName), "utf8");

describe("10705 current resolved-context lexical authority", () => {
  it("is the deterministic migration frontier", () => {
    const inventory = verifyMigrationInventory(
      readdirSync(migrationRoot)
        .filter((name) => name.endsWith(".sql"))
        .map((name) => ({ name, sql: readFileSync(resolve(migrationRoot, name), "utf8") })),
    );
    expect(inventory.violations).toEqual([]);
    expect(inventory.frontier).toBe("20260725010706");
    expect(readdirSync(sourceRoot).sort()).toEqual([
      "00-preamble.sql.inc",
      "10-published-lexicon.sql.inc",
      "20-current-rpc-contract.sql.inc",
      "90-postconditions.sql.inc",
      "99-ledger.sql.inc",
    ]);
  });

  it("projects exact-release canonical, alias and governed glossary evidence", () => {
    expect(migration).toContain(
      "create function app_data_agent.resolved_context_published_lexicon",
    );
    expect(migration).toContain("semantic-lexical-entry@1.0.0");
    expect(migration).toContain("('PREFERRED','SYNONYM','ABBREVIATION')");
    expect(migration).not.toMatch(/'RELATED'\s*\)/);
    expect(migration).toContain("app_data_agent.u2_canonical_sha256(material.document)");
  });

  it("replaces stable RPC contracts without a V1/V2 compatibility surface", () => {
    expect(migration).toContain("resolved-context-authority-snapshot@2.0.0");
    expect(migration).toContain("resolved-context-route-decision@2.0.0");
    expect(migration).toContain("resolved-context-package@2.0.0");
    expect(migration).not.toMatch(/create function .*resolved_context.*_(?:v1|v2)\s*\(/i);
    expect(migration).not.toMatch(/backfill|copy.*resolved_context/i);
  });
});
