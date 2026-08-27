import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010782_app_data_agent_falcon24_analysis_publication.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const checksumHeader =
  /^-- falcon24_analysis_publication_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(
    migration,
  )?.[1];

describe("10782 Falcon24 analysis publication authority", () => {
  it("is rendered, checksummed, and chained after the E2 authority migration", () => {
    expect(checksumHeader).toMatch(/^[0-9a-f]{64}$/u);
    const checksum = checksumHeader ?? "";
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(migration).toContain("20260725010781_app_data_agent_falcon24_e2_authority");
    expect(migration).toContain("server_version_num");
    expect(migration).toContain("platform.acquire_migration_lock");
    expect(migration).toContain("platform.assert_migration_checksum");
  });

  it("installs a generic v2 command and retires the E1 publication mutation", () => {
    expect(migration).toContain("commit_falcon24_analysis_publication(jsonb)");
    expect(migration).toContain("falcon24-analysis-publication@2.0.0");
    expect(migration).toContain("falcon24-analysis-publication-receipt@2.0.0");
    expect(migration).toContain("falcon24-authority-binding@2.0.0");
    expect(migration).toContain(
      "revoke execute on function app_data_agent.commit_e1_analysis_publication(jsonb)",
    );
    expect(migration).toContain("to data_agent_backend");
  });

  it("compares command, Run, and current authority before lifecycle writes", () => {
    expect(migration).toContain("FALCON24_ANALYSIS_PUBLICATION_AUTHORITY_MISMATCH");
    expect(migration).toContain("requested_authority_json->>'authority_epoch'");
    expect(migration).toContain("run.authority_epoch as run_authority_epoch");
    expect(migration).toContain("current_epoch.authority_epoch as current_authority_epoch");
    expect(migration).toContain("for share of run,current_epoch");
    expect(migration.indexOf("FALCON24_ANALYSIS_PUBLICATION_AUTHORITY_MISMATCH")).toBeLessThan(
      migration.lastIndexOf("assert_analysis_lifecycle_fence(envelope_json,command_json)"),
    );
  });

  it("rewrites the in-place publication tables without creating E2 truth", () => {
    for (const tableName of [
      "falcon24_analysis_publications",
      "falcon24_analysis_publication_artifacts",
      "falcon24_analysis_publication_current",
      "falcon24_analysis_publication_outbox",
    ]) {
      expect(migration).toContain(tableName);
    }
    expect(migration).not.toMatch(/create table app_data_agent\.[a-z0-9_]*e2[a-z0-9_]*/iu);
  });
});
