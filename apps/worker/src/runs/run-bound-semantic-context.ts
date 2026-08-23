import type {
  ContextReceiptBinding,
  EffectiveRunConfigReceiptCandidate,
  RunWorkLease,
} from "@data-agent/contracts/runs";
import type {
  SemanticContextCommitResult,
  SemanticContextRequest,
} from "@data-agent/contracts/context";
import { buildSemanticContextRequest } from "@data-agent/contracts/context";
import type { PortResult } from "@data-agent/contracts/ports";
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
        },
      });
      return options.service.resolve(options.capability, request);
    },
  });
}
