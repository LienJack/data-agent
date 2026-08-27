import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010788_app_data_agent_root_default_policy_compatibility.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const checksumHeader =
  /^-- root_default_policy_compatibility_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(
    migration,
  )?.[1];

describe("10788 Root default policy compatibility", () => {
  it("is an immutable forward migration chained after 10787", () => {
    expect(checksumHeader).toMatch(/^[0-9a-f]{64}$/u);
    const checksum = checksumHeader ?? "";
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(migration).toContain(
      "20260725010787_app_data_agent_semantic_query_context_runtime_profile",
    );
    expect(migration).not.toMatch(/create table|alter table/iu);
  });

  it("aligns the PostgreSQL default policy with the frozen lease contract", () => {
    expect(migration).toContain(
      "'schema_version','run-execution-policy@1.0.0',\n      'acceptance_authority_kind',null",
    );
    expect(migration).toContain("'max_root_turns',4");
    expect(migration).toContain("RUN_EXECUTION_POLICY_CORRUPT");
    expect(migration).toContain("pg_catalog.pg_get_functiondef");
    expect(migration).toContain("ROOT_DEFAULT_POLICY_COMPATIBILITY_PATCH_DRIFT");
  });
});
