import { createHash } from "node:crypto";
import { normalizeRootAgentProviderTurn } from "@data-agent/agent-runtime";
import {
  effectiveConfigRunLeasePayloadSchema,
  type PortResult,
  type RootAgentDecisionCandidate,
} from "@data-agent/contracts";
import {
  hasRunExecutionContextProvenance,
  hasRunProviderDispatchCapability,
} from "../runs/run-execution-context.js";
import type { RunWorkflowExecutorPort } from "../runs/run-worker-runner.js";

function identity(runId: string, phase: "INITIAL" | "DIRECT_ANSWER_REVIEW"): string {
  const bytes = createHash("sha256")
    .update(`data-agent/root-agent-turn@1\0${runId}\0${phase}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function failure(code: string, message: string): PortResult<never> {
  return { ok: false, error: { code, message, retryable: false } };
}

export interface RootAgentTurnPort {
  decide(
    input: Parameters<RunWorkflowExecutorPort["execute"]>[0],
  ): Promise<PortResult<RootAgentDecisionCandidate>>;
}

export function createRootAgentTurnExecutor(): RootAgentTurnPort {
  return Object.freeze({
    async decide(
      input: Parameters<RunWorkflowExecutorPort["execute"]>[0],
    ): Promise<PortResult<RootAgentDecisionCandidate>> {
      if (!hasRunExecutionContextProvenance(input.context)) {
        return failure("RUN_EXECUTION_CONTEXT_NOT_TRUSTED", "Root Agent context is not trusted.");
      }
      const payload = effectiveConfigRunLeasePayloadSchema.safeParse(input.lease.payload);
      if (
        !payload.success ||
        payload.data.kind !== "START_DATA_AGENT_TEAM" ||
        payload.data.schema_version !== "effective-config-team-lease@3.0.0" ||
        payload.data.executor_version !== "ROOT_HARNESS@1" ||
        payload.data.catalog_snapshot.run_id !== input.lease.run_id
      ) {
        return failure(
          "ROOT_AGENT_LEASE_INVALID",
          "Root Agent requires an exact v3 catalog lease.",
        );
      }
      const catalog = payload.data.catalog_snapshot;
      const provider = input.context.getProviderDispatchCapability();
      if (!hasRunProviderDispatchCapability(provider)) {
        return failure("ROOT_AGENT_PROVIDER_REQUIRED", "Root Agent Provider capability is absent.");
      }
      try {
        const invoke = async (
          phase: "INITIAL" | "DIRECT_ANSWER_REVIEW",
          priorOutputText?: string,
        ) => {
          const invoked = await provider.invoke({
            logical_call_id: identity(input.lease.run_id, phase),
            turn:
              phase === "INITIAL"
                ? { kind: "ROOT", phase }
                : {
                    kind: "ROOT",
                    phase,
                    prior_output_text: priorOutputText ?? "",
                  },
          });
          if (!invoked.ok) throw new RootAgentTurnProviderError(invoked.error);
          return {
            decision: await normalizeRootAgentProviderTurn({
              scope: input.lease.scope,
              run_id: input.lease.run_id,
              catalog,
              output_text: invoked.value.output_text,
              tool_calls: invoked.value.tool_calls,
            }),
            output_text: invoked.value.output_text,
          };
        };
        const initial = await invoke("INITIAL");
        const reviewed =
          initial.decision.kind === "FINAL_ANSWER"
            ? await invoke("DIRECT_ANSWER_REVIEW", initial.output_text)
            : initial;
        return {
          ok: true,
          value: reviewed.decision.kind === "FINAL_ANSWER" ? initial.decision : reviewed.decision,
        };
      } catch (error) {
        if (error instanceof RootAgentTurnProviderError) {
          return { ok: false as const, error: error.failure };
        }
        return failure(
          error instanceof Error && "code" in error && typeof error.code === "string"
            ? error.code
            : "ROOT_AGENT_RESPONSE_INVALID",
          "Root Agent Provider turn failed local Harness validation.",
        );
      }
    },
  });
}

class RootAgentTurnProviderError extends Error {
  override readonly name = "RootAgentTurnProviderError";

  constructor(readonly failure: Readonly<{ code: string; message: string; retryable: boolean }>) {
    super(failure.code);
  }
}
