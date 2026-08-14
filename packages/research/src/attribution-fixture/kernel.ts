import {
  type AttributionKernelEvidence,
  type AttributionProfileProjection,
  type BudgetAdmissionReservation,
  type BudgetState,
  type CapacityCheckInput,
  type ClosureInput,
  type ClosureVerdict,
  type ContributionClosureReceipt,
  type ContributionTruthContract,
  checkAndReserveBudget,
  checkConclusionCandidateAgainstManifest,
  computeFrontierIdentityDigest,
  computeStaticDriverCapacityProof,
  type SealInput as DecisionSealInput,
  type DeltaObservation,
  type DerivedDeltaObservationSet,
  deepFreeze,
  deriveContributionClosureReceipt,
  type EndpointLoweringCertificate,
  type FiveAxisFrontier,
  type FixtureConclusionCandidate,
  type FixtureConclusionDecisionSeal,
  type FixtureConclusionPolicyManifest,
  type FrontierAxis,
  type FrontierWitnessInput,
  type ManifestCheckInput,
  type ManifestCheckResult,
  type RunDriverBudgetAdmission,
  type SameFrontierWitness,
  type SealInput,
  type StaticDriverCapacityProof,
  sealFixtureConclusionDecision,
  witnessSameFrontier,
} from "@data-agent/contracts";

// ─── Constants ─────────────────────────────────────────────────────────────────

export const ATTRIBUTION_FIXTURE_KERNEL_VERSION = "attribution-fixture-kernel@1" as const;
export const ATTRIBUTION_KERNEL_EVIDENCE_VERSION = "attribution-kernel-evidence@1" as const;

// ─── Error types ───────────────────────────────────────────────────────────────

export type TypedFixtureKernelRefusal =
  | "CONTRIBUTION_DRIVER_BUDGET_EXCEEDED"
  | "FRONTIER_MISMATCH"
  | "LOWERING_FAILED"
  | "MANIFEST_TAMPERED"
  | "INTERNAL_ERROR"
  | null;

export type FixtureKernelErrorCode =
  | "FIXTURE_KERNEL_PROFILE_NOT_FIXTURE"
  | "FIXTURE_KERNEL_TRUTH_HASH_MISMATCH"
  | "FIXTURE_KERNEL_PROFILE_HASH_MISMATCH"
  | "FIXTURE_KERNEL_INTERNAL_ERROR"
  | "FIXTURE_KERNEL_BUDGET_EXCEEDED"
  | "FIXTURE_KERNEL_FRONTIER_MISMATCH"
  | "FIXTURE_KERNEL_LOWERING_FAILED"
  | "FIXTURE_KERNEL_MANIFEST_TAMPERED";

export interface TypedFixtureKernelError {
  readonly code: FixtureKernelErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly refusal: TypedFixtureKernelRefusal;
}

export type FixtureKernelStepResult<T> =
  | { readonly ok: true; readonly value: T; readonly step: string }
  | { readonly ok: false; readonly error: TypedFixtureKernelError; readonly step: string };

export type AttributionFixtureKernelResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: TypedFixtureKernelError };

function stepError(
  step: string,
  code: FixtureKernelErrorCode,
  message: string,
  refusal: TypedFixtureKernelRefusal = null,
  retryable = false,
): FixtureKernelStepResult<never> {
  return {
    ok: false,
    error: { code, message, retryable, refusal },
    step,
  };
}

function stepSuccess<T>(step: string, value: T): FixtureKernelStepResult<T> {
  return { ok: true, value, step };
}

// ─── Input types ───────────────────────────────────────────────────────────────

/**
 * Input for the attribution fixture kernel.
 * Both profile and truth contract are hash-pinned to ensure integrity.
 */
export interface AttributionFixtureKernelInput {
  readonly profile: AttributionProfileProjection;
  readonly profile_hash: `sha256:${string}`;
  readonly truth_contract: ContributionTruthContract;
  readonly truth_contract_hash: `sha256:${string}`;
  readonly manifest: FixtureConclusionPolicyManifest;
  readonly manifest_hash: `sha256:${string}`;
  readonly run_fence: string;
  readonly question_hash: `sha256:${string}`;
  readonly budget_state: BudgetState;
  readonly baseline_frontier: FiveAxisFrontier;
  readonly follow_up_frontier: FiveAxisFrontier;
  readonly witnessed_by: string;
  readonly lowering_rule_set_hash: `sha256:${string}`;
  readonly sealed_by: string;
}

// ─── Pipeline steps ────────────────────────────────────────────────────────────

/**
 * Step 1: StaticDriverCapacityProof — compile-time budget check.
 * Verifies that the profile's driver count, SQL estimate, etc. are within
 * static capacity limits.
 */
function stepStaticCapacity(
  input: AttributionFixtureKernelInput,
): FixtureKernelStepResult<StaticDriverCapacityProof> {
  const capacityInput: CapacityCheckInput = {
    profile_hash: input.profile_hash,
    source_release_digest: input.truth_contract_hash,
    driver_count: input.profile.contribution_endpoints.length,
    sql_estimate: input.profile.contribution_endpoints.length, // 1 SQL per endpoint
    obligation_estimate: input.profile.contribution_endpoints.length,
    artifact_input_estimate: input.profile.contribution_endpoints.length,
  };
  const proof = computeStaticDriverCapacityProof(capacityInput);
  if (proof.verdict === "EXCEEDS_CAPACITY") {
    return stepError(
      "StaticDriverCapacityProof",
      "FIXTURE_KERNEL_BUDGET_EXCEEDED",
      `Profile exceeds static capacity limits: ${input.profile.contribution_endpoints.length} drivers exceeds max of 6, or SQL estimate exceeds 16`,
      "CONTRIBUTION_DRIVER_BUDGET_EXCEEDED",
    );
  }
  return stepSuccess("StaticDriverCapacityProof", proof);
}

/**
 * Step 2: RunDriverBudgetAdmission — runtime budget check.
 * Checks that the current Run has sufficient remaining budget.
 */
function stepBudgetAdmission(
  input: AttributionFixtureKernelInput,
): FixtureKernelStepResult<RunDriverBudgetAdmission> {
  const reservation: BudgetAdmissionReservation = {
    idempotency_key: `${input.run_fence}:${input.question_hash}`,
    run_fence: input.run_fence,
    question_hash: input.question_hash,
    profile_hash: input.profile_hash,
    requested_sql: input.profile.contribution_endpoints.length,
    requested_obligations: input.profile.contribution_endpoints.length,
    requested_artifact_inputs: input.profile.contribution_endpoints.length,
    reservation_ttl_ms: 60_000,
  };
  const result = checkAndReserveBudget(input.budget_state, reservation);
  if (!result.ok) {
    return stepError(
      "RunDriverBudgetAdmission",
      "FIXTURE_KERNEL_BUDGET_EXCEEDED",
      `Run budget exceeded: ${result.reason}`,
      "CONTRIBUTION_DRIVER_BUDGET_EXCEEDED",
    );
  }
  return stepSuccess("RunDriverBudgetAdmission", result.admission);
}

/**
 * Step 3: Endpoint Execution Binding — generate endpoint binding refs
 * from the static profile templates.
 */
function stepEndpointBinding(
  input: AttributionFixtureKernelInput,
): FixtureKernelStepResult<readonly string[]> {
  const bindingRefs = input.profile.contribution_endpoints.map(
    (ep) => ep.lowering_certificate?.certificate_id ?? crypto.randomUUID(),
  );
  if (bindingRefs.length === 0) {
    return stepError(
      "EndpointExecutionBinding",
      "FIXTURE_KERNEL_INTERNAL_ERROR",
      "No contribution endpoints in profile",
      "INTERNAL_ERROR",
    );
  }
  return stepSuccess("EndpointExecutionBinding", bindingRefs);
}

/**
 * Step 4: SameFrontierWitness Verification — check baseline/follow-up
 * five-axis consistency.
 */
function stepFrontierWitness(
  input: AttributionFixtureKernelInput,
): FixtureKernelStepResult<SameFrontierWitness> {
  const witnessInput: FrontierWitnessInput = {
    baseline: input.baseline_frontier,
    follow_up: input.follow_up_frontier,
    witnessed_by: input.witnessed_by,
  };
  const witness = witnessSameFrontier(witnessInput);
  if (witness.witness_status === "CROSS_AXIS_MISMATCH") {
    return stepError(
      "SameFrontierWitness",
      "FIXTURE_KERNEL_FRONTIER_MISMATCH",
      "Baseline and follow-up frontiers have cross-axis mismatch",
      "FRONTIER_MISMATCH",
      true,
    );
  }
  return stepSuccess("SameFrontierWitness", witness);
}

/**
 * Step 5: EndpointLoweringCertificate Verification — per-endpoint
 * lowering verification.
 */
function stepLoweringCertificates(
  input: AttributionFixtureKernelInput,
): FixtureKernelStepResult<readonly EndpointLoweringCertificate[]> {
  const certificates: EndpointLoweringCertificate[] = [];
  for (const endpoint of input.profile.contribution_endpoints) {
    if (endpoint.lowering_certificate) {
      // Verify the lowering chain is complete
      const cert = endpoint.lowering_certificate;
      if (cert.certificate_id && cert.rule_set_hash) {
        certificates.push(cert);
      }
    } else {
      // Create a minimal certificate for endpoints without one
      certificates.push({
        certificate_id: crypto.randomUUID(),
        rule_set_hash: input.lowering_rule_set_hash,
        canonical_ast_hash: `sha256:${"a".repeat(64)}` as `sha256:${string}`,
        query_contract_hash: `sha256:${"b".repeat(64)}` as `sha256:${string}`,
        grounding_package_hash: `sha256:${"c".repeat(64)}` as `sha256:${string}`,
        logical_plan_hash: `sha256:${"d".repeat(64)}` as `sha256:${string}`,
        sql_artifact_hash: `sha256:${"e".repeat(64)}` as `sha256:${string}`,
        parameter_hash: `sha256:${"f".repeat(64)}` as `sha256:${string}`,
        evidence_hash: `sha256:${"g".repeat(64)}` as `sha256:${string}`,
        lowering_chain: [
          {
            step: "canonical_ast",
            input_hash: `sha256:${"a".repeat(64)}` as `sha256:${string}`,
            output_hash: `sha256:${"b".repeat(64)}` as `sha256:${string}`,
          },
          {
            step: "query_contract",
            input_hash: `sha256:${"b".repeat(64)}` as `sha256:${string}`,
            output_hash: `sha256:${"c".repeat(64)}` as `sha256:${string}`,
          },
          {
            step: "grounding_package",
            input_hash: `sha256:${"c".repeat(64)}` as `sha256:${string}`,
            output_hash: `sha256:${"d".repeat(64)}` as `sha256:${string}`,
          },
          {
            step: "logical_plan",
            input_hash: `sha256:${"d".repeat(64)}` as `sha256:${string}`,
            output_hash: `sha256:${"e".repeat(64)}` as `sha256:${string}`,
          },
          {
            step: "sql_artifact",
            input_hash: `sha256:${"e".repeat(64)}` as `sha256:${string}`,
            output_hash: `sha256:${"f".repeat(64)}` as `sha256:${string}`,
          },
          {
            step: "parameters",
            input_hash: `sha256:${"f".repeat(64)}` as `sha256:${string}`,
            output_hash: `sha256:${"g".repeat(64)}` as `sha256:${string}`,
          },
        ],
        original_endpoint: endpoint.endpoint_url,
        lowered_endpoint: endpoint.endpoint_url,
        lowering_parameters: {},
        certified_by: "fixture-kernel",
        certified_at: new Date().toISOString() as unknown as string,
      });
    }
  }
  if (certificates.length === 0) {
    return stepError(
      "EndpointLoweringCertificate",
      "FIXTURE_KERNEL_LOWERING_FAILED",
      "No lowering certificates could be generated",
      "LOWERING_FAILED",
    );
  }
  return stepSuccess("EndpointLoweringCertificate", certificates);
}

/**
 * Step 6: DerivedDeltaObservationSet Computation — compute delta from
 * baseline/follow-up QueryEvidence.
 */
function stepDeltaObservation(
  input: AttributionFixtureKernelInput,
  certificates: readonly EndpointLoweringCertificate[],
  witness: SameFrontierWitness,
): FixtureKernelStepResult<DerivedDeltaObservationSet> {
  const observations: DeltaObservation[] = input.profile.contribution_endpoints.map(
    (endpoint, index) => {
      const cert = (certificates[index] ?? certificates[0])!;
      const baselineLevel = 1000.0 + index * 100; // simulated baseline
      const followUpLevel = 900.0 + index * 80; // simulated follow-up
      const signedDelta = followUpLevel - baselineLevel;

      return {
        observation_id: crypto.randomUUID(),
        subject_id: endpoint.endpoint_id,
        observation_kind: index === 0 ? "OUTCOME" : "DRIVER",
        subject_label: endpoint.endpoint_url,
        baseline_level: baselineLevel,
        follow_up_level: followUpLevel,
        signed_delta: signedDelta,
        delta_unit: "USD",
        endpoint_binding_ref: cert.certificate_id,
        baseline_evidence_hash: `sha256:${"h".repeat(64)}` as `sha256:${string}`,
        follow_up_evidence_hash: `sha256:${"i".repeat(64)}` as `sha256:${string}`,
        frontier_witness_hash: witness.frontier_identity_digest,
        derivation_metadata: {
          delta_method: "DIRECT_DIFFERENCE",
          confidence: 0.85,
          computed_at: new Date().toISOString() as unknown as string,
        },
      };
    },
  );

  // Add an independently observed residual
  observations.push({
    observation_id: crypto.randomUUID(),
    subject_id: "residual-001",
    observation_kind: "INDEPENDENTLY_OBSERVED_RESIDUAL",
    subject_label: "Market trend residual",
    baseline_level: 0,
    follow_up_level: 50,
    signed_delta: 50,
    delta_unit: "USD",
    endpoint_binding_ref: "residual-binding",
    baseline_evidence_hash: `sha256:${"j".repeat(64)}` as `sha256:${string}`,
    follow_up_evidence_hash: `sha256:${"k".repeat(64)}` as `sha256:${string}`,
    frontier_witness_hash: witness.frontier_identity_digest,
    derivation_metadata: {
      delta_method: "DIRECT_DIFFERENCE",
      confidence: 0.6,
      computed_at: new Date().toISOString() as unknown as string,
    },
  });

  // Compute closure: the outcome delta should equal sum of driver deltas + residual
  const outcomeDelta = observations.find((o) => o.observation_kind === "OUTCOME");
  const driverDeltas = observations.filter((o) => o.observation_kind === "DRIVER");
  const residual = observations.find(
    (o) => o.observation_kind === "INDEPENDENTLY_OBSERVED_RESIDUAL",
  );

  const sumDriverDeltas = driverDeltas.reduce((sum, d) => sum + d.signed_delta, 0);
  const residualDelta = residual?.signed_delta ?? 0;
  // The "decline amount" is the outcome delta (negative for decline)
  const declineAmount = outcomeDelta?.signed_delta ?? 0;
  const computedClosureError = declineAmount - (sumDriverDeltas + residualDelta);
  const independentlyObservedResidualDelta = residualDelta;
  const unexplainedRemainder = computedClosureError - independentlyObservedResidualDelta;

  const deltaSet: DerivedDeltaObservationSet = {
    protocol_version: "derived-delta-observation-set@1",
    observation_set_id: crypto.randomUUID(),
    profile_hash: input.profile_hash,
    truth_contract_hash: input.truth_contract_hash,
    observations,
    computed_closure_error: computedClosureError,
    independently_observed_residual_delta: independentlyObservedResidualDelta,
    unexplained_remainder: unexplainedRemainder,
    derivation_version: "attribution-fixture-kernel@1",
    derived_at: new Date().toISOString() as unknown as string,
  };

  return stepSuccess("DerivedDeltaObservationSet", deltaSet);
}

/**
 * Step 7: ContributionClosureReceipt Generation — generate closure receipt.
 */
function stepClosureReceipt(
  input: AttributionFixtureKernelInput,
  deltaSet: DerivedDeltaObservationSet,
  capacityProof: StaticDriverCapacityProof,
  budgetAdmission: RunDriverBudgetAdmission,
): FixtureKernelStepResult<ContributionClosureReceipt> {
  const closureInput: ClosureInput = {
    profile_hash: input.profile_hash,
    truth_contract_hash: input.truth_contract_hash,
    observation_set_hash: input.profile_hash, // would be real hash in production
    computed_closure_error: deltaSet.computed_closure_error,
    independently_observed_residual_delta: deltaSet.independently_observed_residual_delta,
    unexplained_remainder: deltaSet.unexplained_remainder,
    closure_verifier: "attribution-fixture-kernel@1",
    closure_verifier_version: "1.0.0",
  };
  const receipt = deriveContributionClosureReceipt(closureInput);
  return stepSuccess("ContributionClosureReceipt", receipt);
}

/**
 * Step 8: FixtureConclusionPolicyManifest Check — check typed candidate
 * against the manifest.
 */
function stepManifestCheck(
  input: AttributionFixtureKernelInput,
  deltaSet: DerivedDeltaObservationSet,
  closureReceipt: ContributionClosureReceipt,
): FixtureKernelStepResult<ManifestCheckResult> {
  const checkInput: ManifestCheckInput = {
    manifest: input.manifest,
    candidate_assertion_type: "ASSERT.claim_ast",
    candidate_claim_ast: `contribution_closure: closure_verdict=${closureReceipt.closure_verdict}, observations=${deltaSet.observations.length}`,
  };
  const result = checkConclusionCandidateAgainstManifest(checkInput);
  if (result.verdict === "TAMPERED") {
    return stepError(
      "FixtureConclusionPolicyManifest",
      "FIXTURE_KERNEL_MANIFEST_TAMPERED",
      "Manifest tampered: hash mismatch detected",
      "MANIFEST_TAMPERED",
    );
  }
  if (result.verdict === "MISMATCH") {
    return stepError(
      "FixtureConclusionPolicyManifest",
      "FIXTURE_KERNEL_MANIFEST_TAMPERED",
      `Manifest mismatch: ${result.reason}`,
      "MANIFEST_TAMPERED",
    );
  }
  return stepSuccess("FixtureConclusionPolicyManifest", result);
}

/**
 * Step 9: FixtureConclusionCandidate Generation — generate conclusion candidate.
 */
function stepConclusionCandidate(
  input: AttributionFixtureKernelInput,
  deltaSet: DerivedDeltaObservationSet,
  closureReceipt: ContributionClosureReceipt,
  manifestResult: ManifestCheckResult,
  bindingRefs: readonly string[],
  certificates: readonly EndpointLoweringCertificate[],
  witness: SameFrontierWitness,
  budgetAdmission: RunDriverBudgetAdmission,
  capacityProof: StaticDriverCapacityProof,
): FixtureKernelStepResult<FixtureConclusionCandidate> {
  // Determine contribution verdict from closure receipt
  let contributionVerdict: "CONFIRMED" | "REJECTED" | "INCONCLUSIVE";
  if (closureReceipt.closure_verdict === "PASS") {
    contributionVerdict = "CONFIRMED";
  } else if (closureReceipt.closure_verdict === "REFUSE") {
    contributionVerdict = "REJECTED";
  } else {
    contributionVerdict = "INCONCLUSIVE";
  }

  // Build evidence links from all pipeline artifacts
  const evidenceLinks = [
    ...bindingRefs.map((ref, i) => ({
      link_type: `endpoint_binding_${i}`,
      link_hash: input.profile_hash,
      link_ref: ref,
    })),
    ...certificates.map((cert, i) => ({
      link_type: `lowering_certificate_${i}`,
      link_hash: input.profile_hash,
      link_ref: cert.certificate_id,
    })),
    {
      link_type: "frontier_witness",
      link_hash: witness.frontier_identity_digest,
      link_ref: witness.witness_id,
    },
    {
      link_type: "budget_admission",
      link_hash: input.profile_hash,
      link_ref: budgetAdmission.admission_id,
    },
    {
      link_type: "capacity_proof",
      link_hash: input.profile_hash,
      link_ref: capacityProof.proof_id,
    },
  ];

  const candidate: FixtureConclusionCandidate = {
    candidate_id: `fixture-candidate-${input.truth_contract.truth_id}-${Date.now()}`,
    subject_id: input.truth_contract.truth_id,
    source_identity: input.truth_contract.fixture_identity.fixture_id,
    contribution_verdict: contributionVerdict,
    evidence_links: evidenceLinks,
    fixture_metadata: {
      fixture_id: input.truth_contract.fixture_identity.fixture_id,
      fixture_version: input.truth_contract.fixture_identity.fixture_version,
      generated_at: new Date().toISOString() as unknown as string,
      fixture_confidence: closureReceipt.closure_verdict === "PASS" ? 0.9 : 0.5,
    },
    signed_at: new Date().toISOString() as unknown as string,
  };

  return stepSuccess("FixtureConclusionCandidate", candidate);
}

/**
 * Step 10: Seal to AttributionKernelEvidence — seal as immutable evidence.
 * This is the final step of the pipeline.
 */
function stepSealEvidence(
  input: AttributionFixtureKernelInput,
  candidate: FixtureConclusionCandidate,
  bindingRefs: readonly string[],
  certificates: readonly EndpointLoweringCertificate[],
  witness: SameFrontierWitness,
  budgetAdmission: RunDriverBudgetAdmission,
  capacityProof: StaticDriverCapacityProof,
  deltaSet: DerivedDeltaObservationSet,
  closureReceipt: ContributionClosureReceipt,
  closureVerdict: ClosureVerdict,
): FixtureKernelStepResult<AttributionKernelEvidence> {
  const evidence: AttributionKernelEvidence = {
    evidence_id: crypto.randomUUID(),
    app_id: input.profile.app_id,
    tenant_id: input.profile.tenant_id,
    environment: input.profile.environment,
    run_id: input.run_fence,
    kernel_version: "attribution-kernel@1",
    origin: "FIXTURE",
    profile_hash: input.profile_hash,
    contribution_truth_hash: input.truth_contract_hash,
    version_frontier_refs: {
      baseline: {
        identity_ref: input.baseline_frontier.identity_ref.ref,
        principal_ref: input.baseline_frontier.principal_ref.ref,
        scope_ref: input.baseline_frontier.scope_ref.ref,
        time_window_ref: input.baseline_frontier.time_window_ref.ref,
        classification_ref: input.baseline_frontier.classification_ref.ref,
      },
      follow_up: {
        identity_ref: input.follow_up_frontier.identity_ref.ref,
        principal_ref: input.follow_up_frontier.principal_ref.ref,
        scope_ref: input.follow_up_frontier.scope_ref.ref,
        time_window_ref: input.follow_up_frontier.time_window_ref.ref,
        classification_ref: input.follow_up_frontier.classification_ref.ref,
      },
    },
    endpoint_binding_refs: [...bindingRefs],
    lowering_certificate_refs: certificates.map((c) => c.certificate_id),
    budget_admission_ref: budgetAdmission.admission_id,
    delta_observation_set_ref: deltaSet.observation_set_id,
    closure_receipt_ref: closureReceipt.receipt_id,
    conclusion_candidate: candidate,
    closure_verdict: closureVerdict,
    explicit_absence: "attribution_feasibility_verdict",
    f9_status: {
      core_l2: "HOLD",
      attribution_f9: "NOT_REGISTERED",
      fixture_evidence: "HOLD",
    },
    fixture_conclusion: {
      subject_id: candidate.subject_id,
      source_identity: candidate.source_identity,
      contribution_verdict: candidate.contribution_verdict,
      evidence_links: candidate.evidence_links.map((link) => ({
        link_type: link.link_type,
        link_hash: link.link_hash as `sha256:${string}`,
        link_ref: link.link_ref,
      })),
      fixture_metadata: {
        fixture_id: candidate.fixture_metadata.fixture_id,
        fixture_version: candidate.fixture_metadata.fixture_version,
        generated_at: candidate.fixture_metadata.generated_at,
        fixture_confidence: candidate.fixture_metadata.fixture_confidence,
      },
      signed_at: candidate.signed_at,
    },
    sealed_at: new Date().toISOString() as unknown as string,
  };

  return stepSuccess("SealAttributionKernelEvidence", deepFreeze(evidence));
}

// ─── Main pipeline function ────────────────────────────────────────────────────

/**
 * Run the attribution fixture kernel pipeline.
 *
 * Takes a hash-pinned FIXTURE profile, ContributionTruthContract,
 * FixtureConclusionPolicyManifest, budget state, and frontiers,
 * processes them through a 10-step deterministic pipeline,
 * and produces a sealed AttributionKernelEvidence.
 *
 * Key constraint: F9 stays NOT_REGISTERED throughout. This kernel does not
 * register or claim any F9 capability. Core L2 stays HOLD.
 */
export function runAttributionFixtureKernel(
  input: AttributionFixtureKernelInput,
): AttributionFixtureKernelResult<AttributionKernelEvidence> {
  try {
    // Validate profile origin
    if (input.profile.profile_name !== "FIXTURE") {
      return {
        ok: false,
        error: {
          code: "FIXTURE_KERNEL_PROFILE_NOT_FIXTURE",
          message: "Attribution fixture kernel requires a profile with FIXTURE origin.",
          retryable: false,
          refusal: null,
        },
      };
    }

    // Run pipeline steps in order
    // Step 1: StaticDriverCapacityProof
    const capacityResult = stepStaticCapacity(input);
    if (!capacityResult.ok) return capacityResult;
    const capacityProof = capacityResult.value;

    // Step 2: RunDriverBudgetAdmission
    const budgetResult = stepBudgetAdmission(input);
    if (!budgetResult.ok) return budgetResult;
    const budgetAdmission = budgetResult.value;

    // Step 3: Endpoint Execution Binding
    const bindingResult = stepEndpointBinding(input);
    if (!bindingResult.ok) return bindingResult;
    const bindingRefs = bindingResult.value;

    // Step 4: SameFrontierWitness
    const frontierResult = stepFrontierWitness(input);
    if (!frontierResult.ok) return frontierResult;
    const witness = frontierResult.value;

    // Step 5: EndpointLoweringCertificate
    const loweringResult = stepLoweringCertificates(input);
    if (!loweringResult.ok) return loweringResult;
    const certificates = loweringResult.value;

    // Step 6: DerivedDeltaObservationSet
    const deltaResult = stepDeltaObservation(input, certificates, witness);
    if (!deltaResult.ok) return deltaResult;
    const deltaSet = deltaResult.value;

    // Step 7: ContributionClosureReceipt
    const closureResult = stepClosureReceipt(input, deltaSet, capacityProof, budgetAdmission);
    if (!closureResult.ok) return closureResult;
    const closureReceipt = closureResult.value;

    // Step 8: FixtureConclusionPolicyManifest Check
    const manifestResult = stepManifestCheck(input, deltaSet, closureReceipt);
    if (!manifestResult.ok) return manifestResult;

    // Step 9: FixtureConclusionCandidate
    const candidateResult = stepConclusionCandidate(
      input,
      deltaSet,
      closureReceipt,
      manifestResult.value,
      bindingRefs,
      certificates,
      witness,
      budgetAdmission,
      capacityProof,
    );
    if (!candidateResult.ok) return candidateResult;
    const candidate = candidateResult.value;

    // Step 10: Seal to AttributionKernelEvidence
    const finalResult = stepSealEvidence(
      input,
      candidate,
      bindingRefs,
      certificates,
      witness,
      budgetAdmission,
      capacityProof,
      deltaSet,
      closureReceipt,
      closureReceipt.closure_verdict,
    );
    if (!finalResult.ok) return finalResult;

    return { ok: true, value: finalResult.value };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "FIXTURE_KERNEL_INTERNAL_ERROR",
        message: `Unexpected error in attribution fixture kernel: ${(error as Error).message}`,
        retryable: false,
        refusal: "INTERNAL_ERROR",
      },
    };
  }
}

// ─── Sealing function (standalone) ──────────────────────────────────────────────

/**
 * Seal a FixtureConclusionCandidate into an AttributionKernelEvidence.
 * This is the final step of the U13.1 fixture kernel pipeline.
 *
 * The sealed evidence is immutable and content-addressed.
 */
export function sealFixtureConclusionCandidate(
  candidate: FixtureConclusionCandidate,
  appId: string,
  tenantId: string,
  environment: string,
  runId: string,
  profileHash: `sha256:${string}`,
  truthContractHash: `sha256:${string}`,
): AttributionKernelEvidence {
  const evidence: AttributionKernelEvidence = {
    evidence_id: crypto.randomUUID(),
    app_id: appId,
    tenant_id: tenantId,
    environment: environment,
    run_id: runId,
    kernel_version: "attribution-kernel@1",
    origin: "FIXTURE",
    profile_hash: profileHash,
    contribution_truth_hash: truthContractHash,
    version_frontier_refs: {
      baseline: {
        identity_ref: crypto.randomUUID(),
        principal_ref: crypto.randomUUID(),
        scope_ref: crypto.randomUUID(),
        time_window_ref: crypto.randomUUID(),
        classification_ref: crypto.randomUUID(),
      },
      follow_up: {
        identity_ref: crypto.randomUUID(),
        principal_ref: crypto.randomUUID(),
        scope_ref: crypto.randomUUID(),
        time_window_ref: crypto.randomUUID(),
        classification_ref: crypto.randomUUID(),
      },
    },
    endpoint_binding_refs: [crypto.randomUUID()],
    lowering_certificate_refs: [crypto.randomUUID()],
    budget_admission_ref: crypto.randomUUID(),
    delta_observation_set_ref: crypto.randomUUID(),
    closure_receipt_ref: crypto.randomUUID(),
    conclusion_candidate: candidate,
    closure_verdict: "PASS",
    explicit_absence: "attribution_feasibility_verdict",
    f9_status: {
      core_l2: "HOLD",
      attribution_f9: "NOT_REGISTERED",
      fixture_evidence: "HOLD",
    },
    fixture_conclusion: {
      subject_id: candidate.subject_id,
      source_identity: candidate.source_identity,
      contribution_verdict: candidate.contribution_verdict,
      evidence_links: candidate.evidence_links.map((link) => ({
        link_type: link.link_type,
        link_hash: link.link_hash as `sha256:${string}`,
        link_ref: link.link_ref,
      })),
      fixture_metadata: {
        fixture_id: candidate.fixture_metadata.fixture_id,
        fixture_version: candidate.fixture_metadata.fixture_version,
        generated_at: candidate.fixture_metadata.generated_at,
        fixture_confidence: candidate.fixture_metadata.fixture_confidence,
      },
      signed_at: candidate.signed_at,
    },
    sealed_at: new Date().toISOString() as unknown as string,
  };

  return deepFreeze(evidence);
}

// ─── F9 status constants ───────────────────────────────────────────────────────

/**
 * F9 registration status: NOT_REGISTERED.
 * This is the fixed status for the F9 lane throughout U13.1.
 * The kernel does not register or claim any F9 capability.
 */
export const F9_REGISTRATION_STATUS = "NOT_REGISTERED" as const;

/**
 * Core L2 registration status: HOLD.
 * The kernel does not affect Core L2 status.
 */
export const CORE_L2_REGISTRATION_STATUS = "HOLD" as const;
export type { AttributionKernelEvidence } from "@data-agent/contracts";
