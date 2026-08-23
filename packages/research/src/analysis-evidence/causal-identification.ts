import {
  type AnalysisContext,
  type AnalysisSandboxProgramPayload,
  type ArtifactReference,
  type AtomicClaimV3Payload,
  analysisSandboxProgramPayloadSchema,
  artifactReferenceIdentity,
  atomicClaimV3PayloadSchema,
  type CausalAttributionAuthorityClosure,
  type CausalEstimatePayload,
  type CausalQuestionPayload,
  causalAttributionAuthorityClosureSchema,
  causalEstimatePayloadSchema,
  causalQuestionPayloadSchema,
  type IdentificationCertificatePayload,
  type IdentificationPlanPayload,
  identificationCertificatePayloadSchema,
  identificationPlanPayloadSchema,
  type RootCauseDiscoveryCandidatePayload,
  type RootCauseDiscoveryReceiptPayload,
  rootCauseDiscoveryCandidatePayloadSchema,
  rootCauseDiscoveryReceiptPayloadSchema,
  sha256ContentHash,
  verifyAnalysisContext,
} from "@data-agent/contracts";
import { computeAnalysisSandboxProgramHash } from "./program-verifier.js";
import { computeRootCauseCandidateHash, computeRootCauseReceiptHash } from "./root-cause.js";

function exact(left: ArtifactReference, right: ArtifactReference) {
  return artifactReferenceIdentity(left) === artifactReferenceIdentity(right);
}

function sameRun(reference: ArtifactReference, anchor: ArtifactReference) {
  return (
    reference.app_id === anchor.app_id &&
    reference.tenant_id === anchor.tenant_id &&
    reference.environment === anchor.environment &&
    reference.run_id === anchor.run_id
  );
}

async function exactPayload(reference: ArtifactReference, payload: unknown) {
  return reference.content_hash === (await sha256ContentHash(payload));
}

function causalRole(context: AnalysisContext, objectId: string) {
  for (const metric of context.metrics) {
    if (metric.metric_ref.node_id === objectId) return metric.causal_role;
    const dimension = metric.allowed_dimensions.find(
      ({ dimension_id }) => dimension_id === objectId,
    );
    if (dimension) return dimension.causal_role;
  }
  return null;
}

function reachable(
  edges: readonly { readonly source_object_id: string; readonly target_object_id: string }[],
  source: string,
  target: string,
) {
  const pending = [source];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || visited.has(current)) continue;
    if (current === target) return true;
    visited.add(current);
    for (const edge of edges) {
      if (edge.source_object_id === current) pending.push(edge.target_object_id);
    }
  }
  return false;
}

function scmTruthMatchesEstimate(
  authority: CausalAttributionAuthorityClosure,
  estimate: CausalEstimatePayload,
) {
  const truth = authority.scm_truth;
  const directionPass =
    (truth.expected_effect === "POSITIVE" && estimate.interval_low > 0) ||
    (truth.expected_effect === "NEGATIVE" && estimate.interval_high < 0) ||
    (truth.expected_effect === "ZERO" && estimate.interval_low <= 0 && estimate.interval_high >= 0);
  const truthIntervalPass =
    !truth.effect_interval ||
    (estimate.point_estimate >= truth.effect_interval.low &&
      estimate.point_estimate <= truth.effect_interval.high);
  const observedIntervalPass =
    truth.effect_size === undefined ||
    (truth.effect_size >= estimate.interval_low && truth.effect_size <= estimate.interval_high);
  return directionPass && truthIntervalPass && observedIntervalPass;
}

export async function computeCausalQuestionHash(
  input: Omit<CausalQuestionPayload, "question_hash">,
) {
  return sha256ContentHash({ hash_domain: "causal-question@1.0.0", value: input });
}

export async function createCausalQuestion(input: {
  readonly context: AnalysisContext;
  readonly candidate: RootCauseDiscoveryCandidatePayload;
  readonly candidate_ref: ArtifactReference;
  readonly treatment_object_id: string;
  readonly population: string;
  readonly estimand: CausalQuestionPayload["estimand"];
  readonly time_zero: string;
  readonly intervention_semantics_ref: string;
  readonly target_window: CausalQuestionPayload["target_window"];
}): Promise<CausalQuestionPayload> {
  const context = await verifyAnalysisContext(input.context);
  const candidate = rootCauseDiscoveryCandidatePayloadSchema.parse(input.candidate);
  const { candidate_hash: _candidateHash, ...candidateMaterial } = candidate;
  if (
    input.candidate_ref.artifact_type !== "DiscoveryCandidate" ||
    !(await exactPayload(input.candidate_ref, candidate)) ||
    candidate.candidate_hash !== (await computeRootCauseCandidateHash(candidateMaterial)) ||
    candidate.analysis_context_hash !== context.context_hash ||
    !candidate.candidates.some(({ factor_id }) => factor_id === input.treatment_object_id) ||
    causalRole(context, candidate.outcome_metric_ref.node_id) !== "OUTCOME" ||
    causalRole(context, input.treatment_object_id) !== "TREATMENT" ||
    !context.causal_policy?.intervention_semantics_refs.includes(input.intervention_semantics_ref)
  ) {
    throw new TypeError("CAUSAL_QUESTION_NOT_IDENTIFIABLE");
  }
  const material = {
    artifact_type: "CausalQuestion",
    protocol_version: "causal-question@1.0.0",
    discovery_candidate_ref:
      input.candidate_ref as CausalQuestionPayload["discovery_candidate_ref"],
    outcome_metric_ref: candidate.outcome_metric_ref,
    treatment_object_id: input.treatment_object_id,
    population: input.population,
    estimand: input.estimand,
    time_zero: input.time_zero,
    intervention_semantics_ref: input.intervention_semantics_ref,
    target_window: input.target_window,
  } as const;
  return causalQuestionPayloadSchema.parse({
    ...material,
    question_hash: await computeCausalQuestionHash(material),
  });
}

export async function computeIdentificationPlanHash(
  input: Omit<IdentificationPlanPayload, "plan_hash">,
) {
  return sha256ContentHash({ hash_domain: "identification-plan@1.0.0", value: input });
}

export async function createIdentificationPlan(input: {
  readonly context: AnalysisContext;
  readonly question: CausalQuestionPayload;
  readonly question_ref: ArtifactReference;
  readonly candidate: RootCauseDiscoveryCandidatePayload;
  readonly receipt: RootCauseDiscoveryReceiptPayload;
  readonly receipt_ref: ArtifactReference;
  readonly estimator: IdentificationPlanPayload["estimator"];
  readonly runtime_digest: `sha256:${string}`;
  readonly dependency_lock_digest: `sha256:${string}`;
  readonly minimum_effective_sample_size?: number;
  readonly minimum_overlap?: number;
}): Promise<IdentificationPlanPayload> {
  const context = await verifyAnalysisContext(input.context);
  const question = causalQuestionPayloadSchema.parse(input.question);
  const candidate = rootCauseDiscoveryCandidatePayloadSchema.parse(input.candidate);
  const receipt = rootCauseDiscoveryReceiptPayloadSchema.parse(input.receipt);
  const { candidate_hash: _candidateHash, ...candidateMaterial } = candidate;
  const { question_hash: _questionHash, ...questionMaterial } = question;
  const { receipt_hash: _receiptHash, ...receiptMaterial } = receipt;
  const policy = context.causal_policy;
  if (
    !policy ||
    input.question_ref.artifact_type !== "CausalQuestion" ||
    input.receipt_ref.artifact_type !== "DiscoveryReceipt" ||
    !(await exactPayload(input.question_ref, question)) ||
    !(await exactPayload(input.receipt_ref, receipt)) ||
    question.question_hash !== (await computeCausalQuestionHash(questionMaterial)) ||
    receipt.receipt_hash !== (await computeRootCauseReceiptHash(receiptMaterial)) ||
    candidate.candidate_hash !== (await computeRootCauseCandidateHash(candidateMaterial)) ||
    !(await exactPayload(question.discovery_candidate_ref, candidate)) ||
    !exact(receipt.candidate_ref, question.discovery_candidate_ref) ||
    receipt.validation_verdict !== "PASS" ||
    receipt.frontier.analysis_context_hash !== context.context_hash ||
    !sameRun(input.question_ref, input.receipt_ref)
  ) {
    throw new TypeError("IDENTIFICATION_INPUT_CLOSURE_INVALID");
  }
  const treatment = question.treatment_object_id;
  const outcome = question.outcome_metric_ref.node_id;
  if (
    !reachable(policy.directed_edges, treatment, outcome) ||
    reachable(policy.directed_edges, outcome, treatment) ||
    policy.adjustment_set_object_ids.some(
      (id) =>
        policy.excluded_mediator_ids.includes(id) || policy.excluded_collider_ids.includes(id),
    ) ||
    policy.adjustment_set_object_ids.some(
      (id) => causalRole(context, id) !== "CANDIDATE_CONFOUNDER",
    )
  ) {
    throw new TypeError("IDENTIFICATION_DAG_ADJUSTMENT_INVALID");
  }
  const material: Omit<IdentificationPlanPayload, "plan_hash"> = {
    artifact_type: "IdentificationPlan",
    protocol_version: "identification-plan@1.0.0",
    causal_question_ref: input.question_ref as IdentificationPlanPayload["causal_question_ref"],
    discovery_receipt_ref: input.receipt_ref as IdentificationPlanPayload["discovery_receipt_ref"],
    frontier: {
      semantic_release_ref: context.semantic_release_ref,
      schema_snapshot_ref: context.schema_snapshot_ref,
      policy_receipt_ref: context.policy_receipt_ref,
      analysis_context_hash: context.context_hash,
      runtime_digest: input.runtime_digest,
      dependency_lock_digest: input.dependency_lock_digest,
    },
    dag_edges: policy.directed_edges,
    adjustment_set_object_ids: [...policy.adjustment_set_object_ids],
    excluded_mediator_ids: [...policy.excluded_mediator_ids],
    excluded_collider_ids: [...policy.excluded_collider_ids],
    assumptions: [
      "CONSISTENCY",
      "SUTVA",
      "EXCHANGEABILITY",
      "POSITIVITY",
      "NO_POST_TREATMENT_ADJUSTMENT",
      "MISSING_AT_RANDOM",
    ],
    minimum_effective_sample_size: input.minimum_effective_sample_size ?? 200,
    minimum_overlap: input.minimum_overlap ?? 0.1,
    estimator: input.estimator,
    refuters: [
      "PLACEBO_TREATMENT",
      "RANDOM_COMMON_CAUSE",
      "DATA_SUBSET",
      "BOOTSTRAP",
      "NEGATIVE_CONTROL",
      "SENSITIVITY",
    ],
  };
  return identificationPlanPayloadSchema.parse({
    ...material,
    plan_hash: await computeIdentificationPlanHash(material),
  });
}

export interface CausalEstimateComputation {
  readonly point_estimate: number;
  readonly interval_low: number;
  readonly interval_high: number;
  readonly effective_sample_size: number;
  readonly overlap_score: number;
  readonly maximum_standardized_mean_difference: number;
  readonly refutations: CausalEstimatePayload["refutations"];
  readonly sensitivity: CausalEstimatePayload["sensitivity"];
  readonly limitation_codes: CausalEstimatePayload["limitation_codes"];
}

export async function computeCausalEstimateHash(
  input: Omit<CausalEstimatePayload, "estimate_hash">,
) {
  return sha256ContentHash({ hash_domain: "causal-estimate@1.0.0", value: input });
}

export async function createCausalEstimate(input: {
  readonly question: CausalQuestionPayload;
  readonly question_ref: ArtifactReference;
  readonly plan: IdentificationPlanPayload;
  readonly plan_ref: ArtifactReference;
  readonly sandbox_program_ref: ArtifactReference;
  readonly sandbox_execution_receipt_ref: ArtifactReference;
  readonly sandbox_result_refs: readonly ArtifactReference[];
  readonly computation: CausalEstimateComputation;
}): Promise<CausalEstimatePayload> {
  const question = causalQuestionPayloadSchema.parse(input.question);
  const plan = identificationPlanPayloadSchema.parse(input.plan);
  const { plan_hash: _planHash, ...planMaterial } = plan;
  if (
    input.question_ref.artifact_type !== "CausalQuestion" ||
    input.plan_ref.artifact_type !== "IdentificationPlan" ||
    input.sandbox_program_ref.artifact_type !== "SandboxProgram" ||
    input.sandbox_execution_receipt_ref.artifact_type !== "SandboxExecutionReceipt" ||
    input.sandbox_result_refs.length === 0 ||
    input.sandbox_result_refs.some(({ artifact_type }) => artifact_type !== "SandboxResult") ||
    !exact(plan.causal_question_ref, input.question_ref) ||
    !(await exactPayload(input.question_ref, question)) ||
    !(await exactPayload(input.plan_ref, plan)) ||
    plan.plan_hash !== (await computeIdentificationPlanHash(planMaterial)) ||
    ![
      input.sandbox_program_ref,
      input.sandbox_execution_receipt_ref,
      ...input.sandbox_result_refs,
    ].every((reference) => sameRun(reference, input.plan_ref))
  ) {
    throw new TypeError("CAUSAL_ESTIMATE_INPUT_CLOSURE_INVALID");
  }
  const material = {
    artifact_type: "CausalEstimate",
    protocol_version: "causal-estimate@1.0.0",
    causal_question_ref: input.question_ref as CausalEstimatePayload["causal_question_ref"],
    identification_plan_ref: input.plan_ref as CausalEstimatePayload["identification_plan_ref"],
    sandbox_program_ref: input.sandbox_program_ref as CausalEstimatePayload["sandbox_program_ref"],
    sandbox_execution_receipt_ref:
      input.sandbox_execution_receipt_ref as CausalEstimatePayload["sandbox_execution_receipt_ref"],
    sandbox_result_refs: input.sandbox_result_refs as CausalEstimatePayload["sandbox_result_refs"],
    estimand: question.estimand,
    ...input.computation,
  } as const;
  return causalEstimatePayloadSchema.parse({
    ...material,
    estimate_hash: await computeCausalEstimateHash(material),
  });
}

export async function computeAttributionAuthorityClosureHash(
  input: Omit<CausalAttributionAuthorityClosure, "closure_hash">,
) {
  return sha256ContentHash({
    hash_domain: "causal-attribution-authority-closure@1.0.0",
    value: input,
  });
}

export async function computeIdentificationCertificateHash(
  input: Omit<IdentificationCertificatePayload, "certificate_hash">,
) {
  return sha256ContentHash({
    hash_domain: "identification-certificate@1.0.0",
    value: input,
  });
}

export async function createIdentificationCertificate(input: {
  readonly now: Date;
  readonly context: AnalysisContext;
  readonly question: CausalQuestionPayload;
  readonly question_ref: ArtifactReference;
  readonly plan: IdentificationPlanPayload;
  readonly plan_ref: ArtifactReference;
  readonly estimate: CausalEstimatePayload;
  readonly estimate_ref: ArtifactReference;
  readonly receipt_ref: ArtifactReference;
  readonly program: AnalysisSandboxProgramPayload;
  readonly authority: CausalAttributionAuthorityClosure;
}): Promise<IdentificationCertificatePayload> {
  const context = await verifyAnalysisContext(input.context);
  const question = causalQuestionPayloadSchema.parse(input.question);
  const plan = identificationPlanPayloadSchema.parse(input.plan);
  const estimate = causalEstimatePayloadSchema.parse(input.estimate);
  const program = analysisSandboxProgramPayloadSchema.parse(input.program);
  const authority = causalAttributionAuthorityClosureSchema.parse(input.authority);
  const { question_hash: _questionHash, ...questionMaterial } = question;
  const { plan_hash: _planHash, ...planMaterial } = plan;
  const { estimate_hash: _estimateHash, ...estimateMaterial } = estimate;
  const { program_hash: _programHash, ...programMaterial } = program;
  const { closure_hash: _closureHash, ...authorityMaterial } = authority;
  const authorityHash = await computeAttributionAuthorityClosureHash(authorityMaterial);
  const safetyExpiresAt =
    Date.parse(authority.safety.determined_at) + authority.safety.ttl_seconds * 1_000;
  const inputClosurePass =
    (await exactPayload(input.question_ref, question)) &&
    (await exactPayload(input.plan_ref, plan)) &&
    (await exactPayload(input.estimate_ref, estimate)) &&
    question.question_hash === (await computeCausalQuestionHash(questionMaterial)) &&
    plan.plan_hash === (await computeIdentificationPlanHash(planMaterial)) &&
    estimate.estimate_hash === (await computeCausalEstimateHash(estimateMaterial)) &&
    program.program_hash === (await computeAnalysisSandboxProgramHash(programMaterial)) &&
    exact(plan.causal_question_ref, input.question_ref) &&
    exact(estimate.causal_question_ref, input.question_ref) &&
    exact(estimate.identification_plan_ref, input.plan_ref) &&
    exact(plan.discovery_receipt_ref, input.receipt_ref) &&
    sameRun(program.analysis_program_ref, input.plan_ref);
  const frontierPass =
    inputClosurePass &&
    plan.frontier.analysis_context_hash === context.context_hash &&
    exact(plan.frontier.semantic_release_ref, context.semantic_release_ref) &&
    exact(plan.frontier.schema_snapshot_ref, context.schema_snapshot_ref) &&
    exact(plan.frontier.policy_receipt_ref, context.policy_receipt_ref);
  const programPass =
    (await exactPayload(estimate.sandbox_program_ref, program)) &&
    program.import_profile === "CAUSAL_L5" &&
    program.runtime_digest === plan.frontier.runtime_digest &&
    program.dependency_lock_digest === plan.frontier.dependency_lock_digest;
  const refutationPass = estimate.refutations.every(({ verdict }) => verdict === "PASS");
  const dagPass =
    reachable(plan.dag_edges, question.treatment_object_id, question.outcome_metric_ref.node_id) &&
    !reachable(plan.dag_edges, question.outcome_metric_ref.node_id, question.treatment_object_id) &&
    plan.adjustment_set_object_ids.every(
      (id) =>
        !plan.excluded_mediator_ids.includes(id) &&
        !plan.excluded_collider_ids.includes(id) &&
        causalRole(context, id) === "CANDIDATE_CONFOUNDER",
    );
  const dataPass = estimate.effective_sample_size >= plan.minimum_effective_sample_size;
  const overlapPass =
    estimate.overlap_score >= plan.minimum_overlap &&
    estimate.maximum_standardized_mean_difference <= 0.1;
  const authorityPass =
    authority.closure_hash === authorityHash &&
    authority.eligibility.frozen_question_hash === question.question_hash &&
    input.now.getTime() <= safetyExpiresAt &&
    scmTruthMatchesEstimate(authority, estimate);
  const gateValues = [
    ["SCHEMA_FRONTIER", frontierPass, context.schema_snapshot_ref.content_hash],
    ["SEMANTIC_FRONTIER", frontierPass, context.semantic_release_ref.content_hash],
    ["POLICY_FRONTIER", frontierPass, context.policy_receipt_ref.content_hash],
    ["PROGRAM_RUNTIME_LOCK", programPass, estimate.sandbox_program_ref.content_hash],
    ["DAG_ADJUSTMENT", dagPass, plan.plan_hash],
    ["DATA_SUFFICIENCY", dataPass, estimate.estimate_hash],
    ["OVERLAP_BALANCE", overlapPass, estimate.estimate_hash],
    ["REFUTATION", refutationPass, estimate.estimate_hash],
    [
      "SENSITIVITY",
      estimate.sensitivity.negative_control_passed && estimate.sensitivity.robustness_value >= 1,
      estimate.estimate_hash,
    ],
    ["ATTRIBUTION_AUTHORITY", authorityPass, authorityHash],
  ] as const;
  const gates = gateValues.map(([gate, pass, evidenceHash]) => ({
    gate,
    verdict: pass ? ("PASS" as const) : ("HOLD" as const),
    evidence_hash: evidenceHash,
  }));
  const allPass = gates.every(({ verdict }) => verdict === "PASS");
  const reasons = [
    ...(!frontierPass ? (["ROOT_CAUSE_NOT_IDENTIFIABLE"] as const) : []),
    ...(!dagPass ? (["ROOT_CAUSE_NOT_IDENTIFIABLE"] as const) : []),
    ...(!dataPass ? (["ROOT_CAUSE_NOT_IDENTIFIABLE"] as const) : []),
    ...(!overlapPass ? (["CAUSAL_OVERLAP_INSUFFICIENT"] as const) : []),
    ...(!programPass ||
    !refutationPass ||
    !authorityPass ||
    !estimate.sensitivity.negative_control_passed ||
    estimate.sensitivity.robustness_value < 1
      ? (["CAUSAL_REFUTATION_FAILED"] as const)
      : []),
  ];
  const material = {
    artifact_type: "IdentificationCertificate",
    protocol_version: "identification-certificate@1.0.0",
    causal_question_ref:
      input.question_ref as IdentificationCertificatePayload["causal_question_ref"],
    identification_plan_ref:
      input.plan_ref as IdentificationCertificatePayload["identification_plan_ref"],
    causal_estimate_ref:
      input.estimate_ref as IdentificationCertificatePayload["causal_estimate_ref"],
    discovery_receipt_ref:
      input.receipt_ref as IdentificationCertificatePayload["discovery_receipt_ref"],
    frontier: plan.frontier,
    attribution_authority_hash: authorityHash,
    gates,
    verdict: allPass ? ("CERTIFIED" as const) : ("HOLD" as const),
    reason_codes: [...new Set(reasons)].sort(),
    invalidation_hashes: {
      semantic_release_hash: context.semantic_release_ref.content_hash,
      schema_snapshot_hash: context.schema_snapshot_ref.content_hash,
      policy_receipt_hash: context.policy_receipt_ref.content_hash,
      program_hash: program.program_hash,
      runtime_digest: plan.frontier.runtime_digest ?? context.context_hash,
      dependency_lock_digest: plan.frontier.dependency_lock_digest ?? context.context_hash,
    },
  } as const;
  return identificationCertificatePayloadSchema.parse({
    ...material,
    certificate_hash: await computeIdentificationCertificateHash(material),
  });
}

export async function assertCausalClaimAuthorized(input: {
  readonly claim: AtomicClaimV3Payload;
  readonly certificate: IdentificationCertificatePayload;
  readonly certificate_ref: ArtifactReference;
  readonly estimate_ref: ArtifactReference;
}): Promise<AtomicClaimV3Payload> {
  const claim = atomicClaimV3PayloadSchema.parse(input.claim);
  const certificate = identificationCertificatePayloadSchema.parse(input.certificate);
  const { certificate_hash: _certificateHash, ...certificateMaterial } = certificate;
  if (
    claim.predicate.claim_mode !== "CAUSAL_ESTIMATE" ||
    certificate.verdict !== "CERTIFIED" ||
    !claim.identification_certificate_ref ||
    !exact(claim.identification_certificate_ref, input.certificate_ref) ||
    !exact(certificate.causal_estimate_ref, input.estimate_ref) ||
    !claim.evidence_refs.some((reference) => exact(reference, input.estimate_ref)) ||
    !(await exactPayload(input.certificate_ref, certificate)) ||
    certificate.certificate_hash !==
      (await computeIdentificationCertificateHash(certificateMaterial))
  ) {
    throw new TypeError("CAUSAL_CLAIM_CERTIFICATE_REQUIRED");
  }
  return claim;
}
