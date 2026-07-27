import {
  type ArtifactReference,
  type AtomicClaimPredicate,
  artifactReferenceIdentity,
  type EvidenceCheckReceiptPayload,
  type EvidenceRelationV2Payload,
  type L2ArtifactDocument,
  type L2ResearchDocumentCandidate,
  type PolicyReceiptRef,
  type ProofObligationRef,
  type ProofObligationV2,
  proofObligationRefSchema,
  type SandboxResult,
  type SemanticReleaseRef,
  type SuccessfulSandboxExecutionReceipt,
  type VersionFrontier,
} from "@data-agent/contracts";
import {
  type ResearchKernelResult,
  researchKernelFailure,
  researchKernelSuccess,
} from "../errors.js";
import { resolveResearchDocumentCandidate } from "../internal/document-resolution.js";
import { computeResearchKernelHash } from "../internal/hash.js";
import { sameIdentitySet } from "../internal/reference-identity.js";
import type { ResearchRequestReplayContext } from "../internal/request-replay-context.js";
import { canonicalizeProofObligationGraph } from "../planning.js";

export const RESOLVED_OBLIGATION_KEYS = ["evidence_plan_document", "obligation_id"] as const;
export const QUERY_EVIDENCE_INPUT_KEYS = [
  "obligation",
  "obligation_execution_decision_resolution",
  "l2",
  "sandbox",
  "dependency_evidence_documents",
  "observed_version",
] as const;
export const QUERY_EVIDENCE_L2_KEYS = [
  "query_contract_document",
  "sql_artifact_document",
  "validation_receipt_document",
  "execution_receipt_document",
] as const;
export const QUERY_EVIDENCE_SANDBOX_KEYS = ["sandbox_execution_receipt", "sandbox_result"] as const;
export const ATOMIC_CLAIM_INPUT_KEYS = [
  "claim_intent",
  "predicate",
  "observation_sources",
  "renderer",
] as const;
export const ATOMIC_CLAIM_DOCUMENT_DERIVATION_INPUT_KEYS = [
  "claim_document",
  "observation_sources",
] as const;
export const CLAIM_INTENT_KEYS = ["claim_id", "limitations"] as const;
export const CLAIM_RENDERER_KEYS = ["renderer_version", "locale"] as const;
export const CLAIM_OBSERVATION_SOURCE_KEYS = [
  "query_evidence_document",
  "query_contract_document",
  "obligation",
  "sandbox_result",
  "selector",
] as const;
export const CLAIM_OBSERVATION_SELECTOR_KEYS = ["binding_id", "output_alias", "row_index"] as const;
export const EVIDENCE_RELATION_INPUT_KEYS = [
  "claim_document",
  "evidence_document",
  "obligation",
  "proposed_relation",
  "rationale",
] as const;
export const OBLIGATION_EXECUTION_INPUT_KEYS = [
  "brief_document",
  "obligation",
  "query_contract_document",
  "sql_artifact_document",
  "semantic_release_ref",
  "policy_receipt_ref",
  "evaluator_version",
] as const;
export const OBLIGATION_EXECUTION_INPUT_KEYS_WITH_ASSURANCE = [
  ...OBLIGATION_EXECUTION_INPUT_KEYS,
  "assurance",
] as const;
export const OBLIGATION_EXECUTION_RESOLUTION_KEYS = ["document", "derivation_input"] as const;
export const QUERY_EVIDENCE_RESOLUTION_KEYS = ["document", "derivation_input"] as const;
export const ATOMIC_CLAIM_RESOLUTION_KEYS = ["document", "derivation_input"] as const;
export const EVIDENCE_RELATION_RESOLUTION_KEYS = ["document", "derivation_input"] as const;
export const EVIDENCE_CHECK_INPUT_KEYS = [
  "claim_resolution",
  "relation_resolution",
  "query_evidence_resolutions",
  "check_kind",
  "evaluator_version",
] as const;
export const EVIDENCE_CHECK_RESOLUTION_KEYS = ["document", "derivation_input"] as const;
export const SUPPORT_DECISION_INPUT_KEYS = [
  "claim_resolution",
  "relation_resolutions",
  "check_resolutions",
  "evaluator_version",
] as const;
export const SUPPORT_DECISION_RESOLUTION_KEYS = ["document", "derivation_input"] as const;
export const HYPOTHESIS_ASSESSMENT_INPUT_KEYS = [
  "evidence_plan_document",
  "hypothesis_id",
  "support_decision_resolutions",
] as const;

export const QUERY_EVIDENCE_SCHEMA_HASH_DOMAIN = "u6-query-evidence-result-schema@1.0.0";
export const QUERY_EVIDENCE_PROVENANCE_HASH_DOMAIN = "u6-query-evidence-provenance@1.0.0";
export const CLAIM_TIME_WINDOW_HASH_DOMAIN = "u6-claim-time-window@1.0.0";
export const CLAIM_DIMENSION_SLICE_HASH_DOMAIN = "u6-claim-dimension-slice@1.0.0";
export const CLAIM_ROW_KEY_HASH_DOMAIN = "u6-claim-row-key@1.0.0";
export const CLAIM_RESULT_CELL_HASH_DOMAIN = "u6-claim-result-cell@1.0.0";

export const ATOMIC_CLAIM_RENDERER_VERSION = "u6-atomic-claim-renderer@1.0.0" as const;

/**
 * A proof obligation is resolved through a complete, content-addressed EvidencePlan
 * Candidate plus one embedded node id. A caller cannot bind an arbitrary ref to an
 * unrelated payload.
 */
export interface ResolvedProofObligation {
  readonly evidence_plan_document: L2ResearchDocumentCandidate;
  readonly obligation_id: string;
}

export interface QueryEvidenceL2Closure {
  readonly query_contract_document: L2ArtifactDocument;
  readonly sql_artifact_document: L2ArtifactDocument;
  readonly validation_receipt_document: L2ArtifactDocument;
  readonly execution_receipt_document: L2ArtifactDocument;
}

export interface QueryEvidenceSandboxClosure {
  readonly sandbox_execution_receipt: SuccessfulSandboxExecutionReceipt;
  readonly sandbox_result: SandboxResult;
}

export interface BuildQueryEvidenceCandidateInput {
  readonly obligation: ResolvedProofObligation;
  readonly obligation_execution_decision_resolution: ObligationExecutionDecisionDocumentResolution;
  readonly l2: QueryEvidenceL2Closure;
  readonly sandbox: QueryEvidenceSandboxClosure;
  readonly dependency_evidence_documents: readonly L2ResearchDocumentCandidate[];
  readonly observed_version: VersionFrontier;
}

export interface AtomicClaimIntent {
  readonly claim_id: string;
  readonly limitations: readonly string[];
}

export interface AtomicClaimRendererInput {
  readonly renderer_version: typeof ATOMIC_CLAIM_RENDERER_VERSION;
  readonly locale: "zh-CN";
}

/**
 * This is deliberately a minimal selector. Values, units and cell hashes are
 * always derived from the resolved QueryEvidence/QueryContract/SandboxResult.
 */
export interface ClaimObservationSelector {
  readonly binding_id: string;
  readonly output_alias: string;
  readonly row_index: 0;
}

export interface ClaimObservationSource {
  readonly query_evidence_document: L2ResearchDocumentCandidate;
  readonly query_contract_document: L2ArtifactDocument;
  readonly obligation: ResolvedProofObligation;
  readonly sandbox_result: SandboxResult;
  readonly selector: ClaimObservationSelector;
}

export interface BuildAtomicClaimCandidateInput {
  readonly claim_intent: AtomicClaimIntent;
  readonly predicate: AtomicClaimPredicate;
  readonly observation_sources: readonly ClaimObservationSource[];
  readonly renderer: AtomicClaimRendererInput;
}

export interface VerifyAtomicClaimDocumentDerivationInput {
  readonly claim_document: L2ResearchDocumentCandidate;
  readonly observation_sources: readonly ClaimObservationSource[];
}

export interface BuildEvidenceRelationCandidateInput {
  readonly claim_document: L2ResearchDocumentCandidate;
  readonly evidence_document: L2ResearchDocumentCandidate;
  readonly obligation: ResolvedProofObligation;
  readonly proposed_relation: EvidenceRelationV2Payload["proposed_relation"];
  readonly rationale: string;
}

/**
 * Complete deterministic input for the pre-Sandbox OED Candidate. The caller
 * supplies no boolean verdicts: all twelve checks are derived from exact
 * content-addressed documents and their semantic/policy references.
 */
export interface BuildObligationExecutionDecisionCandidateInput {
  readonly brief_document: L2ResearchDocumentCandidate;
  readonly obligation: ResolvedProofObligation;
  readonly query_contract_document: L2ArtifactDocument;
  readonly sql_artifact_document: L2ArtifactDocument;
  readonly semantic_release_ref: SemanticReleaseRef;
  readonly policy_receipt_ref: PolicyReceiptRef;
  readonly evaluator_version: string;
  /**
   * Opaque, process-local controlled-profile assurance. It is deliberately
   * typed as unknown because the issuer is not part of either package export.
   */
  readonly assurance?: unknown;
}

export interface ObligationExecutionDecisionDocumentResolution {
  readonly document: L2ResearchDocumentCandidate;
  readonly derivation_input: BuildObligationExecutionDecisionCandidateInput;
}

export interface QueryEvidenceDerivationResolution {
  readonly document: L2ResearchDocumentCandidate;
  readonly derivation_input: BuildQueryEvidenceCandidateInput;
}

export interface AtomicClaimDerivationResolution {
  readonly document: L2ResearchDocumentCandidate;
  readonly derivation_input: BuildAtomicClaimCandidateInput;
}

export interface EvidenceRelationDerivationResolution {
  readonly document: L2ResearchDocumentCandidate;
  readonly derivation_input: BuildEvidenceRelationCandidateInput;
}

export interface BuildEvidenceCheckCandidateInput {
  readonly claim_resolution: AtomicClaimDerivationResolution;
  readonly relation_resolution: EvidenceRelationDerivationResolution;
  readonly query_evidence_resolutions: readonly QueryEvidenceDerivationResolution[];
  readonly check_kind: EvidenceCheckReceiptPayload["check_kind"];
  readonly evaluator_version: string;
}

export interface EvidenceCheckDerivationResolution {
  readonly document: L2ResearchDocumentCandidate;
  readonly derivation_input: BuildEvidenceCheckCandidateInput;
}

export interface BuildSupportDecisionCandidateInput {
  readonly claim_resolution: AtomicClaimDerivationResolution;
  readonly relation_resolutions: readonly EvidenceRelationDerivationResolution[];
  readonly check_resolutions: readonly EvidenceCheckDerivationResolution[];
  readonly evaluator_version: string;
}

export interface SupportDecisionDerivationResolution {
  readonly document: L2ResearchDocumentCandidate;
  readonly derivation_input: BuildSupportDecisionCandidateInput;
}

export interface BuildHypothesisAssessmentCandidateInput {
  readonly evidence_plan_document: L2ResearchDocumentCandidate;
  readonly hypothesis_id: string;
  readonly support_decision_resolutions: readonly SupportDecisionDerivationResolution[];
}

export interface ResolvedObligation {
  readonly plan_document: L2ResearchDocumentCandidate;
  readonly plan_ref: ArtifactReference;
  readonly plan_brief_ref: ArtifactReference;
  readonly obligation_ref: ProofObligationRef;
  readonly obligation: ProofObligationV2;
  readonly observation_contract_hash: `sha256:${string}`;
}

export function hasExactKeys(value: unknown, expectedKeys: readonly string[]): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value);
  const expected = new Set(expectedKeys);
  return actualKeys.length === expected.size && actualKeys.every((key) => expected.has(key));
}

export function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function hasExactInputReferenceClosure(
  document: L2ArtifactDocument,
  expectedReferences: readonly ArtifactReference[],
): boolean {
  const actualIdentities = document.envelope.input_refs.map(artifactReferenceIdentity);
  const expectedIdentities = expectedReferences.map(artifactReferenceIdentity);
  return (
    new Set(actualIdentities).size === actualIdentities.length &&
    new Set(expectedIdentities).size === expectedIdentities.length &&
    sameIdentitySet(new Set(actualIdentities), new Set(expectedIdentities))
  );
}

export async function resolveProofObligation(
  input: ResolvedProofObligation,
  requestContext?: ResearchRequestReplayContext,
): Promise<ResearchKernelResult<ResolvedObligation>> {
  if (!hasExactKeys(input, RESOLVED_OBLIGATION_KEYS)) {
    return researchKernelFailure(
      "EVIDENCE_PLAN_INVALID",
      "Resolved Obligation 必须只包含 EvidencePlan Document 与 obligation_id。",
    );
  }
  const planResolution = await resolveResearchDocumentCandidate(
    input.evidence_plan_document,
    "EvidencePlan",
    requestContext,
  );
  if (!planResolution.ok) {
    return researchKernelFailure("EVIDENCE_PLAN_INVALID", planResolution.error.message);
  }
  const plan = planResolution.value.document.payload;
  if (plan.artifact_type !== "EvidencePlan") {
    return researchKernelFailure("EVIDENCE_PLAN_INVALID", "EvidencePlan 类型解析漂移。");
  }
  const observedGraphHash = await computeResearchKernelHash(
    "u6-obligation-graph@1",
    canonicalizeProofObligationGraph(plan.obligations),
  );
  if (observedGraphHash !== plan.obligation_graph_hash) {
    return researchKernelFailure(
      "EVIDENCE_PLAN_INVALID",
      "EvidencePlan obligation_graph_hash 与 production material 不匹配。",
    );
  }
  const obligation = plan.obligations.find(
    ({ obligation_id }) => obligation_id === input.obligation_id,
  );
  if (!obligation) {
    return researchKernelFailure(
      "EVIDENCE_PLAN_INVALID",
      "obligation_id 必须命中 resolved EvidencePlan 的 exact node。",
    );
  }
  const obligationRef = proofObligationRefSchema.safeParse({
    container_ref: planResolution.value.ref,
    node_id: obligation.obligation_id,
  });
  if (!obligationRef.success) {
    return researchKernelFailure(
      "EVIDENCE_PLAN_INVALID",
      obligationRef.error.issues[0]?.message ?? "ProofObligation Reference 无效。",
    );
  }
  const observationContract = obligation.observation_contract;
  const observedContractHash = await computeResearchKernelHash("u6-observation-contract@1", {
    metric_ref: observationContract.metric_ref,
    aggregation: observationContract.aggregation,
    unit: observationContract.unit,
    support_predicate: observationContract.support_predicate,
    refute_predicate: observationContract.refute_predicate,
    null_behavior: observationContract.null_behavior,
  });
  if (observedContractHash !== observationContract.contract_hash) {
    return researchKernelFailure(
      "EVIDENCE_PLAN_INVALID",
      "Obligation Observation Contract Hash 与 production material 不匹配。",
    );
  }
  return researchKernelSuccess({
    plan_document: planResolution.value.document,
    plan_ref: planResolution.value.ref,
    plan_brief_ref: plan.brief_ref,
    obligation_ref: obligationRef.data,
    obligation,
    observation_contract_hash: observedContractHash,
  });
}
