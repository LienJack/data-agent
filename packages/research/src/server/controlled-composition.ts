import {
  type ArtifactReference,
  type AtomicClaimRef,
  type AtomicClaimV2Payload,
  AUTHORITY_ROLE_POLICY_VERSION,
  artifactReferenceIdentity,
  artifactReferenceSchema,
  type ContentHash,
  collectL2ResearchPayloadArtifactReferences,
  computeL2ArtifactContentHash,
  computeL2ResearchEnvelopeContentHash,
  computePostgresqlExecutionSettingsHash,
  computeSandboxExecutionReceiptHash,
  computeSandboxResultBytes,
  computeSandboxResultHash,
  computeSqlArtifactQueryHash,
  contentHashSchema,
  deepFreeze,
  type EvidenceCheckReceiptPayload,
  type EvidencePlanRef,
  type EvidenceRelationRef,
  type EvidenceRelationV2Payload,
  embeddedNodeReferenceIdentity,
  type HypothesisAssessmentPayload,
  type HypothesisAssessmentRef,
  L2_RESEARCH_WIRE_VERSION_MATRIX,
  type L2ArtifactDocument,
  type L2ResearchDocumentCandidate,
  l2ArtifactDocumentSchema,
  type ProofObligationRef,
  parseL2ResearchDocumentCandidate,
  type QueryContractRef,
  type QueryEvidenceV2Payload,
  type ResearchBriefV2Payload,
  type ResearchBudgetLedgerBinding,
  type SandboxResult,
  type SuccessfulSandboxExecutionReceipt,
  type SupportDecisionPayload,
  type SupportDecisionRef,
  sandboxResultSchema,
  sha256ContentHash,
  successfulSandboxExecutionReceiptSchema,
  TEXT2SQL_VALIDATION_VERSION,
  type VersionFrontier,
} from "@data-agent/contracts";
import {
  type AtomicClaimDocumentResolution,
  type DeriveCoverageStateInput,
  type DeriveCoverageStateResolvedFactsInput,
  deriveCoverageStateCandidateWithReplayContext,
  type EvidenceCheckDocumentResolution,
  type EvidenceRelationDocumentResolution,
  type HypothesisAssessmentDocumentResolution,
  type ObligationExecutionDecisionDocumentResolution,
  type QueryEvidenceDocumentResolution,
  type ResolvedResearchArtifact,
  type SupportDecisionDocumentResolution,
} from "../coverage.js";
import {
  buildEvidenceCheckCandidateWithReplayContext,
  buildHypothesisAssessmentCandidateWithReplayContext,
  buildSupportDecisionCandidateWithReplayContext,
} from "../evidence/check-support-assessment.js";
import {
  buildAtomicClaimCandidateWithReplayContext,
  buildEvidenceRelationCandidateWithReplayContext,
} from "../evidence/claim-relation.js";
import {
  buildObligationExecutionDecisionCandidateWithReplayContext,
  buildQueryEvidenceCandidateWithReplayContext,
} from "../evidence/oed-query.js";
import {
  createProofDerivationReplayContext,
  type ProofDerivationReplayContext,
} from "../evidence/proof-replay.js";
import {
  ATOMIC_CLAIM_RENDERER_VERSION,
  type BuildAtomicClaimCandidateInput,
  type BuildEvidenceCheckCandidateInput,
  type BuildEvidenceRelationCandidateInput,
  type BuildHypothesisAssessmentCandidateInput,
  type BuildObligationExecutionDecisionCandidateInput,
  type BuildQueryEvidenceCandidateInput,
  type BuildSupportDecisionCandidateInput,
  type ClaimObservationSource,
  type ResolvedProofObligation,
} from "../evidence/shared.js";
import { stableCompare } from "../internal/reference-identity.js";
import {
  createResearchRequestReplayContext,
  ownResearchReplayValue,
  type ResearchReplayMetrics,
  type ResearchRequestReplayContext,
  snapshotResearchReplayMetrics,
} from "../internal/request-replay-context.js";
import { deriveContributionClosure, evaluateObservationPredicate } from "../observation.js";
import {
  compileEvidencePlanCandidate,
  compileHypothesisSetCandidate,
  compileResearchBriefCandidate,
} from "../planning.js";
import { derivePreStopReadinessFacts } from "../pre-stop-readiness.js";
import type {
  ProtocolHypothesisAssessment,
  ResearchProtocolEvaluation,
  ResearchProtocolInput,
  ResearchProtocolKernelOutcome,
} from "../protocol.js";
import { evaluateEvidenceGatesWithReplayContext } from "../readiness/evidence-gates.js";
import {
  createReportReadyCertificateCandidateWithReplayContext,
  verifyReportReadyCertificateCandidate,
} from "../readiness/report-ready-certificate.js";
import {
  buildReportManifestCandidateWithReplayContext,
  projectAnalysisReportCandidateWithReplayContext,
} from "../reporting.js";
import {
  deriveResearchStopDecisionCandidateWithReplayContext,
  type QueryCandidateFacts,
} from "../stop.js";
import {
  type ControlledResearchProtocolInput,
  isControlledResearchProtocolInput,
} from "./controlled-fixture.js";
import { issueTransientOedAssuranceForControlledKernel } from "./oed-assurance.js";

const CONTROLLED_SCOPE = {
  app_id: "00000000-0000-4000-8000-000000000001",
  tenant_id: "00000000-0000-4000-8000-000000000002",
  environment: "test",
} as const;
const CONTROLLED_RUN_ID = "00000000-0000-4000-8000-000000000003";
const CONTROLLED_DATASOURCE_ID = "00000000-0000-4000-8000-000000000060";
const CONTROLLED_CREATED_AT = "2026-07-27T00:00:00.000Z";
const CONTROLLED_EXECUTION_STARTED_AT = "2026-07-27T00:01:00.000Z";
const CONTROLLED_EXECUTION_COMPLETED_AT = "2026-07-27T00:01:00.010Z";
const CONTROLLED_EXECUTION_OBSERVED_AT = "2026-07-27T00:01:01.000Z";

type TypedReference<T extends ArtifactReference["artifact_type"]> = ArtifactReference & {
  readonly artifact_type: T;
};

interface ControlledResearchReplayContext {
  readonly request: ResearchRequestReplayContext;
  readonly proof: ProofDerivationReplayContext;
}

function createControlledResearchReplayContext(): ControlledResearchReplayContext {
  const request = createResearchRequestReplayContext();
  return {
    request,
    proof: createProofDerivationReplayContext(request),
  };
}

function ownControlledReplayValue<T>(replay: ControlledResearchReplayContext, value: T): T {
  return ownResearchReplayValue(replay.request, value);
}

const DEFAULT_CONTROLLED_HYPOTHESES: ResearchProtocolInput["hypotheses"] = [
  {
    hypothesis_id: "promotion-mix",
    metric_alias: "promotion_decline_share",
    support_predicate: { operator: "GTE", threshold: 0.6 },
    refute_predicate: { operator: "LTE", threshold: 0.3 },
  },
  {
    hypothesis_id: "late-refund",
    metric_alias: "late_refund_decline_share",
    support_predicate: { operator: "GTE", threshold: 0.4 },
    refute_predicate: { operator: "LTE", threshold: 0.2 },
  },
];

function controlledUuid(id: number): string {
  return `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`;
}

async function contentAddressedReference<const T extends ArtifactReference["artifact_type"]>(
  artifactType: T,
  artifactId: number,
  material: unknown,
): Promise<TypedReference<T>> {
  return artifactReferenceSchema.parse({
    ...CONTROLLED_SCOPE,
    run_id: CONTROLLED_RUN_ID,
    artifact_id: controlledUuid(artifactId),
    artifact_type: artifactType,
    revision: 1,
    content_hash: await sha256ContentHash({
      hash_domain: "u6-controlled-upstream-reference@1.0.0",
      artifact_type: artifactType,
      artifact_id: controlledUuid(artifactId),
      material,
    }),
  }) as TypedReference<T>;
}

function documentReference<const T extends ArtifactReference["artifact_type"]>(
  document: L2ArtifactDocument | L2ResearchDocumentCandidate,
  artifactType: T,
): TypedReference<T> {
  if (document.envelope.artifact_type !== artifactType) {
    throw new TypeError(
      `CONTROLLED_DOCUMENT_TYPE_MISMATCH:${artifactType}:${document.envelope.artifact_type}`,
    );
  }
  return artifactReferenceSchema.parse({
    artifact_id: document.envelope.artifact_id,
    artifact_type: artifactType,
    app_id: document.envelope.app_id,
    tenant_id: document.envelope.tenant_id,
    environment: document.envelope.environment,
    run_id: document.envelope.run_id,
    revision: document.envelope.revision,
    content_hash: document.envelope.content_hash,
  }) as TypedReference<T>;
}

function l2PayloadReferences(payload: L2ArtifactDocument["payload"]): readonly ArtifactReference[] {
  switch (payload.artifact_type) {
    case "QueryContract":
      return [payload.evidence_plan_ref];
    case "SqlArtifact":
      return [payload.logical_plan_ref];
    case "ExecutionReceipt":
      return [
        payload.sql_artifact_ref,
        payload.execution_permit_ref,
        payload.sandbox_execution_receipt_ref,
        payload.result_artifact_ref,
      ];
    case "ValidationReceipt":
      return [
        payload.sql_artifact_ref,
        payload.execution_receipt_ref,
        ...payload.gate_receipt_refs,
      ];
    default:
      throw new TypeError(`CONTROLLED_L2_DOCUMENT_TYPE_UNSUPPORTED:${payload.artifact_type}`);
  }
}

function candidateEnvelope(
  artifactType: ArtifactReference["artifact_type"],
  artifactId: number,
  inputRefs: readonly ArtifactReference[],
  schemaVersion: string,
  placeholderHash: `sha256:${string}`,
) {
  return {
    artifact_id: controlledUuid(artifactId),
    artifact_type: artifactType,
    ...CONTROLLED_SCOPE,
    run_id: CONTROLLED_RUN_ID,
    revision: 1,
    parent_ref: null,
    attempt_id: controlledUuid(900_000 + artifactId),
    producer: {
      kind: "deterministic" as const,
      id: "u6-controlled-production-chain",
    },
    input_refs: [...inputRefs],
    schema_version: schemaVersion,
    semantic_version: "1.0.0",
    policy_version: "1.0.0",
    model_profile_version: "1.0.0",
    content_hash: placeholderHash,
    status: "CANDIDATE" as const,
    created_at: CONTROLLED_CREATED_AT,
  };
}

async function sealL2Document(
  payload: L2ArtifactDocument["payload"],
  artifactId: number,
): Promise<L2ArtifactDocument> {
  const placeholderHash = await sha256ContentHash({
    hash_domain: "u6-controlled-l2-envelope-placeholder@1.0.0",
    artifact_type: payload.artifact_type,
    artifact_id: controlledUuid(artifactId),
  });
  const draft = l2ArtifactDocumentSchema.parse({
    envelope: candidateEnvelope(
      payload.artifact_type,
      artifactId,
      l2PayloadReferences(payload),
      "1.0.0",
      placeholderHash,
    ),
    payload,
  });
  const contentHash = await computeL2ArtifactContentHash(draft);
  return l2ArtifactDocumentSchema.parse({
    ...draft,
    envelope: {
      ...draft.envelope,
      content_hash: contentHash,
    },
  });
}

function researchSchemaVersion(
  payload: L2ResearchDocumentCandidate["payload"],
): (typeof L2_RESEARCH_WIRE_VERSION_MATRIX)[number][1] {
  const tuple = L2_RESEARCH_WIRE_VERSION_MATRIX.find(
    ([artifactType, , protocolVersion]) =>
      artifactType === payload.artifact_type && protocolVersion === payload.protocol_version,
  );
  const schemaVersion = tuple?.[1];
  if (schemaVersion === undefined) {
    throw new TypeError(
      `CONTROLLED_RESEARCH_WIRE_TUPLE_UNREGISTERED:${payload.artifact_type}:${payload.protocol_version}`,
    );
  }
  return schemaVersion;
}

async function sealResearchDocument(
  payload: L2ResearchDocumentCandidate["payload"],
  artifactId: number,
): Promise<L2ResearchDocumentCandidate> {
  const placeholderHash = await sha256ContentHash({
    hash_domain: "u6-controlled-research-envelope-placeholder@1.0.0",
    artifact_type: payload.artifact_type,
    artifact_id: controlledUuid(artifactId),
  });
  const draft = parseL2ResearchDocumentCandidate({
    envelope: candidateEnvelope(
      payload.artifact_type,
      artifactId,
      collectL2ResearchPayloadArtifactReferences(payload),
      researchSchemaVersion(payload),
      placeholderHash,
    ),
    payload,
  });
  const contentHash = await computeL2ResearchEnvelopeContentHash(draft);
  return parseL2ResearchDocumentCandidate({
    ...draft,
    envelope: {
      ...draft.envelope,
      content_hash: contentHash,
    },
  });
}

function researchResolution<
  const T extends L2ResearchDocumentCandidate["payload"]["artifact_type"],
>(
  document: L2ResearchDocumentCandidate,
  artifactType: T,
): {
  readonly ref: TypedReference<T>;
  readonly payload: Extract<L2ResearchDocumentCandidate["payload"], { readonly artifact_type: T }>;
} {
  if (document.payload.artifact_type !== artifactType) {
    throw new TypeError(`CONTROLLED_RESEARCH_RESOLUTION_TYPE_MISMATCH:${artifactType}`);
  }
  return {
    ref: documentReference(document, artifactType),
    payload: document.payload as Extract<
      L2ResearchDocumentCandidate["payload"],
      { readonly artifact_type: T }
    >,
  };
}

function mustKernelResult<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | {
        readonly ok: false;
        readonly error: { readonly code: string; readonly message: string };
      },
): T {
  if (!result.ok) {
    throw new TypeError(`${result.error.code}:${result.error.message}`);
  }
  return result.value;
}

interface ControlledPlanningClosure {
  readonly brief_document: L2ResearchDocumentCandidate;
  readonly brief_ref: TypedReference<"ResearchBrief">;
  readonly hypothesis_set_document: L2ResearchDocumentCandidate;
  readonly hypothesis_set_ref: TypedReference<"HypothesisSet">;
  readonly evidence_plan_document: L2ResearchDocumentCandidate;
  readonly evidence_plan_ref: TypedReference<"EvidencePlan">;
  readonly semantic_release_ref: TypedReference<"SemanticRelease">;
  readonly schema_snapshot_ref: TypedReference<"SchemaSnapshot">;
  readonly policy_receipt_ref: TypedReference<"PolicyReceipt">;
}

type SourcePolicy = Pick<
  ResearchProtocolInput["evidence_facts"],
  "source_independence_mode" | "minimum_provenance_groups"
>;

async function compileControlledPlanningClosure(
  sourcePolicy: SourcePolicy,
  hypotheses: ResearchProtocolInput["hypotheses"],
): Promise<ControlledPlanningClosure> {
  const [
    questionFrameRef,
    semanticReleaseRef,
    schemaSnapshotRef,
    policyReceiptRef,
    policyDigest,
    retentionPolicyHash,
  ] = await Promise.all([
    contentAddressedReference("QuestionFrame", 1, {
      question:
        "2025 年第一季度华南区净收入同比为什么下降？哪些竞争解释得到数据支持，哪些仍不能确认？",
    }),
    contentAddressedReference("SemanticRelease", 2, {
      metrics: ["promotion_decline_share", "late_refund_decline_share"],
      release: "controlled-retail-metrics@1.0.0",
    }),
    contentAddressedReference("SchemaSnapshot", 3, {
      datasource_id: CONTROLLED_DATASOURCE_ID,
      schema_revision: 1,
    }),
    contentAddressedReference("PolicyReceipt", 4, {
      principal_id: "controlled-fixture",
      policy_version: "controlled-policy@1.0.0",
    }),
    sha256ContentHash({
      hash_domain: "u6-controlled-policy-digest@1.0.0",
      policy_version: "controlled-policy@1.0.0",
    }),
    sha256ContentHash({
      hash_domain: "u6-controlled-retention-policy@1.0.0",
      retention_policy: "controlled-research-retention@1.0.0",
    }),
  ]);
  const briefPayload = mustKernelResult(
    await compileResearchBriefCandidate({
      question_frame_ref: questionFrameRef,
      scope: {
        subject: "分析净收入下降的竞争解释",
        time_window: {
          start: "2025-01-01T00:00:00.000Z",
          end: "2025-04-01T00:00:00.000Z",
          timezone: "Asia/Shanghai",
          semantics: "HALF_OPEN",
        },
        dimensions: [],
        metric_refs: [
          {
            container_ref: semanticReleaseRef,
            node_id: "promotion_decline_share",
          },
          {
            container_ref: semanticReleaseRef,
            node_id: "late_refund_decline_share",
          },
        ],
      },
      success_criteria: [
        {
          criterion_id: "explain-promotion-contribution",
          statement: "判断促销结构是否解释了主要下降份额",
          materiality: "CRITICAL",
        },
        {
          criterion_id: "test-late-refund-alternative",
          statement: "判断延迟退款是否构成主要竞争解释",
          materiality: "CRITICAL",
        },
      ],
      evidence_policy: {
        allowed_kinds: ["QUERY"],
        minimum_support_mode: "DETERMINISTIC",
        unsupported_source_behavior: "REJECT",
      },
      hypothesis_universe_policy: {
        candidate_sources: ["METRIC_DECOMPOSITION"],
        enumerator_version: "controlled-hypothesis-enumerator@1.0.0",
        required_disclosure: "BOUNDED_HYPOTHESIS_UNIVERSE",
      },
      freshness_policy: {
        max_age_seconds: 3600,
        require_snapshot_replayable: true,
      },
      source_independence_policy: {
        mode: sourcePolicy.source_independence_mode,
        minimum_provenance_groups: sourcePolicy.minimum_provenance_groups,
        required_disclosures:
          sourcePolicy.source_independence_mode === "ONE_AUTHORITATIVE_SOURCE_WITH_DISCLOSURE"
            ? ["SINGLE_AUTHORITY_SOURCE"]
            : [],
      },
      claim_policy: {
        allowed_modes: ["DESCRIPTIVE", "COMPARATIVE", "DIAGNOSTIC"],
        forbidden_modes: ["CAUSAL", "PRESCRIPTIVE", "ACTION_EXECUTING"],
      },
      budget: {
        max_steps: 24,
        max_model_calls: 32,
        max_sql_executions: 16,
        max_source_calls: 0,
        max_elapsed_ms: 600_000,
        max_provider_input_tokens_per_call: 32_000,
        max_provider_output_tokens_per_call: 8_000,
        max_provider_tokens_per_run: 256_000,
        max_provider_cost_microusd_per_run: 5_000_000,
      },
      policy_ref: policyReceiptRef,
      policy_digest: policyDigest,
      data_classification: "INTERNAL",
      retention_policy_ref: {
        policy_id: "controlled-research-retention",
        policy_version: "1.0.0",
        policy_hash: retentionPolicyHash,
      },
    }),
  );
  const briefDocument = await sealResearchDocument(briefPayload, 10);
  const briefRef = documentReference(briefDocument, "ResearchBrief");
  const hypothesisPayload = mustKernelResult(
    await compileHypothesisSetCandidate({
      brief_ref: briefRef,
      hypotheses: hypotheses.map((hypothesis, index) => ({
        hypothesis_id: hypothesis.hypothesis_id,
        mechanism_class: index === 0 ? "promotion-mix-shift" : "late-refund-timing",
        statement:
          index === 0
            ? "促销结构变化解释了净收入下降的主要份额。"
            : "延迟退款解释了净收入下降的主要份额。",
        predictions: [
          index === 0
            ? "promotion_decline_share 达到主要解释阈值"
            : "late_refund_decline_share 达到主要解释阈值",
        ],
        falsifiers: [
          index === 0
            ? "promotion_decline_share 进入反证区间"
            : "late_refund_decline_share 进入反证区间",
        ],
        discriminating_test_ids: [index === 0 ? "promotion-share-test" : "late-refund-share-test"],
        materiality: "MATERIAL",
      })),
      mechanism_validator_version: "controlled-mechanism-validator@1.0.0",
    }),
  );
  const hypothesisSetDocument = await sealResearchDocument(hypothesisPayload, 11);
  const hypothesisSetRef = documentReference(hypothesisSetDocument, "HypothesisSet");
  const promotionHypothesis = hypotheses[0];
  const refundHypothesis = hypotheses[1];
  if (!promotionHypothesis || !refundHypothesis) {
    throw new TypeError("CONTROLLED_HYPOTHESIS_UNIVERSE_INCOMPLETE");
  }
  const evidencePlanPayload = mustKernelResult(
    await compileEvidencePlanCandidate({
      brief_document: briefDocument,
      hypothesis_set_document: hypothesisSetDocument,
      obligations: [
        {
          obligation_id: "promotion-obligation",
          hypothesis_refs: [
            {
              container_ref: hypothesisSetRef,
              node_id: promotionHypothesis.hypothesis_id,
            },
          ],
          success_criterion_refs: [
            {
              container_ref: briefRef,
              node_id: "explain-promotion-contribution",
            },
          ],
          discriminating_test_ids: ["promotion-share-test"],
          materiality: "CRITICAL",
          evidence_kind: "QUERY",
          depends_on: [],
          observation_contract: {
            metric_ref: {
              container_ref: semanticReleaseRef,
              node_id: "promotion_decline_share",
            },
            aggregation: "RATIO",
            unit: "ratio",
            support_predicate: promotionHypothesis.support_predicate,
            refute_predicate: promotionHypothesis.refute_predicate,
            null_behavior: "FAIL",
          },
          failure_behavior: "BLOCK_READY",
        },
        {
          obligation_id: "refund-obligation",
          hypothesis_refs: [
            {
              container_ref: hypothesisSetRef,
              node_id: refundHypothesis.hypothesis_id,
            },
          ],
          success_criterion_refs: [
            {
              container_ref: briefRef,
              node_id: "test-late-refund-alternative",
            },
          ],
          discriminating_test_ids: ["late-refund-share-test"],
          materiality: "CRITICAL",
          evidence_kind: "QUERY",
          depends_on: [{ node_id: "promotion-obligation" }],
          observation_contract: {
            metric_ref: {
              container_ref: semanticReleaseRef,
              node_id: "late_refund_decline_share",
            },
            aggregation: "RATIO",
            unit: "ratio",
            support_predicate: refundHypothesis.support_predicate,
            refute_predicate: refundHypothesis.refute_predicate,
            null_behavior: "FAIL",
          },
          failure_behavior: "BLOCK_READY",
        },
      ],
      planner_version: "controlled-evidence-planner@1.0.0",
    }),
  );
  const evidencePlanDocument = await sealResearchDocument(evidencePlanPayload, 12);
  return {
    brief_document: briefDocument,
    brief_ref: briefRef,
    hypothesis_set_document: hypothesisSetDocument,
    hypothesis_set_ref: hypothesisSetRef,
    evidence_plan_document: evidencePlanDocument,
    evidence_plan_ref: documentReference(evidencePlanDocument, "EvidencePlan"),
    semantic_release_ref: semanticReleaseRef,
    schema_snapshot_ref: schemaSnapshotRef,
    policy_receipt_ref: policyReceiptRef,
  };
}

export async function controlledResearchBriefPayload(
  sourcePolicy: SourcePolicy = {
    source_independence_mode: "ONE_AUTHORITATIVE_SOURCE_WITH_DISCLOSURE",
    minimum_provenance_groups: 1,
  },
): Promise<ResearchBriefV2Payload> {
  const planning = await compileControlledPlanningClosure(
    sourcePolicy,
    DEFAULT_CONTROLLED_HYPOTHESES,
  );
  if (planning.brief_document.payload.artifact_type !== "ResearchBrief") {
    throw new TypeError("CONTROLLED_RESEARCH_BRIEF_TYPE_DRIFT");
  }
  return planning.brief_document.payload;
}

async function versionFrontier(
  planning: ControlledPlanningClosure,
  snapshotToken: string,
  schemaSnapshotRef: TypedReference<"SchemaSnapshot"> = planning.schema_snapshot_ref,
): Promise<VersionFrontier> {
  const [
    schemaManifestHash,
    dataManifestHash,
    fixtureManifestHash,
    bindingHash,
    delegationChainHash,
  ] = await Promise.all([
    sha256ContentHash({
      hash_domain: "u6-controlled-schema-manifest@1.0.0",
      schema_snapshot_ref: schemaSnapshotRef,
    }),
    sha256ContentHash({
      hash_domain: "u6-controlled-data-manifest@1.0.0",
      datasource_id: CONTROLLED_DATASOURCE_ID,
      snapshot_token: snapshotToken,
    }),
    sha256ContentHash({
      hash_domain: "u6-controlled-fixture-manifest@1.0.0",
      fixture_id: "retail-revenue-investigation-v1",
    }),
    sha256ContentHash({
      hash_domain: "u6-controlled-data-snapshot-binding@1.0.0",
      datasource_id: CONTROLLED_DATASOURCE_ID,
      snapshot_token: snapshotToken,
      schema_snapshot_ref: schemaSnapshotRef,
    }),
    sha256ContentHash({
      hash_domain: "u6-controlled-delegation-chain@1.0.0",
      principal_id: "controlled-fixture",
    }),
  ]);
  return {
    semantic_release_ref: planning.semantic_release_ref,
    schema_snapshot_ref: schemaSnapshotRef,
    data_snapshot: {
      protocol_version: "data-snapshot-binding@1.0.0",
      datasource_id: CONTROLLED_DATASOURCE_ID,
      strategy: "CONTROLLED_REVISION",
      snapshot_token: snapshotToken,
      schema_manifest_hash: schemaManifestHash,
      data_manifest_hash: dataManifestHash,
      fixture_manifest_hash: fixtureManifestHash,
      replay_state: "REPLAYABLE",
      binding_hash: bindingHash,
    },
    policy_receipt_ref: planning.policy_receipt_ref,
    identity_binding: {
      principal_id: "controlled-fixture",
      delegation_chain_hash: delegationChainHash,
      authority_epoch: 1,
    },
  };
}

interface PreparedQuery {
  readonly obligation: ResolvedProofObligation;
  readonly obligation_ref: ProofObligationRef;
  readonly query_contract_document: L2ArtifactDocument;
  readonly query_contract_ref: TypedReference<"QueryContract">;
  readonly sql_artifact_document: L2ArtifactDocument;
  readonly sql_artifact_ref: TypedReference<"SqlArtifact">;
  readonly oed_derivation_input: BuildObligationExecutionDecisionCandidateInput;
  readonly oed_document: L2ResearchDocumentCandidate;
  readonly oed_resolution: ObligationExecutionDecisionDocumentResolution;
  readonly oed_ref: TypedReference<"ObligationExecutionDecision">;
  readonly oed_verdict: "PASS" | "FAIL";
  readonly metric: string;
  readonly unit: string;
  readonly value: number;
  readonly seed: number;
}

async function prepareQuery(input: {
  readonly planning: ControlledPlanningClosure;
  readonly obligation_id: string;
  readonly metric: string;
  readonly unit: string;
  readonly value: number;
  readonly seed: number;
  readonly wrong_filter: boolean;
  readonly replay: ControlledResearchReplayContext;
}): Promise<PreparedQuery> {
  const plan = input.planning.evidence_plan_document.payload;
  if (plan.artifact_type !== "EvidencePlan") {
    throw new TypeError("CONTROLLED_EVIDENCE_PLAN_TYPE_DRIFT");
  }
  const obligationPayload = plan.obligations.find(
    ({ obligation_id }) => obligation_id === input.obligation_id,
  );
  if (!obligationPayload) {
    throw new TypeError(`CONTROLLED_OBLIGATION_NOT_FOUND:${input.obligation_id}`);
  }
  const obligationRef: ProofObligationRef = {
    container_ref: input.planning.evidence_plan_ref,
    node_id: input.obligation_id,
  };
  const queryContractDocument = await sealL2Document(
    {
      artifact_type: "QueryContract",
      evidence_plan_ref: input.planning.evidence_plan_ref,
      metric: input.metric,
      dimensions: [],
      grain: "scalar",
      time_range: {
        start: "2025-01-01T00:00:00.000Z",
        end: "2025-04-01T00:00:00.000Z",
        timezone: "Asia/Shanghai",
        semantics: "HALF_OPEN",
      },
      unit: input.unit,
      filters: input.wrong_filter
        ? [
            {
              field: "orders.region",
              operator: "eq",
              value: "wrong-region-filter",
            },
          ]
        : [],
      datasource_id: CONTROLLED_DATASOURCE_ID,
      result_contract: {
        columns: [input.metric],
        invariant_ids: ["single-row-numeric"],
      },
    },
    input.seed + 1,
  );
  const queryContractRef = documentReference(queryContractDocument, "QueryContract");
  const logicalPlanRef = await contentAddressedReference("LogicalPlan", input.seed + 2, {
    query_contract_ref: queryContractRef,
    metric: input.metric,
    filters: queryContractDocument.payload,
  });
  const sqlMaterial = {
    dialect: "postgresql" as const,
    sql: input.wrong_filter
      ? `select value::numeric as ${input.metric} from (values ('wrong-region-filter', ${input.value})) as controlled(region, value) where region = 'wrong-region-filter'`
      : `select ${input.value}::numeric as ${input.metric}`,
    parameters: {},
  };
  const queryHash = await computeSqlArtifactQueryHash(sqlMaterial);
  const sqlArtifactDocument = await sealL2Document(
    {
      artifact_type: "SqlArtifact",
      logical_plan_ref: logicalPlanRef,
      compiler_version: "controlled-sql-compiler@1.0.0",
      ast_hash: await sha256ContentHash({
        hash_domain: "u6-controlled-sql-ast@1.0.0",
        sql: sqlMaterial.sql,
      }),
      ...sqlMaterial,
      query_hash: queryHash,
    },
    input.seed + 3,
  );
  const sqlArtifactRef = documentReference(sqlArtifactDocument, "SqlArtifact");
  const obligation: ResolvedProofObligation = {
    evidence_plan_document: input.planning.evidence_plan_document,
    obligation_id: input.obligation_id,
  };
  const metricMatches = obligationPayload.observation_contract.metric_ref.node_id === input.metric;
  const assurance = issueTransientOedAssuranceForControlledKernel({
    binding: {
      brief_ref: input.planning.brief_ref,
      evidence_plan_ref: input.planning.evidence_plan_ref,
      query_contract_ref: queryContractRef,
      sql_artifact_ref: sqlArtifactRef,
      semantic_release_ref: input.planning.semantic_release_ref,
      policy_receipt_ref: input.planning.policy_receipt_ref,
    },
    verifier_result: {
      profile: "CONTROLLED_EXACT",
      compiler_verifier_version: "controlled-sql-compiler-verifier@1.0.0",
      compiler_evidence_hash: queryHash,
      policy_verifier_version: "controlled-policy-verifier@1.0.0",
      policy_evidence_hash: contentHashSchema.parse(
        input.planning.policy_receipt_ref.content_hash,
      ) as ContentHash,
      semantic_checks: {
        metric: metricMatches,
        metric_formula: metricMatches,
        time_window: true,
        timezone: true,
        grain: true,
        dimensions: true,
        grouping: true,
        joins: true,
        canonical_predicates: !input.wrong_filter,
        cohort: !input.wrong_filter,
        null_semantics: true,
        authorization_scope: true,
      },
    },
  });
  const oedDerivationInput = ownControlledReplayValue(input.replay, {
    brief_document: input.planning.brief_document,
    obligation,
    query_contract_document: queryContractDocument,
    sql_artifact_document: sqlArtifactDocument,
    semantic_release_ref: input.planning.semantic_release_ref,
    policy_receipt_ref: input.planning.policy_receipt_ref,
    evaluator_version: "controlled-obligation-evaluator@1.0.0",
    assurance,
  } satisfies BuildObligationExecutionDecisionCandidateInput);
  const oedPayload = mustKernelResult(
    await buildObligationExecutionDecisionCandidateWithReplayContext(
      oedDerivationInput,
      input.replay.proof,
    ),
  );
  const oedDocument = await sealResearchDocument(oedPayload, input.seed + 4);
  const oedResolution = ownControlledReplayValue(input.replay, {
    document: oedDocument,
    derivation_input: oedDerivationInput,
  } satisfies ObligationExecutionDecisionDocumentResolution);
  return {
    obligation,
    obligation_ref: obligationRef,
    query_contract_document: queryContractDocument,
    query_contract_ref: queryContractRef,
    sql_artifact_document: sqlArtifactDocument,
    sql_artifact_ref: sqlArtifactRef,
    oed_derivation_input: oedDerivationInput,
    oed_document: oedDocument,
    oed_resolution: oedResolution,
    oed_ref: documentReference(oedDocument, "ObligationExecutionDecision"),
    oed_verdict: oedPayload.verdict,
    metric: input.metric,
    unit: input.unit,
    value: input.value,
    seed: input.seed,
  };
}

async function createSandboxResult(input: {
  readonly prepared: PreparedQuery;
  readonly execution_id: string;
}): Promise<SandboxResult> {
  const columns = [{ name: input.prepared.metric, type: "NUMBER" }] as const;
  const rows = [[input.prepared.value]];
  const resultReference = await contentAddressedReference(
    "SandboxResult",
    input.prepared.seed + 7,
    {
      execution_id: input.execution_id,
      columns,
      rows,
    },
  );
  const draft = sandboxResultSchema.parse({
    schema_version: "controlled-schema@1.0.0",
    result_ref: resultReference,
    scope: CONTROLLED_SCOPE,
    run_id: CONTROLLED_RUN_ID,
    execution_id: input.execution_id,
    columns,
    rows,
    row_count: rows.length,
    bytes: computeSandboxResultBytes({ columns, rows }),
    result_hash: resultReference.content_hash,
  });
  const resultHash = await computeSandboxResultHash(draft);
  return sandboxResultSchema.parse({
    ...draft,
    result_ref: {
      ...draft.result_ref,
      content_hash: resultHash,
    },
    result_hash: resultHash,
  });
}

async function createSandboxReceipt(input: {
  readonly prepared: PreparedQuery;
  readonly execution_id: string;
  readonly result: SandboxResult;
  readonly execution_permit_ref: TypedReference<"ExecutionPermit">;
  readonly resource_admission_ref: TypedReference<"ResourceAdmissionReceipt">;
  readonly snapshot_token: string;
}): Promise<SuccessfulSandboxExecutionReceipt> {
  const executionSettings = {
    database_role: "research-reader",
    search_path: ["analytics"],
    plan_cache_mode: "force_custom_plan" as const,
    statement_timeout_ms: 1000,
    lock_timeout_ms: 100,
  };
  const receiptReference = await contentAddressedReference(
    "SandboxExecutionReceipt",
    input.prepared.seed + 8,
    {
      execution_id: input.execution_id,
      sql_artifact_ref: input.prepared.sql_artifact_ref,
      result_artifact_ref: input.result.result_ref,
    },
  );
  const draft = successfulSandboxExecutionReceiptSchema.parse({
    schema_version: "controlled-schema@1.0.0",
    language: "sql",
    executor: {
      authority_id: controlledUuid(800_001),
      principal_id: "controlled-sandbox-principal",
      key_id: "controlled-sandbox-key@1.0.0",
    },
    executor_role: "SANDBOX_EXECUTION",
    authority_role_policy_version: AUTHORITY_ROLE_POLICY_VERSION,
    receipt_id: receiptReference.artifact_id,
    receipt_ref: receiptReference,
    scope: CONTROLLED_SCOPE,
    run_id: CONTROLLED_RUN_ID,
    execution_id: input.execution_id,
    idempotency_key: `controlled-query-${input.prepared.seed}`,
    input_hash: await sha256ContentHash({
      hash_domain: "u6-controlled-sandbox-input@1.0.0",
      sql_artifact_ref: input.prepared.sql_artifact_ref,
      execution_permit_ref: input.execution_permit_ref,
      snapshot_token: input.snapshot_token,
    }),
    execution_hash: receiptReference.content_hash,
    terminal: "COMPLETED",
    reason_code: "EXECUTION_COMPLETED",
    started_at: CONTROLLED_EXECUTION_STARTED_AT,
    completed_at: CONTROLLED_EXECUTION_COMPLETED_AT,
    result_artifact_ref: input.result.result_ref,
    sql_artifact_ref: input.prepared.sql_artifact_ref,
    execution_permit_ref: input.execution_permit_ref,
    resource_admission_ref: input.resource_admission_ref,
    datasource_id: CONTROLLED_DATASOURCE_ID,
    settings_hash: await computePostgresqlExecutionSettingsHash(executionSettings),
    execution_settings: executionSettings,
    transaction: {
      transaction_id: input.execution_id,
      read_only: true,
      isolation_level: "REPEATABLE_READ",
    },
    authority_revalidation: {
      effective_principal_id: "controlled-sandbox-principal",
      policy_receipt_ref:
        input.prepared.oed_document.payload.artifact_type === "ObligationExecutionDecision"
          ? input.prepared.oed_document.payload.policy_receipt_ref
          : (() => {
              throw new TypeError("CONTROLLED_OED_TYPE_DRIFT");
            })(),
      revalidated_at: CONTROLLED_EXECUTION_STARTED_AT,
      authority_epoch: 1,
    },
    snapshot_token: input.snapshot_token,
    watermark: null,
    replay_state: "REPLAYABLE",
    resource_usage: {
      elapsed_ms: 10,
      rows: input.result.row_count,
      bytes: input.result.bytes,
      peak_memory_mb: 1,
    },
  });
  const executionHash = await computeSandboxExecutionReceiptHash(draft);
  return successfulSandboxExecutionReceiptSchema.parse({
    ...draft,
    receipt_ref: {
      ...draft.receipt_ref,
      content_hash: executionHash,
    },
    execution_hash: executionHash,
  });
}

interface SuccessfulQueryEvidence {
  readonly prepared: PreparedQuery;
  readonly derivation_input: BuildQueryEvidenceCandidateInput;
  readonly document: L2ResearchDocumentCandidate;
  readonly resolution: QueryEvidenceDocumentResolution;
  readonly ref: TypedReference<"QueryEvidence">;
  readonly payload: QueryEvidenceV2Payload;
  readonly query_contract_document: L2ArtifactDocument;
  readonly sandbox_result: SandboxResult;
  readonly claim_source: ClaimObservationSource;
}

async function executePreparedQuery(input: {
  readonly prepared: PreparedQuery;
  readonly observed_version: VersionFrontier;
  readonly dependency_evidence_documents: readonly L2ResearchDocumentCandidate[];
  readonly replay: ControlledResearchReplayContext;
}): Promise<SuccessfulQueryEvidence> {
  if (input.prepared.oed_verdict !== "PASS") {
    throw new TypeError("CONTROLLED_QUERY_EVIDENCE_REQUIRES_OED_PASS");
  }
  const executionId = controlledUuid(input.prepared.seed + 6);
  const [executionPermitRef, resourceAdmissionRef] = await Promise.all([
    contentAddressedReference("ExecutionPermit", input.prepared.seed + 5, {
      sql_artifact_ref: input.prepared.sql_artifact_ref,
      policy_receipt_ref: input.observed_version.policy_receipt_ref,
    }),
    contentAddressedReference("ResourceAdmissionReceipt", input.prepared.seed + 9, {
      datasource_id: CONTROLLED_DATASOURCE_ID,
      query_contract_ref: input.prepared.query_contract_ref,
    }),
  ]);
  const sandboxResult = await createSandboxResult({
    prepared: input.prepared,
    execution_id: executionId,
  });
  const snapshotToken = input.observed_version.data_snapshot.snapshot_token;
  if (snapshotToken === null) {
    throw new TypeError("CONTROLLED_QUERY_REQUIRES_REPLAYABLE_SNAPSHOT");
  }
  const sandboxReceipt = await createSandboxReceipt({
    prepared: input.prepared,
    execution_id: executionId,
    result: sandboxResult,
    execution_permit_ref: executionPermitRef,
    resource_admission_ref: resourceAdmissionRef,
    snapshot_token: snapshotToken,
  });
  const executionReceiptDocument = await sealL2Document(
    {
      artifact_type: "ExecutionReceipt",
      sql_artifact_ref: input.prepared.sql_artifact_ref,
      execution_permit_ref: executionPermitRef,
      sandbox_execution_receipt_ref: sandboxReceipt.receipt_ref,
      result_artifact_ref: sandboxResult.result_ref,
      datasource_id: CONTROLLED_DATASOURCE_ID,
      schema_version: sandboxResult.schema_version,
      snapshot_token: snapshotToken,
      watermark: null,
      observed_at: CONTROLLED_EXECUTION_OBSERVED_AT,
      query_hash:
        input.prepared.sql_artifact_document.payload.artifact_type === "SqlArtifact"
          ? input.prepared.sql_artifact_document.payload.query_hash
          : (() => {
              throw new TypeError("CONTROLLED_SQL_TYPE_DRIFT");
            })(),
      result_hash: sandboxResult.result_hash,
      replay_state: "REPLAYABLE",
      row_count: sandboxResult.row_count,
    },
    input.prepared.seed + 10,
  );
  const executionReceiptRef = documentReference(executionReceiptDocument, "ExecutionReceipt");
  const gateReceiptRefs = await Promise.all(
    Array.from({ length: 7 }, (_, index) =>
      contentAddressedReference("GateReceipt", input.prepared.seed + 20 + index, {
        gate_index: index,
        sql_artifact_ref: input.prepared.sql_artifact_ref,
        execution_receipt_ref: executionReceiptRef,
      }),
    ),
  );
  const validationReceiptDocument = await sealL2Document(
    {
      artifact_type: "ValidationReceipt",
      sql_artifact_ref: input.prepared.sql_artifact_ref,
      execution_receipt_ref: executionReceiptRef,
      gate_receipt_refs: gateReceiptRefs,
      validation_version: TEXT2SQL_VALIDATION_VERSION,
      sealed_at: "2026-07-27T00:01:02.000Z",
    },
    input.prepared.seed + 11,
  );
  const derivationInput = ownControlledReplayValue(input.replay, {
    obligation: input.prepared.obligation,
    obligation_execution_decision_resolution: input.prepared.oed_resolution,
    l2: {
      query_contract_document: input.prepared.query_contract_document,
      sql_artifact_document: input.prepared.sql_artifact_document,
      validation_receipt_document: validationReceiptDocument,
      execution_receipt_document: executionReceiptDocument,
    },
    sandbox: {
      sandbox_execution_receipt: sandboxReceipt,
      sandbox_result: sandboxResult,
    },
    dependency_evidence_documents: input.dependency_evidence_documents,
    observed_version: input.observed_version,
  } satisfies BuildQueryEvidenceCandidateInput);
  const payload = mustKernelResult(
    await buildQueryEvidenceCandidateWithReplayContext(derivationInput, input.replay.proof),
  );
  const document = await sealResearchDocument(payload, input.prepared.seed + 12);
  const resolution = ownControlledReplayValue(input.replay, {
    document,
    derivation_input: derivationInput,
  } satisfies QueryEvidenceDocumentResolution);
  const ref = documentReference(document, "QueryEvidence");
  return {
    prepared: input.prepared,
    derivation_input: derivationInput,
    document,
    resolution,
    ref,
    payload,
    query_contract_document: input.prepared.query_contract_document,
    sandbox_result: sandboxResult,
    claim_source: {
      query_evidence_document: document,
      query_contract_document: input.prepared.query_contract_document,
      obligation: input.prepared.obligation,
      sandbox_result: sandboxResult,
      selector: {
        binding_id: `${input.prepared.metric}-binding-${input.prepared.seed}`,
        output_alias: input.prepared.metric,
        row_index: 0,
      },
    },
  };
}

interface BuiltClaim {
  readonly derivation_input: BuildAtomicClaimCandidateInput;
  readonly document: L2ResearchDocumentCandidate;
  readonly resolution: AtomicClaimDocumentResolution;
  readonly ref: AtomicClaimRef;
  readonly payload: AtomicClaimV2Payload;
  readonly query_evidence_resolutions: readonly QueryEvidenceDocumentResolution[];
}

async function buildDescriptiveClaim(
  evidence: SuccessfulQueryEvidence,
  claimId: string,
  artifactId: number,
  replay: ControlledResearchReplayContext,
): Promise<BuiltClaim> {
  const derivationInput = ownControlledReplayValue(replay, {
    claim_intent: {
      claim_id: claimId,
      limitations: ["L2_NON_CAUSAL"],
    },
    predicate: {
      claim_mode: "DESCRIPTIVE",
      observation_binding_id: evidence.claim_source.selector.binding_id,
      operator: "EQ",
      asserted_value: {
        value_kind: "NUMBER",
        number_value: evidence.prepared.value,
        text_value: null,
        unit: evidence.prepared.unit,
      },
    },
    observation_sources: [evidence.claim_source],
    renderer: {
      renderer_version: ATOMIC_CLAIM_RENDERER_VERSION,
      locale: "zh-CN",
    },
  } satisfies BuildAtomicClaimCandidateInput);
  const payload = mustKernelResult(
    await buildAtomicClaimCandidateWithReplayContext(derivationInput, replay.proof),
  );
  const document = await sealResearchDocument(payload, artifactId);
  const resolution = ownControlledReplayValue(replay, {
    document,
    derivation_input: derivationInput,
  } satisfies AtomicClaimDocumentResolution);
  return {
    derivation_input: derivationInput,
    document,
    resolution,
    ref: documentReference(document, "AtomicClaim"),
    payload,
    query_evidence_resolutions: [evidence.resolution],
  };
}

async function buildConflictClaim(input: {
  readonly primary: SuccessfulQueryEvidence;
  readonly conflicting: SuccessfulQueryEvidence;
  readonly artifact_id: number;
  readonly replay: ControlledResearchReplayContext;
}): Promise<BuiltClaim> {
  const left = input.primary.prepared.value;
  const right = input.conflicting.prepared.value;
  const derivationInput = ownControlledReplayValue(input.replay, {
    claim_intent: {
      claim_id: "late-refund-conflict-claim",
      limitations: ["L2_NON_CAUSAL", "MATERIAL_CONFLICT_UNDISCLOSED"],
    },
    predicate: {
      claim_mode: "COMPARATIVE",
      left_binding_id: input.primary.claim_source.selector.binding_id,
      right_binding_id: input.conflicting.claim_source.selector.binding_id,
      operator: left < right ? "LT" : left > right ? "GT" : "EQ",
      absolute_delta: left - right,
      relative_delta: right === 0 ? null : (left - right) / Math.abs(right),
    },
    observation_sources: [input.primary.claim_source, input.conflicting.claim_source],
    renderer: {
      renderer_version: ATOMIC_CLAIM_RENDERER_VERSION,
      locale: "zh-CN",
    },
  } satisfies BuildAtomicClaimCandidateInput);
  const payload = mustKernelResult(
    await buildAtomicClaimCandidateWithReplayContext(derivationInput, input.replay.proof),
  );
  const document = await sealResearchDocument(payload, input.artifact_id);
  const resolution = ownControlledReplayValue(input.replay, {
    document,
    derivation_input: derivationInput,
  } satisfies AtomicClaimDocumentResolution);
  return {
    derivation_input: derivationInput,
    document,
    resolution,
    ref: documentReference(document, "AtomicClaim"),
    payload,
    query_evidence_resolutions: [input.primary.resolution, input.conflicting.resolution],
  };
}

interface BuiltRelation {
  readonly derivation_input: BuildEvidenceRelationCandidateInput;
  readonly document: L2ResearchDocumentCandidate;
  readonly resolution: EvidenceRelationDocumentResolution;
  readonly ref: EvidenceRelationRef;
  readonly payload: EvidenceRelationV2Payload;
  readonly evidence: SuccessfulQueryEvidence;
}

async function buildRelation(input: {
  readonly claim: BuiltClaim;
  readonly evidence: SuccessfulQueryEvidence;
  readonly proposed_relation: EvidenceRelationV2Payload["proposed_relation"];
  readonly rationale: string;
  readonly artifact_id: number;
  readonly replay: ControlledResearchReplayContext;
}): Promise<BuiltRelation> {
  const derivationInput = ownControlledReplayValue(input.replay, {
    claim_document: input.claim.document,
    evidence_document: input.evidence.document,
    obligation: input.evidence.prepared.obligation,
    proposed_relation: input.proposed_relation,
    rationale: input.rationale,
  } satisfies BuildEvidenceRelationCandidateInput);
  const payload = mustKernelResult(
    await buildEvidenceRelationCandidateWithReplayContext(derivationInput, input.replay.proof),
  );
  const document = await sealResearchDocument(payload, input.artifact_id);
  const resolution = ownControlledReplayValue(input.replay, {
    document,
    derivation_input: derivationInput,
  } satisfies EvidenceRelationDocumentResolution);
  return {
    derivation_input: derivationInput,
    document,
    resolution,
    ref: documentReference(document, "EvidenceRelation"),
    payload,
    evidence: input.evidence,
  };
}

interface RelationChecks {
  readonly documents: readonly [L2ResearchDocumentCandidate, L2ResearchDocumentCandidate];
  readonly resolutions: readonly [EvidenceCheckDocumentResolution, EvidenceCheckDocumentResolution];
}

async function deriveRelationChecks(input: {
  readonly claim: BuiltClaim;
  readonly relation: BuiltRelation;
  readonly artifact_id_start: number;
  readonly replay: ControlledResearchReplayContext;
}): Promise<RelationChecks> {
  const relationResolution = input.relation.resolution;
  const checkInput = (
    checkKind: EvidenceCheckReceiptPayload["check_kind"],
  ): BuildEvidenceCheckCandidateInput => ({
    claim_resolution: input.claim.resolution,
    relation_resolution: relationResolution,
    query_evidence_resolutions: input.claim.query_evidence_resolutions,
    check_kind: checkKind,
    evaluator_version: "controlled-evidence-check@1.0.0",
  });
  const deterministicDerivationInput = ownControlledReplayValue(
    input.replay,
    checkInput("DETERMINISTIC_CHECK"),
  );
  const provenanceDerivationInput = ownControlledReplayValue(
    input.replay,
    checkInput("PROVENANCE_CHECK"),
  );
  const [deterministicPayload, provenancePayload] = await Promise.all([
    buildEvidenceCheckCandidateWithReplayContext(
      deterministicDerivationInput,
      input.replay.proof,
    ).then(mustKernelResult),
    buildEvidenceCheckCandidateWithReplayContext(
      provenanceDerivationInput,
      input.replay.proof,
    ).then(mustKernelResult),
  ]);
  const deterministicDocument = await sealResearchDocument(
    deterministicPayload,
    input.artifact_id_start,
  );
  const provenanceDocument = await sealResearchDocument(
    provenancePayload,
    input.artifact_id_start + 1,
  );
  return {
    documents: [deterministicDocument, provenanceDocument],
    resolutions: [
      {
        document: deterministicDocument,
        derivation_input: deterministicDerivationInput,
      },
      {
        document: provenanceDocument,
        derivation_input: provenanceDerivationInput,
      },
    ],
  };
}

interface BuiltSupport {
  readonly derivation_input: BuildSupportDecisionCandidateInput;
  readonly document: L2ResearchDocumentCandidate;
  readonly resolution: SupportDecisionDocumentResolution;
  readonly ref: SupportDecisionRef;
  readonly payload: SupportDecisionPayload;
}

async function buildSupport(input: {
  readonly claim: BuiltClaim;
  readonly relations: readonly BuiltRelation[];
  readonly checks: readonly RelationChecks[];
  readonly artifact_id: number;
  readonly replay: ControlledResearchReplayContext;
}): Promise<BuiltSupport> {
  const derivationInput = ownControlledReplayValue(input.replay, {
    claim_resolution: input.claim.resolution,
    relation_resolutions: input.relations.map(({ resolution }) => resolution),
    check_resolutions: input.checks.flatMap(({ resolutions }) => resolutions),
    evaluator_version: "controlled-support-evaluator@1.0.0",
  } satisfies BuildSupportDecisionCandidateInput);
  const payload = mustKernelResult(
    await buildSupportDecisionCandidateWithReplayContext(derivationInput, input.replay.proof),
  );
  const document = await sealResearchDocument(payload, input.artifact_id);
  const resolution = ownControlledReplayValue(input.replay, {
    document,
    derivation_input: derivationInput,
  } satisfies SupportDecisionDocumentResolution);
  return {
    derivation_input: derivationInput,
    document,
    resolution,
    ref: documentReference(document, "SupportDecision"),
    payload,
  };
}

interface BuiltAssessment {
  readonly derivation_input: BuildHypothesisAssessmentCandidateInput;
  readonly document: L2ResearchDocumentCandidate;
  readonly resolution: HypothesisAssessmentDocumentResolution;
  readonly ref: HypothesisAssessmentRef;
  readonly payload: HypothesisAssessmentPayload;
}

async function buildAssessment(input: {
  readonly evidence_plan_document: L2ResearchDocumentCandidate;
  readonly hypothesis_id: string;
  readonly support: BuiltSupport | null;
  readonly artifact_id: number;
  readonly replay: ControlledResearchReplayContext;
}): Promise<BuiltAssessment> {
  const derivationInput = ownControlledReplayValue(input.replay, {
    evidence_plan_document: input.evidence_plan_document,
    hypothesis_id: input.hypothesis_id,
    support_decision_resolutions: input.support ? [input.support.resolution] : [],
  } satisfies BuildHypothesisAssessmentCandidateInput);
  const payload = mustKernelResult(
    await buildHypothesisAssessmentCandidateWithReplayContext(derivationInput, input.replay.proof),
  );
  const document = await sealResearchDocument(payload, input.artifact_id);
  const resolution = ownControlledReplayValue(input.replay, {
    document,
    derivation_input: derivationInput,
  } satisfies HypothesisAssessmentDocumentResolution);
  return {
    derivation_input: derivationInput,
    document,
    resolution,
    ref: documentReference(document, "HypothesisAssessment"),
    payload,
  };
}

async function controlledBudgetLedger(topUpAllowed: boolean): Promise<ResearchBudgetLedgerBinding> {
  const material = {
    ledger_version: "research-budget-ledger@1.0.0",
    evaluated_through_reservation_seq: 2,
    effective_limit: {
      max_steps: 4,
      max_model_calls: 4,
      max_sql_executions: 4,
      max_source_calls: 0,
      max_elapsed_ms: 4000,
      max_provider_input_tokens_per_call: 1000,
      max_provider_output_tokens_per_call: 1000,
      max_provider_tokens_per_run: 4000,
      max_provider_cost_microusd_per_run: 4000,
    },
    used: {
      steps: 3,
      model_calls: 3,
      sql_executions: 3,
      source_calls: 0,
      elapsed_ms: 3000,
      provider_input_tokens: 1000,
      provider_output_tokens: 1000,
      provider_tokens: 2000,
      provider_cost_microusd: 3000,
    },
    remaining: {
      steps: 1,
      model_calls: 1,
      sql_executions: 1,
      source_calls: 0,
      elapsed_ms: 1000,
      provider_tokens: 2000,
      provider_cost_microusd: 1000,
    },
    top_up_allowed: topUpAllowed,
  } as const;
  return {
    ...material,
    ledger_hash: await sha256ContentHash({
      hash_domain: "u6-controlled-budget-ledger@1.0.0",
      material,
    }),
  };
}

export interface ControlledClosure {
  readonly coverageResolution: DeriveCoverageStateInput;
  /**
   * 仅为 direct reducer attack tests 保留。它逐项由上面的完整 Document
   * closure 派生；production runner 从不消费此 payload-only 视图。
   */
  readonly coverageInput: DeriveCoverageStateResolvedFactsInput;
  readonly briefDocument: L2ResearchDocumentCandidate;
  readonly materialQueryEvidenceDocuments: readonly L2ResearchDocumentCandidate[];
  readonly claim1: ResolvedResearchArtifact<AtomicClaimRef, AtomicClaimV2Payload>;
  readonly support1: ResolvedResearchArtifact<SupportDecisionRef, SupportDecisionPayload>;
  readonly supportResolutions: readonly ResolvedResearchArtifact<
    SupportDecisionRef,
    SupportDecisionPayload
  >[];
  readonly supportDecisionDocuments: readonly L2ResearchDocumentCandidate[];
  readonly assessment2: ResolvedResearchArtifact<
    HypothesisAssessmentRef,
    HypothesisAssessmentPayload
  >;
  readonly hypothesisAssessments: readonly ProtocolHypothesisAssessment[];
  readonly currentFrontier: VersionFrontier;
  readonly queryContractBindings: readonly {
    readonly obligation_ref: ProofObligationRef;
    readonly query_contract_ref: QueryContractRef;
  }[];
}

function protocolAssessment(
  hypothesisId: string,
  assessment: HypothesisAssessmentPayload,
): ProtocolHypothesisAssessment {
  return {
    hypothesis_id: hypothesisId,
    status:
      assessment.status === "SURVIVED" || assessment.status === "REFUTED"
        ? assessment.status
        : "UNRESOLVED",
  };
}

function secondClosureDisposition(input: ResearchProtocolInput): {
  readonly execute: boolean;
  readonly explicit_failure: boolean;
  readonly metric_matches: boolean;
  readonly predicates_match: boolean;
} {
  const budgetAvailable =
    input.evidence_facts.required_followup_budget_steps <=
    input.evidence_facts.remaining_budget_steps;
  const metricMatches =
    input.evidence_facts.query_metric_id === input.evidence_facts.obligation_metric_id;
  const predicatesMatch =
    input.evidence_facts.query_filter_hash === input.evidence_facts.obligation_filter_hash;
  const executionSucceeded =
    input.evidence_facts.critical_query_execution_status === "SUCCEEDED" &&
    input.observations.q2_dependency_query_ids.length === 1 &&
    input.observations.q2_dependency_query_ids[0] === "Q1";
  return {
    execute: budgetAvailable && metricMatches && predicatesMatch && executionSucceeded,
    explicit_failure: budgetAvailable && metricMatches && predicatesMatch && !executionSucceeded,
    metric_matches: metricMatches,
    predicates_match: predicatesMatch,
  };
}

export async function composeControlledResearchClosure(
  input: ControlledResearchProtocolInput,
  replay: ControlledResearchReplayContext = createControlledResearchReplayContext(),
): Promise<
  | ControlledClosure
  | {
      readonly error: "ATOMIC_CLAIM_OBSERVATION_MISMATCH" | "RESEARCH_STOP_INPUT_INCONSISTENT";
    }
> {
  try {
    const observed = deriveContributionClosure({
      ...input.observations.q1,
      ...input.observations.q2,
    });
    if (!observed.ok) {
      return { error: "ATOMIC_CLAIM_OBSERVATION_MISMATCH" };
    }
    const planning = ownControlledReplayValue(
      replay,
      await compileControlledPlanningClosure(input.evidence_facts, input.hypotheses),
    );
    const planPayload = planning.evidence_plan_document.payload;
    if (planPayload.artifact_type !== "EvidencePlan") {
      return { error: "RESEARCH_STOP_INPUT_INCONSISTENT" };
    }
    const promotionObligation = planPayload.obligations[0];
    const refundObligation = planPayload.obligations[1];
    if (!promotionObligation || !refundObligation) {
      return { error: "RESEARCH_STOP_INPUT_INCONSISTENT" };
    }
    const promotionObligationRef: ProofObligationRef = {
      container_ref: planning.evidence_plan_ref,
      node_id: promotionObligation.obligation_id,
    };
    const refundObligationRef: ProofObligationRef = {
      container_ref: planning.evidence_plan_ref,
      node_id: refundObligation.obligation_id,
    };
    const observedPromotionFrontier = await versionFrontier(
      planning,
      input.observations.q1_snapshot_token,
    );
    const observedRefundFrontier = await versionFrontier(
      planning,
      input.observations.q2_snapshot_token,
    );
    const currentSchemaRef =
      input.evidence_facts.observed_schema_revision === input.evidence_facts.current_schema_revision
        ? planning.schema_snapshot_ref
        : await contentAddressedReference("SchemaSnapshot", 5, {
            datasource_id: CONTROLLED_DATASOURCE_ID,
            schema_revision: input.evidence_facts.current_schema_revision,
          });
    const currentFrontier = await versionFrontier(
      planning,
      input.observations.q2_snapshot_token,
      currentSchemaRef,
    );
    const promotionPrepared = await prepareQuery({
      planning,
      obligation_id: promotionObligation.obligation_id,
      metric: "promotion_decline_share",
      unit: "ratio",
      value: observed.value.promotion_decline_share,
      seed: 100,
      wrong_filter: false,
      replay,
    });
    const promotionEvidence = await executePreparedQuery({
      prepared: promotionPrepared,
      observed_version: observedPromotionFrontier,
      dependency_evidence_documents: [],
      replay,
    });
    const promotionClaim = await buildDescriptiveClaim(
      promotionEvidence,
      "promotion-share-claim",
      400,
      replay,
    );
    const promotionRelation = await buildRelation({
      claim: promotionClaim,
      evidence: promotionEvidence,
      proposed_relation: "SUPPORTS",
      rationale: "实际 Sandbox Result Cell 命中 Promotion Obligation 的 support predicate。",
      artifact_id: 410,
      replay,
    });
    const promotionChecks = await deriveRelationChecks({
      claim: promotionClaim,
      relation: promotionRelation,
      artifact_id_start: 420,
      replay,
    });
    const promotionSupport = await buildSupport({
      claim: promotionClaim,
      relations: [promotionRelation],
      checks: [promotionChecks],
      artifact_id: 430,
      replay,
    });

    const second = secondClosureDisposition(input);
    const refundMetric = second.metric_matches
      ? "late_refund_decline_share"
      : input.evidence_facts.query_metric_id;
    const refundPrepared = await prepareQuery({
      planning,
      obligation_id: refundObligation.obligation_id,
      metric: refundMetric,
      unit: "ratio",
      value: observed.value.late_refund_decline_share,
      seed: 200,
      wrong_filter: !second.predicates_match,
      replay,
    });
    let refundEvidence: SuccessfulQueryEvidence | null = null;
    let conflictEvidence: SuccessfulQueryEvidence | null = null;
    let refundClaim: BuiltClaim | null = null;
    let refundRelations: BuiltRelation[] = [];
    let refundChecks: RelationChecks[] = [];
    let refundSupport: BuiltSupport | null = null;
    const materialConflictPresent =
      input.evidence_facts.material_conflict_count >
      input.evidence_facts.disclosed_material_conflict_count;
    if (second.execute) {
      refundEvidence = await executePreparedQuery({
        prepared: refundPrepared,
        observed_version: observedRefundFrontier,
        dependency_evidence_documents: [promotionEvidence.document],
        replay,
      });
      if (materialConflictPresent) {
        const conflictingValue = Math.max(observed.value.late_refund_decline_share + 0.4, 0.5);
        const conflictPrepared = await prepareQuery({
          planning,
          obligation_id: refundObligation.obligation_id,
          metric: "late_refund_decline_share",
          unit: "ratio",
          value: conflictingValue,
          seed: 300,
          wrong_filter: false,
          replay,
        });
        conflictEvidence = await executePreparedQuery({
          prepared: conflictPrepared,
          observed_version: observedRefundFrontier,
          dependency_evidence_documents: [promotionEvidence.document],
          replay,
        });
        refundClaim = await buildConflictClaim({
          primary: refundEvidence,
          conflicting: conflictEvidence,
          artifact_id: 401,
          replay,
        });
      } else {
        refundClaim = await buildDescriptiveClaim(
          refundEvidence,
          "late-refund-share-claim",
          401,
          replay,
        );
      }
      const refundObservedAssessment = input.hypotheses[1]
        ? evaluateObservationPredicate({
            value: observed.value.late_refund_decline_share,
            predicate: input.hypotheses[1].refute_predicate,
            null_behavior: "FAIL",
          })
        : null;
      const deterministicTransportMatches =
        input.evidence_facts.deterministic_check_observed_hash ===
        input.evidence_facts.deterministic_check_expected_hash;
      const primaryRelationKind = !deterministicTransportMatches
        ? "QUALIFIES"
        : refundObservedAssessment?.ok && refundObservedAssessment.value.matched
          ? "REFUTES"
          : "SUPPORTS";
      const primaryRelation = await buildRelation({
        claim: refundClaim,
        evidence: refundEvidence,
        proposed_relation: primaryRelationKind,
        rationale:
          primaryRelationKind === "REFUTES"
            ? "实际 Sandbox Result Cell 命中 Refund Obligation 的 refute predicate。"
            : primaryRelationKind === "SUPPORTS"
              ? "实际 Sandbox Result Cell 命中 Refund Obligation 的 support predicate。"
              : "该 Relation Candidate 仅声明相关性，production EvidenceCheck 必须据 ObservationContract 失败关闭。",
        artifact_id: 411,
        replay,
      });
      refundRelations = [primaryRelation];
      if (conflictEvidence) {
        refundRelations.push(
          await buildRelation({
            claim: refundClaim,
            evidence: conflictEvidence,
            proposed_relation: "CONFLICTS",
            rationale:
              "第二次独立 Sandbox Result 给出不同 Result Cell，形成可复算的 material conflict。",
            artifact_id: 412,
            replay,
          }),
        );
      }
      refundChecks = [];
      for (const [index, relation] of refundRelations.entries()) {
        refundChecks.push(
          await deriveRelationChecks({
            claim: refundClaim,
            relation,
            artifact_id_start: 422 + index * 2,
            replay,
          }),
        );
      }
      refundSupport = await buildSupport({
        claim: refundClaim,
        relations: refundRelations,
        checks: refundChecks,
        artifact_id: 431,
        replay,
      });
    }

    const promotionAssessment = await buildAssessment({
      evidence_plan_document: planning.evidence_plan_document,
      hypothesis_id: input.hypotheses[0]?.hypothesis_id ?? "promotion-mix",
      support: promotionSupport,
      artifact_id: 440,
      replay,
    });
    const refundAssessment = await buildAssessment({
      evidence_plan_document: planning.evidence_plan_document,
      hypothesis_id: input.hypotheses[1]?.hypothesis_id ?? "late-refund",
      support: refundSupport,
      artifact_id: 441,
      replay,
    });

    const queryEvidenceResolutions: QueryEvidenceDocumentResolution[] = [
      promotionEvidence.resolution,
      ...(refundEvidence ? [refundEvidence.resolution] : []),
      ...(conflictEvidence ? [conflictEvidence.resolution] : []),
    ];
    const atomicClaimResolutions: AtomicClaimDocumentResolution[] = [
      promotionClaim.resolution,
      ...(refundClaim ? [refundClaim.resolution] : []),
    ];
    const allRelations = [promotionRelation, ...refundRelations];
    const evidenceRelationResolutions: EvidenceRelationDocumentResolution[] = allRelations.map(
      ({ resolution }) => resolution,
    );
    const allCheckDocuments = [
      ...promotionChecks.documents,
      ...refundChecks.flatMap(({ documents }) => documents),
    ];
    const evidenceCheckResolutions: EvidenceCheckDocumentResolution[] = [
      ...promotionChecks.resolutions,
      ...refundChecks.flatMap(({ resolutions }) => resolutions),
    ];
    const allSupports = [promotionSupport, ...(refundSupport ? [refundSupport] : [])];
    const supportDecisionResolutions: SupportDecisionDocumentResolution[] = allSupports.map(
      ({ resolution }) => resolution,
    );
    const assessmentDocuments = [promotionAssessment.document, refundAssessment.document];
    const hypothesisAssessmentResolutions: HypothesisAssessmentDocumentResolution[] = [
      promotionAssessment.resolution,
      refundAssessment.resolution,
    ];
    const obligationExecutionDecisionResolutions: ObligationExecutionDecisionDocumentResolution[] =
      [
        promotionPrepared,
        refundPrepared,
        ...(conflictEvidence ? [conflictEvidence.prepared] : []),
      ].map(({ oed_resolution }) => oed_resolution);
    const executionFailureResolutions: DeriveCoverageStateInput["execution_failure_resolutions"] =
      second.explicit_failure
        ? [
            {
              obligation_ref: refundObligationRef,
              execution_receipt_ref: await contentAddressedReference("ExecutionReceipt", 250, {
                sql_artifact_ref: refundPrepared.sql_artifact_ref,
                status: "FAILED",
              }),
              sandbox_execution_receipt_ref: await contentAddressedReference(
                "SandboxExecutionReceipt",
                251,
                {
                  sql_artifact_ref: refundPrepared.sql_artifact_ref,
                  terminal: "FAILED",
                },
              ),
              execution_status: "FAILED",
              sandbox_terminal: "FAILED",
              reason_code: "CRITICAL_OBLIGATION_FAILED",
            },
          ]
        : [];
    const coverageResolution = ownControlledReplayValue(replay, {
      evidence_plan_document: planning.evidence_plan_document,
      obligation_execution_decision_resolutions: obligationExecutionDecisionResolutions,
      query_evidence_resolutions: queryEvidenceResolutions,
      atomic_claim_resolutions: atomicClaimResolutions,
      evidence_relation_resolutions: evidenceRelationResolutions,
      evidence_check_resolutions: evidenceCheckResolutions,
      support_decision_resolutions: supportDecisionResolutions,
      hypothesis_assessment_resolutions: hypothesisAssessmentResolutions,
      blockers: [],
      execution_failure_resolutions: executionFailureResolutions,
      budget_ledger: await controlledBudgetLedger(input.next_query_facts.budget_top_up_allowed),
      current_version_frontier: currentFrontier,
    } satisfies DeriveCoverageStateInput);
    const rawQueryEvidence = [
      researchResolution(promotionEvidence.document, "QueryEvidence"),
      ...(refundEvidence ? [researchResolution(refundEvidence.document, "QueryEvidence")] : []),
      ...(conflictEvidence ? [researchResolution(conflictEvidence.document, "QueryEvidence")] : []),
    ];
    const rawClaims = [
      researchResolution(promotionClaim.document, "AtomicClaim"),
      ...(refundClaim ? [researchResolution(refundClaim.document, "AtomicClaim")] : []),
    ];
    const rawRelations = allRelations.map(({ document }) =>
      researchResolution(document, "EvidenceRelation"),
    );
    const rawChecks = allCheckDocuments.map((document) =>
      researchResolution(document, "EvidenceCheckReceipt"),
    );
    const rawSupports = allSupports.map(({ document }) =>
      researchResolution(document, "SupportDecision"),
    );
    const rawAssessments = assessmentDocuments.map((document) =>
      researchResolution(document, "HypothesisAssessment"),
    );
    const claimEvidenceByIdentity = new Map(
      [promotionClaim, ...(refundClaim ? [refundClaim] : [])].map((claim) => [
        artifactReferenceIdentity(claim.ref),
        claim.payload.evidence_refs,
      ]),
    );
    const materialEvidenceIdentities = new Set(
      allSupports
        .filter(({ payload }) => ["SUPPORTED", "REFUTED"].includes(payload.decision))
        .flatMap(
          ({ payload }) =>
            claimEvidenceByIdentity.get(artifactReferenceIdentity(payload.claim_ref)) ?? [],
        )
        .map(artifactReferenceIdentity),
    );
    const materialQueryEvidenceDocuments = queryEvidenceResolutions
      .filter(({ document }) =>
        materialEvidenceIdentities.has(
          artifactReferenceIdentity(documentReference(document, "QueryEvidence")),
        ),
      )
      .sort((left, right) =>
        stableCompare(
          artifactReferenceIdentity(documentReference(left.document, "QueryEvidence")),
          artifactReferenceIdentity(documentReference(right.document, "QueryEvidence")),
        ),
      )
      .map(({ document }) => document);
    const rawOeds = [
      researchResolution(promotionPrepared.oed_document, "ObligationExecutionDecision"),
      researchResolution(refundPrepared.oed_document, "ObligationExecutionDecision"),
      ...(conflictEvidence
        ? [
            researchResolution(
              conflictEvidence.prepared.oed_document,
              "ObligationExecutionDecision",
            ),
          ]
        : []),
    ];
    const coverageInput: DeriveCoverageStateResolvedFactsInput = {
      evidence_plan_ref: planning.evidence_plan_ref as EvidencePlanRef,
      evidence_plan: planPayload,
      obligation_execution_decisions: rawOeds,
      query_evidence: rawQueryEvidence,
      atomic_claims: rawClaims,
      evidence_relations: rawRelations,
      evidence_checks: rawChecks,
      support_decisions: rawSupports,
      hypothesis_assessments: rawAssessments,
      blockers: [],
      execution_failure_resolutions: executionFailureResolutions,
      budget_ledger: coverageResolution.budget_ledger,
      current_version_frontier: currentFrontier,
    };
    return ownControlledReplayValue(replay, {
      coverageResolution,
      coverageInput,
      briefDocument: planning.brief_document,
      materialQueryEvidenceDocuments,
      claim1: {
        ref: promotionClaim.ref,
        payload: promotionClaim.payload,
      },
      support1: {
        ref: promotionSupport.ref,
        payload: promotionSupport.payload,
      },
      supportResolutions: rawSupports,
      supportDecisionDocuments: allSupports.map(({ document }) => document),
      assessment2: {
        ref: refundAssessment.ref,
        payload: refundAssessment.payload,
      },
      hypothesisAssessments: [
        protocolAssessment(
          input.hypotheses[0]?.hypothesis_id ?? "promotion-mix",
          promotionAssessment.payload,
        ),
        protocolAssessment(
          input.hypotheses[1]?.hypothesis_id ?? "late-refund",
          refundAssessment.payload,
        ),
      ],
      currentFrontier,
      queryContractBindings: [
        {
          obligation_ref: promotionObligationRef,
          query_contract_ref: promotionPrepared.query_contract_ref,
        },
        {
          obligation_ref: refundObligationRef,
          query_contract_ref: refundPrepared.query_contract_ref,
        },
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      error: message.includes("ATOMIC_CLAIM_OBSERVATION_MISMATCH")
        ? "ATOMIC_CLAIM_OBSERVATION_MISMATCH"
        : "RESEARCH_STOP_INPUT_INCONSISTENT",
    };
  }
}

function queryCandidates(
  input: ResearchProtocolInput,
  unresolved: readonly ProofObligationRef[],
  queryContractBindings: ControlledClosure["queryContractBindings"],
): QueryCandidateFacts[] {
  if (
    unresolved.length === 0 ||
    !input.next_query_facts.query_present ||
    input.next_query_facts.replan_trigger === "PLAN_INVALIDATED"
  ) {
    return [];
  }
  const firstUnresolved = unresolved[0];
  const binding =
    firstUnresolved === undefined
      ? undefined
      : queryContractBindings.find(
          ({ obligation_ref }) =>
            embeddedNodeReferenceIdentity(obligation_ref) ===
            embeddedNodeReferenceIdentity(firstUnresolved),
        );
  if (!binding) return [];
  return [
    {
      query_contract_ref: binding.query_contract_ref,
      obligation_refs: [binding.obligation_ref],
      semantic_admissible: input.next_query_facts.semantic_admissible,
      expected_information_gain_microunits: input.next_query_facts.information_gain_microunits,
      required_budget: {
        steps: input.next_query_facts.required_budget_steps,
        model_calls: 0,
        sql_executions: 1,
        source_calls: 0,
        elapsed_ms: 100,
        provider_tokens: 0,
        provider_cost_microusd: 0,
      },
      waiting_on_codes: [...input.next_query_facts.waiting_on_codes],
      reason_codes: ["EVIDENCE_COVERAGE_INSUFFICIENT"],
    },
  ];
}

function stopOutcome(
  decision: NonNullable<ResearchProtocolEvaluation["artifact_candidates"]["stop"]>,
): ResearchProtocolKernelOutcome {
  switch (decision.decision) {
    case "STOP_READY":
      return {
        kind: "REPORT_READY_CANDIDATE",
        reason_code: "OBLIGATION_SATISFIED",
        report_ready_candidate_eligible: true,
      };
    case "CONTINUE":
    case "REPLAN":
      return {
        kind: "RESEARCH_STOP_CANDIDATE",
        reason_code: decision.reason_codes[0] ?? "RESEARCH_STOP_INPUT_INCONSISTENT",
        terminal_candidate: null,
      };
    case "STOP_PARTIAL":
      return {
        kind: "RESEARCH_STOP_CANDIDATE",
        reason_code: decision.reason_codes[0] ?? "RESEARCH_STOP_INPUT_INCONSISTENT",
        terminal_candidate: {
          terminal: "PARTIAL",
          commitment: "NOT_COMMITTED",
        },
      };
    case "STOP_NEEDS_MORE_RESEARCH":
      return {
        kind: "RESEARCH_STOP_CANDIDATE",
        reason_code: decision.reason_codes[0] ?? "RESEARCH_STOP_INPUT_INCONSISTENT",
        terminal_candidate: {
          terminal: "NEEDS_MORE_RESEARCH",
          commitment: "NOT_COMMITTED",
        },
      };
    case "STOP_INCONCLUSIVE":
      return {
        kind: "RESEARCH_STOP_CANDIDATE",
        reason_code: decision.reason_codes[0] ?? "RESEARCH_STOP_INPUT_INCONSISTENT",
        terminal_candidate: {
          terminal: "INCONCLUSIVE",
          commitment: "NOT_COMMITTED",
        },
      };
  }
}

const controlledKernelEvaluations = new WeakSet<object>();
const controlledKernelReplayMetrics = new WeakMap<object, ResearchReplayMetrics>();

function recordControlledKernelEvaluation(
  evaluation: ResearchProtocolEvaluation,
): ResearchProtocolEvaluation {
  const frozen = deepFreeze(evaluation);
  controlledKernelEvaluations.add(frozen);
  return frozen;
}

export function isControlledKernelEvaluation(value: unknown): value is ResearchProtocolEvaluation {
  return typeof value === "object" && value !== null && controlledKernelEvaluations.has(value);
}

/**
 * Source-only test observability for the synthetic controlled kernel.
 * This is intentionally absent from the package root and server export maps.
 */
export function inspectControlledKernelReplayMetrics(
  evaluation: ResearchProtocolEvaluation,
): ResearchReplayMetrics | null {
  return controlledKernelReplayMetrics.get(evaluation) ?? null;
}

function rejectedEvaluation(
  hypothesisAssessments: readonly ProtocolHypothesisAssessment[],
  kernelTrace: ResearchProtocolEvaluation["kernel_trace"],
  reasonCode: "ATOMIC_CLAIM_OBSERVATION_MISMATCH" | "RESEARCH_STOP_INPUT_INCONSISTENT",
): ResearchProtocolEvaluation {
  return recordControlledKernelEvaluation({
    hypothesis_assessments: hypothesisAssessments,
    stop_decision_candidate: null,
    kernel_outcome: {
      kind: "REJECTED",
      reason_code: reasonCode,
    },
    kernel_trace: [...kernelTrace],
    artifact_candidates: {},
  });
}

async function runControlledProtocolKernelWithReplayContext(
  input: ControlledResearchProtocolInput,
  replay: ControlledResearchReplayContext,
): Promise<ResearchProtocolEvaluation> {
  if (!isControlledResearchProtocolInput(input)) {
    throw new TypeError("CONTROLLED_RESEARCH_PROTOCOL_INPUT_REQUIRED");
  }
  const kernelTrace: ResearchProtocolEvaluation["kernel_trace"][number][] = [];
  const closure = await composeControlledResearchClosure(input, replay);
  kernelTrace.push("OBSERVATION");
  if ("error" in closure) {
    return rejectedEvaluation([], kernelTrace, closure.error);
  }
  const coverage = await deriveCoverageStateCandidateWithReplayContext(
    closure.coverageResolution,
    replay.request,
  );
  kernelTrace.push("COVERAGE");
  if (!coverage.ok) {
    return rejectedEvaluation(
      closure.hypothesisAssessments,
      kernelTrace,
      "RESEARCH_STOP_INPUT_INCONSISTENT",
    );
  }
  const coverageDocument = await sealResearchDocument(coverage.value, 450);
  const coverageUnresolved = coverage.value.obligations
    .filter(({ state }) => ["OPEN", "BLOCKED", "FAILED"].includes(state))
    .map(({ obligation_ref }) => obligation_ref);
  const briefPayload = closure.briefDocument.payload;
  if (briefPayload.artifact_type !== "ResearchBrief") {
    return rejectedEvaluation(
      closure.hypothesisAssessments,
      kernelTrace,
      "RESEARCH_STOP_INPUT_INCONSISTENT",
    );
  }
  const materialQueryEvidencePayloads = closure.materialQueryEvidenceDocuments
    .map(({ payload }) => payload)
    .filter(
      (payload): payload is QueryEvidenceV2Payload => payload.artifact_type === "QueryEvidence",
    );
  if (materialQueryEvidencePayloads.length !== closure.materialQueryEvidenceDocuments.length) {
    return rejectedEvaluation(
      closure.hypothesisAssessments,
      kernelTrace,
      "RESEARCH_STOP_INPUT_INCONSISTENT",
    );
  }
  const preStopReadiness = await derivePreStopReadinessFacts({
    brief: briefPayload,
    material_query_evidence: materialQueryEvidencePayloads,
    supplied_disclosures: [...input.evidence_facts.report_disclosures],
  });
  if (!preStopReadiness.ok) {
    return rejectedEvaluation(
      closure.hypothesisAssessments,
      kernelTrace,
      "RESEARCH_STOP_INPUT_INCONSISTENT",
    );
  }
  const unresolved =
    coverageUnresolved.length > 0 || preStopReadiness.value.ready
      ? coverageUnresolved
      : preStopReadiness.value.remediation_obligation_refs.slice(0, 1);
  const stopInput = ownControlledReplayValue(replay, {
    coverage_document: coverageDocument,
    coverage_resolution: closure.coverageResolution,
    candidate_queries: queryCandidates(input, unresolved, closure.queryContractBindings),
    support_decision_documents: closure.supportDecisionDocuments,
    required_disclosures: [...input.evidence_facts.report_disclosures],
    pre_stop_readiness: {
      brief_document: closure.briefDocument,
      material_query_evidence_documents: closure.materialQueryEvidenceDocuments,
      supplied_disclosures: [...input.evidence_facts.report_disclosures],
    },
    ...(input.next_query_facts.replan_trigger === "PLAN_INVALIDATED"
      ? {
          replan: {
            trigger: "PLAN_INVALIDATED" as const,
            executable_with_remaining_budget: true as const,
          },
        }
      : {}),
    enumerator_version: "controlled-candidate-enumerator@1.0.0",
    eig_policy_version: "controlled-eig@1.0.0",
  } as const);
  const stop = await deriveResearchStopDecisionCandidateWithReplayContext(
    stopInput,
    replay.request,
  );
  kernelTrace.push("STOP");
  if (!stop.ok) {
    const stale =
      stop.error.code === "RESEARCH_STOP_INPUT_STALE" ||
      input.observations.q1_snapshot_token !== input.observations.q2_snapshot_token ||
      input.evidence_facts.observed_schema_revision !==
        input.evidence_facts.current_schema_revision;
    return recordControlledKernelEvaluation({
      hypothesis_assessments: closure.hypothesisAssessments,
      stop_decision_candidate: null,
      kernel_outcome: stale
        ? {
            kind: "REVOCATION_REQUIRED",
            reason_code:
              input.observations.q1_snapshot_token === input.observations.q2_snapshot_token
                ? "EVIDENCE_REVISION_STALE"
                : "DATA_SNAPSHOT_STALE",
            required_platform_transition: "REVOCATION_TRANSACTION",
            verification_scope: "SYNTHETIC_PLATFORM_BOUNDARY_EXPECTATION",
          }
        : {
            kind: "REJECTED",
            reason_code: "RESEARCH_STOP_INPUT_INCONSISTENT",
          },
      kernel_trace: [...kernelTrace],
      artifact_candidates: {
        coverage: coverage.value,
        stop: null,
      },
    });
  }
  const stopDocument = await sealResearchDocument(stop.value, 451);
  if (stop.value.decision !== "STOP_READY") {
    return recordControlledKernelEvaluation({
      hypothesis_assessments: closure.hypothesisAssessments,
      stop_decision_candidate: stop.value.decision,
      kernel_outcome: stopOutcome(stop.value),
      kernel_trace: [...kernelTrace],
      artifact_candidates: {
        coverage: coverage.value,
        stop: stop.value,
      },
    });
  }
  const supportedClaimIdentities = new Set(
    stop.value.supported_subset.claim_refs.map(artifactReferenceIdentity),
  );
  const supportedClaimDocuments = closure.coverageResolution.atomic_claim_resolutions
    .map(({ document }) => document)
    .filter((document) =>
      supportedClaimIdentities.has(
        artifactReferenceIdentity(documentReference(document, "AtomicClaim")),
      ),
    );
  const reportSupportDecisionDocuments = closure.coverageResolution.support_decision_resolutions
    .map(({ document }) => document)
    .filter(
      ({ payload }) =>
        payload.artifact_type === "SupportDecision" &&
        ["SUPPORTED", "REFUTED"].includes(payload.decision),
    );
  const refutedHypothesisAssessmentDocuments =
    closure.coverageResolution.hypothesis_assessment_resolutions
      .map(({ document }) => document)
      .filter(
        ({ payload }) =>
          payload.artifact_type === "HypothesisAssessment" && payload.status === "REFUTED",
      );
  const conflictRelationDocuments = closure.coverageResolution.evidence_relation_resolutions
    .map(({ document }) => document)
    .filter(
      ({ payload }) =>
        payload.artifact_type === "EvidenceRelation" && payload.proposed_relation === "CONFLICTS",
    );
  const stopDecisionResolution = {
    document: stopDocument,
    derivation_input: stopInput,
  } as const;
  const manifestInput = ownControlledReplayValue(replay, {
    brief_document: closure.briefDocument,
    stop_decision_resolution: stopDecisionResolution,
    executive_claim_documents: supportedClaimDocuments,
    supported_finding_claim_documents: supportedClaimDocuments,
    support_decision_documents: reportSupportDecisionDocuments,
    refuted_hypothesis_assessment_documents: refutedHypothesisAssessmentDocuments,
    conflict_relation_documents: conflictRelationDocuments,
    limitation_codes: ["L2_NON_CAUSAL"],
  } as const);
  const manifest = await buildReportManifestCandidateWithReplayContext(
    manifestInput,
    replay.request,
  );
  kernelTrace.push("REPORTING");
  if (!manifest.ok) {
    return recordControlledKernelEvaluation({
      hypothesis_assessments: closure.hypothesisAssessments,
      stop_decision_candidate: stop.value.decision,
      kernel_outcome: {
        kind: "RUNTIME_FAILURE_REQUIRED",
        reason_code: "REPORT_PROJECTION_AUTHORITY_INVALID",
        required_platform_transition: "RUNTIME_FAILURE_TRANSACTION",
        verification_scope: "SYNTHETIC_PLATFORM_BOUNDARY_EXPECTATION",
      },
      kernel_trace: [...kernelTrace],
      artifact_candidates: {
        coverage: coverage.value,
        stop: stop.value,
      },
    });
  }
  const manifestDocument = await sealResearchDocument(manifest.value, 452);
  const manifestRef = documentReference(manifestDocument, "ReportManifest");
  const provisionalReportRef = await contentAddressedReference("AnalysisReport", 453, {
    manifest_ref: manifestRef,
    projection: "controlled-two-pass-report-reference",
  });
  const projectionFirstPassInput = ownControlledReplayValue(replay, {
    brief_document: closure.briefDocument,
    manifest_document: manifestDocument,
    report_ref: provisionalReportRef,
    atomic_claim_documents: supportedClaimDocuments,
    projector_version: "controlled-projector@1.0.0",
    ...(input.evidence_facts.writer_projection_mode === "FREEFORM"
      ? {
          writer_candidate: {
            title: "促销导致收入暴跌 95%",
            sections: [],
          },
        }
      : {}),
  });
  const projectionFirstPass = await projectAnalysisReportCandidateWithReplayContext(
    projectionFirstPassInput,
    replay.request,
  );
  if (!projectionFirstPass.ok) {
    return recordControlledKernelEvaluation({
      hypothesis_assessments: closure.hypothesisAssessments,
      stop_decision_candidate: stop.value.decision,
      kernel_outcome: {
        kind: "RUNTIME_FAILURE_REQUIRED",
        reason_code: "REPORT_PROJECTION_AUTHORITY_INVALID",
        required_platform_transition: "RUNTIME_FAILURE_TRANSACTION",
        verification_scope: "SYNTHETIC_PLATFORM_BOUNDARY_EXPECTATION",
      },
      kernel_trace: [...kernelTrace],
      artifact_candidates: {
        coverage: coverage.value,
        stop: stop.value,
        manifest: manifest.value,
      },
    });
  }
  const reportDocument = await sealResearchDocument(projectionFirstPass.value.report, 453);
  const reportRef = documentReference(reportDocument, "AnalysisReport");
  const projectionInput = ownControlledReplayValue(replay, {
    brief_document: closure.briefDocument,
    manifest_document: manifestDocument,
    report_ref: reportRef,
    atomic_claim_documents: supportedClaimDocuments,
    projector_version: "controlled-projector@1.0.0",
  } as const);
  const projection = await projectAnalysisReportCandidateWithReplayContext(
    projectionInput,
    replay.request,
  );
  if (!projection.ok) {
    return rejectedEvaluation(
      closure.hypothesisAssessments,
      kernelTrace,
      "RESEARCH_STOP_INPUT_INCONSISTENT",
    );
  }
  const projectionDocument = await sealResearchDocument(projection.value.receipt, 454);
  const gateFacts = ownControlledReplayValue(replay, {
    brief_document: closure.briefDocument,
    report_manifest_document: manifestDocument,
    analysis_report_document: reportDocument,
    evaluator_version: "controlled-readiness-gate@1.0.0",
    query_evidence_resolutions: closure.coverageResolution.query_evidence_resolutions,
    atomic_claim_resolutions: closure.coverageResolution.atomic_claim_resolutions,
    evidence_relation_resolutions: closure.coverageResolution.evidence_relation_resolutions,
    evidence_check_resolutions: closure.coverageResolution.evidence_check_resolutions,
    hypothesis_assessment_resolutions: closure.coverageResolution.hypothesis_assessment_resolutions,
    support_decision_resolutions: closure.coverageResolution.support_decision_resolutions,
    current_version_frontier: closure.currentFrontier,
  } as const);
  const gates = await evaluateEvidenceGatesWithReplayContext(gateFacts, replay.request);
  kernelTrace.push("READINESS");
  if (!gates.ok) {
    return recordControlledKernelEvaluation({
      hypothesis_assessments: closure.hypothesisAssessments,
      stop_decision_candidate: stop.value.decision,
      kernel_outcome: {
        kind: "READINESS_REJECTED",
        reason_code: "REPORT_READY_AUTHORITY_REQUIRED",
        verification_scope: "SYNTHETIC_PLATFORM_BOUNDARY_EXPECTATION",
      },
      kernel_trace: [...kernelTrace],
      artifact_candidates: {
        coverage: coverage.value,
        stop: stop.value,
        manifest: manifest.value,
        report: projection.value.report,
        projection_receipt: projection.value.receipt,
      },
    });
  }
  const gateDocuments = {
    support: await sealResearchDocument(gates.value.support, 460),
    conflict: await sealResearchDocument(gates.value.conflict, 461),
    freshness: await sealResearchDocument(gates.value.freshness, 462),
    source_independence: await sealResearchDocument(gates.value.source_independence, 463),
  };
  const reportReadyInput = ownControlledReplayValue(replay, {
    stop_decision_resolution: stopDecisionResolution,
    report_manifest_resolution: {
      document: manifestDocument,
      derivation_input: manifestInput,
    },
    report_projection_resolution: {
      report_document: reportDocument,
      receipt_document: projectionDocument,
      derivation_input: projectionInput,
    },
    gate_receipt_documents: gateDocuments,
    gate_facts: gateFacts,
    version_frontier: closure.currentFrontier,
    evaluated_through_input_event_seq: 10,
  });
  const reportReady = await createReportReadyCertificateCandidateWithReplayContext(
    reportReadyInput,
    replay.request,
  );
  if (!reportReady.ok) {
    return recordControlledKernelEvaluation({
      hypothesis_assessments: closure.hypothesisAssessments,
      stop_decision_candidate: stop.value.decision,
      kernel_outcome: {
        kind: "READINESS_REJECTED",
        reason_code: "REPORT_READY_AUTHORITY_REQUIRED",
        verification_scope: "SYNTHETIC_PLATFORM_BOUNDARY_EXPECTATION",
      },
      kernel_trace: [...kernelTrace],
      artifact_candidates: {
        coverage: coverage.value,
        stop: stop.value,
        manifest: manifest.value,
        report: projection.value.report,
        projection_receipt: projection.value.receipt,
        gates: gates.value,
      },
    });
  }
  await sealResearchDocument(reportReady.value, 470);
  const candidateForVerification =
    input.boundary_facts.closure_hash_transport === "ZEROED"
      ? {
          ...reportReady.value,
          input_closure_hash: await sha256ContentHash({
            hash_domain: "u6-controlled-corrupted-closure@1.0.0",
            transport: "ZEROED",
          }),
        }
      : input.boundary_facts.semantic_hash_transport === "REPLACED"
        ? {
            ...reportReady.value,
            certificate_semantic_hash: await sha256ContentHash({
              hash_domain: "u6-controlled-corrupted-semantic@1.0.0",
              transport: "REPLACED",
            }),
          }
        : reportReady.value;
  const candidateVerification =
    await verifyReportReadyCertificateCandidate(candidateForVerification);
  let kernelOutcome: ResearchProtocolKernelOutcome;
  if (input.boundary_facts.issuer_role !== "READINESS_AUTHORITY") {
    kernelOutcome = {
      kind: "READINESS_REJECTED",
      reason_code: "REPORT_READY_AUTHORITY_REQUIRED",
      verification_scope: "SYNTHETIC_PLATFORM_BOUNDARY_EXPECTATION",
    };
  } else if (!candidateVerification.ok) {
    kernelOutcome = {
      kind: "READINESS_REJECTED",
      reason_code:
        candidateVerification.error.code === "CERTIFICATE_SEMANTIC_HASH_MISMATCH"
          ? "CERTIFICATE_SEMANTIC_HASH_MISMATCH"
          : "REPORT_READY_CERTIFICATE_TAMPERED",
      verification_scope: "SYNTHETIC_PLATFORM_BOUNDARY_EXPECTATION",
    };
  } else if (
    input.boundary_facts.revocation_event_seq !== null &&
    input.boundary_facts.revocation_event_seq < input.boundary_facts.consumption_event_seq
  ) {
    kernelOutcome = {
      kind: "REVOCATION_REQUIRED",
      reason_code: "READINESS_REVOKED_DURING_CONSUMPTION",
      required_platform_transition: "REVOCATION_TRANSACTION",
      verification_scope: "SYNTHETIC_PLATFORM_BOUNDARY_EXPECTATION",
    };
  } else {
    kernelOutcome = {
      kind: "REPORT_READY_CANDIDATE",
      reason_code: "OBLIGATION_SATISFIED",
      report_ready_candidate_eligible: true,
    };
  }
  return recordControlledKernelEvaluation({
    hypothesis_assessments: closure.hypothesisAssessments,
    stop_decision_candidate: stop.value.decision,
    kernel_outcome: kernelOutcome,
    kernel_trace: [...kernelTrace],
    artifact_candidates: {
      coverage: coverage.value,
      stop: stop.value,
      manifest: manifest.value,
      report: projection.value.report,
      projection_receipt: projection.value.receipt,
      gates: gates.value,
      report_ready: reportReady.value,
    },
  });
}

export async function runControlledProtocolKernel(
  input: ControlledResearchProtocolInput,
): Promise<ResearchProtocolEvaluation> {
  const replay = createControlledResearchReplayContext();
  const evaluation = await runControlledProtocolKernelWithReplayContext(input, replay);
  controlledKernelReplayMetrics.set(evaluation, snapshotResearchReplayMetrics(replay.request));
  return evaluation;
}
