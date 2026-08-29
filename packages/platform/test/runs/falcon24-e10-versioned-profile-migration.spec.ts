import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010802_app_data_agent_falcon24_e10_versioned_profile_authority.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const checksumHeader =
  /^-- falcon24_e10_versioned_profile_authority_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(
    migration,
  )?.[1];

describe("10802 Falcon24 E10 versioned current profile authority", () => {
  it("is rendered, checksummed, forward-only, and based on exact 10801", () => {
    expect(checksumHeader).toMatch(/^[0-9a-f]{64}$/u);
    const checksum = checksumHeader ?? "";
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(migration).toContain(
      "20260725010801_app_data_agent_falcon24_e9_current_profile_authority",
    );
    expect(migration).toContain("platform.assert_migration_checksum");
  });

  it("records the E9 failure only after the server observes exact 42702", () => {
    expect(migration).toContain("falcon24_finalization_failure_receipts");
    expect(migration).toContain("record_falcon24_finalization_failure");
    expect(migration).toContain("exception when ambiguous_column");
    expect(migration).toContain("observed_sqlstate:=sqlstate");
    expect(migration).toContain("observed_sqlstate is distinct from '42702'");
    expect(migration).toContain("CURRENT_PROVIDER_CERTIFICATION_RESOLVER_AMBIGUOUS");
    expect(migration).toContain("falcon24_finalization_failure_immutable");
  });

  it("leaves v1 frozen and fences the corrected v2 resolver to E10", () => {
    expect(migration).not.toContain(
      "create or replace function app_data_agent.resolve_current_provider_execution_certification",
    );
    expect(migration).toContain("resolve_current_provider_execution_certification_v2");
    expect(migration).toContain("current-provider-execution-certification-resolve@2.0.0");
    expect(migration).toContain("current-provider-execution-certification@2.0.0");
    expect(migration).toContain(
      "pg_catalog.substr(current_epoch_row.authority_epoch,2)::numeric<10",
    );
    expect(migration).toContain(
      "stage_source.activation_attempt_id=current_epoch_row.activation_attempt_id",
    );
    expect(migration).not.toContain("stage_source.app_id=stage_source.app_id");
  });

  it("activates E10 from the immutable finalization failure and a fresh stage", () => {
    expect(migration).toContain("falcon24-activation-request@7.0.0");
    expect(migration).toContain("falcon24-retained-activation-result@7.0.0");
    expect(migration).toContain("predecessor_finalization_failure_receipt");
    expect(migration).toContain("activate_falcon24_authority_pre_e10(v3_command)");
    const current = migration.indexOf(
      "from app_data_agent.falcon24_current_authority_epoch current_source",
    );
    const failure = migration.indexOf(
      "from app_data_agent.falcon24_finalization_failure_receipts failure_source",
      current,
    );
    const stage = migration.indexOf(
      "from app_data_agent.falcon24_llm_execution_certification_stage stage_source",
      failure,
    );
    const promotion = migration.indexOf("status='PROMOTED',activation_attempt_id", stage);
    const activation = migration.indexOf(
      "activate_falcon24_authority_pre_e10(v3_command)",
      promotion,
    );
    expect(current).toBeGreaterThan(0);
    expect(failure).toBeGreaterThan(current);
    expect(stage).toBeGreaterThan(failure);
    expect(promotion).toBeGreaterThan(stage);
    expect(activation).toBeGreaterThan(promotion);
  });

  it("keeps all pre-10802 protected rows byte-identical on install", () => {
    expect(migration).toContain("falcon24_10802_history_snapshot");
    expect(migration).toContain("FALCON24_E10_VERSIONED_RESOLVER_HISTORY_DRIFT");
    expect(migration).not.toMatch(/delete from app_data_agent\.falcon24_/iu);
    expect(migration).not.toMatch(/update semantic\.semantic_source_release/iu);
  });
});
