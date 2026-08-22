import type { AdmittedSubagentDelegation } from "@data-agent/agent-runtime";
import {
  type AgentDispatchPlan,
  type AgentProductProfileReference,
  type AgentProductProfileRegistryItem,
  effectiveConfigRunLeasePayloadSchema,
  type PortResult,
  type ResolvedContextCommitResult,
  type RootAgentDecisionCandidate,
  verifyAgentDispatchAdmissionResult,
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
import {
  verifyProductProfileSet,
  verifySelectedProductProfiles,
} from "./mastra-profile-composition.js";
import type { RootAgentTurnPort } from "./root-agent-turn-executor.js";

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
    readonly dispatch_plan?: AgentDispatchPlan | null;
    readonly admitted_delegations?: readonly AdmittedSubagentDelegation[];
    readonly resolved_context_ref: Readonly<{
      package_id: string;
      package_hash: string;
      receipt_id: string;
      receipt_hash: string;
      semantic_domain: string;
      semantic_release_id: string;
      semantic_release_hash: string;
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
  readonly direct?: RunWorkflowExecutorPort;
  readonly root?: RootAgentTurnPort;
  readonly root_runtime?: {
    execute(input: {
      readonly decision: RootAgentDecisionCandidate;
      readonly execution: Parameters<RunWorkflowExecutorPort["execute"]>[0];
    }): Promise<unknown>;
  };
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

function selectExactProfileRefs(
  expected: readonly AgentProductProfileReference[],
  items: ReadonlyMap<AgentProductProfileReference["profile_id"], AgentProductProfileRegistryItem>,
): ReadonlyMap<AgentProductProfileReference["profile_id"], AgentProductProfileRegistryItem> | null {
  const selected = new Map<
    AgentProductProfileReference["profile_id"],
    AgentProductProfileRegistryItem
  >();
  for (const reference of expected) {
    const item = items.get(reference.profile_id);
    if (
      !(
        item?.revision.profile_id === reference.profile_id &&
        item.revision.revision === reference.revision &&
        item.revision.revision_hash === reference.revision_hash
      )
    )
      return null;
    selected.set(reference.profile_id, item);
  }
  return selected;
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
      if (payload.data.schema_version === "effective-config-team-lease@3.0.0") {
        if (!dependencies.root || !dependencies.root_runtime) {
          return failed("ROOT_AGENT_HARNESS_NOT_CONFIGURED");
        }
        const rootBlockId = `root-${input.lease.attempt_id}`;
        const started = await emitPublicReasoning(input.context, {
          kind: "reasoning_started",
          key: "root.decision.started",
          block_id: rootBlockId,
          title: "主 Agent 正在判断是否调用专职 Agent",
        });
        if (started) return failed(started);
        const decision = await dependencies.root.decide(input);
        if (!decision.ok) return failed(decision.error.code);
        const selected = await emitPublicReasoning(input.context, {
          kind: "reasoning_delta",
          key: "root.decision.selected",
          block_id: rootBlockId,
          delta:
            decision.value.kind === "FINAL_ANSWER"
              ? "主 Agent 选择直接回答；未调用 Subagent。"
              : `主 Agent 从冻结能力目录选择 ${decision.value.tool_calls.map(({ profile_id: profileId }) => profileId).join("、")}。`,
        });
        if (selected) return failed(selected);
        const rootResult = runtimeResultSchema.safeParse(
          await dependencies.root_runtime.execute({ decision: decision.value, execution: input }),
        );
        if (!rootResult.success) return failed("ROOT_AGENT_RUNTIME_RESULT_INVALID");
        if (rootResult.data.status !== "ACCEPTED") return failed(rootResult.data.reason_code);
        const completed = await emitPublicReasoning(input.context, {
          kind: "reasoning_completed",
          key: "root.answer.completed",
          block_id: rootBlockId,
          summary:
            decision.value.kind === "FINAL_ANSWER"
              ? "主 Agent 直接回答已通过公开输出验证。"
              : "主 Agent 选择的专职执行与 Artifact 验收已完成。",
          duration_ms: 0,
        });
        return completed ? failed(completed) : runExecutorResultSchema.parse({ kind: "COMPLETED" });
      }
      let dispatchPlan: AgentDispatchPlan | null = null;
      if (payload.data.schema_version === "effective-config-team-lease@2.0.0") {
        try {
          const admission = await verifyAgentDispatchAdmissionResult({
            kind: "EXECUTE",
            plan: payload.data.dispatch_plan,
            binding: payload.data.dispatch_binding,
          });
          if (admission.kind !== "EXECUTE") return failed("AGENT_DISPATCH_RECEIPT_MISMATCH");
          dispatchPlan = admission.plan;
          const binding = admission.binding;
          if (
            dispatchPlan.run_id !== input.lease.run_id ||
            binding.run_id !== input.lease.run_id ||
            binding.effective_executor_version !== payload.data.executor_version
          ) {
            return failed("AGENT_DISPATCH_EXECUTOR_MISMATCH");
          }
        } catch {
          return failed("AGENT_DISPATCH_RECEIPT_MISMATCH");
        }
        if (dispatchPlan.mode === "DIRECT") {
          return dependencies.direct
            ? dependencies.direct.execute(input)
            : failed("DIRECT_ANSWER_PROVIDER_FAILED");
        }
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
      let catalog: ReadonlyMap<
        AgentProductProfileReference["profile_id"],
        AgentProductProfileRegistryItem
      >;
      try {
        catalog =
          payload.data.schema_version === "effective-config-team-lease@1.0.0"
            ? await verifyProductProfileSet(listed.value)
            : await verifySelectedProductProfiles(listed.value);
      } catch {
        return failed(
          payload.data.schema_version === "effective-config-team-lease@1.0.0"
            ? "DATA_AGENT_TEAM_PROFILE_STALE"
            : "DATA_AGENT_TEAM_PROFILE_INVALID",
        );
      }
      const profiles = selectExactProfileRefs(payload.data.profile_refs, catalog);
      if (!profiles) return failed("DATA_AGENT_TEAM_PROFILE_STALE");
      const profilesVerified = await emitPublicReasoning(input.context, {
        kind: "reasoning_delta",
        key: "team.reasoning.profiles",
        block_id: reasoningBlockId,
        delta: `已锁定 ${profiles.size} 个实际选中的专职 Agent Profile、Skill 与 Tool 边界。`,
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
          dispatch_plan: dispatchPlan,
          resolved_context_ref: {
            package_id: context.package.package_id,
            package_hash: context.package.package_hash,
            receipt_id: context.receipt.receipt_id,
            receipt_hash: context.receipt.receipt_hash,
            semantic_domain: context.package.semantic_domain,
            semantic_release_id: context.package.semantic_release.resource_id,
            semantic_release_hash: context.package.semantic_release.resource_hash,
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
