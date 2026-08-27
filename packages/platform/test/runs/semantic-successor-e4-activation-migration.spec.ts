import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010783_app_data_agent_semantic_successor_e4_activation.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const checksumHeader =
  /^-- semantic_successor_e4_activation_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(
    migration,
  )?.[1];

describe("10783 semantic successor and E4 activation authority", () => {
  it("is a rendered, checksummed, forward-only PostgreSQL 17 migration", () => {
    expect(checksumHeader).toMatch(/^[0-9a-f]{64}$/u);
    const checksum = checksumHeader ?? "";
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(migration).toContain("20260725010782_app_data_agent_falcon24_analysis_publication");
    expect(migration).toContain("server_version_num");
    expect(migration).toContain("platform.acquire_migration_lock");
    expect(migration).toContain("platform.assert_migration_checksum");
  });

  it("adds one immutable successor staging authority with exact four projection kinds", () => {
    for (const relation of [
      "semantic.semantic_successor_release_stage",
      "semantic.semantic_successor_projection_stage",
      "semantic.semantic_successor_stage_receipt",
    ]) {
      expect(migration).toContain(`create table ${relation}`);
      expect(migration).toMatch(
        new RegExp(`alter table ${relation.replace(".", "\\.")} force row level security`, "u"),
      );
    }
    for (const kind of ["EXECUTABLE", "RELATIONSHIP", "RUNTIME_RESTRICTION", "GRAPH"]) {
      expect(migration).toContain(`'${kind}'`);
    }
    expect(migration).toContain("target_generation=predecessor_generation+1");
    expect(migration).toContain("semantic_successor_one_live_generation");
    expect(migration).toContain("where status in('STAGED','SMOKE_PASSED')");
    expect(migration).toContain("SEMANTIC_SUCCESSOR_STAGE_IMMUTABLE");
    expect(migration).toContain("SEMANTIC_SUCCESSOR_RECEIPT_IMMUTABLE");
  });

  it("protects all formal generation-one release and graph bytes from update or delete", () => {
    for (const relation of [
      "semantic_source_release",
      "semantic_executable_projection",
      "semantic_relationship_projection",
      "semantic_runtime_restriction_projection",
      "semantic_graph_projection",
      "semantic_graph_node_projection",
      "semantic_graph_edge_projection",
      "semantic_source_release_graph_projection",
    ]) {
      expect(migration).toMatch(
        new RegExp(`before update or delete on semantic\\.${relation}`, "u"),
      );
    }
    expect(migration).toContain("SEMANTIC_FORMAL_HISTORY_IMMUTABLE");
    expect(migration).not.toMatch(
      /update semantic\.(semantic_source_release|semantic_executable_projection|semantic_relationship_projection|semantic_runtime_restriction_projection|semantic_graph_projection|semantic_graph_node_projection|semantic_graph_edge_projection|semantic_source_release_graph_projection)/iu,
    );
  });

  it("exposes refs-only stage load and smoke CAS functions", () => {
    for (const functionName of [
      "record_semantic_successor_stage",
      "load_semantic_successor_stage",
      "load_promoted_semantic_successor_release",
      "commit_semantic_successor_smoke",
    ]) {
      expect(migration).toContain(`function semantic.${functionName}(jsonb)`);
    }
    expect(migration).toContain("semantic-successor-stage-record@1.0.0");
    expect(migration).toContain("semantic-successor-stage-record-idempotency@1.0.0");
    expect(migration).toContain("semantic-successor-stage-load@1.0.0");
    expect(migration).toContain("semantic-successor-release-load@1.0.0");
    expect(migration).toContain("semantic-successor-smoke-commit@1.0.0");
    expect(migration).toContain("validator_identity");
    expect(migration).toContain("worker_build_identity");
    expect(migration).toContain("metric.order_revenue");
    expect(migration).toContain("dimension.order_month");
    expect(migration).toContain("Asia/Shanghai");
    expect(migration).toContain("SEMANTIC_SUCCESSOR_IDEMPOTENCY_CONFLICT");
    expect(migration).toContain("SEMANTIC_SUCCESSOR_PROJECTION_SET_INVALID");
    expect(migration).toContain("SEMANTIC_RUNTIME_SMOKE_FENCE_MISMATCH");
  });

  it("uses the global semantic then Falcon lock order in the combined transaction", () => {
    const functionStart = migration.indexOf(
      "create function app_data_agent.activate_falcon24_authority_with_semantic_successor(",
    );
    expect(functionStart).toBeGreaterThan(-1);
    const combined = migration.slice(functionStart);
    const orderedLocks = [
      "semantic.lock_semantic_authority_fence",
      "falcon24-authority-activation:",
      "from semantic.semantic_active_pointer",
      "from semantic.semantic_runtime_activation",
      "from app_data_agent.workspace_run_defaults",
      "from app_data_agent.falcon24_current_authority_epoch",
      "select * into stage from semantic.semantic_successor_release_stage",
      "select * into baseline from app_data_agent.falcon24_authority_baselines",
    ] as const;
    let previous = -1;
    for (const marker of orderedLocks) {
      const position = combined.indexOf(marker);
      expect(position, marker).toBeGreaterThan(previous);
      previous = position;
    }
  });

  it("atomically promotes generation two, workspace defaults, and E4 or leaves all old", () => {
    expect(migration).toContain(
      "function app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb)",
    );
    expect(migration).toContain("combined-falcon24-semantic-activation-command@1.0.0");
    expect(migration).toContain("combined-falcon24-semantic-activation-receipt@1.0.0");
    expect(migration).toContain("falcon24-semantic-release-authority-proof@2.0.0");
    expect(migration).toContain("expected_semantic_proof_hash");
    expect(migration).toContain(
      "semantic_receipt.evidence_hash is distinct from expected_semantic_proof_hash",
    );
    expect(migration).toContain("FALCON24_COMBINED_ACTIVATION_PREDECESSOR_MISMATCH");
    expect(migration).toContain("FALCON24_COMBINED_ACTIVATION_SMOKE_REQUIRED");
    expect(migration).toContain("FALCON24_COMBINED_ACTIVATION_BASELINE_MISMATCH");
    expect(migration).toContain("FALCON24_E4_AUTHORITY_POLLUTED");
    expect(migration).toContain("FALCON24_COMBINED_ACTIVATION_DEFAULTS_STALE");
    expect(migration).toContain("insert into semantic.semantic_source_release");
    expect(migration).toContain("insert into semantic.semantic_outbox");
    expect(migration).toContain("update app_data_agent.workspace_run_defaults");
    expect(migration).toContain("authority_epoch='E4'");
    expect(migration).toContain("status='PROMOTED'");
  });

  it("keeps direct DML private and grants only narrow RPC execution to backend", () => {
    expect(migration).toContain("owner to data_agent_u6_rpc_owner");
    expect(migration).toContain("revoke all on table");
    expect(migration).toContain("from public,anon,authenticated,service_role,data_agent_backend");
    expect(migration).toMatch(
      /grant execute on function[\s\S]*semantic\.load_semantic_successor_stage\(jsonb\)[\s\S]*to data_agent_backend/u,
    );
    expect(migration).toMatch(
      /grant execute on function[\s\S]*semantic\.load_promoted_semantic_successor_release\(jsonb\)[\s\S]*to data_agent_backend/u,
    );
    expect(migration).toMatch(
      /grant execute on function[\s\S]*app_data_agent\.activate_falcon24_authority_with_semantic_successor\(jsonb\)[\s\S]*to data_agent_backend/u,
    );
    expect(migration).toMatch(
      /revoke execute on function app_data_agent\.activate_falcon24_authority\(jsonb\)[\s\S]*from data_agent_backend/u,
    );
    expect(migration).toContain("pg_catalog.has_table_privilege('data_agent_backend'");
    expect(migration).toContain("pg_catalog.has_function_privilege('public'");
  });
});
