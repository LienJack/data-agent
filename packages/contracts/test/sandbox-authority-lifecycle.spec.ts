import {
  cancelSandboxExecution,
  computeSandboxExecutionOutcomeChecksum,
  computeSnapshotDescriptorHash,
  executionGrantSchema,
  failSandboxExecution,
  finalizeSandboxExecution,
  prepareSandboxExecution,
  recoverSandboxExecution,
  registerSandboxServerAuthority,
  type SandboxExecutionAuthorityStore,
  sandboxExecutionAuthorityReasonCodeSchema,
  sandboxExecutionClaimStateSchema,
  sandboxExecutionOutcomeSchema,
  sandboxExecutionPrepareResultSchema,
  snapshotDescriptorSchema,
} from "@data-agent/contracts/server";
import { describe, expect, it, vi } from "vitest";
import { computePostgresqlExecutionSettingsHash } from "../src/artifacts/index.js";
import { sha256ContentHash } from "../src/common/index.js";
import {
  computeOrderedSandboxSqlParametersHash,
  computeSandboxCanonicalMultisetHash,
  computeSandboxOrderedResultHash,
  computeSandboxResultBytes,
  deriveOrderedSandboxSqlParameters,
  sandboxExecutionRequestSchema,
  sandboxSqlParametersSchema,
} from "../src/ports/index.js";
import { InMemorySandboxExecutionAuthorityStore } from "../src/testing/index.js";
import { environments, hashes, ids, makeArtifactReference } from "./fixtures.js";

const scope = {
  app_id: ids.appA,
  tenant_id: ids.tenantA,
  environment: environments.test,
} as const;

const authorityIdentity = {
  authority_id: "00000000-0000-4000-8000-000000000901",
  principal_id: "sandbox-authority",
  key_id: "sandbox-authority-key@1",
} as const;

async function makeProtocolFixture() {
  const sqlArtifactRef = makeArtifactReference("SqlArtifact");
  const executionPermitRef = makeArtifactReference("ExecutionPermit", ids.decision);
  const resourceAdmissionRef = makeArtifactReference("ResourceAdmissionReceipt", ids.inputArtifact);
  const policyReceiptRef = makeArtifactReference("PolicyReceipt", ids.snapshot);
  const executionSettings = {
    database_role: "analyst",
    search_path: ["app_data_agent", "pg_catalog"],
    plan_cache_mode: "force_custom_plan",
    statement_timeout_ms: 1_000,
    lock_timeout_ms: 100,
  } as const;
  const settingsHash = await computePostgresqlExecutionSettingsHash(executionSettings);
  const budget = {
    timeout_ms: 1_000,
    lock_timeout_ms: 100,
    max_rows: 1_000,
    max_bytes: 1_000_000,
    max_memory_mb: 256,
  } as const;
  const request = sandboxExecutionRequestSchema.parse({
    schema_version: "1.0.0",
    scope,
    run_id: ids.run,
    execution_id: ids.receipt,
    idempotency_key: "sandbox-authority-lifecycle",
    language: "sql",
    payload: {
      dialect: "postgresql",
      sql_artifact_ref: sqlArtifactRef,
      execution_permit_ref: executionPermitRef,
      resource_admission_ref: resourceAdmissionRef,
      datasource_id: ids.tenantA,
      settings_hash: settingsHash,
      execution_settings: executionSettings,
      snapshot_requirement: { mode: "REQUIRE_REPLAYABLE" },
      parameters: { $1: "south" },
    },
    budget,
  });
  if (request.language !== "sql") {
    throw new Error("fixture 必须是 SQL Sandbox Request");
  }
  const sqlMaterial = {
    dialect: "postgresql" as const,
    sql: "select $1::text as region",
    parameters: request.payload.parameters,
  };
  const sqlArtifact = {
    artifact_type: "SqlArtifact" as const,
    logical_plan_ref: {
      ...sqlArtifactRef,
      artifact_type: "LogicalPlan" as const,
    },
    compiler_version: "postgresql-compiler@1.1.0",
    ast_hash: hashes.artifact,
    ...sqlMaterial,
    query_hash: await sha256ContentHash(sqlMaterial),
  };
  const permit = {
    artifact_type: "ExecutionPermit" as const,
    sql_artifact_ref: sqlArtifactRef,
    resource_admission_ref: resourceAdmissionRef,
    gate_receipt_refs: [
      makeArtifactReference("GateReceipt", "00000000-0000-4000-8000-000000000101"),
      makeArtifactReference("GateReceipt", "00000000-0000-4000-8000-000000000102"),
      makeArtifactReference("GateReceipt", "00000000-0000-4000-8000-000000000103"),
      makeArtifactReference("GateReceipt", "00000000-0000-4000-8000-000000000104"),
      makeArtifactReference("GateReceipt", "00000000-0000-4000-8000-000000000105"),
    ],
    datasource_id: request.payload.datasource_id,
    schema_version: request.schema_version,
    settings_hash: request.payload.settings_hash,
    execution_settings: request.payload.execution_settings,
    principal_id: "principal-fixture",
    policy_receipt_ref: policyReceiptRef,
    budget: request.budget,
    issued_at: "2026-07-27T00:00:00.000Z",
    expires_at: "2026-07-27T00:05:00.000Z",
  };
  return { permit, request, sqlArtifact };
}

async function makeLifecycleAuthority() {
  const fixture = await makeProtocolFixture();
  const store = new InMemorySandboxExecutionAuthorityStore();
  const authority = registerSandboxServerAuthority({
    identity: authorityIdentity,
    executionAuthority: store,
    resolveSnapshotDescriptor: ({ identity, requested_at }) =>
      store.createSnapshotDescriptor(identity, requested_at),
    resolveCommitted: async () => null,
    verifyCommitted: async () => false,
    resolveAuthoritativeExecutionPermit: async () => fixture.permit,
    resolveAuthoritativeSqlArtifact: async () => fixture.sqlArtifact,
    verifyExactArtifactRevision: async () => true,
    revalidateExecutionAuthority: async (input) => ({
      effective_principal_id: input.effective_principal_id,
      policy_receipt_ref: input.policy_receipt_ref,
      revalidated_at: input.transaction_started_at,
      authority_epoch: 1,
    }),
    assertAuthorityFence: async () => true,
    withSqlTransaction: async <T>(operation: () => Promise<T>) => operation(),
    claimOrLoadExecution: async () => ({
      status: "CONFLICT",
      existing_input_hash: hashes.input,
    }),
    resolveExecutionRecord: async () => null,
    now: () => new Date("2026-07-27T00:01:00.000Z"),
  });
  const prepared = await prepareSandboxExecution(fixture.request, authority);
  if (!prepared.grant || !prepared.claim) {
    throw new Error("Lifecycle fixture 必须取得 ExecutionGrant。");
  }
  return { authority, fixture, grant: prepared.grant, claim: prepared.claim, store };
}

async function makeCompletedOutcome(
  grant: Awaited<ReturnType<typeof makeLifecycleAuthority>>["grant"],
) {
  const descriptor = grant.snapshot_descriptor;
  const result = {
    columns: [{ name: "result", type: "JSON" as const }],
    rows: [[1], [2], [1]],
  };
  const draft = {
    protocol_version: "sandbox-execution-outcome@1.0.0" as const,
    identity: grant.identity,
    grant_hash: grant.grant_hash,
    input_hash: grant.identity.input_hash,
    execution_id: grant.identity.execution_id,
    attempt_id: grant.attempt_id,
    execution_fence: grant.fencing_token,
    lease_id: grant.lease_id,
    cancel_epoch_at_start: grant.cancel_epoch,
    cancel_epoch_observed: grant.cancel_epoch,
    sql_artifact_hash: grant.identity.sql_artifact_ref.content_hash,
    snapshot_descriptor_hash: descriptor.descriptor_hash,
    fixture_manifest_hash: descriptor.fixture_manifest_hash,
    started_at: "2026-07-27T00:01:01.000Z",
    completed_at: "2026-07-27T00:01:02.000Z",
    terminal: "COMPLETED" as const,
    reason_code: "SANDBOX_EXECUTION_COMPLETED" as const,
    result,
    resource_facts: {
      elapsed_ms: 1_000,
      observed_rows: result.rows.length,
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
      cancel_epoch_at_start: grant.cancel_epoch,
      cancel_epoch_observed: grant.cancel_epoch,
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
      transaction_id: ids.assignment,
      read_only: true as const,
      isolation_level: "REPEATABLE_READ" as const,
    },
    applied_execution_settings: {
      database_role: "analyst",
      search_path: ["app_data_agent", "pg_catalog"],
      plan_cache_mode: "force_custom_plan" as const,
      statement_timeout_ms: 1_000,
      lock_timeout_ms: 100,
    },
    manifest_facts: {
      snapshot_descriptor_hash: descriptor.descriptor_hash,
      schema_manifest_hash: descriptor.schema_manifest_hash,
      data_manifest_hash: descriptor.data_manifest_hash,
      fixture_manifest_hash: descriptor.fixture_manifest_hash,
      manifest_revalidated: true,
      revalidated_at: "2026-07-27T00:01:01.000Z",
    },
    canonical_multiset_facts: {
      canonical_multiset_hash: await computeSandboxCanonicalMultisetHash(result.rows),
      ordered_result_hash: await computeSandboxOrderedResultHash(result),
    },
    outcome_checksum: hashes.input,
  };
  return {
    ...draft,
    outcome_checksum: await computeSandboxExecutionOutcomeChecksum(draft),
  };
}

async function makeNonCompletedOutcome(
  grant: Awaited<ReturnType<typeof makeLifecycleAuthority>>["grant"],
  terminal: "FAILED" | "CANCELLED",
) {
  const completed = await makeCompletedOutcome(grant);
  const cancelEpochObserved =
    terminal === "CANCELLED" ? grant.cancel_epoch + 1 : grant.cancel_epoch;
  const terminalFields =
    terminal === "FAILED"
      ? ({
          terminal: "FAILED",
          reason_code: "SANDBOX_QUERY_FAILED",
        } as const)
      : ({
          terminal: "CANCELLED",
          reason_code: "SANDBOX_CANCELLED",
        } as const);
  const draft = {
    ...completed,
    ...terminalFields,
    result: null,
    cancel_epoch_observed: cancelEpochObserved,
    resource_facts: {
      ...completed.resource_facts,
      observed_rows: 0,
      observed_bytes: 0,
      retained_canonical_bytes: 0,
      current_batch_estimated_bytes: 0,
      partial_output_discarded: false,
      cutoff_kind: "NONE" as const,
    },
    cancel_facts:
      terminal === "CANCELLED"
        ? {
            cancel_requested: true,
            query_cancel_dispatched: true,
            query_cancel_confirmed: true,
            cancel_disposition: "QUERY_CANCEL_CONFIRMED" as const,
            cancel_epoch_at_start: grant.cancel_epoch,
            cancel_epoch_observed: cancelEpochObserved,
            cancel_requested_at: "2026-07-27T00:01:01.500Z",
          }
        : completed.cancel_facts,
    manifest_facts: {
      ...completed.manifest_facts,
      manifest_revalidated: false,
    },
    canonical_multiset_facts: {
      canonical_multiset_hash: null,
      ordered_result_hash: null,
    },
    outcome_checksum: hashes.input,
  };
  return sandboxExecutionOutcomeSchema.parse({
    ...draft,
    outcome_checksum: await computeSandboxExecutionOutcomeChecksum(draft),
  });
}

describe("U5 Sandbox 三阶段 Authority Contract", () => {
  it("跨运行时 Hash 时间统一为 UTC 三位毫秒", async () => {
    const lifecycle = await makeLifecycleAuthority();
    const descriptor = lifecycle.grant.snapshot_descriptor;

    await expect(
      computeSnapshotDescriptorHash({
        ...descriptor,
        observed_at: "2026-07-27T00:00:00Z",
      }),
    ).resolves.toBe(
      await computeSnapshotDescriptorHash({
        ...descriptor,
        observed_at: "2026-07-27T00:00:00.000000Z",
      }),
    );
    await expect(
      computeSnapshotDescriptorHash({
        ...descriptor,
        observed_at: "2026-07-27T00:00:00.123Z",
      }),
    ).resolves.toBe(
      await computeSnapshotDescriptorHash({
        ...descriptor,
        observed_at: "2026-07-27T00:00:00.123999Z",
      }),
    );
  });

  it("区分 Claim State、API Disposition 与稳定 Reason Code", () => {
    expect(sandboxExecutionClaimStateSchema.parse("RECOVERY_PENDING")).toBe("RECOVERY_PENDING");
    expect(sandboxExecutionAuthorityReasonCodeSchema.parse("SANDBOX_STALE_EXECUTION_FENCE")).toBe(
      "SANDBOX_STALE_EXECUTION_FENCE",
    );
    expect(() => sandboxExecutionClaimStateSchema.parse("IDEMPOTENCY_CONFLICT")).toThrow();
    expect(sandboxExecutionAuthorityReasonCodeSchema.parse("SANDBOX_UNSUPPORTED_RESULT_TYPE")).toBe(
      "SANDBOX_UNSUPPORTED_RESULT_TYPE",
    );
  });

  it("$1…$12 Parameters 始终按数字位置派生，不能发生字典序重排", async () => {
    const parameters = Object.fromEntries(
      [1, 10, 11, 12, 2, 3, 4, 5, 6, 7, 8, 9].map((position) => [`$${position}`, position]),
    );
    const ordered = deriveOrderedSandboxSqlParameters(parameters);
    expect(ordered).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(await computeOrderedSandboxSqlParametersHash(parameters)).toBe(
      await sha256ContentHash(ordered),
    );
    expect(await computeOrderedSandboxSqlParametersHash(parameters)).not.toBe(
      await sha256ContentHash([1, 10, 11, 12, 2, 3, 4, 5, 6, 7, 8, 9]),
    );
    expect(sandboxSqlParametersSchema.safeParse({ $1: 1, $3: 3 }).success).toBe(false);
    expect(sandboxSqlParametersSchema.safeParse({ region: "south" }).success).toBe(false);
  });

  it("SnapshotDescriptor 只允许 CONTROLLED_REVISION 成为 REPLAYABLE", async () => {
    const descriptor = {
      protocol_version: "postgresql-snapshot@1.0.0",
      scope_hash: hashes.input,
      run_id: ids.run,
      execution_id: ids.receipt,
      principal_id: "principal-fixture",
      datasource_id: ids.tenantA,
      datasource_fingerprint: "postgresql://fixture-cluster",
      schema_version: "1.0.0",
      strategy: "NONE",
      intent: "CREATE",
      snapshot_token: "forged-snapshot",
      schema_manifest_hash: hashes.artifact,
      data_manifest_hash: hashes.execution,
      fixture_manifest_hash: hashes.input,
      observed_at: "2026-07-27T00:00:00.000Z",
      replay_state: "REPLAYABLE",
      descriptor_hash: hashes.input,
    };
    expect(snapshotDescriptorSchema.safeParse(descriptor).success).toBe(false);
  });

  it("ExecutionGrant 与 Outcome 都是 strict schema，且 cancel epoch 不得倒退", () => {
    expect(
      executionGrantSchema.safeParse({
        unexpected: true,
      }).success,
    ).toBe(false);
    expect(
      sandboxExecutionOutcomeSchema.safeParse({
        protocol_version: "sandbox-execution-outcome@1.0.0",
        cancel_epoch_at_start: 2,
        cancel_epoch_observed: 1,
      }).success,
    ).toBe(false);
  });

  it("prepare/finalize/fail/cancel/recover 通过独立 Authority Store 暴露", async () => {
    const fixture = await makeProtocolFixture();
    const store = {
      prepareExecution: vi.fn(async () => ({ disposition: "REJECTED" })),
      finalizeExecution: vi.fn(async () => ({ disposition: "REJECTED" })),
      failExecution: vi.fn(async () => ({ disposition: "REJECTED" })),
      cancelExecution: vi.fn(async () => ({ disposition: "REJECTED" })),
      recoverExecution: vi.fn(async () => ({ disposition: "REJECTED" })),
      resolveExecutionClaim: vi.fn(async () => null),
    } satisfies SandboxExecutionAuthorityStore;
    const snapshotStore = new InMemorySandboxExecutionAuthorityStore();
    const authority = registerSandboxServerAuthority({
      identity: authorityIdentity,
      executionAuthority: store,
      resolveSnapshotDescriptor: ({ identity, requested_at }) =>
        snapshotStore.createSnapshotDescriptor(identity, requested_at),
      resolveCommitted: async () => null,
      verifyCommitted: async () => false,
      resolveAuthoritativeExecutionPermit: async () => fixture.permit,
      resolveAuthoritativeSqlArtifact: async () => fixture.sqlArtifact,
      verifyExactArtifactRevision: async () => true,
      revalidateExecutionAuthority: async (input) => ({
        effective_principal_id: input.effective_principal_id,
        policy_receipt_ref: input.policy_receipt_ref,
        revalidated_at: input.transaction_started_at,
        authority_epoch: 1,
      }),
      assertAuthorityFence: async () => true,
      withSqlTransaction: async <T>(operation: () => Promise<T>) => operation(),
      claimOrLoadExecution: async () => ({ status: "CONFLICT", existing_input_hash: hashes.input }),
      resolveExecutionRecord: async () => null,
      now: () => new Date("2026-07-27T00:01:00.000Z"),
    });

    await expect(prepareSandboxExecution(fixture.request, authority)).rejects.toMatchObject({
      code: "SANDBOX_AUTHORITY_REJECTED",
    });
    await expect(finalizeSandboxExecution({}, authority)).rejects.toBeDefined();
    await expect(failSandboxExecution({}, authority)).rejects.toBeDefined();
    await expect(cancelSandboxExecution({}, authority)).rejects.toBeDefined();
    await expect(recoverSandboxExecution({}, authority)).rejects.toBeDefined();
    expect(sandboxExecutionPrepareResultSchema.safeParse({ disposition: "REJECTED" }).success).toBe(
      false,
    );
  });

  it("prepare 签发精确 Attempt/Fence/Lease/Snapshot 绑定的 Grant", async () => {
    const lifecycle = await makeLifecycleAuthority();
    expect(lifecycle.grant).toMatchObject({
      attempt: 1,
      fencing_token: 1,
      cancel_epoch: 0,
      fixture_manifest_hash: lifecycle.grant.snapshot_descriptor.fixture_manifest_hash,
    });
    expect(lifecycle.claim.identity).toStrictEqual(lifecycle.grant.identity);
    expect(
      executionGrantSchema.safeParse({
        ...lifecycle.grant,
        lease_expires_at: "2026-07-27T00:06:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("COMPLETED Claim 同时封存 Result/Receipt refs，Prepare REPLAYED 可直接重放 receipt", async () => {
    const lifecycle = await makeLifecycleAuthority();
    const outcome = await makeCompletedOutcome(lifecycle.grant);
    const completed = await finalizeSandboxExecution(outcome, lifecycle.authority);
    expect(completed.claim).toMatchObject({
      state: "COMPLETED",
      result_ref: { artifact_type: "SandboxResult" },
      receipt_ref: { artifact_type: "SandboxExecutionReceipt" },
    });

    const replayed = await prepareSandboxExecution(lifecycle.fixture.request, lifecycle.authority);
    expect(replayed).toMatchObject({
      disposition: "REPLAYED",
      claim: {
        state: "COMPLETED",
        receipt_ref: completed.claim?.receipt_ref,
      },
    });
  });

  it("REPLAY_UNAVAILABLE prepare 保留原始 FAILED/CANCELLED 终态，且非成功终态无需伪报 manifest 已复核", async () => {
    const failedLifecycle = await makeLifecycleAuthority();
    const failedOutcome = await makeNonCompletedOutcome(failedLifecycle.grant, "FAILED");
    const failed = await failSandboxExecution(failedOutcome, failedLifecycle.authority);
    expect(
      sandboxExecutionPrepareResultSchema.parse({
        schema_version: "sandbox-execution-authority-result@1.0.0",
        disposition: "REPLAY_UNAVAILABLE",
        reason_code: "SANDBOX_REPLAY_UNAVAILABLE",
        claim: failed.claim,
        grant: null,
      }),
    ).toMatchObject({
      disposition: "REPLAY_UNAVAILABLE",
      claim: {
        state: "FAILED",
        terminal_reason_code: "SANDBOX_QUERY_FAILED",
      },
    });

    const cancelledLifecycle = await makeLifecycleAuthority();
    await cancelSandboxExecution(
      {
        identity: cancelledLifecycle.grant.identity,
        expected_cancel_epoch: cancelledLifecycle.grant.cancel_epoch,
        requested_at: "2026-07-27T00:01:01.500Z",
      },
      cancelledLifecycle.authority,
    );
    const cancelledOutcome = await makeNonCompletedOutcome(cancelledLifecycle.grant, "CANCELLED");
    const cancelled = await finalizeSandboxExecution(
      cancelledOutcome,
      cancelledLifecycle.authority,
    );
    expect(
      sandboxExecutionPrepareResultSchema.parse({
        schema_version: "sandbox-execution-authority-result@1.0.0",
        disposition: "REPLAY_UNAVAILABLE",
        reason_code: "SANDBOX_REPLAY_UNAVAILABLE",
        claim: cancelled.claim,
        grant: null,
      }),
    ).toMatchObject({
      disposition: "REPLAY_UNAVAILABLE",
      claim: {
        state: "CANCELLED",
        terminal_reason_code: "SANDBOX_CANCELLED",
      },
    });
  });

  it("只有 COMPLETED 强制 manifest_revalidated=true，所有终态仍精确绑定 descriptor/hash", async () => {
    const completedLifecycle = await makeLifecycleAuthority();
    const completed = await makeCompletedOutcome(completedLifecycle.grant);
    const unvalidatedCompletedDraft = {
      ...completed,
      manifest_facts: {
        ...completed.manifest_facts,
        manifest_revalidated: false,
      },
    };
    const unvalidatedCompletedChecksum = await computeSandboxExecutionOutcomeChecksum({
      ...unvalidatedCompletedDraft,
      outcome_checksum: hashes.input,
    });
    await expect(
      finalizeSandboxExecution(
        {
          ...unvalidatedCompletedDraft,
          outcome_checksum: unvalidatedCompletedChecksum,
        },
        completedLifecycle.authority,
      ),
    ).rejects.toMatchObject({ code: "SANDBOX_OUTCOME_BINDING_MISMATCH" });

    const failedLifecycle = await makeLifecycleAuthority();
    const failed = await makeNonCompletedOutcome(failedLifecycle.grant, "FAILED");
    const driftedDraft = {
      ...failed,
      manifest_facts: {
        ...failed.manifest_facts,
        schema_manifest_hash: hashes.execution,
      },
    };
    const driftedChecksum = await computeSandboxExecutionOutcomeChecksum({
      ...driftedDraft,
      outcome_checksum: hashes.input,
    });
    await expect(
      failSandboxExecution(
        { ...driftedDraft, outcome_checksum: driftedChecksum },
        failedLifecycle.authority,
      ),
    ).rejects.toMatchObject({ code: "SANDBOX_OUTCOME_BINDING_MISMATCH" });
  });

  it("finalize 拒绝旧 attempt/fence/lease 与不可变 Identity 换绑", async () => {
    const lifecycle = await makeLifecycleAuthority();
    const outcome = await makeCompletedOutcome(lifecycle.grant);
    const stale = {
      ...outcome,
      execution_fence: outcome.execution_fence + 1,
    };
    const staleChecksum = await computeSandboxExecutionOutcomeChecksum({
      ...stale,
      outcome_checksum: hashes.input,
    });
    await expect(
      finalizeSandboxExecution({ ...stale, outcome_checksum: staleChecksum }, lifecycle.authority),
    ).rejects.toMatchObject({ code: "SANDBOX_STALE_EXECUTION_FENCE" });

    const rebound = {
      ...outcome,
      identity: {
        ...outcome.identity,
        execution_id: ids.command,
      },
      execution_id: ids.command,
    };
    const reboundChecksum = await computeSandboxExecutionOutcomeChecksum({
      ...rebound,
      outcome_checksum: hashes.input,
    });
    await expect(
      finalizeSandboxExecution(
        { ...rebound, outcome_checksum: reboundChecksum },
        lifecycle.authority,
      ),
    ).rejects.toMatchObject({ code: "SANDBOX_OUTCOME_BINDING_MISMATCH" });
  });

  it("cancel epoch 单调；late cancel 丢弃成功候选并关闭为 CANCELLED", async () => {
    const lifecycle = await makeLifecycleAuthority();
    const outcome = await makeCompletedOutcome(lifecycle.grant);
    const cancelled = await cancelSandboxExecution(
      {
        identity: lifecycle.grant.identity,
        expected_cancel_epoch: 0,
        requested_at: "2026-07-27T00:01:01.500Z",
      },
      lifecycle.authority,
    );
    expect(cancelled.claim?.cancel_epoch).toBe(1);

    const result = await finalizeSandboxExecution(outcome, lifecycle.authority);
    expect(result).toMatchObject({
      disposition: "CANCEL_ACCEPTED",
      reason_code: "SANDBOX_CANCELLED",
      claim: { state: "CANCELLED" },
    });
  });

  it("拒绝越过当前 Claim 的 cancel epoch 与 recovery 后的旧 Outcome", async () => {
    const epochLifecycle = await makeLifecycleAuthority();
    const outcome = await makeCompletedOutcome(epochLifecycle.grant);
    const futureEpochDraft = {
      ...outcome,
      cancel_epoch_observed: 1,
      cancel_facts: {
        ...outcome.cancel_facts,
        cancel_epoch_observed: 1,
      },
    };
    const futureEpochChecksum = await computeSandboxExecutionOutcomeChecksum({
      ...futureEpochDraft,
      outcome_checksum: hashes.input,
    });
    await expect(
      finalizeSandboxExecution(
        { ...futureEpochDraft, outcome_checksum: futureEpochChecksum },
        epochLifecycle.authority,
      ),
    ).rejects.toMatchObject({ code: "SANDBOX_OUTCOME_BINDING_MISMATCH" });

    const recoveryLifecycle = await makeLifecycleAuthority();
    const oldOutcome = await makeCompletedOutcome(recoveryLifecycle.grant);
    recoveryLifecycle.store.markRecoveryPending(
      recoveryLifecycle.grant.identity,
      "2026-07-27T00:02:00.000Z",
    );
    const recovered = await recoverSandboxExecution(
      {
        identity: recoveryLifecycle.grant.identity,
        expected_attempt_id: recoveryLifecycle.grant.attempt_id,
        expected_fencing_token: recoveryLifecycle.grant.fencing_token,
        requested_at: "2026-07-27T00:02:01.000Z",
      },
      recoveryLifecycle.authority,
    );
    expect(recovered.grant).toMatchObject({
      attempt: 2,
      fencing_token: 2,
    });
    await expect(
      finalizeSandboxExecution(oldOutcome, recoveryLifecycle.authority),
    ).rejects.toMatchObject({ code: "SANDBOX_STALE_EXECUTION_FENCE" });
  });

  it("Outcome 的 RR/RO transaction 与 settings readback 必须精确绑定 Identity", async () => {
    const lifecycle = await makeLifecycleAuthority();
    const outcome = await makeCompletedOutcome(lifecycle.grant);
    const drifted = {
      ...outcome,
      applied_execution_settings: {
        ...outcome.applied_execution_settings,
        search_path: ["attacker_schema", "pg_catalog"],
      },
    };
    const checksum = await computeSandboxExecutionOutcomeChecksum({
      ...drifted,
      outcome_checksum: hashes.input,
    });
    await expect(
      finalizeSandboxExecution({ ...drifted, outcome_checksum: checksum }, lifecycle.authority),
    ).rejects.toMatchObject({ code: "SANDBOX_OUTCOME_BINDING_MISMATCH" });
  });

  it("Outcome 不能低报或越过五维 Budget，成功 Result facts 必须精确一致", async () => {
    const lifecycle = await makeLifecycleAuthority();
    const outcome = await makeCompletedOutcome(lifecycle.grant);
    expect(sandboxExecutionOutcomeSchema.safeParse(outcome).success).toBe(true);

    const invalidOutcomes = [
      {
        ...outcome,
        resource_facts: {
          ...outcome.resource_facts,
          elapsed_ms: outcome.identity.budget.timeout_ms + 1,
        },
      },
      {
        ...outcome,
        completed_at: "2026-07-27T00:01:02.001Z",
      },
      {
        ...outcome,
        resource_facts: {
          ...outcome.resource_facts,
          observed_rows: outcome.identity.budget.max_rows + 1,
        },
      },
      {
        ...outcome,
        resource_facts: {
          ...outcome.resource_facts,
          observed_bytes: outcome.identity.budget.max_bytes + 1,
        },
      },
      {
        ...outcome,
        resource_facts: {
          ...outcome.resource_facts,
          peak_memory_mb: outcome.identity.budget.max_memory_mb + 1,
        },
      },
      {
        ...outcome,
        resource_facts: {
          ...outcome.resource_facts,
          observed_rows: outcome.resource_facts.observed_rows + 1,
        },
      },
      {
        ...outcome,
        resource_facts: {
          ...outcome.resource_facts,
          observed_bytes: outcome.resource_facts.observed_bytes - 1,
        },
      },
      {
        ...outcome,
        result: {
          columns: Array.from({ length: 257 }, (_, index) => ({
            name: `column_${index}`,
            type: "JSON" as const,
          })),
          rows: [],
        },
      },
    ];
    for (const candidate of invalidOutcomes) {
      expect(sandboxExecutionOutcomeSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it("成功 Outcome 的 multiset 保留重复且忽略行序，ordered hash 则绑定精确顺序", async () => {
    const lifecycle = await makeLifecycleAuthority();
    const outcome = await makeCompletedOutcome(lifecycle.grant);
    const reorderedRows = [[2], [1], [1]];
    const deduplicatedRows = [[1], [2]];

    expect(await computeSandboxCanonicalMultisetHash(reorderedRows)).toBe(
      outcome.canonical_multiset_facts.canonical_multiset_hash,
    );
    expect(await computeSandboxCanonicalMultisetHash(deduplicatedRows)).not.toBe(
      outcome.canonical_multiset_facts.canonical_multiset_hash,
    );
    expect(
      await computeSandboxOrderedResultHash({
        ...outcome.result,
        rows: reorderedRows,
      }),
    ).not.toBe(outcome.canonical_multiset_facts.ordered_result_hash);

    const forgedDraft = {
      ...outcome,
      canonical_multiset_facts: {
        canonical_multiset_hash: hashes.input,
        ordered_result_hash: hashes.artifact,
      },
    };
    const forgedChecksum = await computeSandboxExecutionOutcomeChecksum({
      ...forgedDraft,
      outcome_checksum: hashes.input,
    });
    await expect(
      finalizeSandboxExecution(
        { ...forgedDraft, outcome_checksum: forgedChecksum },
        lifecycle.authority,
      ),
    ).rejects.toMatchObject({ code: "SANDBOX_OUTCOME_BINDING_MISMATCH" });
  });
});
