import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010784_app_data_agent_conversational_root_context.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const checksumHeader =
  /^-- conversational_root_context_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(
    migration,
  )?.[1];

describe("10784 conversational Root context authority", () => {
  it("is one rendered forward migration chained from the committed frontier", () => {
    expect(checksumHeader).toMatch(/^[0-9a-f]{64}$/u);
    const checksum = checksumHeader ?? "";
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(migration).toContain("20260725010782_app_data_agent_falcon24_analysis_publication");
    expect(migration).toContain("platform.acquire_migration_lock");
    expect(migration).toContain("platform.assert_migration_checksum");
    expect(migration).not.toMatch(/create table/iu);
  });

  it("freezes the last 63 historical refs plus the accepted current message", () => {
    expect(migration).toContain("'visible_message_refs'");
    expect(migration).toContain("limit 63");
    expect(migration).toContain("order by message.created_at desc,message.message_id desc");
    expect(migration).toContain("pg_catalog.jsonb_build_array(requested_command->>'event_id')");
    expect(migration).toContain("between 1 and 64");
  });

  it("builds ProviderTask v2 only from DB-resolved messages at the current cutoff", () => {
    expect(migration).toContain("provider-task-artifact@2.0.0");
    expect(migration).toContain("candidate.created_at,candidate.message_id");
    expect(migration).toContain("task_authority.created_at,task_authority.message_id");
    expect(migration).toContain("context_selection_hash");
    expect(migration).toContain("provider_task_document_is_valid");
    expect(migration).toContain("PROVIDER_TASK_ARTIFACT_CONFLICT");
    expect(migration).not.toContain("update app_data_agent.qa_messages");
    expect(migration).not.toContain("delete from app_data_agent.qa_messages");
  });

  it("keeps historical v1 load-only while the active commit emits v2", () => {
    const commitStart = migration.indexOf(
      "create or replace function app_data_agent.commit_provider_task_artifact",
    );
    const loadStart = migration.indexOf(
      "create or replace function app_data_agent.load_provider_task_artifact",
    );
    const activeCommit = migration.slice(commitStart, loadStart);
    const historicalLoad = migration.slice(loadStart);
    expect(activeCommit).toContain("provider-task-artifact@2.0.0");
    expect(activeCommit).not.toContain("provider-task-artifact@1.0.0");
    expect(historicalLoad).toContain("legacy_valid");
    expect(historicalLoad).toContain("v2_valid");
    expect(historicalLoad).toContain("provider-task-artifact@1.0.0");
  });

  it("keeps the validator private and exposes only narrow commit/load RPCs", () => {
    expect(migration).toContain("owner to data_agent_provider_invocation_rpc_owner");
    expect(migration).toContain(
      "revoke all on function app_data_agent.provider_task_document_is_valid",
    );
    expect(migration).toContain(
      "grant execute on function app_data_agent.commit_provider_task_artifact(jsonb,jsonb)",
    );
    expect(migration).toContain(
      "grant execute on function app_data_agent.load_provider_task_artifact(jsonb)",
    );
    expect(migration).not.toMatch(
      /grant execute on function app_data_agent\.provider_task_document_is_valid[\s\S]*to data_agent_backend/u,
    );
  });
});
