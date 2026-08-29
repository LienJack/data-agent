import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010801_app_data_agent_falcon24_e9_current_profile_authority.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const checksumHeader =
  /^-- falcon24_e9_current_profile_authority_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(
    migration,
  )?.[1];

describe("10801 Falcon24 E9 current profile authority", () => {
  it("is rendered, checksummed, forward-only, and based on exact 10800", () => {
    expect(checksumHeader).toMatch(/^[0-9a-f]{64}$/u);
    const checksum = checksumHeader ?? "";
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(migration).toContain("20260725010800_app_data_agent_falcon24_e8_provider_binding");
    expect(migration).toContain("platform.assert_migration_checksum");
  });

  it("resolves claims only through the exact current promoted stage", () => {
    expect(migration).toContain("resolve_current_provider_execution_certification");
    expect(migration).toContain("current-provider-execution-certification-resolve@1.0.0");
    expect(migration).toContain("current-provider-execution-certification@1.0.0");
    expect(migration).toContain("stage.target_authority_epoch=current_epoch.authority_epoch");
    expect(migration).toContain("stage.activation_attempt_id=current_epoch.activation_attempt_id");
    expect(migration).toContain("stage.status='PROMOTED'");
    expect(migration).toContain("artifact.content_hash=stage.certification_content_hash");
    expect(migration).toContain("artifact.is_active");
    expect(migration).toContain(
      "u2_canonical_sha256(artifact.document_json#-'{receipt_ref,content_hash}')",
    );
    expect(migration).toContain(
      "u2_canonical_sha256(artifact.document_json->'execution_profile_snapshot')",
    );
    expect(migration).not.toContain("update app_data_agent.runs set authority_epoch");
  });

  it("activates a fresh successor from an immutable terminal diagnostic receipt", () => {
    expect(migration).toContain("falcon24-activation-request@6.0.0");
    expect(migration).toContain("falcon24-retained-activation-result@6.0.0");
    expect(migration).toContain("predecessor_diagnostic_receipt");
    expect(migration).toContain("activate_falcon24_authority_pre_e9");
    expect(migration).toContain("activate_falcon24_authority_pre_e9(v3_command)");
    const current = migration.indexOf("from app_data_agent.falcon24_current_authority_epoch row");
    const diagnostic = migration.indexOf(
      "from app_data_agent.falcon24_diagnostic_attempts row",
      current,
    );
    const receipt = migration.indexOf(
      "from app_data_agent.falcon24_diagnostic_receipts row",
      diagnostic,
    );
    const stage = migration.indexOf(
      "from app_data_agent.falcon24_llm_execution_certification_stage row",
      receipt,
    );
    const promotion = migration.indexOf("status='PROMOTED',activation_attempt_id", stage);
    const activation = migration.indexOf(
      "activate_falcon24_authority_pre_e9(v3_command)",
      promotion,
    );
    expect(current).toBeGreaterThan(0);
    expect(diagnostic).toBeGreaterThan(current);
    expect(receipt).toBeGreaterThan(diagnostic);
    expect(stage).toBeGreaterThan(receipt);
    expect(promotion).toBeGreaterThan(stage);
    expect(activation).toBeGreaterThan(promotion);
  });

  it("keeps protected semantic, Falcon, Run and Artifact rows byte-identical on install", () => {
    expect(migration).toContain("falcon24_10801_history_snapshot");
    expect(migration).toContain("FALCON24_E9_CURRENT_PROFILE_HISTORY_DRIFT");
    expect(migration).not.toMatch(/delete from app_data_agent\.falcon24_/iu);
    expect(migration).not.toMatch(/update semantic\.semantic_source_release/iu);
  });
});
