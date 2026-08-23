import {
  type AtomicClaimRef,
  type AtomicClaimV2Payload,
  artifactReferenceIdentity,
  atomicClaimV2PayloadSchema,
  computeL2ResearchSemanticHash,
  type EvidenceCheckReceiptPayload,
  type EvidenceCheckReceiptRef,
  type EvidenceRelationRef,
  type EvidenceRelationV2Payload,
  embeddedNodeReferenceIdentity,
  evidenceCheckReceiptPayloadSchema,
  type HypothesisAssessmentPayload,
  type HypothesisRef,
  hypothesisAssessmentPayloadSchema,
  OBLIGATION_SEMANTIC_CHECKS,
  type ObligationExecutionDecisionPayload,
  obligationExecutionDecisionPayloadSchema,
  type PolicyReceiptRef,
  type ProofObligationRef,
  type QueryContractRef,
  type ResearchBriefRef,
  type SchemaSnapshotRef,
  type SemanticReleaseRef,
  type SqlArtifactRef,
  type SupportDecisionPayload,
  type SupportDecisionRef,
  supportDecisionPayloadSchema,
  type U6ResearchReasonCode,
} from "@data-agent/contracts";
import {
  type ResearchKernelResult,
  researchKernelFailure,
  researchKernelSuccess,
} from "./errors.js";
import { computeResearchKernelHash } from "./internal/hash.js";

export type ObligationSemanticCheckName = (typeof OBLIGATION_SEMANTIC_CHECKS)[number];

export interface EvaluateObligationExecutionInput {
  readonly brief_ref: ResearchBriefRef;
  readonly obligation_ref: ProofObligationRef;
  readonly query_contract_ref: QueryContractRef;
  readonly sql_artifact_ref: SqlArtifactRef;
  readonly semantic_release_ref: SemanticReleaseRef;
  readonly policy_receipt_ref: PolicyReceiptRef;
  readonly observation_contract_hash: `sha256:${string}`;
  readonly matches: Readonly<Record<ObligationSemanticCheckName, boolean>>;
  readonly evaluator_version: string;
}

/**
 * Source-only reducer. `matches` must come from
 * buildObligationExecutionDecisionCandidate; this function is intentionally
 * absent from the package root and does not validate document derivation.
 */
export async function evaluateObligationExecution(
  input: EvaluateObligationExecutionInput,
): Promise<ResearchKernelResult<ObligationExecutionDecisionPayload>> {
  const checks = Object.fromEntries(
    OBLIGATION_SEMANTIC_CHECKS.map((check) => [check, input.matches[check] ? "MATCH" : "MISMATCH"]),
  ) as ObligationExecutionDecisionPayload["checks"];
  const verdict = Object.values(checks).every((check) => check === "MATCH") ? "PASS" : "FAIL";
  const reason_codes: U6ResearchReasonCode[] =
    verdict === "PASS" ? [] : ["OBLIGATION_QUERY_SEMANTICS_MISMATCH"];
  const decisionWithoutHash = {
    artifact_type: "ObligationExecutionDecision",
    protocol_version: "obligation-execution@2.0.0",
    brief_ref: input.brief_ref,
    obligation_ref: input.obligation_ref,
    query_contract_ref: input.query_contract_ref,
    sql_artifact_ref: input.sql_artifact_ref,
    semantic_release_ref: input.semantic_release_ref,
    policy_receipt_ref: input.policy_receipt_ref,
    observation_contract_hash: input.observation_contract_hash,
    verdict,
    checks,
    reason_codes,
    evaluator_version: input.evaluator_version,
  } as const;
  const decision_semantic_hash = await computeL2ResearchSemanticHash({
    ...decisionWithoutHash,
    decision_semantic_hash: `sha256:${"0".repeat(64)}`,
  });
  const candidate = {
    ...decisionWithoutHash,
    decision_semantic_hash,
  };
  const parsed = obligationExecutionDecisionPayloadSchema.safeParse(candidate);
  return parsed.success
    ? researchKernelSuccess(parsed.data)
    : researchKernelFailure(
        "OBLIGATION_QUERY_SEMANTICS_MISMATCH",
        parsed.error.issues[0]?.message ?? "OED Candidate 无效。",
      );
}

export interface DeriveEvidenceCheckInput {
  readonly relation_ref: EvidenceRelationRef;
  readonly check_kind: "DETERMINISTIC_CHECK" | "PROVENANCE_CHECK";
  readonly passed: boolean;
  readonly observed_contract_hash: `sha256:${string}`;
  readonly evaluated_refs: EvidenceCheckReceiptPayload["evaluated_refs"];
  readonly evaluator_version: string;
  readonly failure_reason?: U6ResearchReasonCode;
}

/**
 * Source-only reducer. The public builder derives `passed` from the exact
 * Plan/Evidence/Claim/Relation/Sandbox closure.
 */
export async function deriveEvidenceCheckReceipt(
  input: DeriveEvidenceCheckInput,
): Promise<ResearchKernelResult<EvidenceCheckReceiptPayload>> {
  const reason_codes: U6ResearchReasonCode[] = input.passed
    ? []
    : [input.failure_reason ?? "EVIDENCE_SUPPORT_INSUFFICIENT"];
  const hashMaterial = {
    relation_ref: input.relation_ref,
    check_kind: input.check_kind,
    verdict: input.passed ? "PASS" : "FAIL",
    observed_contract_hash: input.observed_contract_hash,
    evaluated_refs: input.evaluated_refs,
    reason_codes,
    evaluator_version: input.evaluator_version,
  } as const;
  const candidate = {
    artifact_type: "EvidenceCheckReceipt",
    protocol_version: "evidence-check@1.0.0",
    ...hashMaterial,
    check_input_hash: await computeResearchKernelHash("u6-evidence-check@1", hashMaterial),
  } as const;
  const parsed = evidenceCheckReceiptPayloadSchema.safeParse(candidate);
  return parsed.success
    ? researchKernelSuccess(parsed.data)
    : researchKernelFailure(
        "EVIDENCE_SUPPORT_INSUFFICIENT",
        parsed.error.issues[0]?.message ?? "Evidence Check Candidate 无效。",
      );
}

export interface EvidenceRelationResolution {
  readonly ref: EvidenceRelationRef;
  readonly payload: EvidenceRelationV2Payload;
}

export interface EvidenceCheckResolution {
  readonly ref: EvidenceCheckReceiptRef;
  readonly payload: EvidenceCheckReceiptPayload;
}

export interface DeriveSupportDecisionInput {
  readonly claim_ref: AtomicClaimRef;
  readonly claim: AtomicClaimV2Payload;
  readonly relations: readonly EvidenceRelationResolution[];
  readonly checks: readonly EvidenceCheckResolution[];
  readonly evaluator_version: string;
}

export interface SupportDecisionClassification {
  readonly decision: SupportDecisionPayload["decision"];
  readonly reason_codes: readonly U6ResearchReasonCode[];
}

/**
 * Package-private deterministic classifier shared by the Support builder and
 * downstream replay validators. Callers must establish Relation/Check
 * uniqueness and exact closure before invoking it.
 */
export function classifySupportDecisionOutcome(
  relations: readonly EvidenceRelationV2Payload[],
  checks: readonly EvidenceCheckReceiptPayload[],
): SupportDecisionClassification {
  const failedChecks = checks.filter(({ verdict }) => verdict === "FAIL");
  if (failedChecks.length > 0) {
    return {
      decision: "INSUFFICIENT",
      reason_codes: [
        ...new Set(
          failedChecks.flatMap(({ reason_codes }) =>
            reason_codes.length > 0 ? reason_codes : ["EVIDENCE_SUPPORT_INSUFFICIENT" as const],
          ),
        ),
      ].sort(),
    };
  }

  const proposedRelations = new Set(relations.map(({ proposed_relation }) => proposed_relation));
  const hasDecisiveRelation =
    proposedRelations.has("SUPPORTS") ||
    proposedRelations.has("REFUTES") ||
    proposedRelations.has("CONFLICTS");
  const hasNonDecisiveRelation =
    proposedRelations.has("QUALIFIES") || proposedRelations.has("CONTEXT_ONLY");

  if (
    proposedRelations.has("CONFLICTS") ||
    (proposedRelations.has("SUPPORTS") && proposedRelations.has("REFUTES"))
  ) {
    return {
      decision: "CONFLICTED",
      reason_codes: ["MATERIAL_CONFLICT_UNDISCLOSED"],
    };
  }
  if (hasNonDecisiveRelation && hasDecisiveRelation) {
    return {
      decision: "INSUFFICIENT",
      reason_codes: ["EVIDENCE_SUPPORT_INSUFFICIENT"],
    };
  }
  if (proposedRelations.size === 1 && proposedRelations.has("REFUTES")) {
    return {
      decision: "REFUTED",
      reason_codes: ["OBLIGATION_SATISFIED"],
    };
  }
  if (proposedRelations.size === 1 && proposedRelations.has("SUPPORTS")) {
    return {
      decision: "SUPPORTED",
      reason_codes: ["OBLIGATION_SATISFIED"],
    };
  }
  return {
    decision: relations.length > 0 ? "INSUFFICIENT" : "UNSUPPORTED",
    reason_codes: ["EVIDENCE_SUPPORT_INSUFFICIENT"],
  };
}

function relationIdentity(relation: EvidenceRelationV2Payload): string {
  return [
    artifactReferenceIdentity(relation.claim_ref),
    artifactReferenceIdentity(relation.evidence_ref),
  ].join("\0");
}

/**
 * Source-only reducer. Public callers must use the document-backed support
 * builder so Relation and Check payloads are replayed before this transition.
 */
export async function deriveSupportDecision(
  input: DeriveSupportDecisionInput,
): Promise<ResearchKernelResult<SupportDecisionPayload>> {
  const parsedClaim = atomicClaimV2PayloadSchema.safeParse(input.claim);
  if (!parsedClaim.success) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "SupportDecision 必须消费完整、有效的 AtomicClaim payload。",
    );
  }
  const claim = parsedClaim.data;
  const expectedEvidenceIdentities = new Set(claim.evidence_refs.map(artifactReferenceIdentity));
  const relationEvidenceIdentities = input.relations.map(({ payload }) =>
    artifactReferenceIdentity(payload.evidence_ref),
  );
  const relationRefIdentities = input.relations.map(({ ref }) => artifactReferenceIdentity(ref));
  const proposedKindsByEvidence = new Map<
    string,
    Set<EvidenceRelationV2Payload["proposed_relation"]>
  >();
  for (const { payload } of input.relations) {
    const identity = artifactReferenceIdentity(payload.evidence_ref);
    const kinds = proposedKindsByEvidence.get(identity) ?? new Set();
    kinds.add(payload.proposed_relation);
    proposedKindsByEvidence.set(identity, kinds);
  }
  if ([...proposedKindsByEvidence.values()].some((kinds) => kinds.size > 1)) {
    return researchKernelFailure(
      "EVIDENCE_RELATION_IDENTITY_CONFLICT",
      "同一 exact Claim×Evidence 不能同时声明冲突的 active Relation。",
    );
  }
  if (
    expectedEvidenceIdentities.size !== claim.evidence_refs.length ||
    relationEvidenceIdentities.length !== expectedEvidenceIdentities.size ||
    new Set(relationEvidenceIdentities).size !== relationEvidenceIdentities.length ||
    new Set(relationRefIdentities).size !== relationRefIdentities.length ||
    relationEvidenceIdentities.some((identity) => !expectedEvidenceIdentities.has(identity))
  ) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "SupportDecision 必须消费 AtomicClaim 全部 evidence_refs 的唯一 active Relation。",
    );
  }
  const relationKinds = new Map<string, Set<EvidenceRelationV2Payload["proposed_relation"]>>();
  for (const { payload } of input.relations) {
    if (
      artifactReferenceIdentity(payload.claim_ref) !== artifactReferenceIdentity(input.claim_ref)
    ) {
      return researchKernelFailure(
        "EVIDENCE_SUPPORT_INSUFFICIENT",
        "SupportDecision 不能消费绑定其他 Claim 的 Relation。",
      );
    }
    const identity = relationIdentity(payload);
    const kinds = relationKinds.get(identity) ?? new Set();
    kinds.add(payload.proposed_relation);
    relationKinds.set(identity, kinds);
  }
  if ([...relationKinds.values()].some((kinds) => kinds.size > 1)) {
    return researchKernelFailure(
      "EVIDENCE_RELATION_IDENTITY_CONFLICT",
      "同一 exact Claim×Evidence 不能同时声明冲突的 active Relation。",
    );
  }

  const checkKindsByRelation = new Map<string, Set<EvidenceCheckReceiptPayload["check_kind"]>>();
  const failedRelations = new Set<string>();
  const knownRelations = new Set(input.relations.map(({ ref }) => artifactReferenceIdentity(ref)));
  const seenChecks = new Set<string>();
  for (const { payload } of input.checks) {
    const identity = artifactReferenceIdentity(payload.relation_ref);
    const checkIdentity = `${identity}\0${payload.check_kind}`;
    if (!knownRelations.has(identity) || seenChecks.has(checkIdentity)) {
      return researchKernelFailure(
        "EVIDENCE_SUPPORT_INSUFFICIENT",
        "Evidence Check 必须唯一且绑定输入 Relation。",
      );
    }
    seenChecks.add(checkIdentity);
    const kinds = checkKindsByRelation.get(identity) ?? new Set();
    kinds.add(payload.check_kind);
    checkKindsByRelation.set(identity, kinds);
    if (payload.verdict !== "PASS") failedRelations.add(identity);
  }

  const passingRelations = input.relations.filter(({ ref }) => {
    const identity = artifactReferenceIdentity(ref);
    const checkKinds = checkKindsByRelation.get(identity);
    return (
      !failedRelations.has(identity) &&
      checkKinds?.has("DETERMINISTIC_CHECK") === true &&
      checkKinds.has("PROVENANCE_CHECK")
    );
  });
  if (
    [...knownRelations].some((identity) => {
      const kinds = checkKindsByRelation.get(identity);
      return (
        kinds?.size !== 2 || !kinds.has("DETERMINISTIC_CHECK") || !kinds.has("PROVENANCE_CHECK")
      );
    })
  ) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "每个 Relation 必须恰好闭合 DETERMINISTIC 与 PROVENANCE 两张 Check。",
    );
  }
  const classification = classifySupportDecisionOutcome(
    passingRelations.map(({ payload }) => payload),
    input.checks.map(({ payload }) => payload),
  );
  const { decision, reason_codes } = classification;
  const obligationRefs = new Map<string, ProofObligationRef>();
  for (const { payload } of input.relations) {
    obligationRefs.set(
      `${artifactReferenceIdentity(payload.obligation_ref.container_ref)}\0${
        payload.obligation_ref.node_id
      }`,
      payload.obligation_ref,
    );
  }
  if (obligationRefs.size !== 1) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "单张 SupportDecision 的 Relation 必须绑定同一个 Proof Obligation。",
    );
  }
  const relation_refs = input.relations.map(({ ref }) => ref);
  const check_receipt_refs = input.checks.map(({ ref }) => ref);
  if (relation_refs.length === 0 || check_receipt_refs.length < 2) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "SupportDecision 必须闭合 Relation、两类 Evidence Check 与 Obligation。",
    );
  }
  const hashMaterial = {
    claim_ref: input.claim_ref,
    relation_refs,
    check_receipt_refs,
    obligation_refs: [...obligationRefs.values()],
    decision,
    reason_codes,
    evaluator_version: input.evaluator_version,
  } as const;
  const candidate = {
    artifact_type: "SupportDecision",
    protocol_version: "support-decision@1.0.0",
    ...hashMaterial,
    input_closure_hash: await computeResearchKernelHash("u6-support-decision@1", hashMaterial),
  } as const;
  const parsed = supportDecisionPayloadSchema.safeParse(candidate);
  return parsed.success
    ? researchKernelSuccess(parsed.data)
    : researchKernelFailure(
        "EVIDENCE_SUPPORT_INSUFFICIENT",
        parsed.error.issues[0]?.message ?? "SupportDecision Candidate 无效。",
      );
}

export interface SupportDecisionResolution {
  readonly ref: SupportDecisionRef;
  readonly payload: SupportDecisionPayload;
  readonly claim: {
    readonly ref: AtomicClaimRef;
    readonly payload: AtomicClaimV2Payload;
  };
}

export interface AssessHypothesisInput {
  readonly hypothesis_ref: HypothesisRef;
  readonly decisions: readonly SupportDecisionResolution[];
  readonly hypothesis_obligation_refs: readonly ProofObligationRef[];
  readonly unresolved_obligation_refs: readonly ProofObligationRef[];
}

/**
 * Source-only reducer. The public HypothesisAssessment builder derives the
 * unresolved set from the EvidencePlan and verified Support/Claim closure.
 */
export function assessHypothesis(
  input: AssessHypothesisInput,
): ResearchKernelResult<HypothesisAssessmentPayload> {
  const allowedObligations = new Set(
    input.hypothesis_obligation_refs.map(embeddedNodeReferenceIdentity),
  );
  const unresolvedIdentities = input.unresolved_obligation_refs.map(embeddedNodeReferenceIdentity);
  const unresolvedSet = new Set(unresolvedIdentities);
  const decisionRefs = input.decisions.map(({ ref }) => artifactReferenceIdentity(ref));
  const decisionClaimRefs = input.decisions.map(({ claim }) =>
    artifactReferenceIdentity(claim.ref),
  );
  const resolvedDecisionObligations = input.decisions
    .filter(({ payload }) => ["SUPPORTED", "REFUTED"].includes(payload.decision))
    .flatMap(({ payload }) => payload.obligation_refs.map(embeddedNodeReferenceIdentity));
  const unresolvedDecisionObligations = input.decisions
    .filter(({ payload }) => !["SUPPORTED", "REFUTED"].includes(payload.decision))
    .flatMap(({ payload }) => payload.obligation_refs.map(embeddedNodeReferenceIdentity));
  const accountedObligations = new Set([...resolvedDecisionObligations, ...unresolvedIdentities]);
  if (
    allowedObligations.size === 0 ||
    allowedObligations.size !== input.hypothesis_obligation_refs.length ||
    unresolvedSet.size !== unresolvedIdentities.length ||
    new Set(decisionRefs).size !== decisionRefs.length ||
    new Set(decisionClaimRefs).size !== decisionClaimRefs.length ||
    input.decisions.some(({ payload }) =>
      payload.obligation_refs.some(
        (reference) => !allowedObligations.has(embeddedNodeReferenceIdentity(reference)),
      ),
    ) ||
    input.decisions.some(
      ({ payload, claim }) =>
        artifactReferenceIdentity(payload.claim_ref) !== artifactReferenceIdentity(claim.ref) ||
        claim.payload.evidence_refs.length === 0,
    ) ||
    input.unresolved_obligation_refs.some(
      (reference) => !allowedObligations.has(embeddedNodeReferenceIdentity(reference)),
    ) ||
    resolvedDecisionObligations.some((identity) => unresolvedSet.has(identity)) ||
    unresolvedDecisionObligations.some((identity) => !unresolvedSet.has(identity)) ||
    accountedObligations.size !== allowedObligations.size ||
    [...allowedObligations].some((identity) => !accountedObligations.has(identity))
  ) {
    return researchKernelFailure(
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      "HypothesisAssessment 只能消费该 Hypothesis 的完整 Obligation Closure。",
    );
  }
  const decisionStates = new Set(input.decisions.map(({ payload }) => payload.decision));
  let status: HypothesisAssessmentPayload["status"];
  let reason_codes: U6ResearchReasonCode[];
  if (decisionStates.has("REFUTED")) {
    status = "REFUTED";
    reason_codes = ["OBLIGATION_SATISFIED"];
  } else if (input.unresolved_obligation_refs.length > 0) {
    status = "UNRESOLVED";
    reason_codes = ["EVIDENCE_COVERAGE_INSUFFICIENT"];
  } else if (decisionStates.has("SUPPORTED")) {
    status = "SURVIVED";
    reason_codes = ["OBLIGATION_SATISFIED"];
  } else if (input.decisions.length > 0) {
    status = "TESTED";
    reason_codes = ["EVIDENCE_SUPPORT_INSUFFICIENT"];
  } else {
    status = "UNRESOLVED";
    reason_codes = ["EVIDENCE_COVERAGE_INSUFFICIENT"];
  }
  const candidate = {
    artifact_type: "HypothesisAssessment",
    protocol_version: "hypothesis-assessment@1.0.0",
    hypothesis_ref: input.hypothesis_ref,
    support_decision_refs: input.decisions.map(({ ref }) => ref),
    status,
    unresolved_obligation_refs:
      status === "UNRESOLVED" ? [...input.unresolved_obligation_refs] : [],
    reason_codes,
  } as const;
  const parsed = hypothesisAssessmentPayloadSchema.safeParse(candidate);
  return parsed.success
    ? researchKernelSuccess(parsed.data)
    : researchKernelFailure(
        "EVIDENCE_SUPPORT_INSUFFICIENT",
        parsed.error.issues[0]?.message ?? "HypothesisAssessment Candidate 无效。",
      );
}

export interface SchemaFrontierBinding {
  readonly schema_snapshot_ref: SchemaSnapshotRef;
}

export function materialSchemaFrontierMatches(
  certificate: SchemaFrontierBinding,
  materialEvidence: readonly SchemaFrontierBinding[],
): boolean {
  const expected = artifactReferenceIdentity(certificate.schema_snapshot_ref);
  return materialEvidence.every(
    ({ schema_snapshot_ref }) => artifactReferenceIdentity(schema_snapshot_ref) === expected,
  );
}
