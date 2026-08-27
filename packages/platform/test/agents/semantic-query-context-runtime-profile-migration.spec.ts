import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010787_app_data_agent_semantic_query_context_runtime_profile.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const checksumHeader =
  /^-- semantic_query_context_runtime_profile_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(
    migration,
  )?.[1];

describe("10787 SemanticQueryContext runtime Profile", () => {
  it("is an immutable forward revision chained after 10786", () => {
    expect(checksumHeader).toMatch(/^[0-9a-f]{64}$/u);
    const checksum = checksumHeader ?? "";
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(migration).toContain(
      "20260725010786_app_data_agent_conversation_context_summary_compatibility",
    );
  });

  it("publishes exact semantic runtime revision 4 without rewriting predecessors", () => {
    expect(migration).toContain("'semantic-management-agent',4");
    expect(migration).toContain('"expected_output_artifact_types":["SemanticQueryContext"]');
    expect(migration).toContain('"workflow_id":"team.semantic-query-context.v4"');
    expect(migration).toContain(
      "sha256:d9128bf434a39a03611583a26ba7425a3e45af4cabc9190de6135116df520873",
    );
    expect(migration).toContain("check(profile_revision between 1 and 4)");
    expect(migration).not.toMatch(/update\s+app_data_agent\.agent_profile_revisions/iu);
    expect(migration).not.toMatch(/delete\s+from\s+app_data_agent\.agent_profile_revisions/iu);
  });
});
