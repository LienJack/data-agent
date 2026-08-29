import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010800_app_data_agent_falcon24_e8_provider_binding.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const checksumHeader =
  /^-- falcon24_e8_provider_binding_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(
    migration,
  )?.[1];

describe("10800 Falcon24 E8 provider binding recovery", () => {
  it("is rendered, checksummed, forward-only, and based on exact 10799", () => {
    expect(checksumHeader).toMatch(/^[0-9a-f]{64}$/u);
    const checksum = checksumHeader ?? "";
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(migration).toContain("20260725010799_app_data_agent_falcon24_e7_recovery_authority");
    expect(migration).toContain("platform.assert_migration_checksum");
  });

  it("records immutable E7 closure failure from server-observed profile evidence", () => {
    expect(migration).toContain("falcon24_epoch_closure_failure_receipts");
    expect(migration).toContain("record_falcon24_epoch_closure_failure");
    expect(migration).toContain("load_falcon24_epoch_closure_failure");
    expect(migration).toContain("FROZEN_CLOSURE_CHANGE_REQUIRED");
    expect(migration).toContain("PROVIDER_PROFILE_BINDING_NOT_SELECTED");
    expect(migration).toContain("expected_readiness','AVAILABLE'");
    expect(migration).toContain("observed_readiness','STALE'");
    expect(migration).toContain("DA_FALCON24_EPOCH_CLOSURE_FAILURE_IMMUTABLE");
    expect(migration).toContain("list_provider_execution_profiles_pre_e7()");
    expect(migration).toContain("list_provider_execution_profiles_pre_e8()");
  });

  it("preserves E7 behavior and selects E8 stage with the table alias", () => {
    expect(migration).toContain("rename to list_provider_execution_profiles_pre_e8");
    expect(migration).toContain("return app_data_agent.list_provider_execution_profiles_pre_e8()");
    expect(migration).toContain("pg_catalog.substr(current_epoch.authority_epoch,2)::numeric<8");
    expect(migration).toContain("current_epoch.activation_attempt_id=row.activation_attempt_id");
    const bindingStart = migration.indexOf(
      "create function app_data_agent.list_provider_execution_profiles()",
    );
    const bindingEnd = migration.indexOf("$function$;", bindingStart);
    const binding = migration.slice(bindingStart, bindingEnd);
    expect(binding).not.toContain(
      "current_epoch.activation_attempt_id=stage.activation_attempt_id",
    );
  });

  it("atomically promotes a fresh E8 certification through request v5", () => {
    expect(migration).toContain("falcon24-activation-request@5.0.0");
    expect(migration).toContain("falcon24-retained-activation-result@5.0.0");
    expect(migration).toContain("predecessor_closure_failure_ref");
    expect(migration).toContain("llm_execution_stage_ref");
    expect(migration).toContain("activate_falcon24_authority_pre_e8");
    expect(migration).toContain("activate_falcon24_authority_pre_e7(v3_command)");
    const failureLock = migration.indexOf(
      "from app_data_agent.falcon24_epoch_closure_failure_receipts row",
    );
    const stageLock = migration.indexOf(
      "from app_data_agent.falcon24_llm_execution_certification_stage row",
      failureLock,
    );
    const promotion = migration.indexOf("status='PROMOTED',activation_attempt_id", stageLock);
    const artifact = migration.indexOf("update app_data_agent.artifacts artifact_row", promotion);
    const activation = migration.indexOf(
      "activate_falcon24_authority_pre_e7(v3_command)",
      artifact,
    );
    expect(failureLock).toBeGreaterThan(0);
    expect(stageLock).toBeGreaterThan(failureLock);
    expect(promotion).toBeGreaterThan(stageLock);
    expect(artifact).toBeGreaterThan(promotion);
    expect(activation).toBeGreaterThan(artifact);
  });
});
