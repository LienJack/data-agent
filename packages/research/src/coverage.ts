import {
  type AtomicClaimRef,
  type AtomicClaimV2Payload,
  artifactReferenceIdentity,
  atomicClaimRefSchema,
  atomicClaimV2PayloadSchema,
  type CoverageStatePayload,
  canonicalizeJson,
  computeL2ResearchSemanticHash,
  coverageStatePayloadSchema,
  deriveCoverageCounts,
  type EvidenceCheckReceiptPayload,
  type EvidenceCheckReceiptRef,
  type EvidencePlanRef,
  type EvidencePlanV2Payload,
  type EvidenceRelationRef,
  type EvidenceRelationV2Payload,
  type ExecutionReceiptRef,
  embeddedNodeReferenceIdentity,
  evidenceCheckReceiptPayloadSchema,
  evidenceCheckReceiptRefSchema,
  evidencePlanRefSchema,
  evidencePlanV2PayloadSchema,
  evidenceRelationRefSchema,
  evidenceRelationV2PayloadSchema,
  executionReceiptRefSchema,
  type HypothesisAssessmentPayload,
  type HypothesisAssessmentRef,
  hypothesisAssessmentPayloadSchema,
  hypothesisAssessmentRefSchema,
  type L2ResearchDocumentCandidate,
  type ObligationExecutionDecisionPayload,
  type ObligationExecutionDecisionRef,
  obligationExecutionDecisionPayloadSchema,
  obligationExecutionDecisionRefSchema,
  type ProofObligationRef,
  proofObligationRefSchema,
  type QueryEvidenceRef,
  type QueryEvidenceV2Payload,
  queryEvidenceRefSchema,
  queryEvidenceV2PayloadSchema,
  type ResearchBudgetLedgerBinding,
  type SandboxExecutionReceiptRef,
  type SupportDecisionPayload,
  type SupportDecisionRef,
  sandboxExecutionReceiptRefSchema,
  supportDecisionPayloadSchema,
  supportDecisionRefSchema,
  U6_WIRE_LIMITS,
  type U6ResearchReasonCode,
  type VersionFrontier,
} from "@data-agent/contracts";
import {
  type ResearchKernelResult,
  researchKernelFailure,
  researchKernelSuccess,
} from "./errors.js";
import {
  buildHypothesisAssessmentCandidateWithReplayContext,
  resolveEvidenceCheckDerivationWithReplayContext,
  resolveSupportDecisionDerivationWithReplayContext,
} from "./evidence/check-support-assessment.js";
import {
  resolveAtomicClaimDerivationWithReplayContext,
  resolveEvidenceRelationDerivationWithReplayContext,
} from "./evidence/claim-relation.js";
import {
  resolveObligationExecutionDecisionDerivationWithReplayContext,
  resolveQueryEvidenceDerivationWithReplayContext,
} from "./evidence/oed-query.js";
import { createProofDerivationReplayContext } from "./evidence/proof-replay.js";
import type {
  AtomicClaimDerivationResolution,
  BuildAtomicClaimCandidateInput,
  BuildEvidenceCheckCandidateInput,
  BuildEvidenceRelationCandidateInput,
  BuildHypothesisAssessmentCandidateInput,
  BuildQueryEvidenceCandidateInput,
  BuildSupportDecisionCandidateInput,
  EvidenceCheckDerivationResolution,
  EvidenceRelationDerivationResolution,
  ObligationExecutionDecisionDocumentResolution,
  QueryEvidenceDerivationResolution,
  SupportDecisionDerivationResolution,
} from "./evidence/shared.js";
import { classifySupportDecisionOutcome } from "./evidence.js";
import { preflightResearchInput } from "./input-budget.js";
import {
  type ResearchPayloadFor,
  type ResolvedResearchDocumentCandidate,
  resolveResearchDocumentCandidate,
} from "./internal/document-resolution.js";
import { computeResearchKernelHash } from "./internal/hash.js";
import {
  hasExactReferenceIdentitySet,
  mapByReferenceIdentity,
  type ArtifactReferenceFor as ResearchReferenceFor,
  sameReferenceScope,
  uniqueReferences,
} from "./internal/reference-identity.js";
import {
  memoizeSuccessfulResearchReplay,
  type ResearchRequestReplayContext,
} from "./internal/request-replay-context.js";
import { exactObjectKeys } from "./internal/value-shape.js";

export type { ObligationExecutionDecisionDocumentResolution } from "./evidence/shared.js";

export interface ResolvedResearchArtifact<Reference, Payload> {
  readonly ref: Reference;
  readonly payload: Payload;
}

export interface ObligationBlocker {
  readonly obligation_ref: ProofObligationRef;
  readonly waiting_on_codes: readonly string[];
}

export interface ExecutionFailureResolution {
  readonly obligation_ref: ProofObligationRef;
  readonly execution_receipt_ref: ExecutionReceiptRef;
  readonly sandbox_execution_receipt_ref: SandboxExecutionReceiptRef;
  readonly execution_status: "FAILED";
  readonly sandbox_terminal: "FAILED" | "POLICY_BLOCKED";
  readonly reason_code: "CRITICAL_OBLIGATION_FAILED";
}

/**
 * Internal resolved-facts form used by the deterministic reducer after every
 * Research Document Candidate has passed strict wire/content-address checks.
 *
 * It is intentionally not re-exported from the package root: callers must use
 * the document-backed `DeriveCoverageStateInput` boundary below.
 */
export interface DeriveCoverageStateResolvedFactsInput {
  readonly evidence_plan_ref: EvidencePlanRef;
  readonly evidence_plan: EvidencePlanV2Payload;
  readonly obligation_execution_decisions: readonly ResolvedResearchArtifact<
    ObligationExecutionDecisionRef,
    ObligationExecutionDecisionPayload
  >[];
  readonly query_evidence: readonly ResolvedResearchArtifact<
    QueryEvidenceRef,
    QueryEvidenceV2Payload
  >[];
  readonly atomic_claims: readonly ResolvedResearchArtifact<AtomicClaimRef, AtomicClaimV2Payload>[];
  readonly evidence_relations: readonly ResolvedResearchArtifact<
    EvidenceRelationRef,
    EvidenceRelationV2Payload
  >[];
  readonly evidence_checks: readonly ResolvedResearchArtifact<
    EvidenceCheckReceiptRef,
    EvidenceCheckReceiptPayload
  >[];
  readonly support_decisions: readonly ResolvedResearchArtifact<
    SupportDecisionRef,
    SupportDecisionPayload
  >[];
  readonly hypothesis_assessments: readonly ResolvedResearchArtifact<
    HypothesisAssessmentRef,
    HypothesisAssessmentPayload
  >[];
  readonly blockers: readonly ObligationBlocker[];
  readonly execution_failure_resolutions: readonly ExecutionFailureResolution[];
  readonly budget_ledger: ResearchBudgetLedgerBinding;
  readonly current_version_frontier: VersionFrontier;
}

export interface DeriveCoverageStateInput {
  readonly evidence_plan_document: L2ResearchDocumentCandidate;
  readonly obligation_execution_decision_resolutions: readonly ObligationExecutionDecisionDocumentResolution[];
  readonly query_evidence_resolutions: readonly QueryEvidenceDocumentResolution[];
  readonly atomic_claim_resolutions: readonly AtomicClaimDocumentResolution[];
  readonly evidence_relation_resolutions: readonly EvidenceRelationDocumentResolution[];
  readonly evidence_check_resolutions: readonly EvidenceCheckDocumentResolution[];
  readonly support_decision_resolutions: readonly SupportDecisionDocumentResolution[];
  readonly hypothesis_assessment_resolutions: readonly HypothesisAssessmentDocumentResolution[];
  readonly blockers: readonly ObligationBlocker[];
  readonly execution_failure_resolutions: readonly ExecutionFailureResolution[];
  readonly budget_ledger: ResearchBudgetLedgerBinding;
  readonly current_version_frontier: VersionFrontier;
}

export interface QueryEvidenceDocumentResolution extends QueryEvidenceDerivationResolution {
  readonly document: L2ResearchDocumentCandidate;
  readonly derivation_input: BuildQueryEvidenceCandidateInput;
}

export interface AtomicClaimDocumentResolution extends AtomicClaimDerivationResolution {
  readonly document: L2ResearchDocumentCandidate;
  readonly derivation_input: BuildAtomicClaimCandidateInput;
}

export interface EvidenceRelationDocumentResolution extends EvidenceRelationDerivationResolution {
  readonly document: L2ResearchDocumentCandidate;
  readonly derivation_input: BuildEvidenceRelationCandidateInput;
}

export interface EvidenceCheckDocumentResolution extends EvidenceCheckDerivationResolution {
  readonly document: L2ResearchDocumentCandidate;
  readonly derivation_input: BuildEvidenceCheckCandidateInput;
}

export interface SupportDecisionDocumentResolution extends SupportDecisionDerivationResolution {
  readonly document: L2ResearchDocumentCandidate;
  readonly derivation_input: BuildSupportDecisionCandidateInput;
}

export interface HypothesisAssessmentDocumentResolution {
  readonly document: L2ResearchDocumentCandidate;
  readonly derivation_input: BuildHypothesisAssessmentCandidateInput;
}

function exactExecutionFailureResolution(value: ExecutionFailureResolution): boolean {
  return (
    exactObjectKeys(value, [
      "obligation_ref",
      "execution_receipt_ref",
      "sandbox_execution_receipt_ref",
      "execution_status",
      "sandbox_terminal",
      "reason_code",
    ]) &&
    executionReceiptRefSchema.safeParse(value.execution_receipt_ref).success &&
    sandboxExecutionReceiptRefSchema.safeParse(value.sandbox_execution_receipt_ref).success &&
    value.execution_status === "FAILED" &&
    ["FAILED", "POLICY_BLOCKED"].includes(value.sandbox_terminal) &&
    value.reason_code === "CRITICAL_OBLIGATION_FAILED"
  );
}

function allReferencesBelongToPlan(
  input: DeriveCoverageStateResolvedFactsInput,
  planObligations: ReadonlySet<string>,
): boolean {
  const obligationRefs = [
    ...input.obligation_execution_decisions.map(({ payload }) => payload.obligation_ref),
    ...input.query_evidence.map(({ payload }) => payload.obligation_ref),
    ...input.evidence_relations.map(({ payload }) => payload.obligation_ref),
    ...input.support_decisions.flatMap(({ payload }) => payload.obligation_refs),
    ...input.blockers.map(({ obligation_ref }) => obligation_ref),
    ...input.execution_failure_resolutions.map(({ obligation_ref }) => obligation_ref),
  ];
  return obligationRefs.every((reference) =>
    planObligations.has(embeddedNodeReferenceIdentity(reference)),
  );
}

function validateResolvedClosure(input: DeriveCoverageStateResolvedFactsInput): string | null {
  const resolvedReferenceGroups = [
    [input.obligation_execution_decisions, obligationExecutionDecisionRefSchema],
    [input.query_evidence, queryEvidenceRefSchema],
    [input.atomic_claims, atomicClaimRefSchema],
    [input.evidence_relations, evidenceRelationRefSchema],
    [input.evidence_checks, evidenceCheckReceiptRefSchema],
    [input.support_decisions, supportDecisionRefSchema],
    [input.hypothesis_assessments, hypothesisAssessmentRefSchema],
  ] as const;
  if (
    !evidencePlanRefSchema.safeParse(input.evidence_plan_ref).success ||
    resolvedReferenceGroups.some(([values, schema]) =>
      values.some(
        (value) =>
          !exactObjectKeys(value, ["ref", "payload"]) ||
          !schema.safeParse(value.ref).success ||
          !sameReferenceScope(input.evidence_plan_ref, value.ref),
      ),
    ) ||
    !sameReferenceScope(
      input.evidence_plan_ref,
      input.current_version_frontier.semantic_release_ref,
    ) ||
    !sameReferenceScope(
      input.evidence_plan_ref,
      input.current_version_frontier.schema_snapshot_ref,
    ) ||
    !sameReferenceScope(input.evidence_plan_ref, input.current_version_frontier.policy_receipt_ref)
  ) {
    return "Coverage outer Reference 必须 strict、exact 且属于 EvidencePlan 同一 Scope/Run。";
  }
  if (
    !evidencePlanV2PayloadSchema.safeParse(input.evidence_plan).success ||
    input.obligation_execution_decisions.some(
      ({ payload }) => !obligationExecutionDecisionPayloadSchema.safeParse(payload).success,
    ) ||
    input.query_evidence.some(
      ({ payload }) => !queryEvidenceV2PayloadSchema.safeParse(payload).success,
    ) ||
    input.atomic_claims.some(
      ({ payload }) => !atomicClaimV2PayloadSchema.safeParse(payload).success,
    ) ||
    input.evidence_relations.some(
      ({ payload }) => !evidenceRelationV2PayloadSchema.safeParse(payload).success,
    ) ||
    input.evidence_checks.some(
      ({ payload }) => !evidenceCheckReceiptPayloadSchema.safeParse(payload).success,
    ) ||
    input.support_decisions.some(
      ({ payload }) => !supportDecisionPayloadSchema.safeParse(payload).success,
    ) ||
    input.hypothesis_assessments.some(
      ({ payload }) => !hypothesisAssessmentPayloadSchema.safeParse(payload).success,
    )
  ) {
    return "Coverage authority-shaped resolved payload 必须全部通过 strict wire schema。";
  }
  if (
    !sameReferenceScope(input.evidence_plan_ref, input.evidence_plan.brief_ref) ||
    !sameReferenceScope(input.evidence_plan_ref, input.evidence_plan.hypothesis_set_ref)
  ) {
    return "EvidencePlan 的 Brief/HypothesisSet 必须与 Coverage Closure 同 Scope/Run。";
  }
  const planObligations = new Map(
    input.evidence_plan.obligations.map((obligation) => [
      embeddedNodeReferenceIdentity({
        container_ref: input.evidence_plan_ref,
        node_id: obligation.obligation_id,
      }),
      obligation,
    ]),
  );
  if (
    planObligations.size !== input.evidence_plan.obligations.length ||
    !allReferencesBelongToPlan(input, new Set(planObligations.keys()))
  ) {
    return "Coverage 必须精确枚举 EvidencePlan 全部 Obligation，且不能混入外部 Obligation。";
  }
  const blockerIdentities = input.blockers.map(({ obligation_ref }) =>
    embeddedNodeReferenceIdentity(obligation_ref),
  );
  if (
    input.blockers.some(
      (blocker) =>
        !exactObjectKeys(blocker, ["obligation_ref", "waiting_on_codes"]) ||
        !proofObligationRefSchema.safeParse(blocker.obligation_ref).success ||
        !Array.isArray(blocker.waiting_on_codes) ||
        blocker.waiting_on_codes.length === 0 ||
        new Set(blocker.waiting_on_codes).size !== blocker.waiting_on_codes.length ||
        blocker.waiting_on_codes.some((code) => typeof code !== "string" || code.length === 0),
    ) ||
    new Set(blockerIdentities).size !== blockerIdentities.length
  ) {
    return "同一 Obligation 只能有一项 strict、唯一且非空的 active Blocker。";
  }
  const executionFailureIdentities = input.execution_failure_resolutions.map(({ obligation_ref }) =>
    embeddedNodeReferenceIdentity(obligation_ref),
  );
  const executionFailureReceiptIdentities = input.execution_failure_resolutions.flatMap(
    ({ execution_receipt_ref, sandbox_execution_receipt_ref }) => [
      artifactReferenceIdentity(execution_receipt_ref),
      artifactReferenceIdentity(sandbox_execution_receipt_ref),
    ],
  );
  if (
    input.execution_failure_resolutions.some(
      (resolution) =>
        !exactExecutionFailureResolution(resolution) ||
        !proofObligationRefSchema.safeParse(resolution.obligation_ref).success ||
        [resolution.execution_receipt_ref, resolution.sandbox_execution_receipt_ref].some(
          (reference) =>
            reference.app_id !== input.evidence_plan_ref.app_id ||
            reference.tenant_id !== input.evidence_plan_ref.tenant_id ||
            reference.environment !== input.evidence_plan_ref.environment ||
            reference.run_id !== input.evidence_plan_ref.run_id,
        ),
    ) ||
    new Set(executionFailureIdentities).size !== executionFailureIdentities.length ||
    new Set(executionFailureReceiptIdentities).size !== executionFailureReceiptIdentities.length
  ) {
    return "Execution Failure Resolution 必须是计划内、同 Scope/Run、唯一且 strict 的失败执行事实。";
  }

  const oedByRef = mapByReferenceIdentity(input.obligation_execution_decisions);
  const evidenceByRef = mapByReferenceIdentity(input.query_evidence);
  const claimByRef = mapByReferenceIdentity(input.atomic_claims);
  const relationByRef = mapByReferenceIdentity(input.evidence_relations);
  const checkByRef = mapByReferenceIdentity(input.evidence_checks);
  const supportByRef = mapByReferenceIdentity(input.support_decisions);
  const assessmentByRef = mapByReferenceIdentity(input.hypothesis_assessments);
  if (
    !oedByRef ||
    !evidenceByRef ||
    !claimByRef ||
    !relationByRef ||
    !checkByRef ||
    !supportByRef ||
    !assessmentByRef
  ) {
    return "Coverage resolved closure 不能包含重复 exact Reference。";
  }

  const hypothesisObligations = new Map<string, Set<string>>();
  for (const [obligationIdentity, obligation] of planObligations) {
    for (const hypothesisRef of obligation.hypothesis_refs) {
      const hypothesisIdentity = embeddedNodeReferenceIdentity(hypothesisRef);
      const obligations = hypothesisObligations.get(hypothesisIdentity) ?? new Set();
      obligations.add(obligationIdentity);
      hypothesisObligations.set(hypothesisIdentity, obligations);
    }
  }

  if (
    input.obligation_execution_decisions.some(({ payload }) => {
      const obligation = planObligations.get(embeddedNodeReferenceIdentity(payload.obligation_ref));
      return (
        !obligation ||
        payload.observation_contract_hash !== obligation.observation_contract.contract_hash
      );
    })
  ) {
    return "Coverage OED 必须绑定计划内 Obligation 与 exact Observation Contract。";
  }

  if (
    input.query_evidence.some(({ payload }) => {
      const oed = oedByRef.get(
        artifactReferenceIdentity(payload.obligation_execution_decision_ref),
      )?.payload;
      const obligationIdentity = embeddedNodeReferenceIdentity(payload.obligation_ref);
      const planObligation = planObligations.get(obligationIdentity);
      const allowedDependencyObligations = new Set(
        planObligation?.depends_on.map(({ node_id }) =>
          embeddedNodeReferenceIdentity({
            container_ref: input.evidence_plan_ref,
            node_id,
          }),
        ),
      );
      const resolvedDependencies = payload.dependency_evidence_refs.map((reference) =>
        evidenceByRef.get(artifactReferenceIdentity(reference)),
      );
      const actualDependencyObligations = resolvedDependencies.flatMap((dependency) =>
        dependency ? [embeddedNodeReferenceIdentity(dependency.payload.obligation_ref)] : [],
      );
      if (!oed) return true;
      return (
        oed.verdict !== "PASS" ||
        embeddedNodeReferenceIdentity(oed.obligation_ref) !== obligationIdentity ||
        artifactReferenceIdentity(oed.query_contract_ref) !==
          artifactReferenceIdentity(payload.query_contract_ref) ||
        resolvedDependencies.some((dependency) => dependency === undefined) ||
        actualDependencyObligations.length !== allowedDependencyObligations.size ||
        new Set(actualDependencyObligations).size !== actualDependencyObligations.length ||
        actualDependencyObligations.some((identity) => !allowedDependencyObligations.has(identity))
      );
    })
  ) {
    return "QueryEvidence 必须绑定同 Obligation 的 OED、QueryContract 与计划依赖证据。";
  }

  if (
    input.atomic_claims.some(({ payload }) => {
      const evidenceIdentities = new Set(payload.evidence_refs.map(artifactReferenceIdentity));
      const bindingEvidenceIdentities = new Set(
        payload.observation_bindings.map(({ evidence_ref }) =>
          artifactReferenceIdentity(evidence_ref),
        ),
      );
      return (
        evidenceIdentities.size !== payload.evidence_refs.length ||
        !hasExactReferenceIdentitySet(payload.evidence_refs, bindingEvidenceIdentities) ||
        [...evidenceIdentities].some((identity) => !evidenceByRef.has(identity))
      );
    })
  ) {
    return "AtomicClaim 必须精确绑定已解析 QueryEvidence 与 Observation Binding。";
  }

  const relationPairIdentities = new Set<string>();
  if (
    input.evidence_relations.some(({ payload }) => {
      const claim = claimByRef.get(artifactReferenceIdentity(payload.claim_ref))?.payload;
      const evidence = evidenceByRef.get(artifactReferenceIdentity(payload.evidence_ref))?.payload;
      const pairIdentity = `${artifactReferenceIdentity(
        payload.claim_ref,
      )}\0${artifactReferenceIdentity(payload.evidence_ref)}`;
      if (relationPairIdentities.has(pairIdentity)) return true;
      relationPairIdentities.add(pairIdentity);
      return (
        !claim ||
        !evidence ||
        !claim.evidence_refs.some(
          (reference) =>
            artifactReferenceIdentity(reference) ===
            artifactReferenceIdentity(payload.evidence_ref),
        ) ||
        embeddedNodeReferenceIdentity(evidence.obligation_ref) !==
          embeddedNodeReferenceIdentity(payload.obligation_ref)
      );
    })
  ) {
    return "EvidenceRelation 的 Claim×Evidence×Obligation 必须属于同一 resolved closure。";
  }
  for (const { ref: claimRef, payload: claim } of input.atomic_claims) {
    const claimIdentity = artifactReferenceIdentity(claimRef);
    const expectedEvidenceIdentities = new Set(claim.evidence_refs.map(artifactReferenceIdentity));
    const actualEvidenceIdentities = input.evidence_relations
      .filter(({ payload }) => artifactReferenceIdentity(payload.claim_ref) === claimIdentity)
      .map(({ payload }) => artifactReferenceIdentity(payload.evidence_ref));
    if (
      actualEvidenceIdentities.length !== expectedEvidenceIdentities.size ||
      new Set(actualEvidenceIdentities).size !== actualEvidenceIdentities.length ||
      actualEvidenceIdentities.some(
        (evidenceIdentity) => !expectedEvidenceIdentities.has(evidenceIdentity),
      )
    ) {
      return "每个 AtomicClaim×evidence_ref 必须恰好存在一张 active EvidenceRelation，不能遗漏 adverse evidence。";
    }
  }

  const checkKindsByRelation = new Map<string, Set<EvidenceCheckReceiptPayload["check_kind"]>>();
  for (const { payload } of input.evidence_checks) {
    const relationIdentity = artifactReferenceIdentity(payload.relation_ref);
    if (!relationByRef.has(relationIdentity)) {
      return "EvidenceCheckReceipt 必须绑定已解析 Relation。";
    }
    const kinds = checkKindsByRelation.get(relationIdentity) ?? new Set();
    if (kinds.has(payload.check_kind)) {
      return "每张 Relation 的 DET/PROV Check 必须唯一。";
    }
    kinds.add(payload.check_kind);
    checkKindsByRelation.set(relationIdentity, kinds);
  }
  if (
    [...relationByRef.keys()].some((identity) => {
      const kinds = checkKindsByRelation.get(identity);
      return (
        kinds?.size !== 2 || !kinds.has("DETERMINISTIC_CHECK") || !kinds.has("PROVENANCE_CHECK")
      );
    })
  ) {
    return "每张 Relation 必须恰好闭合 DET 与 PROV 两类 Check。";
  }

  if (
    input.support_decisions.some(({ payload }) => {
      const claimIdentity = artifactReferenceIdentity(payload.claim_ref);
      const relationIdentities = new Set(payload.relation_refs.map(artifactReferenceIdentity));
      const allClaimRelationIdentities = new Set(
        input.evidence_relations
          .filter(
            ({ payload: relation }) =>
              artifactReferenceIdentity(relation.claim_ref) === claimIdentity,
          )
          .map(({ ref }) => artifactReferenceIdentity(ref)),
      );
      const obligationIdentities = new Set(
        payload.obligation_refs.map(embeddedNodeReferenceIdentity),
      );
      const expectedCheckIdentities = new Set<string>();
      if (
        !claimByRef.has(claimIdentity) ||
        !hasExactReferenceIdentitySet(payload.relation_refs, allClaimRelationIdentities) ||
        relationIdentities.size !== payload.relation_refs.length ||
        obligationIdentities.size !== payload.obligation_refs.length ||
        obligationIdentities.size !== 1
      ) {
        return true;
      }
      for (const relationIdentity of relationIdentities) {
        const relation = relationByRef.get(relationIdentity)?.payload;
        if (
          !relation ||
          artifactReferenceIdentity(relation.claim_ref) !== claimIdentity ||
          !obligationIdentities.has(embeddedNodeReferenceIdentity(relation.obligation_ref))
        ) {
          return true;
        }
        for (const [checkIdentity, check] of checkByRef) {
          if (artifactReferenceIdentity(check.payload.relation_ref) === relationIdentity) {
            expectedCheckIdentities.add(checkIdentity);
          }
        }
      }
      if (!hasExactReferenceIdentitySet(payload.check_receipt_refs, expectedCheckIdentities)) {
        return true;
      }
      const resolvedRelations = payload.relation_refs.map(
        (reference) => relationByRef.get(artifactReferenceIdentity(reference))?.payload,
      );
      const resolvedChecks = payload.check_receipt_refs.map(
        (reference) => checkByRef.get(artifactReferenceIdentity(reference))?.payload,
      );
      if (
        resolvedRelations.some((relation) => relation === undefined) ||
        resolvedChecks.some((check) => check === undefined)
      ) {
        return true;
      }
      const relations = resolvedRelations as EvidenceRelationV2Payload[];
      const checks = resolvedChecks as EvidenceCheckReceiptPayload[];
      const { decision: expectedDecision, reason_codes: expectedReasons } =
        classifySupportDecisionOutcome(relations, checks);
      return (
        payload.decision !== expectedDecision ||
        canonicalizeJson([...payload.reason_codes].sort()) !== canonicalizeJson(expectedReasons)
      );
    })
  ) {
    return "SupportDecision 必须重算并精确闭合自身 Claim、Relation、Check、Decision 与 Reason。";
  }
  const supportedClaimIdentities = input.support_decisions.map(({ payload }) =>
    artifactReferenceIdentity(payload.claim_ref),
  );
  const supportedClaimIdentitySet = new Set(supportedClaimIdentities);
  if (
    supportedClaimIdentitySet.size !== supportedClaimIdentities.length ||
    supportedClaimIdentitySet.size !== claimByRef.size ||
    [...claimByRef.keys()].some((identity) => !supportedClaimIdentitySet.has(identity))
  ) {
    return "每张 AtomicClaim 必须恰好闭合一张 SupportDecision，不能省略失败检查链。";
  }

  const assessedHypotheses = new Set<string>();
  for (const { payload } of input.hypothesis_assessments) {
    const hypothesisIdentity = embeddedNodeReferenceIdentity(payload.hypothesis_ref);
    const allowedObligations = hypothesisObligations.get(hypothesisIdentity);
    const relevantSupports = input.support_decisions.filter(({ payload: support }) =>
      support.obligation_refs.some((reference) =>
        allowedObligations?.has(embeddedNodeReferenceIdentity(reference)),
      ),
    );
    const expectedSupportIdentities = new Set(
      relevantSupports.map(({ ref }) => artifactReferenceIdentity(ref)),
    );
    const unresolvedObligations = new Set(
      [...(allowedObligations ?? [])].filter((obligationIdentity) => {
        const decisions = relevantSupports.filter(({ payload: support }) =>
          support.obligation_refs.some(
            (reference) => embeddedNodeReferenceIdentity(reference) === obligationIdentity,
          ),
        );
        return (
          decisions.length === 0 ||
          decisions.every(({ payload: support }) =>
            ["CONFLICTED", "INSUFFICIENT", "UNSUPPORTED"].includes(support.decision),
          )
        );
      }),
    );
    const decisionStates = new Set(
      relevantSupports.map(({ payload: support }) => support.decision),
    );
    const expectedStatus: HypothesisAssessmentPayload["status"] = decisionStates.has("REFUTED")
      ? "REFUTED"
      : unresolvedObligations.size > 0
        ? "UNRESOLVED"
        : decisionStates.has("SUPPORTED")
          ? "SURVIVED"
          : "TESTED";
    const expectedUnresolved =
      expectedStatus === "UNRESOLVED" ? unresolvedObligations : new Set<string>();
    const expectedReasons: U6ResearchReasonCode[] =
      expectedStatus === "SURVIVED" || expectedStatus === "REFUTED"
        ? ["OBLIGATION_SATISFIED"]
        : expectedStatus === "UNRESOLVED"
          ? ["EVIDENCE_COVERAGE_INSUFFICIENT"]
          : ["EVIDENCE_SUPPORT_INSUFFICIENT"];
    const actualUnresolvedIdentities = new Set(
      payload.unresolved_obligation_refs.map(embeddedNodeReferenceIdentity),
    );
    if (
      !allowedObligations ||
      assessedHypotheses.has(hypothesisIdentity) ||
      !hasExactReferenceIdentitySet(payload.support_decision_refs, expectedSupportIdentities) ||
      actualUnresolvedIdentities.size !== payload.unresolved_obligation_refs.length ||
      actualUnresolvedIdentities.size !== expectedUnresolved.size ||
      [...actualUnresolvedIdentities].some((identity) => !expectedUnresolved.has(identity)) ||
      payload.status !== expectedStatus ||
      canonicalizeJson(payload.reason_codes) !== canonicalizeJson(expectedReasons)
    ) {
      return "HypothesisAssessment 必须精确重算该 Hypothesis 的 Support、Status 与 unresolved closure。";
    }
    assessedHypotheses.add(hypothesisIdentity);
  }
  if (
    assessedHypotheses.size !== hypothesisObligations.size ||
    [...hypothesisObligations.keys()].some((identity) => !assessedHypotheses.has(identity))
  ) {
    return "Coverage 必须对计划内每个 Hypothesis 提供唯一 Assessment。";
  }
  return null;
}

function reasonForFailedObligation(input: {
  readonly conflicts: readonly ResolvedResearchArtifact<
    EvidenceRelationRef,
    EvidenceRelationV2Payload
  >[];
  readonly oeds: readonly ResolvedResearchArtifact<
    ObligationExecutionDecisionRef,
    ObligationExecutionDecisionPayload
  >[];
  readonly supports: readonly ResolvedResearchArtifact<
    SupportDecisionRef,
    SupportDecisionPayload
  >[];
}): U6ResearchReasonCode {
  if (input.conflicts.length > 0) return "MATERIAL_CONFLICT_UNDISCLOSED";
  const oedReason = input.oeds.flatMap(({ payload }) => payload.reason_codes)[0];
  if (oedReason) return oedReason;
  const supportReason = input.supports.flatMap(({ payload }) => payload.reason_codes)[0];
  return supportReason ?? "CRITICAL_OBLIGATION_FAILED";
}

async function resolvedCandidateHashesAreValid(
  input: DeriveCoverageStateResolvedFactsInput,
): Promise<boolean> {
  const oedHashes = await Promise.all(
    input.obligation_execution_decisions.map(async ({ payload }) => {
      return payload.decision_semantic_hash === (await computeL2ResearchSemanticHash(payload));
    }),
  );
  const checkHashes = await Promise.all(
    input.evidence_checks.map(async ({ payload }) => {
      const {
        artifact_type: _artifactType,
        protocol_version: _protocolVersion,
        check_input_hash: declared,
        ...material
      } = payload;
      return declared === (await computeResearchKernelHash("u6-evidence-check@1", material));
    }),
  );
  const supportHashes = await Promise.all(
    input.support_decisions.map(async ({ payload }) => {
      const {
        artifact_type: _artifactType,
        protocol_version: _protocolVersion,
        input_closure_hash: declared,
        ...material
      } = payload;
      return declared === (await computeResearchKernelHash("u6-support-decision@1", material));
    }),
  );
  const statementHashes = await Promise.all(
    input.atomic_claims.map(
      async ({ payload }) =>
        payload.statement_hash ===
        (await computeResearchKernelHash("u6-atomic-claim-statement@1", {
          renderer_version: payload.claim_renderer_version,
          locale: "zh-CN",
          statement: payload.statement,
        })),
    ),
  );
  return [...oedHashes, ...checkHashes, ...supportHashes, ...statementHashes].every(Boolean);
}

export async function deriveCoverageStateFromResolvedFactsCandidate(
  input: DeriveCoverageStateResolvedFactsInput,
): Promise<ResearchKernelResult<CoverageStatePayload>> {
  const budget = preflightResearchInput(input, {
    array_limits: [
      {
        path: ["obligation_execution_decisions"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
      { path: ["query_evidence"], max_items: U6_WIRE_LIMITS.max_obligations },
      { path: ["atomic_claims"], max_items: U6_WIRE_LIMITS.max_obligations },
      {
        path: ["evidence_relations"],
        max_items: U6_WIRE_LIMITS.max_obligations * 2,
      },
      {
        path: ["evidence_checks"],
        max_items: U6_WIRE_LIMITS.max_obligations * 4,
      },
      {
        path: ["support_decisions"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
      {
        path: ["hypothesis_assessments"],
        max_items: U6_WIRE_LIMITS.max_hypotheses,
      },
      { path: ["blockers"], max_items: U6_WIRE_LIMITS.max_obligations },
      {
        path: ["execution_failure_resolutions"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
    ],
  });
  if (!budget.ok) return budget;

  const closureError = validateResolvedClosure(input);
  if (closureError) {
    return researchKernelFailure("COVERAGE_INPUT_INVALID", closureError);
  }
  if (!(await resolvedCandidateHashesAreValid(input))) {
    return researchKernelFailure(
      "COVERAGE_INPUT_INVALID",
      "Coverage resolved Candidate 的领域 hash 必须由完整 payload 重算。",
    );
  }
  const claimsByEvidence = new Set(
    input.atomic_claims.flatMap(({ payload }) =>
      payload.evidence_refs.map(artifactReferenceIdentity),
    ),
  );
  const assessmentsByHypothesis = new Set(
    input.hypothesis_assessments.map(({ payload }) =>
      embeddedNodeReferenceIdentity(payload.hypothesis_ref),
    ),
  );
  const blockerByObligation = new Map(
    input.blockers.map((blocker) => [
      embeddedNodeReferenceIdentity(blocker.obligation_ref),
      blocker,
    ]),
  );
  const executionFailureByObligation = new Map(
    input.execution_failure_resolutions.map((resolution) => [
      embeddedNodeReferenceIdentity(resolution.obligation_ref),
      resolution,
    ]),
  );
  const obligations = input.evidence_plan.obligations.map((planObligation) => {
    const obligation_ref: ProofObligationRef = {
      container_ref: input.evidence_plan_ref,
      node_id: planObligation.obligation_id,
    };
    const identity = embeddedNodeReferenceIdentity(obligation_ref);
    const oeds = input.obligation_execution_decisions.filter(
      ({ payload }) => embeddedNodeReferenceIdentity(payload.obligation_ref) === identity,
    );
    const evidence = input.query_evidence.filter(
      ({ payload }) => embeddedNodeReferenceIdentity(payload.obligation_ref) === identity,
    );
    const relations = input.evidence_relations.filter(
      ({ payload }) => embeddedNodeReferenceIdentity(payload.obligation_ref) === identity,
    );
    const supports = input.support_decisions.filter(({ payload }) =>
      payload.obligation_refs.some(
        (reference) => embeddedNodeReferenceIdentity(reference) === identity,
      ),
    );
    const conflicts = relations.filter(({ payload }) => payload.proposed_relation === "CONFLICTS");
    const executionFailure = executionFailureByObligation.get(identity);
    const frontierStale = evidence.some(
      ({ payload }) =>
        canonicalizeJson(payload.observed_version) !==
        canonicalizeJson(input.current_version_frontier),
    );
    const failed =
      executionFailure !== undefined ||
      oeds.some(({ payload }) => payload.verdict === "FAIL") ||
      supports.some(({ payload }) =>
        ["CONFLICTED", "INSUFFICIENT", "UNSUPPORTED"].includes(payload.decision),
      ) ||
      conflicts.length > 0;
    const blocker = blockerByObligation.get(identity);
    const allHypothesesAssessed = planObligation.hypothesis_refs.every((reference) =>
      assessmentsByHypothesis.has(embeddedNodeReferenceIdentity(reference)),
    );
    const evidenceClaimed =
      evidence.length > 0 &&
      evidence.every(({ ref }) => claimsByEvidence.has(artifactReferenceIdentity(ref)));
    const satisfied =
      oeds.some(({ payload }) => payload.verdict === "PASS") &&
      evidence.length > 0 &&
      supports.some(({ payload }) => ["SUPPORTED", "REFUTED"].includes(payload.decision)) &&
      allHypothesesAssessed &&
      evidenceClaimed;

    let state: CoverageStatePayload["obligations"][number]["state"];
    let reason_codes: U6ResearchReasonCode[];
    if (frontierStale) {
      state = "STALE";
      reason_codes = ["EVIDENCE_REVISION_STALE"];
    } else if (failed) {
      state = "FAILED";
      reason_codes = [
        executionFailure?.reason_code ?? reasonForFailedObligation({ conflicts, oeds, supports }),
      ];
    } else if (blocker && blocker.waiting_on_codes.length > 0) {
      state = "BLOCKED";
      reason_codes = ["EVIDENCE_COVERAGE_INSUFFICIENT"];
    } else if (satisfied) {
      state = "SATISFIED";
      reason_codes = ["OBLIGATION_SATISFIED"];
    } else {
      state = "OPEN";
      reason_codes = ["EVIDENCE_COVERAGE_INSUFFICIENT"];
    }
    return {
      obligation_ref,
      materiality: planObligation.materiality,
      state,
      obligation_execution_decision_refs: oeds.map(({ ref }) => ref),
      query_evidence_refs: evidence.map(({ ref }) => ref),
      support_decision_refs: supports.map(({ ref }) => ref),
      conflict_refs: conflicts.map(({ ref }) => ref),
      reason_codes,
    };
  });
  const material_conflict_refs = uniqueReferences(
    input.evidence_relations
      .filter(({ payload }) => payload.proposed_relation === "CONFLICTS")
      .map(({ ref }) => ref),
  );
  const version_frontier_hash = await computeResearchKernelHash(
    "u6-version-frontier@1",
    input.current_version_frontier,
  );
  const candidateMaterial = {
    evidence_plan_ref: input.evidence_plan_ref,
    obligation_execution_decision_refs: uniqueReferences(
      input.obligation_execution_decisions.map(({ ref }) => ref),
    ),
    query_evidence_refs: uniqueReferences(input.query_evidence.map(({ ref }) => ref)),
    atomic_claim_refs: uniqueReferences(input.atomic_claims.map(({ ref }) => ref)),
    evidence_relation_refs: uniqueReferences(input.evidence_relations.map(({ ref }) => ref)),
    support_decision_refs: uniqueReferences(input.support_decisions.map(({ ref }) => ref)),
    hypothesis_assessment_refs: uniqueReferences(
      input.hypothesis_assessments.map(({ ref }) => ref),
    ),
    obligations,
    derived_counts: deriveCoverageCounts(obligations),
    material_conflict_refs,
    budget_ledger: input.budget_ledger,
    version_frontier: input.current_version_frontier,
    version_frontier_hash,
  } as const;
  const hashMaterial = {
    ...candidateMaterial,
    evidence_check_refs: uniqueReferences(input.evidence_checks.map(({ ref }) => ref)),
    blockers: input.blockers,
    execution_failure_resolutions: input.execution_failure_resolutions,
  } as const;
  const candidate = {
    artifact_type: "CoverageState",
    protocol_version: "coverage-state@1.0.0",
    ...candidateMaterial,
    coverage_input_hash: await computeResearchKernelHash("u6-coverage@1", hashMaterial),
  } as const;
  const parsed = coverageStatePayloadSchema.safeParse(candidate);
  return parsed.success
    ? researchKernelSuccess(parsed.data)
    : researchKernelFailure(
        "COVERAGE_INPUT_INVALID",
        parsed.error.issues[0]?.message ?? "Coverage Candidate 无效。",
      );
}

const COVERAGE_DOCUMENT_INPUT_KEYS = [
  "evidence_plan_document",
  "obligation_execution_decision_resolutions",
  "query_evidence_resolutions",
  "atomic_claim_resolutions",
  "evidence_relation_resolutions",
  "evidence_check_resolutions",
  "support_decision_resolutions",
  "hypothesis_assessment_resolutions",
  "blockers",
  "execution_failure_resolutions",
  "budget_ledger",
  "current_version_frontier",
] as const;

type ResearchArtifactType = L2ResearchDocumentCandidate["payload"]["artifact_type"];
type ResolvedResearchDocumentFor<ArtifactType extends ResearchArtifactType> =
  ResolvedResearchDocumentCandidate<ArtifactType>;

async function resolveTypedResearchDocumentCandidate<ArtifactType extends ResearchArtifactType>(
  input: unknown,
  artifactType: ArtifactType,
  requestContext?: ResearchRequestReplayContext,
): Promise<ResearchKernelResult<ResolvedResearchDocumentFor<ArtifactType>>> {
  return resolveResearchDocumentCandidate(input, artifactType, requestContext);
}

async function resolveDerivedResearchDocuments<
  ArtifactType extends ResearchArtifactType,
  DerivationInput,
>(
  resolutions: readonly {
    readonly document: L2ResearchDocumentCandidate;
    readonly derivation_input: DerivationInput;
  }[],
  artifactType: ArtifactType,
  derive: (resolution: {
    readonly document: L2ResearchDocumentCandidate;
    readonly derivation_input: DerivationInput;
  }) => Promise<ResearchKernelResult<ResearchPayloadFor<ArtifactType>>>,
  requestContext?: ResearchRequestReplayContext,
): Promise<
  ResearchKernelResult<
    readonly ResolvedResearchArtifact<
      ResearchReferenceFor<ArtifactType>,
      ResearchPayloadFor<ArtifactType>
    >[]
  >
> {
  if (
    !Array.isArray(resolutions) ||
    resolutions.some((resolution) => !exactObjectKeys(resolution, ["document", "derivation_input"]))
  ) {
    return researchKernelFailure(
      "COVERAGE_INPUT_INVALID",
      `${artifactType} derivation resolutions 必须是 exact object 数组。`,
    );
  }
  const resolved: ResolvedResearchArtifact<
    ResearchReferenceFor<ArtifactType>,
    ResearchPayloadFor<ArtifactType>
  >[] = [];
  for (const resolution of resolutions) {
    const document = await resolveTypedResearchDocumentCandidate(
      resolution.document,
      artifactType,
      requestContext,
    );
    if (!document.ok) {
      return researchKernelFailure("COVERAGE_INPUT_INVALID", document.error.message);
    }
    const derived = await derive(resolution);
    if (
      !derived.ok ||
      canonicalizeJson(derived.value) !== canonicalizeJson(document.value.document.payload)
    ) {
      return researchKernelFailure(
        "COVERAGE_INPUT_INVALID",
        derived.ok
          ? `${artifactType} Document payload 与 production builder 重派生结果不一致。`
          : derived.error.message,
      );
    }
    resolved.push({
      ref: document.value.ref,
      payload: document.value.document.payload,
    });
  }
  return researchKernelSuccess(resolved);
}

/**
 * Public Coverage boundary. Every fact-bearing Research Artifact is a complete,
 * content-addressed Candidate document; refs are always derived from envelopes.
 * This proves candidate integrity only, never persistence/current authority.
 */
async function deriveCoverageStateCandidateUncached(
  input: DeriveCoverageStateInput,
  requestContext?: ResearchRequestReplayContext,
): Promise<ResearchKernelResult<CoverageStatePayload>> {
  const budget = preflightResearchInput(input, {
    array_limits: [
      {
        path: ["obligation_execution_decision_resolutions"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
      {
        path: ["query_evidence_resolutions"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
      {
        path: ["atomic_claim_resolutions"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
      {
        path: ["evidence_relation_resolutions"],
        max_items: U6_WIRE_LIMITS.max_obligations * 2,
      },
      {
        path: ["evidence_check_resolutions"],
        max_items: U6_WIRE_LIMITS.max_obligations * 4,
      },
      {
        path: ["support_decision_resolutions"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
      {
        path: ["hypothesis_assessment_resolutions"],
        max_items: U6_WIRE_LIMITS.max_hypotheses,
      },
      { path: ["blockers"], max_items: U6_WIRE_LIMITS.max_obligations },
      {
        path: ["execution_failure_resolutions"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
    ],
  });
  if (!budget.ok) return budget;

  if (
    !exactObjectKeys(input, COVERAGE_DOCUMENT_INPUT_KEYS) ||
    !Array.isArray(input.obligation_execution_decision_resolutions) ||
    input.obligation_execution_decision_resolutions.length > U6_WIRE_LIMITS.max_obligations ||
    !Array.isArray(input.query_evidence_resolutions) ||
    input.query_evidence_resolutions.length > U6_WIRE_LIMITS.max_obligations ||
    !Array.isArray(input.atomic_claim_resolutions) ||
    input.atomic_claim_resolutions.length > U6_WIRE_LIMITS.max_obligations ||
    !Array.isArray(input.evidence_relation_resolutions) ||
    input.evidence_relation_resolutions.length > U6_WIRE_LIMITS.max_obligations * 2 ||
    !Array.isArray(input.evidence_check_resolutions) ||
    input.evidence_check_resolutions.length > U6_WIRE_LIMITS.max_obligations * 4 ||
    !Array.isArray(input.support_decision_resolutions) ||
    input.support_decision_resolutions.length > U6_WIRE_LIMITS.max_obligations ||
    !Array.isArray(input.hypothesis_assessment_resolutions) ||
    input.hypothesis_assessment_resolutions.length > U6_WIRE_LIMITS.max_hypotheses ||
    !Array.isArray(input.blockers) ||
    !Array.isArray(input.execution_failure_resolutions)
  ) {
    return researchKernelFailure(
      "COVERAGE_INPUT_INVALID",
      "Coverage 输入必须是 exact document closure 与数组。",
    );
  }
  const plan = await resolveTypedResearchDocumentCandidate(
    input.evidence_plan_document,
    "EvidencePlan",
    requestContext,
  );
  if (!plan.ok) {
    return researchKernelFailure("COVERAGE_INPUT_INVALID", plan.error.message);
  }
  const replayContext = createProofDerivationReplayContext(requestContext);
  const [oeds, evidence, claims, relations, checks, supports, assessments] = await Promise.all([
    resolveDerivedResearchDocuments<
      "ObligationExecutionDecision",
      ObligationExecutionDecisionDocumentResolution["derivation_input"]
    >(
      input.obligation_execution_decision_resolutions,
      "ObligationExecutionDecision",
      async (resolution) => {
        const replayed = await resolveObligationExecutionDecisionDerivationWithReplayContext(
          resolution,
          replayContext,
        );
        return replayed.ok ? researchKernelSuccess(replayed.value.payload) : replayed;
      },
      requestContext,
    ),
    resolveDerivedResearchDocuments<"QueryEvidence", BuildQueryEvidenceCandidateInput>(
      input.query_evidence_resolutions,
      "QueryEvidence",
      async (resolution) => {
        const replayed = await resolveQueryEvidenceDerivationWithReplayContext(
          resolution,
          replayContext,
        );
        return replayed.ok ? researchKernelSuccess(replayed.value.payload) : replayed;
      },
      requestContext,
    ),
    resolveDerivedResearchDocuments<"AtomicClaim", BuildAtomicClaimCandidateInput>(
      input.atomic_claim_resolutions,
      "AtomicClaim",
      async (resolution) => {
        const replayed = await resolveAtomicClaimDerivationWithReplayContext(
          resolution,
          replayContext,
        );
        return replayed.ok ? researchKernelSuccess(replayed.value.payload) : replayed;
      },
      requestContext,
    ),
    resolveDerivedResearchDocuments<"EvidenceRelation", BuildEvidenceRelationCandidateInput>(
      input.evidence_relation_resolutions,
      "EvidenceRelation",
      async (resolution) => {
        const replayed = await resolveEvidenceRelationDerivationWithReplayContext(
          resolution,
          replayContext,
        );
        return replayed.ok ? researchKernelSuccess(replayed.value.payload) : replayed;
      },
      requestContext,
    ),
    resolveDerivedResearchDocuments<"EvidenceCheckReceipt", BuildEvidenceCheckCandidateInput>(
      input.evidence_check_resolutions,
      "EvidenceCheckReceipt",
      async (resolution) => {
        const replayed = await resolveEvidenceCheckDerivationWithReplayContext(
          resolution,
          replayContext,
        );
        return replayed.ok ? researchKernelSuccess(replayed.value.payload) : replayed;
      },
      requestContext,
    ),
    resolveDerivedResearchDocuments<"SupportDecision", BuildSupportDecisionCandidateInput>(
      input.support_decision_resolutions,
      "SupportDecision",
      async (resolution) => {
        const replayed = await resolveSupportDecisionDerivationWithReplayContext(
          resolution,
          replayContext,
        );
        return replayed.ok ? researchKernelSuccess(replayed.value.payload) : replayed;
      },
      requestContext,
    ),
    resolveDerivedResearchDocuments<
      "HypothesisAssessment",
      BuildHypothesisAssessmentCandidateInput
    >(
      input.hypothesis_assessment_resolutions,
      "HypothesisAssessment",
      ({ derivation_input }) =>
        buildHypothesisAssessmentCandidateWithReplayContext(derivation_input, replayContext),
      requestContext,
    ),
  ]);
  if (!oeds.ok) return oeds;
  if (!evidence.ok) return evidence;
  if (!claims.ok) return claims;
  if (!relations.ok) return relations;
  if (!checks.ok) return checks;
  if (!supports.ok) return supports;
  if (!assessments.ok) return assessments;

  return deriveCoverageStateFromResolvedFactsCandidate({
    evidence_plan_ref: plan.value.ref,
    evidence_plan: plan.value.document.payload,
    obligation_execution_decisions: oeds.value,
    query_evidence: evidence.value,
    atomic_claims: claims.value,
    evidence_relations: relations.value,
    evidence_checks: checks.value,
    support_decisions: supports.value,
    hypothesis_assessments: assessments.value,
    blockers: input.blockers,
    execution_failure_resolutions: input.execution_failure_resolutions,
    budget_ledger: input.budget_ledger,
    current_version_frontier: input.current_version_frontier,
  });
}

export function deriveCoverageStateCandidate(
  input: DeriveCoverageStateInput,
): Promise<ResearchKernelResult<CoverageStatePayload>> {
  return deriveCoverageStateCandidateUncached(input);
}

export function deriveCoverageStateCandidateWithReplayContext(
  input: DeriveCoverageStateInput,
  requestContext: ResearchRequestReplayContext,
): Promise<ResearchKernelResult<CoverageStatePayload>> {
  return memoizeSuccessfulResearchReplay(requestContext, "stage:coverage", input, () =>
    deriveCoverageStateCandidateUncached(input, requestContext),
  );
}

export function unresolvedCoverageObligationRefs(
  coverage: CoverageStatePayload,
): ProofObligationRef[] {
  return coverage.obligations
    .filter(({ state }) => state === "OPEN" || state === "BLOCKED" || state === "FAILED")
    .map(({ obligation_ref }) => obligation_ref);
}
