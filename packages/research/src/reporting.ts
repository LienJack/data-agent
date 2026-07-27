import {
  type AnalysisReportRef,
  type AnalysisReportV2Payload,
  type AtomicClaimRef,
  type AtomicClaimV2Payload,
  analysisReportV2PayloadSchema,
  artifactReferenceIdentity,
  canonicalizeJson,
  type EvidenceRelationRef,
  type EvidenceRelationV2Payload,
  type HypothesisAssessmentPayload,
  type HypothesisAssessmentRef,
  type L2ResearchDocumentCandidate,
  type ReportManifestRef,
  type ReportManifestV2Payload,
  type ReportProjectionReceiptPayload,
  type ReportProjectionReceiptRef,
  type ResearchBriefV2Payload,
  reportManifestV2PayloadSchema,
  reportProjectionReceiptPayloadSchema,
  type SupportDecisionPayload,
  type SupportDecisionRef,
  U6_WIRE_LIMITS,
} from "@data-agent/contracts";
import {
  type ResearchKernelResult,
  researchKernelFailure,
  researchKernelSuccess,
} from "./errors.js";
import { preflightResearchInput } from "./input-budget.js";
import { resolveResearchDocumentCandidate } from "./internal/document-resolution.js";
import { computeResearchKernelHash } from "./internal/hash.js";
import {
  sameReferenceIdentityMultiset,
  sameReferenceScope,
  uniqueReferences,
} from "./internal/reference-identity.js";
import {
  memoizeSuccessfulResearchReplay,
  type ResearchRequestReplayContext,
} from "./internal/request-replay-context.js";
import { exactObjectKeys } from "./internal/value-shape.js";
import {
  type ResearchStopDecisionDocumentResolution,
  resolveResearchStopDecisionDocumentResolution,
} from "./stop.js";

export interface BuildReportManifestInput {
  readonly brief_document: L2ResearchDocumentCandidate;
  readonly stop_decision_resolution: ResearchStopDecisionDocumentResolution;
  readonly executive_claim_documents: readonly L2ResearchDocumentCandidate[];
  readonly supported_finding_claim_documents: readonly L2ResearchDocumentCandidate[];
  readonly support_decision_documents: readonly L2ResearchDocumentCandidate[];
  readonly refuted_hypothesis_assessment_documents: readonly L2ResearchDocumentCandidate[];
  readonly conflict_relation_documents: readonly L2ResearchDocumentCandidate[];
  readonly limitation_codes: readonly string[];
}

export interface ResolvedReportArtifact<Reference, Payload> {
  readonly ref: Reference;
  readonly payload: Payload;
}

const BUILD_REPORT_MANIFEST_INPUT_KEYS = [
  "brief_document",
  "stop_decision_resolution",
  "executive_claim_documents",
  "supported_finding_claim_documents",
  "support_decision_documents",
  "refuted_hypothesis_assessment_documents",
  "conflict_relation_documents",
  "limitation_codes",
] as const;

async function resolveAtomicClaimDocuments(
  documents: readonly L2ResearchDocumentCandidate[],
  requestContext?: ResearchRequestReplayContext,
): Promise<ResearchKernelResult<ResolvedReportArtifact<AtomicClaimRef, AtomicClaimV2Payload>[]>> {
  const resolved: ResolvedReportArtifact<AtomicClaimRef, AtomicClaimV2Payload>[] = [];
  for (const document of documents) {
    const result = await resolveResearchDocumentCandidate(document, "AtomicClaim", requestContext);
    if (!result.ok || result.value.document.payload.artifact_type !== "AtomicClaim") {
      return researchKernelFailure(
        "REPORT_PROJECTION_AUTHORITY_INVALID",
        result.ok ? "AtomicClaim Document 类型漂移。" : result.error.message,
      );
    }
    resolved.push({
      ref: result.value.ref as AtomicClaimRef,
      payload: result.value.document.payload,
    });
  }
  return researchKernelSuccess(resolved);
}

async function resolveSupportDocuments(
  documents: readonly L2ResearchDocumentCandidate[],
  requestContext?: ResearchRequestReplayContext,
): Promise<
  ResearchKernelResult<ResolvedReportArtifact<SupportDecisionRef, SupportDecisionPayload>[]>
> {
  const resolved: ResolvedReportArtifact<SupportDecisionRef, SupportDecisionPayload>[] = [];
  for (const document of documents) {
    const result = await resolveResearchDocumentCandidate(
      document,
      "SupportDecision",
      requestContext,
    );
    if (!result.ok || result.value.document.payload.artifact_type !== "SupportDecision") {
      return researchKernelFailure(
        "REPORT_PROJECTION_AUTHORITY_INVALID",
        result.ok ? "SupportDecision Document 类型漂移。" : result.error.message,
      );
    }
    const {
      artifact_type: _artifactType,
      protocol_version: _protocolVersion,
      input_closure_hash: declaredHash,
      ...hashMaterial
    } = result.value.document.payload;
    if (declaredHash !== (await computeResearchKernelHash("u6-support-decision@1", hashMaterial))) {
      return researchKernelFailure(
        "REPORT_PROJECTION_AUTHORITY_INVALID",
        "SupportDecision Document 的 input_closure_hash 重算失败。",
      );
    }
    resolved.push({
      ref: result.value.ref as SupportDecisionRef,
      payload: result.value.document.payload,
    });
  }
  return researchKernelSuccess(resolved);
}

async function resolveAssessmentDocuments(
  documents: readonly L2ResearchDocumentCandidate[],
  requestContext?: ResearchRequestReplayContext,
): Promise<
  ResearchKernelResult<
    ResolvedReportArtifact<HypothesisAssessmentRef, HypothesisAssessmentPayload>[]
  >
> {
  const resolved: ResolvedReportArtifact<HypothesisAssessmentRef, HypothesisAssessmentPayload>[] =
    [];
  for (const document of documents) {
    const result = await resolveResearchDocumentCandidate(
      document,
      "HypothesisAssessment",
      requestContext,
    );
    if (!result.ok || result.value.document.payload.artifact_type !== "HypothesisAssessment") {
      return researchKernelFailure(
        "REPORT_PROJECTION_AUTHORITY_INVALID",
        result.ok ? "HypothesisAssessment Document 类型漂移。" : result.error.message,
      );
    }
    resolved.push({
      ref: result.value.ref as HypothesisAssessmentRef,
      payload: result.value.document.payload,
    });
  }
  return researchKernelSuccess(resolved);
}

async function resolveConflictDocuments(
  documents: readonly L2ResearchDocumentCandidate[],
  requestContext?: ResearchRequestReplayContext,
): Promise<
  ResearchKernelResult<ResolvedReportArtifact<EvidenceRelationRef, EvidenceRelationV2Payload>[]>
> {
  const resolved: ResolvedReportArtifact<EvidenceRelationRef, EvidenceRelationV2Payload>[] = [];
  for (const document of documents) {
    const result = await resolveResearchDocumentCandidate(
      document,
      "EvidenceRelation",
      requestContext,
    );
    if (!result.ok || result.value.document.payload.artifact_type !== "EvidenceRelation") {
      return researchKernelFailure(
        "REPORT_PROJECTION_AUTHORITY_INVALID",
        result.ok ? "EvidenceRelation Document 类型漂移。" : result.error.message,
      );
    }
    if (result.value.document.payload.proposed_relation !== "CONFLICTS") {
      return researchKernelFailure(
        "REPORT_PROJECTION_AUTHORITY_INVALID",
        "CONFLICTS Section 只能消费 proposed_relation=CONFLICTS 的 EvidenceRelation。",
      );
    }
    resolved.push({
      ref: result.value.ref as EvidenceRelationRef,
      payload: result.value.document.payload,
    });
  }
  return researchKernelSuccess(resolved);
}

async function buildReportManifestCandidateUncached(
  input: BuildReportManifestInput,
  requestContext?: ResearchRequestReplayContext,
): Promise<ResearchKernelResult<ReportManifestV2Payload>> {
  const budget = preflightResearchInput(input, {
    array_limits: [
      {
        path: ["executive_claim_documents"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
      {
        path: ["supported_finding_claim_documents"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
      {
        path: ["support_decision_documents"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
      {
        path: ["refuted_hypothesis_assessment_documents"],
        max_items: U6_WIRE_LIMITS.max_hypotheses,
      },
      {
        path: ["conflict_relation_documents"],
        max_items: U6_WIRE_LIMITS.max_obligations * 2,
      },
      {
        path: ["limitation_codes"],
        max_items: U6_WIRE_LIMITS.max_required_disclosures,
      },
    ],
  });
  if (!budget.ok) return budget;

  if (
    !exactObjectKeys(input, BUILD_REPORT_MANIFEST_INPUT_KEYS) ||
    !Array.isArray(input.executive_claim_documents) ||
    !Array.isArray(input.supported_finding_claim_documents) ||
    !Array.isArray(input.support_decision_documents) ||
    !Array.isArray(input.refuted_hypothesis_assessment_documents) ||
    !Array.isArray(input.conflict_relation_documents) ||
    !Array.isArray(input.limitation_codes)
  ) {
    return researchKernelFailure(
      "REPORT_PROJECTION_AUTHORITY_INVALID",
      "ReportManifest 必须消费 exact document closure 与数组。",
    );
  }
  const stop = await resolveResearchStopDecisionDocumentResolution(
    input.stop_decision_resolution,
    requestContext,
  );
  if (!stop.ok) {
    return researchKernelFailure(
      "REPORT_PROJECTION_AUTHORITY_INVALID",
      `ResearchStopDecision production replay 失败：${stop.error.message}`,
    );
  }
  const coverageResolution = stop.value.derivation_input.coverage_resolution;
  const [
    brief,
    authoritativeBrief,
    coverageDocument,
    executiveClaims,
    supportedClaims,
    supports,
    assessments,
    conflicts,
    authoritativeClaims,
    authoritativeSupports,
    authoritativeAssessments,
  ] = await Promise.all([
    resolveResearchDocumentCandidate(input.brief_document, "ResearchBrief", requestContext),
    resolveResearchDocumentCandidate(
      stop.value.derivation_input.pre_stop_readiness.brief_document,
      "ResearchBrief",
      requestContext,
    ),
    resolveResearchDocumentCandidate(
      stop.value.derivation_input.coverage_document,
      "CoverageState",
      requestContext,
    ),
    resolveAtomicClaimDocuments(input.executive_claim_documents, requestContext),
    resolveAtomicClaimDocuments(input.supported_finding_claim_documents, requestContext),
    resolveSupportDocuments(input.support_decision_documents, requestContext),
    resolveAssessmentDocuments(input.refuted_hypothesis_assessment_documents, requestContext),
    resolveConflictDocuments(input.conflict_relation_documents, requestContext),
    resolveAtomicClaimDocuments(
      coverageResolution.atomic_claim_resolutions.map(({ document }) => document),
      requestContext,
    ),
    resolveSupportDocuments(
      coverageResolution.support_decision_resolutions.map(({ document }) => document),
      requestContext,
    ),
    resolveAssessmentDocuments(
      coverageResolution.hypothesis_assessment_resolutions.map(({ document }) => document),
      requestContext,
    ),
  ]);
  const authoritativeRelations: ResolvedReportArtifact<
    EvidenceRelationRef,
    EvidenceRelationV2Payload
  >[] = [];
  for (const { document } of coverageResolution.evidence_relation_resolutions) {
    const relation = await resolveResearchDocumentCandidate(
      document,
      "EvidenceRelation",
      requestContext,
    );
    if (!relation.ok || relation.value.document.payload.artifact_type !== "EvidenceRelation") {
      return researchKernelFailure(
        "REPORT_PROJECTION_AUTHORITY_INVALID",
        relation.ok ? "Coverage EvidenceRelation Document 类型漂移。" : relation.error.message,
      );
    }
    authoritativeRelations.push({
      ref: relation.value.ref as EvidenceRelationRef,
      payload: relation.value.document.payload,
    });
  }
  if (
    !brief.ok ||
    !authoritativeBrief.ok ||
    !coverageDocument.ok ||
    !executiveClaims.ok ||
    !supportedClaims.ok ||
    !supports.ok ||
    !assessments.ok ||
    !conflicts.ok ||
    !authoritativeClaims.ok ||
    !authoritativeSupports.ok ||
    !authoritativeAssessments.ok ||
    brief.value.document.payload.artifact_type !== "ResearchBrief" ||
    authoritativeBrief.value.document.payload.artifact_type !== "ResearchBrief" ||
    coverageDocument.value.document.payload.artifact_type !== "CoverageState"
  ) {
    return researchKernelFailure(
      "REPORT_PROJECTION_AUTHORITY_INVALID",
      "ReportManifest dependency 必须是 strict content-addressed Candidate Document。",
    );
  }
  const briefPayload = brief.value.document.payload;
  const stopPayload = stop.value.payload;
  const authoritativeConflictRelations = authoritativeRelations.filter(
    ({ payload }) => payload.proposed_relation === "CONFLICTS",
  );
  const authoritativeRefutedAssessments = authoritativeAssessments.value.filter(
    ({ payload }) => payload.status === "REFUTED",
  );
  const allResolvedRefs = [
    stop.value.ref,
    ...executiveClaims.value.map(({ ref }) => ref),
    ...supportedClaims.value.map(({ ref }) => ref),
    ...supports.value.map(({ ref }) => ref),
    ...assessments.value.map(({ ref }) => ref),
    ...conflicts.value.map(({ ref }) => ref),
  ];
  if (allResolvedRefs.some((reference) => !sameReferenceScope(brief.value.ref, reference))) {
    return researchKernelFailure(
      "REPORT_PROJECTION_AUTHORITY_INVALID",
      "ReportManifest 所有 Candidate Document 必须属于同一 App/Tenant/Environment/Run。",
    );
  }
  if (
    artifactReferenceIdentity(brief.value.ref) !==
      artifactReferenceIdentity(authoritativeBrief.value.ref) ||
    canonicalizeJson(briefPayload) !==
      canonicalizeJson(authoritativeBrief.value.document.payload) ||
    artifactReferenceIdentity(coverageDocument.value.ref) !==
      artifactReferenceIdentity(stopPayload.coverage_ref)
  ) {
    return researchKernelFailure(
      "REPORT_PROJECTION_AUTHORITY_INVALID",
      "ReportManifest Brief/Coverage 必须精确来自 production-replayed Stop closure。",
    );
  }
  if (stopPayload.decision !== "STOP_READY") {
    return researchKernelFailure(
      "REPORT_PROJECTION_AUTHORITY_INVALID",
      "只有 STOP_READY Candidate 可以进入报告投影。",
    );
  }
  const minimumRequiredDisclosures = [
    ...new Set([
      ...briefPayload.source_independence_policy.required_disclosures,
      briefPayload.hypothesis_universe_policy.required_disclosure,
      "L2_NON_CAUSAL",
    ]),
  ].sort();
  const required_disclosures = [
    ...new Set(stopPayload.supported_subset.required_disclosures),
  ].sort();
  if (
    minimumRequiredDisclosures.some(
      (requiredDisclosure) => !required_disclosures.includes(requiredDisclosure),
    )
  ) {
    return researchKernelFailure(
      "REPORT_PROJECTION_AUTHORITY_INVALID",
      "STOP_READY supported subset 必须至少包含 Brief 派生的 disclosure closure。",
    );
  }
  const materialClaims = uniqueReferences([
    ...executiveClaims.value.map(({ ref }) => ref),
    ...supportedClaims.value.map(({ ref }) => ref),
  ]);
  const supportedDecisionResolutions = supports.value.filter(
    ({ payload }) => payload.decision === "SUPPORTED",
  );
  const refutedDecisionResolutions = supports.value.filter(
    ({ payload }) => payload.decision === "REFUTED",
  );
  const supportedByClaim = new Map(
    supportedDecisionResolutions.map((resolution) => [
      artifactReferenceIdentity(resolution.payload.claim_ref),
      resolution,
    ]),
  );
  const supportByIdentity = new Map(
    supports.value.map((resolution) => [artifactReferenceIdentity(resolution.ref), resolution]),
  );
  const refutedSupportIdentitySet = new Set(
    refutedDecisionResolutions.map(({ ref }) => artifactReferenceIdentity(ref)),
  );
  const usedRefutedSupportIdentitySet = new Set<string>();
  let exactRefutationGraph = true;
  for (const { payload } of assessments.value) {
    if (payload.status !== "REFUTED") {
      exactRefutationGraph = false;
      break;
    }
    const assessmentSupportIdentities =
      payload.support_decision_refs.map(artifactReferenceIdentity);
    const uniqueAssessmentSupportIdentities = new Set(assessmentSupportIdentities);
    if (
      uniqueAssessmentSupportIdentities.size !== assessmentSupportIdentities.length ||
      assessmentSupportIdentities.some((identity) => !supportByIdentity.has(identity))
    ) {
      exactRefutationGraph = false;
      break;
    }
    const assessmentRefutedSupportIdentities = assessmentSupportIdentities.filter(
      (identity) => supportByIdentity.get(identity)?.payload.decision === "REFUTED",
    );
    if (assessmentRefutedSupportIdentities.length === 0) {
      exactRefutationGraph = false;
      break;
    }
    for (const identity of assessmentRefutedSupportIdentities) {
      usedRefutedSupportIdentitySet.add(identity);
    }
  }
  exactRefutationGraph =
    exactRefutationGraph &&
    usedRefutedSupportIdentitySet.size === refutedSupportIdentitySet.size &&
    [...refutedSupportIdentitySet].every((identity) => usedRefutedSupportIdentitySet.has(identity));
  if (
    supports.value.some(
      ({ payload }) => payload.decision !== "SUPPORTED" && payload.decision !== "REFUTED",
    ) ||
    new Set(supports.value.map(({ ref }) => artifactReferenceIdentity(ref))).size !==
      supports.value.length ||
    new Set(materialClaims.map(artifactReferenceIdentity)).size !== materialClaims.length ||
    supportedByClaim.size !== supportedDecisionResolutions.length ||
    supportedByClaim.size !== materialClaims.length ||
    materialClaims.some(
      (reference) =>
        supportedByClaim.get(artifactReferenceIdentity(reference))?.payload.decision !==
        "SUPPORTED",
    ) ||
    !sameReferenceIdentityMultiset(materialClaims, stopPayload.supported_subset.claim_refs) ||
    !sameReferenceIdentityMultiset(
      supportedDecisionResolutions.map(({ ref }) => ref),
      stopPayload.supported_subset.support_decision_refs,
    ) ||
    !sameReferenceIdentityMultiset(
      supports.value.map(({ ref }) => ref),
      authoritativeSupports.value.map(({ ref }) => ref),
    ) ||
    !sameReferenceIdentityMultiset(
      assessments.value.map(({ ref }) => ref),
      authoritativeRefutedAssessments.map(({ ref }) => ref),
    ) ||
    !sameReferenceIdentityMultiset(
      conflicts.value.map(({ ref }) => ref),
      authoritativeConflictRelations.map(({ ref }) => ref),
    ) ||
    !sameReferenceIdentityMultiset(
      authoritativeConflictRelations.map(({ ref }) => ref),
      coverageDocument.value.document.payload.material_conflict_refs,
    ) ||
    materialClaims.some(
      (reference) =>
        !authoritativeClaims.value.some(
          ({ ref }) => artifactReferenceIdentity(ref) === artifactReferenceIdentity(reference),
        ),
    ) ||
    !exactRefutationGraph ||
    (materialClaims.length === 0 && assessments.value.length === 0)
  ) {
    return researchKernelFailure(
      "REPORT_MANIFEST_MATERIAL_CLAIM_INCOMPLETE",
      "ReportManifest 必须精确消费 STOP_READY 的 Supported Subset 或非空 REFUTED Assessment Closure。",
    );
  }
  if (required_disclosures.length === 0) {
    return researchKernelFailure(
      "REPORT_MANIFEST_MATERIAL_CLAIM_INCOMPLETE",
      "ReportManifest 必须包含 disclosure closure。",
    );
  }
  const material_claim_refs = materialClaims;
  const sections: ReportManifestV2Payload["sections"] = [
    {
      section_id: "EXECUTIVE_SUMMARY",
      claim_refs: executiveClaims.value.map(({ ref }) => ref),
      hypothesis_assessment_refs: [],
      conflict_refs: [],
      limitation_codes: [],
    },
    {
      section_id: "SUPPORTED_FINDINGS",
      claim_refs: supportedClaims.value.map(({ ref }) => ref),
      hypothesis_assessment_refs: [],
      conflict_refs: [],
      limitation_codes: [],
    },
    {
      section_id: "REFUTED_HYPOTHESES",
      claim_refs: [],
      hypothesis_assessment_refs: assessments.value.map(({ ref }) => ref),
      conflict_refs: [],
      limitation_codes: [],
    },
    {
      section_id: "CONFLICTS",
      claim_refs: [],
      hypothesis_assessment_refs: [],
      conflict_refs: conflicts.value.map(({ ref }) => ref),
      limitation_codes: [],
    },
    {
      section_id: "LIMITATIONS",
      claim_refs: [],
      hypothesis_assessment_refs: [],
      conflict_refs: [],
      limitation_codes: [...new Set([...input.limitation_codes, ...required_disclosures])].sort(),
    },
    {
      section_id: "METHOD",
      claim_refs: [],
      hypothesis_assessment_refs: [],
      conflict_refs: [],
      limitation_codes: [],
    },
  ];
  const hashMaterial = {
    brief_ref: brief.value.ref,
    stop_decision_ref: stop.value.ref,
    sections,
    material_claim_refs,
    required_disclosures,
    allowed_style_profile: "ZH_L2_RESEARCH_V1" as const,
  };
  const candidate = {
    artifact_type: "ReportManifest",
    protocol_version: "report-manifest@2.0.0",
    ...hashMaterial,
    manifest_hash: await computeResearchKernelHash("u6-report-manifest@2", hashMaterial),
  } as const;
  const parsed = reportManifestV2PayloadSchema.safeParse(candidate);
  return parsed.success
    ? researchKernelSuccess(parsed.data)
    : researchKernelFailure(
        "REPORT_PROJECTION_AUTHORITY_INVALID",
        parsed.error.issues[0]?.message ?? "ReportManifest Candidate 无效。",
      );
}

export function buildReportManifestCandidate(
  input: BuildReportManifestInput,
): Promise<ResearchKernelResult<ReportManifestV2Payload>> {
  return buildReportManifestCandidateUncached(input);
}

export function buildReportManifestCandidateWithReplayContext(
  input: BuildReportManifestInput,
  requestContext: ResearchRequestReplayContext,
): Promise<ResearchKernelResult<ReportManifestV2Payload>> {
  return memoizeSuccessfulResearchReplay(requestContext, "stage:report-manifest", input, () =>
    buildReportManifestCandidateUncached(input, requestContext),
  );
}

export interface WriterProjectionCandidate {
  readonly title: string;
  readonly sections: AnalysisReportV2Payload["sections"];
}

export interface ProjectAnalysisReportInput {
  readonly brief_document: L2ResearchDocumentCandidate;
  readonly manifest_document: L2ResearchDocumentCandidate;
  readonly report_ref: AnalysisReportRef;
  readonly atomic_claim_documents: readonly L2ResearchDocumentCandidate[];
  readonly projector_version: string;
  readonly writer_candidate?: WriterProjectionCandidate;
}

export interface ProjectedReportCandidate {
  readonly report: AnalysisReportV2Payload;
  readonly receipt: ReportProjectionReceiptPayload;
}

const FORBIDDEN_REPORT_TERMS = ["因果", "导致", "应当", "建议采取", "自动执行"] as const;

function containsForbiddenClaim(text: string): boolean {
  return FORBIDDEN_REPORT_TERMS.some((term) => text.includes(term));
}

export function renderZhL2ResearchTitleV1(
  subject: ResearchBriefV2Payload["scope"]["subject"],
): string {
  return `关于“${subject}”的多步研究分析`;
}

const PROJECT_ANALYSIS_REPORT_REQUIRED_KEYS = [
  "brief_document",
  "manifest_document",
  "report_ref",
  "atomic_claim_documents",
  "projector_version",
] as const;

async function projectAnalysisReportCandidateUncached(
  input: ProjectAnalysisReportInput,
  requestContext?: ResearchRequestReplayContext,
): Promise<ResearchKernelResult<ProjectedReportCandidate>> {
  const budget = preflightResearchInput(input, {
    array_limits: [
      {
        path: ["atomic_claim_documents"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
    ],
  });
  if (!budget.ok) return budget;

  const expectedInputKeys =
    input.writer_candidate === undefined
      ? PROJECT_ANALYSIS_REPORT_REQUIRED_KEYS
      : [...PROJECT_ANALYSIS_REPORT_REQUIRED_KEYS, "writer_candidate"];
  if (!exactObjectKeys(input, expectedInputKeys) || !Array.isArray(input.atomic_claim_documents)) {
    return researchKernelFailure(
      "REPORT_PROJECTION_AUTHORITY_INVALID",
      "Report Projector 必须消费 exact Brief/Manifest/Claim Document closure。",
    );
  }
  const [brief, manifest, claims] = await Promise.all([
    resolveResearchDocumentCandidate(input.brief_document, "ResearchBrief", requestContext),
    resolveResearchDocumentCandidate(input.manifest_document, "ReportManifest", requestContext),
    resolveAtomicClaimDocuments(input.atomic_claim_documents, requestContext),
  ]);
  if (
    !brief.ok ||
    !manifest.ok ||
    !claims.ok ||
    brief.value.document.payload.artifact_type !== "ResearchBrief" ||
    manifest.value.document.payload.artifact_type !== "ReportManifest"
  ) {
    return researchKernelFailure(
      "REPORT_PROJECTION_AUTHORITY_INVALID",
      "Report Projector dependency 必须是 strict content-addressed Candidate Document。",
    );
  }
  const briefPayload = brief.value.document.payload;
  const manifestPayload = manifest.value.document.payload;
  if (
    !sameReferenceScope(brief.value.ref, manifest.value.ref) ||
    !sameReferenceScope(brief.value.ref, input.report_ref) ||
    claims.value.some(({ ref }) => !sameReferenceScope(brief.value.ref, ref)) ||
    artifactReferenceIdentity(manifestPayload.brief_ref) !==
      artifactReferenceIdentity(brief.value.ref)
  ) {
    return researchKernelFailure(
      "REPORT_PROJECTION_AUTHORITY_INVALID",
      "Projector 的 Brief/Manifest/Claim/Report Reference 必须精确同 Scope 且互相绑定。",
    );
  }
  const expectedManifestHash = await computeResearchKernelHash("u6-report-manifest@2", {
    brief_ref: manifestPayload.brief_ref,
    stop_decision_ref: manifestPayload.stop_decision_ref,
    sections: manifestPayload.sections,
    material_claim_refs: manifestPayload.material_claim_refs,
    required_disclosures: manifestPayload.required_disclosures,
    allowed_style_profile: manifestPayload.allowed_style_profile,
  });
  if (manifestPayload.manifest_hash !== expectedManifestHash) {
    return researchKernelFailure(
      "REPORT_PROJECTION_AUTHORITY_INVALID",
      "ReportManifest manifest_hash 必须由完整 payload 重算。",
    );
  }
  const statementByClaim = new Map(
    claims.value.map(({ ref, payload }) => [artifactReferenceIdentity(ref), payload.statement]),
  );
  const resolvedClaimByIdentity = new Map(
    claims.value.map((claim) => [artifactReferenceIdentity(claim.ref), claim]),
  );
  if (
    statementByClaim.size !== claims.value.length ||
    manifestPayload.material_claim_refs.some(
      (reference) => !statementByClaim.has(artifactReferenceIdentity(reference)),
    ) ||
    statementByClaim.size !== manifestPayload.material_claim_refs.length
  ) {
    return researchKernelFailure(
      "REPORT_MANIFEST_MATERIAL_CLAIM_INCOMPLETE",
      "投影必须精确闭合 Manifest 的 material Claim。",
    );
  }
  const title = renderZhL2ResearchTitleV1(briefPayload.scope.subject);
  const sections: AnalysisReportV2Payload["sections"] = manifestPayload.sections.map((section) => {
    let statement_units: string[];
    switch (section.section_id) {
      case "EXECUTIVE_SUMMARY":
      case "SUPPORTED_FINDINGS":
        statement_units = section.claim_refs.map(
          (reference) => statementByClaim.get(artifactReferenceIdentity(reference)) ?? "",
        );
        break;
      case "REFUTED_HYPOTHESES":
        statement_units =
          section.hypothesis_assessment_refs.length > 0
            ? ["冻结的区分性测试已经反证部分竞争解释。"]
            : [];
        break;
      case "CONFLICTS":
        statement_units =
          section.conflict_refs.length > 0 ? ["报告已披露尚未解决的证据冲突。"] : [];
        break;
      case "LIMITATIONS":
        statement_units = section.limitation_codes.map((code) => `限制：${code}`);
        break;
      case "METHOD":
        statement_units = ["本报告只使用 QUERY 与 DETERMINISTIC 证据，结论限于 L2 诊断边界。"];
        break;
    }
    return { section_id: section.section_id, statement_units };
  });
  const allText = [title, ...sections.flatMap(({ statement_units }) => statement_units)];
  if (allText.some(containsForbiddenClaim)) {
    return researchKernelFailure(
      "REPORT_PROJECTION_AUTHORITY_INVALID",
      "标题或正文包含禁止的因果、处方或行动性 Claim。",
    );
  }
  if (
    input.writer_candidate &&
    canonicalizeJson(input.writer_candidate) !== canonicalizeJson({ title, sections })
  ) {
    return researchKernelFailure(
      "REPORT_PROJECTION_AUTHORITY_INVALID",
      "Writer Candidate 与确定性 Projection 不一致。",
    );
  }
  const title_hash = await computeResearchKernelHash("u6-report-title@1", title);
  const rendered_statement_hashes = await Promise.all(
    sections
      .flatMap(({ statement_units }) => statement_units)
      .map((statement) => computeResearchKernelHash("u6-report-statement@1", statement)),
  );
  const projectionMaterial = {
    manifest_ref: manifest.value.ref as ReportManifestRef,
    title_template_id: "ZH_L2_RESEARCH_TITLE_V1" as const,
    title,
    title_hash,
    sections,
    disclosures: manifestPayload.required_disclosures,
  };
  const projection_hash = await computeResearchKernelHash(
    "u6-analysis-report-projection@1",
    projectionMaterial,
  );
  const reportCandidate = {
    artifact_type: "AnalysisReport",
    protocol_version: "analysis-report@2.0.0",
    ...projectionMaterial,
    projection_hash,
  } as const;
  const report = analysisReportV2PayloadSchema.safeParse(reportCandidate);
  if (!report.success) {
    return researchKernelFailure(
      "REPORT_PROJECTION_AUTHORITY_INVALID",
      report.error.issues[0]?.message ?? "AnalysisReport Candidate 无效。",
    );
  }
  const canonicalClaimClosure = manifestPayload.material_claim_refs.map((reference) =>
    resolvedClaimByIdentity.get(artifactReferenceIdentity(reference)),
  );
  if (canonicalClaimClosure.some((claim) => claim === undefined)) {
    return researchKernelFailure(
      "REPORT_MANIFEST_MATERIAL_CLAIM_INCOMPLETE",
      "投影缺少 Manifest material Claim 的规范顺序闭包。",
    );
  }
  const claim_closure_hash = await computeResearchKernelHash(
    "u6-material-claim-closure@1",
    canonicalClaimClosure as ResolvedReportArtifact<AtomicClaimRef, AtomicClaimV2Payload>[],
  );
  const receiptCandidate = {
    artifact_type: "ReportProjectionReceipt",
    protocol_version: "report-projection@1.0.0",
    manifest_ref: manifest.value.ref as ReportManifestRef,
    report_ref: input.report_ref,
    manifest_hash: manifestPayload.manifest_hash,
    claim_closure_hash,
    title_hash,
    rendered_statement_hashes,
    projection_hash,
    projector_version: input.projector_version,
    forbidden_claim_mode_scan: "PASS",
    reason_codes: [],
  } as const;
  const receipt = reportProjectionReceiptPayloadSchema.safeParse(receiptCandidate);
  if (!receipt.success) {
    return researchKernelFailure(
      "REPORT_PROJECTION_AUTHORITY_INVALID",
      receipt.error.issues[0]?.message ?? "ReportProjectionReceipt Candidate 无效。",
    );
  }
  return researchKernelSuccess({
    report: report.data,
    receipt: receipt.data,
  });
}

export function projectAnalysisReportCandidate(
  input: ProjectAnalysisReportInput,
): Promise<ResearchKernelResult<ProjectedReportCandidate>> {
  return projectAnalysisReportCandidateUncached(input);
}

export function projectAnalysisReportCandidateWithReplayContext(
  input: ProjectAnalysisReportInput,
  requestContext: ResearchRequestReplayContext,
): Promise<ResearchKernelResult<ProjectedReportCandidate>> {
  return memoizeSuccessfulResearchReplay(requestContext, "stage:report-projection", input, () =>
    projectAnalysisReportCandidateUncached(input, requestContext),
  );
}

export interface ReportManifestDocumentResolution {
  readonly document: L2ResearchDocumentCandidate;
  readonly derivation_input: BuildReportManifestInput;
}

export interface ResolvedReportManifestDocument {
  readonly ref: ReportManifestRef;
  readonly payload: ReportManifestV2Payload;
  readonly derivation_input: BuildReportManifestInput;
}

async function resolveReportManifestDocumentResolutionUncached(
  resolution: ReportManifestDocumentResolution,
  requestContext?: ResearchRequestReplayContext,
): Promise<ResearchKernelResult<ResolvedReportManifestDocument>> {
  const budget = preflightResearchInput(resolution, {
    array_limits: [
      {
        path: ["derivation_input", "executive_claim_documents"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
      {
        path: ["derivation_input", "supported_finding_claim_documents"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
      {
        path: ["derivation_input", "support_decision_documents"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
      {
        path: ["derivation_input", "refuted_hypothesis_assessment_documents"],
        max_items: U6_WIRE_LIMITS.max_hypotheses,
      },
      {
        path: ["derivation_input", "conflict_relation_documents"],
        max_items: U6_WIRE_LIMITS.max_obligations * 2,
      },
    ],
  });
  if (!budget.ok) return budget;

  if (!exactObjectKeys(resolution, ["document", "derivation_input"])) {
    return researchKernelFailure(
      "REPORT_PROJECTION_AUTHORITY_INVALID",
      "ReportManifest resolution 必须是 exact document + derivation_input。",
    );
  }
  const [document, derived] = await Promise.all([
    resolveResearchDocumentCandidate(resolution.document, "ReportManifest", requestContext),
    requestContext
      ? buildReportManifestCandidateWithReplayContext(resolution.derivation_input, requestContext)
      : buildReportManifestCandidateUncached(resolution.derivation_input),
  ]);
  if (
    !document.ok ||
    !derived.ok ||
    document.value.document.payload.artifact_type !== "ReportManifest" ||
    canonicalizeJson(document.value.document.payload) !== canonicalizeJson(derived.value)
  ) {
    return researchKernelFailure(
      "REPORT_PROJECTION_AUTHORITY_INVALID",
      "ReportManifest Document 必须与 production Manifest derivation 精确一致。",
    );
  }
  return researchKernelSuccess({
    ref: document.value.ref as ReportManifestRef,
    payload: document.value.document.payload,
    derivation_input: resolution.derivation_input,
  });
}

export function resolveReportManifestDocumentResolution(
  resolution: ReportManifestDocumentResolution,
  requestContext?: ResearchRequestReplayContext,
): Promise<ResearchKernelResult<ResolvedReportManifestDocument>> {
  return memoizeSuccessfulResearchReplay(
    requestContext,
    "resolution:report-manifest",
    resolution,
    () => resolveReportManifestDocumentResolutionUncached(resolution, requestContext),
  );
}

export interface ReportProjectionDocumentResolution {
  readonly report_document: L2ResearchDocumentCandidate;
  readonly receipt_document: L2ResearchDocumentCandidate;
  readonly derivation_input: ProjectAnalysisReportInput;
}

export interface ResolvedReportProjectionDocument {
  readonly report_ref: AnalysisReportRef;
  readonly report: AnalysisReportV2Payload;
  readonly receipt_ref: ReportProjectionReceiptRef;
  readonly receipt: ReportProjectionReceiptPayload;
  readonly derivation_input: ProjectAnalysisReportInput;
}

async function resolveReportProjectionDocumentResolutionUncached(
  resolution: ReportProjectionDocumentResolution,
  requestContext?: ResearchRequestReplayContext,
): Promise<ResearchKernelResult<ResolvedReportProjectionDocument>> {
  const budget = preflightResearchInput(resolution, {
    array_limits: [
      {
        path: ["derivation_input", "atomic_claim_documents"],
        max_items: U6_WIRE_LIMITS.max_obligations,
      },
    ],
  });
  if (!budget.ok) return budget;

  if (!exactObjectKeys(resolution, ["report_document", "receipt_document", "derivation_input"])) {
    return researchKernelFailure(
      "REPORT_PROJECTION_AUTHORITY_INVALID",
      "ReportProjection resolution 必须是 exact Report/Receipt Documents + derivation_input。",
    );
  }
  const [reportDocument, receiptDocument, derived] = await Promise.all([
    resolveResearchDocumentCandidate(resolution.report_document, "AnalysisReport", requestContext),
    resolveResearchDocumentCandidate(
      resolution.receipt_document,
      "ReportProjectionReceipt",
      requestContext,
    ),
    requestContext
      ? projectAnalysisReportCandidateWithReplayContext(resolution.derivation_input, requestContext)
      : projectAnalysisReportCandidateUncached(resolution.derivation_input),
  ]);
  if (
    !reportDocument.ok ||
    !receiptDocument.ok ||
    !derived.ok ||
    reportDocument.value.document.payload.artifact_type !== "AnalysisReport" ||
    receiptDocument.value.document.payload.artifact_type !== "ReportProjectionReceipt" ||
    artifactReferenceIdentity(reportDocument.value.ref) !==
      artifactReferenceIdentity(resolution.derivation_input.report_ref) ||
    canonicalizeJson(reportDocument.value.document.payload) !==
      canonicalizeJson(derived.value.report) ||
    canonicalizeJson(receiptDocument.value.document.payload) !==
      canonicalizeJson(derived.value.receipt)
  ) {
    return researchKernelFailure(
      "REPORT_PROJECTION_AUTHORITY_INVALID",
      "AnalysisReport/ProjectionReceipt Documents 必须与 deterministic Projector 精确一致。",
    );
  }
  return researchKernelSuccess({
    report_ref: reportDocument.value.ref as AnalysisReportRef,
    report: reportDocument.value.document.payload,
    receipt_ref: receiptDocument.value.ref as ReportProjectionReceiptRef,
    receipt: receiptDocument.value.document.payload,
    derivation_input: resolution.derivation_input,
  });
}

export function resolveReportProjectionDocumentResolution(
  resolution: ReportProjectionDocumentResolution,
  requestContext?: ResearchRequestReplayContext,
): Promise<ResearchKernelResult<ResolvedReportProjectionDocument>> {
  return memoizeSuccessfulResearchReplay(
    requestContext,
    "resolution:report-projection",
    resolution,
    () => resolveReportProjectionDocumentResolutionUncached(resolution, requestContext),
  );
}
