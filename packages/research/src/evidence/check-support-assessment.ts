import {
  artifactReferenceIdentity,
  canonicalizeJson,
  type EvidenceCheckReceiptPayload,
  embeddedNodeReferenceIdentity,
  evidenceCheckInputRefSchema,
  evidenceCheckReceiptRefSchema,
  type HypothesisAssessmentPayload,
  type HypothesisRef,
  type ProofObligationRef,
  type SupportDecisionPayload,
  supportDecisionRefSchema,
  U6_WIRE_LIMITS,
} from "@data-agent/contracts";
import {
  type ResearchKernelResult,
  researchKernelFailure,
  researchKernelSuccess,
} from "../errors.js";
import {
  assessHypothesis,
  deriveEvidenceCheckReceipt,
  deriveSupportDecision,
} from "../evidence.js";
import { preflightResearchInput } from "../input-budget.js";
import { resolveResearchDocumentCandidate } from "../internal/document-resolution.js";
import { computeResearchKernelHash } from "../internal/hash.js";
import {
  exactReferenceSet,
  orderedUniqueReferences,
  sameReferenceScope,
  stableCompare,
} from "../internal/reference-identity.js";
import { assessHypothesisObservation } from "../observation.js";
import { canonicalizeProofObligationGraph } from "../planning.js";
import {
  resolveAtomicClaimDerivationWithReplayContext,
  resolveEvidenceRelationDerivationWithReplayContext,
} from "./claim-relation.js";
import { resolveQueryEvidenceDerivationWithReplayContext } from "./oed-query.js";
import {
  createProofDerivationReplayContext,
  type ProofDerivationReplayContext,
  type ResolvedEvidenceCheckDerivation,
  type ResolvedEvidenceRelationDerivation,
  type ResolvedSupportDecisionDerivation,
  replayWithinBoundary,
} from "./proof-replay.js";
import {
  ATOMIC_CLAIM_RESOLUTION_KEYS,
  type BuildEvidenceCheckCandidateInput,
  type BuildHypothesisAssessmentCandidateInput,
  type BuildSupportDecisionCandidateInput,
  EVIDENCE_CHECK_INPUT_KEYS,
  EVIDENCE_CHECK_RESOLUTION_KEYS,
  EVIDENCE_RELATION_RESOLUTION_KEYS,
  type EvidenceCheckDerivationResolution,
  HYPOTHESIS_ASSESSMENT_INPUT_KEYS,
  hasExactKeys,
  resolveProofObligation,
  SUPPORT_DECISION_INPUT_KEYS,
  SUPPORT_DECISION_RESOLUTION_KEYS,
  type SupportDecisionDerivationResolution,
} from "./shared.js";

/**
 * Replays deterministic/provenance evidence checks from the exact
 * Plan→QueryEvidence→Claim→Relation→Sandbox closure. `passed` is never accepted
 * from a caller.
 */
export async function buildEvidenceCheckCandidate(
  input: BuildEvidenceCheckCandidateInput,
): Promise<ResearchKernelResult<EvidenceCheckReceiptPayload>> {
  return buildEvidenceCheckCandidateWithReplayContext(input, createProofDerivationReplayContext());
}

export async function buildEvidenceCheckCandidateWithReplayContext(
  input: BuildEvidenceCheckCandidateInput,
  context: ProofDerivationReplayContext,
): Promise<ResearchKernelResult<EvidenceCheckReceiptPayload>> {
  const budget = preflightResearchInput(input, {
    array_limits: [
      {
        path: ["query_evidence_resolutions"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
    ],
  });
  if (!budget.ok) return budget;

  if (
    !hasExactKeys(input, EVIDENCE_CHECK_INPUT_KEYS) ||
    !hasExactKeys(input.claim_resolution, ATOMIC_CLAIM_RESOLUTION_KEYS) ||
    !hasExactKeys(input.relation_resolution, EVIDENCE_RELATION_RESOLUTION_KEYS) ||
    !Array.isArray(input.query_evidence_resolutions) ||
    input.query_evidence_resolutions.length > U6_WIRE_LIMITS.max_obligations ||
    !["DETERMINISTIC_CHECK", "PROVENANCE_CHECK"].includes(input.check_kind)
  ) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "EvidenceCheck builder 必须消费 exact derivation closure，且不能接收 passed。",
    );
  }

  const [claim, relation, ...queryEvidenceResults] = await Promise.all([
    resolveAtomicClaimDerivationWithReplayContext(input.claim_resolution, context),
    resolveEvidenceRelationDerivationWithReplayContext(input.relation_resolution, context),
    ...input.query_evidence_resolutions.map((resolution) =>
      resolveQueryEvidenceDerivationWithReplayContext(resolution, context),
    ),
  ]);
  if (!claim.ok) return claim;
  if (!relation.ok) return relation;
  const failedEvidence = queryEvidenceResults.find((result) => !result.ok);
  if (failedEvidence && !failedEvidence.ok) return failedEvidence;
  const queryEvidence = queryEvidenceResults.map(
    (result) => (result as Extract<typeof result, { ok: true }>).value,
  );
  const expectedEvidenceRefs = claim.value.payload.evidence_refs;
  if (
    !exactReferenceSet(
      queryEvidence.map(({ ref }) => ref),
      expectedEvidenceRefs,
    ) ||
    artifactReferenceIdentity(relation.value.payload.claim_ref) !==
      artifactReferenceIdentity(claim.value.ref) ||
    !expectedEvidenceRefs.some(
      (reference) =>
        artifactReferenceIdentity(reference) ===
        artifactReferenceIdentity(relation.value.payload.evidence_ref),
    )
  ) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "EvidenceCheck 必须重放 Claim 的全部 QueryEvidence，并绑定 exact Relation。",
    );
  }

  const obligation = await resolveProofObligation(
    input.relation_resolution.derivation_input.obligation,
    context.request_context,
  );
  if (
    !obligation.ok ||
    embeddedNodeReferenceIdentity(relation.value.payload.obligation_ref) !==
      embeddedNodeReferenceIdentity(obligation.value.obligation_ref)
  ) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      obligation.ok
        ? "EvidenceCheck Relation 与 EvidencePlan Obligation 不一致。"
        : obligation.error.message,
    );
  }

  const relationEvidenceIdentity = artifactReferenceIdentity(relation.value.payload.evidence_ref);
  const relationBindings = claim.value.payload.observation_bindings.filter(
    ({ evidence_ref }) => artifactReferenceIdentity(evidence_ref) === relationEvidenceIdentity,
  );
  const relationBinding = relationBindings[0];
  const observation = relationBinding?.observed_value;
  let deterministicPassed = false;
  if (
    relationBindings.length === 1 &&
    observation?.value_kind === "NUMBER" &&
    observation.number_value !== null
  ) {
    if (relation.value.payload.proposed_relation === "CONFLICTS" && relationBinding) {
      deterministicPassed = claim.value.payload.observation_bindings.some(
        (binding) =>
          artifactReferenceIdentity(binding.evidence_ref) !== relationEvidenceIdentity &&
          binding.output_alias === relationBinding.output_alias &&
          embeddedNodeReferenceIdentity(binding.metric_ref) ===
            embeddedNodeReferenceIdentity(relationBinding.metric_ref) &&
          binding.observed_value.value_kind === "NUMBER" &&
          binding.observed_value.number_value !== observation.number_value &&
          binding.result_cell_hash !== relationBinding.result_cell_hash,
      );
    } else {
      const status = assessHypothesisObservation({
        value: observation.number_value,
        support_predicate: obligation.value.obligation.observation_contract.support_predicate,
        refute_predicate: obligation.value.obligation.observation_contract.refute_predicate,
        null_behavior: obligation.value.obligation.observation_contract.null_behavior,
      });
      if (status.ok) {
        const expectedRelation =
          status.value === "SURVIVED"
            ? "SUPPORTS"
            : status.value === "REFUTED"
              ? "REFUTES"
              : "QUALIFIES";
        deterministicPassed = relation.value.payload.proposed_relation === expectedRelation;
      }
    }
  }

  const evaluatedReferenceCandidates = orderedUniqueReferences([
    relation.value.ref,
    claim.value.ref,
    ...queryEvidence.flatMap(({ ref, payload }) => [
      ref,
      payload.query_contract_ref,
      payload.observed_version.semantic_release_ref,
      payload.observed_version.schema_snapshot_ref,
      payload.observed_version.policy_receipt_ref,
      payload.sandbox_execution_receipt_ref,
      payload.sandbox_result_ref,
    ]),
  ]);
  const evaluatedRefs = [];
  for (const reference of evaluatedReferenceCandidates) {
    const parsed = evidenceCheckInputRefSchema.safeParse(reference);
    if (!parsed.success) {
      return researchKernelFailure(
        "EVIDENCE_SUPPORT_INSUFFICIENT",
        "EvidenceCheck evaluated_refs 只能包含冻结的 Check Input Reference 类型。",
      );
    }
    evaluatedRefs.push(parsed.data);
  }
  const passed =
    input.check_kind === "DETERMINISTIC_CHECK"
      ? deterministicPassed
      : queryEvidence.every(({ ref, payload }) =>
          sameReferenceScope(ref, payload.observed_version.semantic_release_ref),
        );
  return deriveEvidenceCheckReceipt({
    relation_ref: relation.value.ref,
    check_kind: input.check_kind,
    passed,
    observed_contract_hash: obligation.value.observation_contract_hash,
    evaluated_refs: evaluatedRefs,
    evaluator_version: input.evaluator_version,
    ...(passed
      ? {}
      : {
          failure_reason:
            input.check_kind === "DETERMINISTIC_CHECK"
              ? ("EVIDENCE_SUPPORT_INSUFFICIENT" as const)
              : ("EVIDENCE_REVISION_STALE" as const),
        }),
  });
}

async function resolveEvidenceCheckDerivationUncached(
  resolution: EvidenceCheckDerivationResolution,
  context: ProofDerivationReplayContext,
): Promise<ResearchKernelResult<ResolvedEvidenceCheckDerivation>> {
  const budget = preflightResearchInput(resolution);
  if (!budget.ok) return budget;
  if (!hasExactKeys(resolution, EVIDENCE_CHECK_RESOLUTION_KEYS)) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "EvidenceCheck derivation resolution 必须是 exact document+derivation_input。",
    );
  }
  const [document, derived] = await Promise.all([
    resolveResearchDocumentCandidate(
      resolution.document,
      "EvidenceCheckReceipt",
      context.request_context,
    ),
    buildEvidenceCheckCandidateWithReplayContext(resolution.derivation_input, context),
  ]);
  if (!document.ok) return document;
  if (
    !derived.ok ||
    document.value.document.payload.artifact_type !== "EvidenceCheckReceipt" ||
    canonicalizeJson(document.value.document.payload) !== canonicalizeJson(derived.value)
  ) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      derived.ok
        ? "EvidenceCheck Document 与 production derivation 不一致。"
        : derived.error.message,
    );
  }
  const ref = evidenceCheckReceiptRefSchema.safeParse(document.value.ref);
  return ref.success
    ? researchKernelSuccess({ ref: ref.data, payload: derived.value })
    : researchKernelFailure(
        "EVIDENCE_SUPPORT_INSUFFICIENT",
        "EvidenceCheck derived Reference 类型无效。",
      );
}

export function resolveEvidenceCheckDerivationWithReplayContext(
  resolution: EvidenceCheckDerivationResolution,
  context: ProofDerivationReplayContext,
): Promise<ResearchKernelResult<ResolvedEvidenceCheckDerivation>> {
  if (typeof resolution !== "object" || resolution === null || Array.isArray(resolution)) {
    return resolveEvidenceCheckDerivationUncached(resolution, context);
  }
  return replayWithinBoundary(context, "evidence-check", context.evidence_check, resolution, () =>
    resolveEvidenceCheckDerivationUncached(resolution, context),
  );
}

/**
 * Replays `deriveSupportDecision` only after every Claim/Relation/Check document
 * has been rebuilt from its full derivation closure.
 */
export async function buildSupportDecisionCandidate(
  input: BuildSupportDecisionCandidateInput,
): Promise<ResearchKernelResult<SupportDecisionPayload>> {
  return buildSupportDecisionCandidateWithReplayContext(
    input,
    createProofDerivationReplayContext(),
  );
}

export async function buildSupportDecisionCandidateWithReplayContext(
  input: BuildSupportDecisionCandidateInput,
  context: ProofDerivationReplayContext,
): Promise<ResearchKernelResult<SupportDecisionPayload>> {
  const budget = preflightResearchInput(input, {
    array_limits: [
      {
        path: ["relation_resolutions"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
      {
        path: ["check_resolutions"],
        max_items: U6_WIRE_LIMITS.max_obligations * 2,
      },
    ],
  });
  if (!budget.ok) return budget;

  if (
    !hasExactKeys(input, SUPPORT_DECISION_INPUT_KEYS) ||
    !hasExactKeys(input.claim_resolution, ATOMIC_CLAIM_RESOLUTION_KEYS) ||
    !Array.isArray(input.relation_resolutions) ||
    input.relation_resolutions.length > U6_WIRE_LIMITS.max_obligations ||
    !Array.isArray(input.check_resolutions) ||
    input.check_resolutions.length > U6_WIRE_LIMITS.max_obligations * 2
  ) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "SupportDecision builder 必须消费 exact Claim/Relation/Check derivation closure。",
    );
  }
  const [claim, ...closureResults] = await Promise.all([
    resolveAtomicClaimDerivationWithReplayContext(input.claim_resolution, context),
    ...input.relation_resolutions.map((resolution) =>
      resolveEvidenceRelationDerivationWithReplayContext(resolution, context),
    ),
    ...input.check_resolutions.map((resolution) =>
      resolveEvidenceCheckDerivationWithReplayContext(resolution, context),
    ),
  ]);
  if (!claim.ok) return claim;
  const failed = closureResults.find((result) => !result.ok);
  if (failed && !failed.ok) return failed;
  const relationCount = input.relation_resolutions.length;
  const relations = closureResults
    .slice(0, relationCount)
    .map(
      (result) =>
        (result as ResearchKernelResult<ResolvedEvidenceRelationDerivation> & { ok: true }).value,
    )
    .sort((left, right) =>
      stableCompare(artifactReferenceIdentity(left.ref), artifactReferenceIdentity(right.ref)),
    );
  const checks = closureResults
    .slice(relationCount)
    .map(
      (result) =>
        (result as ResearchKernelResult<ResolvedEvidenceCheckDerivation> & { ok: true }).value,
    )
    .sort((left, right) =>
      stableCompare(artifactReferenceIdentity(left.ref), artifactReferenceIdentity(right.ref)),
    );
  return deriveSupportDecision({
    claim_ref: claim.value.ref,
    claim: claim.value.payload,
    relations,
    checks,
    evaluator_version: input.evaluator_version,
  });
}

async function resolveSupportDecisionDerivationUncached(
  resolution: SupportDecisionDerivationResolution,
  context: ProofDerivationReplayContext,
): Promise<ResearchKernelResult<ResolvedSupportDecisionDerivation>> {
  const budget = preflightResearchInput(resolution);
  if (!budget.ok) return budget;
  if (!hasExactKeys(resolution, SUPPORT_DECISION_RESOLUTION_KEYS)) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "SupportDecision derivation resolution 必须是 exact document+derivation_input。",
    );
  }
  const [document, derived, claim] = await Promise.all([
    resolveResearchDocumentCandidate(
      resolution.document,
      "SupportDecision",
      context.request_context,
    ),
    buildSupportDecisionCandidateWithReplayContext(resolution.derivation_input, context),
    resolveAtomicClaimDerivationWithReplayContext(
      resolution.derivation_input.claim_resolution,
      context,
    ),
  ]);
  if (!document.ok) return document;
  if (!claim.ok) return claim;
  if (
    !derived.ok ||
    document.value.document.payload.artifact_type !== "SupportDecision" ||
    canonicalizeJson(document.value.document.payload) !== canonicalizeJson(derived.value)
  ) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      derived.ok
        ? "SupportDecision Document 与 production derivation 不一致。"
        : derived.error.message,
    );
  }
  const ref = supportDecisionRefSchema.safeParse(document.value.ref);
  return ref.success
    ? researchKernelSuccess({
        ref: ref.data,
        payload: derived.value,
        claim: claim.value,
      })
    : researchKernelFailure(
        "EVIDENCE_SUPPORT_INSUFFICIENT",
        "SupportDecision derived Reference 类型无效。",
      );
}

export function resolveSupportDecisionDerivationWithReplayContext(
  resolution: SupportDecisionDerivationResolution,
  context: ProofDerivationReplayContext,
): Promise<ResearchKernelResult<ResolvedSupportDecisionDerivation>> {
  if (typeof resolution !== "object" || resolution === null || Array.isArray(resolution)) {
    return resolveSupportDecisionDerivationUncached(resolution, context);
  }
  return replayWithinBoundary(
    context,
    "support-decision",
    context.support_decision,
    resolution,
    () => resolveSupportDecisionDerivationUncached(resolution, context),
  );
}

/**
 * Recomputes one HypothesisAssessment from the exact EvidencePlan hypothesis
 * obligations and fully replayed Support/Claim closure. Status and unresolved
 * references are outputs, never inputs.
 */
export async function buildHypothesisAssessmentCandidate(
  input: BuildHypothesisAssessmentCandidateInput,
): Promise<ResearchKernelResult<HypothesisAssessmentPayload>> {
  return buildHypothesisAssessmentCandidateWithReplayContext(
    input,
    createProofDerivationReplayContext(),
  );
}

export async function buildHypothesisAssessmentCandidateWithReplayContext(
  input: BuildHypothesisAssessmentCandidateInput,
  context: ProofDerivationReplayContext,
): Promise<ResearchKernelResult<HypothesisAssessmentPayload>> {
  const budget = preflightResearchInput(input, {
    array_limits: [
      {
        path: ["support_decision_resolutions"],
        max_items: U6_WIRE_LIMITS.max_obligations * 4,
      },
    ],
  });
  if (!budget.ok) return budget;

  if (
    !hasExactKeys(input, HYPOTHESIS_ASSESSMENT_INPUT_KEYS) ||
    !Array.isArray(input.support_decision_resolutions) ||
    input.support_decision_resolutions.length > U6_WIRE_LIMITS.max_obligations * 4
  ) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "HypothesisAssessment builder 必须消费 Plan、hypothesis_id 与 Support derivation closure。",
    );
  }
  const [plan, ...supportResults] = await Promise.all([
    resolveResearchDocumentCandidate(
      input.evidence_plan_document,
      "EvidencePlan",
      context.request_context,
    ),
    ...input.support_decision_resolutions.map((resolution) =>
      resolveSupportDecisionDerivationWithReplayContext(resolution, context),
    ),
  ]);
  if (!plan.ok || plan.value.document.payload.artifact_type !== "EvidencePlan") {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      plan.ok ? "HypothesisAssessment EvidencePlan 类型漂移。" : plan.error.message,
    );
  }
  const failedSupport = supportResults.find((result) => !result.ok);
  if (failedSupport && !failedSupport.ok) return failedSupport;
  const supports = supportResults.map(
    (result) =>
      (result as ResearchKernelResult<ResolvedSupportDecisionDerivation> & { ok: true }).value,
  );
  const planPayload = plan.value.document.payload;
  const graphHash = await computeResearchKernelHash(
    "u6-obligation-graph@1",
    canonicalizeProofObligationGraph(planPayload.obligations),
  );
  if (graphHash !== planPayload.obligation_graph_hash) {
    return researchKernelFailure(
      "EVIDENCE_PLAN_INVALID",
      "HypothesisAssessment EvidencePlan graph hash 与 production material 不匹配。",
    );
  }

  const planRef = plan.value.ref;
  const hypothesisRefs = new Map<string, HypothesisRef>();
  const hypothesisObligations: ProofObligationRef[] = [];
  for (const obligation of planPayload.obligations) {
    const matched = obligation.hypothesis_refs.find(
      ({ node_id }) => node_id === input.hypothesis_id,
    );
    if (!matched) continue;
    hypothesisRefs.set(embeddedNodeReferenceIdentity(matched), matched);
    hypothesisObligations.push({
      container_ref: planRef,
      node_id: obligation.obligation_id,
    } as ProofObligationRef);
  }
  if (hypothesisRefs.size !== 1 || hypothesisObligations.length === 0) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "hypothesis_id 必须唯一命中 EvidencePlan 中已引用的 Hypothesis。",
    );
  }
  const hypothesisRef = [...hypothesisRefs.values()][0];
  if (!hypothesisRef) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "Hypothesis Reference 解析失败。",
    );
  }
  const allowedObligations = new Set(hypothesisObligations.map(embeddedNodeReferenceIdentity));
  const relevantSupports = supports
    .filter(({ payload }) =>
      payload.obligation_refs.some((reference) =>
        allowedObligations.has(embeddedNodeReferenceIdentity(reference)),
      ),
    )
    .sort((left, right) =>
      stableCompare(artifactReferenceIdentity(left.ref), artifactReferenceIdentity(right.ref)),
    );
  const unresolvedObligations = hypothesisObligations.filter((obligationRef) => {
    const obligationIdentity = embeddedNodeReferenceIdentity(obligationRef);
    const decisions = relevantSupports.filter(({ payload }) =>
      payload.obligation_refs.some(
        (reference) => embeddedNodeReferenceIdentity(reference) === obligationIdentity,
      ),
    );
    return (
      decisions.length === 0 ||
      decisions.every(({ payload }) =>
        ["CONFLICTED", "INSUFFICIENT", "UNSUPPORTED"].includes(payload.decision),
      )
    );
  });
  return assessHypothesis({
    hypothesis_ref: hypothesisRef,
    decisions: relevantSupports.map(({ ref, payload, claim }) => ({
      ref,
      payload,
      claim,
    })),
    hypothesis_obligation_refs: hypothesisObligations,
    unresolved_obligation_refs: unresolvedObligations,
  });
}
