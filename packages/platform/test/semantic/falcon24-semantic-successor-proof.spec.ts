import {
  buildSemanticRuntimeClosureValidationReceipt,
  buildSemanticRuntimeSmokeReceipt,
  buildSemanticSuccessorStage,
} from "@data-agent/contracts/artifacts";
import { verifyFalcon24SemanticReleaseAuthorityProofV2 } from "@data-agent/contracts/evals";
import { describe, expect, it } from "vitest";
import { buildFalcon24SemanticSuccessorAuthorityProof } from "../../src/semantic/falcon24-retained-authority-proof.js";

const id = (suffix: number) => `72000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;

async function fixture() {
  const stage = await buildSemanticSuccessorStage({
    schema_version: "semantic-successor-stage@1.0.0",
    stage_id: id(1),
    scope: {
      app_id: id(2),
      tenant_id: id(3),
      environment: "test",
      semantic_domain: "falcon24",
    },
    predecessor_release: {
      release_id: id(4),
      generation: 1,
      release_digest: hash("1"),
    },
    expected_pointer_version: 7,
    target_generation: 2,
    change_set_ref: { change_set_id: id(5), change_set_hash: hash("2") },
    review_ref: { review_id: id(6), review_hash: hash("3") },
    source_snapshot_ref: {
      snapshot_id: id(7),
      snapshot_revision: 4,
      snapshot_hash: hash("4"),
    },
    compiler_bundle_ref: {
      compiler_version: "semantic-change-set-publication@2",
      compiler_bundle_hash: hash("5"),
    },
    candidate_release: {
      release_id: id(8),
      generation: 2,
      release_digest: hash("6"),
      datasource_id: id(9),
    },
    projection_refs: {
      executable: { projection_id: id(10), projection_digest: hash("7") },
      relationship: { projection_id: id(11), projection_digest: hash("8") },
      runtime_restriction: { projection_id: id(12), projection_digest: hash("9") },
      graph: { projection_id: id(13), projection_digest: hash("a") },
    },
    status: "SMOKE_PASSED",
  });
  const validatorIdentity = {
    validator_version: "semantic-runtime-closure-validator@1.0.0",
    validator_hash: hash("b"),
  } as const;
  const validation = await buildSemanticRuntimeClosureValidationReceipt({
    schema_version: "semantic-runtime-closure-validation-receipt@1.0.0",
    receipt_id: id(14),
    stage_id: stage.stage_id,
    stage_digest: stage.stage_digest,
    candidate_release: stage.candidate_release,
    projection_refs: stage.projection_refs,
    validator_identity: validatorIdentity,
    outcome: "PASS",
    reason_codes: [],
  });
  const smoke = await buildSemanticRuntimeSmokeReceipt({
    schema_version: "semantic-runtime-smoke-receipt@1.0.0",
    receipt_id: id(15),
    stage_id: stage.stage_id,
    stage_digest: stage.stage_digest,
    candidate_release: stage.candidate_release,
    projection_refs: stage.projection_refs,
    resolved_metric_id: "metric.order_revenue",
    resolved_dimension_id: "dimension.order_month",
    resolved_binding_hash: hash("c"),
    plan_hash: hash("d"),
    calendar_timezone: "Asia/Shanghai",
    window_start: "2023-11-01T00:00:00.000Z",
    window_end_exclusive: "2024-11-01T00:00:00.000Z",
    validator_identity: validatorIdentity,
    worker_build_identity: {
      schema_version: "runtime-build-identity@1.0.0",
      consumer_role: "worker",
      generation_id: hash("e"),
      build_id: hash("f"),
      built_at: "2026-08-28T00:00:00.000Z",
      git_commit: "1234567",
      git_dirty: false,
    },
    outcome: "PASS",
    failure_code: null,
  });
  return { stage, validation, smoke };
}

describe("Falcon24 semantic successor authority proof", () => {
  it("binds a distinct generation-2 candidate and both PASS receipts into proof v2", async () => {
    const { stage, validation, smoke } = await fixture();
    const proof = await buildFalcon24SemanticSuccessorAuthorityProof({
      stage,
      validation_receipt: validation,
      smoke_receipt: smoke,
      expected_versions: {
        semantic_pointer: 7,
        semantic_runtime: 3,
        workspace_defaults: 11,
      },
    });

    await expect(verifyFalcon24SemanticReleaseAuthorityProofV2(proof)).resolves.toEqual(proof);
    expect(proof).toMatchObject({
      authority_epoch: "E4",
      predecessor_release: {
        release_id: stage.predecessor_release.release_id,
        generation: 1,
        datasource_id: stage.candidate_release.datasource_id,
      },
      candidate_release: { release_id: stage.candidate_release.release_id, generation: 2 },
      projections: stage.projection_refs,
      validation_receipt_ref: {
        receipt_id: validation.receipt_id,
        validation_receipt_hash: validation.validation_receipt_hash,
      },
      smoke_receipt_ref: {
        receipt_id: smoke.receipt_id,
        smoke_receipt_hash: smoke.smoke_receipt_hash,
      },
    });
    expect(proof.candidate_release.release_id).not.toBe(proof.predecessor_release.release_id);
    expect(proof.candidate_release.release_digest).not.toBe(
      proof.predecessor_release.release_digest,
    );
  });

  it("rejects a validly hashed smoke receipt from a different validator closure", async () => {
    const { stage, validation, smoke } = await fixture();
    const mismatchedSmoke = await buildSemanticRuntimeSmokeReceipt({
      ...smoke,
      validator_identity: {
        ...smoke.validator_identity,
        validator_hash: hash("0"),
      },
    });

    await expect(
      buildFalcon24SemanticSuccessorAuthorityProof({
        stage,
        validation_receipt: validation,
        smoke_receipt: mismatchedSmoke,
        expected_versions: {
          semantic_pointer: 7,
          semantic_runtime: 3,
          workspace_defaults: 11,
        },
      }),
    ).rejects.toThrow("FALCON24_SEMANTIC_SUCCESSOR_RECEIPT_CLOSURE_INVALID");
  });

  it("rejects stale pointer CAS and proof tampering", async () => {
    const { stage, validation, smoke } = await fixture();
    await expect(
      buildFalcon24SemanticSuccessorAuthorityProof({
        stage,
        validation_receipt: validation,
        smoke_receipt: smoke,
        expected_versions: {
          semantic_pointer: 6,
          semantic_runtime: 3,
          workspace_defaults: 11,
        },
      }),
    ).rejects.toThrow("FALCON24_SEMANTIC_SUCCESSOR_NOT_ACTIVATABLE");

    const proof = await buildFalcon24SemanticSuccessorAuthorityProof({
      stage,
      validation_receipt: validation,
      smoke_receipt: smoke,
      expected_versions: {
        semantic_pointer: 7,
        semantic_runtime: 3,
        workspace_defaults: 11,
      },
    });
    await expect(
      verifyFalcon24SemanticReleaseAuthorityProofV2({
        ...proof,
        candidate_release: { ...proof.candidate_release, release_digest: hash("0") },
      }),
    ).rejects.toThrow("FALCON24_SEMANTIC_SUCCESSOR_PROOF_HASH_INVALID");
  });
});
