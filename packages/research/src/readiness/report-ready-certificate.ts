import {
  type AnalysisReportRef,
  type AnalysisReportV2Payload,
  type AtomicClaimRef,
  type AtomicClaimV2Payload,
  analysisReportV2PayloadSchema,
  artifactReferenceIdentity,
  canonicalizeJson,
  computeL2ResearchSemanticHash,
  type EvidenceGateReceiptPayload,
  type EvidenceGateReceiptRef,
  type L2ResearchDocumentCandidate,
  type QueryEvidenceRef,
  type ReportManifestRef,
  type ReportManifestV2Payload,
  type ReportProjectionReceiptPayload,
  type ReportProjectionReceiptRef,
  type ReportReadyCertificateV3Payload,
  type ResearchStopDecisionPayload,
  type ResearchStopDecisionRef,
  reportManifestV2PayloadSchema,
  reportProjectionReceiptPayloadSchema,
  reportReadyCertificateV3PayloadSchema,
  researchStopDecisionPayloadSchema,
  type SupportDecisionRef,
  U6_WIRE_LIMITS,
  type VersionFrontier,
} from "@data-agent/contracts";
import {
  type ResearchKernelResult,
  researchKernelFailure,
  researchKernelSuccess,
} from "../errors.js";
import { createProofDerivationReplayContext } from "../evidence/proof-replay.js";
import { preflightResearchInput } from "../input-budget.js";
import { resolveResearchDocumentCandidate } from "../internal/document-resolution.js";
import { computeResearchKernelHash } from "../internal/hash.js";
import {
  containsAllReferenceIdentities,
  sameReferenceIdentityMultiset,
  stableCompare,
} from "../internal/reference-identity.js";
import {
  memoizeSuccessfulResearchReplay,
  type ResearchRequestReplayContext,
} from "../internal/request-replay-context.js";
import { exactObjectKeys } from "../internal/value-shape.js";
import {
  type ReportManifestDocumentResolution,
  type ReportProjectionDocumentResolution,
  renderZhL2ResearchTitleV1,
  resolveReportManifestDocumentResolution,
  resolveReportProjectionDocumentResolution,
} from "../reporting.js";
import {
  type ResearchStopDecisionDocumentResolution,
  resolveResearchStopDecisionDocumentResolution,
} from "../stop.js";
import {
  type EvidenceGateCandidateBundle,
  type EvidenceGateFacts,
  type EvidenceGateResolvedFacts,
  evaluateEvidenceGatesFromResolvedFacts,
  evidenceGateDocumentInputShapeIsValid,
  type ReadinessResolvedArtifact,
  type ReadinessSupportResolution,
  resolveEvidenceGateDocumentFacts,
} from "./evidence-gates.js";

export interface GateReceiptReferences {
  readonly support: EvidenceGateReceiptRef;
  readonly conflict: EvidenceGateReceiptRef;
  readonly freshness: EvidenceGateReceiptRef;
  readonly source_independence: EvidenceGateReceiptRef;
}

export interface CreateReportReadyResolvedFactsInput {
  readonly stop_decision_ref: ResearchStopDecisionRef;
  readonly stop_decision: ResearchStopDecisionPayload;
  readonly report_manifest_ref: ReportManifestRef;
  readonly report_manifest: ReportManifestV2Payload;
  readonly analysis_report_ref: AnalysisReportRef;
  readonly analysis_report: AnalysisReportV2Payload;
  readonly projection_receipt_ref: ReportProjectionReceiptRef;
  readonly projection_receipt: ReportProjectionReceiptPayload;
  readonly gate_receipt_refs: GateReceiptReferences;
  readonly gates: EvidenceGateCandidateBundle;
  readonly gate_facts: EvidenceGateResolvedFacts;
  readonly material_support_decisions: readonly ReadinessSupportResolution[];
  readonly version_frontier: VersionFrontier;
  readonly evaluated_through_input_event_seq: number;
}

export interface GateReceiptDocuments {
  readonly support: L2ResearchDocumentCandidate;
  readonly conflict: L2ResearchDocumentCandidate;
  readonly freshness: L2ResearchDocumentCandidate;
  readonly source_independence: L2ResearchDocumentCandidate;
}

export interface CreateReportReadyCandidateInput {
  readonly stop_decision_resolution: ResearchStopDecisionDocumentResolution;
  readonly report_manifest_resolution: ReportManifestDocumentResolution;
  readonly report_projection_resolution: ReportProjectionDocumentResolution;
  readonly gate_receipt_documents: GateReceiptDocuments;
  readonly gate_facts: EvidenceGateFacts;
  readonly version_frontier: VersionFrontier;
  readonly evaluated_through_input_event_seq: number;
}

function gateTupleIsValid(
  refs: GateReceiptReferences,
  gates: EvidenceGateCandidateBundle,
): boolean {
  const refIdentities = Object.values(refs).map(artifactReferenceIdentity);
  return (
    new Set(refIdentities).size === 4 &&
    gates.support.gate === "SUPPORT" &&
    gates.conflict.gate === "CONFLICT" &&
    gates.freshness.gate === "FRESHNESS" &&
    gates.source_independence.gate === "SOURCE_INDEPENDENCE" &&
    Object.values(gates).every(({ verdict }) => verdict === "PASS")
  );
}

export async function createReportReadyCertificateFromResolvedFactsCandidate(
  input: CreateReportReadyResolvedFactsInput,
): Promise<ResearchKernelResult<ReportReadyCertificateV3Payload>> {
  const budget = preflightResearchInput(input, {
    array_limits: [
      {
        path: ["material_support_decisions"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
      {
        path: ["gate_facts", "query_evidence"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
      {
        path: ["gate_facts", "atomic_claims"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
      {
        path: ["gate_facts", "evidence_relations"],
        max_items: U6_WIRE_LIMITS.max_obligations * 2,
      },
      {
        path: ["gate_facts", "evidence_checks"],
        max_items: U6_WIRE_LIMITS.max_obligations * 4,
      },
      {
        path: ["gate_facts", "hypothesis_assessments"],
        max_items: U6_WIRE_LIMITS.max_hypotheses,
      },
      {
        path: ["gate_facts", "support_decisions"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
    ],
  });
  if (!budget.ok) return budget;

  const parsedStop = researchStopDecisionPayloadSchema.safeParse(input.stop_decision);
  const parsedManifest = reportManifestV2PayloadSchema.safeParse(input.report_manifest);
  const parsedReport = analysisReportV2PayloadSchema.safeParse(input.analysis_report);
  const parsedProjection = reportProjectionReceiptPayloadSchema.safeParse(input.projection_receipt);
  if (
    !parsedStop.success ||
    !parsedManifest.success ||
    !parsedReport.success ||
    !parsedProjection.success
  ) {
    return researchKernelFailure(
      "REPORT_READY_AUTHORITY_REQUIRED",
      "Certificate resolved Stop/Manifest/Report/Projection 必须通过 strict wire schema。",
    );
  }
  const { decision_input_hash: _decisionInputHash, ...stopWithoutHash } = parsedStop.data;
  const expectedStopHash = await computeResearchKernelHash("u6-stop-decision@1", stopWithoutHash);
  if (
    input.stop_decision.decision !== "STOP_READY" ||
    input.stop_decision.decision_input_hash !== expectedStopHash ||
    !gateTupleIsValid(input.gate_receipt_refs, input.gates)
  ) {
    return researchKernelFailure(
      "REPORT_READY_AUTHORITY_REQUIRED",
      "ReportReady Candidate 要求 STOP_READY 与四张独立 PASS Gate。",
    );
  }
  const materialConflictRefs = input.report_manifest.sections.flatMap(
    ({ conflict_refs }) => conflict_refs,
  );
  const materialSupportRefs = input.material_support_decisions.map(({ ref }) => ref);
  const gateFactSupportByRef = new Map(
    input.gate_facts.support_decisions.map((resolution) => [
      artifactReferenceIdentity(resolution.ref),
      resolution,
    ]),
  );
  const materialSupportsBelongToGateFacts =
    gateFactSupportByRef.size === input.gate_facts.support_decisions.length &&
    input.material_support_decisions.every((resolution) => {
      const gateResolution = gateFactSupportByRef.get(artifactReferenceIdentity(resolution.ref));
      return (
        gateResolution !== undefined &&
        canonicalizeJson(gateResolution) === canonicalizeJson(resolution)
      );
    });
  const manifestRefutedAssessmentRefs =
    input.report_manifest.sections.find(({ section_id }) => section_id === "REFUTED_HYPOTHESES")
      ?.hypothesis_assessment_refs ?? [];
  const gateFactAssessmentByRef = new Map(
    input.gate_facts.hypothesis_assessments.map((resolution) => [
      artifactReferenceIdentity(resolution.ref),
      resolution,
    ]),
  );
  const gateFactRelationByRef = new Map(
    input.gate_facts.evidence_relations.map((resolution) => [
      artifactReferenceIdentity(resolution.ref),
      resolution,
    ]),
  );
  const allRefutedAssessmentRefs = input.gate_facts.hypothesis_assessments
    .filter(({ payload }) => payload.status === "REFUTED")
    .map(({ ref }) => ref);
  const allRefutedSupportRefs = input.gate_facts.support_decisions
    .filter(({ payload }) => payload.decision === "REFUTED")
    .map(({ ref }) => ref);
  const usedRefutedSupportIdentities = new Set<string>();
  const materialRefutationClosureRefs: EvidenceGateReceiptPayload["evaluated_refs"] = [];
  const materialRefutationEvidenceRefs: QueryEvidenceRef[] = [];
  let exactRefutationClosure = sameReferenceIdentityMultiset(
    manifestRefutedAssessmentRefs,
    allRefutedAssessmentRefs,
  );
  if (exactRefutationClosure) {
    for (const assessmentRef of manifestRefutedAssessmentRefs) {
      const assessment = gateFactAssessmentByRef.get(artifactReferenceIdentity(assessmentRef));
      if (assessment?.payload.status !== "REFUTED") {
        exactRefutationClosure = false;
        break;
      }
      materialRefutationClosureRefs.push(assessment.ref);
      const assessmentSupportIdentities =
        assessment.payload.support_decision_refs.map(artifactReferenceIdentity);
      if (new Set(assessmentSupportIdentities).size !== assessmentSupportIdentities.length) {
        exactRefutationClosure = false;
        break;
      }
      let assessmentHasRefutedSupport = false;
      for (const supportRef of assessment.payload.support_decision_refs) {
        const supportIdentity = artifactReferenceIdentity(supportRef);
        const support = gateFactSupportByRef.get(supportIdentity);
        if (!support) {
          exactRefutationClosure = false;
          break;
        }
        if (support.payload.decision === "SUPPORTED") {
          continue;
        }
        if (support.payload.decision !== "REFUTED") {
          exactRefutationClosure = false;
          break;
        }
        assessmentHasRefutedSupport = true;
        if (usedRefutedSupportIdentities.has(supportIdentity)) {
          continue;
        }
        usedRefutedSupportIdentities.add(supportIdentity);
        materialRefutationClosureRefs.push(
          support.ref,
          support.payload.claim_ref,
          ...support.payload.relation_refs,
          ...support.payload.check_receipt_refs,
        );
        for (const relationRef of support.payload.relation_refs) {
          const relation = gateFactRelationByRef.get(artifactReferenceIdentity(relationRef));
          if (relation?.payload.proposed_relation !== "REFUTES") {
            exactRefutationClosure = false;
            break;
          }
          materialRefutationEvidenceRefs.push(relation.payload.evidence_ref);
          materialRefutationClosureRefs.push(relation.payload.evidence_ref);
        }
        if (!exactRefutationClosure) break;
      }
      if (!assessmentHasRefutedSupport) {
        exactRefutationClosure = false;
      }
      if (!exactRefutationClosure) break;
    }
  }
  exactRefutationClosure =
    exactRefutationClosure &&
    sameReferenceIdentityMultiset(
      [...usedRefutedSupportIdentities]
        .map((identity) => gateFactSupportByRef.get(identity)?.ref)
        .filter((reference): reference is SupportDecisionRef => reference !== undefined),
      allRefutedSupportRefs,
    );
  const exactSupportedSubset =
    sameReferenceIdentityMultiset(
      input.report_manifest.material_claim_refs,
      input.stop_decision.supported_subset.claim_refs,
    ) &&
    sameReferenceIdentityMultiset(
      materialSupportRefs,
      input.stop_decision.supported_subset.support_decision_refs,
    );
  const hasMaterialSupportedClosure = input.report_manifest.material_claim_refs.length > 0;
  const hasMaterialRefutationClosure =
    manifestRefutedAssessmentRefs.length > 0 && exactRefutationClosure;
  const allRefutedReportingShapeIsValid =
    hasMaterialSupportedClosure ||
    (input.stop_decision.supported_subset.claim_refs.length === 0 &&
      input.stop_decision.supported_subset.support_decision_refs.length === 0 &&
      input.material_support_decisions.length === 0 &&
      hasMaterialRefutationClosure);
  const regeneratedGates = await evaluateEvidenceGatesFromResolvedFacts(input.gate_facts);
  if (
    !regeneratedGates.ok ||
    canonicalizeJson(regeneratedGates.value) !== canonicalizeJson(input.gates) ||
    artifactReferenceIdentity(input.gate_facts.report_manifest_ref) !==
      artifactReferenceIdentity(input.report_manifest_ref) ||
    canonicalizeJson(input.gate_facts.report_manifest) !==
      canonicalizeJson(input.report_manifest) ||
    artifactReferenceIdentity(input.gate_facts.analysis_report_ref) !==
      artifactReferenceIdentity(input.analysis_report_ref) ||
    canonicalizeJson(input.gate_facts.analysis_report) !==
      canonicalizeJson(input.analysis_report) ||
    canonicalizeJson(input.gate_facts.current_version_frontier) !==
      canonicalizeJson(input.version_frontier) ||
    !materialSupportsBelongToGateFacts ||
    !exactSupportedSubset ||
    !exactRefutationClosure ||
    !allRefutedReportingShapeIsValid ||
    !containsAllReferenceIdentities(input.gates.support.evaluated_refs, [
      input.report_manifest_ref,
      ...input.report_manifest.material_claim_refs,
      ...materialSupportRefs,
      ...materialRefutationClosureRefs,
    ]) ||
    !containsAllReferenceIdentities(input.gates.source_independence.evaluated_refs, [
      input.gate_facts.brief_ref,
      input.report_manifest_ref,
      input.analysis_report_ref,
      ...input.gate_facts.atomic_claims
        .filter(({ ref }) =>
          input.report_manifest.material_claim_refs.some(
            (materialRef) =>
              artifactReferenceIdentity(materialRef) === artifactReferenceIdentity(ref),
          ),
        )
        .flatMap(({ payload }) => payload.evidence_refs),
      ...materialRefutationClosureRefs,
      ...materialRefutationEvidenceRefs,
    ]) ||
    !containsAllReferenceIdentities(input.gates.conflict.evaluated_refs, [
      input.report_manifest_ref,
      input.analysis_report_ref,
      ...materialConflictRefs,
    ]) ||
    !containsAllReferenceIdentities(input.gates.freshness.evaluated_refs, [
      input.gate_facts.brief_ref,
      ...input.gate_facts.query_evidence.map(({ ref }) => ref),
      input.version_frontier.semantic_release_ref,
      input.version_frontier.schema_snapshot_ref,
      input.version_frontier.policy_receipt_ref,
    ])
  ) {
    return researchKernelFailure(
      "REPORT_READY_AUTHORITY_REQUIRED",
      "Evidence Gate 必须由 gate-specific resolved facts 重算，并覆盖 Manifest material closure。",
    );
  }
  if (
    input.projection_receipt.forbidden_claim_mode_scan !== "PASS" ||
    input.projection_receipt.reason_codes.length !== 0 ||
    artifactReferenceIdentity(input.report_manifest.brief_ref) !==
      artifactReferenceIdentity(input.gate_facts.brief_ref) ||
    artifactReferenceIdentity(input.report_manifest.stop_decision_ref) !==
      artifactReferenceIdentity(input.stop_decision_ref) ||
    artifactReferenceIdentity(input.analysis_report.manifest_ref) !==
      artifactReferenceIdentity(input.report_manifest_ref) ||
    artifactReferenceIdentity(input.projection_receipt.manifest_ref) !==
      artifactReferenceIdentity(input.report_manifest_ref) ||
    artifactReferenceIdentity(input.projection_receipt.report_ref) !==
      artifactReferenceIdentity(input.analysis_report_ref) ||
    input.projection_receipt.manifest_hash !== input.report_manifest.manifest_hash ||
    input.projection_receipt.projection_hash !== input.analysis_report.projection_hash
  ) {
    return researchKernelFailure(
      "REPORT_READY_CERTIFICATE_TAMPERED",
      "Report/Manifest/Projection Receipt exact closure 不一致。",
    );
  }
  const manifestHashMaterial = {
    brief_ref: input.report_manifest.brief_ref,
    stop_decision_ref: input.report_manifest.stop_decision_ref,
    sections: input.report_manifest.sections,
    material_claim_refs: input.report_manifest.material_claim_refs,
    required_disclosures: input.report_manifest.required_disclosures,
    allowed_style_profile: input.report_manifest.allowed_style_profile,
  };
  const expectedManifestHash = await computeResearchKernelHash(
    "u6-report-manifest@2",
    manifestHashMaterial,
  );
  const expectedTitle = renderZhL2ResearchTitleV1(input.gate_facts.brief.scope.subject);
  const expectedTitleHash = await computeResearchKernelHash("u6-report-title@1", expectedTitle);
  const projectionMaterial = {
    manifest_ref: input.analysis_report.manifest_ref,
    title_template_id: input.analysis_report.title_template_id,
    title: input.analysis_report.title,
    title_hash: input.analysis_report.title_hash,
    sections: input.analysis_report.sections,
    disclosures: input.analysis_report.disclosures,
  };
  const expectedProjectionHash = await computeResearchKernelHash(
    "u6-analysis-report-projection@1",
    projectionMaterial,
  );
  const expectedRenderedStatementHashes = await Promise.all(
    input.analysis_report.sections
      .flatMap(({ statement_units }) => statement_units)
      .map((statement) => computeResearchKernelHash("u6-report-statement@1", statement)),
  );
  const claimByIdentity = new Map(
    input.gate_facts.atomic_claims.map((claim) => [artifactReferenceIdentity(claim.ref), claim]),
  );
  const materialClaims = input.report_manifest.material_claim_refs.map((reference) =>
    claimByIdentity.get(artifactReferenceIdentity(reference)),
  );
  const expectedClaimClosureHash = materialClaims.some((claim) => claim === undefined)
    ? null
    : await computeResearchKernelHash(
        "u6-material-claim-closure@1",
        materialClaims as ReadinessResolvedArtifact<AtomicClaimRef, AtomicClaimV2Payload>[],
      );
  if (
    input.report_manifest.manifest_hash !== expectedManifestHash ||
    input.analysis_report.title_template_id !== "ZH_L2_RESEARCH_TITLE_V1" ||
    input.analysis_report.title !== expectedTitle ||
    input.analysis_report.title_hash !== expectedTitleHash ||
    input.analysis_report.projection_hash !== expectedProjectionHash ||
    input.projection_receipt.title_hash !== expectedTitleHash ||
    canonicalizeJson(input.projection_receipt.rendered_statement_hashes) !==
      canonicalizeJson(expectedRenderedStatementHashes) ||
    expectedClaimClosureHash === null ||
    input.projection_receipt.claim_closure_hash !== expectedClaimClosureHash
  ) {
    return researchKernelFailure(
      "REPORT_READY_CERTIFICATE_TAMPERED",
      "Manifest、Report 或 Projection Receipt 的内容 hash 重算失败。",
    );
  }
  const supportByClaim = new Map(
    input.material_support_decisions.map(({ ref, payload }) => [
      artifactReferenceIdentity(payload.claim_ref),
      { ref, payload },
    ]),
  );
  const materialSupportRefIdentities = input.material_support_decisions.map(({ ref }) =>
    artifactReferenceIdentity(ref),
  );
  if (
    supportByClaim.size !== input.material_support_decisions.length ||
    new Set(materialSupportRefIdentities).size !== materialSupportRefIdentities.length ||
    input.report_manifest.material_claim_refs.some((reference) => {
      const support = supportByClaim.get(artifactReferenceIdentity(reference));
      return support?.payload.decision !== "SUPPORTED";
    }) ||
    supportByClaim.size !== input.report_manifest.material_claim_refs.length
  ) {
    return researchKernelFailure(
      "REPORT_READY_AUTHORITY_REQUIRED",
      "Certificate material Support 必须与 Manifest material Claim 一一闭合。",
    );
  }
  const material_support_decision_refs = input.report_manifest.material_claim_refs.map(
    (reference) => supportByClaim.get(artifactReferenceIdentity(reference))?.ref,
  );
  if (
    material_support_decision_refs.some(
      (reference): reference is undefined => reference === undefined,
    )
  ) {
    return researchKernelFailure(
      "REPORT_READY_AUTHORITY_REQUIRED",
      "Certificate 缺少 material SupportDecision Reference。",
    );
  }
  const typedMaterialSupportRefs = material_support_decision_refs as SupportDecisionRef[];
  const closureMaterial = {
    stop_decision_ref: input.stop_decision_ref,
    report_manifest_ref: input.report_manifest_ref,
    analysis_report_ref: input.analysis_report_ref,
    projection_receipt_ref: input.projection_receipt_ref,
    gate_receipt_refs: input.gate_receipt_refs,
    material_support_decision_refs: typedMaterialSupportRefs,
    version_frontier: input.version_frontier,
    evaluated_through_input_event_seq: input.evaluated_through_input_event_seq,
  };
  const input_closure_hash = await computeResearchKernelHash(
    "u6-report-ready-input-closure@2",
    closureMaterial,
  );
  const candidateWithPlaceholder = {
    artifact_type: "ReportReadyCertificate",
    protocol_version: "report-ready@3.0.0",
    ...closureMaterial,
    input_closure_hash,
    certificate_semantic_hash: `sha256:${"0".repeat(64)}` as const,
  };
  const certificate_semantic_hash = await computeL2ResearchSemanticHash(candidateWithPlaceholder);
  const candidate = {
    ...candidateWithPlaceholder,
    certificate_semantic_hash,
  };
  const parsed = reportReadyCertificateV3PayloadSchema.safeParse(candidate);
  if (!parsed.success) {
    return researchKernelFailure(
      "REPORT_READY_AUTHORITY_REQUIRED",
      parsed.error.issues[0]?.message ?? "ReportReady Certificate Candidate 无效。",
    );
  }
  return verifyReportReadyCertificateCandidate(parsed.data);
}

const REPORT_READY_DOCUMENT_INPUT_KEYS = [
  "stop_decision_resolution",
  "report_manifest_resolution",
  "report_projection_resolution",
  "gate_receipt_documents",
  "gate_facts",
  "version_frontier",
  "evaluated_through_input_event_seq",
] as const;

async function exactResolutionDocumentSet(
  left: readonly { readonly document: L2ResearchDocumentCandidate }[],
  right: readonly { readonly document: L2ResearchDocumentCandidate }[],
  artifactType: L2ResearchDocumentCandidate["payload"]["artifact_type"],
  requestContext?: ResearchRequestReplayContext,
): Promise<boolean> {
  const resolveIdentities = async (
    values: readonly { readonly document: L2ResearchDocumentCandidate }[],
  ): Promise<string[] | null> => {
    const identities: string[] = [];
    for (const value of values) {
      const resolved = await resolveResearchDocumentCandidate(
        value.document,
        artifactType,
        requestContext,
      );
      if (!resolved.ok) return null;
      identities.push(artifactReferenceIdentity(resolved.value.ref));
    }
    return new Set(identities).size === identities.length ? identities.sort(stableCompare) : null;
  };
  const [leftIdentities, rightIdentities] = await Promise.all([
    resolveIdentities(left),
    resolveIdentities(right),
  ]);
  return (
    leftIdentities !== null &&
    rightIdentities !== null &&
    canonicalizeJson(leftIdentities) === canonicalizeJson(rightIdentities)
  );
}

async function createReportReadyCertificateCandidateUncached(
  input: CreateReportReadyCandidateInput,
  requestContext?: ResearchRequestReplayContext,
  proofContext = createProofDerivationReplayContext(requestContext),
): Promise<ResearchKernelResult<ReportReadyCertificateV3Payload>> {
  const budget = preflightResearchInput(input, {
    array_limits: [
      {
        path: ["gate_facts", "query_evidence_resolutions"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
      {
        path: ["gate_facts", "atomic_claim_resolutions"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
      {
        path: ["gate_facts", "evidence_relation_resolutions"],
        max_items: U6_WIRE_LIMITS.max_obligations * 2,
      },
      {
        path: ["gate_facts", "evidence_check_resolutions"],
        max_items: U6_WIRE_LIMITS.max_obligations * 4,
      },
      {
        path: ["gate_facts", "hypothesis_assessment_resolutions"],
        max_items: U6_WIRE_LIMITS.max_hypotheses,
      },
      {
        path: ["gate_facts", "support_decision_resolutions"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
    ],
  });
  if (!budget.ok) return budget;

  if (
    !exactObjectKeys(input, REPORT_READY_DOCUMENT_INPUT_KEYS) ||
    !exactObjectKeys(input.gate_receipt_documents, [
      "support",
      "conflict",
      "freshness",
      "source_independence",
    ])
  ) {
    return researchKernelFailure(
      "REPORT_READY_AUTHORITY_REQUIRED",
      "ReportReady 输入必须是 exact document closure 与数组。",
    );
  }
  if (!evidenceGateDocumentInputShapeIsValid(input.gate_facts)) {
    return researchKernelFailure(
      "REPORT_READY_AUTHORITY_REQUIRED",
      "ReportReady gate_facts 必须是完整 exact document resolution closure。",
    );
  }
  const [stop, manifest, projection, supportGate, conflictGate, freshnessGate, sourceGate] =
    await Promise.all([
      resolveResearchStopDecisionDocumentResolution(input.stop_decision_resolution, requestContext),
      resolveReportManifestDocumentResolution(input.report_manifest_resolution, requestContext),
      resolveReportProjectionDocumentResolution(input.report_projection_resolution, requestContext),
      resolveResearchDocumentCandidate(
        input.gate_receipt_documents.support,
        "EvidenceGateReceipt",
        requestContext,
      ),
      resolveResearchDocumentCandidate(
        input.gate_receipt_documents.conflict,
        "EvidenceGateReceipt",
        requestContext,
      ),
      resolveResearchDocumentCandidate(
        input.gate_receipt_documents.freshness,
        "EvidenceGateReceipt",
        requestContext,
      ),
      resolveResearchDocumentCandidate(
        input.gate_receipt_documents.source_independence,
        "EvidenceGateReceipt",
        requestContext,
      ),
    ]);
  if (
    !stop.ok ||
    !manifest.ok ||
    !projection.ok ||
    !supportGate.ok ||
    !conflictGate.ok ||
    !freshnessGate.ok ||
    !sourceGate.ok ||
    supportGate.value.document.payload.artifact_type !== "EvidenceGateReceipt" ||
    conflictGate.value.document.payload.artifact_type !== "EvidenceGateReceipt" ||
    freshnessGate.value.document.payload.artifact_type !== "EvidenceGateReceipt" ||
    sourceGate.value.document.payload.artifact_type !== "EvidenceGateReceipt"
  ) {
    return researchKernelFailure(
      "REPORT_READY_AUTHORITY_REQUIRED",
      "ReportReady dependency 必须全部是 strict content-addressed Candidate Document。",
    );
  }
  const [
    authoritativeBrief,
    manifestBrief,
    projectionBrief,
    projectionManifest,
    gateBrief,
    gateManifest,
    gateReport,
  ] = await Promise.all([
    resolveResearchDocumentCandidate(
      stop.value.derivation_input.pre_stop_readiness.brief_document,
      "ResearchBrief",
      requestContext,
    ),
    resolveResearchDocumentCandidate(
      manifest.value.derivation_input.brief_document,
      "ResearchBrief",
      requestContext,
    ),
    resolveResearchDocumentCandidate(
      projection.value.derivation_input.brief_document,
      "ResearchBrief",
      requestContext,
    ),
    resolveResearchDocumentCandidate(
      projection.value.derivation_input.manifest_document,
      "ReportManifest",
      requestContext,
    ),
    resolveResearchDocumentCandidate(
      input.gate_facts.brief_document,
      "ResearchBrief",
      requestContext,
    ),
    resolveResearchDocumentCandidate(
      input.gate_facts.report_manifest_document,
      "ReportManifest",
      requestContext,
    ),
    resolveResearchDocumentCandidate(
      input.gate_facts.analysis_report_document,
      "AnalysisReport",
      requestContext,
    ),
  ]);
  if (
    !authoritativeBrief.ok ||
    !manifestBrief.ok ||
    !projectionBrief.ok ||
    !projectionManifest.ok ||
    !gateBrief.ok ||
    !gateManifest.ok ||
    !gateReport.ok ||
    canonicalizeJson(manifest.value.derivation_input.stop_decision_resolution) !==
      canonicalizeJson(input.stop_decision_resolution) ||
    artifactReferenceIdentity(manifest.value.payload.stop_decision_ref) !==
      artifactReferenceIdentity(stop.value.ref) ||
    artifactReferenceIdentity(authoritativeBrief.value.ref) !==
      artifactReferenceIdentity(manifestBrief.value.ref) ||
    artifactReferenceIdentity(authoritativeBrief.value.ref) !==
      artifactReferenceIdentity(projectionBrief.value.ref) ||
    artifactReferenceIdentity(authoritativeBrief.value.ref) !==
      artifactReferenceIdentity(gateBrief.value.ref) ||
    artifactReferenceIdentity(manifest.value.ref) !==
      artifactReferenceIdentity(projectionManifest.value.ref) ||
    artifactReferenceIdentity(manifest.value.ref) !==
      artifactReferenceIdentity(gateManifest.value.ref) ||
    artifactReferenceIdentity(projection.value.report_ref) !==
      artifactReferenceIdentity(gateReport.value.ref)
  ) {
    return researchKernelFailure(
      "REPORT_READY_AUTHORITY_REQUIRED",
      "Brief→Plan→Coverage→Stop→Manifest→Report 必须来自同一条 exact production derivation chain。",
    );
  }
  const coverageResolution = stop.value.derivation_input.coverage_resolution;
  const proofClosureMatches = await Promise.all([
    exactResolutionDocumentSet(
      input.gate_facts.query_evidence_resolutions,
      coverageResolution.query_evidence_resolutions,
      "QueryEvidence",
      requestContext,
    ),
    exactResolutionDocumentSet(
      input.gate_facts.atomic_claim_resolutions,
      coverageResolution.atomic_claim_resolutions,
      "AtomicClaim",
      requestContext,
    ),
    exactResolutionDocumentSet(
      input.gate_facts.evidence_relation_resolutions,
      coverageResolution.evidence_relation_resolutions,
      "EvidenceRelation",
      requestContext,
    ),
    exactResolutionDocumentSet(
      input.gate_facts.evidence_check_resolutions,
      coverageResolution.evidence_check_resolutions,
      "EvidenceCheckReceipt",
      requestContext,
    ),
    exactResolutionDocumentSet(
      input.gate_facts.support_decision_resolutions,
      coverageResolution.support_decision_resolutions,
      "SupportDecision",
      requestContext,
    ),
    exactResolutionDocumentSet(
      input.gate_facts.hypothesis_assessment_resolutions,
      coverageResolution.hypothesis_assessment_resolutions,
      "HypothesisAssessment",
      requestContext,
    ),
  ]);
  if (proofClosureMatches.some((matches) => !matches)) {
    return researchKernelFailure(
      "REPORT_READY_AUTHORITY_REQUIRED",
      "Gate Facts 的 QE/Claim/Relation/Check/Support/Assessment 必须精确等于 Stop-bound Coverage 完整闭包。",
    );
  }
  const resolvedGateFacts = await resolveEvidenceGateDocumentFacts(
    input.gate_facts,
    requestContext,
    proofContext,
  );
  if (!resolvedGateFacts.ok) return resolvedGateFacts;
  const regeneratedGates = await evaluateEvidenceGatesFromResolvedFacts(resolvedGateFacts.value);
  if (!regeneratedGates.ok) return regeneratedGates;
  const gates: EvidenceGateCandidateBundle = {
    support: supportGate.value.document.payload,
    conflict: conflictGate.value.document.payload,
    freshness: freshnessGate.value.document.payload,
    source_independence: sourceGate.value.document.payload,
  };
  if (
    gates.support.gate !== "SUPPORT" ||
    gates.conflict.gate !== "CONFLICT" ||
    gates.freshness.gate !== "FRESHNESS" ||
    gates.source_independence.gate !== "SOURCE_INDEPENDENCE" ||
    canonicalizeJson(gates) !== canonicalizeJson(regeneratedGates.value)
  ) {
    return researchKernelFailure(
      "REPORT_READY_AUTHORITY_REQUIRED",
      "EvidenceGateReceipt Documents 必须与 document-backed gate facts 重算结果一致。",
    );
  }

  const stopSupportIdentities = new Set(
    stop.value.payload.supported_subset.support_decision_refs.map(artifactReferenceIdentity),
  );
  const materialSupports = resolvedGateFacts.value.support_decisions.filter(({ ref }) =>
    stopSupportIdentities.has(artifactReferenceIdentity(ref)),
  );

  return createReportReadyCertificateFromResolvedFactsCandidate({
    stop_decision_ref: stop.value.ref,
    stop_decision: stop.value.payload,
    report_manifest_ref: manifest.value.ref,
    report_manifest: manifest.value.payload,
    analysis_report_ref: projection.value.report_ref,
    analysis_report: projection.value.report,
    projection_receipt_ref: projection.value.receipt_ref,
    projection_receipt: projection.value.receipt,
    gate_receipt_refs: {
      support: supportGate.value.ref as EvidenceGateReceiptRef,
      conflict: conflictGate.value.ref as EvidenceGateReceiptRef,
      freshness: freshnessGate.value.ref as EvidenceGateReceiptRef,
      source_independence: sourceGate.value.ref as EvidenceGateReceiptRef,
    },
    gates,
    gate_facts: resolvedGateFacts.value,
    material_support_decisions: materialSupports,
    version_frontier: input.version_frontier,
    evaluated_through_input_event_seq: input.evaluated_through_input_event_seq,
  });
}

/**
 * Public ReportReady boundary. It resolves every dependency from a complete
 * Candidate document, regenerates all four gates from document-backed facts,
 * and only then delegates to the deterministic certificate reducer.
 */
export async function createReportReadyCertificateCandidate(
  input: CreateReportReadyCandidateInput,
): Promise<ResearchKernelResult<ReportReadyCertificateV3Payload>> {
  return createReportReadyCertificateCandidateUncached(input);
}

export function createReportReadyCertificateCandidateWithReplayContext(
  input: CreateReportReadyCandidateInput,
  requestContext: ResearchRequestReplayContext,
): Promise<ResearchKernelResult<ReportReadyCertificateV3Payload>> {
  return memoizeSuccessfulResearchReplay(requestContext, "stage:report-ready", input, () =>
    createReportReadyCertificateCandidateUncached(
      input,
      requestContext,
      createProofDerivationReplayContext(requestContext),
    ),
  );
}

export async function verifyReportReadyCertificateCandidate(
  candidate: ReportReadyCertificateV3Payload,
): Promise<ResearchKernelResult<ReportReadyCertificateV3Payload>> {
  const budget = preflightResearchInput(candidate);
  if (!budget.ok) return budget;

  const parsed = reportReadyCertificateV3PayloadSchema.safeParse(candidate);
  if (!parsed.success) {
    return researchKernelFailure(
      "REPORT_READY_CERTIFICATE_TAMPERED",
      parsed.error.issues[0]?.message ?? "ReportReady Certificate Candidate 结构无效。",
    );
  }
  const value = parsed.data;
  const closureMaterial = {
    stop_decision_ref: value.stop_decision_ref,
    report_manifest_ref: value.report_manifest_ref,
    analysis_report_ref: value.analysis_report_ref,
    projection_receipt_ref: value.projection_receipt_ref,
    gate_receipt_refs: value.gate_receipt_refs,
    material_support_decision_refs: value.material_support_decision_refs,
    version_frontier: value.version_frontier,
    evaluated_through_input_event_seq: value.evaluated_through_input_event_seq,
  };
  const expectedClosureHash = await computeResearchKernelHash(
    "u6-report-ready-input-closure@2",
    closureMaterial,
  );
  if (value.input_closure_hash !== expectedClosureHash) {
    return researchKernelFailure(
      "REPORT_READY_CERTIFICATE_TAMPERED",
      "ReportReady Certificate input closure hash 不匹配。",
    );
  }
  const expectedSemanticHash = await computeL2ResearchSemanticHash({
    ...value,
    certificate_semantic_hash: `sha256:${"0".repeat(64)}`,
  });
  if (value.certificate_semantic_hash !== expectedSemanticHash) {
    return researchKernelFailure(
      "CERTIFICATE_SEMANTIC_HASH_MISMATCH",
      "ReportReady Certificate semantic hash 不匹配。",
    );
  }
  return researchKernelSuccess(value);
}
