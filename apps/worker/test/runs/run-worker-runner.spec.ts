import {
  type AppScope,
  type ArtifactReference,
  effectiveConfigRunLeasePayloadSchema,
  RUN_RETRY_MAX_ATTEMPTS,
  RUN_RETRY_MIN_DELAY_MS,
  type RunRuntimeEvent,
  type RunWorkLease,
  sha256ContentHash,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import * as workerPublic from "../../src/index.js";
import {
  createRunWorkerRunner,
  type RunCheckpointInput,
  type RunWorkflowExecutorPort,
} from "../../src/runs/index.js";
import { createRunWorkflowExecutorRouter } from "../../src/teams/run-workflow-executor-router.js";
import {
  bindEffectiveConfigLease,
  buildWorkerEffectiveConfigFixture,
  createEffectiveConfigFixtureLoader,
} from "./support/effective-config-fixture.js";
import { InMemoryRunRuntime } from "./support/in-memory-run-runtime.js";

const scope = {
  app_id: "80000000-0000-4000-8000-000000000001",
  tenant_id: "80000000-0000-4000-8000-000000000002",
  environment: "test",
} as const satisfies AppScope;
const runId = "80000000-0000-4000-8000-000000000003";
const principalId = "80000000-0000-4000-8000-000000000005";
const commandId = "80000000-0000-4000-8000-000000000004";
const payloadHash = `sha256:${"1".repeat(64)}`;
const workflowRevision = `sha256:${"2".repeat(64)}`;
let effectiveConfigFixture: Awaited<ReturnType<typeof buildWorkerEffectiveConfigFixture>> | null =
  null;

function acceptedEvent(): RunRuntimeEvent {
  return {
    schema_version: "1.0.0",
    event_id: "80000000-0000-4000-8000-000000000010",
    event_type: "run.accepted",
    scope,
    run_id: runId,
    sequence: 1,
    worker_fence: 0,
    idempotency_key: "accept-command",
    occurred_at: "2026-07-26T00:00:00.000Z",
    payload: {
      command_id: commandId,
      payload_hash: payloadHash,
    },
  };
}

function lease(
  attemptNo: number,
  workerFence: number,
  workerId = `worker-${attemptNo}`,
  deliveryAttemptNo = attemptNo,
  commandKind: "START_DATA_AGENT_TEAM" | "START_L2_RESEARCH" = "START_L2_RESEARCH",
): RunWorkLease {
  const suffix = String(attemptNo).padStart(2, "0");
  const rawLease = {
    scope,
    principal_id: principalId,
    outbox_id: `80000000-0000-4000-8000-0000000001${suffix}`,
    run_id: runId,
    command_id: commandId,
    command_kind: "START_L2_RESEARCH",
    attempt_id: `80000000-0000-4000-8000-0000000002${suffix}`,
    attempt_no: attemptNo,
    delivery_attempt_no: deliveryAttemptNo,
    lease_duration_ms: 30_000,
    worker_id: workerId,
    lease_token: workerFence,
    worker_fence: workerFence,
    expires_at: "2026-07-26T00:05:00.000Z",
    payload: {
      kind: "START_L2_RESEARCH",
    },
  } satisfies RunWorkLease;
  if (!effectiveConfigFixture) throw new Error("effective config fixture not initialized");
  const bound = bindEffectiveConfigLease(rawLease, effectiveConfigFixture);
  if (commandKind === "START_L2_RESEARCH") return bound;
  const legacyPayload = effectiveConfigRunLeasePayloadSchema.parse(bound.payload);
  if (legacyPayload.kind !== "START_L2_RESEARCH") throw new Error("legacy fixture drift");
  return {
    ...bound,
    command_kind: "START_DATA_AGENT_TEAM",
    payload: {
      kind: "START_DATA_AGENT_TEAM",
      effective_config_ref: legacyPayload.effective_config_ref,
      profile_refs: [
        {
          profile_id: "governed-text2sql-agent",
          revision: 1,
          revision_hash: `sha256:${"3".repeat(64)}`,
        },
        {
          profile_id: "report-writing-agent",
          revision: 1,
          revision_hash: `sha256:${"4".repeat(64)}`,
        },
        {
          profile_id: "semantic-management-agent",
          revision: 1,
          revision_hash: `sha256:${"5".repeat(64)}`,
        },
      ],
    },
  };
}

function checkpointInput(
  snapshotVersion = 1,
  activeArtifactRef: ArtifactReference | null = null,
): RunCheckpointInput {
  return {
    workflow_id: "l2-research@1.0.0",
    workflow_definition_revision: workflowRevision,
    mastra_run_id: "mastra-run-1",
    snapshot_version: snapshotVersion,
    active_artifact_ref: activeArtifactRef,
    mastra_snapshot: {
      runId: "mastra-run-1",
      status: "running",
      state: {
        step: snapshotVersion,
      },
    },
  };
}

function createIdFactory(): () => string {
  let index = 100;
  return () => {
    index += 1;
    return `80000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  };
}

async function harness(
  executor: RunWorkflowExecutorPort,
  timing: Readonly<{
    execution_timeout_ms?: number;
    heartbeat_interval_ms?: number;
    side_effect_timeout_ms?: number;
  }> = {},
) {
  const runtime = new InMemoryRunRuntime();
  await runtime.seed(acceptedEvent());
  effectiveConfigFixture = await buildWorkerEffectiveConfigFixture({
    scope,
    workspace_id: scope.tenant_id,
    principal_id: principalId,
    run_id: runId,
  });
  const runner = createRunWorkerRunner({
    queue: runtime,
    event_store: runtime,
    executor,
    effective_config_loader: createEffectiveConfigFixtureLoader(effectiveConfigFixture),
    now: () => new Date("2026-07-26T00:01:00.000Z"),
    create_id: createIdFactory(),
    ...timing,
  });
  return { runtime, runner };
}

async function cancelRuntime(
  runtime: InMemoryRunRuntime,
  workerFence: number,
  idempotencyKey: string,
): Promise<void> {
  const projection = await runtime.readProjection({
    scope,
    run_id: runId,
  });
  if (!projection.ok || !projection.value) {
    throw new Error("missing projection");
  }
  await runtime.forceAppend({
    schema_version: "1.0.0",
    event_id: "80000000-0000-4000-8000-000000000099",
    event_type: "run.cancel_requested",
    scope,
    run_id: runId,
    sequence: projection.value.projection.version + 1,
    worker_fence: workerFence,
    idempotency_key: idempotencyKey,
    occurred_at: "2026-07-26T00:02:00.000Z",
    payload: {
      command_id: commandId,
    },
  });
}

describe("Run Worker Runner", () => {
  it("routes START_DATA_AGENT_TEAM only to the Team executor", async () => {
    const researchExecute = vi.fn(async () => ({ kind: "FAILED" as const, error_code: "WRONG" }));
    const teamExecute = vi.fn(async () => ({ kind: "COMPLETED" as const }));
    const executor = createRunWorkflowExecutorRouter({
      research: { execute: researchExecute },
      team: { execute: teamExecute },
    });
    const { runtime, runner } = await harness(executor);
    runtime.enqueueLease(lease(1, 1, "worker-1", 1, "START_DATA_AGENT_TEAM"));

    await expect(runner.runOnce({ scope, worker_id: "worker-1" })).resolves.toMatchObject({
      ok: true,
      value: { kind: "COMPLETED" },
    });
    expect(teamExecute).toHaveBeenCalledTimes(1);
    expect(researchExecute).not.toHaveBeenCalled();
  });

  it("公共 Worker 入口不导出测试 Fixture，Executor Port 也不泄漏 Mastra 构造器", () => {
    const publicExports = Object.keys(workerPublic);

    expect(publicExports).not.toContain("InMemoryRunRuntime");
    expect(publicExports).not.toContain("Mastra");
    expect(publicExports).not.toContain("createWorkflow");
    expect(publicExports).not.toContain("createStep");
  });

  it("claim 后先追加 run.leased，并向 Executor 暴露可验证 Heartbeat", async () => {
    const executor: RunWorkflowExecutorPort = {
      async execute({ context }) {
        const heartbeat = await context.heartbeat();
        expect(heartbeat.ok).toBe(true);
        return { kind: "COMPLETED" };
      },
    };
    const { runtime, runner } = await harness(executor);
    runtime.enqueueLease(lease(1, 1));

    const result = await runner.runOnce({ scope, worker_id: "worker-1" });

    expect(result).toMatchObject({
      ok: true,
      value: { kind: "COMPLETED", run_id: runId, final_event_sequence: 3 },
    });
    expect(runtime.operations).toEqual([
      "queue:lease",
      "event:run.leased",
      "queue:heartbeat",
      "queue:heartbeat",
      "queue:heartbeat",
      "event:run.completed",
      "queue:complete",
    ]);
    expect(
      runtime.eventsFor(runId).find(({ event_type }) => event_type === "run.leased"),
    ).toMatchObject({
      payload: {
        lease_id: lease(1, 1).attempt_id,
      },
    });
    expect(runtime.heartbeats).toHaveLength(3);
  });

  it("持久化脱敏后的展示事件，并在同一 Attempt 内幂等复用", async () => {
    const executor: RunWorkflowExecutorPort = {
      async execute({ context }) {
        const displayEvent = {
          kind: "tool_started" as const,
          key: "research-start",
          call_id: "call-1",
          tool_name: "research.kernel",
          title: "Research Kernel",
          summary: "执行研究协议",
          input: "dataset=orders api_key=sk_123456789012345",
        };
        expect((await context.emitDisplayEvent?.(displayEvent))?.ok).toBe(true);
        expect((await context.emitDisplayEvent?.(displayEvent))?.ok).toBe(true);
        return { kind: "COMPLETED" };
      },
    };
    const { runtime, runner } = await harness(executor);
    runtime.enqueueLease(lease(1, 1));

    await expect(runner.runOnce({ scope, worker_id: "worker-1" })).resolves.toMatchObject({
      ok: true,
      value: { final_event_sequence: 4 },
    });
    const displayEvents = runtime
      .eventsFor(runId)
      .filter(({ event_type }) => event_type === "run.tool_started");
    expect(displayEvents).toHaveLength(1);
    expect(displayEvents[0]).toMatchObject({
      schema_version: "run-runtime-event@2.0.0",
      payload: {
        input: "dataset=orders [REDACTED]",
        profile_id: null,
        task_id: null,
        artifact_refs: [],
      },
    });
  });

  it("Receipt 已提交但 Event 追加失败后，下一 Attempt 复用 Receipt 且不重复外部副作用", async () => {
    const effect = vi.fn(async () => ({
      output: {
        rows: [{ value: 42 }],
      },
    }));
    let attempt = 0;
    const executor: RunWorkflowExecutorPort = {
      async execute({ context }) {
        attempt += 1;
        const receipt = await context.executeSideEffectOnce({
          effect_kind: "SQL",
          input: {
            query: "select 42",
            snapshot: "fixture-v1",
          },
          execute: effect,
        });
        if (!receipt.ok) {
          throw new Error(receipt.error.code);
        }
        return { kind: "COMPLETED" };
      },
    };
    const { runtime, runner } = await harness(executor);
    const historyScan = vi.spyOn(runtime, "listEvents");
    runtime.enqueueLease(lease(1, 1));
    runtime.failNextAppend("run.side_effect_committed", "RUN_EVENT_APPEND_INTERRUPTED");

    const first = await runner.runOnce({ scope, worker_id: "worker-1" });

    expect(first).toMatchObject({
      ok: false,
      error: { code: "WORKER_PROCESS_CRASH", retryable: true },
    });
    expect(effect).toHaveBeenCalledTimes(1);
    expect(runtime.receiptsFor(runId)).toHaveLength(1);
    expect(runtime.completed).toHaveLength(0);
    expect(runtime.retried).toHaveLength(0);

    runtime.enqueueLease(lease(2, 2));
    const second = await runner.runOnce({ scope, worker_id: "worker-2" });

    expect(second).toMatchObject({
      ok: true,
      value: { kind: "COMPLETED" },
    });
    expect(attempt).toBe(2);
    expect(effect).toHaveBeenCalledTimes(1);
    expect(runtime.receiptsFor(runId)).toHaveLength(1);
    expect(
      runtime
        .eventsFor(runId)
        .filter(({ event_type }) => event_type === "run.side_effect_committed"),
    ).toHaveLength(1);
    expect(historyScan).not.toHaveBeenCalled();
  });

  it("同一 Attempt 重复请求相同 Side Effect 时精确复用 Event 与 Receipt", async () => {
    const effect = vi.fn(async () => ({
      output: {
        rows: [{ value: 42 }],
      },
    }));
    const executor: RunWorkflowExecutorPort = {
      async execute({ context }) {
        for (let index = 0; index < 2; index += 1) {
          const receipt = await context.executeSideEffectOnce({
            effect_kind: "SQL",
            input: {
              query: "select 42",
              snapshot: "fixture-v1",
            },
            execute: effect,
          });
          if (!receipt.ok) throw new Error(receipt.error.code);
        }
        return { kind: "COMPLETED" };
      },
    };
    const { runtime, runner } = await harness(executor);
    const historyScan = vi.spyOn(runtime, "listEvents");
    runtime.enqueueLease(lease(1, 1));

    await expect(runner.runOnce({ scope, worker_id: "worker-1" })).resolves.toMatchObject({
      ok: true,
      value: { kind: "COMPLETED", final_event_sequence: 4 },
    });
    expect(effect).toHaveBeenCalledTimes(1);
    expect(runtime.receiptsFor(runId)).toHaveLength(1);
    expect(
      runtime
        .eventsFor(runId)
        .filter(({ event_type }) => event_type === "run.side_effect_committed"),
    ).toHaveLength(1);
    expect(historyScan).not.toHaveBeenCalled();
  });

  it("同一执行上下文并发请求相同 Side Effect 时只执行和提交一次", async () => {
    let signalStarted: (() => void) | undefined;
    let releaseEffect: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseEffect = resolve;
    });
    const effect = vi.fn(async () => {
      signalStarted?.();
      await released;
      return { output: { rows: [{ value: 42 }] } };
    });
    const executor: RunWorkflowExecutorPort = {
      async execute({ context }) {
        const request = {
          effect_kind: "SQL" as const,
          input: { query: "select 42", snapshot: "fixture-v1" },
          execute: effect,
        };
        const first = context.executeSideEffectOnce(request);
        const second = context.executeSideEffectOnce(request);
        await started;
        releaseEffect?.();
        const receipts = await Promise.all([first, second]);
        if (receipts.some((receipt) => !receipt.ok)) {
          throw new Error("concurrent side effect failed");
        }
        return { kind: "COMPLETED" };
      },
    };
    const { runtime, runner } = await harness(executor);
    runtime.enqueueLease(lease(1, 1));

    await expect(runner.runOnce({ scope, worker_id: "worker-1" })).resolves.toMatchObject({
      ok: true,
      value: { kind: "COMPLETED", final_event_sequence: 4 },
    });
    expect(effect).toHaveBeenCalledTimes(1);
    expect(runtime.receiptsFor(runId)).toHaveLength(1);
    expect(
      runtime
        .eventsFor(runId)
        .filter(({ event_type }) => event_type === "run.side_effect_committed"),
    ).toHaveLength(1);
  });

  it("Side Effect Event 已提交后崩溃时，后继 Attempt 按内容身份精确复用", async () => {
    const effect = vi.fn(async () => ({
      output: {
        rows: [{ value: 42 }],
      },
    }));
    let attempt = 0;
    const executor: RunWorkflowExecutorPort = {
      async execute({ context }) {
        attempt += 1;
        const receipt = await context.executeSideEffectOnce({
          effect_kind: "SQL",
          input: {
            query: "select 42",
            snapshot: "fixture-v1",
          },
          execute: effect,
        });
        if (!receipt.ok) throw new Error(receipt.error.code);
        if (attempt === 1) throw new Error("crash-after-side-effect-event");
        return { kind: "COMPLETED" };
      },
    };
    const { runtime, runner } = await harness(executor);
    const historyScan = vi.spyOn(runtime, "listEvents");
    runtime.enqueueLease(lease(1, 1));

    await expect(runner.runOnce({ scope, worker_id: "worker-1" })).resolves.toMatchObject({
      ok: false,
      error: { code: "WORKER_PROCESS_CRASH", retryable: true },
    });

    runtime.enqueueLease(lease(2, 2));
    await expect(runner.runOnce({ scope, worker_id: "worker-2" })).resolves.toMatchObject({
      ok: true,
      value: { kind: "COMPLETED" },
    });
    expect(effect).toHaveBeenCalledTimes(1);
    expect(runtime.receiptsFor(runId)).toHaveLength(1);
    expect(
      runtime
        .eventsFor(runId)
        .filter(({ event_type }) => event_type === "run.side_effect_committed"),
    ).toHaveLength(1);
    expect(historyScan).not.toHaveBeenCalled();
  });

  it("外部结果已返回但 Receipt 提交失败时，下一 Attempt 复用稳定幂等键", async () => {
    const externalResults = new Map<string, { readonly rows: readonly [{ readonly value: 42 }] }>();
    let physicalExecutions = 0;
    const effect = vi.fn(async ({ idempotency_key }: { readonly idempotency_key: string }) => {
      const existing = externalResults.get(idempotency_key);
      if (existing) return { output: existing };
      physicalExecutions += 1;
      const output = { rows: [{ value: 42 }] } as const;
      externalResults.set(idempotency_key, output);
      return { output };
    });
    const executor: RunWorkflowExecutorPort = {
      async execute({ context }) {
        const receipt = await context.executeSideEffectOnce({
          effect_kind: "SQL",
          input: {
            query: "select 42",
            snapshot: "fixture-v1",
          },
          execute: effect,
        });
        if (!receipt.ok) throw new Error(receipt.error.code);
        return { kind: "COMPLETED" };
      },
    };
    const { runtime, runner } = await harness(executor);
    runtime.enqueueLease(lease(1, 1));
    runtime.failNextSideEffectCommit("RUN_EFFECT_RECEIPT_COMMIT_INTERRUPTED");

    await expect(runner.runOnce({ scope, worker_id: "worker-1" })).resolves.toMatchObject({
      ok: false,
      error: { code: "WORKER_PROCESS_CRASH", retryable: true },
    });
    expect(runtime.receiptsFor(runId)).toHaveLength(0);

    runtime.enqueueLease(lease(2, 2));
    await expect(runner.runOnce({ scope, worker_id: "worker-2" })).resolves.toMatchObject({
      ok: true,
      value: { kind: "COMPLETED" },
    });
    expect(effect).toHaveBeenCalledTimes(2);
    expect(effect.mock.calls[0]?.[0]).toMatchObject({
      idempotency_key: effect.mock.calls[1]?.[0].idempotency_key,
    });
    expect(physicalExecutions).toBe(1);
    expect(runtime.receiptsFor(runId)).toHaveLength(1);
  });

  it("先提交 Snapshot 再追加 checkpoint Event，并绑定当前 Attempt/Fence/Event/Artifact", async () => {
    const activeArtifactRef = {
      artifact_id: "80000000-0000-4000-8000-000000000030",
      artifact_type: "QuestionFrame",
      ...scope,
      run_id: runId,
      revision: 1,
      content_hash: `sha256:${"3".repeat(64)}`,
    } as const satisfies ArtifactReference;
    const executor: RunWorkflowExecutorPort = {
      async execute({ context }) {
        const checkpoint = await context.checkpoint(checkpointInput(1, activeArtifactRef));
        expect(checkpoint.ok).toBe(true);
        return { kind: "COMPLETED" };
      },
    };
    const { runtime, runner } = await harness(executor);
    runtime.enqueueLease(lease(1, 7));

    const result = await runner.runOnce({ scope, worker_id: "worker-1" });

    expect(result.ok).toBe(true);
    const snapshot = runtime.snapshotsFor(runId)[0];
    expect(snapshot).toMatchObject({
      authority: "EXECUTION_SNAPSHOT_ONLY",
      attempt_id: lease(1, 7).attempt_id,
      worker_fence: 7,
      event_sequence: 2,
      active_artifact_ref: activeArtifactRef,
      mastra_snapshot: {
        runId: "mastra-run-1",
      },
    });
    expect(runtime.operations.indexOf("snapshot:commit")).toBeLessThan(
      runtime.operations.indexOf("event:run.checkpointed"),
    );
    expect(
      runtime.eventsFor(runId).find(({ event_type }) => event_type === "run.checkpointed"),
    ).toMatchObject({
      worker_fence: 7,
      payload: {
        active_artifact_ref: activeArtifactRef,
        snapshot_ref: {
          snapshot_id: snapshot?.snapshot_id,
          snapshot_version: 1,
          snapshot_hash: snapshot?.snapshot_hash,
        },
      },
    });
  });

  it.each([
    {
      name: "completed",
      executorResult: { kind: "COMPLETED" } as const,
      finalEvent: "run.completed",
      queueAction: "queue:complete",
      outcome: "COMPLETED",
    },
    {
      name: "suspended",
      executorResult: {
        kind: "SUSPENDED",
        reason_code: "WAITING_FOR_CLARIFICATION",
        checkpoint: checkpointInput(),
      } as const,
      finalEvent: "run.suspended",
      queueAction: "queue:complete",
      outcome: "SUSPENDED",
    },
    {
      name: "retry",
      executorResult: {
        kind: "RETRY",
        error_code: "MODEL_PROVIDER_TEMPORARY_FAILURE",
        retry_delay_ms: 60_000,
      } as const,
      finalEvent: "run.retry_scheduled",
      queueAction: "queue:retry",
      outcome: "RETRY_SCHEDULED",
    },
    {
      name: "failed",
      executorResult: {
        kind: "FAILED",
        error_code: "WORKFLOW_CONTRACT_VIOLATION",
      } as const,
      finalEvent: "run.failed",
      queueAction: "queue:complete",
      outcome: "FAILED",
    },
  ])(
    "$name 结果确定性映射到 Event 与 Queue 动作",
    async ({ executorResult, finalEvent, queueAction, outcome }) => {
      const { runtime, runner } = await harness({
        async execute() {
          return executorResult;
        },
      });
      runtime.enqueueLease(lease(1, 1));

      const result = await runner.runOnce({ scope, worker_id: "worker-1" });

      expect(result).toMatchObject({
        ok: true,
        value: { kind: outcome },
      });
      expect(runtime.operations).toContain(`event:${finalEvent}`);
      expect(runtime.operations.at(-1)).toBe(queueAction);
    },
  );

  it("无效 Executor Result 立即失败并 Dead-letter，不等待 Lease 过期", async () => {
    const { runtime, runner } = await harness({
      async execute() {
        return {
          kind: "RETRY",
          error_code: "MODEL_PROVIDER_TEMPORARY_FAILURE",
          retry_delay_ms: 0,
        } as unknown as Awaited<ReturnType<RunWorkflowExecutorPort["execute"]>>;
      },
    });
    runtime.enqueueLease(lease(1, 1));

    const result = await runner.runOnce({ scope, worker_id: "worker-1" });

    expect(result).toMatchObject({
      ok: true,
      value: { kind: "FAILED" },
    });
    expect(runtime.retried).toHaveLength(0);
    expect(runtime.completed).toHaveLength(1);
    expect(
      runtime.eventsFor(runId).find(({ event_type }) => event_type === "run.failed"),
    ).toMatchObject({
      payload: {
        error_code: "RUN_EXECUTOR_RESULT_INVALID",
        retryable: false,
      },
    });
  });

  it("同一 Outbox 的第 5 次交付请求 RETRY 时立即耗尽预算并进入 FAILED", async () => {
    const { runtime, runner } = await harness({
      async execute() {
        return {
          kind: "RETRY",
          error_code: "MODEL_PROVIDER_TEMPORARY_FAILURE",
          retry_delay_ms: RUN_RETRY_MIN_DELAY_MS,
        };
      },
    });
    runtime.enqueueLease(lease(RUN_RETRY_MAX_ATTEMPTS, RUN_RETRY_MAX_ATTEMPTS));

    const result = await runner.runOnce({
      scope,
      worker_id: `worker-${RUN_RETRY_MAX_ATTEMPTS}`,
    });

    expect(result).toMatchObject({
      ok: true,
      value: { kind: "FAILED" },
    });
    expect(runtime.retried).toHaveLength(0);
    expect(
      runtime.eventsFor(runId).find(({ event_type }) => event_type === "run.failed"),
    ).toMatchObject({
      payload: {
        error_code: "RUN_ATTEMPT_BUDGET_EXHAUSTED",
      },
    });
  });

  it("显式 Resume 的新 Outbox 重置交付预算，但保持 Run Attempt 序号单调", async () => {
    const { runtime, runner } = await harness({
      async execute() {
        return {
          kind: "RETRY",
          error_code: "MODEL_PROVIDER_TEMPORARY_FAILURE",
          retry_delay_ms: RUN_RETRY_MIN_DELAY_MS,
        };
      },
    });
    runtime.enqueueLease(lease(6, 6, "worker-6", 1));

    const result = await runner.runOnce({ scope, worker_id: "worker-6" });

    expect(result).toMatchObject({
      ok: true,
      value: { kind: "RETRY_SCHEDULED" },
    });
    expect(runtime.retried[0]?.lease).toMatchObject({
      attempt_no: 6,
      delivery_attempt_no: 1,
    });
  });

  it("Executor 超过 Deadline 时收到 AbortSignal，并按最小退避持久化重试", async () => {
    let observedAbort = false;
    let observedDeadline: string | undefined;
    const { runtime, runner } = await harness(
      {
        async execute({ signal, deadline_at }) {
          observedDeadline = deadline_at;
          return new Promise((_, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                observedAbort = true;
                reject(signal.reason);
              },
              { once: true },
            );
          });
        },
      },
      {
        execution_timeout_ms: 30,
        heartbeat_interval_ms: 10,
        side_effect_timeout_ms: 20,
      },
    );
    runtime.enqueueLease(lease(1, 1));

    const result = await runner.runOnce({ scope, worker_id: "worker-1" });

    expect(result).toMatchObject({
      ok: true,
      value: { kind: "RETRY_SCHEDULED" },
    });
    expect(observedAbort).toBe(true);
    expect(observedDeadline).toBe("2026-07-26T00:01:00.030Z");
    expect(runtime.retried).toEqual([
      expect.objectContaining({
        error_code: "RUN_EXECUTION_TIMEOUT",
        retry_delay_ms: RUN_RETRY_MIN_DELAY_MS,
      }),
    ]);
    expect(runtime.heartbeats.length).toBeGreaterThan(1);
  });

  it("自动 Heartbeat 发现 Lease 失效时中止 Executor 并返回 stale outcome", async () => {
    let observedAbort = false;
    const { runtime, runner } = await harness(
      {
        async execute({ signal }) {
          return new Promise((_, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                observedAbort = true;
                reject(signal.reason);
              },
              { once: true },
            );
          });
        },
      },
      {
        execution_timeout_ms: 100,
        heartbeat_interval_ms: 10,
        side_effect_timeout_ms: 20,
      },
    );
    const heartbeat = runtime.heartbeat.bind(runtime);
    let heartbeatCall = 0;
    vi.spyOn(runtime, "heartbeat").mockImplementation(async (input) => {
      heartbeatCall += 1;
      if (heartbeatCall < 3) return heartbeat(input);
      await cancelRuntime(runtime, 2, "cancel-on-heartbeat");
      return {
        ok: false,
        error: {
          code: "RUN_QUEUE_STALE_FENCE",
          message: "Lease 已失效。",
          retryable: false,
        },
      };
    });
    runtime.enqueueLease(lease(1, 1));

    const result = await runner.runOnce({ scope, worker_id: "worker-1" });

    expect(result).toMatchObject({
      ok: true,
      value: { kind: "CANCELLED_OR_STALE" },
    });
    expect(observedAbort).toBe(true);
    expect(runtime.completed).toHaveLength(0);
    expect(runtime.retried).toHaveLength(0);
  });

  it("Snapshot 恢复受 Deadline 与自动 Heartbeat 监督，超时后不启动 Executor", async () => {
    let executorStarted = false;
    const { runtime, runner } = await harness(
      {
        async execute() {
          executorStarted = true;
          return { kind: "COMPLETED" };
        },
      },
      {
        execution_timeout_ms: 30,
        heartbeat_interval_ms: 10,
        side_effect_timeout_ms: 20,
      },
    );
    vi.spyOn(runtime, "loadLatestSnapshot").mockImplementation(() => new Promise(() => undefined));
    runtime.enqueueLease(lease(1, 1));

    const result = await runner.runOnce({ scope, worker_id: "worker-1" });

    expect(result).toMatchObject({
      ok: true,
      value: { kind: "RETRY_SCHEDULED" },
    });
    expect(executorStarted).toBe(false);
    expect(runtime.heartbeats.length).toBeGreaterThan(1);
    expect(runtime.retried).toEqual([
      expect.objectContaining({
        error_code: "RUN_EXECUTION_TIMEOUT",
        retry_delay_ms: RUN_RETRY_MIN_DELAY_MS,
      }),
    ]);
  });

  it("Snapshot 恢复后的 Lease 复核失败时不启动 Executor", async () => {
    let executorStarted = false;
    const { runtime, runner } = await harness({
      async execute() {
        executorStarted = true;
        return { kind: "COMPLETED" };
      },
    });
    const heartbeat = runtime.heartbeat.bind(runtime);
    let heartbeatCall = 0;
    vi.spyOn(runtime, "heartbeat").mockImplementation(async (input) => {
      heartbeatCall += 1;
      if (heartbeatCall === 1) return heartbeat(input);
      await cancelRuntime(runtime, 2, "cancel-after-snapshot");
      return {
        ok: false,
        error: {
          code: "RUN_QUEUE_STALE_FENCE",
          message: "Lease 已失效。",
          retryable: false,
        },
      };
    });
    runtime.enqueueLease(lease(1, 1));

    const result = await runner.runOnce({ scope, worker_id: "worker-1" });

    expect(result).toMatchObject({
      ok: true,
      value: { kind: "CANCELLED_OR_STALE" },
    });
    expect(heartbeatCall).toBe(2);
    expect(executorStarted).toBe(false);
    expect(runtime.completed).toHaveLength(0);
    expect(runtime.retried).toHaveLength(0);
  });

  it("Side Effect 超过独立 Deadline 时中止外部调用且不提交 Receipt", async () => {
    let observedAbort = false;
    const { runtime, runner } = await harness(
      {
        async execute({ context }) {
          const effect = await context.executeSideEffectOnce({
            effect_kind: "SQL",
            input: { query: "select pg_sleep(60)" },
            execute: ({ signal }) =>
              new Promise((_, reject) => {
                signal.addEventListener(
                  "abort",
                  () => {
                    observedAbort = true;
                    reject(signal.reason);
                  },
                  { once: true },
                );
              }),
          });
          if (!effect.ok) {
            return {
              kind: "RETRY",
              error_code: effect.error.code,
              retry_delay_ms: RUN_RETRY_MIN_DELAY_MS,
            };
          }
          return { kind: "COMPLETED" };
        },
      },
      {
        execution_timeout_ms: 100,
        heartbeat_interval_ms: 20,
        side_effect_timeout_ms: 10,
      },
    );
    runtime.enqueueLease(lease(1, 1));

    const result = await runner.runOnce({ scope, worker_id: "worker-1" });

    expect(result).toMatchObject({
      ok: true,
      value: { kind: "RETRY_SCHEDULED" },
    });
    expect(observedAbort).toBe(true);
    expect(runtime.receiptsFor(runId)).toHaveLength(0);
    expect(
      runtime
        .eventsFor(runId)
        .filter(({ event_type }) => event_type === "run.side_effect_committed"),
    ).toHaveLength(0);
    expect(runtime.retried[0]?.error_code).toBe("RUN_SIDE_EFFECT_TIMEOUT");
  });

  it.each([
    {
      name: "completed",
      result: { kind: "COMPLETED" } as const,
      eventType: "run.completed" as const,
    },
    {
      name: "suspended",
      result: {
        kind: "SUSPENDED",
        reason_code: "WAITING_FOR_CLARIFICATION",
        checkpoint: checkpointInput(),
      } as const,
      eventType: "run.suspended" as const,
    },
    {
      name: "retry",
      result: {
        kind: "RETRY",
        error_code: "MODEL_PROVIDER_TEMPORARY_FAILURE",
        retry_delay_ms: RUN_RETRY_MIN_DELAY_MS,
      } as const,
      eventType: "run.retry_scheduled" as const,
    },
    {
      name: "failed",
      result: {
        kind: "FAILED",
        error_code: "WORKFLOW_CONTRACT_VIOLATION",
      } as const,
      eventType: "run.failed" as const,
    },
  ])(
    "$name 在本地 Guard 后发生 Cancel/Projection Conflict 时统一返回 stale outcome",
    async ({ result: executorResult, eventType }) => {
      const { runtime, runner } = await harness({
        async execute() {
          return executorResult;
        },
      });
      runtime.enqueueLease(lease(1, 1));
      runtime.beforeNextAppend(eventType, () =>
        cancelRuntime(runtime, 2, `cancel-before-${eventType}`),
      );

      const result = await runner.runOnce({ scope, worker_id: "worker-1" });

      expect(result).toMatchObject({
        ok: true,
        value: { kind: "CANCELLED_OR_STALE" },
      });
      expect(runtime.completed).toHaveLength(0);
      expect(runtime.retried).toHaveLength(0);
    },
  );

  it("claim 与 run.leased 之间发生 Cancel 时统一返回 stale outcome", async () => {
    const { runtime, runner } = await harness({
      async execute() {
        return { kind: "COMPLETED" };
      },
    });
    runtime.enqueueLease(lease(1, 1));
    runtime.beforeNextAppend("run.leased", () =>
      cancelRuntime(runtime, 2, "cancel-before-run-leased"),
    );

    const result = await runner.runOnce({ scope, worker_id: "worker-1" });

    expect(result).toMatchObject({
      ok: true,
      value: { kind: "CANCELLED_OR_STALE" },
    });
    expect(runtime.eventsFor(runId).some(({ event_type }) => event_type === "run.leased")).toBe(
      false,
    );
  });

  it("Provider Streaming 期间收到取消时拒绝迟到 completed", async () => {
    const { runtime, runner } = await harness({
      async execute({ lease: activeLease }) {
        const projection = await runtime.readProjection({
          scope,
          run_id: runId,
        });
        if (!projection.ok || !projection.value) {
          throw new Error("missing projection");
        }
        await runtime.forceAppend({
          schema_version: "1.0.0",
          event_id: "80000000-0000-4000-8000-000000000040",
          event_type: "run.cancel_requested",
          scope,
          run_id: runId,
          sequence: projection.value.projection.version + 1,
          worker_fence: activeLease.worker_fence + 1,
          idempotency_key: "cancel-during-stream",
          occurred_at: "2026-07-26T00:02:00.000Z",
          payload: {
            command_id: commandId,
          },
        });
        return { kind: "COMPLETED" };
      },
    });
    runtime.enqueueLease(lease(1, 4));

    const result = await runner.runOnce({ scope, worker_id: "worker-1" });

    expect(result).toMatchObject({
      ok: true,
      value: { kind: "CANCELLED_OR_STALE" },
    });
    expect(runtime.eventsFor(runId).some(({ event_type }) => event_type === "run.completed")).toBe(
      false,
    );
    expect(runtime.completed).toHaveLength(0);
    expect(runtime.retried).toHaveLength(0);
  });

  it("Side Effect 返回后、Receipt 提交前收到取消时拒绝 Receipt 与 Event", async () => {
    const effect = vi.fn(async () => {
      const projection = await runtime.readProjection({
        scope,
        run_id: runId,
      });
      if (!projection.ok || !projection.value) {
        throw new Error("missing projection");
      }
      await runtime.forceAppend({
        schema_version: "1.0.0",
        event_id: "80000000-0000-4000-8000-000000000042",
        event_type: "run.cancel_requested",
        scope,
        run_id: runId,
        sequence: projection.value.projection.version + 1,
        worker_fence: 10,
        idempotency_key: "cancel-before-receipt",
        occurred_at: "2026-07-26T00:02:00.000Z",
        payload: {
          command_id: commandId,
        },
      });
      return { output: { rows: [] } };
    });
    const { runtime, runner } = await harness({
      async execute({ context }) {
        const result = await context.executeSideEffectOnce({
          effect_kind: "SQL",
          input: { query: "select pg_sleep(1)" },
          execute: effect,
        });
        if (!result.ok) {
          throw new Error(result.error.code);
        }
        return { kind: "COMPLETED" };
      },
    });
    runtime.enqueueLease(lease(1, 9));

    const result = await runner.runOnce({ scope, worker_id: "worker-1" });

    expect(result).toMatchObject({
      ok: true,
      value: { kind: "CANCELLED_OR_STALE" },
    });
    expect(effect).toHaveBeenCalledTimes(1);
    expect(runtime.receiptsFor(runId)).toHaveLength(0);
    expect(
      runtime
        .eventsFor(runId)
        .filter(({ event_type }) => event_type === "run.side_effect_committed"),
    ).toHaveLength(0);
  });

  it("Fence 被新 Worker 接管后拒绝旧 Worker 的迟到 completed", async () => {
    const { runtime, runner } = await harness({
      async execute() {
        const projection = await runtime.readProjection({
          scope,
          run_id: runId,
        });
        if (!projection.ok || !projection.value) {
          throw new Error("missing projection");
        }
        await runtime.forceAppend({
          schema_version: "1.0.0",
          event_id: "80000000-0000-4000-8000-000000000041",
          event_type: "run.leased",
          scope,
          run_id: runId,
          sequence: projection.value.projection.version + 1,
          worker_fence: 6,
          idempotency_key: "takeover-by-worker-2",
          occurred_at: "2026-07-26T00:02:00.000Z",
          payload: {
            command_id: commandId,
            lease_id: "takeover-lease",
            worker_id: "worker-2",
            attempt: 2,
          },
        });
        return { kind: "COMPLETED" };
      },
    });
    runtime.enqueueLease(lease(1, 5));

    const result = await runner.runOnce({ scope, worker_id: "worker-1" });

    expect(result).toMatchObject({
      ok: true,
      value: { kind: "CANCELLED_OR_STALE" },
    });
    expect(runtime.eventsFor(runId).some(({ event_type }) => event_type === "run.completed")).toBe(
      false,
    );
  });

  it("unexpected process crash 保留 Lease，不 ack 也不 retry，等待过期接管", async () => {
    const { runtime, runner } = await harness({
      async execute() {
        throw new Error("provider stream interrupted");
      },
    });
    runtime.enqueueLease(lease(1, 1));

    const result = await runner.runOnce({ scope, worker_id: "worker-1" });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "WORKER_PROCESS_CRASH",
        retryable: true,
      },
    });
    expect(runtime.completed).toHaveLength(0);
    expect(runtime.retried).toHaveLength(0);
    expect(runtime.eventsFor(runId).map(({ event_type }) => event_type)).toEqual([
      "run.accepted",
      "run.leased",
    ]);
  });

  it("进程在 checkpoint 后崩溃时，新 Attempt 从已提交的 opaque Snapshot 恢复", async () => {
    let execution = 0;
    const restoredSnapshotIds: Array<string | null> = [];
    const { runtime, runner } = await harness({
      async execute({ context, restored_snapshot }) {
        execution += 1;
        restoredSnapshotIds.push(restored_snapshot?.snapshot_id ?? null);
        if (execution === 1) {
          const checkpoint = await context.checkpoint(checkpointInput());
          if (!checkpoint.ok) {
            throw new Error(checkpoint.error.code);
          }
          throw new Error("process crash after checkpoint");
        }
        return { kind: "COMPLETED" };
      },
    });
    runtime.enqueueLease(lease(1, 1));

    const first = await runner.runOnce({ scope, worker_id: "worker-1" });

    expect(first).toMatchObject({
      ok: false,
      error: { code: "WORKER_PROCESS_CRASH" },
    });
    const committedSnapshot = runtime.snapshotsFor(runId)[0];
    expect(committedSnapshot).toBeDefined();

    runtime.enqueueLease(lease(2, 2));
    const second = await runner.runOnce({ scope, worker_id: "worker-2" });

    expect(second).toMatchObject({
      ok: true,
      value: { kind: "COMPLETED" },
    });
    expect(restoredSnapshotIds).toEqual([null, committedSnapshot?.snapshot_id]);
    expect(runtime.completed).toHaveLength(1);
  });

  it("Executor 不能把 opaque Snapshot 提升为正确性 Authority", async () => {
    const { runtime, runner } = await harness({
      async execute({ context }) {
        const authorityAttempt = {
          ...checkpointInput(),
          authority: "AUTHORITATIVE",
        } as const;
        const checkpoint = await context.checkpoint(authorityAttempt);
        if (!checkpoint.ok) {
          return {
            kind: "FAILED",
            error_code: checkpoint.error.code,
          };
        }
        return { kind: "COMPLETED" };
      },
    });
    runtime.enqueueLease(lease(1, 1));

    const result = await runner.runOnce({ scope, worker_id: "worker-1" });

    expect(result).toMatchObject({
      ok: true,
      value: { kind: "FAILED" },
    });
    expect(runtime.snapshotsFor(runId)).toHaveLength(0);
    expect(
      runtime.eventsFor(runId).find(({ event_type }) => event_type === "run.failed"),
    ).toMatchObject({
      payload: {
        error_code: "RUN_CHECKPOINT_INPUT_INVALID",
      },
    });
  });

  it("Side Effect Input 使用规范内容哈希，同键不同对象属性顺序只执行一次", async () => {
    const effect = vi.fn(async () => ({ output: { value: 1 } }));
    const seenHashes: string[] = [];
    const { runtime, runner } = await harness({
      async execute({ context }) {
        const first = await context.executeSideEffectOnce({
          effect_kind: "EVAL",
          input: { b: 2, a: 1 },
          execute: effect,
        });
        const second = await context.executeSideEffectOnce({
          effect_kind: "EVAL",
          input: { a: 1, b: 2 },
          execute: effect,
        });
        if (!first.ok || !second.ok) {
          throw new Error("side effect failed");
        }
        seenHashes.push(first.value.input_hash, second.value.input_hash);
        return { kind: "COMPLETED" };
      },
    });
    runtime.enqueueLease(lease(1, 1));

    await runner.runOnce({ scope, worker_id: "worker-1" });

    expect(effect).toHaveBeenCalledTimes(1);
    expect(seenHashes[0]).toBe(await sha256ContentHash({ a: 1, b: 2 }));
    expect(seenHashes[1]).toBe(seenHashes[0]);
  });
});
