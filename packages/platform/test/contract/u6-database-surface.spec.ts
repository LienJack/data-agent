import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const appInfraRoot = resolve(repositoryRoot, "infra/supabase/apps/data-agent");
const inventoryPath = resolve(appInfraRoot, "u6-schema-inventory.json");
const maintenanceManifestPath = resolve(appInfraRoot, "u6-migration-maintenance-manifest.json");
const migrationPath = resolve(
  appInfraRoot,
  "migrations/20260725010590_app_data_agent_u6_research_authority.sql",
);
const migrationSourceRoot = resolve(appInfraRoot, "migration-sources/10590");
const rolePreflightPath = resolve(migrationSourceRoot, "10-existing-table-alterations.sql.inc");
const rolePostconditionsPath = resolve(migrationSourceRoot, "99-postconditions-commit.sql.inc");
const roleGrantPath = resolve(migrationSourceRoot, "90-rls-owner-grants.sql.inc");

const PROTECTED_U6_ROLES = [
  "data_agent_u6_data_owner",
  "data_agent_u6_platform_lock_owner",
  "data_agent_u6_rpc_owner",
  "data_agent_u6_provisioner_owner",
  "data_agent_u6_cleanup_owner",
  "data_agent_u6_provisioner",
] as const;

const U6_JOB_RELATIONS = [
  "app_data_agent.current_report_readiness",
  "app_data_agent.report_read_grant_expiration_operations",
  "app_data_agent.report_read_grants",
  "app_data_agent.research_adapter_termination_receipts",
  "app_data_agent.research_artifact_commit_operations",
  "app_data_agent.research_authority_capabilities",
  "app_data_agent.research_authority_capability_heads",
  "app_data_agent.research_current_evidence_relation_keys",
  "app_data_agent.research_domain_terminals",
  "app_data_agent.research_frontier_events",
  "app_data_agent.research_frontier_operations",
  "app_data_agent.research_invocation_commits",
  "app_data_agent.research_invocation_outcome_usage",
  "app_data_agent.research_invocation_request_operations",
  "app_data_agent.research_invocation_result_blobs",
  "app_data_agent.research_invocation_results",
  "app_data_agent.research_invocation_terminal_preparations",
  "app_data_agent.research_invocation_transition_operations",
  "app_data_agent.research_lifecycle_cleanup_batch_receipts",
  "app_data_agent.research_lifecycle_cleanup_operations",
  "app_data_agent.research_readiness_consumptions",
  "app_data_agent.research_readiness_publications",
  "app_data_agent.research_release_decision_commits",
  "app_data_agent.research_resource_reservations",
  "app_data_agent.research_resource_run_heads",
  "app_data_agent.research_resource_transition_operations",
  "app_data_agent.research_result_access_audit_purge_operations",
  "app_data_agent.research_result_access_audit_retention_heads",
  "app_data_agent.research_result_access_audit_retention_policies",
  "app_data_agent.research_result_ciphertext_access_audits",
  "app_data_agent.research_result_key_transition_operations",
  "app_data_agent.research_result_key_versions",
  "app_data_agent.research_result_retention_policies",
  "app_data_agent.research_result_retention_policy_heads",
  "app_data_agent.research_revocation_operations",
  "app_data_agent.research_secure_sql_execution_receipts",
  "app_data_agent.research_stop_terminal_commits",
  "app_data_agent.research_system_artifacts",
  "app_data_agent.research_system_record_identities",
  "app_data_agent.research_system_record_transition_operations",
  "app_data_agent.research_tool_invocation_permits",
  "app_data_agent.research_tool_permit_policy_limits",
  "app_data_agent.research_version_frontiers",
] as const;

const RETAINED_CONTROL_RELATIONS = [
  "app_data_agent.research_lifecycle_cleanup_batch_receipts",
  "app_data_agent.research_lifecycle_cleanup_operations",
] as const;

const PUBLIC_MUTATION_FUNCTIONS = [
  "abort_invocation_terminal_preparation(jsonb)",
  "advance_research_version_frontier(jsonb)",
  "authorize_agent_data_projection(jsonb)",
  "begin_research_resource(jsonb)",
  "cancel_research_resource(jsonb)",
  "commit_adapter_termination_receipt(jsonb)",
  "commit_current_l2_artifact(jsonb)",
  "commit_current_release_go(jsonb)",
  "commit_invocation_terminal(jsonb)",
  "commit_report_read_response(jsonb)",
  "commit_research_stop_terminal(jsonb)",
  "consume_current_ready(jsonb)",
  "consume_report_read_grant(jsonb)",
  "erase_subject_invocation_result(jsonb)",
  "expire_report_read_grant(jsonb)",
  "expire_research_resource(jsonb)",
  "expire_tool_invocation_permit(jsonb)",
  "initialize_research_version_frontier(jsonb)",
  "issue_tool_invocation_permit(jsonb)",
  "mark_research_invocation_outcome_unknown(jsonb)",
  "mark_research_resource_abandoned(jsonb)",
  "prepare_invocation_terminal(jsonb)",
  "publish_current_report_readiness(jsonb)",
  "reserve_research_resource(jsonb)",
  "revoke_current_readiness(jsonb)",
  "revoke_tool_invocation_permit(jsonb)",
  "settle_research_resource(jsonb)",
  "start_research_invocation(jsonb)",
  "tombstone_invocation_result(jsonb)",
] as const;

const PUBLIC_RESOLVER_FUNCTIONS = [
  "read_historical_l2_research_artifact(jsonb)",
  "resolve_committed_adapter_termination_receipt(jsonb)",
  "resolve_committed_invocation_outcome_usage(jsonb)",
  "resolve_committed_model_invocation_result(jsonb)",
  "resolve_committed_secure_sql_execution_receipt(jsonb)",
  "resolve_committed_sql_invocation_result(jsonb)",
  "resolve_committed_tool_invocation_result(jsonb)",
  "resolve_current_tool_invocation_permit(jsonb)",
  "resolve_invocation_result_ciphertext(jsonb)",
  "resolve_invocation_terminal_preparation_recovery_metadata(jsonb)",
] as const;

const BACKEND_EXECUTE_ENABLED_FUNCTIONS = [
  "commit_research_stop_terminal(jsonb)",
  "consume_current_ready(jsonb)",
  "publish_current_report_readiness(jsonb)",
] as const;

const DEPLOYMENT_FUNCTIONS = [
  "activate_u6_result_key_version(jsonb)",
  "compromise_u6_result_key_version(jsonb)",
  "provision_u6_authority_manifest(jsonb)",
  "provision_u6_execution_policy_manifest(jsonb)",
  "purge_u6_result_ciphertext_access_audits(jsonb)",
  "retire_u6_result_key_version(jsonb)",
  "stage_u6_result_key_version(jsonb)",
] as const;

const INTERNAL_FUNCTIONS = [
  {
    signature: "commit_research_revocation_receipt(jsonb)",
    owner: "data_agent_u6_rpc_owner",
    language: "plpgsql",
    volatility: "VOLATILE",
    null_input: "CALLED_ON_NULL_INPUT",
    security_definer: true,
    search_path: "",
  },
  {
    signature: "commit_research_system_artifact(jsonb)",
    owner: "data_agent_u6_rpc_owner",
    language: "plpgsql",
    volatility: "VOLATILE",
    null_input: "CALLED_ON_NULL_INPUT",
    security_definer: true,
    search_path: "",
  },
  {
    signature: "lock_u6_authority_capability(jsonb,text,text,text,text,boolean)",
    owner: "data_agent_u6_rpc_owner",
    language: "plpgsql",
    volatility: "VOLATILE",
    null_input: "CALLED_ON_NULL_INPUT",
    security_definer: true,
    search_path: "",
  },
  {
    signature: "u6_constant_time_equal(bytea,bytea)",
    owner: "data_agent_u6_rpc_owner",
    language: "plpgsql",
    volatility: "IMMUTABLE",
    null_input: "STRICT",
    security_definer: false,
    search_path: "",
  },
  {
    signature: "u6_domain_sha256(text,jsonb)",
    owner: "data_agent_u6_rpc_owner",
    language: "sql",
    volatility: "IMMUTABLE",
    null_input: "STRICT",
    security_definer: false,
    search_path: "",
  },
  {
    signature: "u6_strict_base64url_decode(text)",
    owner: "data_agent_u6_rpc_owner",
    language: "plpgsql",
    volatility: "IMMUTABLE",
    null_input: "STRICT",
    security_definer: false,
    search_path: "",
  },
  {
    signature: "u6_uuid_v5(uuid,bytea)",
    owner: "data_agent_u6_rpc_owner",
    language: "plpgsql",
    volatility: "IMMUTABLE",
    null_input: "STRICT",
    security_definer: false,
    search_path: "",
  },
] as const;

const SOURCE_SEGMENTS = [
  "00-preamble.sql.inc",
  "10-existing-table-alterations.sql.inc",
  "20-capability-key-metadata.sql.inc",
  "30-artifact-authority.sql.inc",
  "40-frontier-readiness.sql.inc",
  "50-resource.sql.inc",
  "60-invocation-system-records.sql.inc",
  "70-cross-fks-indexes-triggers.sql.inc",
  "80-internal-functions.sql.inc",
  "81-root-rpcs.sql.inc",
  "82-resource-invocation-rpcs.sql.inc",
  "83-resolvers-provisioner.sql.inc",
  "84-lifecycle-cleanup.sql.inc",
  "90-rls-owner-grants.sql.inc",
  "99-postconditions-commit.sql.inc",
] as const;

const inventorySchema = z.strictObject({
  protocol_version: z.literal("u6-schema-inventory@1.0.0"),
  migration: z.strictObject({
    name: z.literal("20260725010590_app_data_agent_u6_research_authority.sql"),
    sha256: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    source_segments: z.array(z.string()),
  }),
  runtime: z.strictObject({
    postgres_major: z.literal(17),
    pgcrypto_schema: z.literal("extensions"),
    migration_arm_safety_ms: z.literal(5_000),
    migration_min_effective_budget_ms: z.literal(30_000),
  }),
  relations: z.array(
    z.strictObject({
      qualified_name: z.string(),
      cleanup_owner: z.enum(["U6_JOB", "CORE_DATABASE", "PLATFORM_CONTROL", "RETAINED_CONTROL"]),
      scope_columns: z.array(z.string()),
      identity_order: z.string(),
      cleanup_phases: z.array(z.unknown()),
    }),
  ),
  functions: z.array(
    z.strictObject({
      schema: z.enum(["app_data_agent", "platform"]),
      signature: z.string(),
      exposure: z.enum([
        "PUBLIC_MUTATION",
        "PUBLIC_RESOLVER",
        "DEPLOYMENT",
        "JOB_CLEANUP",
        "INTERNAL",
        "PLATFORM_HELPER",
      ]),
      owner: z.string(),
      language: z.enum(["sql", "plpgsql"]),
      volatility: z.enum(["IMMUTABLE", "STABLE", "VOLATILE"]),
      null_input: z.enum(["STRICT", "CALLED_ON_NULL_INPUT"]),
      security_definer: z.boolean(),
      search_path: z.literal(""),
      backend_execute_enabled: z.boolean(),
    }),
  ),
});

const maintenanceManifestSchema = z.strictObject({
  protocol_version: z.literal("u6-migration-maintenance@1.0.0"),
  migration_name: z.literal("20260725010590_app_data_agent_u6_research_authority.sql"),
  deployment_scope: z.strictObject({
    app_id: z.literal("00000000-0000-4000-8000-00000000da01"),
    deployment_binding: z.literal("SESSION_ACTIVE_MAPPING"),
    database_binding: z.literal("SESSION_DATABASE_IDENTITY"),
  }),
  maintenance_window: z.strictObject({
    window_id: z.uuid(),
    max_duration_ms: z.number().int().min(60_000).max(7_200_000),
  }),
  timeouts: z.strictObject({
    lock_timeout_ms: z.number().int().min(100).max(5_000),
    statement_timeout_ms: z.number().int().min(30_000).max(1_800_000),
    idle_in_transaction_session_timeout_ms: z.number().int().min(30_000).max(300_000),
  }),
  relation_limits: z.array(
    z.strictObject({
      qualified_name: z.enum([
        "app_data_agent.artifacts",
        "app_data_agent.memberships",
        "app_data_agent.outbox",
        "app_data_agent.run_attempts",
        "app_data_agent.runs",
        "platform.app_environment_lifecycle",
        "platform.deployment_mappings",
      ]),
      approved_max_rows: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      approved_max_total_bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    }),
  ),
  manifest_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
});

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("U6 PostgreSQL Authority 数据库面", () => {
  it("维护窗口清单固定七张 existing relation 且无重复", () => {
    const manifest = maintenanceManifestSchema.parse(readJson(maintenanceManifestPath));
    const relationNames = manifest.relation_limits.map((relation) => relation.qualified_name);

    expect(relationNames).toEqual([...relationNames].sort());
    expect(new Set(relationNames).size).toBe(7);
  });

  it("Schema Inventory 精确闭合 41 张 U6_JOB 与 2 张 retained relation", () => {
    const inventory = inventorySchema.parse(readJson(inventoryPath));
    const relationOwners = new Map(
      inventory.relations.map((relation) => [relation.qualified_name, relation.cleanup_owner]),
    );
    const u6JobRelations = inventory.relations
      .filter((relation) => relation.cleanup_owner === "U6_JOB")
      .map((relation) => relation.qualified_name)
      .sort();
    const retainedRelations = inventory.relations
      .filter((relation) => relation.cleanup_owner === "RETAINED_CONTROL")
      .map((relation) => relation.qualified_name)
      .sort();

    expect(u6JobRelations).toEqual(
      U6_JOB_RELATIONS.filter(
        (relation) => !RETAINED_CONTROL_RELATIONS.includes(relation as never),
      ).sort(),
    );
    expect(retainedRelations).toEqual([...RETAINED_CONTROL_RELATIONS].sort());
    for (const relation of RETAINED_CONTROL_RELATIONS) {
      expect(relationOwners.get(relation)).toBe("RETAINED_CONTROL");
    }
  });

  it("函数面只暴露冻结的 mutation、resolver 与 deployment 白名单", () => {
    const inventory = inventorySchema.parse(readJson(inventoryPath));
    const signaturesFor = (
      exposure: z.infer<typeof inventorySchema>["functions"][number]["exposure"],
    ) =>
      inventory.functions
        .filter((fn) => fn.schema === "app_data_agent" && fn.exposure === exposure)
        .map((fn) => fn.signature)
        .sort();

    expect(signaturesFor("PUBLIC_MUTATION")).toEqual([...PUBLIC_MUTATION_FUNCTIONS].sort());
    expect(signaturesFor("PUBLIC_RESOLVER")).toEqual([...PUBLIC_RESOLVER_FUNCTIONS].sort());
    expect(signaturesFor("DEPLOYMENT")).toEqual([...DEPLOYMENT_FUNCTIONS].sort());
    expect(
      inventory.functions
        .filter((fn) => fn.backend_execute_enabled)
        .map((fn) => fn.signature)
        .sort(),
    ).toEqual([...BACKEND_EXECUTE_ENABLED_FUNCTIONS].sort());
    expect(
      inventory.functions
        .filter((fn) => fn.exposure === "PUBLIC_MUTATION" || fn.exposure === "PUBLIC_RESOLVER")
        .every(
          (fn) =>
            fn.backend_execute_enabled ===
            BACKEND_EXECUTE_ENABLED_FUNCTIONS.includes(fn.signature as never),
        ),
    ).toBe(true);
    expect(
      inventory.functions
        .filter((fn) => fn.schema === "app_data_agent" && fn.exposure === "INTERNAL")
        .map(
          ({
            exposure: _exposure,
            schema: _schema,
            backend_execute_enabled: _backendExecuteEnabled,
            ...fn
          }) => fn,
        )
        .sort((left, right) => left.signature.localeCompare(right.signature)),
    ).toEqual(INTERNAL_FUNCTIONS);
  });

  it("唯一 10590 由固定 source segment 顺序渲染并登记相同 checksum", () => {
    const inventory = inventorySchema.parse(readJson(inventoryPath));
    const migration = readFileSync(migrationPath, "utf8");
    const checksumMarkers = [
      ...migration.matchAll(/^-- u6_migration_checksum: (sha256:[0-9a-f]{64})$/gm),
    ];

    expect(inventory.migration.source_segments).toEqual(SOURCE_SEGMENTS);
    expect(checksumMarkers).toHaveLength(1);
    expect(checksumMarkers[0]?.[1]).toBe(inventory.migration.sha256);
    expect(migration).toContain(
      `'20260725010590_app_data_agent_u6_research_authority',\n  '${inventory.migration.sha256}'`,
    );
  });

  it("迁移前与 postcondition 都拒绝 owner/executor 的完整成员闭包", () => {
    const preflight = readFileSync(rolePreflightPath, "utf8");
    const postconditions = readFileSync(rolePostconditionsPath, "utf8");
    const grants = readFileSync(roleGrantPath, "utf8");

    for (const sql of [preflight, postconditions]) {
      expect(sql).toContain("with recursive u6_protected_roles");
      expect(sql).toContain("join pg_catalog.pg_auth_members as membership");
      expect(sql).toContain("membership.roleid = closure.member_id");
      expect(sql).toContain("not membership.member = any(closure.member_path)");
      expect(sql).toContain("membership.inherit_option");
      expect(sql).toContain("membership.set_option");
      expect(sql).toContain("membership.admin_option");
      for (const role of PROTECTED_U6_ROLES) {
        expect(sql).toContain(`'${role}'`);
      }
    }

    expect(preflight).toContain("U6_MIGRATION_ROLE_MEMBERSHIP_CONFLICT");
    expect(postconditions).toContain("U6_MIGRATION_ROLE_MEMBERSHIP_MISMATCH");

    // 90 has no explicit role-membership allowlist, so all six protected
    // roles must have an empty direct/transitive member closure.
    const normalizedGrants = grants.replaceAll(/\s+/g, " ");
    for (const role of PROTECTED_U6_ROLES) {
      expect(normalizedGrants).not.toMatch(new RegExp(`\\bgrant\\s+${role}\\s+to\\s+`, "i"));
    }
  });
});
