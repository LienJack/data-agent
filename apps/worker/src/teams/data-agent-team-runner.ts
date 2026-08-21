import {
  type AgentProductProfileReference,
  type AgentProductProfileRegistryItem,
  effectiveConfigRunLeasePayloadSchema,
  type PortResult,
  type ResolvedContextCommitResult,
  verifyResolvedContextCommitResult,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  hasRunExecutionContextProvenance,
  hasRunResolvedContextCapability,
} from "../runs/run-execution-context.js";
import {
  type RunDisplayEventInput,
  type RunExecutionContext,
  type RunExecutorResult,
  type RunWorkflowExecutorPort,
  runExecutorResultSchema,
} from "../runs/run-worker-runner.js";
import { verifyProductProfileSet } from "./mastra-profile-composition.js";

const runtimeResultSchema = z.strictObject({
  status: z.enum(["ACCEPTED", "FAILED", "NEEDS_CLARIFICATION"]),
  reason_code: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Z][A-Z0-9_]*$/),
});

export interface DataAgentProductTeamRuntimePort {
  execute(input: {
    readonly lease: Parameters<RunWorkflowExecutorPort["execute"]>[0]["lease"];
    readonly profiles: ReadonlyMap<
      AgentProductProfileReference["profile_id"],
      AgentProductProfileRegistryItem
    >;
    readonly resolved_context_ref: Readonly<{
      package_id: string;
      package_hash: string;
      receipt_id: string;
      receipt_hash: string;
    }>;
    readonly restored_snapshot: Parameters<
      RunWorkflowExecutorPort["execute"]
    >[0]["restored_snapshot"];
    readonly execution_context: RunExecutionContext;
    readonly signal: AbortSignal;
    readonly deadline_at: string;
  }): Promise<unknown>;
}

export interface DataAgentTeamRunnerDependencies {
  readonly profiles: {
    listEnabled(
      capabilityInput: unknown,
    ): Promise<PortResult<readonly AgentProductProfileRegistryItem[]>>;
  };
  readonly profile_capability_input: unknown;
  readonly runtime: DataAgentProductTeamRuntimePort;
}

function failed(errorCode: string): RunExecutorResult {
  return runExecutorResultSchema.parse({ kind: "FAILED", error_code: errorCode });
}

async function emitPublicReasoning(
  context: RunExecutionContext,
  input: RunDisplayEventInput,
): Promise<string | null> {
  if (!context.emitDisplayEvent) return "RUN_DISPLAY_EVENT_REQUIRED";
  const result = await context.emitDisplayEvent(input);
  return result.ok ? null : result.error.code;
}

function exactProfileRefs(
  expected: readonly AgentProductProfileReference[],
  items: readonly AgentProductProfileRegistryItem[],
): boolean {
  return expected.every((reference, index) => {
    const item = items[index];
    return (
      item?.revision.profile_id === reference.profile_id &&
      item.revision.revision === reference.revision &&
      item.revision.revision_hash === reference.revision_hash
    );
  });
}

export function createDataAgentTeamRunner(
  dependencies: DataAgentTeamRunnerDependencies,
): RunWorkflowExecutorPort {
  return {
    async execute(input): Promise<RunExecutorResult> {
      if (!hasRunExecutionContextProvenance(input.context)) {
        return failed("RUN_EXECUTION_CONTEXT_NOT_TRUSTED");
      }
      const payload = effectiveConfigRunLeasePayloadSchema.safeParse(input.lease.payload);
      if (
        !payload.success ||
        payload.data.kind !== "START_DATA_AGENT_TEAM" ||
        input.lease.command_kind !== "START_DATA_AGENT_TEAM"
      ) {
        return failed("DATA_AGENT_TEAM_LEASE_INVALID");
      }
      const reasoningBlockId = `team-${input.lease.attempt_id}`;
      const reasoningStarted = await emitPublicReasoning(input.context, {
        kind: "reasoning_started",
        key: "team.reasoning.started",
        block_id: reasoningBlockId,
        title: "规划 Agent Team 执行路径",
      });
      if (reasoningStarted) return failed(reasoningStarted);
      const listed = await dependencies.profiles.listEnabled(dependencies.profile_capability_input);
      if (!listed.ok) return failed(listed.error.code);
      if (!exactProfileRefs(payload.data.profile_refs, listed.value)) {
        return failed("DATA_AGENT_TEAM_PROFILE_STALE");
      }
      let profiles: ReadonlyMap<
        AgentProductProfileReference["profile_id"],
        AgentProductProfileRegistryItem
      >;
      try {
        profiles = await verifyProductProfileSet(listed.value);
      } catch {
        return failed("DATA_AGENT_TEAM_PROFILE_INVALID");
      }
      const profilesVerified = await emitPublicReasoning(input.context, {
        kind: "reasoning_delta",
        key: "team.reasoning.profiles",
        block_id: reasoningBlockId,
        delta: "已锁定三个专职 Agent 的已批准 Profile、Skill 与 Tool 边界。",
      });
      if (profilesVerified) return failed(profilesVerified);
      const contextCapability = input.context.getResolvedContextCapability?.();
      if (!hasRunResolvedContextCapability(contextCapability)) {
        return failed("RESOLVED_CONTEXT_REQUIRED");
      }
      const resolved = await contextCapability.resolve();
      if (!resolved.ok) return failed(resolved.error.code);
      let context: ResolvedContextCommitResult;
      try {
        context = await verifyResolvedContextCommitResult(resolved.value);
      } catch {
        return failed("RESOLVED_CONTEXT_RESULT_INVALID");
      }
      const metadataFallback =
        context.package.route_decision.state === "REJECTED" &&
        context.package.route_decision.route === "NONE" &&
        context.package.route_decision.reason_codes.length === 1 &&
        context.package.route_decision.reason_codes[0] === "NO_GOVERNED_CONTEXT_ROUTE";
      if (
        !["READY", "PARTIAL"].includes(context.package.route_decision.state) &&
        !metadataFallback
      ) {
        return failed("RESOLVED_CONTEXT_NOT_RUNNABLE");
      }
      const contextVerified = await emitPublicReasoning(input.context, {
        kind: "reasoning_delta",
        key: "team.reasoning.context",
        block_id: reasoningBlockId,
        delta: metadataFallback
          ? "Resolved Context 未命中业务路由，按受限元数据查询路径读取冻结 Semantic Release。"
          : "已验证 Resolved Context 身份闭包，开始执行受治理的专职工作流。",
      });
      if (contextVerified) return failed(contextVerified);
      const runtime = runtimeResultSchema.safeParse(
        await dependencies.runtime.execute({
          lease: input.lease,
          profiles,
          resolved_context_ref: {
            package_id: context.package.package_id,
            package_hash: context.package.package_hash,
            receipt_id: context.receipt.receipt_id,
            receipt_hash: context.receipt.receipt_hash,
          },
          restored_snapshot: input.restored_snapshot,
          execution_context: input.context,
          signal: input.signal,
          deadline_at: input.deadline_at,
        }),
      );
      if (!runtime.success) return failed("DATA_AGENT_TEAM_RUNTIME_RESULT_INVALID");
      if (runtime.data.status !== "ACCEPTED") return failed(runtime.data.reason_code);
      const reasoningCompleted = await emitPublicReasoning(input.context, {
        kind: "reasoning_completed",
        key: "team.reasoning.completed",
        block_id: reasoningBlockId,
        summary: "Agent Team 已完成专职协作，Verifier 与 Acceptance 均已接纳结果。",
        duration_ms: 0,
      });
      if (reasoningCompleted) return failed(reasoningCompleted);
      return runExecutorResultSchema.parse({ kind: "COMPLETED" });
    },
  };
}
