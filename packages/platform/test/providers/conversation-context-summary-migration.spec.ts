import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010785_app_data_agent_conversation_context_summary.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const checksumHeader =
  /^-- conversation_context_summary_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(
    migration,
  )?.[1];

describe("10785 bounded Conversation context summary", () => {
  it("is one rendered forward migration chained after the Root context authority", () => {
    expect(checksumHeader).toMatch(/^[0-9a-f]{64}$/u);
    const checksum = checksumHeader ?? "";
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(migration).toContain("20260725010784_app_data_agent_conversational_root_context");
    expect(migration).not.toMatch(/create table/iu);
  });

  it("summarizes only the older part of the frozen 64-message window", () => {
    expect(migration).toContain(
      "order by candidate.created_at desc,candidate.message_id desc limit 64",
    );
    expect(migration).toContain("visible_start");
    expect(migration).toContain("candidate.ordinal<=bounds.total_count-15");
    expect(migration).toContain("candidate.role='user'");
    expect(migration).toContain("covered_messages");
    expect(migration).toContain("conversation-context-summary@1.0.0");
    expect(migration).toContain("ConversationContextSummary");
    expect(migration).toContain("user_confirmed_constraints','[]'::jsonb");
  });

  it("binds the task to frozen EffectiveConfig and lease refs, not a later live version", () => {
    expect(migration).toContain("effective_run_config_receipts receipt");
    expect(migration).toContain(
      "receipt.effective_config_json->'conversation_binding'=\n        requested_command->'conversation_binding'",
    );
    expect(migration).toContain(
      "(candidate.created_at,candidate.message_id)<=\n        (task_authority.created_at,task_authority.message_id)",
    );
    expect(migration).toContain(
      "selected_message_refs<>requested_lease#>'{payload,visible_message_refs}'",
    );
    expect(migration).toContain("PROVIDER_TASK_VISIBLE_REFS_MISMATCH");
    expect(migration).not.toContain(
      "conversation.resource_version=\n      (requested_command#>>'{conversation_binding,resource_version}')::bigint",
    );
  });

  it("commits summary and task atomically and preserves historical summary-free replay", () => {
    const commitStart = migration.indexOf(
      "create or replace function app_data_agent.commit_provider_task_artifact",
    );
    const loadStart = migration.indexOf(
      "create or replace function app_data_agent.load_provider_task_artifact",
    );
    const commit = migration.slice(commitStart, loadStart);
    expect(migration.trimStart()).toContain("begin;");
    expect(migration.trimEnd().endsWith("commit;")).toBe(true);
    expect(commit).toContain("'disposition','REPLAYED'");
    expect(commit).toContain("artifact_type='ProviderTaskArtifact'");
    expect(commit).toContain("'ConversationContextSummary',1,summary_hash");
    expect(commit).toContain("'ProviderTaskArtifact',1,content_hash");
    expect(commit.indexOf("'ConversationContextSummary',1,summary_hash")).toBeLessThan(
      commit.indexOf("'ProviderTaskArtifact',1,content_hash"),
    );
  });

  it("keeps the summary validator private and grants only the narrow artifact insert path", () => {
    expect(migration).toContain(
      "revoke all on function app_data_agent.conversation_context_summary_document_is_valid",
    );
    expect(migration).toContain("provider_invocation_conversation_summary_rpc_insert");
    expect(migration).toContain("artifact_type='ConversationContextSummary'");
    expect(migration).not.toMatch(
      /grant execute on function app_data_agent\.conversation_context_summary_document_is_valid[\s\S]*to data_agent_backend/u,
    );
  });
});
