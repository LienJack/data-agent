import {
  type AnalysisReportRef,
  type AnalysisReportV2Payload,
  type AtomicClaimRef,
  type AtomicClaimV2Payload,
  analysisReportRefSchema,
  analysisReportV2PayloadSchema,
  artifactReferenceIdentity,
  atomicClaimRefSchema,
  atomicClaimV2PayloadSchema,
  canonicalizeJson,
  type EvidenceCheckReceiptPayload,
  type EvidenceCheckReceiptRef,
  type EvidenceGateReceiptPayload,
  type EvidenceRelationRef,
  type EvidenceRelationV2Payload,
  evidenceCheckReceiptPayloadSchema,
  evidenceCheckReceiptRefSchema,
  evidenceGateReceiptPayloadSchema,
  evidenceRelationRefSchema,
  evidenceRelationV2PayloadSchema,
  type HypothesisAssessmentPayload,
  type HypothesisAssessmentRef,
  hypothesisAssessmentPayloadSchema,
  hypothesisAssessmentRefSchema,
  type L2ResearchDocumentCandidate,
  type QueryEvidenceRef,
  type QueryEvidenceV2Payload,
  queryEvidenceRefSchema,
  queryEvidenceV2PayloadSchema,
  type ReportManifestRef,
  type ReportManifestV2Payload,
  type ResearchBriefRef,
  type ResearchBriefV2Payload,
  reportManifestRefSchema,
  reportManifestV2PayloadSchema,
  researchBriefRefSchema,
  researchBriefV2PayloadSchema,
  type SupportDecisionPayload,
  type SupportDecisionRef,
  supportDecisionPayloadSchema,
  supportDecisionRefSchema,
  U6_WIRE_LIMITS,
  type VersionFrontier,
  versionFrontierSchema,
} from "@data-agent/contracts";
import type {
  AtomicClaimDocumentResolution,
  EvidenceCheckDocumentResolution,
  EvidenceRelationDocumentResolution,
  HypothesisAssessmentDocumentResolution,
  QueryEvidenceDocumentResolution,
  SupportDecisionDocumentResolution,
} from "../coverage.js";
import {
  type ResearchKernelResult,
  researchKernelFailure,
  researchKernelSuccess,
} from "../errors.js";
import {
  buildHypothesisAssessmentCandidateWithReplayContext,
  resolveEvidenceCheckDerivationWithReplayContext,
  resolveSupportDecisionDerivationWithReplayContext,
} from "../evidence/check-support-assessment.js";
import {
  resolveAtomicClaimDerivationWithReplayContext,
  resolveEvidenceRelationDerivationWithReplayContext,
} from "../evidence/claim-relation.js";
import { resolveQueryEvidenceDerivationWithReplayContext } from "../evidence/oed-query.js";
import {
  createProofDerivationReplayContext,
  type ProofDerivationReplayContext,
} from "../evidence/proof-replay.js";
import { preflightResearchInput } from "../input-budget.js";
import { resolveResearchDocumentCandidate } from "../internal/document-resolution.js";
import { computeResearchKernelHash } from "../internal/hash.js";
import {
  mapByReferenceIdentity,
  sameReferenceScope,
  uniqueReferences,
} from "../internal/reference-identity.js";
import {
  memoizeSuccessfulResearchReplay,
  type ResearchRequestReplayContext,
} from "../internal/request-replay-context.js";
import { exactObjectKeys } from "../internal/value-shape.js";
import { derivePreStopReadinessFacts } from "../pre-stop-readiness.js";
import { renderZhL2ResearchTitleV1 } from "../reporting.js";

export interface ReadinessSupportResolution {
  readonly ref: SupportDecisionRef;
  readonly payload: SupportDecisionPayload;
}

export interface ReadinessResolvedArtifact<Reference, Payload> {
  readonly ref: Reference;
  readonly payload: Payload;
}

export interface EvidenceGateResolvedFacts {
  readonly brief_ref: ResearchBriefRef;
  readonly brief: ResearchBriefV2Payload;
  readonly report_manifest_ref: ReportManifestRef;
  readonly report_manifest: ReportManifestV2Payload;
  readonly analysis_report_ref: AnalysisReportRef;
  readonly analysis_report: AnalysisReportV2Payload;
  readonly evaluator_version: string;
  readonly query_evidence: readonly ReadinessResolvedArtifact<
    QueryEvidenceRef,
    QueryEvidenceV2Payload
  >[];
  readonly atomic_claims: readonly ReadinessResolvedArtifact<
    AtomicClaimRef,
    AtomicClaimV2Payload
  >[];
  readonly evidence_relations: readonly ReadinessResolvedArtifact<
    EvidenceRelationRef,
    EvidenceRelationV2Payload
  >[];
  readonly evidence_checks: readonly ReadinessResolvedArtifact<
    EvidenceCheckReceiptRef,
    EvidenceCheckReceiptPayload
  >[];
  readonly hypothesis_assessments: readonly ReadinessResolvedArtifact<
    HypothesisAssessmentRef,
    HypothesisAssessmentPayload
  >[];
  readonly support_decisions: readonly ReadinessSupportResolution[];
  readonly current_version_frontier: VersionFrontier;
}

export interface EvidenceGateFacts {
  readonly brief_document: L2ResearchDocumentCandidate;
  readonly report_manifest_document: L2ResearchDocumentCandidate;
  readonly analysis_report_document: L2ResearchDocumentCandidate;
  readonly evaluator_version: string;
  readonly query_evidence_resolutions: readonly QueryEvidenceDocumentResolution[];
  readonly atomic_claim_resolutions: readonly AtomicClaimDocumentResolution[];
  readonly evidence_relation_resolutions: readonly EvidenceRelationDocumentResolution[];
  readonly evidence_check_resolutions: readonly EvidenceCheckDocumentResolution[];
  readonly hypothesis_assessment_resolutions: readonly HypothesisAssessmentDocumentResolution[];
  readonly support_decision_resolutions: readonly SupportDecisionDocumentResolution[];
  readonly current_version_frontier: VersionFrontier;
}

export interface EvidenceGateCandidateBundle {
  readonly support: EvidenceGateReceiptPayload;
  readonly conflict: EvidenceGateReceiptPayload;
  readonly freshness: EvidenceGateReceiptPayload;
  readonly source_independence: EvidenceGateReceiptPayload;
}

function gateInputShapeIsValid(value: unknown): value is EvidenceGateResolvedFacts {
  if (
    !exactObjectKeys(value, [
      "brief_ref",
      "brief",
      "report_manifest_ref",
      "report_manifest",
      "analysis_report_ref",
      "analysis_report",
      "evaluator_version",
      "query_evidence",
      "atomic_claims",
      "evidence_relations",
      "evidence_checks",
      "hypothesis_assessments",
      "support_decisions",
      "current_version_frontier",
    ])
  ) {
    return false;
  }
  const input = value as EvidenceGateResolvedFacts;
  return [
    input.query_evidence,
    input.atomic_claims,
    input.evidence_relations,
    input.evidence_checks,
    input.hypothesis_assessments,
    input.support_decisions,
  ].every(Array.isArray);
}

async function gateCandidate(
  gate: EvidenceGateReceiptPayload["gate"],
  passed: boolean,
  reason: EvidenceGateReceiptPayload["reason_codes"][number],
  input: EvidenceGateResolvedFacts,
  evaluated_refs: EvidenceGateReceiptPayload["evaluated_refs"],
  resolved_facts: unknown,
): Promise<ResearchKernelResult<EvidenceGateReceiptPayload>> {
  const material = {
    gate,
    verdict: passed ? ("PASS" as const) : ("FAIL" as const),
    reason_codes: passed ? [] : [reason],
    evaluated_refs,
    evaluator_version: input.evaluator_version,
  };
  const candidate = {
    artifact_type: "EvidenceGateReceipt",
    protocol_version: "evidence-gate@1.0.0",
    ...material,
    gate_input_hash: await computeResearchKernelHash(`u6-evidence-gate:${gate}@1`, {
      receipt_material: material,
      resolved_facts,
    }),
  };
  const parsed = evidenceGateReceiptPayloadSchema.safeParse(candidate);
  return parsed.success
    ? researchKernelSuccess(parsed.data)
    : researchKernelFailure(
        "REPORT_READY_AUTHORITY_REQUIRED",
        parsed.error.issues[0]?.message ?? "Evidence Gate Candidate 无效。",
      );
}

export async function evaluateEvidenceGatesFromResolvedFacts(
  input: EvidenceGateResolvedFacts,
): Promise<ResearchKernelResult<EvidenceGateCandidateBundle>> {
  const budget = preflightResearchInput(input, {
    array_limits: [
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
        path: ["hypothesis_assessments"],
        max_items: U6_WIRE_LIMITS.max_hypotheses,
      },
      {
        path: ["support_decisions"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
    ],
  });
  if (!budget.ok) return budget;

  if (!gateInputShapeIsValid(input)) {
    return researchKernelFailure(
      "REPORT_READY_AUTHORITY_REQUIRED",
      "Evidence Gate 输入必须是 exact object 与数组。",
    );
  }
  const resolvedReferenceGroups = [
    [input.query_evidence, queryEvidenceRefSchema],
    [input.atomic_claims, atomicClaimRefSchema],
    [input.evidence_relations, evidenceRelationRefSchema],
    [input.evidence_checks, evidenceCheckReceiptRefSchema],
    [input.hypothesis_assessments, hypothesisAssessmentRefSchema],
    [input.support_decisions, supportDecisionRefSchema],
  ] as const;
  if (
    !researchBriefRefSchema.safeParse(input.brief_ref).success ||
    !reportManifestRefSchema.safeParse(input.report_manifest_ref).success ||
    !analysisReportRefSchema.safeParse(input.analysis_report_ref).success ||
    !sameReferenceScope(input.brief_ref, input.report_manifest_ref) ||
    !sameReferenceScope(input.brief_ref, input.analysis_report_ref) ||
    resolvedReferenceGroups.some(([values, schema]) =>
      values.some(
        (value) =>
          !exactObjectKeys(value, ["ref", "payload"]) ||
          !schema.safeParse(value.ref).success ||
          !sameReferenceScope(input.brief_ref, value.ref),
      ),
    ) ||
    !sameReferenceScope(input.brief_ref, input.current_version_frontier.semantic_release_ref) ||
    !sameReferenceScope(input.brief_ref, input.current_version_frontier.schema_snapshot_ref) ||
    !sameReferenceScope(input.brief_ref, input.current_version_frontier.policy_receipt_ref) ||
    !researchBriefV2PayloadSchema.safeParse(input.brief).success ||
    !reportManifestV2PayloadSchema.safeParse(input.report_manifest).success ||
    !analysisReportV2PayloadSchema.safeParse(input.analysis_report).success ||
    !versionFrontierSchema.safeParse(input.current_version_frontier).success ||
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
    return researchKernelFailure(
      "REPORT_READY_AUTHORITY_REQUIRED",
      "Evidence Gate resolved facts 必须全部通过 strict wire schema。",
    );
  }
  const claimByRef = mapByReferenceIdentity(input.atomic_claims);
  const relationByRef = mapByReferenceIdentity(input.evidence_relations);
  const checkByRef = mapByReferenceIdentity(input.evidence_checks);
  const evidenceByRef = mapByReferenceIdentity(input.query_evidence);
  const supportByRef = mapByReferenceIdentity(input.support_decisions);
  const assessmentByRef = mapByReferenceIdentity(input.hypothesis_assessments);
  const materialClaimIdentities =
    input.report_manifest.material_claim_refs.map(artifactReferenceIdentity);
  const materialSupportDecisions = input.support_decisions.filter(
    ({ payload }) => payload.decision === "SUPPORTED",
  );
  const supportedByClaim = new Map(
    materialSupportDecisions.map((resolution) => [
      artifactReferenceIdentity(resolution.payload.claim_ref),
      resolution,
    ]),
  );
  const resolveDecisionEvidence = (
    resolution: ReadinessSupportResolution,
    expectedRelation: "SUPPORTS" | "REFUTES",
  ): readonly QueryEvidenceRef[] | null => {
    if (!claimByRef || !relationByRef || !checkByRef || !evidenceByRef) return null;
    const claimIdentity = artifactReferenceIdentity(resolution.payload.claim_ref);
    const claim = claimByRef.get(claimIdentity);
    if (
      !claim ||
      resolution.payload.decision !== (expectedRelation === "SUPPORTS" ? "SUPPORTED" : "REFUTED")
    ) {
      return null;
    }
    const expectedEvidenceIdentities = new Set(
      claim.payload.evidence_refs.map(artifactReferenceIdentity),
    );
    const relations = resolution.payload.relation_refs.map((reference) =>
      relationByRef.get(artifactReferenceIdentity(reference)),
    );
    if (relations.some((relation) => relation === undefined)) return null;
    const resolvedRelations = relations.flatMap((relation) => (relation ? [relation] : []));
    const relationEvidenceIdentities = resolvedRelations.map(({ payload }) =>
      artifactReferenceIdentity(payload.evidence_ref),
    );
    if (
      resolvedRelations.length !== expectedEvidenceIdentities.size ||
      new Set(relationEvidenceIdentities).size !== expectedEvidenceIdentities.size ||
      resolvedRelations.some(
        ({ payload }) =>
          artifactReferenceIdentity(payload.claim_ref) !== claimIdentity ||
          payload.proposed_relation !== expectedRelation ||
          !expectedEvidenceIdentities.has(artifactReferenceIdentity(payload.evidence_ref)) ||
          !evidenceByRef.has(artifactReferenceIdentity(payload.evidence_ref)),
      )
    ) {
      return null;
    }
    const exactCheckIdentities = new Set<string>();
    for (const relation of resolvedRelations) {
      const relationIdentity = artifactReferenceIdentity(relation.ref);
      const checks = input.evidence_checks.filter(
        ({ payload }) => artifactReferenceIdentity(payload.relation_ref) === relationIdentity,
      );
      if (
        checks.length !== 2 ||
        new Set(checks.map(({ payload }) => payload.check_kind)).size !== 2 ||
        checks.some(({ payload }) => payload.verdict !== "PASS")
      ) {
        return null;
      }
      for (const check of checks) exactCheckIdentities.add(artifactReferenceIdentity(check.ref));
    }
    const declaredCheckIdentities =
      resolution.payload.check_receipt_refs.map(artifactReferenceIdentity);
    if (
      declaredCheckIdentities.length !== exactCheckIdentities.size ||
      declaredCheckIdentities.some((identity) => !exactCheckIdentities.has(identity))
    ) {
      return null;
    }
    return claim.payload.evidence_refs;
  };

  const supportedEvidenceRefs: QueryEvidenceRef[] = [];
  let supportedClosurePass =
    claimByRef !== null &&
    relationByRef !== null &&
    checkByRef !== null &&
    evidenceByRef !== null &&
    supportByRef !== null &&
    new Set(materialClaimIdentities).size === materialClaimIdentities.length &&
    supportedByClaim.size === materialSupportDecisions.length &&
    materialSupportDecisions.length === materialClaimIdentities.length &&
    input.support_decisions.every(
      ({ payload }) => payload.decision === "SUPPORTED" || payload.decision === "REFUTED",
    );
  if (supportedClosurePass) {
    for (const claimIdentity of materialClaimIdentities) {
      const support = supportedByClaim.get(claimIdentity);
      if (!support || artifactReferenceIdentity(support.payload.claim_ref) !== claimIdentity) {
        supportedClosurePass = false;
        break;
      }
      const evidenceRefs = resolveDecisionEvidence(support, "SUPPORTS");
      if (!evidenceRefs) {
        supportedClosurePass = false;
        break;
      }
      supportedEvidenceRefs.push(...evidenceRefs);
    }
  }

  const manifestRefutedSection = input.report_manifest.sections.find(
    ({ section_id }) => section_id === "REFUTED_HYPOTHESES",
  );
  const reportRefutedSection = input.analysis_report.sections.find(
    ({ section_id }) => section_id === "REFUTED_HYPOTHESES",
  );
  const manifestRefutedAssessmentRefs = manifestRefutedSection?.hypothesis_assessment_refs ?? [];
  const resolvedRefutedAssessments = input.hypothesis_assessments.filter(
    ({ payload }) => payload.status === "REFUTED",
  );
  const resolvedRefutedSupports = input.support_decisions.filter(
    ({ payload }) => payload.decision === "REFUTED",
  );
  const allRefutingRelations = input.evidence_relations.filter(
    ({ payload }) => payload.proposed_relation === "REFUTES",
  );
  const expectedRefutedAssessmentSet = new Set(
    resolvedRefutedAssessments.map(({ ref }) => artifactReferenceIdentity(ref)),
  );
  const manifestRefutedAssessmentSet = new Set(
    manifestRefutedAssessmentRefs.map(artifactReferenceIdentity),
  );
  const expectedRefutedSupportSet = new Set(
    resolvedRefutedSupports.map(({ ref }) => artifactReferenceIdentity(ref)),
  );
  const expectedRefutingRelationSet = new Set(
    allRefutingRelations.map(({ ref }) => artifactReferenceIdentity(ref)),
  );
  const usedRefutedSupportSet = new Set<string>();
  const usedRefutingRelationSet = new Set<string>();
  const refutationEvidenceRefs: QueryEvidenceRef[] = [];
  const refutationClosureRefs: EvidenceGateReceiptPayload["evaluated_refs"] = [];
  let refutationClosurePass =
    assessmentByRef !== null &&
    supportByRef !== null &&
    claimByRef !== null &&
    relationByRef !== null &&
    checkByRef !== null &&
    evidenceByRef !== null &&
    manifestRefutedAssessmentSet.size === manifestRefutedAssessmentRefs.length &&
    expectedRefutedAssessmentSet.size === manifestRefutedAssessmentSet.size &&
    [...expectedRefutedAssessmentSet].every((identity) =>
      manifestRefutedAssessmentSet.has(identity),
    );
  if (refutationClosurePass && assessmentByRef && supportByRef) {
    for (const assessmentRef of manifestRefutedAssessmentRefs) {
      const assessment = assessmentByRef.get(artifactReferenceIdentity(assessmentRef));
      if (assessment?.payload.status !== "REFUTED") {
        refutationClosurePass = false;
        break;
      }
      refutationClosureRefs.push(assessment.ref);
      const assessmentSupportIdentities =
        assessment.payload.support_decision_refs.map(artifactReferenceIdentity);
      if (new Set(assessmentSupportIdentities).size !== assessmentSupportIdentities.length) {
        refutationClosurePass = false;
        break;
      }
      let assessmentHasRefutedSupport = false;
      for (const supportRef of assessment.payload.support_decision_refs) {
        const supportIdentity = artifactReferenceIdentity(supportRef);
        const support = supportByRef.get(supportIdentity);
        if (!support) {
          refutationClosurePass = false;
          break;
        }
        if (support.payload.decision === "SUPPORTED") {
          if (!resolveDecisionEvidence(support, "SUPPORTS")) {
            refutationClosurePass = false;
            break;
          }
          continue;
        }
        if (support.payload.decision !== "REFUTED") {
          refutationClosurePass = false;
          break;
        }
        assessmentHasRefutedSupport = true;
        const evidenceRefs = resolveDecisionEvidence(support, "REFUTES");
        if (!evidenceRefs) {
          refutationClosurePass = false;
          break;
        }
        if (usedRefutedSupportSet.has(supportIdentity)) {
          continue;
        }
        usedRefutedSupportSet.add(supportIdentity);
        refutationEvidenceRefs.push(...evidenceRefs);
        refutationClosureRefs.push(
          support.ref,
          support.payload.claim_ref,
          ...support.payload.relation_refs,
          ...support.payload.check_receipt_refs,
          ...evidenceRefs,
        );
        for (const relationRef of support.payload.relation_refs) {
          usedRefutingRelationSet.add(artifactReferenceIdentity(relationRef));
        }
      }
      if (!assessmentHasRefutedSupport) {
        refutationClosurePass = false;
      }
      if (!refutationClosurePass) break;
    }
  }
  refutationClosurePass =
    refutationClosurePass &&
    usedRefutedSupportSet.size === expectedRefutedSupportSet.size &&
    [...expectedRefutedSupportSet].every((identity) => usedRefutedSupportSet.has(identity)) &&
    usedRefutingRelationSet.size === expectedRefutingRelationSet.size &&
    [...expectedRefutingRelationSet].every((identity) => usedRefutingRelationSet.has(identity));
  const hasMaterialRefutationClosure =
    refutationClosurePass && manifestRefutedAssessmentRefs.length > 0;
  const supportClosurePass =
    supportedClosurePass &&
    refutationClosurePass &&
    (materialClaimIdentities.length > 0 || hasMaterialRefutationClosure);

  const materialConflicts = input.evidence_relations
    .filter(({ payload }) => payload.proposed_relation === "CONFLICTS")
    .map(({ ref }) => ref);
  const manifestConflictSection = input.report_manifest.sections.find(
    ({ section_id }) => section_id === "CONFLICTS",
  );
  const disclosedConflicts = manifestConflictSection?.conflict_refs ?? [];
  const misplacedConflictRefs = input.report_manifest.sections
    .filter(({ section_id }) => section_id !== "CONFLICTS")
    .flatMap(({ conflict_refs }) => conflict_refs);
  const disclosedConflictSet = new Set(disclosedConflicts.map(artifactReferenceIdentity));
  const materialConflictSet = new Set(materialConflicts.map(artifactReferenceIdentity));
  const reportConflictSection = input.analysis_report.sections.find(
    ({ section_id }) => section_id === "CONFLICTS",
  );
  const conflictPass =
    refutationClosurePass &&
    misplacedConflictRefs.length === 0 &&
    disclosedConflictSet.size === materialConflictSet.size &&
    [...materialConflictSet].every((identity) => disclosedConflictSet.has(identity)) &&
    (materialConflicts.length === 0 || (reportConflictSection?.statement_units.length ?? 0) > 0) &&
    (expectedRefutingRelationSet.size === 0 || manifestRefutedAssessmentSet.size > 0) &&
    (manifestRefutedAssessmentSet.size === 0
      ? (reportRefutedSection?.statement_units.length ?? 0) === 0
      : (reportRefutedSection?.statement_units.length ?? 0) > 0);
  const expectedTitle = renderZhL2ResearchTitleV1(input.brief.scope.subject);
  const expectedTitleHash = await computeResearchKernelHash("u6-report-title@1", expectedTitle);
  const freshnessPass =
    artifactReferenceIdentity(input.report_manifest.brief_ref) ===
      artifactReferenceIdentity(input.brief_ref) &&
    input.analysis_report.title_template_id === "ZH_L2_RESEARCH_TITLE_V1" &&
    input.analysis_report.title === expectedTitle &&
    input.analysis_report.title_hash === expectedTitleHash &&
    input.query_evidence.every(
      ({ payload }) =>
        canonicalizeJson(payload.observed_version) ===
          canonicalizeJson(input.current_version_frontier) &&
        (!input.brief.freshness_policy.require_snapshot_replayable ||
          payload.observed_version.data_snapshot.replay_state === "REPLAYABLE"),
    );
  const materialEvidenceIdentities = new Set(
    [...supportedEvidenceRefs, ...refutationEvidenceRefs].map(artifactReferenceIdentity),
  );
  const materialSourceClosurePass =
    supportClosurePass &&
    evidenceByRef !== null &&
    materialEvidenceIdentities.size > 0 &&
    [...materialEvidenceIdentities].every((identity) => evidenceByRef.has(identity));
  const materialEvidence = materialSourceClosurePass
    ? [...materialEvidenceIdentities].map((identity) => evidenceByRef?.get(identity))
    : [];
  const provenanceGroups = materialEvidence.flatMap((evidence) =>
    evidence ? [evidence.payload.provenance_group] : [],
  );
  const provenancePolicy = input.brief.source_independence_policy;
  const reportDisclosureSet = new Set(input.analysis_report.disclosures);
  const manifestDisclosureSet = new Set(input.report_manifest.required_disclosures);
  const sharedDisclosures = input.report_manifest.required_disclosures.filter((disclosure) =>
    reportDisclosureSet.has(disclosure),
  );
  const preStopReadiness = await derivePreStopReadinessFacts({
    brief: input.brief,
    material_query_evidence: materialEvidence.flatMap((evidence) =>
      evidence ? [evidence.payload] : [],
    ),
    supplied_disclosures: sharedDisclosures,
  });
  if (!preStopReadiness.ok) return preStopReadiness;
  const requiredDisclosureSet = new Set([
    ...preStopReadiness.value.required_disclosures,
    ...input.report_manifest.required_disclosures,
  ]);
  const reportLimitations =
    input.analysis_report.sections.find(({ section_id }) => section_id === "LIMITATIONS")
      ?.statement_units ?? [];
  const sourcePass =
    materialSourceClosurePass &&
    materialEvidence.length === materialEvidenceIdentities.size &&
    preStopReadiness.value.ready &&
    [...requiredDisclosureSet].every(
      (disclosure) => reportDisclosureSet.has(disclosure) && manifestDisclosureSet.has(disclosure),
    ) &&
    reportLimitations.length > 0;
  const supportRefs = materialSupportDecisions.map(({ ref }) => ref);
  const supportEvaluatedRefs = uniqueReferences([
    input.report_manifest_ref,
    ...input.report_manifest.material_claim_refs,
    ...materialSupportDecisions.flatMap(({ payload }) => payload.relation_refs),
    ...materialSupportDecisions.flatMap(({ payload }) => payload.check_receipt_refs),
    ...supportedEvidenceRefs,
    ...supportRefs,
    ...refutationClosureRefs,
  ]);
  const conflictEvaluatedRefs = uniqueReferences([
    input.report_manifest_ref,
    input.analysis_report_ref,
    ...input.evidence_relations.map(({ ref }) => ref),
    ...input.support_decisions.map(({ ref }) => ref),
    ...input.hypothesis_assessments.map(({ ref }) => ref),
  ]);
  const freshnessEvaluatedRefs = uniqueReferences([
    input.brief_ref,
    ...input.query_evidence.flatMap(({ ref, payload }) => [
      ref,
      payload.sandbox_execution_receipt_ref,
    ]),
    input.current_version_frontier.semantic_release_ref,
    input.current_version_frontier.schema_snapshot_ref,
    input.current_version_frontier.policy_receipt_ref,
  ]);
  const sourceEvaluatedRefs = uniqueReferences([
    input.brief_ref,
    input.report_manifest_ref,
    input.analysis_report_ref,
    ...input.report_manifest.material_claim_refs,
    ...materialSupportDecisions.map(({ ref }) => ref),
    ...refutationClosureRefs,
    ...materialEvidence.flatMap((evidence) => (evidence ? [evidence.ref] : [])),
  ]);
  const supportFacts = {
    material_claim_refs: input.report_manifest.material_claim_refs,
    refuted_hypothesis_assessment_refs: manifestRefutedAssessmentRefs,
    atomic_claims: input.atomic_claims,
    evidence_relations: input.evidence_relations,
    evidence_checks: input.evidence_checks,
    support_decisions: input.support_decisions,
    material_reporting_evidence_refs: materialEvidence.flatMap((evidence) =>
      evidence ? [evidence.ref] : [],
    ),
  };
  const conflictFacts = {
    evidence_relations: input.evidence_relations,
    support_decisions: input.support_decisions,
    hypothesis_assessments: input.hypothesis_assessments,
    disclosed_conflict_refs: disclosedConflicts,
    misplaced_conflict_refs: misplacedConflictRefs,
    report_conflict_section: reportConflictSection ?? null,
  };
  const freshnessFacts = {
    freshness_policy: input.brief.freshness_policy,
    title_template_id: input.analysis_report.title_template_id,
    title: input.analysis_report.title,
    title_hash: input.analysis_report.title_hash,
    expected_title: expectedTitle,
    expected_title_hash: expectedTitleHash,
    observed_versions: input.query_evidence.map(({ payload }) => payload.observed_version),
    current_version_frontier: input.current_version_frontier,
  };
  const sourceFacts = {
    source_independence_policy: provenancePolicy,
    pre_stop_readiness: preStopReadiness.value,
    material_claim_refs: input.report_manifest.material_claim_refs,
    refuted_hypothesis_assessment_refs: manifestRefutedAssessmentRefs,
    material_reporting_evidence_refs: materialEvidence.flatMap((evidence) =>
      evidence ? [evidence.ref] : [],
    ),
    provenance_groups: provenanceGroups,
    manifest_required_disclosures: input.report_manifest.required_disclosures,
    report_disclosures: input.analysis_report.disclosures,
    report_limitations: reportLimitations,
  };
  const [support, conflict, freshness, sourceIndependence] = await Promise.all([
    gateCandidate(
      "SUPPORT",
      supportClosurePass,
      "EVIDENCE_SUPPORT_INSUFFICIENT",
      input,
      supportEvaluatedRefs,
      supportFacts,
    ),
    gateCandidate(
      "CONFLICT",
      conflictPass,
      "MATERIAL_CONFLICT_UNDISCLOSED",
      input,
      conflictEvaluatedRefs,
      conflictFacts,
    ),
    gateCandidate(
      "FRESHNESS",
      freshnessPass,
      "EVIDENCE_REVISION_STALE",
      input,
      freshnessEvaluatedRefs,
      freshnessFacts,
    ),
    gateCandidate(
      "SOURCE_INDEPENDENCE",
      sourcePass,
      "SOURCE_INDEPENDENCE_POLICY_UNSATISFIED",
      input,
      sourceEvaluatedRefs,
      sourceFacts,
    ),
  ]);
  for (const result of [support, conflict, freshness, sourceIndependence]) {
    if (!result.ok) return result;
  }
  if (!support.ok || !conflict.ok || !freshness.ok || !sourceIndependence.ok) {
    return researchKernelFailure(
      "REPORT_READY_AUTHORITY_REQUIRED",
      "Evidence Gate Candidate 未能形成完整四元组。",
    );
  }
  return researchKernelSuccess({
    support: support.value,
    conflict: conflict.value,
    freshness: freshness.value,
    source_independence: sourceIndependence.value,
  });
}

const EVIDENCE_GATE_DOCUMENT_INPUT_KEYS = [
  "brief_document",
  "report_manifest_document",
  "analysis_report_document",
  "evaluator_version",
  "query_evidence_resolutions",
  "atomic_claim_resolutions",
  "evidence_relation_resolutions",
  "evidence_check_resolutions",
  "hypothesis_assessment_resolutions",
  "support_decision_resolutions",
  "current_version_frontier",
] as const;

export function evidenceGateDocumentInputShapeIsValid(value: unknown): value is EvidenceGateFacts {
  if (!exactObjectKeys(value, EVIDENCE_GATE_DOCUMENT_INPUT_KEYS)) {
    return false;
  }
  const input = value as EvidenceGateFacts;
  return (
    Array.isArray(input.query_evidence_resolutions) &&
    Array.isArray(input.atomic_claim_resolutions) &&
    Array.isArray(input.evidence_relation_resolutions) &&
    Array.isArray(input.evidence_check_resolutions) &&
    Array.isArray(input.hypothesis_assessment_resolutions) &&
    Array.isArray(input.support_decision_resolutions)
  );
}

async function resolveEvidenceGateDocumentFactsUncached(
  input: EvidenceGateFacts,
  requestContext: ResearchRequestReplayContext | undefined,
  proofContext: ProofDerivationReplayContext,
): Promise<ResearchKernelResult<EvidenceGateResolvedFacts>> {
  if (!evidenceGateDocumentInputShapeIsValid(input)) {
    return researchKernelFailure(
      "REPORT_READY_AUTHORITY_REQUIRED",
      "Evidence Gate 输入必须是 exact document closure 与数组。",
    );
  }
  const [brief, manifest, report] = await Promise.all([
    resolveResearchDocumentCandidate(input.brief_document, "ResearchBrief", requestContext),
    resolveResearchDocumentCandidate(
      input.report_manifest_document,
      "ReportManifest",
      requestContext,
    ),
    resolveResearchDocumentCandidate(
      input.analysis_report_document,
      "AnalysisReport",
      requestContext,
    ),
  ]);
  if (
    !brief.ok ||
    !manifest.ok ||
    !report.ok ||
    brief.value.document.payload.artifact_type !== "ResearchBrief" ||
    manifest.value.document.payload.artifact_type !== "ReportManifest" ||
    report.value.document.payload.artifact_type !== "AnalysisReport"
  ) {
    return researchKernelFailure(
      "REPORT_READY_AUTHORITY_REQUIRED",
      "Brief/Manifest/Report 必须是 strict content-addressed Candidate Document。",
    );
  }

  const queryEvidence: ReadinessResolvedArtifact<QueryEvidenceRef, QueryEvidenceV2Payload>[] = [];
  for (const resolution of input.query_evidence_resolutions) {
    if (!exactObjectKeys(resolution, ["document", "derivation_input"])) {
      return researchKernelFailure(
        "REPORT_READY_AUTHORITY_REQUIRED",
        "QueryEvidence resolution 必须是 exact document + derivation_input。",
      );
    }
    const replayed = await resolveQueryEvidenceDerivationWithReplayContext(
      resolution,
      proofContext,
    );
    if (!replayed.ok) {
      return researchKernelFailure(
        "REPORT_READY_AUTHORITY_REQUIRED",
        "QueryEvidence Document 必须与 production builder 重派生结果一致。",
      );
    }
    queryEvidence.push({
      ref: replayed.value.ref,
      payload: replayed.value.payload,
    });
  }

  const atomicClaims: ReadinessResolvedArtifact<AtomicClaimRef, AtomicClaimV2Payload>[] = [];
  for (const resolution of input.atomic_claim_resolutions) {
    if (!exactObjectKeys(resolution, ["document", "derivation_input"])) {
      return researchKernelFailure(
        "REPORT_READY_AUTHORITY_REQUIRED",
        "AtomicClaim resolution 必须是 exact document + derivation_input。",
      );
    }
    const replayed = await resolveAtomicClaimDerivationWithReplayContext(resolution, proofContext);
    if (!replayed.ok) {
      return researchKernelFailure(
        "REPORT_READY_AUTHORITY_REQUIRED",
        "AtomicClaim Document 必须由完整 Observation Source 重派生。",
      );
    }
    atomicClaims.push({
      ref: replayed.value.ref,
      payload: replayed.value.payload,
    });
  }

  const relations: ReadinessResolvedArtifact<EvidenceRelationRef, EvidenceRelationV2Payload>[] = [];
  for (const resolution of input.evidence_relation_resolutions) {
    if (!exactObjectKeys(resolution, ["document", "derivation_input"])) {
      return researchKernelFailure(
        "REPORT_READY_AUTHORITY_REQUIRED",
        "EvidenceRelation resolution 必须是 exact document + derivation_input。",
      );
    }
    const replayed = await resolveEvidenceRelationDerivationWithReplayContext(
      resolution,
      proofContext,
    );
    if (!replayed.ok) {
      return researchKernelFailure(
        "REPORT_READY_AUTHORITY_REQUIRED",
        "EvidenceRelation Document 必须与 production builder 重派生结果一致。",
      );
    }
    relations.push({
      ref: replayed.value.ref,
      payload: replayed.value.payload,
    });
  }

  const checks: ReadinessResolvedArtifact<EvidenceCheckReceiptRef, EvidenceCheckReceiptPayload>[] =
    [];
  for (const resolution of input.evidence_check_resolutions) {
    if (!exactObjectKeys(resolution, ["document", "derivation_input"])) {
      return researchKernelFailure(
        "REPORT_READY_AUTHORITY_REQUIRED",
        "EvidenceCheck resolution 必须是 exact document + derivation_input。",
      );
    }
    const replayed = await resolveEvidenceCheckDerivationWithReplayContext(
      resolution,
      proofContext,
    );
    if (!replayed.ok) {
      return researchKernelFailure(
        "REPORT_READY_AUTHORITY_REQUIRED",
        "EvidenceCheck Document 必须与 production builder 重派生结果一致。",
      );
    }
    checks.push({
      ref: replayed.value.ref,
      payload: replayed.value.payload,
    });
  }

  const supports: ReadinessResolvedArtifact<SupportDecisionRef, SupportDecisionPayload>[] = [];
  for (const resolution of input.support_decision_resolutions) {
    if (!exactObjectKeys(resolution, ["document", "derivation_input"])) {
      return researchKernelFailure(
        "REPORT_READY_AUTHORITY_REQUIRED",
        "SupportDecision resolution 必须是 exact document + derivation_input。",
      );
    }
    const replayed = await resolveSupportDecisionDerivationWithReplayContext(
      resolution,
      proofContext,
    );
    if (!replayed.ok) {
      return researchKernelFailure(
        "REPORT_READY_AUTHORITY_REQUIRED",
        "SupportDecision Document 必须与 production builder 重派生结果一致。",
      );
    }
    supports.push({
      ref: replayed.value.ref,
      payload: replayed.value.payload,
    });
  }

  const assessments: ReadinessResolvedArtifact<
    HypothesisAssessmentRef,
    HypothesisAssessmentPayload
  >[] = [];
  for (const resolution of input.hypothesis_assessment_resolutions) {
    if (!exactObjectKeys(resolution, ["document", "derivation_input"])) {
      return researchKernelFailure(
        "REPORT_READY_AUTHORITY_REQUIRED",
        "HypothesisAssessment resolution 必须是 exact document + derivation_input。",
      );
    }
    const replayed = await memoizeSuccessfulResearchReplay(
      requestContext,
      "proof:hypothesis-assessment",
      resolution,
      async (): Promise<
        ResearchKernelResult<
          ReadinessResolvedArtifact<HypothesisAssessmentRef, HypothesisAssessmentPayload>
        >
      > => {
        const [document, derived] = await Promise.all([
          resolveResearchDocumentCandidate(
            resolution.document,
            "HypothesisAssessment",
            requestContext,
          ),
          buildHypothesisAssessmentCandidateWithReplayContext(
            resolution.derivation_input,
            proofContext,
          ),
        ]);
        if (
          !document.ok ||
          !derived.ok ||
          document.value.document.payload.artifact_type !== "HypothesisAssessment" ||
          canonicalizeJson(document.value.document.payload) !== canonicalizeJson(derived.value)
        ) {
          return researchKernelFailure(
            "REPORT_READY_AUTHORITY_REQUIRED",
            "HypothesisAssessment Document 必须与 production builder 重派生结果一致。",
          );
        }
        const ref = hypothesisAssessmentRefSchema.safeParse(document.value.ref);
        return ref.success
          ? researchKernelSuccess({
              ref: ref.data,
              payload: document.value.document.payload,
            })
          : researchKernelFailure(
              "REPORT_READY_AUTHORITY_REQUIRED",
              "HypothesisAssessment Document Reference 类型无效。",
            );
      },
    );
    if (!replayed.ok) {
      return researchKernelFailure(
        "REPORT_READY_AUTHORITY_REQUIRED",
        "HypothesisAssessment Document 必须与 production builder 重派生结果一致。",
      );
    }
    assessments.push(replayed.value);
  }

  const manifestPayload = manifest.value.document.payload;
  const reportPayload = report.value.document.payload;
  const manifestHash = await computeResearchKernelHash("u6-report-manifest@2", {
    brief_ref: manifestPayload.brief_ref,
    stop_decision_ref: manifestPayload.stop_decision_ref,
    sections: manifestPayload.sections,
    material_claim_refs: manifestPayload.material_claim_refs,
    required_disclosures: manifestPayload.required_disclosures,
    allowed_style_profile: manifestPayload.allowed_style_profile,
  });
  const reportTitleHash = await computeResearchKernelHash("u6-report-title@1", reportPayload.title);
  const reportProjectionHash = await computeResearchKernelHash("u6-analysis-report-projection@1", {
    manifest_ref: reportPayload.manifest_ref,
    title_template_id: reportPayload.title_template_id,
    title: reportPayload.title,
    title_hash: reportPayload.title_hash,
    sections: reportPayload.sections,
    disclosures: reportPayload.disclosures,
  });
  if (
    manifestPayload.manifest_hash !== manifestHash ||
    reportPayload.title_hash !== reportTitleHash ||
    reportPayload.projection_hash !== reportProjectionHash
  ) {
    return researchKernelFailure(
      "REPORT_READY_AUTHORITY_REQUIRED",
      "Gate Document 的领域 hash 必须由完整 payload 重算。",
    );
  }

  return researchKernelSuccess({
    brief_ref: brief.value.ref as ResearchBriefRef,
    brief: brief.value.document.payload,
    report_manifest_ref: manifest.value.ref as ReportManifestRef,
    report_manifest: manifestPayload,
    analysis_report_ref: report.value.ref as AnalysisReportRef,
    analysis_report: reportPayload,
    evaluator_version: input.evaluator_version,
    query_evidence: queryEvidence,
    atomic_claims: atomicClaims,
    evidence_relations: relations,
    evidence_checks: checks,
    hypothesis_assessments: assessments,
    support_decisions: supports,
    current_version_frontier: input.current_version_frontier,
  });
}

export function resolveEvidenceGateDocumentFacts(
  input: EvidenceGateFacts,
  requestContext?: ResearchRequestReplayContext,
  proofContext = createProofDerivationReplayContext(requestContext),
): Promise<ResearchKernelResult<EvidenceGateResolvedFacts>> {
  return resolveEvidenceGateDocumentFactsUncached(input, requestContext, proofContext);
}

async function evaluateEvidenceGatesUncached(
  input: EvidenceGateFacts,
  requestContext?: ResearchRequestReplayContext,
  proofContext = createProofDerivationReplayContext(requestContext),
): Promise<ResearchKernelResult<EvidenceGateCandidateBundle>> {
  const budget = preflightResearchInput(input, {
    array_limits: [
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
        path: ["hypothesis_assessment_resolutions"],
        max_items: U6_WIRE_LIMITS.max_hypotheses,
      },
      {
        path: ["support_decision_resolutions"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
    ],
  });
  if (!budget.ok) return budget;

  const facts = await resolveEvidenceGateDocumentFacts(input, requestContext, proofContext);
  return facts.ok ? evaluateEvidenceGatesFromResolvedFacts(facts.value) : facts;
}

/**
 * Public Evidence Gate boundary. All facts are complete content-addressed
 * Candidate Documents, and material QE/Claim/Relation are re-derived.
 */
export async function evaluateEvidenceGates(
  input: EvidenceGateFacts,
): Promise<ResearchKernelResult<EvidenceGateCandidateBundle>> {
  return evaluateEvidenceGatesUncached(input);
}

export function evaluateEvidenceGatesWithReplayContext(
  input: EvidenceGateFacts,
  requestContext: ResearchRequestReplayContext,
): Promise<ResearchKernelResult<EvidenceGateCandidateBundle>> {
  return memoizeSuccessfulResearchReplay(requestContext, "stage:evidence-gates", input, () =>
    evaluateEvidenceGatesUncached(
      input,
      requestContext,
      createProofDerivationReplayContext(requestContext),
    ),
  );
}
