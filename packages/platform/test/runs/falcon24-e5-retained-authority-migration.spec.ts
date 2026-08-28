import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010798_app_data_agent_falcon24_e5_retained_authority.sql",
);
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const checksumHeader =
  /^-- falcon24_e5_retained_authority_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(
    migration,
  )?.[1];

describe("10798 Falcon24 E5 retained semantic authority", () => {
  it("is a rendered, checksummed, forward-only PostgreSQL 17 migration", () => {
    expect(checksumHeader).toMatch(/^[0-9a-f]{64}$/u);
    const checksum = checksumHeader ?? "";
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(migration).toContain(
      "20260725010797_app_data_agent_falcon24_successor_activation_closure",
    );
    expect(migration).toContain("platform.assert_migration_checksum");
  });

  it("accepts E5+ only through request v3 while preserving the historical E2/E3 path", () => {
    expect(migration).toContain("falcon24-activation-request@3.0.0");
    expect(migration).toContain("pg_catalog.substr(command->>'authority_epoch',2)::numeric<5");
    expect(migration).toContain("command->>'authority_epoch' not in('E2','E3')");
    expect(migration).toContain("expected_release->>'generation'<>'2'");
    expect(migration).toContain("FALCON24_RETAINED_ACTIVATION_PREDECESSOR_MISMATCH");
    expect(migration).toContain("FALCON24_RETAINED_ACTIVATION_REPLAY_CONFLICT");
  });

  it("locks the retained closure in the documented global order", () => {
    const orderedTokens = [
      "semantic.lock_semantic_authority_fence",
      "pg_catalog.pg_advisory_xact_lock",
      "from app_data_agent.falcon24_current_authority_epoch row",
      "from semantic.semantic_active_pointer row",
      "from semantic.semantic_runtime_activation row",
      "from app_data_agent.workspace_run_defaults row",
      "from app_data_agent.workspace_run_default_revisions row",
      "from app_data_agent.falcon24_authority_baselines row",
      "from app_data_agent.falcon24_authority_activation_attempts row",
      "from app_data_agent.falcon24_authority_staging_sessions row",
      "from app_data_agent.falcon24_authority_staging_receipts row",
    ];
    let previousIndex = -1;
    for (const token of orderedTokens) {
      const currentIndex = migration.indexOf(token, previousIndex + 1);
      expect(currentIndex, token).toBeGreaterThan(previousIndex);
      previousIndex = currentIndex;
    }
  });

  it("verifies but never mutates the retained semantic release or workspace defaults", () => {
    const activationStart = migration.indexOf(
      "create function app_data_agent.activate_falcon24_authority(command jsonb)",
    );
    const activationEnd =
      migration.indexOf("\n$function$;", activationStart) + "\n$function$;".length;
    const activation = migration.slice(activationStart, activationEnd);

    expect(migration).toContain("FALCON24_RETAINED_SEMANTIC_CLOSURE_STALE");
    expect(migration).toContain("FALCON24_RETAINED_SEMANTIC_CLOSURE_INVALID");
    expect(migration).toContain("semantic.semantic_source_release_graph_projection");
    expect(activation).not.toMatch(/update semantic\.semantic_active_pointer/iu);
    expect(activation).not.toMatch(/update semantic\.semantic_runtime_activation/iu);
    expect(activation).not.toMatch(/update app_data_agent\.workspace_run_defaults/iu);
    expect(activation).not.toMatch(/update semantic\.semantic_source_release/iu);
  });

  it("adds epoch-derived E5 diagnostic v2 and qualification v4 contracts", () => {
    expect(migration).toContain("falcon24-diagnostic-attempt@2.0.0");
    expect(migration).toContain("falcon24-diagnostic-receipt@2.0.0");
    expect(migration).toContain("falcon24-qualification-manifest@4.0.0");
    expect(migration).toContain("attempt.authority_epoch||'-Q1'");
    expect(migration).toContain("FALCON24_QUALIFICATION_DIAGNOSTIC_REQUIRED");
  });

  it("gives the RPC owner scoped semantic reads and hides historical helpers", () => {
    expect(migration).toContain("create policy semantic_retained_release_select_rpc");
    expect(migration).toContain("semantic_domain=nullif(pg_catalog.current_setting");
    expect(migration).toContain("to data_agent_u6_rpc_owner");
    expect(migration).toContain(
      "revoke all on function app_data_agent.activate_falcon24_authority_pre_retained(jsonb)",
    );
    expect(migration).toContain(
      "revoke all on function app_data_agent.begin_falcon24_diagnostic_e4_history(jsonb)",
    );
    expect(migration).toContain("pg_catalog.has_function_privilege('public'");
  });
});
