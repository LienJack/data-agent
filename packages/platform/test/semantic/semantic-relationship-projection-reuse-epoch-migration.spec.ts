import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010742_app_data_agent_semantic_relationship_projection_reuse_epoch.sql",
);
const migration = readFileSync(migrationPath, "utf8");
const checksum = "4192e58930b741d318b5246c63ff779927ef789830ccf19344e6b58161ea6c66";

describe("10742 semantic relationship projection reuse across release epochs", () => {
  it("is a checksummed forward migration after the current migration frontier", () => {
    const zeroed = migration.replaceAll(checksum, "0".repeat(64));
    expect(migration.split(checksum)).toHaveLength(3);
    expect(createHash("sha256").update(zeroed).digest("hex")).toBe(checksum);
    expect(migration).toContain("20260725010741_app_data_agent_analysis_python_hash_grant");
  });

  it("reuses equal relationship content without treating a new catalog epoch as a digest collision", () => {
    expect(migration).toContain("existing_record.projection_payload<>new.projection_payload");
    expect(migration).toContain("existing_record.datasource_id<>new.datasource_id");
    expect(migration).not.toContain("or existing_record.catalog_epoch<>new.catalog_epoch");
    expect(migration).toContain("return null");
  });

  it("preserves the collision and privilege fail-closed boundaries", () => {
    expect(migration).toContain("SEMANTIC_RELATIONSHIP_PROJECTION_DIGEST_COLLISION");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path='' ".trim());
    expect(migration).toContain("revoke all on function");
  });
});
