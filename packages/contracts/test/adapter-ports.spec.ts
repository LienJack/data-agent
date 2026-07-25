import { describe, expect, it } from "vitest";
import {
  authorizeBenchmarkAdapterReceipt,
  authorizeExternalAgentInvocation,
  authorizeModelProviderInvocation,
  authorizeSandboxExecutionReceipt,
  type BenchmarkSuiteAdapter,
  benchmarkAdapterEventSchema,
  benchmarkAdapterRequestSchema,
  type ExternalAgentPort,
  externalAgentEventSchema,
  externalAgentRequestSchema,
  isAuthoritativeBenchmarkAdapterReceipt,
  isAuthoritativeExternalAgentInvocation,
  isAuthoritativeModelProviderInvocation,
  isAuthoritativeSandboxExecutionReceipt,
  type ModelProviderPort,
  modelProviderEventSchema,
  modelProviderRequestSchema,
  parseBenchmarkAdapterEventForRequest,
  parseExternalAgentEventForRequest,
  parseModelProviderEventForRequest,
  sandboxExecutionReceiptSchema,
  sandboxExecutionRequestSchema,
} from "../src/ports/index.js";
import { authorizeAvailableModelProfile, computeModelProfileHash } from "../src/providers/index.js";
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
        usage: { input_tokens: 1, output_tokens: 1, tool_calls: 0 },
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

  it("Sandbox 缺协议版本或返回跨 Scope Result 时失败关闭，成功 Receipt 需权威授权", async () => {
    const request = {
      scope,
      run_id: ids.run,
      execution_id: ids.receipt,
      idempotency_key: "sandbox-1",
      language: "sql",
      payload: {
        dialect: "postgresql",
        sql_artifact_ref: makeArtifactReference("SqlArtifact"),
        parameters: {},
      },
      budget: {
        timeout_ms: 30_000,
        max_rows: 1_000,
        max_bytes: 1_000_000,
        max_memory_mb: 256,
      },
    } as const;
    expect(sandboxExecutionRequestSchema.safeParse(request).success).toBe(false);
    expect(
      sandboxExecutionReceiptSchema.safeParse({
        schema_version: "1.0.0",
        receipt_id: ids.receipt,
        scope,
        run_id: ids.run,
        execution_id: ids.receipt,
        idempotency_key: "sandbox-1",
        input_hash: hashes.input,
        execution_hash: hashes.execution,
        terminal: "COMPLETED",
        reason_code: "SANDBOX_COMPLETED",
        result_artifact_ref: {
          ...makeArtifactReference("QueryEvidence"),
          run_id: ids.inputArtifact,
        },
        resource_usage: {
          elapsed_ms: 1,
          rows: 1,
          bytes: 1,
          peak_memory_mb: 1,
        },
      }).success,
    ).toBe(false);

    const receiptInput = {
      schema_version: "1.0.0",
      receipt_id: ids.receipt,
      receipt_ref: makeArtifactReference("SandboxExecutionReceipt", ids.receipt),
      scope,
      run_id: ids.run,
      execution_id: ids.receipt,
      idempotency_key: "sandbox-1",
      input_hash: hashes.input,
      execution_hash: hashes.execution,
      terminal: "COMPLETED",
      reason_code: "EXECUTION_COMPLETED",
      resource_usage: {
        elapsed_ms: 1,
        rows: 1,
        bytes: 1,
        peak_memory_mb: 1,
      },
    } as const;
    expect(isAuthoritativeSandboxExecutionReceipt(receiptInput)).toBe(false);
    await expect(authorizeSandboxExecutionReceipt(receiptInput, async () => false)).rejects.toThrow(
      "未提交",
    );
    const receipt = await authorizeSandboxExecutionReceipt(receiptInput, async () => true);
    expect(isAuthoritativeSandboxExecutionReceipt(receipt)).toBe(true);
    expect(Object.isFrozen(receipt)).toBe(true);
    await expect(
      authorizeSandboxExecutionReceipt(
        {
          ...receiptInput,
          terminal: "FAILED",
          reason_code: "EXECUTION_FAILED",
        },
        async () => true,
      ),
    ).rejects.toThrow();
  });
});
