import {
  type JobOutputReference,
  type JobWorkLease,
  type PortResult,
  type SemanticInductionCommitCommand,
  type SemanticInductionCommitResult,
  type SemanticInductionRejectCommand,
  type SemanticInductionRejectResult,
  type SemanticInductionTarget,
  semanticInductionCommitResultSchema,
  semanticInductionTargetSchema,
} from "@data-agent/contracts";
import { processSemanticInduction } from "@data-agent/semantic/authoring";
import type { JobHandler } from "./job-worker-runner.js";

export type SemanticInductionRegistry = Readonly<{
  loadTarget(
    capability: unknown,
    lease: JobWorkLease,
  ): Promise<PortResult<SemanticInductionTarget>>;
  commit(
    capability: unknown,
    lease: JobWorkLease,
    command: SemanticInductionCommitCommand,
  ): Promise<PortResult<SemanticInductionCommitResult>>;
  reject(
    capability: unknown,
    lease: JobWorkLease,
    command: SemanticInductionRejectCommand,
  ): Promise<PortResult<SemanticInductionRejectResult>>;
}>;

function failure(code: string, message: string, retryable = false): PortResult<never> {
  return { ok: false, error: { code, message, retryable } };
}

export function createSemanticInductionJobHandler(
  options: Readonly<{
    capability: unknown;
    registry: SemanticInductionRegistry;
    kind?: "SEMANTIC_INDUCTION" | "METRIC_IMPORT";
  }>,
): JobHandler {
  const kind = options.kind ?? "SEMANTIC_INDUCTION";
  return Object.freeze({
    binding: {
      kind,
      handler_revision:
        kind === "METRIC_IMPORT"
          ? "metric-import-handler@1.1.0"
          : "semantic-induction-handler@1.1.0",
    },
    async execute(
      lease: JobWorkLease,
      signal: AbortSignal,
    ): Promise<PortResult<readonly JobOutputReference[]>> {
      if (signal.aborted)
        return failure("SEMANTIC_INDUCTION_CANCELLED", "Semantic induction was cancelled.");
      const loaded = await options.registry.loadTarget(options.capability, lease);
      if (!loaded.ok) return loaded;
      let target: SemanticInductionTarget;
      try {
        target = semanticInductionTargetSchema.parse(loaded.value);
      } catch {
        return failure(
          "SEMANTIC_INDUCTION_TARGET_INVALID",
          "Semantic induction target is invalid.",
        );
      }
      if (signal.aborted)
        return failure("SEMANTIC_INDUCTION_CANCELLED", "Semantic induction was cancelled.");
      const processed = await processSemanticInduction(target);
      if (!processed.ok) {
        const rejected = await options.registry.reject(options.capability, lease, {
          schema_version: "semantic-induction-reject-command@1.0.0",
          request: target.request,
          terminal:
            processed.code === "SEMANTIC_METRIC_DRY_RUN_REJECTED" ? "DRY_RUN_REJECTED" : "CONFLICT",
          metric_dry_run: processed.metric_dry_run,
        });
        if (!rejected.ok) return rejected;
        return failure(
          processed.code,
          "Semantic induction did not produce a reviewable Candidate.",
        );
      }
      if (signal.aborted)
        return failure("SEMANTIC_INDUCTION_CANCELLED", "Semantic induction was cancelled.");
      const committed = await options.registry.commit(options.capability, lease, processed.command);
      if (!committed.ok) return committed;
      let result: SemanticInductionCommitResult;
      try {
        result = semanticInductionCommitResultSchema.parse(committed.value);
      } catch {
        return failure(
          "SEMANTIC_INDUCTION_COMMIT_INVALID",
          "Semantic induction commit result is invalid.",
        );
      }
      return {
        ok: true,
        value: [
          {
            schema_version: "job-domain-output-reference@1.0.0",
            resource_kind: "SEMANTIC_INDUCTION_RECEIPT",
            app_id: result.receipt.scope.app_id,
            tenant_id: result.receipt.scope.tenant_id,
            environment: result.receipt.scope.environment,
            resource_id: result.receipt.induction_id,
            resource_revision: 1,
            resource_hash: result.receipt.receipt_hash,
          },
        ],
      };
    },
  });
}
