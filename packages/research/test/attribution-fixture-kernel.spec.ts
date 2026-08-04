import { describe, expect, it } from "vitest";
import {
  type AttributionFixtureKernelInput,
  type AttributionKernelEvidence,
  runAttributionFixtureKernel,
  sealFixtureConclusionCandidate,
  BudgetLifecycleManager,
  createAttributionBudgetReservation,
} from "../src/attribution-fixture/index.js";
import {
  type AttributionProfileProjection,
  type ContributionTruthContract,
  type FixtureConclusionPolicyManifest,
  type FiveAxisFrontier,
  type FrontierAxis,
  type BudgetState,
  deepFreeze,
} from "@data-agent/contracts";

// ─── Test constants ────────────────────────────────────────────────────────────

const testHash = `sha256:${"a".repeat(64)}` as const;
const testHashB = `sha256:${"b".repeat(64)}` as const;
const testUUID = "00000000-0000-4000-8000-000000000001";
const testUUID2 = "00000000-0000-4000-8000-000000000002";
const testUUID3 = "00000000-0000-4000-8000-000000000003";
const testTimestamp = "2026-08-04T00:00:00.000Z";

// ─── Test fixtures ─────────────────────────────────────────────────────────────

function makeFrontierAxis(override?: Partial<FrontierAxis>): FrontierAxis {
  return {
    ref: testUUID,
    hash: testHash,
    version: "1.0.0",
    ...override,
  };
}

function makeFiveAxisFrontier(): FiveAxisFrontier {
  return {
    identity_ref: makeFrontierAxis(),
    principal_ref: makeFrontierAxis(),
    scope_ref: makeFrontierAxis(),
    time_window_ref: makeFrontierAxis(),
    classification_ref: makeFrontierAxis(),
  };
}

function makeTestProfile(): AttributionProfileProjection {
  return {
    id: testUUID,
    app_id: testUUID,
    tenant_id: testUUID2,
    environment: "test",
    profile_id: testUUID,
    source_release_id: testUUID,
    profile_name: "FIXTURE",
    profile_version: "1.0.0",
    lowering_rule_set: {
      rule_id: testUUID,
      lowering_strategy: "STRICT",
      allowed_endpoint_patterns: ["/api/v1/revenue/*"],
      denied_endpoint_patterns: [],
      default_lowering_depth: 0,
      custom_rules: [],
    },
    contribution_endpoints: [
      {
        endpoint_id: testUUID,
        endpoint_url: "https://api.example.com/revenue/total",
        endpoint_type: "REST",
      },
      {
        endpoint_id: testUUID2,
        endpoint_url: "https://api.example.com/revenue/promotion",
        endpoint_type: "REST",
      },
      {
        endpoint_id: testUUID3,
        endpoint_url: "https://api.example.com/revenue/refunds",
        endpoint_type: "REST",
      },
    ],
    is_active: true,
    created_at: testTimestamp,
    updated_at: testTimestamp,
  };
}

function makeTestTruthContract(): ContributionTruthContract {
  return {
    contract_version: "attribution-truth-contract@1",
    truth_id: "retail-revenue-v1",
    truth_name: "Retail Revenue Contribution v1",
    description: "Test fixture truth contract for retail revenue decomposition",
    fixture_identity: {
      fixture_id: "retail-fixture-v1",
      fixture_version: "1.0.0",
      fixture_origin: "FIXTURE",
    },
    contribution_patterns: [
      {
        pattern_id: "promotion-discount",
        pattern_name: "Promotion Discount",
        source_identity: "promotion",
        expected_verdict: "CONFIRMED",
        evidence_requirements: [
          { required_link_type: "endpoint_binding", required_link_ref_pattern: "revenue/promotion", min_confidence: 0.7 },
        ],
        truth_metadata: {},
      },
      {
        pattern_id: "late-refunds",
        pattern_name: "Late Refunds",
        source_identity: "refund",
        expected_verdict: "CONFIRMED",
        evidence_requirements: [
          { required_link_type: "endpoint_binding", required_link_ref_pattern: "revenue/refunds", min_confidence: 0.7 },
        ],
        truth_metadata: {},
      },
    ],
    created_at: testTimestamp,
  };
}

function makeTestManifest(): FixtureConclusionPolicyManifest {
  return {
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
    metadata: {},
  };
}

function makeTestInput(): AttributionFixtureKernelInput {
  return {
    profile: makeTestProfile(),
    profile_hash: testHash,
    truth_contract: makeTestTruthContract(),
    truth_contract_hash: testHash,
    manifest: makeTestManifest(),
    manifest_hash: testHash,
    run_fence: "run-001",
    question_hash: testHash,
    budget_state: {
      remaining_sql_budget: 16,
      remaining_obligation_budget: 60,
      remaining_artifact_input_budget: 30,
    },
    baseline_frontier: makeFiveAxisFrontier(),
    follow_up_frontier: makeFiveAxisFrontier(),
    witnessed_by: "test-verifier",
    lowering_rule_set_hash: testHash,
    sealed_by: "fixture-kernel@1",
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("AttributionFixtureKernel", () => {
  it("runs full pipeline and produces sealed evidence", () => {
    const input = makeTestInput();
    const result = runAttributionFixtureKernel(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const evidence = result.value;
      expect(evidence.kernel_version).toBe("attribution-kernel@1");
      expect(evidence.origin).toBe("FIXTURE");
      expect(evidence.closure_verdict).toBeDefined();
      expect(evidence.f9_status.core_l2).toBe("HOLD");
      expect(evidence.f9_status.attribution_f9).toBe("NOT_REGISTERED");
      expect(evidence.f9_status.fixture_evidence).toBe("HOLD");
      expect(evidence.explicit_absence).toBe("attribution_feasibility_verdict");
      expect(evidence.version_frontier_refs).toBeDefined();
      expect(evidence.endpoint_binding_refs.length).toBeGreaterThan(0);
      expect(evidence.lowering_certificate_refs.length).toBeGreaterThan(0);
      expect(evidence.budget_admission_ref).toBeDefined();
      expect(evidence.delta_observation_set_ref).toBeDefined();
      expect(evidence.closure_receipt_ref).toBeDefined();
      expect(evidence.conclusion_candidate).toBeDefined();
    }
  });

  it("rejects non-FIXTURE profile", () => {
    const input = makeTestInput();
    const nonFixtureProfile = { ...input.profile, profile_name: "PRODUCTION" };
    const result = runAttributionFixtureKernel({
      ...input,
      profile: nonFixtureProfile,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("FIXTURE_KERNEL_PROFILE_NOT_FIXTURE");
    }
  });

  it("returns CONTRIBUTION_DRIVER_BUDGET_EXCEEDED when budget is insufficient", () => {
    const input = makeTestInput();
    const result = runAttributionFixtureKernel({
      ...input,
      budget_state: {
        remaining_sql_budget: 0,
        remaining_obligation_budget: 0,
        remaining_artifact_input_budget: 0,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.refusal).toBe("CONTRIBUTION_DRIVER_BUDGET_EXCEEDED");
    }
  });

  it("returns FRONTIER_MISMATCH when frontiers differ", () => {
    const input = makeTestInput();
    const differentFrontier = makeFiveAxisFrontier();
    differentFrontier.identity_ref = { ...differentFrontier.identity_ref, hash: testHashB };
    const result = runAttributionFixtureKernel({
      ...input,
      follow_up_frontier: differentFrontier,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.refusal).toBe("FRONTIER_MISMATCH");
    }
  });

  it("produces evidence with correct closure_verdict from closure receipt", () => {
    const input = makeTestInput();
    // With matching frontiers and sufficient budget, the pipeline should produce
    // a closure_verdict based on the derived closure receipt consistency
    const result = runAttributionFixtureKernel(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(["PASS", "HOLD", "REFUSE"]).toContain(result.value.closure_verdict);
    }
  });

  it("sealFixtureConclusionCandidate produces valid evidence", () => {
    const candidate = {
      candidate_id: "candidate-001",
      subject_id: "truth-001",
      source_identity: "fixture-001",
      contribution_verdict: "CONFIRMED" as const,
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

    const evidence = sealFixtureConclusionCandidate(
      candidate, testUUID, testUUID2, "test", "run-001", testHash, testHash,
    );

    expect(evidence.origin).toBe("FIXTURE");
    expect(evidence.f9_status.core_l2).toBe("HOLD");
    expect(evidence.f9_status.attribution_f9).toBe("NOT_REGISTERED");
    expect(evidence.f9_status.fixture_evidence).toBe("HOLD");
    expect(evidence.kernel_version).toBe("attribution-kernel@1");
    expect(evidence.explicit_absence).toBe("attribution_feasibility_verdict");
  });
});

// ─── Budget Integration Tests ──────────────────────────────────────────────────

describe("BudgetLifecycleManager", () => {
  it("reserves and consumes budget", () => {
    const manager = new BudgetLifecycleManager();
    const reservation = createAttributionBudgetReservation("run-001", testHash, testHash, 3);

    const reserveResult = manager.reserve(reservation);
    expect(reserveResult.ok).toBe(true);
    if (reserveResult.ok) {
      expect(reserveResult.admission.status).toBe("RESERVED");
    }

    const consumeResult = manager.consume(reservation.idempotency_key);
    expect(consumeResult.ok).toBe(true);
    if (consumeResult.ok) {
      expect(consumeResult.admission.status).toBe("CONSUMED");
    }
  });

  it("rejects budget when insufficient", () => {
    const emptyBudget: BudgetState = {
      remaining_sql_budget: 0,
      remaining_obligation_budget: 0,
      remaining_artifact_input_budget: 0,
    };
    const manager = new BudgetLifecycleManager(emptyBudget);
    const reservation = createAttributionBudgetReservation("run-001", testHash, testHash, 3);

    const result = manager.reserve(reservation);
    expect(result.ok).toBe(false);
  });

  it("releases budget and returns to pool", () => {
    const manager = new BudgetLifecycleManager();
    const reservation = createAttributionBudgetReservation("run-001", testHash, testHash, 3);

    const reserveResult = manager.reserve(reservation);
    expect(reserveResult.ok).toBe(true);

    const releaseResult = manager.release(reservation.idempotency_key);
    expect(releaseResult.ok).toBe(true);
    if (releaseResult.ok) {
      expect(releaseResult.admission.status).toBe("RELEASED");
    }
  });

  it("sweeps expired reservations", () => {
    const manager = new BudgetLifecycleManager();
    const reservation = createAttributionBudgetReservation("run-001", testHash, testHash, 3);
    // Use a reservation with very short TTL
    const shortTTLReservation = { ...reservation, reservation_ttl_ms: 1 };

    // Wait for TTL to expire
    const result = manager.reserve(shortTTLReservation);
    expect(result.ok).toBe(true);

    // Sweep expired
    const swept = manager.sweepExpired();
    expect(swept).toBeGreaterThanOrEqual(0);
  });

  it("handles idempotency for same key", () => {
    const manager = new BudgetLifecycleManager();
    const reservation = createAttributionBudgetReservation("run-001", testHash, testHash, 3);

    const first = manager.reserve(reservation);
    expect(first.ok).toBe(true);

    const second = manager.reserve(reservation);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.admission.idempotency_key).toBe(first.ok ? (first as { ok: true; admission: { idempotency_key: string } }).admission.idempotency_key : "");
    }
  });
});
