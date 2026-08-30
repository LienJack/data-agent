import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010807_app_data_agent_falcon24_four_layer_conversation_grant.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const checksumHeader =
  /^-- falcon24_four_layer_conversation_grant_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(
    migration,
  )?.[1];

describe("10807 Falcon24 four-layer conversation policy grant", () => {
  it("is checksummed and chained from exact 10806", () => {
    expect(checksumHeader).toMatch(/^[0-9a-f]{64}$/u);
    const checksum = checksumHeader ?? "";
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(migration).toContain("20260725010806_app_data_agent_falcon24_four_layer_lock_repair");
  });

  it("grants only the policy helper required by the gate owner", () => {
    expect(migration).toContain(
      "grant execute on function platform.backend_exact_principal_object_matches(uuid,uuid,text,uuid,boolean)",
    );
    expect(migration).toContain("to data_agent_u6_rpc_owner");
    expect(migration.match(/grant execute on function/gu)).toHaveLength(1);
    expect(migration).toContain("falcon24_four_layer_gate_conversation_select");
    expect(migration).toContain("FALCON24_FOUR_LAYER_CONVERSATION_GRANT_POSTCONDITION_FAILED");
  });

  it("preserves data and all existing grants", () => {
    expect(migration).toContain("falcon24_10807_history_snapshot");
    expect(migration).toContain("FALCON24_FOUR_LAYER_CONVERSATION_GRANT_HISTORY_DRIFT");
    expect(migration).toContain("data_agent_backend");
    expect(migration).toContain("data_agent_qa_directory_owner");
    expect(migration).toContain("or pg_catalog.has_function_privilege('public'");
    expect(migration).not.toMatch(/delete from app_data_agent\./iu);
    expect(migration).not.toMatch(/update app_data_agent\./iu);
    expect(migration).not.toMatch(/insert into app_data_agent\./iu);
    expect(migration).not.toMatch(/alter table app_data_agent\./iu);
  });
});
