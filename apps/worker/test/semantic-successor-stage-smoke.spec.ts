import type {
  SemanticRuntimeClosureValidationReceipt,
  SemanticSuccessorStageEnvelope,
} from "@data-agent/contracts/artifacts";
import type { RuntimeBuildIdentity } from "@data-agent/contracts/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const shared = vi.hoisted(() => ({
  verify: vi.fn(),
  validate: vi.fn(),
}));

vi.mock("@data-agent/semantic/production", () => ({
  verifySemanticReleaseEnvelope: shared.verify,
  validateSemanticRuntimeClosure: shared.validate,
}));

import { createSemanticSuccessorStageSmoke } from "../src/semantic/semantic-successor-stage-smoke.js";

const id = (suffix: number) => `71000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const stageId = id(1);

const envelope = {
  stage: {
    schema_version: "semantic-successor-stage@1.0.0",
    stage_id: stageId,
    stage_digest: hash("1"),
    scope: {
      app_id: id(2),
      tenant_id: id(3),
      environment: "test",
      semantic_domain: "falcon24",
    },
    predecessor_release: { release_id: id(4), generation: 1, release_digest: hash("2") },
    expected_pointer_version: 3,
    target_generation: 2,
    change_set_ref: { change_set_id: id(5), change_set_hash: hash("3") },
    review_ref: { review_id: id(6), review_hash: hash("4") },
    source_snapshot_ref: {
      snapshot_id: id(7),
      snapshot_revision: 1,
      snapshot_hash: hash("5"),
    },
    compiler_bundle_ref: {
      compiler_version: "semantic-change-set-publication@2",
      compiler_bundle_hash: hash("6"),
    },
    candidate_release: {
      release_id: id(8),
      generation: 2,
      release_digest: hash("7"),
      datasource_id: id(9),
    },
    projection_refs: {
      executable: { projection_id: id(10), projection_digest: hash("8") },
      relationship: { projection_id: id(11), projection_digest: hash("9") },
      runtime_restriction: { projection_id: id(12), projection_digest: hash("a") },
      graph: { projection_id: id(13), projection_digest: hash("b") },
    },
    status: "STAGED",
  },
  projections: {
    executable: {
      projection_kind: "EXECUTABLE",
      projection_id: id(10),
      projection_digest: hash("8"),
      projection_payload: {
        metrics: [
          {
            metric_id: "metric.order_revenue",
            table_id: "orders",
            column_id: "order_total",
            aggregation: "sum",
            formula: { formula_id: "formula.order_revenue" },
            dependency_column_ids: ["order_total"],
            time_domain: { timezone: "Asia/Shanghai" },
            time_column_id: "order_date",
          },
        ],
        dimensions: [
          {
            dimension_id: "dimension.order_month",
            table_id: "orders",
            column_id: "order_date",
          },
        ],
        physical_bindings: [
          {
            logical_object_id: "metric.order_revenue",
            logical_object_type: "metric",
            datasource_id: id(9),
            schema_name: "public",
            table_name: "orders",
            column_name: "order_total",
            binding_lifecycle: "active",
            valid_from: null,
            valid_until: null,
          },
          {
            logical_object_id: "dimension.order_month",
            logical_object_type: "dimension",
            datasource_id: id(9),
            schema_name: "public",
            table_name: "orders",
            column_name: "order_date",
            binding_lifecycle: "active",
            valid_from: null,
            valid_until: null,
          },
        ],
      },
    },
    relationship: {
      projection_kind: "RELATIONSHIP",
      projection_id: id(11),
      projection_digest: hash("9"),
      projection_payload: { relationships: [] },
    },
    runtime_restriction: {
      projection_kind: "RUNTIME_RESTRICTION",
      projection_id: id(12),
      projection_digest: hash("a"),
      projection_payload: { quality_constraints: [], time_semantics: [] },
    },
    graph: {
      projection_kind: "GRAPH",
      projection_id: id(13),
      projection_digest: hash("b"),
      projection_payload: { nodes: [], edges: [] },
    },
  },
} as unknown as SemanticSuccessorStageEnvelope;

const buildIdentity: RuntimeBuildIdentity = {
  schema_version: "runtime-build-identity@1.0.0",
  consumer_role: "worker",
  generation_id: hash("c"),
  build_id: hash("d"),
  built_at: "2026-08-28T00:00:00.000Z",
  git_commit: "1234567",
  git_dirty: false,
};

function validation(reasonCodes: readonly string[]): SemanticRuntimeClosureValidationReceipt {
  return {
    schema_version: "semantic-runtime-closure-validation-receipt@1.0.0",
    receipt_id: id(14),
    stage_id: stageId,
    stage_digest: hash("1"),
    candidate_release: envelope.stage.candidate_release,
    projection_refs: envelope.stage.projection_refs,
    validator_identity: {
      validator_version: "semantic-runtime-closure-validator@1.0.0",
      validator_hash: hash("e"),
    },
    outcome: reasonCodes.length === 0 ? "PASS" : "FAIL",
    reason_codes: [...reasonCodes],
    validation_receipt_hash: hash("f"),
  };
}

beforeEach(() => {
  shared.verify.mockReset();
  shared.validate.mockReset();
  shared.verify.mockImplementation(async (candidate) => candidate);
  shared.validate.mockResolvedValue(validation([]));
});

describe("deterministic semantic successor stage smoke", () => {
  it("builds one fixed plan, commits PASS, and deterministically replays without a provider", async () => {
    let status: "STAGED" | "SMOKE_PASSED" = "STAGED";
    const provider = vi.fn();
    const commitSmoke = vi.fn(async (_capability, input) => {
      status = "SMOKE_PASSED";
      return { ok: true as const, value: input.receipt };
    });
    const smoke = createSemanticSuccessorStageSmoke({
      async loadStage() {
        return { ok: true, value: { ...envelope, stage: { ...envelope.stage, status } } };
      },
      commitSmoke,
    });
    const input = {
      capability: { authority: "test" },
      semantic_domain: "falcon24",
      stage_id: stageId,
      idempotency_key: "falcon24-e4-smoke",
      worker_build_identity: buildIdentity,
    } as const;

    const first = await smoke.run(input);
    const replay = await smoke.run(input);

    expect(first).toMatchObject({
      ok: true,
      value: {
        outcome: "PASS",
        resolved_metric_id: "metric.order_revenue",
        resolved_dimension_id: "dimension.order_month",
        calendar_timezone: "Asia/Shanghai",
        window_start: "2023-11-01T00:00:00.000Z",
        window_end_exclusive: "2024-11-01T00:00:00.000Z",
      },
    });
    expect(replay).toEqual(first);
    expect(commitSmoke).toHaveBeenCalledTimes(2);
    expect(shared.verify).toHaveBeenCalledTimes(2);
    expect(shared.validate).toHaveBeenCalledTimes(2);
    expect(provider).not.toHaveBeenCalled();
  });

  it("commits a stable FAIL receipt so PostgreSQL can terminally reject semantic closure", async () => {
    shared.validate.mockResolvedValue(validation(["SEMANTIC_RUNTIME_FORMULA_DEPENDENCY_INVALID"]));
    const commitSmoke = vi.fn(async (_capability, input) => ({
      ok: true as const,
      value: input.receipt,
    }));
    const smoke = createSemanticSuccessorStageSmoke({
      loadStage: async () => ({ ok: true, value: envelope }),
      commitSmoke,
    });

    const result = await smoke.run({
      capability: {},
      semantic_domain: "falcon24",
      stage_id: stageId,
      idempotency_key: "falcon24-e4-smoke-fail",
      worker_build_identity: buildIdentity,
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        outcome: "FAIL",
        failure_code: "SEMANTIC_RUNTIME_FORMULA_DEPENDENCY_INVALID",
      },
    });
    expect(commitSmoke).toHaveBeenCalledOnce();
  });

  it("leaves the stage untouched when the process crashes before the only commit RPC", async () => {
    const commitSmoke = vi.fn();
    const smoke = createSemanticSuccessorStageSmoke({
      loadStage: async () => ({ ok: true, value: envelope }),
      commitSmoke,
    });

    await expect(
      smoke.run({
        capability: {},
        semantic_domain: "falcon24",
        stage_id: stageId,
        idempotency_key: "falcon24-e4-smoke-crash",
        worker_build_identity: buildIdentity,
        before_commit: () => {
          throw new Error("SIMULATED_PROCESS_CRASH");
        },
      }),
    ).rejects.toThrow("SIMULATED_PROCESS_CRASH");
    expect(commitSmoke).not.toHaveBeenCalled();
  });
});
