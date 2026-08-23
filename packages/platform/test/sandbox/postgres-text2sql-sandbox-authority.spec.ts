import {
  type ArtifactReference,
  computeL2ArtifactContentHash,
  computeOrderedSandboxSqlParametersHash,
  computePostgresqlExecutionSettingsHash,
  computeSandboxCanonicalMultisetHash,
  computeSandboxExecutionRequestHash,
  computeSandboxOrderedResultHash,
  computeSandboxResultBytes,
  l2ArtifactDocumentSchema,
  type ResolvedContextText2SqlBinding,
  sandboxExecutionRequestSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import {
  cancelSandboxExecution,
  computeExecutionGrantHash,
  computeSandboxExecutionOutcomeChecksum,
  computeSnapshotDescriptorHash,
  type ExecutionGrant,
  finalizeSandboxExecution,
  prepareSandboxExecution,
  recoverSandboxExecution,
  type SandboxExecutionImmutableIdentity,
  type SnapshotDescriptor,
  sandboxExecutionImmutableIdentitySchema,
} from "@data-agent/contracts/server";
import { describe, expect, it, vi } from "vitest";
import type { SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresText2SqlSandboxAuthority } from "../../src/sandbox/postgres-text2sql-sandbox-authority.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const ids = {
  app: "00000000-0000-4000-8000-000000000001",
  tenant: "00000000-0000-4000-8000-000000000011",
  principal: "00000000-0000-4000-8000-000000000101",
  deployment: "00000000-0000-4000-8000-0000000000d1",
  run: "00000000-0000-4000-8000-000000000201",
  execution: "00000000-0000-4000-8000-000000000301",
  datasource: "00000000-0000-4000-8000-000000000401",
  sql: "00000000-0000-4000-8000-000000000501",
  permit: "00000000-0000-4000-8000-000000000502",
  admission: "00000000-0000-4000-8000-000000000503",
  policy: "00000000-0000-4000-8000-000000000504",
  attempt: "00000000-0000-4000-8000-000000000601",
  lease: "00000000-0000-4000-8000-000000000602",
  recoveredAttempt: "00000000-0000-4000-8000-000000000603",
  recoveredLease: "00000000-0000-4000-8000-000000000604",
} as const;

const authorityIdentity = {
  authority_id: "00000000-0000-4000-8000-000000000901",
  principal_id: "postgres-sandbox-authority",
  key_id: "postgres-sandbox-key@1",
} as const;
const hash = (digit: string) => `sha256:${digit.repeat(64)}`;
const observedAt = "2026-07-27T00:01:00.000Z";

function resolvedContextBinding(): ResolvedContextText2SqlBinding {
  return {
    schema_version: "resolved-context-text2sql-binding@1.0.0",
    scope: { app_id: ids.app, tenant_id: ids.tenant, environment: "test" },
    resolved_context_package_ref: {
      package_id: "47f7093f-71b2-8f72-8398-3832d59c5089",
      package_revision: 1,
      package_hash: hash("1"),
    },
    authority_snapshot_hash: hash("2"),
    semantic_release: {
      resource_id: ids.policy,
      resource_revision: 1,
      resource_hash: hash("3"),
      datasource_id: ids.datasource,
      semantic_generation: 1,
      publication_status: "PUBLISHED",
    },
    schema_snapshot: {
      resource_id: ids.admission,
      resource_revision: 1,
      resource_hash: hash("4"),
      datasource_id: ids.datasource,
      semantic_release_id: ids.policy,
      semantic_generation: 1,
    },
    route: "METRIC",
    selected_metric_id: "gross_revenue",
    selected_ontology_ids: [],
    mapping_refs: ["mapping.amount"],
    semantic_projection_hashes: [hash("7")],
    mapping_closure_hash: hash("5"),
    binding_hash: hash("6"),
  };
}

interface SqlCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

function scriptedPool(
  handle: (text: string, values: readonly unknown[]) => SqlQueryResult | undefined,
) {
  const calls: SqlCall[] = [];
  let connects = 0;
  let releases = 0;
  const pool: SqlPool = {
    connect: async () => {
      connects += 1;
      return {
        async query<Row extends object = Record<string, unknown>>(text: string, values = []) {
          calls.push({ text, values });
          const handled = handle(text, values);
          if (handled) return handled as SqlQueryResult<Row>;
          if (text.includes("backend_context_matches")) {
            return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
          }
          return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
        },
        release() {
          releases += 1;
        },
      };
    },
  };
  return {
    calls,
    pool,
    get connects() {
      return connects;
    },
    get releases() {
      return releases;
    },
  };
}

function reference(
  artifactType: ArtifactReference["artifact_type"],
  artifactId: string,
  contentHash: string,
): ArtifactReference {
  return {
    artifact_id: artifactId,
    artifact_type: artifactType,
    app_id: ids.app,
    tenant_id: ids.tenant,
    environment: "test",
    run_id: ids.run,
    revision: 1,
    content_hash: contentHash,
  };
}

async function committedDocument(
  artifactId: string,
  artifactType: ArtifactReference["artifact_type"],
  payload: Record<string, unknown>,
  inputRefs: readonly ArtifactReference[],
) {
  const draft = l2ArtifactDocumentSchema.parse({
    envelope: {
      artifact_id: artifactId,
      artifact_type: artifactType,
      app_id: ids.app,
      tenant_id: ids.tenant,
      environment: "test",
      run_id: ids.run,
      revision: 1,
      parent_ref: null,
      attempt_id: ids.attempt,
      producer: { kind: "deterministic", id: "platform-sandbox-test" },
      input_refs: inputRefs,
      schema_version: "1.0.0",
      semantic_version: "1.0.0",
      policy_version: "1.0.0",
      model_profile_version: "test",
      content_hash: hash("0"),
      status: "COMMITTED",
      created_at: "2026-07-27T00:00:00.000Z",
    },
    payload,
  });
  return l2ArtifactDocumentSchema.parse({
    ...draft,
    envelope: {
      ...draft.envelope,
      content_hash: await computeL2ArtifactContentHash(draft),
    },
  });
}

async function protocolFixture(
  options: {
    readonly sql?: string;
    readonly compiler_version?: string;
    readonly search_path?: readonly string[];
    readonly resolved_context_binding?: ResolvedContextText2SqlBinding;
  } = {},
) {
  const settings = {
    database_role: "analyst",
    search_path: options.search_path ?? ["sandbox_fixture_v1", "pg_catalog"],
    plan_cache_mode: "force_custom_plan",
    statement_timeout_ms: 1_000,
    lock_timeout_ms: 100,
  } as const;
  const budget = {
    timeout_ms: 1_000,
    lock_timeout_ms: 100,
    max_rows: 100,
    max_bytes: 1_000_000,
    max_memory_mb: 128,
  } as const;
  const parameters = { $1: "south" };
  const sqlMaterial = {
    dialect: "postgresql" as const,
    sql: options.sql ?? "select $1::pg_catalog.text as region",
    parameters,
  };
  const queryHash = await sha256ContentHash(sqlMaterial);
  const logicalPlanRef = reference(
    "LogicalPlan",
    "00000000-0000-4000-8000-000000000505",
    hash("5"),
  );
  const sqlDocument = await committedDocument(
    ids.sql,
    "SqlArtifact",
    {
      artifact_type: "SqlArtifact",
      logical_plan_ref: logicalPlanRef,
      compiler_version: options.compiler_version ?? "postgresql-compiler@1.1.0",
      ast_hash: hash("6"),
      ...(options.resolved_context_binding
        ? { resolved_context_binding_hash: options.resolved_context_binding.binding_hash }
        : {}),
      ...sqlMaterial,
      query_hash: queryHash,
    },
    [logicalPlanRef],
  );
  const sqlRef = reference("SqlArtifact", ids.sql, sqlDocument.envelope.content_hash);
  const admissionRef = reference("ResourceAdmissionReceipt", ids.admission, hash("7"));
  const policyRef = reference("PolicyReceipt", ids.policy, hash("8"));
  const gateReceiptRefs = [1, 2, 3, 4, 5].map((value) =>
    reference("GateReceipt", `00000000-0000-4000-8000-00000000051${value}`, hash(String(value))),
  );
  const permitDocument = await committedDocument(
    ids.permit,
    "ExecutionPermit",
    {
      artifact_type: "ExecutionPermit",
      sql_artifact_ref: sqlRef,
      resource_admission_ref: admissionRef,
      gate_receipt_refs: gateReceiptRefs,
      datasource_id: ids.datasource,
      schema_version: "1.0.0",
      settings_hash: await computePostgresqlExecutionSettingsHash(settings),
      execution_settings: settings,
      principal_id: ids.principal,
      policy_receipt_ref: policyRef,
      budget,
      issued_at: "2026-07-27T00:00:00.000Z",
      expires_at: "2026-07-27T00:05:00.000Z",
    },
    [sqlRef, admissionRef, ...gateReceiptRefs, policyRef],
  );
  const permitRef = reference("ExecutionPermit", ids.permit, permitDocument.envelope.content_hash);
  const request = sandboxExecutionRequestSchema.parse({
    schema_version: "1.0.0",
    scope: { app_id: ids.app, tenant_id: ids.tenant, environment: "test" },
    run_id: ids.run,
    execution_id: ids.execution,
    idempotency_key: "postgres-authority-test",
    language: "sql",
    payload: {
      dialect: "postgresql",
      sql_artifact_ref: sqlRef,
      execution_permit_ref: permitRef,
      resource_admission_ref: admissionRef,
      datasource_id: ids.datasource,
      settings_hash: await computePostgresqlExecutionSettingsHash(settings),
      execution_settings: settings,
      snapshot_requirement: { mode: "REQUIRE_REPLAYABLE" },
      parameters,
      ...(options.resolved_context_binding
        ? { resolved_context_binding: options.resolved_context_binding }
        : {}),
    },
    budget,
  });
  if (request.language !== "sql") throw new Error("fixture 必须是 SQL request");
  const identity = sandboxExecutionImmutableIdentitySchema.parse({
    protocol_version: "sandbox-execution-identity@1.0.0",
    scope: request.scope,
    scope_hash: await sha256ContentHash(request.scope),
    run_id: request.run_id,
    execution_id: request.execution_id,
    principal_id: ids.principal,
    idempotency_key: request.idempotency_key,
    input_hash: await computeSandboxExecutionRequestHash(request),
    sql_artifact_ref: sqlRef,
    execution_permit_ref: permitRef,
    execution_permit_expires_at: "2026-07-27T00:05:00.000Z",
    resource_admission_ref: admissionRef,
    policy_receipt_ref: policyRef,
    query_hash: queryHash,
    parameters_hash: await sha256ContentHash(parameters),
    ordered_parameters_hash: await computeOrderedSandboxSqlParametersHash(parameters),
    datasource_id: ids.datasource,
    schema_version: request.schema_version,
    settings_hash: request.payload.settings_hash,
    budget,
    snapshot_requirement: request.payload.snapshot_requirement,
  });
  const descriptorDraft = {
    protocol_version: "postgresql-snapshot@1.0.0" as const,
    scope_hash: identity.scope_hash,
    run_id: identity.run_id,
    execution_id: identity.execution_id,
    principal_id: identity.principal_id,
    datasource_id: identity.datasource_id,
    datasource_fingerprint: "postgresql://controlled-fixture",
    schema_version: identity.schema_version,
    strategy: "CONTROLLED_REVISION" as const,
    intent: "RESOLVE" as const,
    snapshot_token: "controlled-fixture@1.0.0",
    schema_manifest_hash: hash("b"),
    data_manifest_hash: hash("c"),
    fixture_manifest_hash: hash("d"),
    observed_at: observedAt,
    replay_state: "REPLAYABLE" as const,
    descriptor_hash: hash("e"),
  };
  const descriptor = {
    ...descriptorDraft,
    descriptor_hash: await computeSnapshotDescriptorHash(descriptorDraft),
  } satisfies SnapshotDescriptor;
  return { budget, descriptor, identity, permitDocument, request, sqlDocument };
}

async function executionGrantFixture(
  fixture: Awaited<ReturnType<typeof protocolFixture>>,
): Promise<ExecutionGrant> {
  const draft = {
    protocol_version: "sandbox-execution-grant@1.0.0" as const,
    identity: fixture.identity,
    attempt_id: ids.attempt,
    attempt: 1,
    fencing_token: 1,
    lease_id: ids.lease,
    lease_expires_at: "2026-07-27T00:02:30.000Z",
    cancel_epoch: 0,
    snapshot_descriptor: fixture.descriptor,
    fixture_manifest_hash: fixture.descriptor.fixture_manifest_hash,
    budget: fixture.budget,
    issued_at: observedAt,
    grant_hash: hash("0"),
  };
  return {
    ...draft,
    grant_hash: await computeExecutionGrantHash(draft),
  };
}

async function completedOutcomeFixture(
  fixture: Awaited<ReturnType<typeof protocolFixture>>,
  grant: ExecutionGrant,
) {
  const result = {
    columns: [{ name: "region", type: "STRING" as const }],
    rows: [["south"]],
  };
  const draft = {
    protocol_version: "sandbox-execution-outcome@1.0.0" as const,
    identity: fixture.identity,
    grant_hash: grant.grant_hash,
    input_hash: fixture.identity.input_hash,
    execution_id: fixture.identity.execution_id,
    attempt_id: grant.attempt_id,
    execution_fence: grant.fencing_token,
    lease_id: grant.lease_id,
    cancel_epoch_at_start: 0,
    cancel_epoch_observed: 0,
    sql_artifact_hash: fixture.identity.sql_artifact_ref.content_hash,
    snapshot_descriptor_hash: fixture.descriptor.descriptor_hash,
    fixture_manifest_hash: fixture.descriptor.fixture_manifest_hash,
    started_at: "2026-07-27T00:01:01.000Z",
    completed_at: "2026-07-27T00:01:02.000Z",
    terminal: "COMPLETED" as const,
    reason_code: "SANDBOX_EXECUTION_COMPLETED" as const,
    result,
    resource_facts: {
      elapsed_ms: 1_000,
      observed_rows: 1,
      observed_bytes: computeSandboxResultBytes(result),
      peak_memory_mb: 1,
      retained_canonical_bytes: computeSandboxResultBytes(result),
      current_batch_estimated_bytes: 0,
      process_rss_high_water_bytes: 1_024,
      cgroup_memory_limit_enforced: true,
      partial_output_discarded: false,
      cutoff_kind: "NONE" as const,
    },
    cancel_facts: {
      cancel_requested: false,
      query_cancel_dispatched: false,
      query_cancel_confirmed: false,
      cancel_disposition: "NOT_REQUESTED" as const,
      cancel_epoch_at_start: 0,
      cancel_epoch_observed: 0,
      cancel_requested_at: null,
    },
    rollback_facts: {
      rollback_confirmed: true,
      datasource_terminal: "ROLLED_BACK_CLEAN" as const,
    },
    connection_facts: {
      backend_pid: 101,
      transaction_status: "IDLE" as const,
      connection_reused: true,
    },
    transaction: {
      transaction_id: "00000000-0000-4000-8000-000000000701",
      read_only: true as const,
      isolation_level: "REPEATABLE_READ" as const,
    },
    applied_execution_settings: fixture.request.payload.execution_settings,
    manifest_facts: {
      snapshot_descriptor_hash: fixture.descriptor.descriptor_hash,
      schema_manifest_hash: fixture.descriptor.schema_manifest_hash,
      data_manifest_hash: fixture.descriptor.data_manifest_hash,
      fixture_manifest_hash: fixture.descriptor.fixture_manifest_hash,
      manifest_revalidated: true,
      revalidated_at: "2026-07-27T00:01:01.000Z",
    },
    canonical_multiset_facts: {
      canonical_multiset_hash: await computeSandboxCanonicalMultisetHash(result.rows),
      ordered_result_hash: await computeSandboxOrderedResultHash(result),
    },
    outcome_checksum: hash("0"),
  };
  return {
    ...draft,
    outcome_checksum: await computeSandboxExecutionOutcomeChecksum(draft),
  };
}

function databaseClaim(
  identity: SandboxExecutionImmutableIdentity,
  overrides: Record<string, unknown> = {},
) {
  return {
    scope: identity.scope,
    run_id: identity.run_id,
    principal_id: identity.principal_id,
    idempotency_key: identity.idempotency_key,
    input_hash: identity.input_hash,
    execution_id: identity.execution_id,
    state: "EXECUTING",
    branch_version: 2,
    attempt_id: ids.attempt,
    attempt: 1,
    owner_id: "sandbox-worker-1",
    fencing_token: 1,
    lease_id: ids.lease,
    lease_expires_at: "2026-07-27T00:01:30.000Z",
    cancel_epoch: 0,
    cancel_requested_at: null,
    grant_hash: null,
    grant_cancel_epoch: 0,
    snapshot_descriptor: null,
    result_ref: null,
    receipt_ref: null,
    terminal_reason_code: null,
    recovery_deadline: "2026-07-27T00:01:30.000Z",
    updated_at: observedAt,
    ...overrides,
  };
}

function databaseClaimRow(
  identity: SandboxExecutionImmutableIdentity,
  requestJson: unknown,
  overrides: Record<string, unknown> = {},
) {
  const claim = databaseClaim(identity, overrides);
  return {
    app_id: identity.scope.app_id,
    tenant_id: identity.scope.tenant_id,
    environment: identity.scope.environment,
    run_id: identity.run_id,
    principal_id: identity.principal_id,
    idempotency_key: identity.idempotency_key,
    execution_id: identity.execution_id,
    input_hash: identity.input_hash,
    request_json: requestJson,
    state: claim.state,
    branch_version: claim.branch_version,
    attempt_id: claim.attempt_id,
    attempt_sequence: claim.attempt,
    owner_id: claim.owner_id,
    fence: claim.fencing_token,
    lease_id: claim.lease_id,
    lease_expires_at: claim.lease_expires_at,
    cancel_epoch: claim.cancel_epoch,
    cancel_requested_at: claim.cancel_requested_at,
    grant_hash: claim.grant_hash,
    grant_cancel_epoch: claim.grant_cancel_epoch,
    snapshot_descriptor_json: claim.snapshot_descriptor,
    result_ref: claim.result_ref,
    receipt_ref: claim.receipt_ref,
    terminal_reason_code: claim.terminal_reason_code,
    recovery_deadline: claim.recovery_deadline,
    updated_at: claim.updated_at,
  };
}

function issueCapability() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: ids.deployment, app_id: ids.app, environment: "test" }],
    [
      {
        subject: ids.principal,
        deployment_id: ids.deployment,
        tenant_id: ids.tenant,
        role: "ANALYST",
      },
    ],
  );
  const resolved = registry.resolveForDeployment(ids.deployment, {
    subject: ids.principal,
  });
  if (!resolved.ok) throw new Error("Capability fixture 创建失败。");
  return {
    capability: resolved.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

async function snapshotDescriptor(): Promise<SnapshotDescriptor> {
  const draft = {
    protocol_version: "postgresql-snapshot@1.0.0" as const,
    scope_hash: `sha256:${"a".repeat(64)}`,
    run_id: ids.run,
    execution_id: ids.execution,
    principal_id: ids.principal,
    datasource_id: ids.datasource,
    datasource_fingerprint: "postgresql://controlled-fixture",
    schema_version: "1.0.0",
    strategy: "CONTROLLED_REVISION" as const,
    intent: "CREATE" as const,
    snapshot_token: "controlled-fixture@1.0.0",
    schema_manifest_hash: `sha256:${"b".repeat(64)}`,
    data_manifest_hash: `sha256:${"c".repeat(64)}`,
    fixture_manifest_hash: `sha256:${"d".repeat(64)}`,
    observed_at: "2026-07-27T00:00:00.000Z",
    replay_state: "REPLAYABLE" as const,
    descriptor_hash: `sha256:${"e".repeat(64)}`,
  };
  return {
    ...draft,
    descriptor_hash: await computeSnapshotDescriptorHash(draft),
  };
}

async function noneSnapshotDescriptor(): Promise<SnapshotDescriptor> {
  const controlled = await snapshotDescriptor();
  const {
    descriptor_hash: _descriptorHash,
    snapshot_token: _snapshotToken,
    schema_manifest_hash: _schemaManifestHash,
    data_manifest_hash: _dataManifestHash,
    fixture_manifest_hash: _fixtureManifestHash,
    ...identity
  } = controlled;
  const draft = {
    ...identity,
    strategy: "NONE" as const,
    snapshot_token: null,
    schema_manifest_hash: null,
    data_manifest_hash: null,
    fixture_manifest_hash: null,
    replay_state: "REPLAY_UNAVAILABLE" as const,
    descriptor_hash: hash("0"),
  };
  return {
    ...draft,
    descriptor_hash: await computeSnapshotDescriptorHash(draft),
  };
}

function controlledRelationManifest(
  descriptor: SnapshotDescriptor,
  allowedRelations: readonly {
    readonly schema_name: string;
    readonly relation_name: string;
  }[] = [],
) {
  return {
    snapshot_descriptor_hash: descriptor.descriptor_hash,
    sealed_schema: "sandbox_fixture_v1",
    allowed_relations: allowedRelations,
  };
}

describe("PostgreSQL Text2SQL Sandbox Authority", () => {
  it("rejects a cross-scope Resolved Context binding before database I/O", async () => {
    await expect(
      protocolFixture({
        resolved_context_binding: {
          ...resolvedContextBinding(),
          scope: {
            app_id: ids.app,
            tenant_id: "00000000-0000-4000-8000-000000009999",
            environment: "test",
          },
        },
      }),
    ).rejects.toThrow("Resolved Context binding must match the Sandbox scope and datasource");
  });

  it("fails closed when fixed Snapshot Authority contains duplicate execution identity", async () => {
    const capability = issueCapability();
    const descriptor = await snapshotDescriptor();
    const pool: SqlPool = {
      connect: async () => {
        throw new Error("duplicate descriptor 必须在数据库连接前拒绝");
      },
    };

    expect(() =>
      createPostgresText2SqlSandboxAuthority({
        pool,
        authorizer: capability.authorizer,
        capability: capability.capability,
        identity: authorityIdentity,
        owner_id: "sandbox-worker-1",
        snapshot_descriptors: [descriptor, descriptor],
        snapshot_relation_manifests: [],
      }),
    ).toThrow("SANDBOX_SNAPSHOT_DESCRIPTOR_DUPLICATE");
  });

  it("fails construction for missing, extra, duplicate, or NONE relation manifests", async () => {
    const capability = issueCapability();
    const descriptor = await snapshotDescriptor();
    const noneDescriptor = await noneSnapshotDescriptor();
    const pool: SqlPool = {
      connect: async () => {
        throw new Error("relation manifest 必须在数据库连接前拒绝");
      },
    };
    const create = (
      snapshotDescriptors: readonly SnapshotDescriptor[],
      snapshotRelationManifests: readonly unknown[],
    ) =>
      createPostgresText2SqlSandboxAuthority({
        pool,
        authorizer: capability.authorizer,
        capability: capability.capability,
        identity: authorityIdentity,
        owner_id: "sandbox-worker-1",
        snapshot_descriptors: snapshotDescriptors,
        snapshot_relation_manifests: snapshotRelationManifests,
      });

    expect(() => create([descriptor], [])).toThrow("SANDBOX_SNAPSHOT_RELATION_MANIFEST_MISSING");
    expect(() =>
      create(
        [descriptor],
        [
          {
            snapshot_descriptor_hash: hash("f"),
            sealed_schema: "sandbox_fixture_v1",
            allowed_relations: [],
          },
        ],
      ),
    ).toThrow("SANDBOX_SNAPSHOT_RELATION_MANIFEST_EXTRA");
    expect(() =>
      create(
        [descriptor],
        [
          {
            snapshot_descriptor_hash: descriptor.descriptor_hash,
            sealed_schema: "sandbox_fixture_v1",
            allowed_relations: [],
          },
          {
            snapshot_descriptor_hash: descriptor.descriptor_hash,
            sealed_schema: "sandbox_fixture_v1",
            allowed_relations: [],
          },
        ],
      ),
    ).toThrow("SANDBOX_SNAPSHOT_RELATION_MANIFEST_DUPLICATE");
    expect(() =>
      create(
        [noneDescriptor],
        [
          {
            snapshot_descriptor_hash: noneDescriptor.descriptor_hash,
            sealed_schema: "analytics",
            allowed_relations: [{ schema_name: "analytics", relation_name: "orders" }],
          },
        ],
      ),
    ).toThrow("SANDBOX_NONE_SNAPSHOT_RELATION_MANIFEST_NOT_EMPTY");
  });

  it("prepares Exact Revision, revalidation, claim and grant in one database transaction", async () => {
    const binding = resolvedContextBinding();
    const fixture = await protocolFixture({ resolved_context_binding: binding });
    const capability = issueCapability();
    const pool = scriptedPool((text, values) => {
      if (text.includes("from artifacts as artifact")) {
        const artifactId = values[4];
        const document =
          artifactId === ids.permit
            ? fixture.permitDocument
            : artifactId === ids.sql
              ? fixture.sqlDocument
              : null;
        return {
          rows: document ? [{ document_json: document }] : [],
          rowCount: document ? 1 : 0,
        };
      }
      if (text.includes("verify_resolved_context_text2sql_binding")) {
        return { rows: [{ value: true }], rowCount: 1 };
      }
      if (text.includes("claim_text2sql_sandbox_execution")) {
        const command = JSON.parse(String(values[0])) as Record<string, unknown>;
        return {
          rows: [
            {
              value: {
                disposition: "ACCEPTED",
                claim: databaseClaim(fixture.identity, {
                  state: "CLAIMED",
                  branch_version: 1,
                  attempt_id: command.attempt_id,
                  lease_id: command.lease_id,
                  lease_expires_at: command.lease_expires_at,
                }),
              },
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes("mark_text2sql_sandbox_executing")) {
        const command = JSON.parse(String(values[0])) as Record<string, unknown>;
        return {
          rows: [
            {
              value: {
                disposition: "ACCEPTED",
                claim: databaseClaim(fixture.identity, {
                  attempt_id: command.attempt_id,
                  lease_id: command.lease_id,
                  lease_expires_at: "2026-07-27T00:01:30.000Z",
                  grant_hash: command.grant_hash,
                  snapshot_descriptor: command.snapshot_descriptor_json,
                }),
              },
            },
          ],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const authority = createPostgresText2SqlSandboxAuthority({
      pool: pool.pool,
      authorizer: capability.authorizer,
      capability: capability.capability,
      identity: authorityIdentity,
      owner_id: "sandbox-worker-1",
      snapshot_descriptors: [fixture.descriptor],
      snapshot_relation_manifests: [controlledRelationManifest(fixture.descriptor)],
      require_resolved_context_binding: true,
      now: () => new Date(observedAt),
    });

    const prepared = await prepareSandboxExecution(fixture.request, authority);

    expect(prepared).toMatchObject({
      disposition: "ACCEPTED",
      grant: {
        identity: fixture.identity,
        budget: fixture.budget,
        snapshot_descriptor: fixture.descriptor,
      },
      claim: {
        state: "EXECUTING",
        lease_id: expect.any(String),
      },
    });
    expect(pool.connects).toBe(1);
    expect(pool.releases).toBe(1);
    expect(pool.calls.filter(({ text }) => text === "BEGIN")).toHaveLength(1);
    expect(pool.calls.filter(({ text }) => text === "COMMIT")).toHaveLength(1);
    expect(
      pool.calls.filter(({ text }) => text.includes("from artifacts as artifact")),
    ).toHaveLength(4);
    const verifierIndex = pool.calls.findIndex(({ text }) =>
      text.includes("verify_resolved_context_text2sql_binding"),
    );
    const claimIndex = pool.calls.findIndex(({ text }) =>
      text.includes("claim_text2sql_sandbox_execution"),
    );
    expect(verifierIndex).toBeGreaterThanOrEqual(0);
    expect(verifierIndex).toBeLessThan(claimIndex);
    const claimCall = pool.calls.find(({ text }) =>
      text.includes("claim_text2sql_sandbox_execution"),
    );
    const claimCommand = JSON.parse(String(claimCall?.values[0])) as Record<string, unknown>;
    expect(claimCommand).toMatchObject({
      input_hash: fixture.identity.input_hash,
      owner_id: "sandbox-worker-1",
      request_json: {
        request: fixture.request,
      },
    });
  });

  it.each([
    {
      sql: "select pg_catalog.pg_sleep($1::pg_catalog.int4) as slept",
      compiler_version: "postgresql-compiler@1.1.0",
      code: "SANDBOX_DANGEROUS_FUNCTION_REJECTED",
    },
    {
      sql: "select $1::pg_catalog.text as region",
      compiler_version: "postgresql-compiler@999.0.0",
      code: "SANDBOX_SQL_SHAPE_REJECTED",
    },
  ])(
    "rejects $code before creating any durable claim or datasource grant",
    async ({ sql, compiler_version, code }) => {
      const fixture = await protocolFixture({ sql, compiler_version });
      const capability = issueCapability();
      const pool = scriptedPool((text, values) => {
        if (!text.includes("from artifacts as artifact")) return undefined;
        const artifactId = values[4];
        const document =
          artifactId === ids.permit
            ? fixture.permitDocument
            : artifactId === ids.sql
              ? fixture.sqlDocument
              : null;
        return {
          rows: document ? [{ document_json: document }] : [],
          rowCount: document ? 1 : 0,
        };
      });
      const authority = createPostgresText2SqlSandboxAuthority({
        pool: pool.pool,
        authorizer: capability.authorizer,
        capability: capability.capability,
        identity: authorityIdentity,
        owner_id: "sandbox-worker-1",
        snapshot_descriptors: [fixture.descriptor],
        snapshot_relation_manifests: [controlledRelationManifest(fixture.descriptor)],
        now: () => new Date(observedAt),
      });

      await expect(prepareSandboxExecution(fixture.request, authority)).rejects.toMatchObject({
        code,
      });
      expect(pool.calls.some(({ text }) => text.includes("claim_text2sql_sandbox_execution"))).toBe(
        false,
      );
      expect(pool.calls.some(({ text }) => text.includes("mark_text2sql_sandbox_executing"))).toBe(
        false,
      );
      expect(pool.calls.filter(({ text }) => text === "ROLLBACK")).toHaveLength(1);
    },
  );

  it("requires an authoritative Resolved Context binding before durable claim", async () => {
    const fixture = await protocolFixture();
    const capability = issueCapability();
    const pool = scriptedPool((text, values) => {
      if (!text.includes("from artifacts as artifact")) return undefined;
      const artifactId = values[4];
      const document =
        artifactId === ids.permit
          ? fixture.permitDocument
          : artifactId === ids.sql
            ? fixture.sqlDocument
            : null;
      return {
        rows: document ? [{ document_json: document }] : [],
        rowCount: document ? 1 : 0,
      };
    });
    const authority = createPostgresText2SqlSandboxAuthority({
      pool: pool.pool,
      authorizer: capability.authorizer,
      capability: capability.capability,
      identity: authorityIdentity,
      owner_id: "sandbox-worker-1",
      snapshot_descriptors: [fixture.descriptor],
      snapshot_relation_manifests: [controlledRelationManifest(fixture.descriptor)],
      require_resolved_context_binding: true,
      now: () => new Date(observedAt),
    });

    await expect(prepareSandboxExecution(fixture.request, authority)).rejects.toMatchObject({
      code: "SANDBOX_AUTHORITY_REJECTED",
    });
    expect(pool.calls.some(({ text }) => text.includes("claim_text2sql_sandbox_execution"))).toBe(
      false,
    );
    expect(pool.calls.some(({ text }) => text.includes("mark_text2sql_sandbox_executing"))).toBe(
      false,
    );
  });

  it("rejects a supplied Resolved Context binding when server authority denies it", async () => {
    const binding = resolvedContextBinding();
    const fixture = await protocolFixture({ resolved_context_binding: binding });
    const capability = issueCapability();
    const verify = vi.fn(async () => false);
    const pool = scriptedPool((text, values) => {
      if (!text.includes("from artifacts as artifact")) return undefined;
      const artifactId = values[4];
      const document =
        artifactId === ids.permit
          ? fixture.permitDocument
          : artifactId === ids.sql
            ? fixture.sqlDocument
            : null;
      return {
        rows: document ? [{ document_json: document }] : [],
        rowCount: document ? 1 : 0,
      };
    });
    const authority = createPostgresText2SqlSandboxAuthority({
      pool: pool.pool,
      authorizer: capability.authorizer,
      capability: capability.capability,
      identity: authorityIdentity,
      owner_id: "sandbox-worker-1",
      snapshot_descriptors: [fixture.descriptor],
      snapshot_relation_manifests: [controlledRelationManifest(fixture.descriptor)],
      require_resolved_context_binding: true,
      resolved_context_binding_authority: { verify },
      now: () => new Date(observedAt),
    });

    await expect(prepareSandboxExecution(fixture.request, authority)).rejects.toMatchObject({
      code: "SANDBOX_AUTHORITY_REJECTED",
    });
    expect(verify).toHaveBeenCalledWith({
      binding,
      scope: fixture.request.scope,
      run_id: fixture.request.run_id,
      sql_artifact_ref: fixture.request.payload.sql_artifact_ref,
    });
    expect(pool.calls.some(({ text }) => text.includes("claim_text2sql_sandbox_execution"))).toBe(
      false,
    );
  });

  it("uses the PostgreSQL currentness verifier by default before claim", async () => {
    const binding = resolvedContextBinding();
    const fixture = await protocolFixture({ resolved_context_binding: binding });
    const capability = issueCapability();
    const pool = scriptedPool((text, values) => {
      if (text.includes("verify_resolved_context_text2sql_binding")) {
        return { rows: [{ value: false }], rowCount: 1 };
      }
      if (!text.includes("from artifacts as artifact")) return undefined;
      const artifactId = values[4];
      const document =
        artifactId === ids.permit
          ? fixture.permitDocument
          : artifactId === ids.sql
            ? fixture.sqlDocument
            : null;
      return {
        rows: document ? [{ document_json: document }] : [],
        rowCount: document ? 1 : 0,
      };
    });
    const authority = createPostgresText2SqlSandboxAuthority({
      pool: pool.pool,
      authorizer: capability.authorizer,
      capability: capability.capability,
      identity: authorityIdentity,
      owner_id: "sandbox-worker-1",
      snapshot_descriptors: [fixture.descriptor],
      snapshot_relation_manifests: [controlledRelationManifest(fixture.descriptor)],
      require_resolved_context_binding: true,
      now: () => new Date(observedAt),
    });

    await expect(prepareSandboxExecution(fixture.request, authority)).rejects.toMatchObject({
      code: "SANDBOX_AUTHORITY_REJECTED",
    });
    const verifierCall = pool.calls.find(({ text }) =>
      text.includes("verify_resolved_context_text2sql_binding"),
    );
    expect(verifierCall?.values).toEqual([JSON.stringify(binding), ids.run]);
    expect(pool.calls.some(({ text }) => text.includes("claim_text2sql_sandbox_execution"))).toBe(
      false,
    );
  });

  it.each([
    {
      name: "sealed Snapshot Manifest 外的 relation",
      fixtureOptions: { sql: "select region from orders" },
      code: "SANDBOX_SQL_SHAPE_REJECTED",
    },
    {
      name: "顺序或成员不精确的 Controlled Snapshot search_path",
      fixtureOptions: {
        search_path: ["pg_catalog", "sandbox_fixture_v1"],
      },
      code: "SANDBOX_SNAPSHOT_AUTHORITY_BREACH",
    },
  ])("rejects $name before Claim", async ({ fixtureOptions, code }) => {
    const fixture = await protocolFixture(fixtureOptions);
    const capability = issueCapability();
    const pool = scriptedPool((text, values) => {
      if (!text.includes("from artifacts as artifact")) return undefined;
      const artifactId = values[4];
      const document =
        artifactId === ids.permit
          ? fixture.permitDocument
          : artifactId === ids.sql
            ? fixture.sqlDocument
            : null;
      return {
        rows: document ? [{ document_json: document }] : [],
        rowCount: document ? 1 : 0,
      };
    });
    const authority = createPostgresText2SqlSandboxAuthority({
      pool: pool.pool,
      authorizer: capability.authorizer,
      capability: capability.capability,
      identity: authorityIdentity,
      owner_id: "sandbox-worker-1",
      snapshot_descriptors: [fixture.descriptor],
      snapshot_relation_manifests: [controlledRelationManifest(fixture.descriptor)],
      now: () => new Date(observedAt),
    });

    await expect(prepareSandboxExecution(fixture.request, authority)).rejects.toMatchObject({
      code,
    });
    expect(pool.calls.some(({ text }) => text.includes("claim_text2sql_sandbox_execution"))).toBe(
      false,
    );
  });

  it.each([
    {
      state: "FAILED" as const,
      terminalReasonCode: "SANDBOX_QUERY_FAILED",
      cancelEpoch: 0,
      cancelRequestedAt: null,
    },
    {
      state: "CANCELLED" as const,
      terminalReasonCode: "SANDBOX_CANCELLED",
      cancelEpoch: 1,
      cancelRequestedAt: "2026-07-27T00:01:01.500Z",
    },
  ])(
    "preserves original $state claim behind REPLAY_UNAVAILABLE disposition",
    async ({ state, terminalReasonCode, cancelEpoch, cancelRequestedAt }) => {
      const fixture = await protocolFixture();
      const capability = issueCapability();
      const pool = scriptedPool((text, values) => {
        if (text.includes("from artifacts as artifact")) {
          const document = values[4] === ids.permit ? fixture.permitDocument : fixture.sqlDocument;
          return { rows: [{ document_json: document }], rowCount: 1 };
        }
        if (text.includes("claim_text2sql_sandbox_execution")) {
          return {
            rows: [
              {
                value: {
                  disposition: "REPLAY_UNAVAILABLE",
                  claim: databaseClaim(fixture.identity, {
                    state,
                    lease_id: null,
                    lease_expires_at: null,
                    cancel_epoch: cancelEpoch,
                    cancel_requested_at: cancelRequestedAt,
                    grant_hash: hash("f"),
                    snapshot_descriptor: fixture.descriptor,
                    terminal_reason_code: terminalReasonCode,
                  }),
                },
              },
            ],
            rowCount: 1,
          };
        }
        return undefined;
      });
      const authority = createPostgresText2SqlSandboxAuthority({
        pool: pool.pool,
        authorizer: capability.authorizer,
        capability: capability.capability,
        identity: authorityIdentity,
        owner_id: "sandbox-worker-1",
        snapshot_descriptors: [fixture.descriptor],
        snapshot_relation_manifests: [controlledRelationManifest(fixture.descriptor)],
        now: () => new Date(observedAt),
      });

      await expect(prepareSandboxExecution(fixture.request, authority)).resolves.toMatchObject({
        disposition: "REPLAY_UNAVAILABLE",
        reason_code: "SANDBOX_REPLAY_UNAVAILABLE",
        grant: null,
        claim: { state, terminal_reason_code: terminalReasonCode },
      });
      expect(pool.calls.some(({ text }) => text.includes("mark_text2sql_sandbox_executing"))).toBe(
        false,
      );
    },
  );

  it("rejects terminal database rows that still retain a lease instead of masking them", async () => {
    const fixture = await protocolFixture();
    const capability = issueCapability();
    const pool = scriptedPool((text) => {
      if (text.includes("from text2sql_sandbox_claims")) {
        return {
          rows: [
            databaseClaimRow(
              fixture.identity,
              {},
              {
                state: "COMPLETED",
                result_ref: reference("SandboxResult", ids.admission, hash("a")),
                receipt_ref: reference("SandboxExecutionReceipt", ids.policy, hash("b")),
                terminal_reason_code: "SANDBOX_EXECUTION_COMPLETED",
              },
            ),
          ],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const authority = createPostgresText2SqlSandboxAuthority({
      pool: pool.pool,
      authorizer: capability.authorizer,
      capability: capability.capability,
      identity: authorityIdentity,
      owner_id: "sandbox-worker-1",
      snapshot_descriptors: [fixture.descriptor],
      snapshot_relation_manifests: [controlledRelationManifest(fixture.descriptor)],
      now: () => new Date(observedAt),
    });

    await expect(
      cancelSandboxExecution(
        {
          identity: fixture.identity,
          expected_cancel_epoch: 0,
          requested_at: "2026-07-27T00:02:00.000Z",
        },
        authority,
      ),
    ).rejects.toMatchObject({ code: "SANDBOX_AUTHORITY_REJECTED" });
    expect(pool.calls.some(({ text }) => text.includes("request_text2sql_sandbox_cancel"))).toBe(
      false,
    );
    expect(pool.calls.some(({ text }) => text === "ROLLBACK")).toBe(true);
  });

  it("sends expected_cancel_epoch into the locked SQL cancel transition", async () => {
    const fixture = await protocolFixture();
    const capability = issueCapability();
    let cancelCommand: Record<string, unknown> | null = null;
    const currentRow = databaseClaimRow(
      fixture.identity,
      {},
      {
        grant_hash: hash("f"),
        snapshot_descriptor: fixture.descriptor,
      },
    );
    const pool = scriptedPool((text, values) => {
      if (text.includes("from text2sql_sandbox_claims")) {
        return { rows: [currentRow], rowCount: 1 };
      }
      if (text.includes("request_text2sql_sandbox_cancel")) {
        cancelCommand = JSON.parse(String(values[0])) as Record<string, unknown>;
        return {
          rows: [
            {
              value: {
                disposition: "CANCEL_ACCEPTED",
                claim: databaseClaim(fixture.identity, {
                  state: "CANCEL_REQUESTED",
                  cancel_epoch: 1,
                  cancel_requested_at: "2026-07-27T00:02:00.000Z",
                  grant_hash: hash("f"),
                  snapshot_descriptor: fixture.descriptor,
                }),
              },
            },
          ],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const authority = createPostgresText2SqlSandboxAuthority({
      pool: pool.pool,
      authorizer: capability.authorizer,
      capability: capability.capability,
      identity: authorityIdentity,
      owner_id: "sandbox-worker-1",
      snapshot_descriptors: [fixture.descriptor],
      snapshot_relation_manifests: [controlledRelationManifest(fixture.descriptor)],
      now: () => new Date(observedAt),
    });

    await expect(
      cancelSandboxExecution(
        {
          identity: fixture.identity,
          expected_cancel_epoch: 0,
          requested_at: "2026-07-27T00:02:00.000Z",
        },
        authority,
      ),
    ).resolves.toMatchObject({
      disposition: "CANCEL_ACCEPTED",
      claim: { cancel_epoch: 1 },
    });
    expect(cancelCommand).toMatchObject({
      expected_cancel_epoch: 0,
      expected_branch_version: 2,
    });
  });

  it("rejects a cancel when the epoch advances between public validation and store transaction", async () => {
    const fixture = await protocolFixture();
    const capability = issueCapability();
    let claimLoads = 0;
    const pool = scriptedPool((text) => {
      if (text.includes("from text2sql_sandbox_claims")) {
        claimLoads += 1;
        return {
          rows: [
            databaseClaimRow(
              fixture.identity,
              {},
              {
                cancel_epoch: claimLoads === 1 ? 0 : 1,
                grant_hash: hash("f"),
                snapshot_descriptor: fixture.descriptor,
              },
            ),
          ],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const authority = createPostgresText2SqlSandboxAuthority({
      pool: pool.pool,
      authorizer: capability.authorizer,
      capability: capability.capability,
      identity: authorityIdentity,
      owner_id: "sandbox-worker-1",
      snapshot_descriptors: [fixture.descriptor],
      snapshot_relation_manifests: [controlledRelationManifest(fixture.descriptor)],
      now: () => new Date(observedAt),
    });

    await expect(
      cancelSandboxExecution(
        {
          identity: fixture.identity,
          expected_cancel_epoch: 0,
          requested_at: "2026-07-27T00:02:00.000Z",
        },
        authority,
      ),
    ).rejects.toMatchObject({ code: "SANDBOX_OUTCOME_BINDING_MISMATCH" });
    expect(pool.calls.some(({ text }) => text.includes("request_text2sql_sandbox_cancel"))).toBe(
      false,
    );
  });

  it("cannot finalize by echoing another worker owner from the database claim", async () => {
    const fixture = await protocolFixture();
    const grant = await executionGrantFixture(fixture);
    const outcome = await completedOutcomeFixture(fixture, grant);
    const capability = issueCapability();
    const persistedPreparation = {
      request: fixture.request,
      permit: fixture.permitDocument.payload,
      sql_artifact: fixture.sqlDocument.payload,
      authority_revalidation: {
        effective_principal_id: ids.principal,
        policy_receipt_ref: fixture.identity.policy_receipt_ref,
        revalidated_at: observedAt,
        authority_epoch: 0,
      },
    };
    const currentRow = databaseClaimRow(fixture.identity, persistedPreparation, {
      owner_id: "sandbox-worker-a",
      grant_hash: grant.grant_hash,
      snapshot_descriptor: fixture.descriptor,
    });
    let finalizeCommand: Record<string, unknown> | null = null;
    const pool = scriptedPool((text, values) => {
      if (text.includes("from text2sql_sandbox_claims")) {
        return { rows: [currentRow], rowCount: 1 };
      }
      if (text.includes("text2sql_audience_context_hash")) {
        return { rows: [{ value: hash("a") }], rowCount: 1 };
      }
      if (text.includes("finalize_text2sql_sandbox_execution")) {
        finalizeCommand = JSON.parse(String(values[0])) as Record<string, unknown>;
        throw Object.assign(new Error("SANDBOX_STALE_FENCE"), { code: "40001" });
      }
      return undefined;
    });
    const authority = createPostgresText2SqlSandboxAuthority({
      pool: pool.pool,
      authorizer: capability.authorizer,
      capability: capability.capability,
      identity: authorityIdentity,
      owner_id: "sandbox-worker-b",
      snapshot_descriptors: [fixture.descriptor],
      snapshot_relation_manifests: [controlledRelationManifest(fixture.descriptor)],
      now: () => new Date(observedAt),
    });

    await expect(finalizeSandboxExecution(outcome, authority)).rejects.toMatchObject({
      code: "SANDBOX_STALE_EXECUTION_FENCE",
    });
    expect(finalizeCommand).toMatchObject({
      owner_id: "sandbox-worker-b",
    });
    expect(finalizeCommand).not.toMatchObject({
      owner_id: "sandbox-worker-a",
    });
  });

  it("lets the locked finalize observe a cancel committed after the pre-read and close CANCELLED", async () => {
    const fixture = await protocolFixture();
    const grant = await executionGrantFixture(fixture);
    const outcome = await completedOutcomeFixture(fixture, grant);
    const capability = issueCapability();
    const persistedPreparation = {
      request: fixture.request,
      permit: fixture.permitDocument.payload,
      sql_artifact: fixture.sqlDocument.payload,
      authority_revalidation: {
        effective_principal_id: ids.principal,
        policy_receipt_ref: fixture.identity.policy_receipt_ref,
        revalidated_at: observedAt,
        authority_epoch: 0,
      },
    };
    let claimLoads = 0;
    let finalizeCommand: Record<string, unknown> | null = null;
    const executingRow = databaseClaimRow(fixture.identity, persistedPreparation, {
      grant_hash: grant.grant_hash,
      snapshot_descriptor: fixture.descriptor,
    });
    const pool = scriptedPool((text, values) => {
      if (text.includes("from text2sql_sandbox_claims")) {
        claimLoads += 1;
        return { rows: [executingRow], rowCount: 1 };
      }
      if (text.includes("text2sql_audience_context_hash")) {
        return { rows: [{ value: hash("a") }], rowCount: 1 };
      }
      if (text.includes("finalize_text2sql_sandbox_execution")) {
        finalizeCommand = JSON.parse(String(values[0])) as Record<string, unknown>;
        return {
          rows: [
            {
              value: {
                disposition: "CANCEL_ACCEPTED",
                cancel_disposition: "AFTER_DATASOURCE_TERMINAL",
                claim: databaseClaim(fixture.identity, {
                  state: "CANCELLED",
                  branch_version: 4,
                  lease_id: null,
                  lease_expires_at: null,
                  cancel_epoch: 1,
                  cancel_requested_at: "2026-07-27T00:01:01.500Z",
                  grant_hash: grant.grant_hash,
                  snapshot_descriptor: fixture.descriptor,
                  terminal_reason_code: "SANDBOX_CANCELLED",
                }),
              },
            },
          ],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const authority = createPostgresText2SqlSandboxAuthority({
      pool: pool.pool,
      authorizer: capability.authorizer,
      capability: capability.capability,
      identity: authorityIdentity,
      owner_id: "sandbox-worker-1",
      snapshot_descriptors: [fixture.descriptor],
      snapshot_relation_manifests: [controlledRelationManifest(fixture.descriptor)],
      now: () => new Date(observedAt),
    });

    await expect(finalizeSandboxExecution(outcome, authority)).resolves.toMatchObject({
      disposition: "CANCEL_ACCEPTED",
      reason_code: "SANDBOX_CANCELLED",
      claim: {
        state: "CANCELLED",
        cancel_epoch: 1,
        terminal_reason_code: "SANDBOX_CANCELLED",
      },
    });
    expect(claimLoads).toBe(2);
    expect(pool.connects).toBe(2);
    expect(finalizeCommand).not.toHaveProperty("expected_branch_version");
    expect(finalizeCommand).toMatchObject({
      attempt_id: grant.attempt_id,
      lease_id: grant.lease_id,
      fence: grant.fencing_token,
      grant_hash: grant.grant_hash,
    });
  });

  it("recovers an expired executing claim without process-local state preconditions", async () => {
    const fixture = await protocolFixture();
    const capability = issueCapability();
    const persistedPreparation = {
      request: fixture.request,
      permit: fixture.permitDocument.payload,
      sql_artifact: fixture.sqlDocument.payload,
      authority_revalidation: {
        effective_principal_id: ids.principal,
        policy_receipt_ref: fixture.identity.policy_receipt_ref,
        revalidated_at: observedAt,
        authority_epoch: 0,
      },
    };
    const currentRow = databaseClaimRow(fixture.identity, persistedPreparation, {
      state: "EXECUTING",
      lease_expires_at: "2026-07-27T00:01:30.000Z",
      grant_hash: hash("f"),
      snapshot_descriptor: fixture.descriptor,
    });
    const pool = scriptedPool((text, values) => {
      if (text.includes("from text2sql_sandbox_claims")) {
        return { rows: [currentRow], rowCount: 1 };
      }
      if (text.includes("claim_text2sql_sandbox_execution")) {
        const command = JSON.parse(String(values[0])) as Record<string, unknown>;
        return {
          rows: [
            {
              value: {
                disposition: "ACCEPTED",
                claim: databaseClaim(fixture.identity, {
                  state: "CLAIMED",
                  branch_version: 3,
                  attempt_id: ids.recoveredAttempt,
                  attempt: 2,
                  fencing_token: 2,
                  lease_id: ids.recoveredLease,
                  lease_expires_at: command.lease_expires_at,
                }),
              },
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes("mark_text2sql_sandbox_executing")) {
        const command = JSON.parse(String(values[0])) as Record<string, unknown>;
        return {
          rows: [
            {
              value: {
                disposition: "ACCEPTED",
                claim: databaseClaim(fixture.identity, {
                  branch_version: 4,
                  attempt_id: ids.recoveredAttempt,
                  attempt: 2,
                  fencing_token: 2,
                  lease_id: ids.recoveredLease,
                  lease_expires_at: "2026-07-27T00:02:30.000Z",
                  grant_hash: command.grant_hash,
                  snapshot_descriptor: fixture.descriptor,
                }),
              },
            },
          ],
          rowCount: 1,
        };
      }
      return undefined;
    });
    const authority = createPostgresText2SqlSandboxAuthority({
      pool: pool.pool,
      authorizer: capability.authorizer,
      capability: capability.capability,
      identity: authorityIdentity,
      owner_id: "sandbox-worker-1",
      snapshot_descriptors: [fixture.descriptor],
      snapshot_relation_manifests: [controlledRelationManifest(fixture.descriptor)],
      now: () => new Date("2026-07-27T00:02:00.000Z"),
    });

    const recovered = await recoverSandboxExecution(
      {
        identity: fixture.identity,
        expected_attempt_id: ids.attempt,
        expected_fencing_token: 1,
        requested_at: "2026-07-27T00:02:00.000Z",
      },
      authority,
    );

    expect(recovered.grant).toMatchObject({
      attempt_id: ids.recoveredAttempt,
      attempt: 2,
      fencing_token: 2,
      lease_id: ids.recoveredLease,
    });
    const recoveryCall = pool.calls.find(({ text, values }) => {
      if (!text.includes("claim_text2sql_sandbox_execution")) return false;
      const command = JSON.parse(String(values[0])) as Record<string, unknown>;
      return command.expected_attempt_id !== undefined;
    });
    expect(JSON.parse(String(recoveryCall?.values[0]))).toMatchObject({
      expected_attempt_id: ids.attempt,
      expected_fencing_token: 1,
      recovery_requested_at: "2026-07-27T00:02:00.000Z",
    });
  });

  it("maps database conflict markers to the stable sandbox reason code", async () => {
    const fixture = await protocolFixture();
    const capability = issueCapability();
    const pool = scriptedPool((text, values) => {
      if (text.includes("from artifacts as artifact")) {
        const document = values[4] === ids.permit ? fixture.permitDocument : fixture.sqlDocument;
        return { rows: [{ document_json: document }], rowCount: 1 };
      }
      if (text.includes("claim_text2sql_sandbox_execution")) {
        throw Object.assign(new Error("SANDBOX_IDEMPOTENCY_CONFLICT"), { code: "23505" });
      }
      return undefined;
    });
    const authority = createPostgresText2SqlSandboxAuthority({
      pool: pool.pool,
      authorizer: capability.authorizer,
      capability: capability.capability,
      identity: authorityIdentity,
      owner_id: "sandbox-worker-1",
      snapshot_descriptors: [fixture.descriptor],
      snapshot_relation_manifests: [controlledRelationManifest(fixture.descriptor)],
      now: () => new Date(observedAt),
    });

    await expect(prepareSandboxExecution(fixture.request, authority)).resolves.toMatchObject({
      disposition: "IDEMPOTENCY_CONFLICT",
      reason_code: "SANDBOX_IDEMPOTENCY_CONFLICT",
    });
    expect(pool.calls.some(({ text }) => text === "COMMIT")).toBe(true);
  });
});
