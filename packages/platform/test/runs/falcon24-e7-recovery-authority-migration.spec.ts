import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010799_app_data_agent_falcon24_e7_recovery_authority.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const checksumHeader =
  /^-- falcon24_e7_recovery_authority_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(
    migration,
  )?.[1];

describe("10799 Falcon24 E7 recovery authority", () => {
  it("is a rendered, checksummed, forward-only PostgreSQL 17 migration", () => {
    expect(checksumHeader).toMatch(/^[0-9a-f]{64}$/u);
    const checksum = checksumHeader ?? "";
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(migration).toContain("20260725010798_app_data_agent_falcon24_e5_retained_authority");
    expect(migration).toContain("platform.assert_migration_checksum");
  });

  it("stages one invisible live certification candidate with immutable identity", () => {
    expect(migration).toContain("falcon24_llm_execution_certification_stage");
    expect(migration).toContain("where status='STAGED'");
    expect(migration).toContain("falcon24_llm_execution_stage_state_fence");
    expect(migration).toContain("'STAGED','PROMOTED','REJECTED'");
    expect(migration).toContain("'ModelCertificationReceipt',1");
    expect(migration).toContain("false,null,null");
    expect(migration).toContain("artifact_type='ModelCertificationReceipt' and not is_active");
    expect(migration).toContain("reject_falcon24_llm_execution_certification_stage");
    expect(migration).toContain("rejection_reason_code=command->>'reason_code'");
    expect(migration).toContain("rejection_command_hash=command->>'command_hash'");
  });

  it("validates the live DeepSeek proof and candidate entirely on the server", () => {
    expect(migration).toContain("falcon24-llm-execution-authority-proof@1.0.0");
    expect(migration).toContain("model-execution-certification@1.0.0");
    expect(migration).toContain("deepseek-v4-flash");
    expect(migration).toContain("AT_LEAST_ONCE_ONLY");
    expect(migration).toContain("lock_owned_run_fence");
    expect(migration).toContain("u2_canonical_sha256(certification#-'{receipt_ref,content_hash}')");
    expect(migration).toContain("u2_canonical_sha256(certification->'execution_profile_snapshot')");
    expect(migration).toContain("contains_potential_plaintext_secret(command)");
    expect(migration).toContain("FALCON24_RECOVERY_LLM_CATALOG_DRIFT");
  });

  it("completes the exact E6 orphan and activates E7 in one transaction", () => {
    const activationStart = migration.indexOf(
      "create function app_data_agent.activate_falcon24_authority(command jsonb)",
    );
    const activationEnd = migration.indexOf(
      "alter function app_data_agent.list_provider_execution_profiles()",
      activationStart,
    );
    const activation = migration.slice(activationStart, activationEnd);
    const orderedTokens = [
      "semantic.lock_semantic_authority_fence",
      "'falcon24-authority-activation:'",
      "'falcon24-diagnostic:'",
      "from app_data_agent.falcon24_current_authority_epoch row",
      "from semantic.semantic_active_pointer row",
      "from semantic.semantic_runtime_activation row",
      "from app_data_agent.workspace_run_defaults row",
      "from app_data_agent.workspace_run_default_revisions row",
      "from app_data_agent.falcon24_diagnostic_attempts row",
      "from app_data_agent.falcon24_llm_execution_certification_stage row",
    ];
    let previousIndex = migration.indexOf(
      "create function app_data_agent.activate_falcon24_authority(command jsonb)",
    );
    for (const token of orderedTokens) {
      const currentIndex = migration.indexOf(token, previousIndex + 1);
      expect(currentIndex, token).toBeGreaterThan(previousIndex);
      previousIndex = currentIndex;
    }
    expect(migration).toContain("FROZEN_CLOSURE_CHANGE_REQUIRED");
    expect(migration).toContain("PROVIDER_PROFILE_NOT_AVAILABLE");
    expect(migration).toContain("app_data_agent.complete_falcon24_diagnostic");
    expect(migration).toContain("app_data_agent.activate_falcon24_authority_pre_e7");
    expect(migration).toContain("falcon24-retained-activation-result@4.0.0");
    expect(activation).toContain("model_revision app_data_agent.model_config_versions%rowtype");
    expect(activation).toContain("update app_data_agent.artifacts artifact_row set is_active=true");
    expect(activation).toContain("artifact_row.revision=certification.revision");
    expect(activation).not.toContain("\n  revision app_data_agent.model_config_versions%rowtype");
  });

  it("keeps request v2/v3 behavior and binds E7 reads to the promoted stage", () => {
    expect(migration).toContain("falcon24-activation-request@4.0.0");
    expect(migration).toContain("falcon24-activation-request@3.0.0");
    expect(migration).toContain("activate_falcon24_authority_pre_e7(command)");
    expect(migration).toContain("list_provider_execution_profiles_pre_e7()");
    expect(migration).toContain("current_epoch.activation_attempt_id=stage.activation_attempt_id");
    expect(migration).toContain("stage.status='PROMOTED'");
  });

  it("does not mutate protected Falcon or semantic history during migration", () => {
    expect(migration).toContain("falcon24_10799_history_snapshot");
    expect(migration).toContain("FALCON24_E7_RECOVERY_HISTORY_DRIFT");
    expect(migration).not.toMatch(/delete from semantic\.semantic_source_release/iu);
    expect(migration).not.toMatch(/update semantic\.semantic_source_release/iu);
    expect(migration).not.toMatch(/delete from app_data_agent\.falcon24_authority_baselines/iu);
  });
});
