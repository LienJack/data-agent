import {
  type ArtifactReference,
  artifactReferenceIdentity,
  computeGroundingAuthorityDocumentHash,
  computeGroundingHash,
  computeL2ArtifactContentHash,
  computeSqlArtifactQueryHash,
  groundingAuthorityDocumentSchema,
  type L2ArtifactDocument,
  type L2ArtifactPersistenceAuthority,
  l2ArtifactDocumentSchema,
  verifyL2ArtifactDocument,
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
  semanticRelease: "00000000-0000-4000-8000-000000000131",
  schemaSnapshot: "00000000-0000-4000-8000-000000000132",
  policyReceipt: "00000000-0000-4000-8000-000000000133",
  intentGate: "00000000-0000-4000-8000-000000000121",
  semanticGate: "00000000-0000-4000-8000-000000000122",
  structuralGate: "00000000-0000-4000-8000-000000000123",
  policyGate: "00000000-0000-4000-8000-000000000124",
  resourceGate: "00000000-0000-4000-8000-000000000125",
  executionPermit: "00000000-0000-4000-8000-000000000126",
  sandboxReceipt: "00000000-0000-4000-8000-000000000127",
  executionGate: "00000000-0000-4000-8000-000000000128",
  resultGate: "00000000-0000-4000-8000-000000000129",
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

async function sealGroundingAuthorityDocument(input: unknown) {
  const draft = groundingAuthorityDocumentSchema.parse(input);
  const documentHash = await computeGroundingAuthorityDocumentHash(draft);
  return groundingAuthorityDocumentSchema.parse({
    ...draft,
    artifact_ref: {
      ...draft.artifact_ref,
      content_hash: documentHash,
    },
    document_hash: documentHash,
  });
}

export async function createAuthoritativeReadyFixture() {
  const documents = new Map<string, L2ArtifactDocument>();
  const groundingAuthorityDocuments = new Map<string, unknown>();
  const persistedReferences = new Set<string>();
  const authority: L2ArtifactPersistenceAuthority = {
    principalId: "principal-fixture",
    verifyCommitted: async (reference) =>
      persistedReferences.has(artifactReferenceIdentity(reference)),
    resolveL2: async (reference) => documents.get(artifactReferenceIdentity(reference)) ?? null,
    resolveGroundingAuthority: async (reference) =>
      structuredClone(
        groundingAuthorityDocuments.get(artifactReferenceIdentity(reference)) ?? null,
      ),
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
      const verified = await verifyL2ArtifactDocument(committed, authority);
      documents.set(referenceIdentity, verified);
      return { authorized: verified, reference };
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
      metric: "metric.net_revenue",
      dimensions: ["dimension.region"],
      grain: "order",
      time_range: {
        start: "2025-01-01T00:00:00.000+08:00",
        end: "2025-04-01T00:00:00.000+08:00",
        timezone: "Asia/Shanghai",
        semantics: "HALF_OPEN",
      },
      unit: "CNY",
      filters: [{ field: "orders.region", operator: "eq", value: "华南" }],
      datasource_id: ids.appA,
      result_contract: {
        columns: ["dimension.region", "metric.net_revenue"],
        invariant_ids: ["non_empty"],
      },
    },
  );
  const metricBinding = {
    metric_id: "metric.net_revenue",
    aliases: ["净收入"],
    table_id: "orders",
    column_id: "orders.net_revenue",
    aggregation: "sum",
    grain: "order",
    unit: "CNY",
    time_column_id: "orders.created_at",
    additivity: "additive",
    null_policy: "coalesce-zero",
    dependency_column_ids: ["orders.net_revenue"],
    fanout_policy: "preaggregate",
  };
  const dimensionBinding = {
    dimension_id: "dimension.region",
    aliases: ["地区"],
    table_id: "orders",
    column_id: "orders.region",
    grain: "order",
  };
  const authorityDocumentBase = {
    schema_version: "data-agent-grounding-authority/v1",
    scope: {
      app_id: ids.appA,
      tenant_id: ids.tenantA,
      environment: "test",
    },
    run_id: ids.run,
    parent_ref: null,
    producer: {
      kind: "deterministic",
      id: "grounding-registry",
    },
    authority: {
      kind: "deterministic",
      id: "grounding-authority",
      policy_version: "grounding-authority@1.0.0",
    },
    created_at: "2026-07-25T00:00:00.000Z",
    document_hash: hashes.input,
  } as const;
  const referenceBase = {
    app_id: ids.appA,
    tenant_id: ids.tenantA,
    environment: "test",
    run_id: ids.run,
    revision: 1,
    content_hash: hashes.input,
  } as const;
  const catalogTables = [
    {
      table_id: "orders",
      physical_name: "orders",
      columns: [
        {
          column_id: "orders.created_at",
          physical_name: "created_at",
          data_type: "timestamptz",
          nullable: false,
          sensitivity: "INTERNAL",
        },
        {
          column_id: "orders.net_revenue",
          physical_name: "net_revenue",
          data_type: "numeric",
          nullable: true,
          sensitivity: "INTERNAL",
        },
        {
          column_id: "orders.region",
          physical_name: "region",
          data_type: "text",
          nullable: false,
          sensitivity: "INTERNAL",
        },
      ],
    },
  ] as const;
  const semanticReleaseDocument = await sealGroundingAuthorityDocument({
    ...authorityDocumentBase,
    artifact_type: "SemanticRelease",
    artifact_ref: {
      ...referenceBase,
      artifact_id: authorityIds.semanticRelease,
      artifact_type: "SemanticRelease",
    },
    semantic_release_version: "retail-semantics@1.0.0",
    catalog_version: "retail-catalog@1.0.0",
    datasource_id: ids.appA,
    metrics: [metricBinding],
    dimensions: [dimensionBinding],
  });
  const schemaSnapshotDocument = await sealGroundingAuthorityDocument({
    ...authorityDocumentBase,
    artifact_type: "SchemaSnapshot",
    artifact_ref: {
      ...referenceBase,
      artifact_id: authorityIds.schemaSnapshot,
      artifact_type: "SchemaSnapshot",
    },
    schema_snapshot_version: "retail-schema@1.0.0",
    catalog_version: "retail-catalog@1.0.0",
    datasource_id: ids.appA,
    tables: catalogTables,
    relationships: [],
  });
  const policyReceiptDocument = await sealGroundingAuthorityDocument({
    ...authorityDocumentBase,
    artifact_type: "PolicyReceipt",
    artifact_ref: {
      ...referenceBase,
      artifact_id: authorityIds.policyReceipt,
      artifact_type: "PolicyReceipt",
    },
    authority: {
      kind: "deterministic",
      id: "policy-authority",
      policy_version: "default-policy@1.0.0",
    },
    policy_version: "default-policy@1.0.0",
    datasource_id: ids.appA,
    principal_id: "principal-fixture",
    semantic_release_ref: semanticReleaseDocument.artifact_ref,
    schema_snapshot_ref: schemaSnapshotDocument.artifact_ref,
    allowed_schema: {
      tables: [
        {
          table_id: "orders",
          column_ids: catalogTables[0].columns.map(({ column_id }) => column_id),
        },
      ],
    },
    mandatory_predicates: [],
  });
  const groundingAuthoritySources = [
    semanticReleaseDocument,
    schemaSnapshotDocument,
    policyReceiptDocument,
  ];
  for (const document of groundingAuthoritySources) {
    const identity = artifactReferenceIdentity(document.artifact_ref);
    groundingAuthorityDocuments.set(identity, document);
    persistedReferences.add(identity);
  }
  const groundingSourceReferences = {
    semanticRelease: semanticReleaseDocument.artifact_ref,
    schemaSnapshot: schemaSnapshotDocument.artifact_ref,
    policyReceipt: policyReceiptDocument.artifact_ref,
  };
  const groundingMaterial = {
    catalog_version: "retail-catalog@1.0.0",
    policy_version: "default-policy@1.0.0",
    datasource_id: ids.appA,
    allowed_schema: {
      tables: catalogTables,
    },
    metric: metricBinding,
    dimensions: [dimensionBinding],
    required_column_ids: ["orders.created_at", "orders.net_revenue", "orders.region"],
    mandatory_predicates: [],
    join_closure: {
      root_table_id: "orders",
      table_ids: ["orders"],
      edges: [],
      preaggregations: [],
    },
    accepted_candidate_ids: ["metric.net_revenue", "dimension.region"],
    conflict_set: [],
  };
  const groundingContent = {
    ...groundingMaterial,
    grounding_hash: await computeGroundingHash(groundingMaterial),
  };
  const groundingPackage = await commit(
    "GroundingPackage",
    authorityIds.groundingPackage,
    [
      queryContract.reference,
      groundingSourceReferences.semanticRelease,
      groundingSourceReferences.schemaSnapshot,
      groundingSourceReferences.policyReceipt,
    ],
    {
      artifact_type: "GroundingPackage",
      query_contract_ref: queryContract.reference,
      semantic_release_ref: groundingSourceReferences.semanticRelease,
      schema_snapshot_ref: groundingSourceReferences.schemaSnapshot,
      policy_receipt_ref: groundingSourceReferences.policyReceipt,
      ...groundingContent,
    },
  );
  const semanticContent = {
    metric: metricBinding,
    dimensions: [dimensionBinding],
    predicates: [
      {
        kind: "comparison",
        left: { table_id: "orders", column_id: "orders.region" },
        operator: "eq",
        right: { parameter_key: "literal.region" },
        authority: "query-contract",
      },
    ],
    time_predicate: {
      field: { table_id: "orders", column_id: "orders.created_at" },
      lower: { parameter_key: "time.start", inclusive: true },
      upper: { parameter_key: "time.end", inclusive: false },
      timezone: "Asia/Shanghai",
    },
    parameters: {
      "literal.region": { source: "literal", value: "华南" },
      "time.start": { source: "time", value: "2025-01-01T00:00:00.000+08:00" },
      "time.end": { source: "time", value: "2025-04-01T00:00:00.000+08:00" },
    },
    grounding_hash: groundingContent.grounding_hash,
    result_contract: {
      columns: ["dimension.region", "metric.net_revenue"],
      invariant_ids: ["non_empty"],
    },
  };
  const semanticQuery = await commit(
    "SemanticQuery",
    authorityIds.semanticQuery,
    [queryContract.reference, groundingPackage.reference],
    {
      artifact_type: "SemanticQuery",
      query_contract_ref: queryContract.reference,
      grounding_package_ref: groundingPackage.reference,
      ...semanticContent,
    },
  );
  const logicalPlan = await commit(
    "LogicalPlan",
    authorityIds.logicalPlan,
    [semanticQuery.reference],
    {
      artifact_type: "LogicalPlan",
      semantic_query_ref: semanticQuery.reference,
      operations: [
        {
          operation: "scan",
          operation_id: "scan_orders",
          table_id: "orders",
          alias: "t_orders",
          column_ids: groundingContent.required_column_ids,
        },
        {
          operation: "filter",
          operation_id: "filter_authorized",
          input_id: "scan_orders",
          predicates: [
            ...semanticContent.predicates,
            {
              kind: "comparison",
              left: { table_id: "orders", column_id: "orders.created_at" },
              operator: "gte",
              right: { parameter_key: "time.start" },
              authority: "time",
            },
            {
              kind: "comparison",
              left: { table_id: "orders", column_id: "orders.created_at" },
              operator: "lt",
              right: { parameter_key: "time.end" },
              authority: "time",
            },
          ],
        },
        {
          operation: "aggregate",
          operation_id: "aggregate_metric",
          input_id: "filter_authorized",
          group_by: [{ table_id: "orders", column_id: "orders.region" }],
          measures: [
            {
              metric_id: "metric.net_revenue",
              function: "sum",
              field: { table_id: "orders", column_id: "orders.net_revenue" },
              alias: "metric.net_revenue",
              unit: "CNY",
              null_policy: "coalesce-zero",
              distinct: false,
            },
          ],
        },
        {
          operation: "project",
          operation_id: "project_result",
          input_id: "aggregate_metric",
          columns: [
            {
              source_kind: "group",
              source_id: "orders.region",
              alias: "dimension.region",
            },
            {
              source_kind: "measure",
              source_id: "metric.net_revenue",
              alias: "metric.net_revenue",
            },
          ],
        },
      ],
      root_operation_id: "project_result",
      parameters: semanticContent.parameters,
      grounding_hash: groundingContent.grounding_hash,
      semantic_signature: {
        metric_id: "metric.net_revenue",
        dimension_ids: ["dimension.region"],
        grain: "order",
        unit: "CNY",
        time_semantics: "HALF_OPEN",
      },
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
  const preExecutionGateInputs = [
    ["INTENT", authorityIds.intentGate],
    ["SEMANTIC", authorityIds.semanticGate],
    ["STRUCTURAL", authorityIds.structuralGate],
    ["POLICY", authorityIds.policyGate],
    ["RESOURCE", authorityIds.resourceGate],
  ] as const;
  const preExecutionGates = await Promise.all(
    preExecutionGateInputs.map(([gate, artifactId]) =>
      commit("GateReceipt", artifactId, [sqlArtifact.reference], {
        artifact_type: "GateReceipt",
        sql_artifact_ref: sqlArtifact.reference,
        execution_receipt_ref: null,
        gate,
        gate_version: "text2sql-gates@1.0.0",
        verdict: "PASS",
        reason_code: `${gate}_PASSED`,
        evidence_refs: [sqlArtifact.reference],
        evaluated_at: "2026-07-25T00:00:00.000Z",
      }),
    ),
  );
  const executionPermit = await commit(
    "ExecutionPermit",
    authorityIds.executionPermit,
    [sqlArtifact.reference, ...preExecutionGates.map(({ reference }) => reference)],
    {
      artifact_type: "ExecutionPermit",
      sql_artifact_ref: sqlArtifact.reference,
      gate_receipt_refs: preExecutionGates.map(({ reference }) => reference),
      budget: {
        timeout_ms: 5_000,
        max_rows: 1_000,
        max_bytes: 1_000_000,
      },
      expires_at: "2026-07-25T00:05:00.000Z",
    },
  );
  const sandboxReceiptReference: ArtifactReference = {
    artifact_id: authorityIds.sandboxReceipt,
    artifact_type: "SandboxExecutionReceipt",
    app_id: ids.appA,
    tenant_id: ids.tenantA,
    environment: "test",
    run_id: ids.run,
    revision: 1,
    content_hash: hashes.execution,
  };
  persistedReferences.add(artifactReferenceIdentity(sandboxReceiptReference));
  const execution = await commit(
    "ExecutionReceipt",
    authorityIds.execution,
    [sqlArtifact.reference, executionPermit.reference, sandboxReceiptReference],
    {
      artifact_type: "ExecutionReceipt",
      sql_artifact_ref: sqlArtifact.reference,
      execution_permit_ref: executionPermit.reference,
      sandbox_execution_receipt_ref: sandboxReceiptReference,
      datasource_id: ids.appA,
      schema_version: "1.0.0",
      snapshot_token: "snapshot-1",
      watermark: "watermark-1",
      observed_at: "2026-07-25T00:00:00.000Z",
      query_hash: queryHash,
      result_hash: hashes.execution,
      replay_state: "REPLAYABLE",
      row_count: 1,
    },
  );
  const postExecutionGateInputs = [
    ["EXECUTION", authorityIds.executionGate, "EXECUTION_PASSED"],
    ["RESULT", authorityIds.resultGate, "RESULT_ORACLE_PASSED"],
  ] as const;
  const postExecutionGates = await Promise.all(
    postExecutionGateInputs.map(([gate, artifactId, reasonCode]) =>
      commit(
        "GateReceipt",
        artifactId,
        [sqlArtifact.reference, execution.reference, sandboxReceiptReference],
        {
          artifact_type: "GateReceipt",
          sql_artifact_ref: sqlArtifact.reference,
          execution_receipt_ref: execution.reference,
          gate,
          gate_version: "text2sql-gates@1.0.0",
          verdict: "PASS",
          reason_code: reasonCode,
          evidence_refs: [sandboxReceiptReference],
          evaluated_at: "2026-07-25T00:00:01.000Z",
        },
      ),
    ),
  );
  const allGates = [...preExecutionGates, ...postExecutionGates];
  const validation = await commit(
    "ValidationReceipt",
    authorityIds.validation,
    [sqlArtifact.reference, execution.reference, ...allGates.map(({ reference }) => reference)],
    {
      artifact_type: "ValidationReceipt",
      sql_artifact_ref: sqlArtifact.reference,
      execution_receipt_ref: execution.reference,
      gate_receipt_refs: allGates.map(({ reference }) => reference),
      validation_version: "text2sql-validation@1.0.0",
      sealed_at: "2026-07-25T00:00:02.000Z",
    },
  );
  const evidence = await commit(
    "QueryEvidence",
    authorityIds.evidence,
    [execution.reference, validation.reference],
    {
      artifact_type: "QueryEvidence",
      execution_receipt_ref: execution.reference,
      validation_receipt_ref: validation.reference,
      result_hash: hashes.execution,
      invariant_verdicts: [{ invariant_id: "non_empty", verdict: "PASS" }],
    },
  );
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
      preExecutionGates: preExecutionGates.map(({ reference }) => reference),
      executionPermit: executionPermit.reference,
      sandboxReceipt: sandboxReceiptReference,
      postExecutionGates: postExecutionGates.map(({ reference }) => reference),
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
