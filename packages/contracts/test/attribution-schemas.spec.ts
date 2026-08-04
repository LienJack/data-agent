import { describe, expect, it } from "vitest";
import {
  type AssertionType,
  type AttributionKernelEvidence,
  attributionActivePointerSchema,
  attributionCapabilityDirectorySchema,
  attributionEligibilityDecisionSchema,
  // AttributionKernelEvidence
  attributionKernelEvidenceSchema,
  // 10620 Authority Foundation
  attributionOwnerMapReleaseSchema,
  attributionPointerTypeSchema,
  attributionProfileProjectionSchema,
  attributionProfileRequestSchema,
  type BudgetAdmissionReservation,
  type BudgetState,
  budgetAdmissionStatusSchema,
  type CapacityCheckInput,
  type ClosureInput,
  type ClosureVerdict,
  checkAndReserveBudget,
  checkConclusionCandidateAgainstManifest,
  checkCrossAxisMismatch,
  computeFrontierIdentityDigest,
  computeStaticDriverCapacityProof,
  conclusionPolicyDecisionEnvelopeSchema,
  conclusionPolicyReleaseSchema,
  conclusionReceiptSubjectSchema,
  conclusionSignatureAuthoritySchema,
  conclusionSubjectManifestSchema,
  // ContributionClosureReceipt
  contributionClosureReceiptSchema,
  type DeltaObservation,
  type DerivedDeltaObservationSet,
  deltaObservationKindSchema,
  deltaObservationSchema,
  deriveContributionClosureReceipt,
  // DerivedDeltaObservationSet
  derivedDeltaObservationSetSchema,
  type F9Status,
  type FiveAxisFrontier,
  type FrontierAxis,
  fiveAxisFrontierSchema,
  fixtureConclusionCandidateSchema,
  // FixtureConclusionDecisionSeal
  fixtureConclusionDecisionSealSchema,
  // FixtureConclusionPolicyManifest
  fixtureConclusionPolicyManifestSchema,
  frontierAxisSchema,
  isBudgetAdmissionExpired,
  MAX_DRIVER_LIMIT,
  MAX_SQL_LIMIT,
  type ManifestCheckInput,
  nonceLedgerEntrySchema,
  ownerMapEntrySchema,
  // U13.2 Published F9
  publishedAttributionSafetyVerdictSchema,
  relationshipPromotionReceiptSchema,
  // RunDriverBudgetAdmission
  runDriverBudgetAdmissionSchema,
  type SealInput,
  // SameFrontierWitness
  sameFrontierWitnessSchema,
  sealFixtureConclusionDecision,
  signerAssignmentSchema,
  // StaticDriverCapacityProof
  staticDriverCapacityProofSchema,
  transitionBudgetAdmission,
  validateDeltaObservationSet,
  verificationKeyRevisionSchema,
  verifyFixtureConclusionDecisionSeal,
  witnessSameFrontier,
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
    expect(witness.frontier_identity_digest).toBe(computeFrontierIdentityDigest(baseline));
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
          fixture_id: "fixture-001",
          fixture_version: "1.0.0",
          generated_at: testTimestamp,
          fixture_confidence: 0.9,
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
    expect(result.success).toBe(false);
  });

  it("validates FixtureConclusionCandidate schema", () => {
    const candidate = {
      candidate_id: "candidate-001",
      subject_id: "truth-001",
      source_identity: "fixture-001",
      contribution_verdict: "CONFIRMED",
      evidence_links: [{ link_type: "test", link_hash: testHash, link_ref: "ref-001" }],
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

// ─── 10620 Authority Foundation Type Tests ─────────────────────────────────────

describe("AttributionOwnerMapRelease (10620)", () => {
  const testId = "00000000-0000-4000-8000-000000000001";
  const testAppId = "00000000-0000-4000-8000-000000000002";
  const testTenantId = "00000000-0000-4000-8000-000000000003";
  const testTimestamp = "2026-08-04T12:00:00.000Z";

  it("validates a complete owner map release", () => {
    const release = {
      id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      release_id: testId,
      owner_map: [
        {
          canonical_path: "identity.retail.customer",
          owner_capability: "semantic.owner_map.review",
          required_signer_roles: ["A2-domain-owner"],
          quorum: 1,
          proof_verifier_roles: ["A6-verifier"],
        },
      ],
      status: "ACTIVE",
      created_at: testTimestamp,
    };
    const result = attributionOwnerMapReleaseSchema.safeParse(release);
    expect(result.success).toBe(true);
  });

  it("rejects invalid owner map status", () => {
    const release = {
      id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      release_id: testId,
      owner_map: [
        {
          canonical_path: "identity.retail.customer",
          owner_capability: "semantic.owner_map.review",
        },
      ],
      status: "INVALID",
      created_at: testTimestamp,
    };
    const result = attributionOwnerMapReleaseSchema.safeParse(release);
    expect(result.success).toBe(false);
  });
});

describe("AttributionActivePointer (10620)", () => {
  const testId = "00000000-0000-4000-8000-000000000001";
  const testAppId = "00000000-0000-4000-8000-000000000002";
  const testTenantId = "00000000-0000-4000-8000-000000000003";
  const testTimestamp = "2026-08-04T12:00:00.000Z";

  it("validates a complete active pointer", () => {
    const pointer = {
      id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      pointer_type: "OWNER_MAP",
      active_id: testId,
      status: "ACTIVE",
      version: 1,
      created_at: testTimestamp,
      updated_at: testTimestamp,
    };
    const result = attributionActivePointerSchema.safeParse(pointer);
    expect(result.success).toBe(true);
  });

  it("validates all pointer types", () => {
    for (const pointerType of ["OWNER_MAP", "POLICY", "SIGNER_ASSIGNMENT", "VERIFICATION_KEY"]) {
      const pointer = {
        id: testId,
        app_id: testAppId,
        tenant_id: testTenantId,
        environment: "development",
        pointer_type: pointerType,
        active_id: testId,
        status: "ACTIVE",
        version: 1,
        created_at: testTimestamp,
        updated_at: testTimestamp,
      };
      const result = attributionActivePointerSchema.safeParse(pointer);
      expect(result.success).toBe(true);
    }
  });

  it("rejects unknown pointer type", () => {
    const pointer = {
      id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      pointer_type: "UNKNOWN_TYPE",
      active_id: testId,
      status: "ACTIVE",
      version: 1,
      created_at: testTimestamp,
      updated_at: testTimestamp,
    };
    const result = attributionActivePointerSchema.safeParse(pointer);
    expect(result.success).toBe(false);
  });
});

describe("ConclusionPolicyRelease (10620)", () => {
  const testId = "00000000-0000-4000-8000-000000000001";
  const testAppId = "00000000-0000-4000-8000-000000000002";
  const testTenantId = "00000000-0000-4000-8000-000000000003";
  const testTimestamp = "2026-08-04T12:00:00.000Z";

  it("validates a complete conclusion policy release", () => {
    const release = {
      id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      policy_id: testId,
      policy: {
        algorithm_policy: {
          allowed_algorithms: ["ECDSA", "RSA"],
          min_key_length: 2048,
          hash_algorithm: "SHA256",
        },
        signer_requirements: {
          min_signers: 1,
          allowed_signer_roles: ["A6-verifier"],
          require_physical_presence: false,
          signature_ttl_seconds: 3600,
        },
        verification_constraints: {
          allow_trust_root_only: false,
          required_trust_chain_depth: 0,
          verify_against_revocation_list: true,
        },
      },
      status: "ACTIVE",
      created_at: testTimestamp,
    };
    const result = conclusionPolicyReleaseSchema.safeParse(release);
    expect(result.success).toBe(true);
  });

  it("rejects policy with empty allowed algorithms", () => {
    const release = {
      id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      policy_id: testId,
      policy: {
        algorithm_policy: {
          allowed_algorithms: [],
          min_key_length: 2048,
          hash_algorithm: "SHA256",
        },
        signer_requirements: {
          min_signers: 1,
          allowed_signer_roles: ["A6-verifier"],
        },
        verification_constraints: {
          allow_trust_root_only: false,
          required_trust_chain_depth: 0,
          verify_against_revocation_list: true,
        },
      },
      status: "ACTIVE",
      created_at: testTimestamp,
    };
    const result = conclusionPolicyReleaseSchema.safeParse(release);
    expect(result.success).toBe(false);
  });
});

describe("SignerAssignment (10620)", () => {
  const testId = "00000000-0000-4000-8000-000000000001";
  const testAppId = "00000000-0000-4000-8000-000000000002";
  const testTenantId = "00000000-0000-4000-8000-000000000003";
  const testTimestamp = "2026-08-04T12:00:00.000Z";

  it("validates a complete signer assignment", () => {
    const assignment = {
      id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      assignment_id: testId,
      policy_id: testId,
      signer_role: "A6-verifier",
      required_signers: 2,
      proof_verifier_roles: ["A6-verifier"],
      status: "ACTIVE",
      created_at: testTimestamp,
    };
    const result = signerAssignmentSchema.safeParse(assignment);
    expect(result.success).toBe(true);
  });

  it("validates signer assignment with delegation config", () => {
    const assignment = {
      id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      assignment_id: testId,
      policy_id: testId,
      signer_role: "A2-domain-owner",
      required_signers: 1,
      delegation_config: {
        allow_subdelegation: true,
        max_delegation_depth: 3,
        delegation_ttl_seconds: 7200,
      },
      status: "ACTIVE",
      created_at: testTimestamp,
    };
    const result = signerAssignmentSchema.safeParse(assignment);
    expect(result.success).toBe(true);
  });
});

describe("VerificationKeyRevision (10620)", () => {
  const testId = "00000000-0000-4000-8000-000000000001";
  const testAppId = "00000000-0000-4000-8000-000000000002";
  const testTenantId = "00000000-0000-4000-8000-000000000003";
  const testTimestamp = "2026-08-04T12:00:00.000Z";

  it("validates a complete verification key revision", () => {
    const revision = {
      id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      key_id: testId,
      key_algorithm: "ECDSA",
      public_key: "04c0ffee...",
      trust_root: false,
      status: "ACTIVE",
      created_at: testTimestamp,
    };
    const result = verificationKeyRevisionSchema.safeParse(revision);
    expect(result.success).toBe(true);
  });

  it("validates trust root key revision", () => {
    const revision = {
      id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      key_id: testId,
      key_algorithm: "RSA",
      public_key: "3082...",
      trust_root: true,
      status: "ACTIVE",
      created_at: testTimestamp,
    };
    const result = verificationKeyRevisionSchema.safeParse(revision);
    expect(result.success).toBe(true);
  });

  it("rejects invalid key status", () => {
    const revision = {
      id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      key_id: testId,
      key_algorithm: "ECDSA",
      public_key: "04c0ffee...",
      trust_root: false,
      status: "INVALID",
      created_at: testTimestamp,
    };
    const result = verificationKeyRevisionSchema.safeParse(revision);
    expect(result.success).toBe(false);
  });
});

describe("RelationshipPromotionReceipt (10620)", () => {
  const testId = "00000000-0000-4000-8000-000000000001";
  const testAppId = "00000000-0000-4000-8000-000000000002";
  const testTenantId = "00000000-0000-4000-8000-000000000003";
  const testTimestamp = "2026-08-04T12:00:00.000Z";

  it("validates a committed relationship promotion receipt", () => {
    const receipt = {
      id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      receipt_id: testId,
      source_release_id: testId,
      target_release_id: testId,
      promotion_type: "PROMOTE",
      status: "COMMITTED",
      created_at: testTimestamp,
    };
    const result = relationshipPromotionReceiptSchema.safeParse(receipt);
    expect(result.success).toBe(true);
  });

  it("validates a verified relationship promotion receipt", () => {
    const receipt = {
      id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      receipt_id: testId,
      source_release_id: testId,
      target_release_id: testId,
      promotion_type: "PROMOTE",
      status: "VERIFIED",
      created_at: testTimestamp,
      verified_at: testTimestamp,
    };
    const result = relationshipPromotionReceiptSchema.safeParse(receipt);
    expect(result.success).toBe(true);
  });

  it("validates all promotion types", () => {
    for (const promoType of ["PROMOTE", "DEMOTE", "RECONCILE"]) {
      const receipt = {
        id: testId,
        app_id: testAppId,
        tenant_id: testTenantId,
        environment: "development",
        receipt_id: testId,
        source_release_id: testId,
        target_release_id: testId,
        promotion_type: promoType,
        status: "COMMITTED",
        created_at: testTimestamp,
      };
      const result = relationshipPromotionReceiptSchema.safeParse(receipt);
      expect(result.success).toBe(true);
    }
  });
});

describe("NonceLedgerEntry (10620)", () => {
  const testId = "00000000-0000-4000-8000-000000000001";
  const testAppId = "00000000-0000-4000-8000-000000000002";
  const testTenantId = "00000000-0000-4000-8000-000000000003";
  const testTimestamp = "2026-08-04T12:00:00.000Z";

  it("validates a complete nonce ledger entry", () => {
    const entry = {
      id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      nonce: "nonce-abc-123",
      purpose: "conclusion-signing",
      consumed_at: testTimestamp,
      expires_at: testTimestamp,
    };
    const result = nonceLedgerEntrySchema.safeParse(entry);
    expect(result.success).toBe(true);
  });

  it("validates nonce with origin", () => {
    const entry = {
      id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      nonce: "nonce-xyz-789",
      purpose: "owner-map-publish",
      consumed_at: testTimestamp,
      expires_at: testTimestamp,
      origin: "api-server-01",
    };
    const result = nonceLedgerEntrySchema.safeParse(entry);
    expect(result.success).toBe(true);
  });
});

describe("ConclusionSubjectManifest (10620)", () => {
  const testId = "00000000-0000-4000-8000-000000000001";
  const testHash = "sha256:abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234";
  const testTimestamp = "2026-08-04T12:00:00.000Z";

  it("validates a complete conclusion subject manifest", () => {
    const manifest = {
      subject_id: "contribution-001",
      subject_type: "CONTRIBUTION",
      subject_version: "1.0.0",
      subject_hash: testHash,
      reference_chain: [
        {
          ref_type: "truth_contract",
          ref_id: testId,
          ref_hash: testHash,
        },
      ],
    };
    const result = conclusionSubjectManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });

  it("validates all subject types", () => {
    for (const subjectType of ["CONTRIBUTION", "ENDPOINT", "PROFILE", "EVIDENCE", "AGGREGATE"]) {
      const manifest = {
        subject_id: "test-001",
        subject_type: subjectType,
        subject_version: "1.0.0",
        subject_hash: testHash,
        reference_chain: [],
      };
      const result = conclusionSubjectManifestSchema.safeParse(manifest);
      expect(result.success).toBe(true);
    }
  });
});

describe("ConclusionReceiptSubject (10620)", () => {
  const testId = "00000000-0000-4000-8000-000000000001";
  const testHash = "sha256:abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234";
  const testTimestamp = "2026-08-04T12:00:00.000Z";

  it("validates an approved conclusion receipt subject", () => {
    const receipt = {
      receipt_id: testId,
      subject_manifest: {
        subject_id: "contribution-001",
        subject_type: "CONTRIBUTION",
        subject_version: "1.0.0",
        subject_hash: testHash,
        reference_chain: [],
      },
      conclusion_verdict: "APPROVED",
      conclusion_reason: "All checks passed",
      concluded_by: "A6-verifier-01",
      concluded_at: testTimestamp,
    };
    const result = conclusionReceiptSubjectSchema.safeParse(receipt);
    expect(result.success).toBe(true);
  });

  it("validates all conclusion verdicts", () => {
    for (const verdict of ["APPROVED", "REJECTED", "ABSTAINED", "ESCALATED"]) {
      const receipt = {
        receipt_id: testId,
        subject_manifest: {
          subject_id: "test-001",
          subject_type: "CONTRIBUTION",
          subject_version: "1.0.0",
          subject_hash: testHash,
          reference_chain: [],
        },
        conclusion_verdict: verdict,
        conclusion_reason: `Reason for ${verdict}`,
        concluded_by: "A6-verifier-01",
        concluded_at: testTimestamp,
      };
      const result = conclusionReceiptSubjectSchema.safeParse(receipt);
      expect(result.success).toBe(true);
    }
  });
});

describe("ConclusionSignatureAuthority (10620)", () => {
  const testId = "00000000-0000-4000-8000-000000000001";
  const testTimestamp = "2026-08-04T12:00:00.000Z";

  it("validates a primary signature authority", () => {
    const authority = {
      authority_id: testId,
      authority_name: "primary-conclusion-authority",
      authority_public_key: "04c0ffee...",
      key_algorithm: "ECDSA",
      authority_role: "PRIMARY",
      is_active: true,
      registered_at: testTimestamp,
      issued_conclusions: 42,
    };
    const result = conclusionSignatureAuthoritySchema.safeParse(authority);
    expect(result.success).toBe(true);
  });

  it("validates all authority roles", () => {
    for (const role of ["PRIMARY", "BACKUP", "WITNESS"]) {
      const authority = {
        authority_id: testId,
        authority_name: `${role.toLowerCase()}-authority`,
        authority_public_key: "3082...",
        key_algorithm: "RSA",
        authority_role: role,
        is_active: true,
        registered_at: testTimestamp,
        issued_conclusions: 0,
      };
      const result = conclusionSignatureAuthoritySchema.safeParse(authority);
      expect(result.success).toBe(true);
    }
  });
});

// ─── U13.2 Published F9 Type Tests ───────────────────────────────────────────

describe("PublishedAttributionSafetyVerdict (U13.2)", () => {
  const testId = "00000000-0000-4000-8000-000000000001";
  const testAppId = "00000000-0000-4000-8000-000000000002";
  const testTenantId = "00000000-0000-4000-8000-000000000003";
  const testHash = "sha256:abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234";
  const testTimestamp = "2026-08-04T12:00:00.000Z";

  it("validates a GO safety verdict", () => {
    const verdict = {
      verdict_id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      run_id: testId,
      evidence_id: testId,
      verdict: "GO",
      verdict_reason: "All safety checks passed",
      verdict_dimensions: [
        {
          dimension_name: "data_quality",
          dimension_result: "PASS",
          dimension_details: "All data quality checks passed",
          dimension_score: 0.95,
        },
        {
          dimension_name: "model_convergence",
          dimension_result: "PASS",
          dimension_score: 0.88,
        },
      ],
      determined_by: "attribution-release-candidate-evaluator",
      determined_at: testTimestamp,
      evidence_hash: testHash,
      auto_approve: false,
      ttl_seconds: 3600,
    };
    const result = publishedAttributionSafetyVerdictSchema.safeParse(verdict);
    expect(result.success).toBe(true);
  });

  it("validates a HOLD safety verdict", () => {
    const verdict = {
      verdict_id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      run_id: testId,
      evidence_id: testId,
      verdict: "HOLD",
      verdict_reason: "Data quality checks failed",
      verdict_dimensions: [
        {
          dimension_name: "data_quality",
          dimension_result: "FAIL",
          dimension_details: "Missing required fields",
          dimension_score: 0.45,
        },
      ],
      determined_by: "attribution-release-candidate-evaluator",
      determined_at: testTimestamp,
      evidence_hash: testHash,
      ttl_seconds: 3600,
    };
    const result = publishedAttributionSafetyVerdictSchema.safeParse(verdict);
    expect(result.success).toBe(true);
  });

  it("validates a STOP safety verdict", () => {
    const verdict = {
      verdict_id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      run_id: testId,
      evidence_id: testId,
      verdict: "STOP",
      verdict_reason: "Critical safety violation detected",
      verdict_dimensions: [
        {
          dimension_name: "security",
          dimension_result: "FAIL",
          dimension_details: "Unauthorized access pattern detected",
        },
      ],
      determined_by: "attribution-release-candidate-evaluator",
      determined_at: testTimestamp,
      evidence_hash: testHash,
      ttl_seconds: 3600,
    };
    const result = publishedAttributionSafetyVerdictSchema.safeParse(verdict);
    expect(result.success).toBe(true);
  });

  it("rejects invalid verdict value", () => {
    const verdict = {
      verdict_id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      run_id: testId,
      evidence_id: testId,
      verdict: "INVALID",
      verdict_reason: "Test",
      verdict_dimensions: [],
      determined_by: "test",
      determined_at: testTimestamp,
      evidence_hash: testHash,
      ttl_seconds: 3600,
    };
    const result = publishedAttributionSafetyVerdictSchema.safeParse(verdict);
    expect(result.success).toBe(false);
  });

  it("validates all dimension results", () => {
    for (const dr of ["PASS", "WARN", "FAIL", "SKIP"]) {
      const verdict = {
        verdict_id: testId,
        app_id: testAppId,
        tenant_id: testTenantId,
        environment: "development",
        run_id: testId,
        evidence_id: testId,
        verdict: "GO",
        verdict_reason: "Test",
        verdict_dimensions: [
          {
            dimension_name: "test",
            dimension_result: dr,
          },
        ],
        determined_by: "test",
        determined_at: testTimestamp,
        evidence_hash: testHash,
        ttl_seconds: 3600,
      };
      const result = publishedAttributionSafetyVerdictSchema.safeParse(verdict);
      expect(result.success).toBe(true);
    }
  });
});

describe("AttributionCapabilityDirectory (U13.2)", () => {
  const testId = "00000000-0000-4000-8000-000000000001";
  const testAppId = "00000000-0000-4000-8000-000000000002";
  const testTenantId = "00000000-0000-4000-8000-000000000003";
  const testHash = "sha256:abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234";
  const testTimestamp = "2026-08-04T12:00:00.000Z";

  it("validates a complete capability directory", () => {
    const directory = {
      directory_id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      capabilities: [
        {
          capability_id: testId,
          capability_name: "owner-map-review",
          capability_type: "OWNER_MAP",
          is_available: true,
          min_required_role: "A2-domain-owner",
          version: "1.0.0",
          description: "Review owner map entries",
        },
        {
          capability_id: testId,
          capability_name: "conclusion-signing",
          capability_type: "CONCLUSION_AUTHORITY",
          is_available: true,
          min_required_role: "A6-verifier",
          version: "1.0.0",
          anti_enumeration_hash: testHash,
        },
      ],
      published_at: testTimestamp,
      directory_hash: testHash,
    };
    const result = attributionCapabilityDirectorySchema.safeParse(directory);
    expect(result.success).toBe(true);
  });

  it("validates all capability types", () => {
    const types = [
      "OWNER_MAP",
      "RELATIONSHIP_PROMOTION",
      "CONCLUSION_POLICY",
      "SIGNER_ASSIGNMENT",
      "VERIFICATION_KEY",
      "NONCE_LEDGER",
      "ACTIVE_POINTER",
      "EVIDENCE_KERNEL",
      "PROFILE_PROJECTION",
      "CONCLUSION_AUTHORITY",
      "ELIGIBILITY",
    ];
    for (const capType of types) {
      const directory = {
        directory_id: testId,
        app_id: testAppId,
        tenant_id: testTenantId,
        environment: "development",
        capabilities: [
          {
            capability_id: testId,
            capability_name: `${capType.toLowerCase()}-capability`,
            capability_type: capType,
            is_available: false,
            min_required_role: "A6-verifier",
            version: "1.0.0",
          },
        ],
        published_at: testTimestamp,
        directory_hash: testHash,
      };
      const result = attributionCapabilityDirectorySchema.safeParse(directory);
      expect(result.success).toBe(true);
    }
  });

  it("rejects unknown capability type", () => {
    const directory = {
      directory_id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      capabilities: [
        {
          capability_id: testId,
          capability_name: "unknown",
          capability_type: "UNKNOWN",
          is_available: true,
          min_required_role: "admin",
          version: "1.0.0",
        },
      ],
      published_at: testTimestamp,
      directory_hash: testHash,
    };
    const result = attributionCapabilityDirectorySchema.safeParse(directory);
    expect(result.success).toBe(false);
  });
});

describe("AttributionEligibilityDecision (U13.2)", () => {
  const testId = "00000000-0000-4000-8000-000000000001";
  const testAppId = "00000000-0000-4000-8000-000000000002";
  const testTenantId = "00000000-0000-4000-8000-000000000003";
  const testHash = "sha256:abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234";
  const testTimestamp = "2026-08-04T12:00:00.000Z";

  it("validates an ELIGIBLE decision", () => {
    const decision = {
      decision_id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      request_id: testId,
      subject_id: "retail-revenue-v1",
      eligibility_criteria: [
        {
          criterion_id: "profile-available",
          criterion_name: "Profile Available",
          is_satisfied: true,
          reason: "Profile exists and is current",
        },
        {
          criterion_id: "principal-authorized",
          criterion_name: "Principal Authorized",
          is_satisfied: true,
        },
      ],
      overall_eligible: true,
      decision: "ELIGIBLE",
      decided_by: "attribution-eligibility-service",
      decided_at: testTimestamp,
      frozen_question_hash: testHash,
    };
    const result = attributionEligibilityDecisionSchema.safeParse(decision);
    expect(result.success).toBe(true);
  });

  it("validates all decision values", () => {
    for (const d of ["ELIGIBLE", "INELIGIBLE", "DEFERRED"]) {
      const decision = {
        decision_id: testId,
        app_id: testAppId,
        tenant_id: testTenantId,
        environment: "development",
        request_id: testId,
        subject_id: "test-subject",
        eligibility_criteria: [
          {
            criterion_id: "test-criterion",
            criterion_name: "Test",
            is_satisfied: d === "ELIGIBLE",
          },
        ],
        overall_eligible: d === "ELIGIBLE",
        decision: d,
        decided_by: "test",
        decided_at: testTimestamp,
        frozen_question_hash: testHash,
      };
      const result = attributionEligibilityDecisionSchema.safeParse(decision);
      expect(result.success).toBe(true);
    }
  });

  it("validates eligibility with optional expires_at", () => {
    const decision = {
      decision_id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      request_id: testId,
      subject_id: "retail-revenue-v1",
      eligibility_criteria: [],
      overall_eligible: true,
      decision: "ELIGIBLE",
      decided_by: "test",
      decided_at: testTimestamp,
      expires_at: testTimestamp,
      frozen_question_hash: testHash,
    };
    const result = attributionEligibilityDecisionSchema.safeParse(decision);
    expect(result.success).toBe(true);
  });

  it("rejects invalid decision value", () => {
    const decision = {
      decision_id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      request_id: testId,
      subject_id: "test",
      eligibility_criteria: [],
      overall_eligible: false,
      decision: "INVALID",
      decided_by: "test",
      decided_at: testTimestamp,
      frozen_question_hash: testHash,
    };
    const result = attributionEligibilityDecisionSchema.safeParse(decision);
    expect(result.success).toBe(false);
  });
});

describe("AttributionProfileProjection (U13.2)", () => {
  const testId = "00000000-0000-4000-8000-000000000001";
  const testAppId = "00000000-0000-4000-8000-000000000002";
  const testTenantId = "00000000-0000-4000-8000-000000000003";
  const testHash = "sha256:abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234";
  const testTimestamp = "2026-08-04T12:00:00.000Z";

  it("validates a complete profile projection", () => {
    const projection = {
      id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      profile_id: testId,
      source_release_id: testId,
      profile_name: "retail-revenue-profile-v1",
      profile_version: "1.0.0",
      lowering_rule_set: {
        rule_id: testId,
        lowering_strategy: "STRICT",
        allowed_endpoint_patterns: ["/api/v1/revenue/*"],
        default_lowering_depth: 0,
      },
      contribution_endpoints: [
        {
          endpoint_id: testId,
          endpoint_url: "/api/v1/revenue/summary",
          endpoint_type: "REST",
        },
      ],
      is_active: true,
      created_at: testTimestamp,
      updated_at: testTimestamp,
    };
    const result = attributionProfileProjectionSchema.safeParse(projection);
    expect(result.success).toBe(true);
  });

  it("validates profile with lowering certificate", () => {
    const projection = {
      id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      profile_id: testId,
      source_release_id: testId,
      profile_name: "retail-revenue-profile-v2",
      profile_version: "2.0.0",
      lowering_rule_set: {
        rule_id: testId,
        lowering_strategy: "PERMISSIVE",
        allowed_endpoint_patterns: ["/api/v1/*"],
        denied_endpoint_patterns: ["/api/v1/admin/*"],
        default_lowering_depth: 1,
        custom_rules: [
          {
            source_pattern: "/api/v1/revenue/*",
            target_pattern: "/api/v1/revenue/summary",
            preserve_headers: ["x-request-id"],
          },
        ],
      },
      contribution_endpoints: [
        {
          endpoint_id: testId,
          endpoint_url: "/api/v1/revenue/summary",
          endpoint_type: "REST",
          lowering_certificate: {
            certificate_id: testId,
            rule_set_hash: testHash,
            canonical_ast_hash: testHash,
            query_contract_hash: testHash,
            grounding_package_hash: testHash,
            logical_plan_hash: testHash,
            sql_artifact_hash: testHash,
            parameter_hash: testHash,
            evidence_hash: testHash,
            lowering_chain: [
              { step: "parse", input_hash: testHash, output_hash: testHash },
              { step: "lower", input_hash: testHash, output_hash: testHash },
            ],
            original_endpoint: "/api/v1/revenue/details",
            lowered_endpoint: "/api/v1/revenue/summary",
            certified_by: "lowering-service",
            certified_at: testTimestamp,
          },
        },
      ],
      is_active: true,
      created_at: testTimestamp,
      updated_at: testTimestamp,
    };
    const result = attributionProfileProjectionSchema.safeParse(projection);
    expect(result.success).toBe(true);
  });

  it("validates all lowering strategies", () => {
    for (const strategy of ["STRICT", "PERMISSIVE", "CUSTOM"]) {
      const projection = {
        id: testId,
        app_id: testAppId,
        tenant_id: testTenantId,
        environment: "development",
        profile_id: testId,
        source_release_id: testId,
        profile_name: "test-profile",
        profile_version: "1.0.0",
        lowering_rule_set: {
          rule_id: testId,
          lowering_strategy: strategy,
          allowed_endpoint_patterns: ["/test/*"],
          default_lowering_depth: 0,
        },
        contribution_endpoints: [],
        is_active: true,
        created_at: testTimestamp,
        updated_at: testTimestamp,
      };
      const result = attributionProfileProjectionSchema.safeParse(projection);
      expect(result.success).toBe(true);
    }
  });

  it("validates all endpoint types", () => {
    for (const ept of ["REST", "RPC", "EVENT", "STREAM"]) {
      const projection = {
        id: testId,
        app_id: testAppId,
        tenant_id: testTenantId,
        environment: "development",
        profile_id: testId,
        source_release_id: testId,
        profile_name: "test-profile",
        profile_version: "1.0.0",
        lowering_rule_set: {
          rule_id: testId,
          lowering_strategy: "STRICT",
          allowed_endpoint_patterns: ["/test/*"],
          default_lowering_depth: 0,
        },
        contribution_endpoints: [
          {
            endpoint_id: testId,
            endpoint_url: "/test/endpoint",
            endpoint_type: ept,
          },
        ],
        is_active: true,
        created_at: testTimestamp,
        updated_at: testTimestamp,
      };
      const result = attributionProfileProjectionSchema.safeParse(projection);
      expect(result.success).toBe(true);
    }
  });
});

describe("AttributionProfileRequest (U13.2)", () => {
  const testId = "00000000-0000-4000-8000-000000000001";
  const testAppId = "00000000-0000-4000-8000-000000000002";
  const testTenantId = "00000000-0000-4000-8000-000000000003";
  const testHash = "sha256:abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234";
  const testTimestamp = "2026-08-04T12:00:00.000Z";

  it("validates a DRAFT profile request", () => {
    const request = {
      id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      request_id: testId,
      subject_id: "retail-revenue-v1",
      requester: "user-001",
      request_type: "PROFILE_ACCESS",
      status: "DRAFT",
      created_at: testTimestamp,
      updated_at: testTimestamp,
    };
    const result = attributionProfileRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
  });

  it("validates SUBMITTED profile request", () => {
    const request = {
      id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      request_id: testId,
      subject_id: "retail-revenue-v1",
      requester: "user-001",
      request_type: "PROFILE_ACCESS",
      status: "SUBMITTED",
      request_reason: "Need profile for attribution analysis",
      created_at: testTimestamp,
      updated_at: testTimestamp,
    };
    const result = attributionProfileRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
  });

  it("validates all profile request statuses", () => {
    const statuses = [
      "DRAFT",
      "SUBMITTED",
      "DEDUPED",
      "TRIAGED",
      "LINKED",
      "DECLINED",
      "CLOSED",
      "EXPIRED",
      "WITHDRAWN",
    ];
    for (const status of statuses) {
      const request = {
        id: testId,
        app_id: testAppId,
        tenant_id: testTenantId,
        environment: "development",
        request_id: testId,
        subject_id: "retail-revenue-v1",
        requester: "user-001",
        request_type: "PROFILE_ACCESS",
        status,
        created_at: testTimestamp,
        updated_at: testTimestamp,
      };
      const result = attributionProfileRequestSchema.safeParse(request);
      expect(result.success).toBe(true);
    }
  });

  it("rejects invalid profile request status", () => {
    const request = {
      id: testId,
      app_id: testAppId,
      tenant_id: testTenantId,
      environment: "development",
      request_id: testId,
      subject_id: "retail-revenue-v1",
      requester: "user-001",
      request_type: "PROFILE_ACCESS",
      status: "INVALID",
      created_at: testTimestamp,
      updated_at: testTimestamp,
    };
    const result = attributionProfileRequestSchema.safeParse(request);
    expect(result.success).toBe(false);
  });
});
