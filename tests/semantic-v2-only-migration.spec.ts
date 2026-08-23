import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyMigrationInventory } from "../scripts/lib/workspace-migration-inventory.js";

const root = resolve(import.meta.dirname, "..");
const migrationRoot = resolve(root, "infra/supabase/apps/data-agent/migrations");
const sourceRoot = resolve(root, "infra/supabase/apps/data-agent/migration-sources/10704");
const migrationName = "20260725010704_app_data_agent_semantic_v2_only.sql";
const migration = readFileSync(resolve(migrationRoot, migrationName), "utf8");

describe("10704 Semantic V2-only retirement", () => {
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
      "10-retire-v1-authority.sql.inc",
      "20-v2-publish-rpcs.sql.inc",
      "90-postconditions.sql.inc",
      "99-ledger.sql.inc",
    ]);
  });

  it("deletes V1-only authority without copying or backfilling it", () => {
    for (const relation of [
      "semantic_legacy_compatible_mirror",
      "semantic_legacy_equivalence_receipt",
      "semantic_legacy_closure_authorization",
      "semantic_legacy_equivalence_attempt",
    ]) {
      expect(migration).toMatch(new RegExp(`drop table if exists semantic\\.${relation}`));
    }
    expect(migration).toContain(
      "drop function if exists semantic.self_review_and_publish_semantic_candidate(jsonb)",
    );
    expect(migration).toContain(
      "drop table if exists semantic.semantic_candidate_self_publish_idempotency",
    );
    expect(migration).toContain("drop role data_agent_u5_self_publish_owner");
    expect(migration).not.toMatch(/insert into semantic\.semantic_legacy_/i);
    expect(migration).not.toMatch(/backfill|migrate.*row/i);
    expect(migration).toContain("SEMANTIC_V2_ONLY_GREENFIELD_SCOPE_MISMATCH");
  });

  it("installs only the direct V2 governance publish signatures", () => {
    const publishRpcs = readFileSync(resolve(sourceRoot, "20-v2-publish-rpcs.sql.inc"), "utf8");
    const postconditions = readFileSync(resolve(sourceRoot, "90-postconditions.sql.inc"), "utf8");
    expect(postconditions).toContain(
      "semantic.prepare_publish_attempt(uuid,uuid,text,text,uuid,uuid,text,bigint,bigint,bigint,text)",
    );
    expect(postconditions).toContain(
      "semantic.commit_publish_attempt(uuid,uuid,text,text,uuid,uuid,text,uuid,text,uuid,text,jsonb)",
    );
    expect(publishRpcs).not.toMatch(/conditional_legacy_plan|committed_legacy_attempt_ref/);
  });
});
