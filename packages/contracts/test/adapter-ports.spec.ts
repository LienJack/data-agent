import * as contractsRoot from "@data-agent/contracts";
import {
  isAuthoritativeSandboxExecutionReceipt,
  isAuthoritativeSandboxResult,
} from "@data-agent/contracts";
import {
  authorizeSandboxExecutionReceipt,
  authorizeSandboxResult,
  executeAuthorizedSandboxRequest,
  getAuthoritativeSandboxExecutionIdentity,
  isAuthoritativeSandboxExecutionIdentity,
  registerSandboxServerAuthority,
  type SandboxServerAuthorityRegistration,
} from "@data-agent/contracts/server";
import { describe, expect, it } from "vitest";
import {
  type ArtifactReference,
  artifactReferenceIdentity,
  computePostgresqlExecutionSettingsHash,
} from "../src/artifacts/index.js";
import { canonicalizeJson, sha256ContentHash } from "../src/common/index.js";
import {
  authorizeBenchmarkAdapterReceipt,
  authorizeExternalAgentInvocation,
  authorizeModelProviderInvocation,
  type BenchmarkSuiteAdapter,
  benchmarkAdapterEventSchema,
  benchmarkAdapterRequestSchema,
  computeSandboxExecutionReceiptHash,
  computeSandboxExecutionRequestHash,
  computeSandboxResultBytes,
  computeSandboxResultHash,
  type ExternalAgentPort,
  externalAgentEventSchema,
  externalAgentRequestSchema,
  isAuthoritativeBenchmarkAdapterReceipt,
  isAuthoritativeExternalAgentInvocation,
  isAuthoritativeModelProviderInvocation,
  type ModelProviderPort,
  modelProviderEventSchema,
  modelProviderRequestSchema,
  parseBenchmarkAdapterEventForRequest,
  parseExternalAgentEventForRequest,
  parseModelProviderEventForRequest,
  SANDBOX_RESULT_LIMITS,
  sandboxExecutionReceiptSchema,
  sandboxExecutionRequestSchema,
  sandboxResultSchema,
  successfulSandboxExecutionReceiptSchema,
} from "../src/ports/index.js";
import { authorizeAvailableModelProfile, computeModelProfileHash } from "../src/providers/index.js";
import { InMemorySandboxPort } from "../src/testing/index.js";
import { environments, hashes, ids, makeArtifactReference } from "./fixtures.js";

const scope = {
  app_id: ids.appA,
  tenant_id: ids.tenantA,
  environment: environments.test,
} as const;

const baseAttempt = {
  schema_version: "1.0.0",
  attempt_id: ids.attempt,
  scope,
  run_id: ids.run,
} as const;

async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => {
      resolvePromise?.();
    },
  };
}

const sandboxExecutionSettings = {
  database_role: "analyst",
  search_path: ["app_data_agent", "pg_catalog"],
  plan_cache_mode: "force_custom_plan",
  statement_timeout_ms: 1_000,
  lock_timeout_ms: 100,
} as const;

const sandboxBudget = {
  timeout_ms: 1_000,
  lock_timeout_ms: 100,
  max_rows: 1_000,
  max_bytes: 1_000_000,
  max_memory_mb: 256,
} as const;

const sandboxAuthorityIdentity = {
  authority_id: "00000000-0000-4000-8000-000000000701",
  principal_id: "sandbox-authority-principal",
  key_id: "sandbox-authority-key@1",
} as const;

function authorizeSandboxRequestForTest(
  input: unknown,
  authority: Parameters<typeof executeAuthorizedSandboxRequest>[1],
) {
  return executeAuthorizedSandboxRequest(input, authority, async () => true);
}

async function createSandboxAuthorityFixture(
  options: { readonly authorityRevalidatedAt?: string; readonly resultSchemaVersion?: string } = {},
) {
  const sqlArtifactReference = makeArtifactReference("SqlArtifact");
  const executionPermitReference = makeArtifactReference("ExecutionPermit", ids.decision);
  const resourceAdmissionReference = makeArtifactReference(
    "ResourceAdmissionReceipt",
    ids.inputArtifact,
  );
  const policyReceiptReference = makeArtifactReference("PolicyReceipt", ids.snapshot);
  const settingsHash = await computePostgresqlExecutionSettingsHash(sandboxExecutionSettings);
  const permit = {
    artifact_type: "ExecutionPermit",
    sql_artifact_ref: sqlArtifactReference,
    resource_admission_ref: resourceAdmissionReference,
    gate_receipt_refs: [
      makeArtifactReference("GateReceipt", "00000000-0000-4000-8000-000000000101"),
      makeArtifactReference("GateReceipt", "00000000-0000-4000-8000-000000000102"),
      makeArtifactReference("GateReceipt", "00000000-0000-4000-8000-000000000103"),
      makeArtifactReference("GateReceipt", "00000000-0000-4000-8000-000000000104"),
      makeArtifactReference("GateReceipt", "00000000-0000-4000-8000-000000000105"),
    ],
    datasource_id: ids.tenantA,
    schema_version: "1.0.0",
    settings_hash: settingsHash,
    execution_settings: sandboxExecutionSettings,
    principal_id: "principal-fixture",
    policy_receipt_ref: policyReceiptReference,
    budget: sandboxBudget,
    issued_at: "2026-07-24T23:59:00.000Z",
    expires_at: "2026-07-25T00:04:00.000Z",
  } as const;
  const request = sandboxExecutionRequestSchema.parse({
    schema_version: "1.0.0",
    scope,
    run_id: ids.run,
    execution_id: ids.receipt,
    idempotency_key: "sandbox-1",
    language: "sql",
    payload: {
      dialect: "postgresql",
      sql_artifact_ref: sqlArtifactReference,
      execution_permit_ref: executionPermitReference,
      resource_admission_ref: resourceAdmissionReference,
      datasource_id: permit.datasource_id,
      settings_hash: settingsHash,
      execution_settings: sandboxExecutionSettings,
      snapshot_requirement: {
        mode: "REQUIRE_REPLAYABLE",
      },
      parameters: {},
    },
    budget: sandboxBudget,
  });
  if (request.language !== "sql") {
    throw new Error("Sandbox Authority Fixture 必须生成 SQL Request。");
  }
  const inputHash = await computeSandboxExecutionRequestHash(request);
  const columns = [
    { name: "region", type: "STRING" },
    { name: "revenue", type: "NUMBER" },
  ] as const;
  const rows = [
    ["south", 120.5],
    ["north", 80],
  ] as const;
  const resultDraft = {
    schema_version: options.resultSchemaVersion ?? request.schema_version,
    result_ref: makeArtifactReference("SandboxResult", ids.artifact),
    scope,
    run_id: ids.run,
    execution_id: ids.receipt,
    columns,
    rows,
    row_count: rows.length,
    bytes: computeSandboxResultBytes({ columns, rows }),
    result_hash: hashes.input,
  } as const;
  const resultHash = await computeSandboxResultHash(resultDraft);
  const result = sandboxResultSchema.parse({
    ...resultDraft,
    result_ref: {
      ...resultDraft.result_ref,
      content_hash: resultHash,
    },
    result_hash: resultHash,
  });
  const snapshot = {
    snapshot_token: "snapshot-1",
    watermark: null,
    replay_state: "REPLAYABLE",
  } as const;
  const transaction = {
    transaction_id: ids.attempt,
    read_only: true,
    isolation_level: "REPEATABLE_READ",
  } as const;
  const authorityRevalidation = {
    effective_principal_id: permit.principal_id,
    policy_receipt_ref: permit.policy_receipt_ref,
    revalidated_at: options.authorityRevalidatedAt ?? "2026-07-25T00:00:00.000Z",
    authority_epoch: 7,
  } as const;

  const receiptDraft = {
    schema_version: request.schema_version,
    language: "sql",
    executor: sandboxAuthorityIdentity,
    executor_role: "SANDBOX_EXECUTION",
    authority_role_policy_version: "authority_role_policy@1.0.0",
    receipt_id: ids.receipt,
    receipt_ref: makeArtifactReference("SandboxExecutionReceipt", ids.receipt),
    scope,
    run_id: ids.run,
    execution_id: ids.receipt,
    idempotency_key: "sandbox-1",
    input_hash: inputHash,
    execution_hash: hashes.input,
    terminal: "COMPLETED",
    reason_code: "EXECUTION_COMPLETED",
    started_at: "2026-07-25T00:00:00.000Z",
    completed_at: "2026-07-25T00:00:01.000Z",
    result_artifact_ref: result.result_ref,
    sql_artifact_ref: request.payload.sql_artifact_ref,
    execution_permit_ref: request.payload.execution_permit_ref,
    resource_admission_ref: request.payload.resource_admission_ref,
    datasource_id: request.payload.datasource_id,
    settings_hash: request.payload.settings_hash,
    execution_settings: request.payload.execution_settings,
    transaction,
    authority_revalidation: authorityRevalidation,
    snapshot_token: snapshot.snapshot_token,
    watermark: snapshot.watermark,
    replay_state: snapshot.replay_state,
    resource_usage: {
      elapsed_ms: 1_000,
      rows: result.row_count,
      bytes: result.bytes,
      peak_memory_mb: 1,
    },
  } as const;
  const executionHash = await computeSandboxExecutionReceiptHash(receiptDraft);
  const receipt = successfulSandboxExecutionReceiptSchema.parse({
    ...receiptDraft,
    receipt_ref: {
      ...receiptDraft.receipt_ref,
      content_hash: executionHash,
    },
    execution_hash: executionHash,
  });
  const sqlArtifactMaterial = {
    dialect: "postgresql",
    sql: "select region, revenue from governed_result",
    parameters: request.payload.parameters,
  } as const;
  const sqlArtifact = {
    artifact_type: "SqlArtifact",
    logical_plan_ref: {
      ...sqlArtifactReference,
      artifact_type: "LogicalPlan",
      content_hash: hashes.artifact,
    },
    compiler_version: "postgresql-compiler@1.1.0",
    ast_hash: hashes.artifact,
    ...sqlArtifactMaterial,
    query_hash: await sha256ContentHash(sqlArtifactMaterial),
  } as const;
  const committed = new Map<string, unknown>([
    [artifactReferenceIdentity(executionPermitReference), permit],
    [artifactReferenceIdentity(sqlArtifactReference), sqlArtifact],
    [artifactReferenceIdentity(result.result_ref), result],
    [artifactReferenceIdentity(receipt.receipt_ref), receipt],
  ]);
  const record = {
    request,
    started_at: receipt.started_at,
    completed_at: receipt.completed_at,
    result_artifact_ref: result.result_ref,
    datasource_id: permit.datasource_id,
    schema_version: permit.schema_version,
    settings_hash: permit.settings_hash,
    applied_execution_settings: permit.execution_settings,
    transaction,
    authority_revalidation: authorityRevalidation,
    snapshot,
    resource_usage: receipt.resource_usage,
  };
  const callbacks = {
    identity: sandboxAuthorityIdentity,
    resolveCommitted: async (reference: Parameters<typeof artifactReferenceIdentity>[0]) =>
      committed.get(artifactReferenceIdentity(reference)) ?? null,
    verifyCommitted: async (reference: Parameters<typeof artifactReferenceIdentity>[0]) =>
      committed.has(artifactReferenceIdentity(reference)),
    resolveAuthoritativeExecutionPermit: async (reference: ArtifactReference) =>
      artifactReferenceIdentity(reference) === artifactReferenceIdentity(executionPermitReference)
        ? permit
        : null,
    resolveAuthoritativeSqlArtifact: async (reference: ArtifactReference) =>
      artifactReferenceIdentity(reference) === artifactReferenceIdentity(sqlArtifactReference)
        ? sqlArtifact
        : null,
    verifyExactArtifactRevision: async (reference: ArtifactReference, artifact: unknown) => {
      const authoritative = committed.get(artifactReferenceIdentity(reference));
      return (
        authoritative !== undefined &&
        canonicalizeJson(authoritative) === canonicalizeJson(artifact)
      );
    },
    revalidateExecutionAuthority: async () => authorityRevalidation,
    assertAuthorityFence: async () => true,
    withSqlTransaction: async <T>(operation: () => Promise<T>) => operation(),
    claimOrLoadExecution: async <T>(
      _claim: Parameters<SandboxServerAuthorityRegistration["claimOrLoadExecution"]>[0],
      operation: () => Promise<T>,
    ) => ({
      status: "EXECUTED" as const,
      value: await operation(),
    }),
    resolveExecutionRecord: async (candidateInputHash: `sha256:${string}`) =>
      candidateInputHash === inputHash ? record : null,
    now: () => new Date("2026-07-25T00:00:00.000Z"),
  } satisfies SandboxServerAuthorityRegistration;
  const makeAuthority = (overrides: Partial<SandboxServerAuthorityRegistration> = {}) =>
    registerSandboxServerAuthority({
      ...callbacks,
      ...overrides,
    });
  const authority = makeAuthority();

  return {
    authority,
    callbacks,
    committed,
    executionPermitReference,
    inputHash,
    makeAuthority,
    permit,
    receipt,
    record,
    request,
    result,
    sqlArtifact,
  };
}

function createAlternatePrincipalSandboxBinding(
  fixture: Awaited<ReturnType<typeof createSandboxAuthorityFixture>>,
  options: Readonly<{
    idempotency_key: string;
    execution_id: string;
  }>,
) {
  const sqlArtifactReference = {
    ...fixture.permit.sql_artifact_ref,
    artifact_id: ids.command,
  };
  const executionPermitReference = {
    ...fixture.executionPermitReference,
    artifact_id: ids.assignment,
  };
  const permit = {
    ...fixture.permit,
    sql_artifact_ref: sqlArtifactReference,
    principal_id: "principal-fixture-b",
  };
  const sqlArtifact = {
    ...fixture.sqlArtifact,
  };
  const request = sandboxExecutionRequestSchema.parse({
    ...fixture.request,
    execution_id: options.execution_id,
    idempotency_key: options.idempotency_key,
    payload: {
      ...fixture.request.payload,
      sql_artifact_ref: sqlArtifactReference,
      execution_permit_ref: executionPermitReference,
    },
  });
  if (request.language !== "sql") {
    throw new Error("Alternate Principal Sandbox Fixture 必须生成 SQL Request。");
  }
  return {
    executionPermitReference,
    permit,
    request,
    sqlArtifact,
  };
}

describe("版本化 Adapter Ports", () => {
  it("Model Provider 只接收 AVAILABLE Profile 授权的调用，并关联每个流事件", async () => {
    const request = modelProviderRequestSchema.parse({
      ...baseAttempt,
      request_id: ids.receipt,
      provider: "openai",
      profile_id: ids.artifact,
      profile_version: "1.0.0",
      model_id: "example-model",
      task_ref: makeArtifactReference("QuestionFrame"),
      context_refs: [makeArtifactReference("ResearchBrief")],
      messages: [{ role: "user", content: "解释收入下降原因" }],
      tool_allowlist: ["query-data"],
      response_schema_version: "1.0.0",
      budget: {
        timeout_ms: 30_000,
        max_input_tokens: 8_000,
        max_output_tokens: 2_000,
        max_tool_calls: 4,
      },
    });
    expect(
      modelProviderRequestSchema.safeParse({
        ...request,
        task_ref: {
          ...request.task_ref,
          environment: environments.staging,
        },
      }).success,
    ).toBe(false);
    expect(
      modelProviderEventSchema.safeParse({
        ...baseAttempt,
        request_id: request.request_id,
        provider: request.provider,
        profile_id: request.profile_id,
        profile_version: request.profile_version,
        model_id: request.model_id,
        sequence: 0,
        observed_at: "2026-07-25T00:00:00.000Z",
        event_type: "COMPLETED",
        output_text: "{}",
        response_hash: hashes.execution,
        usage: {
          availability: "AVAILABLE",
          source: "PROVIDER_REPORTED",
          input_tokens: 1,
          output_tokens: 1,
          tool_calls: 0,
          unavailable_reason: null,
        },
      }).success,
    ).toBe(true);

    const certificationReceipt = makeArtifactReference("ModelCertificationReceipt");
    const profileInput = {
      profile_id: request.profile_id,
      scope,
      provider: request.provider,
      model_id: request.model_id,
      profile_version: request.profile_version,
      capabilities: {
        structured_output: true,
        tool_calling: true,
        streaming: true,
        reasoning: true,
        vision: false,
      },
      certification_status: "AVAILABLE",
      certification_receipt_ref: certificationReceipt,
      certified_model_id: request.model_id,
    } as const;
    const profileHash = await computeModelProfileHash(profileInput);
    const availableProfile = await authorizeAvailableModelProfile(profileInput, {
      verifyCommitted: async () => true,
      resolve: async () => ({
        schema_version: "1.0.0",
        receipt_ref: certificationReceipt,
        profile_id: request.profile_id,
        provider: request.provider,
        model_id: request.model_id,
        profile_version: request.profile_version,
        profile_hash: profileHash,
        probe_hash: hashes.execution,
        verdict: "PASS",
      }),
    });
    expect(isAuthoritativeModelProviderInvocation(request)).toBe(false);
    await expect(authorizeModelProviderInvocation(request, async () => null)).rejects.toThrow(
      "AVAILABLE",
    );
    const invocation = await authorizeModelProviderInvocation(
      request,
      async () => availableProfile,
    );
    expect(isAuthoritativeModelProviderInvocation(invocation)).toBe(true);

    const started = {
      ...baseAttempt,
      request_id: invocation.request_id,
      provider: invocation.provider,
      profile_id: invocation.profile_id,
      profile_version: invocation.profile_version,
      model_id: invocation.model_id,
      sequence: 0,
      observed_at: "2026-07-25T00:00:00.000Z",
      event_type: "STARTED",
    } as const;
    expect(parseModelProviderEventForRequest(invocation, started)).toMatchObject({
      request_id: invocation.request_id,
    });
    expect(() =>
      parseModelProviderEventForRequest(invocation, {
        ...started,
        attempt_id: ids.assignment,
      }),
    ).toThrow("关联");

    const adapter = {
      async *stream(input) {
        yield parseModelProviderEventForRequest(input, {
          ...started,
          request_id: input.request_id,
          provider: input.provider,
          profile_id: input.profile_id,
          profile_version: input.profile_version,
          model_id: input.model_id,
        });
      },
    } satisfies ModelProviderPort;
    await expect(collectAsync(adapter.stream(invocation))).resolves.toHaveLength(1);
  });

  it("External Agent 调用不能扩大服务端 Profile 的 Workspace/Permission", async () => {
    const request = externalAgentRequestSchema.parse({
      ...baseAttempt,
      invocation_id: ids.receipt,
      profile_id: ids.artifact,
      profile_version: "1.0.0",
      adapter: "claude-code",
      task_ref: makeArtifactReference("QuestionFrame"),
      context_refs: [],
      workspace_policy: { roots: ["/workspace/repository"], writable: false },
      permission_policy: { allowed_tools: [], allowed_command_ids: [] },
      budget: { timeout_ms: 30_000, max_output_bytes: 1_000_000, max_actions: 10 },
    });
    expect(modelProviderRequestSchema.safeParse(request).success).toBe(false);
    expect(
      externalAgentEventSchema.safeParse({
        ...baseAttempt,
        invocation_id: request.invocation_id,
        profile_id: request.profile_id,
        profile_version: request.profile_version,
        adapter: request.adapter,
        sequence: 1,
        observed_at: "2026-07-25T00:00:00.000Z",
        event_type: "COMPLETED",
        audit_receipt_ref: {
          ...makeArtifactReference("ExternalAgentAuditReceipt"),
          app_id: ids.appB,
        },
      }).success,
    ).toBe(false);

    const serverProfile = {
      profile_id: request.profile_id,
      scope,
      profile_version: request.profile_version,
      kind: "EXTERNAL_AGENT",
      adapter: request.adapter,
      workspace_policy: { roots: ["/workspace"], writable: false },
      permission_policy: {
        allowed_tools: ["read"],
        allowed_command_ids: ["git.status"],
      },
      cancellation: { supported: true, timeout_ms: 30_000 },
      audit: { required: true, receipt_schema_version: "1.0.0" },
    } as const;
    expect(isAuthoritativeExternalAgentInvocation(request)).toBe(false);
    await expect(
      authorizeExternalAgentInvocation(
        {
          ...request,
          permission_policy: {
            ...request.permission_policy,
            allowed_command_ids: ["git.push"],
          },
        },
        async () => serverProfile,
      ),
    ).rejects.toThrow("Permission");
    await expect(
      authorizeExternalAgentInvocation(request, async () => ({
        ...serverProfile,
        scope: { ...scope, tenant_id: ids.tenantB },
      })),
    ).rejects.toThrow("Profile");
    await expect(
      authorizeExternalAgentInvocation(request, async () => ({
        ...serverProfile,
        profile_version: "2.0.0",
      })),
    ).rejects.toThrow("Profile");
    await expect(
      authorizeExternalAgentInvocation(
        {
          ...request,
          workspace_policy: {
            roots: ["/workspace/repository"],
            writable: true,
          },
        },
        async () => serverProfile,
      ),
    ).rejects.toThrow("Workspace");
    await expect(
      authorizeExternalAgentInvocation(
        {
          ...request,
          workspace_policy: {
            roots: ["/workspace-other"],
            writable: false,
          },
        },
        async () => serverProfile,
      ),
    ).rejects.toThrow("Workspace");
    for (const unsafeRoot of [
      "/",
      "workspace",
      "/safe/../etc",
      "/safe/./repository",
      "/safe//repository",
      "/safe/repository/",
      "/safe\\repository",
      "/safe/\0repository",
    ]) {
      expect(
        externalAgentRequestSchema.safeParse({
          ...request,
          workspace_policy: { roots: [unsafeRoot], writable: false },
        }).success,
      ).toBe(false);
    }
    await expect(
      authorizeExternalAgentInvocation(request, async () => ({
        ...serverProfile,
        workspace_policy: { roots: ["/"], writable: false },
      })),
    ).rejects.toThrow("服务端");
    const invocation = await authorizeExternalAgentInvocation(request, async () => serverProfile);
    expect(isAuthoritativeExternalAgentInvocation(invocation)).toBe(true);

    const started = {
      ...baseAttempt,
      invocation_id: invocation.invocation_id,
      profile_id: invocation.profile_id,
      profile_version: invocation.profile_version,
      adapter: invocation.adapter,
      sequence: 0,
      observed_at: "2026-07-25T00:00:00.000Z",
      event_type: "STARTED",
    } as const;
    expect(parseExternalAgentEventForRequest(invocation, started)).toMatchObject({
      invocation_id: invocation.invocation_id,
    });
    expect(() =>
      parseExternalAgentEventForRequest(invocation, {
        ...started,
        invocation_id: ids.assignment,
      }),
    ).toThrow("关联");
    expect(() =>
      parseExternalAgentEventForRequest(invocation, {
        ...started,
        profile_version: "2.0.0",
      }),
    ).toThrow("关联");

    const adapter = {
      async *stream(input) {
        yield parseExternalAgentEventForRequest(input, {
          ...started,
          invocation_id: input.invocation_id,
          profile_id: input.profile_id,
          profile_version: input.profile_version,
          adapter: input.adapter,
        });
      },
      async cancel(input) {
        return {
          ok: true,
          value: {
            cancelled: true as const,
            attempt_id: input.attempt_id,
          },
        };
      },
    } satisfies ExternalAgentPort;
    await expect(collectAsync(adapter.stream(invocation))).resolves.toHaveLength(1);
  });

  it("Benchmark Transport 关联请求事件，只有已提交成功 Receipt 可获权威品牌", async () => {
    const request = benchmarkAdapterRequestSchema.parse({
      ...baseAttempt,
      adapter_run_id: ids.receipt,
      suite: "dab",
      suite_version: "1.0.0",
      dataset_version: "1.0.0",
      oracle_version: "1.0.0",
      case_ref: makeArtifactReference("EvalCase"),
      eval_run_ref: makeArtifactReference("EvalRun"),
      budget: { timeout_ms: 30_000, max_cases: 10, max_bytes: 1_000_000 },
    });
    expect(request.oracle_version).toBe("1.0.0");
    expect(
      benchmarkAdapterEventSchema.safeParse({
        ...baseAttempt,
        adapter_run_id: request.adapter_run_id,
        suite: request.suite,
        suite_version: request.suite_version,
        dataset_version: request.dataset_version,
        oracle_version: request.oracle_version,
        sequence: 1,
        observed_at: "2026-07-25T00:00:00.000Z",
        event_type: "SCORE_CANDIDATE",
        scorecard_ref: {
          ...makeArtifactReference("ScoreCard"),
          tenant_id: ids.tenantB,
        },
      }).success,
    ).toBe(false);
    expect(
      benchmarkAdapterEventSchema.safeParse({
        ...baseAttempt,
        adapter_run_id: request.adapter_run_id,
        suite: request.suite,
        suite_version: request.suite_version,
        dataset_version: request.dataset_version,
        oracle_version: request.oracle_version,
        sequence: 2,
        observed_at: "2026-07-25T00:00:00.000Z",
        event_type: "CASE_LOADED",
        case_ref: {
          ...makeArtifactReference("EvalCase"),
          app_id: ids.appB,
        },
      }).success,
    ).toBe(false);
    expect(
      benchmarkAdapterEventSchema.safeParse({
        ...baseAttempt,
        adapter_run_id: request.adapter_run_id,
        suite: request.suite,
        suite_version: request.suite_version,
        dataset_version: request.dataset_version,
        oracle_version: request.oracle_version,
        sequence: 3,
        observed_at: "2026-07-25T00:00:00.000Z",
        event_type: "COMPLETED",
        receipt_ref: {
          ...makeArtifactReference("BenchmarkAdapterReceipt"),
          environment: environments.staging,
        },
      }).success,
    ).toBe(false);

    const started = {
      ...baseAttempt,
      adapter_run_id: request.adapter_run_id,
      suite: request.suite,
      suite_version: request.suite_version,
      dataset_version: request.dataset_version,
      oracle_version: request.oracle_version,
      sequence: 0,
      observed_at: "2026-07-25T00:00:00.000Z",
      event_type: "STARTED",
    } as const;
    expect(parseBenchmarkAdapterEventForRequest(request, started)).toMatchObject({
      adapter_run_id: request.adapter_run_id,
    });
    expect(() =>
      parseBenchmarkAdapterEventForRequest(request, {
        ...started,
        oracle_version: "2.0.0",
      }),
    ).toThrow("关联");

    const adapter = {
      async *stream(input) {
        yield parseBenchmarkAdapterEventForRequest(input, {
          ...started,
          adapter_run_id: input.adapter_run_id,
          suite: input.suite,
          suite_version: input.suite_version,
          dataset_version: input.dataset_version,
          oracle_version: input.oracle_version,
        });
      },
    } satisfies BenchmarkSuiteAdapter;
    await expect(collectAsync(adapter.stream(request))).resolves.toHaveLength(1);

    const receiptInput = {
      schema_version: "1.0.0",
      receipt_ref: makeArtifactReference("BenchmarkAdapterReceipt"),
      adapter_run_id: request.adapter_run_id,
      attempt_id: request.attempt_id,
      scope: request.scope,
      run_id: request.run_id,
      suite: request.suite,
      suite_version: request.suite_version,
      dataset_version: request.dataset_version,
      oracle_version: request.oracle_version,
      case_ref: request.case_ref,
      eval_run_ref: request.eval_run_ref,
      scorecard_ref: makeArtifactReference("ScoreCard"),
      terminal: "COMPLETED",
      reason_code: "BENCHMARK_COMPLETED",
      observed_at: "2026-07-25T00:00:01.000Z",
    } as const;
    expect(isAuthoritativeBenchmarkAdapterReceipt(receiptInput)).toBe(false);
    await expect(authorizeBenchmarkAdapterReceipt(receiptInput, async () => false)).rejects.toThrow(
      "未提交",
    );
    const receipt = await authorizeBenchmarkAdapterReceipt(receiptInput, async () => true);
    expect(isAuthoritativeBenchmarkAdapterReceipt(receipt)).toBe(true);
    expect(Object.isFrozen(receipt)).toBe(true);
    await expect(
      authorizeBenchmarkAdapterReceipt(
        {
          ...receiptInput,
          terminal: "FAILED",
          reason_code: "BENCHMARK_FAILED",
        },
        async () => true,
      ),
    ).rejects.toThrow();
  });

  it("Sandbox Authority 不接受结构 callback、复制 token，也不从 contracts root 暴露签发入口", async () => {
    const fixture = await createSandboxAuthorityFixture();
    for (const hiddenExport of [
      "authorizeSandboxExecutionRequest",
      "executeAuthorizedSandboxRequest",
      "authorizeSandboxExecutionReceipt",
      "authorizeSandboxResult",
      "registerSandboxServerAuthority",
    ]) {
      expect(hiddenExport in contractsRoot).toBe(false);
    }

    await expect(
      Reflect.apply(authorizeSandboxResult, undefined, [
        fixture.result.result_ref,
        fixture.callbacks,
      ]),
    ).rejects.toThrow("未经包内服务端注册");
    await expect(
      Reflect.apply(authorizeSandboxExecutionReceipt, undefined, [
        fixture.receipt.receipt_ref,
        { ...fixture.authority },
      ]),
    ).rejects.toThrow("未经包内服务端注册");
    expect(isAuthoritativeSandboxResult({ ...fixture.result })).toBe(false);
    expect(isAuthoritativeSandboxExecutionReceipt({ ...fixture.receipt })).toBe(false);
  });

  it("SandboxResult 按列、行、计数和规范字节内容寻址，并拒绝结构、提交与 Hash 漂移", async () => {
    const fixture = await createSandboxAuthorityFixture();
    expect(isAuthoritativeSandboxResult(fixture.result)).toBe(false);
    const result = await authorizeSandboxResult(fixture.result.result_ref, fixture.authority);
    expect(isAuthoritativeSandboxResult(result)).toBe(true);
    const identity = getAuthoritativeSandboxExecutionIdentity(result);
    expect(isAuthoritativeSandboxExecutionIdentity(identity)).toBe(true);
    expect(identity?.identity).toEqual(sandboxAuthorityIdentity);
    expect(Object.isFrozen(identity)).toBe(true);
    expect(Object.isFrozen(identity?.identity)).toBe(true);
    expect(getAuthoritativeSandboxExecutionIdentity({ ...result } as typeof result)).toBeNull();
    expect(isAuthoritativeSandboxResult({ ...result })).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.rows[0])).toBe(true);
    await expect(
      authorizeSandboxResult(
        fixture.result.result_ref,
        fixture.makeAuthority({
          verifyCommitted: async () => false,
        }),
      ),
    ).rejects.toThrow("提交");

    expect(
      sandboxResultSchema.safeParse({
        ...fixture.result,
        rows: [["south"]],
        row_count: 1,
        bytes: fixture.result.bytes,
      }).success,
    ).toBe(false);
    expect(
      sandboxResultSchema.safeParse({
        ...fixture.result,
        row_count: fixture.result.row_count + 1,
      }).success,
    ).toBe(false);
    expect(
      sandboxResultSchema.safeParse({
        ...fixture.result,
        columns: [
          { name: "region", type: "STRING" },
          { name: "region", type: "NUMBER" },
        ],
      }).success,
    ).toBe(false);
    expect(
      sandboxResultSchema.safeParse({
        ...fixture.result,
        rows: [
          ["south", "120.5"],
          ["north", 80],
        ],
      }).success,
    ).toBe(false);

    const mutatedRows = [
      ["south", 999.9],
      ["north", 80],
    ] as const;
    expect(
      computeSandboxResultBytes({
        columns: fixture.result.columns,
        rows: mutatedRows,
      }),
    ).toBe(fixture.result.bytes);
    const mutatedResult = {
      ...fixture.result,
      rows: mutatedRows,
    };
    await expect(
      authorizeSandboxResult(
        fixture.result.result_ref,
        fixture.makeAuthority({
          resolveCommitted: async () => mutatedResult,
        }),
      ),
    ).rejects.toThrow("Hash");
    await expect(
      authorizeSandboxResult(
        fixture.result.result_ref,
        fixture.makeAuthority({
          resolveCommitted: async () => ({
            ...fixture.result,
            result_ref: {
              ...fixture.result.result_ref,
              artifact_id: ids.inputArtifact,
            },
          }),
        }),
      ),
    ).rejects.toThrow("不匹配");
    expect(
      sandboxResultSchema.safeParse({
        ...fixture.result,
        columns: Array.from({ length: SANDBOX_RESULT_LIMITS.max_columns + 1 }, (_, index) => ({
          name: `column_${index}`,
          type: "JSON",
        })),
        rows: [],
        row_count: 0,
      }).success,
    ).toBe(false);
    expect(
      sandboxResultSchema.safeParse({
        ...fixture.result,
        rows: Array.from({ length: SANDBOX_RESULT_LIMITS.max_rows + 1 }, () => [null, null]),
        row_count: SANDBOX_RESULT_LIMITS.max_rows + 1,
      }).success,
    ).toBe(false);
    expect(
      sandboxResultSchema.safeParse({
        ...fixture.result,
        bytes: SANDBOX_RESULT_LIMITS.max_bytes + 1,
      }).success,
    ).toBe(false);
  });

  it("SQL Sandbox Request 必须精确绑定有效 Permit、ResourceAdmission、Settings 与五项 Budget", async () => {
    const fixture = await createSandboxAuthorityFixture();
    expect(
      sandboxExecutionRequestSchema.safeParse({
        ...fixture.request,
        budget: {
          ...fixture.request.budget,
          max_rows: SANDBOX_RESULT_LIMITS.max_rows,
          max_bytes: SANDBOX_RESULT_LIMITS.max_bytes,
          max_memory_mb: SANDBOX_RESULT_LIMITS.max_memory_mb,
        },
      }).success,
    ).toBe(true);
    expect(
      sandboxExecutionRequestSchema.safeParse({
        ...fixture.request,
        budget: {
          ...fixture.request.budget,
          max_rows: SANDBOX_RESULT_LIMITS.max_rows + 1,
        },
      }).success,
    ).toBe(false);
    expect(
      sandboxExecutionRequestSchema.safeParse({
        ...fixture.request,
        budget: {
          ...fixture.request.budget,
          max_memory_mb: SANDBOX_RESULT_LIMITS.max_memory_mb + 1,
        },
      }).success,
    ).toBe(false);
    expect(
      sandboxExecutionRequestSchema.safeParse({
        ...fixture.request,
        budget: {
          ...fixture.request.budget,
          max_bytes: SANDBOX_RESULT_LIMITS.max_bytes + 1,
        },
      }).success,
    ).toBe(false);
    const { execution_permit_ref: _permit, ...payloadWithoutPermit } = fixture.request.payload;
    expect(
      sandboxExecutionRequestSchema.safeParse({
        ...fixture.request,
        payload: payloadWithoutPermit,
      }).success,
    ).toBe(false);
    expect(
      sandboxExecutionRequestSchema.safeParse({
        ...fixture.request,
        payload: {
          ...fixture.request.payload,
          snapshot_requirement: {
            mode: "REQUIRE_REPLAYABLE",
            snapshot_token: "caller-forged-snapshot",
          },
        },
      }).success,
    ).toBe(false);

    await expect(
      authorizeSandboxRequestForTest(
        {
          ...fixture.request,
          budget: {
            ...fixture.request.budget,
            max_rows: fixture.request.budget.max_rows - 1,
          },
        },
        fixture.authority,
      ),
    ).rejects.toThrow("Budget");

    await expect(
      authorizeSandboxRequestForTest(
        fixture.request,
        fixture.makeAuthority({
          now: () => new Date(fixture.permit.expires_at),
        }),
      ),
    ).rejects.toThrow("有效期");

    await expect(
      authorizeSandboxRequestForTest(
        fixture.request,
        fixture.makeAuthority({
          resolveAuthoritativeExecutionPermit: async () => ({
            ...fixture.permit,
            sql_artifact_ref: {
              ...fixture.permit.sql_artifact_ref,
              artifact_id: ids.command,
            },
          }),
        }),
      ),
    ).rejects.toThrow("SQL");

    let mismatchedRevisionStarted = false;
    await expect(
      executeAuthorizedSandboxRequest(
        fixture.request,
        fixture.makeAuthority({
          resolveAuthoritativeExecutionPermit: async () => ({
            ...fixture.permit,
            issued_at: "2026-07-24T23:58:00.000Z",
          }),
        }),
        async () => {
          mismatchedRevisionStarted = true;
          return true;
        },
      ),
    ).rejects.toThrow("Reference 精确指向");
    expect(mismatchedRevisionStarted).toBe(false);

    const reboundSqlMaterial = {
      dialect: fixture.sqlArtifact.dialect,
      sql: "select secret_value from attacker_schema.secret_table",
      parameters: fixture.sqlArtifact.parameters,
    } as const;
    await expect(
      executeAuthorizedSandboxRequest(
        fixture.request,
        fixture.makeAuthority({
          resolveAuthoritativeSqlArtifact: async () => ({
            ...fixture.sqlArtifact,
            ...reboundSqlMaterial,
            query_hash: await sha256ContentHash(reboundSqlMaterial),
          }),
        }),
        async () => {
          mismatchedRevisionStarted = true;
          return true;
        },
      ),
    ).rejects.toThrow("SQL Parameters");
    expect(mismatchedRevisionStarted).toBe(false);

    await expect(
      authorizeSandboxRequestForTest(
        {
          ...fixture.request,
          payload: {
            ...fixture.request.payload,
            execution_settings: {
              ...fixture.request.payload.execution_settings,
              search_path: ["attacker_schema", "pg_catalog"],
            },
          },
        },
        fixture.authority,
      ),
    ).rejects.toThrow("Settings");

    await expect(
      authorizeSandboxRequestForTest(
        {
          ...fixture.request,
          idempotency_key: "tampered-policy-parameter",
          payload: {
            ...fixture.request.payload,
            parameters: {
              $1: ids.tenantB,
            },
          },
        },
        fixture.authority,
      ),
    ).rejects.toThrow("Parameters");

    await expect(
      authorizeSandboxRequestForTest(
        fixture.request,
        fixture.makeAuthority({
          revalidateExecutionAuthority: async () => ({
            ...fixture.record.authority_revalidation,
            effective_principal_id: "revoked-principal",
          }),
        }),
      ),
    ).rejects.toThrow("Principal/Policy");

    let queryStarted = false;
    await expect(
      executeAuthorizedSandboxRequest(
        fixture.request,
        fixture.makeAuthority({
          assertAuthorityFence: async () => false,
        }),
        async () => {
          queryStarted = true;
          return true;
        },
      ),
    ).rejects.toThrow("Authority Fence");
    expect(queryStarted).toBe(false);

    expect(
      sandboxExecutionReceiptSchema.safeParse({
        ...fixture.receipt,
        result_artifact_ref: {
          ...fixture.receipt.result_artifact_ref,
          run_id: ids.inputArtifact,
        },
      }).success,
    ).toBe(false);
  });

  it("Sandbox 成功 Receipt 只能由完整已提交 Reference 解析，并回显服务端 Request/Snapshot 事实", async () => {
    const fixture = await createSandboxAuthorityFixture();
    expect(isAuthoritativeSandboxExecutionReceipt(fixture.receipt)).toBe(false);
    await expect(
      authorizeSandboxExecutionReceipt(fixture.receipt, fixture.authority),
    ).rejects.toThrow();
    await expect(
      authorizeSandboxExecutionReceipt(
        fixture.receipt.receipt_ref,
        fixture.makeAuthority({
          verifyCommitted: async () => false,
        }),
      ),
    ).rejects.toThrow("未提交");
    const receipt = await authorizeSandboxExecutionReceipt(
      fixture.receipt.receipt_ref,
      fixture.authority,
    );
    expect(isAuthoritativeSandboxExecutionReceipt(receipt)).toBe(true);
    expect(isAuthoritativeSandboxExecutionReceipt({ ...receipt })).toBe(false);
    expect(Object.isFrozen(receipt)).toBe(true);

    await expect(
      authorizeSandboxExecutionReceipt(
        fixture.receipt.receipt_ref,
        fixture.makeAuthority({
          resolveCommitted: async (reference) =>
            reference.artifact_type === "SandboxExecutionReceipt"
              ? {
                  ...fixture.receipt,
                  input_hash: hashes.execution,
                }
              : fixture.callbacks.resolveCommitted(reference),
        }),
      ),
    ).rejects.toThrow("Hash");
    const reboundResourceUsage = [
      { ...fixture.receipt.resource_usage, elapsed_ms: 999 },
      { ...fixture.receipt.resource_usage, rows: fixture.receipt.resource_usage.rows + 1 },
      { ...fixture.receipt.resource_usage, bytes: fixture.receipt.resource_usage.bytes + 1 },
      { ...fixture.receipt.resource_usage, peak_memory_mb: 999 },
    ];
    for (const resourceUsage of reboundResourceUsage) {
      await expect(
        authorizeSandboxExecutionReceipt(
          fixture.receipt.receipt_ref,
          fixture.makeAuthority({
            resolveCommitted: async (reference) =>
              reference.artifact_type === "SandboxExecutionReceipt"
                ? {
                    ...fixture.receipt,
                    resource_usage: resourceUsage,
                  }
                : fixture.callbacks.resolveCommitted(reference),
          }),
        ),
      ).rejects.toThrow("Hash");
    }

    const underReportedDraft = {
      ...fixture.receipt,
      receipt_ref: {
        ...fixture.receipt.receipt_ref,
        content_hash: hashes.input,
      },
      execution_hash: hashes.input,
      resource_usage: {
        ...fixture.receipt.resource_usage,
        elapsed_ms: 1,
        peak_memory_mb: 0,
      },
    };
    const underReportedHash = await computeSandboxExecutionReceiptHash(underReportedDraft);
    const underReportedReceipt = successfulSandboxExecutionReceiptSchema.parse({
      ...underReportedDraft,
      receipt_ref: {
        ...underReportedDraft.receipt_ref,
        content_hash: underReportedHash,
      },
      execution_hash: underReportedHash,
    });
    await expect(
      authorizeSandboxExecutionReceipt(
        underReportedReceipt.receipt_ref,
        fixture.makeAuthority({
          resolveCommitted: async (reference) =>
            artifactReferenceIdentity(reference) ===
            artifactReferenceIdentity(underReportedReceipt.receipt_ref)
              ? underReportedReceipt
              : fixture.callbacks.resolveCommitted(reference),
          verifyCommitted: async (reference) =>
            artifactReferenceIdentity(reference) ===
              artifactReferenceIdentity(underReportedReceipt.receipt_ref) ||
            fixture.callbacks.verifyCommitted(reference),
        }),
      ),
    ).rejects.toThrow("Request、Permit、Settings 与 Snapshot");

    const longRunningDraft = {
      ...fixture.receipt,
      receipt_ref: {
        ...fixture.receipt.receipt_ref,
        content_hash: hashes.input,
      },
      execution_hash: hashes.input,
      completed_at: "2026-07-25T01:00:00.000Z",
    };
    const longRunningHash = await computeSandboxExecutionReceiptHash(longRunningDraft);
    const longRunningReceipt = successfulSandboxExecutionReceiptSchema.parse({
      ...longRunningDraft,
      receipt_ref: {
        ...longRunningDraft.receipt_ref,
        content_hash: longRunningHash,
      },
      execution_hash: longRunningHash,
    });
    await expect(
      authorizeSandboxExecutionReceipt(
        longRunningReceipt.receipt_ref,
        fixture.makeAuthority({
          resolveCommitted: async (reference) =>
            artifactReferenceIdentity(reference) ===
            artifactReferenceIdentity(longRunningReceipt.receipt_ref)
              ? longRunningReceipt
              : fixture.callbacks.resolveCommitted(reference),
          verifyCommitted: async (reference) =>
            artifactReferenceIdentity(reference) ===
              artifactReferenceIdentity(longRunningReceipt.receipt_ref) ||
            fixture.callbacks.verifyCommitted(reference),
          resolveExecutionRecord: async (candidateInputHash) =>
            candidateInputHash === fixture.inputHash
              ? {
                  ...fixture.record,
                  completed_at: longRunningReceipt.completed_at,
                }
              : null,
        }),
      ),
    ).rejects.toThrow("不能超过 Permit Budget");

    expect(
      successfulSandboxExecutionReceiptSchema.safeParse({
        ...fixture.receipt,
        result_artifact_ref: {
          ...fixture.receipt.result_artifact_ref,
          tenant_id: ids.tenantB,
        },
      }).success,
    ).toBe(false);
    expect(
      successfulSandboxExecutionReceiptSchema.safeParse({
        ...fixture.receipt,
        completed_at: "2026-07-24T23:59:59.000Z",
      }).success,
    ).toBe(false);
    expect(
      successfulSandboxExecutionReceiptSchema.safeParse({
        ...fixture.receipt,
        resource_usage: {
          ...fixture.receipt.resource_usage,
          elapsed_ms: 1_001,
        },
      }).success,
    ).toBe(false);
    expect(
      successfulSandboxExecutionReceiptSchema.safeParse({
        ...fixture.receipt,
        started_at: undefined,
      }).success,
    ).toBe(false);
    expect(
      successfulSandboxExecutionReceiptSchema.safeParse({
        ...fixture.receipt,
        completed_at: undefined,
      }).success,
    ).toBe(false);
    expect(
      successfulSandboxExecutionReceiptSchema.safeParse({
        ...fixture.receipt,
        result_artifact_ref: undefined,
      }).success,
    ).toBe(false);
    await expect(
      authorizeSandboxExecutionReceipt(
        fixture.receipt.receipt_ref,
        fixture.makeAuthority({
          verifyCommitted: async (reference) =>
            reference.artifact_type !== "SandboxResult" &&
            fixture.callbacks.verifyCommitted(reference),
        }),
      ),
    ).rejects.toThrow("Result");

    await expect(
      authorizeSandboxExecutionReceipt(
        fixture.receipt.receipt_ref,
        fixture.makeAuthority({
          resolveExecutionRecord: async () => ({
            ...fixture.record,
            snapshot: {
              snapshot_token: "forged-snapshot",
              watermark: null,
              replay_state: "REPLAYABLE",
            },
          }),
        }),
      ),
    ).rejects.toThrow("Snapshot");

    await expect(
      authorizeSandboxExecutionReceipt(
        fixture.receipt.receipt_ref,
        fixture.makeAuthority({
          resolveExecutionRecord: async () => ({
            ...fixture.record,
            applied_execution_settings: {
              ...fixture.record.applied_execution_settings,
              search_path: ["attacker_schema", "pg_catalog"],
            },
          }),
        }),
      ),
    ).rejects.toThrow("Settings");

    const schemaDrift = await createSandboxAuthorityFixture({
      resultSchemaVersion: "2.0.0",
    });
    await expect(
      authorizeSandboxExecutionReceipt(schemaDrift.receipt.receipt_ref, schemaDrift.authority),
    ).rejects.toThrow("Schema");
  });

  it("Sandbox Receipt 接受早于 Datasource Start 的 Authority Prepare，但拒绝晚到的重验证", async () => {
    const preparedBeforeDatasourceStart = await createSandboxAuthorityFixture({
      authorityRevalidatedAt: "2026-07-24T23:59:59.999Z",
    });

    await expect(
      authorizeSandboxExecutionReceipt(
        preparedBeforeDatasourceStart.receipt.receipt_ref,
        preparedBeforeDatasourceStart.authority,
      ),
    ).resolves.toMatchObject({
      started_at: "2026-07-25T00:00:00.000Z",
      authority_revalidation: {
        revalidated_at: "2026-07-24T23:59:59.999Z",
      },
    });

    const revalidatedAfterDatasourceStart = await createSandboxAuthorityFixture({
      authorityRevalidatedAt: "2026-07-25T00:00:00.001Z",
    });
    await expect(
      authorizeSandboxExecutionReceipt(
        revalidatedAfterDatasourceStart.receipt.receipt_ref,
        revalidatedAfterDatasourceStart.authority,
      ),
    ).rejects.toThrow("Authority Prepare 时间");
  });

  it("In-Memory Sandbox 并发同键同输入只执行一次并重放同一 Receipt", async () => {
    const fixture = await createSandboxAuthorityFixture();
    const entered = deferred();
    const release = deferred();
    let operationStarts = 0;
    const sandbox = new InMemorySandboxPort(undefined, {
      before_execution: async () => {
        operationStarts += 1;
        entered.resolve();
        await release.promise;
      },
    });
    sandbox.commitAuthoritativeSqlArtifact(fixture.permit.sql_artifact_ref, fixture.sqlArtifact);
    sandbox.commitAuthoritativeExecutionPermit(fixture.executionPermitReference, fixture.permit);
    const request = {
      ...fixture.request,
      idempotency_key: "concurrent-same-input",
    };

    const first = sandbox.execute(request);
    await entered.promise;
    const retry = sandbox.execute(request);
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(operationStarts).toBe(1);

    release.resolve();
    const [firstResult, retryResult] = await Promise.all([first, retry]);
    expect(firstResult).toMatchObject({ ok: true });
    expect(retryResult).toEqual(firstResult);
    expect(retryResult).not.toBe(firstResult);
    expect(Object.isFrozen(firstResult)).toBe(true);
    expect(Object.isFrozen(retryResult)).toBe(true);
    expect(operationStarts).toBe(1);

    const replay = await sandbox.execute(request);
    expect(replay).toEqual(firstResult);
    expect(replay).not.toBe(firstResult);
    expect(Object.isFrozen(replay)).toBe(true);
  });

  it("In-Memory Sandbox 并发同键异输入在第二次 Operation 前显式冲突", async () => {
    const fixture = await createSandboxAuthorityFixture();
    const entered = deferred();
    const release = deferred();
    let operationStarts = 0;
    const sandbox = new InMemorySandboxPort(undefined, {
      before_execution: async () => {
        operationStarts += 1;
        entered.resolve();
        if (operationStarts === 1) {
          await release.promise;
        }
      },
    });
    sandbox.commitAuthoritativeSqlArtifact(fixture.permit.sql_artifact_ref, fixture.sqlArtifact);
    sandbox.commitAuthoritativeExecutionPermit(fixture.executionPermitReference, fixture.permit);
    const firstRequest = {
      ...fixture.request,
      idempotency_key: "concurrent-conflict",
    };
    const conflictingRequest = {
      ...firstRequest,
      execution_id: ids.assignment,
    };

    const first = sandbox.execute(firstRequest);
    await entered.promise;
    const conflict = await sandbox.execute(conflictingRequest);
    release.resolve();
    const firstResult = await first;

    expect(firstResult).toMatchObject({ ok: true });
    expect(conflict).toMatchObject({
      ok: false,
      error: { code: "SANDBOX_IDEMPOTENCY_CONFLICT" },
    });
    expect(operationStarts).toBe(1);
  });

  it("Sandbox 幂等键按服务端 Permit Principal 隔离，同 Scope 不同 Principal 可独立执行", async () => {
    const fixture = await createSandboxAuthorityFixture();
    const sharedKey = "principal-scoped-idempotency";
    const alternate = createAlternatePrincipalSandboxBinding(fixture, {
      execution_id: ids.assignment,
      idempotency_key: sharedKey,
    });
    let operationStarts = 0;
    const sandbox = new InMemorySandboxPort(undefined, {
      before_execution: () => {
        operationStarts += 1;
      },
    });
    sandbox.commitAuthoritativeSqlArtifact(fixture.permit.sql_artifact_ref, fixture.sqlArtifact);
    sandbox.commitAuthoritativeExecutionPermit(fixture.executionPermitReference, fixture.permit);
    sandbox.commitAuthoritativeSqlArtifact(
      alternate.permit.sql_artifact_ref,
      alternate.sqlArtifact,
    );
    sandbox.commitAuthoritativeExecutionPermit(
      alternate.executionPermitReference,
      alternate.permit,
    );

    const [principalA, principalB] = await Promise.all([
      sandbox.execute({
        ...fixture.request,
        idempotency_key: sharedKey,
      }),
      sandbox.execute(alternate.request),
    ]);

    expect(principalA).toMatchObject({ ok: true });
    expect(principalB).toMatchObject({ ok: true });
    expect(operationStarts).toBe(2);
  });

  it("Pending Permit 撤权立即阻断新事务，但已越过 Fence 的旧事务仍可完成", async () => {
    const fixture = await createSandboxAuthorityFixture();
    const alternate = createAlternatePrincipalSandboxBinding(fixture, {
      execution_id: ids.assignment,
      idempotency_key: "unrelated-principal-b",
    });
    const bothEntered = deferred();
    const release = deferred();
    const operationKeys: string[] = [];
    const blockedKeys = new Set(["authorized-old-a", alternate.request.idempotency_key]);
    const sandbox = new InMemorySandboxPort(undefined, {
      before_execution: async (request) => {
        operationKeys.push(request.idempotency_key);
        if (!blockedKeys.has(request.idempotency_key)) {
          return;
        }
        if (operationKeys.filter((key) => blockedKeys.has(key)).length === 2) {
          bothEntered.resolve();
        }
        await release.promise;
      },
    });
    sandbox.commitAuthoritativeSqlArtifact(fixture.permit.sql_artifact_ref, fixture.sqlArtifact);
    sandbox.commitAuthoritativeExecutionPermit(fixture.executionPermitReference, fixture.permit);
    sandbox.commitAuthoritativeSqlArtifact(
      alternate.permit.sql_artifact_ref,
      alternate.sqlArtifact,
    );
    sandbox.commitAuthoritativeExecutionPermit(
      alternate.executionPermitReference,
      alternate.permit,
    );

    const authorizedOldA = sandbox.execute({
      ...fixture.request,
      idempotency_key: "authorized-old-a",
    });
    const unrelatedB = sandbox.execute(alternate.request);
    await bothEntered.promise;

    sandbox.revokeExecutionAuthority(fixture.executionPermitReference);
    const rejectedNewA = await sandbox.execute({
      ...fixture.request,
      execution_id: ids.evalRun,
      idempotency_key: "rejected-new-a",
    });
    expect(rejectedNewA).toMatchObject({
      ok: false,
      error: { code: "SANDBOX_EXECUTION_NOT_AUTHORIZED" },
    });
    expect(operationKeys).not.toContain("rejected-new-a");

    release.resolve();
    const [oldAResult, unrelatedBResult] = await Promise.all([authorizedOldA, unrelatedB]);
    expect(oldAResult).toMatchObject({ ok: true });
    expect(unrelatedBResult).toMatchObject({ ok: true });
  });

  it("In-Memory Sandbox 在执行入口失败关闭，拒绝 Seal 后撤权并授权自身持久化事实", async () => {
    const fixture = await createSandboxAuthorityFixture();
    const inMemorySandbox = new InMemorySandboxPort();
    const withoutPermit = {
      ...fixture.request,
      payload: {
        ...fixture.request.payload,
        execution_permit_ref: undefined,
      },
    };
    await expect(
      Reflect.apply(inMemorySandbox.execute, inMemorySandbox, [withoutPermit]),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "SANDBOX_EXECUTION_NOT_AUTHORIZED" },
    });

    const revokedSandbox = new InMemorySandboxPort();
    revokedSandbox.commitAuthoritativeSqlArtifact(
      fixture.permit.sql_artifact_ref,
      fixture.sqlArtifact,
    );
    revokedSandbox.commitAuthoritativeExecutionPermit(
      fixture.executionPermitReference,
      fixture.permit,
    );
    revokedSandbox.revokeExecutionAuthority(fixture.executionPermitReference);
    await expect(revokedSandbox.execute(fixture.request)).resolves.toMatchObject({
      ok: false,
      error: { code: "SANDBOX_EXECUTION_NOT_AUTHORIZED" },
    });

    inMemorySandbox.commitAuthoritativeSqlArtifact(
      fixture.permit.sql_artifact_ref,
      fixture.sqlArtifact,
    );
    inMemorySandbox.commitAuthoritativeExecutionPermit(
      fixture.executionPermitReference,
      fixture.permit,
    );
    const execution = await inMemorySandbox.execute({
      ...fixture.request,
      idempotency_key: "in-memory-authority",
    });
    expect(execution.ok).toBe(true);
    if (!execution.ok || execution.value.terminal !== "COMPLETED") {
      throw new Error("In-Memory Sandbox 测试夹具未返回成功 Receipt。");
    }
    await expect(
      inMemorySandbox.authorizeExecutionReceipt(execution.value.receipt_ref),
    ).resolves.toMatchObject({
      receipt_ref: execution.value.receipt_ref,
      result_artifact_ref: execution.value.result_artifact_ref,
    });
    await expect(
      inMemorySandbox.authorizeResult(execution.value.result_artifact_ref),
    ).resolves.toMatchObject({
      result_ref: execution.value.result_artifact_ref,
    });

    const unavailableSnapshotSandbox = new InMemorySandboxPort(undefined, {
      snapshot_capability: "REPLAY_UNAVAILABLE",
    });
    unavailableSnapshotSandbox.commitAuthoritativeSqlArtifact(
      fixture.permit.sql_artifact_ref,
      fixture.sqlArtifact,
    );
    unavailableSnapshotSandbox.commitAuthoritativeExecutionPermit(
      fixture.executionPermitReference,
      fixture.permit,
    );
    const downgraded = await unavailableSnapshotSandbox.execute({
      ...fixture.request,
      execution_id: ids.assignment,
      idempotency_key: "snapshot-downgrade",
      payload: {
        ...fixture.request.payload,
        snapshot_requirement: { mode: "ALLOW_UNAVAILABLE" },
      },
    });
    expect(downgraded).toMatchObject({
      ok: true,
      value: {
        replay_state: "REPLAY_UNAVAILABLE",
        snapshot_token: null,
        watermark: null,
      },
    });
  });
});
