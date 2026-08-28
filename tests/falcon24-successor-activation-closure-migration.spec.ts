import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const sourceDirectory = resolve(root, "infra/supabase/apps/data-agent/migration-sources/10797");
const migrationPath = resolve(
  root,
  "infra/supabase/apps/data-agent/migrations/20260725010797_app_data_agent_falcon24_successor_activation_closure.sql",
);
const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");
const migration = read(migrationPath);
const preamble = read(resolve(sourceDirectory, "00-preamble.sql.inc"));
const rpc = read(resolve(sourceDirectory, "20-combined-activation-rpc.sql.inc"));
const security = read(resolve(sourceDirectory, "80-security.sql.inc"));
const postconditions = read(resolve(sourceDirectory, "90-postconditions.sql.inc"));
const postgresAssertions = read(
  resolve(root, "infra/supabase/test-support/61-semantic-successor-e4-activation-assertions.sql"),
);
const checksum =
  /^-- falcon24_successor_activation_closure_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(
    migration,
  )?.[1] ?? "";

describe("10797 Falcon24 successor activation closure migration", () => {
  it("is rendered from exact 10796 with protected authority snapshots", () => {
    expect(checksum).toMatch(/^[0-9a-f]{64}$/u);
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(preamble).toContain(
      "20260725010796_app_data_agent_semantic_successor_smoke_revalidation",
    );
    expect(preamble).toContain(
      "sha256:4b3541be45d3e117510a497910de45f918b7a12111c338348b7bbd1de8217286",
    );
    for (const relation of [
      "semantic_successor_release_stage",
      "semantic_successor_projection_stage",
      "semantic_successor_stage_receipt",
      "falcon24_authority_staging_sessions",
      "falcon24_authority_staging_receipts",
      "falcon24_authority_baselines",
      "falcon24_authority_activation_attempts",
      "semantic_source_revision",
      "semantic_candidate",
      "semantic_candidate_revision",
      "semantic_publish_attempt",
      "semantic_review_task",
    ]) {
      expect(preamble).toContain(relation);
    }
    expect(postconditions).toContain("falcon24_10797_authority_history_snapshot");
  });

  it("separates reviewed ChangeSet and physical snapshot hash domains", () => {
    expect(rpc).toContain(
      "create or replace function app_data_agent.activate_falcon24_authority_with_semantic_successor",
    );
    expect(rpc).not.toContain("row.source_digest=stage.source_snapshot_hash");
    expect(rpc).toContain("row.source_digest=stage.change_set_hash");
    expect(rpc).toContain("row.revision_id=stage.candidate_revision_id");
    expect(rpc).toContain("row.source_revision_id=stage.source_revision_id");
    expect(rpc).toContain("row.revision_digest=stage.change_set_hash");
    expect(rpc).toContain("row.current_revision_id=stage.candidate_revision_id");
    expect(rpc).toContain("row.candidate_status='PUBLISHING'");
    expect(postgresAssertions).toContain("insert into semantic.semantic_candidate_revision");
    expect(postgresAssertions).toContain("'00000000-0000-4000-8000-00000000d832',2,");
  });

  it("preserves lock order, atomic writes, owner, and narrow ACL", () => {
    const orderedLocks = [
      "semantic.lock_semantic_authority_fence",
      "falcon24-authority-activation:",
      "from semantic.semantic_active_pointer",
      "from semantic.semantic_runtime_activation",
      "from app_data_agent.workspace_run_defaults",
      "from app_data_agent.falcon24_current_authority_epoch",
      "select * into stage from semantic.semantic_successor_release_stage",
      "select * into baseline from app_data_agent.falcon24_authority_baselines",
    ];
    let previous = -1;
    for (const marker of orderedLocks) {
      const position = rpc.indexOf(marker);
      expect(position, marker).toBeGreaterThan(previous);
      previous = position;
    }
    for (const marker of [
      "insert into semantic.semantic_source_release",
      "insert into semantic.semantic_outbox",
      "update app_data_agent.workspace_run_defaults",
      "authority_epoch='E4'",
      "status='PROMOTED'",
    ]) {
      expect(rpc).toContain(marker);
    }
    expect(security).toContain("owner to data_agent_u6_rpc_owner");
    expect(security).toContain("from public,anon,authenticated,service_role,data_agent_backend");
    expect(security).toContain("to data_agent_backend");
    expect(postconditions).toContain("pg_get_functiondef");
    expect(postconditions).toContain('search_path=""');
  });
});
