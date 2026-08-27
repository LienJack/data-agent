import { createHash } from "node:crypto";
import {
  buildSemanticRuntimeSmokeReceipt,
  type SemanticRuntimeSmokeReceipt,
  type SemanticSuccessorStageEnvelope,
} from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import type { PortResult } from "@data-agent/contracts/ports";
import type { RuntimeBuildIdentity } from "@data-agent/contracts/server";
import {
  validateSemanticRuntimeClosure,
  verifySemanticReleaseEnvelope,
} from "@data-agent/semantic/production";

export const SEMANTIC_SUCCESSOR_SMOKE_METRIC_ID = "metric.order_revenue" as const;
export const SEMANTIC_SUCCESSOR_SMOKE_DIMENSION_ID = "dimension.order_month" as const;
export const SEMANTIC_SUCCESSOR_SMOKE_TIMEZONE = "Asia/Shanghai" as const;
export const SEMANTIC_SUCCESSOR_SMOKE_WINDOW_START = "2023-11-01T00:00:00.000Z" as const;
export const SEMANTIC_SUCCESSOR_SMOKE_WINDOW_END_EXCLUSIVE = "2024-11-01T00:00:00.000Z" as const;

export interface SemanticSuccessorStageSmokeAuthority {
  loadStage(
    capability: unknown,
    input: { readonly semantic_domain: string; readonly stage_id: string },
  ): Promise<PortResult<SemanticSuccessorStageEnvelope>>;
  commitSmoke(
    capability: unknown,
    input: {
      readonly semantic_domain: string;
      readonly idempotency_key: string;
      readonly receipt: SemanticRuntimeSmokeReceipt;
    },
  ): Promise<PortResult<SemanticRuntimeSmokeReceipt>>;
}

export interface SemanticSuccessorStageSmoke {
  run(input: {
    readonly capability: unknown;
    readonly semantic_domain: string;
    readonly stage_id: string;
    readonly idempotency_key: string;
    readonly worker_build_identity: RuntimeBuildIdentity;
    /** Test-only crash seam. A throw here occurs before the only state-changing RPC. */
    readonly before_commit?: (receipt: SemanticRuntimeSmokeReceipt) => void | Promise<void>;
  }): Promise<PortResult<SemanticRuntimeSmokeReceipt>>;
}

function stableUuid(material: string): string {
  const digits = createHash("sha256").update(material).digest("hex").slice(0, 32).split("");
  digits[12] = "5";
  digits[16] = ((Number.parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = digits.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function failure<T>(code: string, message: string): PortResult<T> {
  return { ok: false, error: { code, message, retryable: false } };
}

export function createSemanticSuccessorStageSmoke(
  authority: SemanticSuccessorStageSmokeAuthority,
): SemanticSuccessorStageSmoke {
  return Object.freeze({
    async run(
      input: Parameters<SemanticSuccessorStageSmoke["run"]>[0],
    ): Promise<PortResult<SemanticRuntimeSmokeReceipt>> {
      if (input.worker_build_identity.consumer_role !== "worker") {
        return failure(
          "SEMANTIC_SUCCESSOR_SMOKE_BUILD_IDENTITY_INVALID",
          "Stage smoke 必须绑定 Worker build identity。",
        );
      }
      const loaded = await authority.loadStage(input.capability, {
        semantic_domain: input.semantic_domain,
        stage_id: input.stage_id,
      });
      if (!loaded.ok) return loaded;

      let envelope: Awaited<ReturnType<typeof verifySemanticReleaseEnvelope>>;
      try {
        envelope = await verifySemanticReleaseEnvelope(loaded.value);
      } catch {
        return failure(
          "SEMANTIC_SUCCESSOR_STAGE_ENVELOPE_INVALID",
          "Stage envelope 的 schema、digest 或 projection identity 无法验证。",
        );
      }
      if (
        !["STAGED", "SMOKE_PASSED", "REJECTED"].includes(envelope.stage.status) ||
        envelope.stage.stage_id !== input.stage_id ||
        envelope.stage.scope.semantic_domain !== input.semantic_domain
      ) {
        return failure(
          "SEMANTIC_SUCCESSOR_SMOKE_STAGE_FENCE_MISMATCH",
          "Stage smoke 只能消费 exact pre-promotion successor 或重放既有 smoke。",
        );
      }

      const validation = await validateSemanticRuntimeClosure(envelope);
      const executable = envelope.projections.executable.projection_payload;
      const metric = executable.metrics.find(
        (candidate) => candidate.metric_id === SEMANTIC_SUCCESSOR_SMOKE_METRIC_ID,
      );
      const dimension = executable.dimensions.find(
        (candidate) => candidate.dimension_id === SEMANTIC_SUCCESSOR_SMOKE_DIMENSION_ID,
      );
      const metricBindings = executable.physical_bindings
        .filter((binding) => binding.logical_object_id === SEMANTIC_SUCCESSOR_SMOKE_METRIC_ID)
        .sort((left, right) =>
          `${left.schema_name}.${left.table_name}.${left.column_name ?? ""}`.localeCompare(
            `${right.schema_name}.${right.table_name}.${right.column_name ?? ""}`,
          ),
        );
      const dimensionBindings = executable.physical_bindings
        .filter((binding) => binding.logical_object_id === SEMANTIC_SUCCESSOR_SMOKE_DIMENSION_ID)
        .sort((left, right) =>
          `${left.schema_name}.${left.table_name}.${left.column_name ?? ""}`.localeCompare(
            `${right.schema_name}.${right.table_name}.${right.column_name ?? ""}`,
          ),
        );

      let failureCode: string | null = validation.reason_codes[0] ?? null;
      if (failureCode === null && !metric) {
        failureCode = "SEMANTIC_RUNTIME_SMOKE_METRIC_MISSING";
      } else if (failureCode === null && !dimension) {
        failureCode = "SEMANTIC_RUNTIME_SMOKE_DIMENSION_MISSING";
      } else if (
        failureCode === null &&
        (metricBindings.length === 0 || dimensionBindings.length === 0)
      ) {
        failureCode = "SEMANTIC_RUNTIME_SMOKE_BINDING_MISSING";
      }

      const resolvedBindingHash = await sha256ContentHash({
        hash_domain: "semantic-runtime-smoke-resolved-binding@1.0.0",
        candidate_release: envelope.stage.candidate_release,
        metric: metric
          ? {
              metric_id: metric.metric_id,
              table_id: metric.table_id,
              column_id: metric.column_id,
              aggregation: metric.aggregation,
              formula: metric.formula,
              dependency_column_ids: metric.dependency_column_ids,
              time_domain: metric.time_domain,
              time_column_id: metric.time_column_id,
              physical_bindings: metricBindings,
            }
          : null,
        dimension: dimension
          ? {
              dimension_id: dimension.dimension_id,
              table_id: dimension.table_id,
              column_id: dimension.column_id,
              physical_bindings: dimensionBindings,
            }
          : null,
      });
      const planHash = await sha256ContentHash({
        schema_version: "semantic-runtime-smoke-plan@1.0.0",
        stage_id: envelope.stage.stage_id,
        candidate_release: envelope.stage.candidate_release,
        projection_refs: envelope.stage.projection_refs,
        metric_id: SEMANTIC_SUCCESSOR_SMOKE_METRIC_ID,
        dimension_id: SEMANTIC_SUCCESSOR_SMOKE_DIMENSION_ID,
        calendar: {
          timezone: SEMANTIC_SUCCESSOR_SMOKE_TIMEZONE,
          window_start: SEMANTIC_SUCCESSOR_SMOKE_WINDOW_START,
          window_end_exclusive: SEMANTIC_SUCCESSOR_SMOKE_WINDOW_END_EXCLUSIVE,
          interval: "HALF_OPEN",
        },
        resolved_binding_hash: resolvedBindingHash,
        validation_receipt_hash: validation.validation_receipt_hash,
      });
      const outcome = failureCode === null ? ("PASS" as const) : ("FAIL" as const);
      const receipt = await buildSemanticRuntimeSmokeReceipt({
        schema_version: "semantic-runtime-smoke-receipt@1.0.0",
        receipt_id: stableUuid(
          `${envelope.stage.stage_digest}:${input.worker_build_identity.build_id}:${outcome}:${failureCode ?? "PASS"}`,
        ),
        stage_id: envelope.stage.stage_id,
        stage_digest: envelope.stage.stage_digest,
        candidate_release: envelope.stage.candidate_release,
        projection_refs: envelope.stage.projection_refs,
        resolved_metric_id: SEMANTIC_SUCCESSOR_SMOKE_METRIC_ID,
        resolved_dimension_id: SEMANTIC_SUCCESSOR_SMOKE_DIMENSION_ID,
        resolved_binding_hash: resolvedBindingHash,
        plan_hash: planHash,
        calendar_timezone: SEMANTIC_SUCCESSOR_SMOKE_TIMEZONE,
        window_start: SEMANTIC_SUCCESSOR_SMOKE_WINDOW_START,
        window_end_exclusive: SEMANTIC_SUCCESSOR_SMOKE_WINDOW_END_EXCLUSIVE,
        validator_identity: validation.validator_identity,
        worker_build_identity: input.worker_build_identity,
        outcome,
        failure_code: failureCode,
      });

      await input.before_commit?.(receipt);
      return authority.commitSmoke(input.capability, {
        semantic_domain: input.semantic_domain,
        idempotency_key: input.idempotency_key,
        receipt,
      });
    },
  });
}
