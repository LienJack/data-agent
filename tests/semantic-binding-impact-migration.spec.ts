import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyMigrationInventory } from "../scripts/lib/workspace-migration-inventory.js";

const root = resolve(import.meta.dirname, "..");
const migrationRoot = resolve(root, "infra/supabase/apps/data-agent/migrations");
const sourceRoot = resolve(root, "infra/supabase/apps/data-agent/migration-sources/10706");
const migrationName = "20260725010706_app_data_agent_semantic_binding_impact.sql";
const migration = readFileSync(resolve(migrationRoot, migrationName), "utf8");

describe("10706 semantic binding-impact authority", () => {
  it("is the deterministic migration frontier", () => {
    const inventory = verifyMigrationInventory(
      readdirSync(migrationRoot)
        .filter((name) => name.endsWith(".sql"))
        .map((name) => ({ name, sql: readFileSync(resolve(migrationRoot, name), "utf8") })),
    );
    expect(inventory.violations).toEqual([]);
    expect(inventory.frontier).toBe("20260725010708");
    expect(readdirSync(sourceRoot).sort()).toEqual([
      "00-preamble.sql.inc",
      "10-authority.sql.inc",
      "20-rpcs.sql.inc",
      "90-grants-postconditions.sql.inc",
      "99-ledger.sql.inc",
    ]);
  });

  it("binds exact drift and active published release authority", () => {
    expect(migration).toContain("load_semantic_binding_impact_authority");
    expect(migration).toContain("semantic.semantic_active_pointer");
    expect(migration).toContain("semantic.initial_semantic_release_package_bindings");
    expect(migration).toContain("drift.event_storage_digest<>platform.canonical_sha256");
    expect(migration).toContain("SEMANTIC_BINDING_IMPACT_MAPPING_STALE");
  });

  it("commits immutable review-only receipts and candidates atomically", () => {
    expect(migration).toContain("semantic.create_candidate_draft");
    expect(migration).toContain("candidate->>'candidate_status'<>'DRAFT'");
    expect(migration).toContain("operation.value->>'action'<>'MARK_STALE'");
    expect(migration).toContain("operation.value#>>'{after,state}'<>'STALE'");
    expect(migration).toContain("semantic_binding_impact_receipts_immutable");
    expect(migration).toContain("SEMANTIC_BINDING_IMPACT_AUTHORITY_STALE");
    expect(migration).not.toMatch(/create function .*semantic_binding_impact.*_(?:v1|v2)\s*\(/i);
    expect(migration).not.toMatch(/backfill|copy.*semantic_binding_impact/i);
  });

  it("exposes a bounded safe projection rather than raw authority payloads", () => {
    const getBody = migration.slice(
      migration.indexOf("create function app_data_agent.get_semantic_binding_impact"),
    );
    expect(getBody).toContain("semantic-binding-impact-safe-projection@1.0.0");
    expect(getBody).not.toContain("event_payload");
    expect(getBody).not.toContain("package_json");
  });
});
