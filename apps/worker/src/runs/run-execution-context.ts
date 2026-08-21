import {
  type ContextReceiptBinding,
  canonicalImmutableIdSchema,
  type EffectiveRunConfigReceiptCandidate,
  type MastraSnapshotBinding,
  mastraSnapshotBindingBodySchema,
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
import type { AuditedModelProviderResult } from "../providers/audited-model-provider.js";
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
  }): Promise<PortResult<AuditedModelProviderResult>>;
}

export interface RunBoundProviderDispatcher {
  invoke(input: {
    readonly lease: RunWorkLease;
    readonly effective_config: EffectiveRunConfigReceiptCandidate;
    readonly context_receipt: ContextReceiptBinding;
    readonly logical_call_id: string;
    readonly signal: AbortSignal;
  }): Promise<PortResult<AuditedModelProviderResult>>;
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
        invoke(input: Parameters<RunProviderDispatchCapability["invoke"]>[0]) {
          if (runSignal.aborted) return Promise.resolve(aborted<AuditedModelProviderResult>());
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
          return providerDispatch.invoke({
            lease,
            effective_config: effectiveConfig,
            context_receipt: contextReceipt,
            logical_call_id: logicalCallId.data,
            signal: runSignal,
          });
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
