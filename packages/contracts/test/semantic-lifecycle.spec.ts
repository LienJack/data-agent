import { describe, expect, it } from "vitest";
import {
  buildSemanticAssertionCandidate,
  buildSemanticChangeSet,
  buildSemanticRuntimeClosureValidationReceipt,
  buildSemanticRuntimeSmokeReceipt,
  buildSemanticSuccessorReleaseLoadCommand,
  buildSemanticSuccessorSmokeCommitCommand,
  buildSemanticSuccessorStage,
  buildSemanticSuccessorStageLoadCommand,
  buildStageReviewedSemanticSuccessorCommand,
  semanticSuccessorReviewPacketPayloadSchema,
  semanticSuccessorStageEnvelopeSchema,
  stageReviewedSemanticSuccessorCommandSchema,
  verifySemanticChangeSet,
  verifySemanticRuntimeClosureValidationReceipt,
  verifySemanticRuntimeSmokeReceipt,
  verifySemanticSuccessorStage,
} from "../src/artifacts/semantic-lifecycle.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = {
  app_id: id(1),
  tenant_id: id(2),
  environment: "test" as const,
  semantic_domain: "falcon24",
};

function assertionInput(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "semantic-assertion-candidate@1.0.0" as const,
    assertion_id: id(10),
    scope,
    target_kind: "METRIC" as const,
    canonical_key: "order_revenue",
    applicability_scope: { datasource: "falcon_db_24" },
    assertion_payload: { expression: "sum(orders.total_amount)", unit: "currency" },
    source_kind: "SELECTED_KNOWLEDGE_EVIDENCE" as const,
    evidence: [
      {
        evidence_id: "falcon24-metric-handbook:order-revenue",
        source_kind: "SELECTED_KNOWLEDGE_EVIDENCE" as const,
        source_ref: {
          resource_id: "falcon24-metric-handbook",
          resource_revision: 1,
          resource_hash: hash("a"),
        },
        locator: { locator_kind: "DOCUMENT_SPAN" as const, locator_value: "section:revenue" },
        observation: "订单收入使用订单头金额。",
      },
    ],
    premise_assertion_ids: [],
    inference_rule_id: null,
    confidence: 0.98,
    ...overrides,
  };
}

function successorStageMaterial() {
  const projection_refs = {
    executable: { projection_id: id(41), projection_digest: hash("3") },
    relationship: { projection_id: id(42), projection_digest: hash("4") },
    runtime_restriction: { projection_id: id(43), projection_digest: hash("5") },
    graph: { projection_id: id(44), projection_digest: hash("6") },
  };
  return {
    schema_version: "semantic-successor-stage@1.0.0" as const,
    stage_id: id(40),
    scope,
    predecessor_release: {
      release_id: id(34),
      generation: 1,
      release_digest: hash("2"),
    },
    expected_pointer_version: 3,
    target_generation: 2,
    change_set_ref: { change_set_id: id(31), change_set_hash: hash("d") },
    review_ref: { review_id: id(32), review_hash: hash("e") },
    source_snapshot_ref: {
      snapshot_id: id(33),
      snapshot_revision: 7,
      snapshot_hash: hash("f"),
    },
    compiler_bundle_ref: {
      compiler_version: "semantic-change-set-publication@2",
      compiler_bundle_hash: hash("1"),
    },
    candidate_release: {
      release_id: id(45),
      generation: 2,
      release_digest: hash("7"),
      datasource_id: id(46),
    },
    projection_refs,
    status: "STAGED" as const,
  };
}

describe("semantic lifecycle contracts", () => {
  it("accepts only reference and CAS inputs when staging a reviewed successor", async () => {
    const command = await buildStageReviewedSemanticSuccessorCommand({
      schema_version: "stage-reviewed-semantic-successor-command@1.0.0",
      command_id: id(30),
      idempotency_key: "falcon24-e4-semantic-successor",
      scope,
      change_set_ref: { change_set_id: id(31), change_set_hash: hash("d") },
      review_ref: { review_id: id(32), review_hash: hash("e") },
      source_snapshot_ref: {
        snapshot_id: id(33),
        snapshot_revision: 7,
        snapshot_hash: hash("f"),
      },
      compiler_bundle_ref: {
        compiler_version: "semantic-change-set-publication@2",
        compiler_bundle_hash: hash("1"),
      },
      expected_predecessor: {
        release_id: id(34),
        generation: 1,
        release_digest: hash("2"),
      },
      expected_pointer_version: 3,
      target_generation: 2,
    });

    expect(stageReviewedSemanticSuccessorCommandSchema.parse(command)).toEqual(command);
    await expect(
      buildStageReviewedSemanticSuccessorCommand({
        ...command,
        target_generation: 3,
      }),
    ).rejects.toThrow("SEMANTIC_SUCCESSOR_GENERATION_INVALID");
    expect(() =>
      stageReviewedSemanticSuccessorCommandSchema.parse({
        ...command,
        projection_payload: { executable: {} },
      }),
    ).toThrow();
  });

  it("binds a four-projection successor stage digest independently of lifecycle status", async () => {
    const stage = await buildSemanticSuccessorStage(successorStageMaterial());
    await expect(verifySemanticSuccessorStage(stage)).resolves.toEqual(stage);
    const smokePassed = await buildSemanticSuccessorStage({
      ...stage,
      status: "SMOKE_PASSED",
    });
    expect(smokePassed.stage_digest).toBe(stage.stage_digest);
    await expect(
      verifySemanticSuccessorStage({
        ...stage,
        candidate_release: { ...stage.candidate_release, release_digest: hash("8") },
      }),
    ).rejects.toThrow("SEMANTIC_SUCCESSOR_STAGE_DIGEST_MISMATCH");
    expect(() =>
      semanticSuccessorStageEnvelopeSchema.parse({
        stage,
        projections: {
          executable: {
            projection_kind: "EXECUTABLE",
            ...stage.projection_refs.executable,
            projection_payload: {},
          },
        },
      }),
    ).toThrow();
  });

  it("keeps validation and deterministic smoke receipts in separate hash domains", async () => {
    const stage = await buildSemanticSuccessorStage(successorStageMaterial());
    const validation = await buildSemanticRuntimeClosureValidationReceipt({
      schema_version: "semantic-runtime-closure-validation-receipt@1.0.0",
      receipt_id: id(47),
      stage_id: stage.stage_id,
      stage_digest: stage.stage_digest,
      candidate_release: stage.candidate_release,
      projection_refs: stage.projection_refs,
      validator_identity: {
        validator_version: "semantic-runtime-closure-validator@1.0.0",
        validator_hash: hash("9"),
      },
      outcome: "PASS",
      reason_codes: [],
    });
    const smoke = await buildSemanticRuntimeSmokeReceipt({
      schema_version: "semantic-runtime-smoke-receipt@1.0.0",
      receipt_id: id(48),
      stage_id: stage.stage_id,
      stage_digest: stage.stage_digest,
      candidate_release: stage.candidate_release,
      projection_refs: stage.projection_refs,
      resolved_metric_id: "metric.order_revenue",
      resolved_dimension_id: "dimension.order_month",
      resolved_binding_hash: hash("a"),
      plan_hash: hash("b"),
      calendar_timezone: "Asia/Shanghai",
      window_start: "2023-11-01T00:00:00.000Z",
      window_end_exclusive: "2024-11-01T00:00:00.000Z",
      validator_identity: validation.validator_identity,
      worker_build_identity: {
        schema_version: "runtime-build-identity@1.0.0",
        consumer_role: "worker",
        generation_id: hash("c"),
        build_id: hash("d"),
        built_at: "2026-08-27T00:00:00.000Z",
        git_commit: "1234567",
        git_dirty: false,
      },
      outcome: "PASS",
      failure_code: null,
    });

    expect(validation.validation_receipt_hash).not.toBe(smoke.smoke_receipt_hash);
    await expect(verifySemanticRuntimeClosureValidationReceipt(validation)).resolves.toEqual(
      validation,
    );
    await expect(verifySemanticRuntimeSmokeReceipt(smoke)).resolves.toEqual(smoke);
    await expect(
      verifySemanticRuntimeSmokeReceipt({
        ...smoke,
        smoke_receipt_hash: validation.validation_receipt_hash,
      }),
    ).rejects.toThrow("SEMANTIC_RUNTIME_SMOKE_RECEIPT_HASH_MISMATCH");
  });

  it("binds exact stage/release loads and smoke CAS to canonical command hashes", async () => {
    const stage = await buildSemanticSuccessorStage(successorStageMaterial());
    const smoke = await buildSemanticRuntimeSmokeReceipt({
      schema_version: "semantic-runtime-smoke-receipt@1.0.0",
      receipt_id: id(49),
      stage_id: stage.stage_id,
      stage_digest: stage.stage_digest,
      candidate_release: stage.candidate_release,
      projection_refs: stage.projection_refs,
      resolved_metric_id: "metric.order_revenue",
      resolved_dimension_id: "dimension.order_month",
      resolved_binding_hash: hash("a"),
      plan_hash: hash("b"),
      calendar_timezone: "Asia/Shanghai",
      window_start: "2023-11-01T00:00:00.000Z",
      window_end_exclusive: "2024-11-01T00:00:00.000Z",
      validator_identity: {
        validator_version: "semantic-runtime-closure-validator@1.0.0",
        validator_hash: hash("9"),
      },
      worker_build_identity: {
        schema_version: "runtime-build-identity@1.0.0",
        consumer_role: "worker",
        generation_id: hash("c"),
        build_id: hash("d"),
        built_at: "2026-08-27T00:00:00.000Z",
        git_commit: "1234567",
        git_dirty: false,
      },
      outcome: "PASS",
      failure_code: null,
    });
    const stageLoad = await buildSemanticSuccessorStageLoadCommand({
      schema_version: "semantic-successor-stage-load@1.0.0",
      stage_id: stage.stage_id,
    });
    const releaseLoad = await buildSemanticSuccessorReleaseLoadCommand({
      schema_version: "semantic-successor-release-load@1.0.0",
      semantic_domain: scope.semantic_domain,
      release_id: stage.candidate_release.release_id,
    });
    const commit = await buildSemanticSuccessorSmokeCommitCommand({
      schema_version: "semantic-successor-smoke-commit@1.0.0",
      idempotency_key: "falcon24-e4-stage-smoke",
      stage_id: stage.stage_id,
      expected_stage_digest: stage.stage_digest,
      receipt: smoke,
    });

    expect(stageLoad.command_hash).not.toBe(releaseLoad.command_hash);
    expect(commit.receipt.smoke_receipt_hash).toBe(smoke.smoke_receipt_hash);
    await expect(
      buildSemanticSuccessorSmokeCommitCommand({
        schema_version: "semantic-successor-smoke-commit@1.0.0",
        idempotency_key: commit.idempotency_key,
        stage_id: id(50),
        expected_stage_digest: commit.expected_stage_digest,
        receipt: smoke,
      }),
    ).rejects.toThrow("SEMANTIC_SUCCESSOR_SMOKE_COMMAND_RECEIPT_MISMATCH");
  });

  it("builds stable assertion identity independently of assertion id and provenance", async () => {
    const left = await buildSemanticAssertionCandidate(assertionInput());
    const right = await buildSemanticAssertionCandidate(
      assertionInput({ assertion_id: id(11), confidence: 0.9 }),
    );
    expect(left.identity_hash).toBe(right.identity_hash);
    expect(left.assertion_hash).not.toBe(right.assertion_hash);
  });

  it("requires explicit premises and a registered rule for Agent inference", async () => {
    await expect(
      buildSemanticAssertionCandidate(
        assertionInput({
          source_kind: "AGENT_INFERENCE",
          evidence: [
            {
              evidence_id: "rule:no-premise",
              source_kind: "AGENT_INFERENCE",
              source_ref: {
                resource_id: "semantic-rule-registry",
                resource_revision: 1,
                resource_hash: hash("b"),
              },
              locator: { locator_kind: "INFERENCE_RULE", locator_value: "rule:no-premise" },
              observation: "Inference without premises is not admissible.",
            },
          ],
          confidence: 0.8,
        }),
      ),
    ).rejects.toThrow();
  });

  it("binds a canonical change set hash and rejects tampering", async () => {
    const assertion = await buildSemanticAssertionCandidate(assertionInput());
    const changeSet = await buildSemanticChangeSet({
      schema_version: "semantic-change-set@1.0.0",
      change_set_id: id(20),
      scope,
      base_release: { release_id: id(21), generation: 1, release_hash: hash("c") },
      revision: 1,
      assertions: [assertion],
      conflicts: [],
      competency_results: [],
      validation: {
        outcome: "PASS",
        reason_codes: [],
        formula_cycle_free: true,
        evidence_closed: true,
        identity_conflict_free: true,
        shapes_valid: true,
        formulas_valid: true,
        grain_join_time_valid: true,
        policy_quality_valid: true,
        competency_cases_passed: true,
      },
      lifecycle_state: "VALIDATED",
    });
    await expect(verifySemanticChangeSet(changeSet)).resolves.toEqual(changeSet);
    await expect(verifySemanticChangeSet({ ...changeSet, revision: 2 })).rejects.toThrow(
      "SEMANTIC_CHANGE_SET_HASH_MISMATCH",
    );
  });

  it("requires an exact frozen ChangeSet in successor human-review packets", async () => {
    const assertion = await buildSemanticAssertionCandidate(assertionInput());
    const changeSet = await buildSemanticChangeSet({
      schema_version: "semantic-change-set@1.0.0",
      change_set_id: id(22),
      scope,
      base_release: { release_id: id(23), generation: 1, release_hash: hash("d") },
      revision: 1,
      assertions: [assertion],
      conflicts: [],
      competency_results: [],
      validation: {
        outcome: "PASS",
        reason_codes: [],
        formula_cycle_free: true,
        evidence_closed: true,
        identity_conflict_free: true,
        shapes_valid: true,
        formulas_valid: true,
        grain_join_time_valid: true,
        policy_quality_valid: true,
        competency_cases_passed: true,
      },
      lifecycle_state: "REVIEW_FROZEN",
    });
    const packet = {
      schema_version: "semantic-successor-review-packet@1.0.0",
      title: "Falcon24 executable semantic successor",
      description: "Forward-only reviewed successor.",
      riskLevel: "critical",
      proposer_principal: "falcon24-successor-builder@1",
      review_policy_ref: { policy_version: 1, policy_digest: hash("e") },
      change_set: changeSet,
    };

    expect(semanticSuccessorReviewPacketPayloadSchema.parse(packet)).toEqual(packet);
    expect(() =>
      semanticSuccessorReviewPacketPayloadSchema.parse({
        ...packet,
        projection_payload: { executable: {} },
      }),
    ).toThrow();
    expect(() =>
      semanticSuccessorReviewPacketPayloadSchema.parse({
        ...packet,
        change_set: { ...changeSet, lifecycle_state: "VALIDATED" },
      }),
    ).toThrow();
  });
});
