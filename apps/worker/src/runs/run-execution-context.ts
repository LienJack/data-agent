import {
  type ContextReceiptBinding,
  canonicalImmutableIdSchema,
  type EffectiveRunConfigReceiptCandidate,
  type MastraSnapshotBinding,
  MODEL_REQUEST_PERFORMANCE_SCHEMA_VERSION,
  MODEL_REQUEST_TOOL_NAME,
  type ModelRequestPerformance,
  mastraSnapshotBindingBodySchema,
  modelRequestPerformanceSchema,
  type PortResult,
  type ResolvedContextCommitResult,
  type RunEventStorePort,
  type RunProjectionRecord,
  type RunWorkLease,
  runCheckpointInputSchema,
  type SideEffectReceipt,
  sha256ContentHash,
  sideEffectReceiptSchema,
} from "@data-agent/contracts";
import type { RunDisplayEventInput, RunExecutionContext } from "./run-worker-runner.js";
import { failure, occurredAt, receiptMatchesRequest, success } from "./run-worker-shared.js";

declare const runExecutionContextProvenance: unique symbol;
export type RunExecutionContextProvenance = Readonly<{
  [runExecutionContextProvenance]: true;
}>;

const trustedRunExecutionContexts = new WeakSet<object>();
const trustedProviderDispatchCapabilities = new WeakSet<object>();
const trustedResolvedContextCapabilities = new WeakSet<object>();

export interface RunProviderDispatchCapability {
  invoke(input: {
    readonly logical_call_id: string;
    readonly turn?: Readonly<{
      kind: "SPECIALIST";
      stage: "TEXT2SQL" | "REPORT";
      profile_id: string;
      objective: string;
    }>;
  }): Promise<PortResult<RunModelProviderResult>>;
}

export type RunModelProviderResult = Readonly<{
  output_text: string;
  tool_calls: readonly unknown[];
  request_performance?: ModelRequestPerformance;
  projection: Readonly<{
    invocation_id: string;
    status: "STARTED" | "COMPLETED" | "FAILED" | "THROTTLED" | "OUTCOME_UNKNOWN";
    provider: string;
    model_id: string;
  }>;
}>;

export interface RunBoundProviderDispatcher {
  invoke(input: {
    readonly lease: RunWorkLease;
    readonly effective_config: EffectiveRunConfigReceiptCandidate;
    readonly context_receipt: ContextReceiptBinding;
    readonly logical_call_id: string;
    readonly turn?: Parameters<RunProviderDispatchCapability["invoke"]>[0]["turn"];
    readonly signal: AbortSignal;
  }): Promise<PortResult<RunModelProviderResult>>;
}

export interface RunResolvedContextCapability {
  resolve(): Promise<PortResult<ResolvedContextCommitResult>>;
}

export interface RunBoundResolvedContextResolver {
  resolve(input: {
    readonly lease: RunWorkLease;
    readonly effective_config: EffectiveRunConfigReceiptCandidate;
    readonly context_receipt: ContextReceiptBinding;
  }): Promise<PortResult<ResolvedContextCommitResult>>;
}

export function hasRunResolvedContextCapability(
  input: unknown,
): input is RunResolvedContextCapability {
  return (
    typeof input === "object" && input !== null && trustedResolvedContextCapabilities.has(input)
  );
}

export function hasRunProviderDispatchCapability(
  input: unknown,
): input is RunProviderDispatchCapability {
  return (
    typeof input === "object" && input !== null && trustedProviderDispatchCapabilities.has(input)
  );
}

export function hasRunExecutionContextProvenance(input: unknown): input is RunExecutionContext {
  return typeof input === "object" && input !== null && trustedRunExecutionContexts.has(input);
}

interface RunExecutionContextDependencies {
  readonly lease: RunWorkLease;
  readonly effective_config: EffectiveRunConfigReceiptCandidate;
  readonly context_receipt: ContextReceiptBinding;
  readonly run_signal: AbortSignal;
  readonly event_store: Pick<
    RunEventStorePort,
    "commitSideEffect" | "commitSnapshot" | "findSideEffect"
  >;
  readonly now: () => Date;
  readonly create_id: () => string;
  readonly side_effect_timeout_ms: number;
  readonly provider_dispatch: RunBoundProviderDispatcher | null;
  readonly resolved_context?: RunBoundResolvedContextResolver | null;
  readonly heartbeat: () => Promise<PortResult<{ readonly expires_at: string }>>;
  readonly guard_running_lease: (
    lease: RunWorkLease,
    expectedProjectionHash?: string,
  ) => Promise<PortResult<RunProjectionRecord>>;
  readonly append_checkpoint_event: (
    binding: MastraSnapshotBinding,
  ) => Promise<PortResult<unknown>>;
  readonly append_side_effect_event: (
    receipt: SideEffectReceipt,
  ) => Promise<PortResult<SideEffectReceipt>>;
  readonly append_display_event: (
    input: RunDisplayEventInput,
  ) => Promise<PortResult<{ readonly sequence: number }>>;
}

export function createRunExecutionContext({
  lease,
  effective_config: effectiveConfig,
  context_receipt: contextReceipt,
  run_signal: runSignal,
  event_store: eventStore,
  now,
  create_id: createId,
  side_effect_timeout_ms: sideEffectTimeoutMs,
  provider_dispatch: providerDispatch,
  resolved_context: resolvedContext,
  heartbeat,
  guard_running_lease: guardRunningLease,
  append_checkpoint_event: appendCheckpointEvent,
  append_side_effect_event: appendSideEffectEvent,
  append_display_event: appendDisplayEvent,
}: RunExecutionContextDependencies): RunExecutionContext {
  const inFlightSideEffects = new Map<string, Promise<PortResult<SideEffectReceipt>>>();
  const aborted = <T>(): PortResult<T> =>
    failure(
      "RUN_EXECUTION_ABORTED",
      "Run 执行已因取消、Heartbeat 失败或 Deadline 到期而中止。",
      false,
    );
  const providerLogicalCalls = new Set<string>();
  const providerCallLimit = effectiveConfig.execution_safety_policy.max_provider_calls;
  const providerDispatchCapability = providerDispatch
    ? Object.freeze({
        async invoke(input: Parameters<RunProviderDispatchCapability["invoke"]>[0]) {
          if (runSignal.aborted) return Promise.resolve(aborted<RunModelProviderResult>());
          const logicalCallId = canonicalImmutableIdSchema.safeParse(input.logical_call_id);
          if (!logicalCallId.success) {
            return Promise.resolve(
              failure(
                "PROVIDER_LOGICAL_CALL_ID_INVALID",
                "Provider logical call ID 必须是 canonical immutable ID。",
                false,
              ),
            );
          }
          if (providerLogicalCalls.has(logicalCallId.data)) {
            return Promise.resolve(
              failure(
                "PROVIDER_LOGICAL_CALL_DUPLICATE",
                "同一 Run Execution Context 不能重复消费 Provider logical call ID。",
                false,
              ),
            );
          }
          if (providerLogicalCalls.size >= providerCallLimit) {
            return Promise.resolve(
              failure(
                "PROVIDER_CALL_LIMIT_EXCEEDED",
                "Provider logical call 数量已达到冻结 Execution Safety Policy 上限。",
                false,
              ),
            );
          }
          providerLogicalCalls.add(logicalCallId.data);
          const callId = logicalCallId.data;
          const provider = effectiveConfig.model.provider;
          const modelId = effectiveConfig.model.model_id;
          const startedAt = now().getTime();
          const started = await appendDisplayEvent({
            kind: "tool_started",
            key: `model.request.started:${callId}`,
            call_id: callId,
            tool_name: MODEL_REQUEST_TOOL_NAME,
            title: "模型请求",
            summary: `正在调用 ${provider}/${modelId}`,
            input: null,
            profile_id: null,
            task_id: null,
            artifact_refs: [],
          });
          if (!started.ok) return started;
          const result = await providerDispatch.invoke({
            lease,
            effective_config: effectiveConfig,
            context_receipt: contextReceipt,
            logical_call_id: callId,
            ...(input.turn ? { turn: input.turn } : {}),
            signal: runSignal,
          });
          const measuredDuration = Math.max(0, now().getTime() - startedAt);
          const failPerformanceProjection = async (code: string, message: string) => {
            const failed = await appendDisplayEvent({
              kind: "tool_failed" as const,
              key: `model.request.failed:${callId}`,
              call_id: callId,
              tool_name: MODEL_REQUEST_TOOL_NAME,
              summary: `模型请求性能投影失败 · ${provider}/${modelId}`,
              error_code: code,
              output: null,
              duration_ms: measuredDuration,
              profile_id: null,
              task_id: null,
              artifact_refs: [],
            });
            return failed.ok ? failure<RunModelProviderResult>(code, message, false) : failed;
          };
          if (!result.ok) {
            const failed = await appendDisplayEvent({
              kind: "tool_failed",
              key: `model.request.failed:${callId}`,
              call_id: callId,
              tool_name: MODEL_REQUEST_TOOL_NAME,
              summary: `模型请求失败 · ${provider}/${modelId}`,
              error_code: result.error.code,
              output: null,
              duration_ms: measuredDuration,
              profile_id: null,
              task_id: null,
              artifact_refs: [],
            });
            return failed.ok ? result : failed;
          }
          const reportedPerformance = result.value.request_performance;
          if (
            reportedPerformance &&
            (reportedPerformance.request_id !== callId ||
              reportedPerformance.provider !== provider ||
              reportedPerformance.profile_id !== effectiveConfig.model.resource_id ||
              reportedPerformance.model_id !== modelId)
          ) {
            return failPerformanceProjection(
              "MODEL_REQUEST_PERFORMANCE_IDENTITY_MISMATCH",
              "模型请求性能投影与冻结 Run/Model identity 不一致。",
            );
          }
          const parsedPerformance = modelRequestPerformanceSchema.safeParse(
            reportedPerformance
              ? { ...reportedPerformance, duration_ms: measuredDuration }
              : {
                  schema_version: MODEL_REQUEST_PERFORMANCE_SCHEMA_VERSION,
                  request_id: callId,
                  provider,
                  profile_id: effectiveConfig.model.resource_id,
                  model_id: modelId,
                  status: "COMPLETED",
                  attempt_count: 1,
                  duration_ms: measuredDuration,
                  context_window_tokens: effectiveConfig.context_policy.max_context_tokens,
                  reserved_output_tokens: 2_048,
                  usage: {
                    availability: "UNAVAILABLE",
                    source: "UNAVAILABLE",
                    input_tokens: null,
                    output_tokens: null,
                    total_tokens: null,
                    tool_calls: null,
                    unavailable_reason: "PROVIDER_DID_NOT_REPORT_USAGE",
                  },
                },
          );
          if (!parsedPerformance.success) {
            return failPerformanceProjection(
              "MODEL_REQUEST_PERFORMANCE_INVALID",
              "模型请求性能投影不满足公开契约。",
            );
          }
          const performance = parsedPerformance.data;
          const completed = await appendDisplayEvent({
            kind: "tool_completed",
            key: `model.request.completed:${callId}`,
            call_id: callId,
            tool_name: MODEL_REQUEST_TOOL_NAME,
            summary: `模型请求完成 · ${provider}/${modelId}`,
            output: JSON.stringify(performance),
            duration_ms: performance.duration_ms,
            profile_id: null,
            task_id: null,
            artifact_refs: [],
          });
          return completed.ok
            ? { ok: true, value: { ...result.value, request_performance: performance } }
            : completed;
        },
      })
    : null;
  if (providerDispatchCapability) {
    trustedProviderDispatchCapabilities.add(providerDispatchCapability);
  }
  let resolvedContextUsed = false;
  const resolvedContextCapability = resolvedContext
    ? Object.freeze({
        resolve() {
          if (runSignal.aborted) return Promise.resolve(aborted<ResolvedContextCommitResult>());
          if (resolvedContextUsed) {
            return Promise.resolve(
              failure(
                "RESOLVED_CONTEXT_ALREADY_CONSUMED",
                "Resolved Context capability can be consumed only once per Run attempt.",
                false,
              ),
            );
          }
          resolvedContextUsed = true;
          return resolvedContext.resolve({
            lease,
            effective_config: effectiveConfig,
            context_receipt: contextReceipt,
          });
        },
      })
    : null;
  if (resolvedContextCapability) trustedResolvedContextCapabilities.add(resolvedContextCapability);

  const context = {
    getEffectiveConfig() {
      return effectiveConfig;
    },

    getContextReceipt() {
      return contextReceipt;
    },

    getProviderDispatchCapability() {
      return providerDispatchCapability;
    },

    getResolvedContextCapability() {
      return resolvedContextCapability;
    },

    async emitDisplayEvent(input) {
      if (runSignal.aborted) return aborted();
      return appendDisplayEvent(input);
    },

    async heartbeat() {
      if (runSignal.aborted) return aborted();
      const guarded = await guardRunningLease(lease);
      if (!guarded.ok) {
        return guarded;
      }
      return heartbeat();
    },

    async checkpoint(inputValue) {
      if (runSignal.aborted) return aborted();
      const input = runCheckpointInputSchema.safeParse(inputValue);
      if (!input.success) {
        return failure(
          "RUN_CHECKPOINT_INPUT_INVALID",
          "Executor 返回的 Snapshot 不满足项目 Checkpoint 契约。",
          false,
        );
      }
      const beforeSnapshot = await guardRunningLease(lease);
      if (!beforeSnapshot.ok) {
        return beforeSnapshot;
      }
      const body = {
        schema_version: "1.0.0",
        authority: "EXECUTION_SNAPSHOT_ONLY",
        snapshot_id: createId(),
        scope: lease.scope,
        run_id: lease.run_id,
        workflow_id: input.data.workflow_id,
        workflow_definition_revision: input.data.workflow_definition_revision,
        mastra_core_version: "1.52.1",
        mastra_run_id: input.data.mastra_run_id,
        attempt_id: lease.attempt_id,
        snapshot_version: input.data.snapshot_version,
        event_sequence: beforeSnapshot.value.projection.version,
        worker_fence: lease.worker_fence,
        active_artifact_ref: input.data.active_artifact_ref,
        mastra_snapshot: input.data.mastra_snapshot,
        created_at: occurredAt(now),
      } as const;
      const bindingResult = mastraSnapshotBindingBodySchema.safeParse(body);
      if (!bindingResult.success) {
        return failure(
          "RUN_CHECKPOINT_INPUT_INVALID",
          "Executor 返回的 Snapshot 不满足权威绑定契约。",
          false,
        );
      }

      if (runSignal.aborted) return aborted();
      const beforeCommit = await guardRunningLease(lease, beforeSnapshot.value.projection_hash);
      if (!beforeCommit.ok) {
        return beforeCommit;
      }
      const committed = await eventStore.commitSnapshot({
        lease,
        binding: bindingResult.data,
      });
      if (!committed.ok) {
        return committed;
      }

      const appended = await appendCheckpointEvent(committed.value.binding);
      return appended.ok ? success(committed.value.binding) : appended;
    },

    async executeSideEffectOnce(input) {
      if (runSignal.aborted) return aborted();
      let inputHash: string;
      try {
        inputHash = await sha256ContentHash(input.input);
      } catch {
        return failure(
          "RUN_SIDE_EFFECT_INPUT_INVALID",
          "Side Effect Input 必须是可规范化的 JSON。",
          false,
        );
      }

      const operationKey = `${input.effect_kind}:${inputHash}`;
      const existingOperation = inFlightSideEffects.get(operationKey);
      if (existingOperation) {
        return existingOperation;
      }

      const operation = (async (): Promise<PortResult<SideEffectReceipt>> => {
        const found = await eventStore.findSideEffect({
          scope: lease.scope,
          run_id: lease.run_id,
          effect_kind: input.effect_kind,
          input_hash: inputHash,
        });
        if (!found.ok) {
          return found;
        }
        if (found.value) {
          const parsed = sideEffectReceiptSchema.safeParse(found.value);
          if (
            !parsed.success ||
            !receiptMatchesRequest(parsed.data, lease, input.effect_kind, inputHash)
          ) {
            return failure(
              "RUN_SIDE_EFFECT_RECEIPT_MISMATCH",
              "已提交 Side Effect Receipt 与当前请求不匹配。",
              false,
            );
          }
          return appendSideEffectEvent(parsed.data);
        }

        const beforeEffect = await guardRunningLease(lease);
        if (!beforeEffect.ok) {
          return beforeEffect;
        }
        if (runSignal.aborted) return aborted();
        const idempotencyKey = await sha256ContentHash({
          schema_version: "1.0.0",
          scope: lease.scope,
          run_id: lease.run_id,
          effect_kind: input.effect_kind,
          input_hash: inputHash,
        });
        const effectController = new AbortController();
        let effectTimedOut = false;
        const abortEffect = () => effectController.abort(runSignal.reason);
        runSignal.addEventListener("abort", abortEffect, { once: true });
        if (runSignal.aborted) abortEffect();
        const effectDeadlineAt = new Date(now().getTime() + sideEffectTimeoutMs).toISOString();
        const effectAborted = new Promise<Readonly<{ kind: "ABORTED" }>>((resolve) => {
          effectController.signal.addEventListener("abort", () => resolve({ kind: "ABORTED" }), {
            once: true,
          });
        });
        const effectTimer = setTimeout(() => {
          effectTimedOut = true;
          effectController.abort(new Error("RUN_SIDE_EFFECT_TIMEOUT"));
        }, sideEffectTimeoutMs);
        const effectExecution = Promise.resolve()
          .then(() =>
            input.execute({
              idempotency_key: idempotencyKey,
              input_hash: inputHash,
              signal: effectController.signal,
              deadline_at: effectDeadlineAt,
            }),
          )
          .then(
            (value) => ({ kind: "RESULT" as const, value }),
            (error: unknown) => ({ kind: "ERROR" as const, error }),
          );
        const effectOutcome = await Promise.race([effectExecution, effectAborted]);
        clearTimeout(effectTimer);
        runSignal.removeEventListener("abort", abortEffect);
        if (effectOutcome.kind === "ABORTED") {
          return effectTimedOut
            ? failure(
                "RUN_SIDE_EFFECT_TIMEOUT",
                "Side Effect 超过项目 Deadline，已发送 AbortSignal。",
                true,
              )
            : aborted();
        }
        if (effectOutcome.kind === "ERROR") {
          const publicCode =
            effectOutcome.error instanceof Error &&
            /^[A-Z][A-Z0-9_]{1,126}$/.test(effectOutcome.error.message)
              ? effectOutcome.error.message
              : "RUN_SIDE_EFFECT_EXECUTION_FAILED";
          return failure(publicCode, "Side Effect 执行失败，未提交 Receipt。", true);
        }
        const output = effectOutcome.value;
        let outputHash: string;
        try {
          outputHash = await sha256ContentHash(output.output);
        } catch {
          return failure(
            "RUN_SIDE_EFFECT_OUTPUT_INVALID",
            "Side Effect Output 必须是可规范化的 JSON。",
            false,
          );
        }
        if (runSignal.aborted) return aborted();
        // The effect may emit public Tool/Subagent progress events while it is running.
        // Those events legitimately advance the same fenced RUNNING projection, so the
        // receipt guard must revalidate status/fence instead of requiring the pre-effect hash.
        const beforeReceipt = await guardRunningLease(lease);
        if (!beforeReceipt.ok) {
          return beforeReceipt;
        }

        const receiptResult = sideEffectReceiptSchema.safeParse({
          schema_version: "1.0.0",
          receipt_id: createId(),
          scope: lease.scope,
          run_id: lease.run_id,
          effect_kind: input.effect_kind,
          input_hash: inputHash,
          output_hash: outputHash,
          worker_fence: lease.worker_fence,
          ...(output.artifact_ref ? { artifact_ref: output.artifact_ref } : {}),
          committed_at: occurredAt(now),
        });
        if (!receiptResult.success) {
          return failure(
            "RUN_SIDE_EFFECT_RECEIPT_INVALID",
            "Worker 无法生成有效的 Side Effect Receipt。",
            false,
          );
        }
        const committed = await eventStore.commitSideEffect({
          lease,
          receipt: receiptResult.data,
        });
        if (!committed.ok) {
          return committed;
        }
        const authoritativeReceipt = sideEffectReceiptSchema.safeParse(committed.value.receipt);
        if (
          !authoritativeReceipt.success ||
          !receiptMatchesRequest(authoritativeReceipt.data, lease, input.effect_kind, inputHash)
        ) {
          return failure(
            "RUN_SIDE_EFFECT_RECEIPT_MISMATCH",
            "持久层返回的 Side Effect Receipt 与当前请求不匹配。",
            false,
          );
        }
        const afterReceipt = await guardRunningLease(lease, beforeReceipt.value.projection_hash);
        if (!afterReceipt.ok) {
          return afterReceipt;
        }
        return appendSideEffectEvent(authoritativeReceipt.data);
      })();

      inFlightSideEffects.set(operationKey, operation);
      try {
        return await operation;
      } finally {
        if (inFlightSideEffects.get(operationKey) === operation) {
          inFlightSideEffects.delete(operationKey);
        }
      }
    },
  } as RunExecutionContext;
  trustedRunExecutionContexts.add(context);
  return Object.freeze(context);
}
