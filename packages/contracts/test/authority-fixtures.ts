import {
  type ArtifactReference,
  type AuthoritativeL2ArtifactDocument,
  artifactReferenceIdentity,
  authorizeL2ArtifactDocument,
  computeL2ArtifactContentHash,
  computeSqlArtifactQueryHash,
  type L2ArtifactDocument,
  type L2ArtifactPersistenceAuthority,
  l2ArtifactDocumentSchema,
} from "../src/artifacts/index.js";
import type { L2ArtifactType } from "../src/artifacts/types.js";
import { hashes, ids, makeArtifactEnvelope } from "./fixtures.js";

const authorityIds = {
  questionFrame: "00000000-0000-4000-8000-000000000111",
  researchBrief: "00000000-0000-4000-8000-000000000112",
  hypothesisSet: "00000000-0000-4000-8000-000000000113",
  evidencePlan: "00000000-0000-4000-8000-000000000114",
  queryContract: "00000000-0000-4000-8000-000000000115",
  groundingPackage: "00000000-0000-4000-8000-000000000116",
  semanticQuery: "00000000-0000-4000-8000-000000000117",
  logicalPlan: "00000000-0000-4000-8000-000000000118",
  sqlArtifact: "00000000-0000-4000-8000-000000000119",
  validation: "00000000-0000-4000-8000-000000000101",
  execution: "00000000-0000-4000-8000-000000000102",
  evidence: "00000000-0000-4000-8000-000000000103",
  claim: "00000000-0000-4000-8000-000000000104",
  report: "00000000-0000-4000-8000-000000000105",
  certificate: "00000000-0000-4000-8000-000000000106",
  hypothesisRevenue: "00000000-0000-4000-8000-000000000201",
  hypothesisRefund: "00000000-0000-4000-8000-000000000202",
  obligationRevenue: "00000000-0000-4000-8000-000000000301",
  obligationRefund: "00000000-0000-4000-8000-000000000302",
} as const;

function referenceFromDocument(document: L2ArtifactDocument): ArtifactReference {
  return {
    artifact_id: document.envelope.artifact_id,
    artifact_type: document.envelope.artifact_type,
    app_id: document.envelope.app_id,
    tenant_id: document.envelope.tenant_id,
    environment: document.envelope.environment,
    run_id: document.envelope.run_id,
    revision: document.envelope.revision,
    content_hash: document.envelope.content_hash,
  };
}

export async function createAuthoritativeReadyFixture() {
  const documents = new Map<string, AuthoritativeL2ArtifactDocument>();
  const persistedReferences = new Set<string>();
  const authority: L2ArtifactPersistenceAuthority = {
    verifyCommitted: async (reference) =>
      persistedReferences.has(artifactReferenceIdentity(reference)),
    resolveL2: async (reference) => documents.get(artifactReferenceIdentity(reference)) ?? null,
    verifyCommitterCapability: async (claim) =>
      claim.app_id === ids.appA &&
      claim.tenant_id === ids.tenantA &&
      claim.environment === "test" &&
      claim.run_id === ids.run &&
      claim.attempt_id === ids.attempt &&
      claim.producer_id === "question-frame-compiler" &&
      claim.policy_version === "default-policy@1.0.0",
  };

  async function commit(
    artifactType: L2ArtifactType,
    artifactId: string,
    inputRefs: ArtifactReference[],
    payload: unknown,
  ) {
    const draft = l2ArtifactDocumentSchema.parse({
      envelope: {
        ...makeArtifactEnvelope(),
        artifact_id: artifactId,
        artifact_type: artifactType,
        input_refs: inputRefs,
      },
      payload,
    });
    const committed = l2ArtifactDocumentSchema.parse({
      ...draft,
      envelope: {
        ...draft.envelope,
        content_hash: await computeL2ArtifactContentHash(draft),
      },
    });
    const reference = referenceFromDocument(committed);
    const referenceIdentity = artifactReferenceIdentity(reference);
    persistedReferences.add(referenceIdentity);
    try {
      const authorized = await authorizeL2ArtifactDocument(committed, authority);
      documents.set(referenceIdentity, authorized);
      return { authorized, reference };
    } catch (error) {
      persistedReferences.delete(referenceIdentity);
      throw error;
    }
  }

  const questionFrame = await commit("QuestionFrame", authorityIds.questionFrame, [], {
    artifact_type: "QuestionFrame",
    raw_question: "2025 年第一季度华南区净收入同比为什么下降？",
    normalized_question: "解释 2025Q1 华南区净收入同比下降的支持证据",
    authorized_datasource_ids: [ids.appA],
    expected_output: "多步研究报告",
  });
  const researchBrief = await commit(
    "ResearchBrief",
    authorityIds.researchBrief,
    [questionFrame.reference],
    {
      artifact_type: "ResearchBrief",
      question_frame_ref: questionFrame.reference,
      research_goal: "区分净收入下降的竞争解释并绑定可复核证据。",
      success_criteria: ["每个竞争假设至少有一项证据义务", "结论绑定已验证 SQL 证据"],
      budget: {
        max_steps: 8,
        max_model_calls: 6,
        max_sql_executions: 4,
      },
    },
  );
  const hypothesisSet = await commit(
    "HypothesisSet",
    authorityIds.hypothesisSet,
    [researchBrief.reference],
    {
      artifact_type: "HypothesisSet",
      research_brief_ref: researchBrief.reference,
      hypotheses: [
        {
          hypothesis_id: authorityIds.hypothesisRevenue,
          statement: "促销折扣提高压低净收入。",
          differentiating_prediction: "折扣率上升且折扣贡献为负。",
        },
        {
          hypothesis_id: authorityIds.hypothesisRefund,
          statement: "退款增加压低净收入。",
          differentiating_prediction: "退款率上升且退款贡献为负。",
        },
      ],
    },
  );
  const evidencePlan = await commit(
    "EvidencePlan",
    authorityIds.evidencePlan,
    [hypothesisSet.reference],
    {
      artifact_type: "EvidencePlan",
      hypothesis_set_ref: hypothesisSet.reference,
      obligations: [
        {
          obligation_id: authorityIds.obligationRevenue,
          hypothesis_id: authorityIds.hypothesisRevenue,
          question: "促销折扣变化贡献了多少净收入差异？",
          source_kind: "sql",
        },
        {
          obligation_id: authorityIds.obligationRefund,
          hypothesis_id: authorityIds.hypothesisRefund,
          question: "退款变化贡献了多少净收入差异？",
          source_kind: "sql",
        },
      ],
    },
  );
  const queryContract = await commit(
    "QueryContract",
    authorityIds.queryContract,
    [evidencePlan.reference],
    {
      artifact_type: "QueryContract",
      evidence_plan_ref: evidencePlan.reference,
      metric: "net_revenue",
      dimensions: ["region"],
      grain: "order",
      time_range: {
        start: "2025-01-01T00:00:00.000+08:00",
        end: "2025-04-01T00:00:00.000+08:00",
        timezone: "Asia/Shanghai",
      },
      unit: "CNY",
      filters: [{ field: "region", operator: "eq", value: "华南" }],
      datasource_id: ids.appA,
      result_contract: {
        columns: ["net_revenue"],
        invariant_ids: ["non_empty"],
      },
    },
  );
  const groundingPackage = await commit(
    "GroundingPackage",
    authorityIds.groundingPackage,
    [queryContract.reference],
    {
      artifact_type: "GroundingPackage",
      query_contract_ref: queryContract.reference,
      semantic_release: "retail-semantics@1.0.0",
      source_refs: [],
      join_bridges: [],
    },
  );
  const semanticQuery = await commit(
    "SemanticQuery",
    authorityIds.semanticQuery,
    [queryContract.reference, groundingPackage.reference],
    {
      artifact_type: "SemanticQuery",
      query_contract_ref: queryContract.reference,
      grounding_package_ref: groundingPackage.reference,
      metric_ref: "net_revenue",
      dimension_refs: ["region"],
      filter_expressions: ["region = :region"],
    },
  );
  const logicalPlan = await commit(
    "LogicalPlan",
    authorityIds.logicalPlan,
    [semanticQuery.reference],
    {
      artifact_type: "LogicalPlan",
      semantic_query_ref: semanticQuery.reference,
      operations: [{ operation: "scan", source: "orders", alias: "orders" }],
    },
  );
  const sqlPayload = {
    artifact_type: "SqlArtifact" as const,
    logical_plan_ref: logicalPlan.reference,
    dialect: "postgresql" as const,
    sql: "SELECT SUM(net_revenue) AS net_revenue FROM orders WHERE region = $1",
    parameters: { region: "华南" },
  };
  const queryHash = await computeSqlArtifactQueryHash(sqlPayload);
  const sqlArtifact = await commit(
    "SqlArtifact",
    authorityIds.sqlArtifact,
    [logicalPlan.reference],
    {
      ...sqlPayload,
      query_hash: queryHash,
    },
  );
  const validation = await commit(
    "ValidationReceipt",
    authorityIds.validation,
    [sqlArtifact.reference],
    {
      artifact_type: "ValidationReceipt",
      sql_artifact_ref: sqlArtifact.reference,
      gates: ["INTENT", "SEMANTIC", "STRUCTURAL", "POLICY", "RESOURCE", "EXECUTION", "RESULT"].map(
        (gate) => ({
          gate,
          verdict: "PASS",
          reason_code: "VALIDATION_PASSED",
        }),
      ),
    },
  );
  const execution = await commit(
    "ExecutionReceipt",
    authorityIds.execution,
    [sqlArtifact.reference, validation.reference],
    {
      artifact_type: "ExecutionReceipt",
      sql_artifact_ref: sqlArtifact.reference,
      validation_receipt_ref: validation.reference,
      datasource_id: ids.appA,
      schema_version: "1.0.0",
      snapshot_token: "snapshot-1",
      watermark: "watermark-1",
      observed_at: "2026-07-25T00:00:00.000Z",
      query_hash: queryHash,
      replay_state: "REPLAYABLE",
      row_count: 1,
    },
  );
  const evidence = await commit("QueryEvidence", authorityIds.evidence, [execution.reference], {
    artifact_type: "QueryEvidence",
    execution_receipt_ref: execution.reference,
    result_hash: hashes.execution,
    invariant_verdicts: [{ invariant_id: "non-empty", verdict: "PASS" }],
  });
  const claim = await commit("AtomicClaim", authorityIds.claim, [evidence.reference], {
    artifact_type: "AtomicClaim",
    claim_id: authorityIds.claim,
    statement: "华南区净收入下降由促销折扣变化支持。",
    evidence_refs: [evidence.reference],
    support_state: "SUPPORTED",
    limitations: ["仅覆盖受控数据快照。"],
  });
  const report = await commit("AnalysisReport", authorityIds.report, [claim.reference], {
    artifact_type: "AnalysisReport",
    title: "华南区净收入下降分析",
    claim_refs: [claim.reference],
    limitations: ["仅覆盖受控数据快照。"],
    projection_hash: hashes.execution,
  });
  const certificate = await commit(
    "ReportReadyCertificate",
    authorityIds.certificate,
    [report.reference, evidence.reference],
    {
      artifact_type: "ReportReadyCertificate",
      report_ref: report.reference,
      gate_version: "1.0.0",
      gate_results: ["SUPPORT", "CONFLICT", "FRESHNESS", "SOURCE_INDEPENDENCE"].map((gate) => ({
        gate,
        verdict: "PASS",
        reason_code: "EVIDENCE_GATE_PASSED",
      })),
      evidence_refs: [evidence.reference],
      decision: "READY",
      certificate_hash: hashes.execution,
    },
  );

  return {
    authority,
    commit,
    queryHash,
    references: {
      questionFrame: questionFrame.reference,
      researchBrief: researchBrief.reference,
      hypothesisSet: hypothesisSet.reference,
      evidencePlan: evidencePlan.reference,
      queryContract: queryContract.reference,
      groundingPackage: groundingPackage.reference,
      semanticQuery: semanticQuery.reference,
      logicalPlan: logicalPlan.reference,
      sqlArtifact: sqlArtifact.reference,
      validation: validation.reference,
      execution: execution.reference,
      evidence: evidence.reference,
      claim: claim.reference,
      report: report.reference,
      certificate: certificate.reference,
    },
    hypothesisIds: {
      revenue: authorityIds.hypothesisRevenue,
      refund: authorityIds.hypothesisRefund,
    },
    certificate: certificate.authorized,
    certificateReference: certificate.reference,
  };
}
