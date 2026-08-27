import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010781_app_data_agent_falcon24_e2_authority.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const checksumHeader =
  /^-- falcon24_e2_authority_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(migration)?.[1];

describe("10781 Falcon24 E2 authority evolution", () => {
  it("is a rendered, checksummed, forward-only PostgreSQL 17 migration", () => {
    expect(checksumHeader).toMatch(/^[0-9a-f]{64}$/u);
    const checksum = checksumHeader ?? "";
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(migration).toContain("20260725010780_app_data_agent_falcon24_e1_runtime_profile");
    expect(migration).toContain("server_version_num");
    expect(migration).toContain("platform.acquire_migration_lock");
    expect(migration).toContain("platform.assert_migration_checksum");
  });

  it("renames the existing authority tables in place instead of creating E2 truth", () => {
    const expectedRenames = [
      ["falcon24_e1_staging_sessions", "falcon24_authority_staging_sessions"],
      ["falcon24_e1_staging_receipts", "falcon24_authority_staging_receipts"],
      ["falcon24_e1_activation_attempts", "falcon24_authority_activation_attempts"],
      ["falcon24_e1_ui_receipts", "falcon24_ui_receipts"],
      ["falcon24_e1_gate_attempt_history", "falcon24_gate_attempt_history"],
      ["e1_analysis_publications", "falcon24_analysis_publications"],
      ["e1_analysis_publication_artifacts", "falcon24_analysis_publication_artifacts"],
      ["e1_analysis_publication_current", "falcon24_analysis_publication_current"],
      ["e1_analysis_publication_outbox", "falcon24_analysis_publication_outbox"],
    ] as const;
    for (const [from, to] of expectedRenames) {
      expect(migration).toMatch(
        new RegExp(`alter table app_data_agent\\.${from}\\s+rename to ${to}`, "u"),
      );
    }
    expect(migration).not.toMatch(/create table app_data_agent\.[a-z0-9_]*e2[a-z0-9_]*/iu);
    expect(migration).toContain("falcon24_e1_relation_snapshot");
    expect(migration).toContain("FALCON24_E1_HISTORY_DRIFT");
  });

  it("uses canonical epochs, derived gates, and a single active baseline per epoch", () => {
    expect(migration).toContain("^E[1-9][0-9]*$");
    expect(migration).toContain("pg_catalog.substr(requested_epoch,2)::numeric");
    expect(migration).toMatch(
      /pg_catalog\.substr\(current_epoch\.authority_epoch,2\)::numeric\+1/u,
    );
    expect(migration).toContain("qualification_id=authority_epoch||'-Q1'");
    expect(migration).toContain("campaign_id=authority_epoch||'-C1'");
    expect(migration).toMatch(
      /on app_data_agent\.falcon24_authority_baselines\(app_id,tenant_id,environment,authority_epoch\)/u,
    );
    expect(migration).not.toContain("E2-Q2");
    expect(migration).not.toContain("E2-C2");
  });

  it("installs versioned generic authority RPCs and retires E1 mutation", () => {
    for (const functionName of [
      "begin_falcon24_authority_staging_session",
      "record_falcon24_authority_staging_receipt",
      "stage_falcon24_authority_baseline",
      "begin_falcon24_authority_activation_attempt",
      "hold_falcon24_authority_activation_attempt",
      "activate_falcon24_authority",
      "load_falcon24_current_authority_epoch",
      "load_falcon24_run_authority_binding",
      "commit_falcon24_ui_receipt",
      "load_falcon24_ui_receipts",
    ]) {
      expect(migration).toContain(`function app_data_agent.${functionName}`);
    }
    expect(migration).toContain("falcon24-staging-session@2.0.0");
    expect(migration).toContain("falcon24-staging-receipt@2.0.0");
    expect(migration).toContain("falcon24-authority-baseline@2.0.0");
    expect(migration).toContain("falcon24-activation-attempt@2.0.0");
    expect(migration).toContain("falcon24-authority-binding@2.0.0");
    expect(migration).toContain(
      "revoke execute on function app_data_agent.begin_falcon24_e1_staging_session",
    );
    expect(migration).toContain(
      "revoke execute on function app_data_agent.activate_falcon24_e1_authority",
    );
    expect(migration).toContain(
      "revoke execute on function app_data_agent.commit_e1_analysis_publication",
    );
  });

  it("generalizes exact runtime, UI, qualification, and campaign fences", () => {
    expect(migration).toContain("function app_data_agent.falcon24_bind_current_authority");
    expect(migration).toContain("function app_data_agent.falcon24_bind_artifact_to_run");
    expect(migration).toContain("function app_data_agent.falcon24_binding_immutable");
    expect(migration).toContain("falcon24-qa-e2e-receipt@2.0.0");
    expect(migration).toContain("falcon24-trace-ui-receipt@2.0.0");
    expect(migration).toContain("falcon24-qualification-manifest@2.0.0");
    expect(migration).toContain("falcon24-analysis-run-manifest@3.0.0");
    expect(migration).toContain("FALCON24_GATE_EPOCH_MISMATCH");
    expect(migration).toContain("falcon24_archive_historical_gate_attempt");
    expect(migration).toContain("current_epoch.authority_epoch<>winning.authority_epoch");
  });

  it("retains RLS and restricts mutation to the RPC owner", () => {
    expect(migration).toContain("force row level security");
    expect(migration).toContain("to data_agent_u6_rpc_owner");
    expect(migration).toContain("to data_agent_backend");
    expect(migration).toContain("pg_catalog.has_function_privilege('public'");
    expect(migration).toContain("pg_catalog.has_function_privilege('data_agent_backend'");
    expect(migration).toContain("pg_catalog.has_function_privilege('data_agent_u6_rpc_owner'");
  });
});
