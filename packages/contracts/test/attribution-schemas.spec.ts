import { describe, expect, it } from "vitest";
import {
  // DerivedDeltaObservationSet
  derivedDeltaObservationSetSchema,
  deltaObservationSchema,
  deltaObservationKindSchema,
  validateDeltaObservationSet,
  type DerivedDeltaObservationSet,
  type DeltaObservation,
  // StaticDriverCapacityProof
  staticDriverCapacityProofSchema,
  computeStaticDriverCapacityProof,
  MAX_DRIVER_LIMIT,
  MAX_SQL_LIMIT,
  type CapacityCheckInput,
  // RunDriverBudgetAdmission
  runDriverBudgetAdmissionSchema,
  budgetAdmissionStatusSchema,
  checkAndReserveBudget,
  transitionBudgetAdmission,
  isBudgetAdmissionExpired,
  type BudgetState,
  type BudgetAdmissionReservation,
  // SameFrontierWitness
  sameFrontierWitnessSchema,
  fiveAxisFrontierSchema,
  frontierAxisSchema,
  witnessSameFrontier,
  computeFrontierIdentityDigest,
  checkCrossAxisMismatch,
  type FiveAxisFrontier,
  type FrontierAxis,
  // ContributionClosureReceipt
  contributionClosureReceiptSchema,
  deriveContributionClosureReceipt,
  type ClosureInput,
  // FixtureConclusionPolicyManifest
  fixtureConclusionPolicyManifestSchema,
  checkConclusionCandidateAgainstManifest,
  type ManifestCheckInput,
  type AssertionType,
  // FixtureConclusionDecisionSeal
  fixtureConclusionDecisionSealSchema,
  sealFixtureConclusionDecision,
  verifyFixtureConclusionDecisionSeal,
  type SealInput,
  // AttributionKernelEvidence
  attributionKernelEvidenceSchema,
  fixtureConclusionCandidateSchema,
  type AttributionKernelEvidence,
  type F9Status,
  type ClosureVerdict,
} from "../src/attribution/index.js";

// ─── Helpers ───────────────────────────────────────────────────────────────────

const testHash = `sha256:${"a".repeat(64)}` as const;
const testHashB = `sha256:${"b".repeat(64)}` as const;
const testUUID = "00000000-0000-4000-8000-000000000001";
const testUUID2 = "00000000-0000-4000-8000-000000000002";
const testTimestamp = "2026-08-04T00:00:00.000Z";

function makeFrontierAxis(override?: Partial<FrontierAxis>): FrontierAxis {
  return {
    ref: testUUID,
    hash: testHash,
    version: "1.0.0",
    ...override,
  };
}

function makeFiveAxisFrontier(override?: Partial<FiveAxisFrontier>): FiveAxisFrontier {
  return {
    identity_ref: makeFrontierAxis(),
    principal_ref: makeFrontierAxis(),
    scope_ref: makeFrontierAxis(),
    time_window_ref: makeFrontierAxis(),
    classification_ref: makeFrontierAxis(),
    ...override,
  };
}

// ─── DerivedDeltaObservationSet ────────────────────────────────────────────────

describe("DerivedDeltaObservationSet", () => {
  it("validates a complete delta observation set", () => {
    const set: DerivedDeltaObservationSet = {
      protocol_version: "derived-delta-observation-set@1",
      observation_set_id: testUUID,
      profile_hash: testHash,
      truth_contract_hash: testHash,
      observations: [
        {
          observation_id: testUUID,
          subject_id: "outcome-001",
          observation_kind: "OUTCOME",
          subject_label: "Total Revenue",
          baseline_level: 10000,
          follow_up_level: 8500,
          signed_delta: -1500,
          delta_unit: "USD",
          endpoint_binding_ref: testUUID,
          baseline_evidence_hash: testHash,
          follow_up_evidence_hash: testHashB,
          frontier_witness_hash: testHash,
          derivation_metadata: {
            delta_method: "DIRECT_DIFFERENCE",
            confidence: 0.9,
            computed_at: testTimestamp,
          },
        },
        {
          observation_id: testUUID2,
          subject_id: "driver-001",
          observation_kind: "DRIVER",
          subject_label: "Promotion Discount",
          baseline_level: 5000,
          follow_up_level: 6000,
          signed_delta: 1000,
          delta_unit: "USD",
          endpoint_binding_ref: testUUID,
          baseline_evidence_hash: testHash,
          follow_up_evidence_hash: testHashB,
          frontier_witness_hash: testHash,
          derivation_metadata: {
            delta_method: "DIRECT_DIFFERENCE",
            confidence: 0.85,
            computed_at: testTimestamp,
          },
        },
        {
          observation_id: testUUID,
          subject_id: "residual-001",
          observation_kind: "INDEPENDENTLY_OBSERVED_RESIDUAL",
          subject_label: "Market effect",
          baseline_level: 0,
          follow_up_level: 100,
          signed_delta: 100,
          delta_unit: "USD",
          endpoint_binding_ref: testUUID,
          baseline_evidence_hash: testHash,
          follow_up_evidence_hash: testHashB,
          frontier_witness_hash: testHash,
          derivation_metadata: {
            delta_method: "DIRECT_DIFFERENCE",
            confidence: 0.6,
            computed_at: testTimestamp,
          },
        },
      ],
      computed_closure_error: 100,
      independently_observed_residual_delta: 100,
      unexplained_remainder: 0,
      derivation_version: "attribution-fixture-kernel@1",
      derived_at: testTimestamp,
    };

    const result = derivedDeltaObservationSetSchema.safeParse(set);
    expect(result.success).toBe(true);

    const errors = validateDeltaObservationSet(set);
    expect(errors).toHaveLength(0);
  });

  it("rejects incorrect observation_kind enum", () => {
    const result = deltaObservationKindSchema.safeParse("INVALID");
    expect(result.success).toBe(false);
  });

  it("rejects set with missing OUTCOME observation", () => {
    const set: DerivedDeltaObservationSet = {
      protocol_version: "derived-delta-observation-set@1",
      observation_set_id: testUUID,
      profile_hash: testHash,
      truth_contract_hash: testHash,
      observations: [
        {
          observation_id: testUUID,
          subject_id: "driver-001",
          observation_kind: "DRIVER",
          subject_label: "A driver",
          baseline_level: 100,
          follow_up_level: 200,
          signed_delta: 100,
          delta_unit: "USD",
          endpoint_binding_ref: testUUID,
          baseline_evidence_hash: testHash,
          follow_up_evidence_hash: testHashB,
          frontier_witness_hash: testHash,
          derivation_metadata: {
            delta_method: "DIRECT_DIFFERENCE",
            confidence: 0.85,
            computed_at: testTimestamp,
          },
        },
      ],
      computed_closure_error: 0,
      independently_observed_residual_delta: 0,
      unexplained_remainder: 0,
      derivation_version: "attribution-fixture-kernel@1",
      derived_at: testTimestamp,
    };

    const errors = validateDeltaObservationSet(set);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("OUTCOME");
  });
});

// ─── StaticDriverCapacityProof ─────────────────────────────────────────────────

describe("StaticDriverCapacityProof", () => {
  it("returns WITHIN_CAPACITY for valid driver count", () => {
    const input: CapacityCheckInput = {
      profile_hash: testHash,
      source_release_digest: testHash,
      driver_count: 3,
      sql_estimate: 3,
      obligation_estimate: 10,
      artifact_input_estimate: 5,
    };

    const proof = computeStaticDriverCapacityProof(input);
    expect(proof.verdict).toBe("WITHIN_CAPACITY");
    expect(proof.driver_count).toBe(3);
    expect(proof.max_driver_limit).toBe(MAX_DRIVER_LIMIT);
    expect(proof.max_sql_limit).toBe(MAX_SQL_LIMIT);
  });

  it("returns EXCEEDS_CAPACITY for driver count > 6", () => {
    const input: CapacityCheckInput = {
      profile_hash: testHash,
      source_release_digest: testHash,
      driver_count: 7,
      sql_estimate: 7,
      obligation_estimate: 70,
      artifact_input_estimate: 35,
    };

    const proof = computeStaticDriverCapacityProof(input);
    expect(proof.verdict).toBe("EXCEEDS_CAPACITY");
  });

  it("returns EXCEEDS_CAPACITY for SQL estimate > 16", () => {
    const input: CapacityCheckInput = {
      profile_hash: testHash,
      source_release_digest: testHash,
      driver_count: 3,
      sql_estimate: 20,
      obligation_estimate: 10,
      artifact_input_estimate: 5,
    };

    const proof = computeStaticDriverCapacityProof(input);
    expect(proof.verdict).toBe("EXCEEDS_CAPACITY");
  });

  it("validates schema with correct fields", () => {
    const proof = computeStaticDriverCapacityProof({
      profile_hash: testHash,
      source_release_digest: testHash,
      driver_count: 3,
      sql_estimate: 3,
      obligation_estimate: 10,
      artifact_input_estimate: 5,
    });
    const result = staticDriverCapacityProofSchema.safeParse(proof);
    expect(result.success).toBe(true);
  });
});

// ─── RunDriverBudgetAdmission ──────────────────────────────────────────────────

describe("RunDriverBudgetAdmission", () => {
  it("reserves budget when sufficient", () => {
    const state: BudgetState = {
      remaining_sql_budget: 16,
      remaining_obligation_budget: 60,
      remaining_artifact_input_budget: 30,
    };
    const reservation: BudgetAdmissionReservation = {
      idempotency_key: "run-001:question-001",
      run_fence: "run-001",
      question_hash: testHash,
      profile_hash: testHash,
      requested_sql: 3,
      requested_obligations: 10,
      requested_artifact_inputs: 5,
      reservation_ttl_ms: 60_000,
    };

    const result = checkAndReserveBudget(state, reservation);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.admission.status).toBe("RESERVED");
      expect(result.admission.remaining_sql_budget).toBe(13);
    }
  });

  it("rejects when budget insufficient", () => {
    const state: BudgetState = {
      remaining_sql_budget: 1,
      remaining_obligation_budget: 60,
      remaining_artifact_input_budget: 30,
    };
    const reservation: BudgetAdmissionReservation = {
      idempotency_key: "run-001:question-001",
      run_fence: "run-001",
      question_hash: testHash,
      profile_hash: testHash,
      requested_sql: 3,
      requested_obligations: 10,
      requested_artifact_inputs: 5,
      reservation_ttl_ms: 60_000,
    };

    const result = checkAndReserveBudget(state, reservation);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("CONTRIBUTION_DRIVER_BUDGET_EXCEEDED");
    }
  });

  it("transitions RESERVED to CONSUMED", () => {
    const state: BudgetState = {
      remaining_sql_budget: 16,
      remaining_obligation_budget: 60,
      remaining_artifact_input_budget: 30,
    };
    const reservation: BudgetAdmissionReservation = {
      idempotency_key: "test",
      run_fence: "test",
      question_hash: testHash,
      profile_hash: testHash,
      requested_sql: 1,
      requested_obligations: 1,
      requested_artifact_inputs: 1,
      reservation_ttl_ms: 60_000,
    };
    const result = checkAndReserveBudget(state, reservation);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const consumed = transitionBudgetAdmission(result.admission, "CONSUMED");
      expect(consumed.status).toBe("CONSUMED");
      expect(consumed.consumed_at).toBeDefined();
    }
  });

  it("validates budget admission status enum", () => {
    expect(budgetAdmissionStatusSchema.safeParse("RESERVED").success).toBe(true);
    expect(budgetAdmissionStatusSchema.safeParse("CONSUMED").success).toBe(true);
    expect(budgetAdmissionStatusSchema.safeParse("RELEASED").success).toBe(true);
    expect(budgetAdmissionStatusSchema.safeParse("EXPIRED").success).toBe(true);
    expect(budgetAdmissionStatusSchema.safeParse("INVALID").success).toBe(false);
  });
});

// ─── SameFrontierWitness ───────────────────────────────────────────────────────

describe("SameFrontierWitness", () => {
  it("returns IDENTICAL when frontiers match", () => {
    const baseline = makeFiveAxisFrontier();
    const followUp = makeFiveAxisFrontier();

    const witness = witnessSameFrontier({
      baseline,
      follow_up: followUp,
      witnessed_by: "test-verifier",
    });

    expect(witness.witness_status).toBe("IDENTICAL");
    expect(witness.frontier_identity_digest).toBe(
      computeFrontierIdentityDigest(baseline),
    );
  });

  it("returns CROSS_AXIS_MISMATCH when frontiers differ", () => {
    const baseline = makeFiveAxisFrontier();
    const followUp = makeFiveAxisFrontier({
      identity_ref: makeFrontierAxis({ hash: testHashB }),
    });

    const witness = witnessSameFrontier({
      baseline,
      follow_up: followUp,
      witnessed_by: "test-verifier",
    });

    expect(witness.witness_status).toBe("CROSS_AXIS_MISMATCH");
  });

  it("validates schema", () => {
    const baseline = makeFiveAxisFrontier();
    const followUp = makeFiveAxisFrontier();
    const witness = witnessSameFrontier({
      baseline,
      follow_up: followUp,
      witnessed_by: "test-verifier",
    });
    const result = sameFrontierWitnessSchema.safeParse(witness);
    expect(result.success).toBe(true);
  });
});

// ─── ContributionClosureReceipt ────────────────────────────────────────────────

describe("ContributionClosureReceipt", () => {
  it("derives PASS when closure is consistent", () => {
    const input: ClosureInput = {
      profile_hash: testHash,
      truth_contract_hash: testHash,
      observation_set_hash: testHash,
      computed_closure_error: 0,
      independently_observed_residual_delta: 0,
      unexplained_remainder: 0,
      closure_verifier: "test-verifier",
      closure_verifier_version: "1.0.0",
    };

    const receipt = deriveContributionClosureReceipt(input);
    expect(receipt.closure_verdict).toBe("PASS");
  });

  it("derives HOLD when closure error is non-zero", () => {
    const input: ClosureInput = {
      profile_hash: testHash,
      truth_contract_hash: testHash,
      observation_set_hash: testHash,
      computed_closure_error: 100,
      independently_observed_residual_delta: 50,
      unexplained_remainder: 50,
      closure_verifier: "test-verifier",
      closure_verifier_version: "1.0.0",
    };

    const receipt = deriveContributionClosureReceipt(input);
    expect(receipt.closure_verdict).toBe("HOLD");
  });

  it("derives REFUSE when unexplained_remainder is inconsistent", () => {
    const input: ClosureInput = {
      profile_hash: testHash,
      truth_contract_hash: testHash,
      observation_set_hash: testHash,
      computed_closure_error: 100,
      independently_observed_residual_delta: 50,
      unexplained_remainder: 60, // should be 50 = 100 - 50
      closure_verifier: "test-verifier",
      closure_verifier_version: "1.0.0",
    };

    const receipt = deriveContributionClosureReceipt(input);
    expect(receipt.closure_verdict).toBe("REFUSE");
  });

  it("validates schema", () => {
    const receipt = deriveContributionClosureReceipt({
      profile_hash: testHash,
      truth_contract_hash: testHash,
      observation_set_hash: testHash,
      computed_closure_error: 0,
      independently_observed_residual_delta: 0,
      unexplained_remainder: 0,
      closure_verifier: "test-verifier",
      closure_verifier_version: "1.0.0",
    });
    const result = contributionClosureReceiptSchema.safeParse(receipt);
    expect(result.success).toBe(true);
  });
});

// ─── FixtureConclusionPolicyManifest ───────────────────────────────────────────

describe("FixtureConclusionPolicyManifest", () => {
  it("ALLOWs ASSERT.claim_ast with ClaimAST", () => {
    const manifest = fixtureConclusionPolicyManifestSchema.parse({
      protocol_version: "fixture-conclusion-policy-manifest@1",
      manifest_id: testUUID,
      manifest_version: "1.0.0",
      fixture_hash: testHash,
      profile_hash: testHash,
      truth_contract_hash: testHash,
      allowed_assertion_types: ["ASSERT.claim_ast", "ABSTAIN", "REFUSE"],
      policy_hash: testHash,
      checked_in_at: testTimestamp,
      checker_version: "attribution-fixture-kernel@1",
    });

    const input: ManifestCheckInput = {
      manifest,
      candidate_assertion_type: "ASSERT.claim_ast",
      candidate_claim_ast: "revenue_decline = promotion_discount + late_refunds + market_effect",
    };

    const result = checkConclusionCandidateAgainstManifest(input);
    expect(result.verdict).toBe("ALLOW");
  });

  it("MISMATCH for ASSERT.claim_ast without ClaimAST", () => {
    const manifest = fixtureConclusionPolicyManifestSchema.parse({
      protocol_version: "fixture-conclusion-policy-manifest@1",
      manifest_id: testUUID,
      manifest_version: "1.0.0",
      fixture_hash: testHash,
      profile_hash: testHash,
      truth_contract_hash: testHash,
      allowed_assertion_types: ["ASSERT.claim_ast", "ABSTAIN", "REFUSE"],
      policy_hash: testHash,
      checked_in_at: testTimestamp,
      checker_version: "attribution-fixture-kernel@1",
    });

    const input: ManifestCheckInput = {
      manifest,
      candidate_assertion_type: "ASSERT.claim_ast",
      candidate_claim_ast: null,
    };

    const result = checkConclusionCandidateAgainstManifest(input);
    expect(result.verdict).toBe("MISMATCH");
  });

  it("ABSTAIN from ABSTAIN assertion type", () => {
    const manifest = fixtureConclusionPolicyManifestSchema.parse({
      protocol_version: "fixture-conclusion-policy-manifest@1",
      manifest_id: testUUID,
      manifest_version: "1.0.0",
      fixture_hash: testHash,
      profile_hash: testHash,
      truth_contract_hash: testHash,
      allowed_assertion_types: ["ASSERT.claim_ast", "ABSTAIN", "REFUSE"],
      policy_hash: testHash,
      checked_in_at: testTimestamp,
      checker_version: "attribution-fixture-kernel@1",
    });

    const input: ManifestCheckInput = {
      manifest,
      candidate_assertion_type: "ABSTAIN",
      candidate_claim_ast: null,
    };

    const result = checkConclusionCandidateAgainstManifest(input);
    expect(result.verdict).toBe("ABSTAIN");
  });

  it("MISMATCH for ABSTAIN with ClaimAST", () => {
    const manifest = fixtureConclusionPolicyManifestSchema.parse({
      protocol_version: "fixture-conclusion-policy-manifest@1",
      manifest_id: testUUID,
      manifest_version: "1.0.0",
      fixture_hash: testHash,
      profile_hash: testHash,
      truth_contract_hash: testHash,
      allowed_assertion_types: ["ASSERT.claim_ast", "ABSTAIN", "REFUSE"],
      policy_hash: testHash,
      checked_in_at: testTimestamp,
      checker_version: "attribution-fixture-kernel@1",
    });

    const input: ManifestCheckInput = {
      manifest,
      candidate_assertion_type: "ABSTAIN",
      candidate_claim_ast: "some claim",
    };

    const result = checkConclusionCandidateAgainstManifest(input);
    expect(result.verdict).toBe("MISMATCH");
  });
});

// ─── FixtureConclusionDecisionSeal ─────────────────────────────────────────────

describe("FixtureConclusionDecisionSeal", () => {
  it("seals a decision correctly", () => {
    const input: SealInput = {
      manifest_hash: testHash,
      candidate_hash: testHash,
      conclusion_verdict: "CONFIRMED",
      sealed_by: "fixture-kernel@1",
    };

    const seal = sealFixtureConclusionDecision(input);
    expect(seal.decision_status).toBe("SEALED");
    expect(seal.seal_hash).toBeDefined();
    expect(seal.metadata.is_m1_only).toBe(true);
    expect(seal.metadata.has_key_nonce_rotation).toBe(false);
  });

  it("detects tampered seal", () => {
    const input: SealInput = {
      manifest_hash: testHash,
      candidate_hash: testHash,
      conclusion_verdict: "CONFIRMED",
      sealed_by: "fixture-kernel@1",
    };

    const seal = sealFixtureConclusionDecision(input);
    const tampered = { ...seal, seal_hash: testHashB };
    const status = verifyFixtureConclusionDecisionSeal(tampered);
    expect(status).toBe("TAMPERED");
  });

  it("validates schema", () => {
    const seal = sealFixtureConclusionDecision({
      manifest_hash: testHash,
      candidate_hash: testHash,
      conclusion_verdict: "CONFIRMED",
      sealed_by: "fixture-kernel@1",
    });
    const result = fixtureConclusionDecisionSealSchema.safeParse(seal);
    expect(result.success).toBe(true);
  });
});

// ─── AttributionKernelEvidence ─────────────────────────────────────────────────

describe("AttributionKernelEvidence", () => {
  it("validates complete evidence with U13.1 extended fields", () => {
    const evidence: AttributionKernelEvidence = {
      evidence_id: testUUID,
      app_id: testUUID,
      tenant_id: testUUID,
      environment: "test",
      run_id: testUUID,
      kernel_version: "attribution-kernel@1",
      origin: "FIXTURE",
      profile_hash: testHash,
      contribution_truth_hash: testHash,
      version_frontier_refs: {
        baseline: {
          identity_ref: testUUID,
          principal_ref: testUUID,
          scope_ref: testUUID,
          time_window_ref: testUUID,
          classification_ref: testUUID,
        },
        follow_up: {
          identity_ref: testUUID,
          principal_ref: testUUID,
          scope_ref: testUUID,
          time_window_ref: testUUID,
          classification_ref: testUUID,
        },
      },
      endpoint_binding_refs: [testUUID, testUUID2],
      lowering_certificate_refs: [testUUID],
      budget_admission_ref: testUUID,
      delta_observation_set_ref: testUUID,
      closure_receipt_ref: testUUID,
      conclusion_candidate: {
        candidate_id: "candidate-001",
        subject_id: "truth-001",
        source_identity: "fixture-001",
        contribution_verdict: "CONFIRMED",
        evidence_links: [
          { link_type: "endpoint_binding", link_hash: testHash, link_ref: testUUID },
        ],
        fixture_metadata: {
          fixture_id: "fixture-001",
          fixture_version: "1.0.0",
          generated_at: testTimestamp,
          fixture_confidence: 0.9,
        },
        signed_at: testTimestamp,
      },
      closure_verdict: "PASS",
      explicit_absence: "attribution_feasibility_verdict",
      f9_status: {
        core_l2: "HOLD",
        attribution_f9: "NOT_REGISTERED",
        fixture_evidence: "HOLD",
      },
      fixture_conclusion: {
        subject_id: "truth-001",
        source_identity: "fixture-001",
        contribution_verdict: "CONFIRMED",
        evidence_links: [
          { link_type: "endpoint_binding", link_hash: testHash, link_ref: testUUID },
        ],
        fixture_metadata: {
          fixture_id: "fixture-001",
          fixture_version: "1.0.0",
          generated_at: testTimestamp,
          fixture_confidence: 0.9,
        },
        signed_at: testTimestamp,
      },
      sealed_at: testTimestamp,
    };

    const result = attributionKernelEvidenceSchema.safeParse(evidence);
    expect(result.success).toBe(true);
  });

  it("rejects evidence with wrong f9_status.core_l2", () => {
    const evidence = {
      evidence_id: testUUID,
      app_id: testUUID,
      tenant_id: testUUID,
      environment: "test",
      run_id: testUUID,
      kernel_version: "attribution-kernel@1",
      origin: "FIXTURE",
      profile_hash: testHash,
      contribution_truth_hash: testHash,
      version_frontier_refs: {
        baseline: {
          identity_ref: testUUID, principal_ref: testUUID, scope_ref: testUUID,
          time_window_ref: testUUID, classification_ref: testUUID,
        },
        follow_up: {
          identity_ref: testUUID, principal_ref: testUUID, scope_ref: testUUID,
          time_window_ref: testUUID, classification_ref: testUUID,
        },
      },
      endpoint_binding_refs: [testUUID],
      lowering_certificate_refs: [testUUID],
      budget_admission_ref: testUUID,
      delta_observation_set_ref: testUUID,
      closure_receipt_ref: testUUID,
      conclusion_candidate: {
        candidate_id: "candidate-001",
        subject_id: "truth-001",
        source_identity: "fixture-001",
        contribution_verdict: "CONFIRMED",
        evidence_links: [],
        fixture_metadata: {
          fixture_id: "fixture-001", fixture_version: "1.0.0",
          generated_at: testTimestamp, fixture_confidence: 0.9,
        },
        signed_at: testTimestamp,
      },
      closure_verdict: "PASS",
      explicit_absence: "attribution_feasibility_verdict",
      f9_status: {
        core_l2: "GO", // should be HOLD
        attribution_f9: "NOT_REGISTERED",
        fixture_evidence: "HOLD",
      },
      fixture_conclusion: {
        subject_id: "truth-001",
        source_identity: "fixture-001",
        contribution_verdict: "CONFIRMED",
        evidence_links: [],
        fixture_metadata: {
          fixture_id: "fixture-001", fixture_version: "1.0.0",
          generated_at: testTimestamp, fixture_confidence: 0.9,
        },
        signed_at: testTimestamp,
      },
      sealed_at: testTimestamp,
    };

    const result = attributionKernelEvidenceSchema.safeParse(evidence);
    expect(result.success).toBe(false);
  });

  it("rejects evidence with wrong explicit_absence", () => {
    const evidence = {
      evidence_id: testUUID,
      app_id: testUUID,
      tenant_id: testUUID,
      environment: "test",
      run_id: testUUID,
      kernel_version: "attribution-kernel@1",
      origin: "FIXTURE",
      profile_hash: testHash,
      contribution_truth_hash: testHash,
      version_frontier_refs: {
        baseline: {
          identity_ref: testUUID, principal_ref: testUUID, scope_ref: testUUID,
          time_window_ref: testUUID, classification_ref: testUUID,
        },
        follow_up: {
          identity_ref: testUUID, principal_ref: testUUID, scope_ref: testUUID,
          time_window_ref: testUUID, classification_ref: testUUID,
        },
      },
      endpoint_binding_refs: [testUUID],
      lowering_certificate_refs: [testUUID],
      budget_admission_ref: testUUID,
      delta_observation_set_ref: testUUID,
      closure_receipt_ref: testUUID,
      conclusion_candidate: {
        candidate_id: "candidate-001",
        subject_id: "truth-001",
        source_identity: "fixture-001",
        contribution_verdict: "CONFIRMED",
        evidence_links: [],
        fixture_metadata: {
          fixture_id: "fixture-001", fixture_version: "1.0.0",
          generated_at: testTimestamp, fixture_confidence: 0.9,
        },
        signed_at: testTimestamp,
      },
      closure_verdict: "PASS",
      explicit_absence: "attribution_feasibility_verdict_present", // wrong value
      f9_status: {
        core_l2: "HOLD",
        attribution_f9: "NOT_REGISTERED",
        fixture_evidence: "HOLD",
      },
      fixture_conclusion: {
        subject_id: "truth-001",
        source_identity: "fixture-001",
        contribution_verdict: "CONFIRMED",
        evidence_links: [],
        fixture_metadata: {
          fixture_id: "fixture-001", fixture_version: "1.0.0",
          generated_at: testTimestamp, fixture_confidence: 0.9,
        },
        signed_at: testTimestamp,
      },
      sealed_at: testTimestamp,
    };

    const result = attributionKernelEvidenceSchema.safeParse(evidence);
    expect(result.success).toBe(false);
  });

  it("validates FixtureConclusionCandidate schema", () => {
    const candidate = {
      candidate_id: "candidate-001",
      subject_id: "truth-001",
      source_identity: "fixture-001",
      contribution_verdict: "CONFIRMED",
      evidence_links: [
        { link_type: "test", link_hash: testHash, link_ref: "ref-001" },
      ],
      fixture_metadata: {
        fixture_id: "fixture-001",
        fixture_version: "1.0.0",
        generated_at: testTimestamp,
        fixture_confidence: 0.85,
      },
      signed_at: testTimestamp,
    };
    const result = fixtureConclusionCandidateSchema.safeParse(candidate);
    expect(result.success).toBe(true);
  });
});
