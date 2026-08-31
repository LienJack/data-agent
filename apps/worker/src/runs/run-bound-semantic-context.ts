import type {
  SemanticContextCommitResult,
  SemanticContextRequest,
} from "@data-agent/contracts/context";
import { buildSemanticContextRequest } from "@data-agent/contracts/context";
import type { PortResult } from "@data-agent/contracts/ports";
import type {
  ContextReceiptBinding,
  EffectiveRunConfigReceiptCandidate,
  RunWorkLease,
} from "@data-agent/contracts/runs";
import { effectiveConfigRunLeasePayloadSchema } from "@data-agent/contracts/runs";
import type {
  CommittedProviderTaskArtifact,
  ProviderTaskArtifactAuthority,
} from "../providers/postgres-provider-task-artifact.js";
import { collectProviderTaskContextMessageIds } from "../teams/conversation-context-builder.js";
import type { RunBoundSemanticContextResolver } from "./run-execution-context.js";

export interface SemanticContextServicePort {
  resolve(
    capability: unknown,
    request: SemanticContextRequest,
  ): Promise<PortResult<SemanticContextCommitResult>>;
}

export function createRunBoundSemanticContextResolver(
  options: Readonly<{
    capability: unknown;
    service: SemanticContextServicePort;
    task_artifacts: Pick<ProviderTaskArtifactAuthority, "commit">;
  }>,
): RunBoundSemanticContextResolver {
  return Object.freeze({
    async resolve(input: {
      readonly lease: RunWorkLease;
      readonly effective_config: EffectiveRunConfigReceiptCandidate;
      readonly context_receipt: ContextReceiptBinding;
    }) {
      const { lease, effective_config: config, context_receipt: context } = input;
      if (
        config.run_id !== lease.run_id ||
        context.run_id !== lease.run_id ||
        context.config_ref.config_id !== config.config_id ||
        context.config_ref.config_revision !== config.config_revision ||
        context.config_ref.config_hash !== config.config_hash ||
        context.consumer !== "WORKER_START" ||
        context.attempt_id !== lease.attempt_id ||
        context.worker_fence !== lease.worker_fence
      ) {
        return {
          ok: false as const,
          error: {
            code: "SEMANTIC_CONTEXT_WORKER_AUTHORITY_MISMATCH",
            message:
              "Semantic Context requires the exact active Worker config and context receipt.",
            retryable: false,
          },
        };
      }
      let taskRef: CommittedProviderTaskArtifact["reference"] | undefined;
      if (lease.command_kind === "START_DATA_AGENT_TEAM") {
        const payload = effectiveConfigRunLeasePayloadSchema.safeParse(lease.payload);
        if (
          !payload.success ||
          payload.data.kind !== "START_DATA_AGENT_TEAM" ||
          payload.data.schema_version !== "effective-config-team-lease@3.0.0" ||
          payload.data.executor_version !== "ROOT_HARNESS@1"
        ) {
          return {
            ok: false as const,
            error: {
              code: "SEMANTIC_CONTEXT_ROOT_LEASE_INVALID",
              message: "Semantic conversation intent requires the frozen Root lease.",
              retryable: false,
            },
          };
        }
        // Freeze once through the existing authority; Root dispatch later replays this task.
        const task = await options.task_artifacts.commit({
          worker_lease: lease,
          conversation_binding: config.conversation_binding,
        });
        if (!task.ok) return task;
        if (
          task.value.document.schema_version !== "provider-task-artifact@2.0.0" ||
          task.value.reference.run_id !== lease.run_id ||
          JSON.stringify(
            collectProviderTaskContextMessageIds({
              task: task.value.document,
              context_summary: task.value.context_summary ?? null,
            }),
          ) !== JSON.stringify(payload.data.visible_message_refs)
        ) {
          return {
            ok: false as const,
            error: {
              code: "SEMANTIC_CONTEXT_ROOT_TASK_MISMATCH",
              message: "Semantic intent and Root must use the same frozen conversation selection.",
              retryable: false,
            },
          };
        }
        taskRef = task.value.reference;
      }
      const request = await buildSemanticContextRequest({
        schema_version: "semantic-context-request@1.0.0",
        request_id: context.receipt_id,
        scope: lease.scope,
        basis: {
          consumer: "RUN",
          run_id: lease.run_id,
          config_ref: context.config_ref,
          context_receipt_ref: {
            receipt_id: context.receipt_id,
            receipt_hash: context.receipt_hash,
          },
          ...(taskRef ? { provider_task_ref: taskRef } : {}),
        },
      });
      return options.service.resolve(options.capability, request);
    },
  });
}
