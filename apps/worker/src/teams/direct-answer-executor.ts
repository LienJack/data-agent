import { createHash } from "node:crypto";
import {
  effectiveConfigRunLeasePayloadSchema,
  verifyAgentDispatchAdmissionResult,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  hasRunExecutionContextProvenance,
  hasRunProviderDispatchCapability,
} from "../runs/run-execution-context.js";
import {
  type RunWorkflowExecutorPort,
  runExecutorResultSchema,
} from "../runs/run-worker-runner.js";

const directAnswerSchema = z.strictObject({ answer: z.string().trim().min(1).max(32_000) });

function identity(runId: string): string {
  const bytes = createHash("sha256")
    .update(`data-agent/direct-answer@1\0${runId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function failed(error_code: string) {
  return runExecutorResultSchema.parse({ kind: "FAILED", error_code });
}

export function createDirectAnswerExecutor(): RunWorkflowExecutorPort {
  return Object.freeze({
    async execute(input: Parameters<RunWorkflowExecutorPort["execute"]>[0]) {
      if (!hasRunExecutionContextProvenance(input.context)) {
        return failed("RUN_EXECUTION_CONTEXT_NOT_TRUSTED");
      }
      const payload = effectiveConfigRunLeasePayloadSchema.safeParse(input.lease.payload);
      if (
        !payload.success ||
        payload.data.kind !== "START_DATA_AGENT_TEAM" ||
        payload.data.schema_version !== "effective-config-team-lease@2.0.0"
      ) {
        return failed("AGENT_DISPATCH_PLAN_INVALID");
      }
      try {
        const admission = await verifyAgentDispatchAdmissionResult({
          kind: "EXECUTE",
          plan: payload.data.dispatch_plan,
          binding: payload.data.dispatch_binding,
        });
        if (admission.kind !== "EXECUTE") return failed("AGENT_DISPATCH_RECEIPT_MISMATCH");
        const { plan, binding } = admission;
        if (
          plan.mode !== "DIRECT" ||
          binding.effective_executor_version !== "ADAPTIVE@1" ||
          plan.run_id !== input.lease.run_id ||
          binding.run_id !== input.lease.run_id ||
          plan.selected_profile_refs.length !== 0
        ) {
          return failed("AGENT_DISPATCH_EXECUTOR_MISMATCH");
        }
      } catch {
        return failed("AGENT_DISPATCH_RECEIPT_MISMATCH");
      }
      const provider = input.context.getProviderDispatchCapability();
      if (!hasRunProviderDispatchCapability(provider)) {
        return failed("DIRECT_ANSWER_PROVIDER_FAILED");
      }
      const blockId = `direct-${input.lease.attempt_id}`;
      const started = await input.context.emitDisplayEvent?.({
        kind: "reasoning_started",
        key: "direct.reasoning.started",
        block_id: blockId,
        title: "整理公开解释",
      });
      if (!started?.ok) return failed(started?.error.code ?? "RUN_DISPLAY_EVENT_REQUIRED");
      const invoked = await provider.invoke({ logical_call_id: identity(input.lease.run_id) });
      if (!invoked.ok) return failed("DIRECT_ANSWER_PROVIDER_FAILED");
      let candidate: unknown;
      try {
        candidate = JSON.parse(invoked.value.output_text);
      } catch {
        return failed("DIRECT_ANSWER_PROVIDER_FAILED");
      }
      const answer = directAnswerSchema.safeParse(candidate);
      if (!answer.success) return failed("DIRECT_ANSWER_PROVIDER_FAILED");
      const completed = await input.context.emitDisplayEvent?.({
        kind: "reasoning_completed",
        key: "direct.reasoning.completed",
        block_id: blockId,
        summary: "已依据冻结模型配置生成公开解释。",
        duration_ms: 0,
      });
      if (!completed?.ok) return failed(completed?.error.code ?? "RUN_DISPLAY_EVENT_REQUIRED");
      const emitted = await input.context.emitDisplayEvent?.({
        kind: "answer_delta",
        key: "direct.answer",
        delta: answer.data.answer,
      });
      if (!emitted?.ok) return failed(emitted?.error.code ?? "RUN_DISPLAY_EVENT_REQUIRED");
      return runExecutorResultSchema.parse({ kind: "COMPLETED" });
    },
  });
}
