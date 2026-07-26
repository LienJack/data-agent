import {
  type ArtifactReference,
  artifactReferenceFor,
  artifactReferenceIdentity,
  computeGateEvaluationHash,
  computeGateInputHash,
  computeGroundingAuthorityDocumentHash,
  computeGroundingHash,
  computeL2ArtifactContentHash,
  computePostgresqlExecutionSettingsHash,
  computeResourceAdmissionReceiptHash,
  computeResourceEstimateHash,
  computeResultOracleEvidenceHash,
  computeResultOracleReceiptHash,
  computeSqlArtifactQueryHash,
  type GateReceiptPayload,
  gateReceiptSchema,
  groundingAuthorityDocumentSchema,
  type L2ArtifactDocument,
  type L2ArtifactPersistenceAuthority,
  l2ArtifactDocumentSchema,
  resourceAdmissionReceiptSchema,
  resultOracleReceiptSchema,
  TEXT2SQL_GATE_EVALUATOR_VERSION,
  TEXT2SQL_GATE_REASON_CODES,
  TEXT2SQL_VALIDATION_VERSION,
  verifyL2ArtifactDocument,
} from "../src/artifacts/index.js";
import type { L2ArtifactType } from "../src/artifacts/types.js";
import { canonicalizeJson, sha256ContentHash } from "../src/common/index.js";
import {
  computeSandboxExecutionReceiptHash,
  computeSandboxExecutionRequestHash,
  computeSandboxResultBytes,
  computeSandboxResultHash,
  sandboxExecutionRequestSchema,
  sandboxResultSchema,
  successfulSandboxExecutionReceiptSchema,
} from "../src/ports/sandbox.js";
import { hashes, ids, makeArtifactEnvelope } from "./fixtures.js";

export type GateReceiptDraft = Omit<GateReceiptPayload, "input_hash" | "evaluation_hash">;

export async function sealGateReceipt(draft: GateReceiptDraft): Promise<GateReceiptPayload> {
  const inputHash = await computeGateInputHash({
    artifact_type: draft.artifact_type,
    sql_artifact_ref: draft.sql_artifact_ref,
    execution_receipt_ref: draft.execution_receipt_ref,
    gate: draft.gate,
    gate_version: draft.gate_version,
    evaluator_version: draft.evaluator_version,
    evidence_refs: draft.evidence_refs,
  });
  const evaluationInput = {
    ...draft,
    input_hash: inputHash,
  };

  return gateReceiptSchema.parse({
    ...evaluationInput,
    evaluation_hash: await computeGateEvaluationHash(evaluationInput),
  });
}

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
  resourceAdmission: "00000000-0000-4000-8000-000000000135",
  executionPermit: "00000000-0000-4000-8000-000000000126",
  sandboxReceipt: "00000000-0000-4000-8000-000000000127",
  sandboxResult: "00000000-0000-4000-8000-000000000134",
  resultOracle: "00000000-0000-4000-8000-000000000136",
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
  const systemArtifacts = new Map<string, unknown>();
  const persistedReferences = new Set<string>();
  let expectedSqlArtifactPayload: unknown = null;
  const authority: L2ArtifactPersistenceAuthority = {
    principalId: "principal-fixture",
    verifyCommitted: async (reference) =>
      persistedReferences.has(artifactReferenceIdentity(reference)),
    resolveL2: async (reference) => documents.get(artifactReferenceIdentity(reference)) ?? null,
    resolveGroundingAuthority: async (reference) =>
      structuredClone(
        groundingAuthorityDocuments.get(artifactReferenceIdentity(reference)) ?? null,
      ),
    resolveSystemArtifact: async (reference) =>
      structuredClone(systemArtifacts.get(artifactReferenceIdentity(reference)) ?? null),
    verifySystemArtifactCommitted: async (reference) =>
      systemArtifacts.has(artifactReferenceIdentity(reference)),
    verifySqlArtifactCompilation: async ({ sql_artifact }) =>
      expectedSqlArtifactPayload !== null &&
      canonicalizeJson(sql_artifact) === canonicalizeJson(expectedSqlArtifactPayload),
    verifyResourceAdmissionReceipt: async (receipt) => {
      const stored = resourceAdmissionReceiptSchema.safeParse(
        systemArtifacts.get(artifactReferenceIdentity(receipt.receipt_ref)),
      );
      return stored.success && canonicalizeJson(stored.data) === canonicalizeJson(receipt);
    },
    verifyResultOracleReceipt: async (receipt) => {
      const stored = resultOracleReceiptSchema.safeParse(
        systemArtifacts.get(artifactReferenceIdentity(receipt.receipt_ref)),
      );
      return stored.success && canonicalizeJson(stored.data) === canonicalizeJson(receipt);
    },
    verifySandboxExecutionEvidence: async ({ receipt, result }) =>
      canonicalizeJson(systemArtifacts.get(artifactReferenceIdentity(receipt.receipt_ref))) ===
        canonicalizeJson(receipt) &&
      canonicalizeJson(systemArtifacts.get(artifactReferenceIdentity(result.result_ref))) ===
        canonicalizeJson(result),
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

  function persistSystemArtifact(reference: ArtifactReference, payload: unknown): void {
    const identity = artifactReferenceIdentity(reference);
    systemArtifacts.set(identity, structuredClone(payload));
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
    compiler_version: "postgresql-compiler@1.0.0",
    ast_hash: hashes.artifact,
    dialect: "postgresql" as const,
    sql: "SELECT SUM(net_revenue) AS net_revenue FROM orders WHERE region = $1",
    parameters: { region: "华南" },
  };
  const queryHash = await computeSqlArtifactQueryHash(sqlPayload);
  expectedSqlArtifactPayload = {
    ...sqlPayload,
    query_hash: queryHash,
  };
  const sqlArtifact = await commit(
    "SqlArtifact",
    authorityIds.sqlArtifact,
    [logicalPlan.reference],
    expectedSqlArtifactPayload,
  );
  const sqlArtifactReference = artifactReferenceFor("SqlArtifact").parse(sqlArtifact.reference);
  if (
    queryContract.authorized.payload.artifact_type !== "QueryContract" ||
    logicalPlan.authorized.payload.artifact_type !== "LogicalPlan"
  ) {
    throw new TypeError("权威 Gate Fixture 缺少 QueryContract/LogicalPlan。");
  }
  const logicalPlanPayload = logicalPlan.authorized.payload;
  const queryContractObservationHash = await sha256ContentHash(queryContract.authorized.payload);
  const intentSignatureHash = await sha256ContentHash(logicalPlanPayload.semantic_signature);
  const logicalPlanObservationHash = await sha256ContentHash({
    operations: logicalPlanPayload.operations,
    root_operation_id: logicalPlanPayload.root_operation_id,
    parameters: logicalPlanPayload.parameters,
    grounding_hash: logicalPlanPayload.grounding_hash,
    semantic_signature: logicalPlanPayload.semantic_signature,
  });
  const semanticObservationHash = await sha256ContentHash(semanticContent);
  const groundingObservationHash = await sha256ContentHash(groundingContent);
  const executionSettings = {
    database_role: "analyst",
    search_path: ["app_data_agent", "pg_catalog"],
    plan_cache_mode: "force_custom_plan" as const,
    statement_timeout_ms: 5_000,
    lock_timeout_ms: 1_000,
  };
  const settingsHash = await computePostgresqlExecutionSettingsHash(executionSettings);
  const resourceEstimate = {
    query_hash: queryHash,
    datasource_id: ids.appA,
    schema_version: "retail-schema@1.0.0",
    settings_hash: settingsHash,
    total_cost: 10,
    plan_rows: 1,
    plan_width: 16,
    node_types: ["Aggregate", "Seq Scan"],
    relation_names: ["orders"],
    has_cartesian_join: false,
  };
  const resourceEstimateHash = await computeResourceEstimateHash(resourceEstimate);
  const resourceAdmissionDraft = resourceAdmissionReceiptSchema.parse({
    artifact_type: "ResourceAdmissionReceipt",
    receipt_ref: {
      artifact_id: authorityIds.resourceAdmission,
      artifact_type: "ResourceAdmissionReceipt",
      app_id: ids.appA,
      tenant_id: ids.tenantA,
      environment: "test",
      run_id: ids.run,
      revision: 1,
      content_hash: hashes.input,
    },
    scope: {
      app_id: ids.appA,
      tenant_id: ids.tenantA,
      environment: "test",
    },
    run_id: ids.run,
    sql_artifact_ref: sqlArtifactReference,
    principal_id: "principal-fixture",
    policy_receipt_ref: groundingSourceReferences.policyReceipt,
    ...resourceEstimate,
    execution_settings: executionSettings,
    estimate_hash: resourceEstimateHash,
    policy_version: "resource-policy@1.0.0",
    forbidden_node_types: ["Nested Loop"],
    max_total_cost: 1_000,
    max_plan_rows: 1_000,
    max_plan_bytes: 1_000_000,
    lock_timeout_ms: 1_000,
    timeout_ms: 5_000,
    max_rows: 1_000,
    max_bytes: 1_000_000,
    max_memory_mb: 512,
    evaluated_at: "2026-07-25T00:00:00.000Z",
    receipt_hash: hashes.input,
  });
  const resourceAdmissionHash = await computeResourceAdmissionReceiptHash(resourceAdmissionDraft);
  const resourceAdmission = resourceAdmissionReceiptSchema.parse({
    ...resourceAdmissionDraft,
    receipt_ref: {
      ...resourceAdmissionDraft.receipt_ref,
      content_hash: resourceAdmissionHash,
    },
    receipt_hash: resourceAdmissionHash,
  });
  persistSystemArtifact(resourceAdmission.receipt_ref, resourceAdmission);
  const preExecutionGateInputs = [
    [
      "INTENT",
      authorityIds.intentGate,
      {
        query_contract_hash: queryContractObservationHash,
        intent_signature_hash: intentSignatureHash,
      },
    ],
    [
      "SEMANTIC",
      authorityIds.semanticGate,
      {
        logical_plan_hash: logicalPlanObservationHash,
        semantic_hash: semanticObservationHash,
        grounding_hash: groundingObservationHash,
      },
    ],
    [
      "STRUCTURAL",
      authorityIds.structuralGate,
      {
        compiler_version: "postgresql-compiler@1.0.0",
        ast_hash: sqlPayload.ast_hash,
        query_hash: queryHash,
        parameter_count: Object.keys(sqlPayload.parameters).length,
        statement_kind: "SELECT",
        read_only: true,
      },
    ],
    [
      "POLICY",
      authorityIds.policyGate,
      {
        policy_version: "default-policy@1.0.0",
        mandatory_predicate_count: groundingContent.mandatory_predicates.length,
        resolved_binding_count: groundingContent.mandatory_predicates.length,
      },
    ],
    [
      "RESOURCE",
      authorityIds.resourceGate,
      {
        estimate_hash: resourceEstimateHash,
        policy_version: "resource-policy@1.0.0",
        total_cost: 10,
        plan_rows: 1,
        plan_width: 16,
        planned_bytes: 16,
        lock_timeout_ms: 1_000,
        timeout_ms: 5_000,
        max_rows: 1_000,
        max_bytes: 1_000_000,
        max_memory_mb: 512,
      },
    ],
  ] as const;
  const preExecutionGates = await Promise.all(
    preExecutionGateInputs.map(async ([gate, artifactId, observations]) => {
      const evidenceReferences =
        gate === "RESOURCE"
          ? [sqlArtifactReference, resourceAdmission.receipt_ref]
          : [sqlArtifactReference];
      return commit(
        "GateReceipt",
        artifactId,
        evidenceReferences,
        await sealGateReceipt({
          artifact_type: "GateReceipt",
          sql_artifact_ref: sqlArtifactReference,
          execution_receipt_ref: null,
          gate,
          gate_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
          evaluator_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
          evaluator_input_hash: hashes.input,
          evaluator_evaluation_hash: hashes.execution,
          verdict: "PASS",
          reason_code: TEXT2SQL_GATE_REASON_CODES[gate].PASS[0],
          evidence_refs: evidenceReferences,
          observations,
          evaluated_at: "2026-07-25T00:00:00.000Z",
        }),
      );
    }),
  );
  const executionPermit = await commit(
    "ExecutionPermit",
    authorityIds.executionPermit,
    [
      sqlArtifactReference,
      resourceAdmission.receipt_ref,
      groundingSourceReferences.policyReceipt,
      ...preExecutionGates.map(({ reference }) => reference),
    ],
    {
      artifact_type: "ExecutionPermit",
      sql_artifact_ref: sqlArtifactReference,
      resource_admission_ref: resourceAdmission.receipt_ref,
      gate_receipt_refs: preExecutionGates.map(({ reference }) => reference),
      principal_id: "principal-fixture",
      policy_receipt_ref: groundingSourceReferences.policyReceipt,
      datasource_id: ids.appA,
      schema_version: resourceAdmission.schema_version,
      settings_hash: resourceAdmission.settings_hash,
      execution_settings: resourceAdmission.execution_settings,
      budget: {
        timeout_ms: 5_000,
        lock_timeout_ms: 1_000,
        max_rows: 1_000,
        max_bytes: 1_000_000,
        max_memory_mb: 512,
      },
      issued_at: "2026-07-25T00:00:00.000Z",
      expires_at: "2026-07-25T00:05:00.000Z",
    },
  );
  const executionPermitReference = artifactReferenceFor("ExecutionPermit").parse(
    executionPermit.reference,
  );
  const sandboxExecutionId = "00000000-0000-4000-8000-000000000137";
  const sandboxRequest = sandboxExecutionRequestSchema.parse({
    schema_version: resourceAdmission.schema_version,
    scope: {
      app_id: ids.appA,
      tenant_id: ids.tenantA,
      environment: "test",
    },
    run_id: ids.run,
    execution_id: sandboxExecutionId,
    idempotency_key: "ready-fixture-execution",
    budget:
      executionPermit.authorized.payload.artifact_type === "ExecutionPermit"
        ? executionPermit.authorized.payload.budget
        : null,
    language: "sql",
    payload: {
      dialect: "postgresql",
      sql_artifact_ref: sqlArtifactReference,
      execution_permit_ref: executionPermitReference,
      resource_admission_ref: resourceAdmission.receipt_ref,
      datasource_id: resourceAdmission.datasource_id,
      settings_hash: resourceAdmission.settings_hash,
      execution_settings: resourceAdmission.execution_settings,
      snapshot_requirement: {
        mode: "REQUIRE_REPLAYABLE",
      },
      parameters: sqlPayload.parameters,
    },
  });
  const sandboxInputHash = await computeSandboxExecutionRequestHash(sandboxRequest);
  const sandboxResultColumns = [
    { name: "dimension.region", type: "STRING" },
    { name: "metric.net_revenue", type: "NUMBER" },
  ] as const;
  const sandboxResultRows = [["华南", 100]] as const;
  const sandboxResultDraft = sandboxResultSchema.parse({
    schema_version: resourceAdmission.schema_version,
    result_ref: {
      artifact_id: authorityIds.sandboxResult,
      artifact_type: "SandboxResult",
      app_id: ids.appA,
      tenant_id: ids.tenantA,
      environment: "test",
      run_id: ids.run,
      revision: 1,
      content_hash: hashes.input,
    },
    scope: {
      app_id: ids.appA,
      tenant_id: ids.tenantA,
      environment: "test",
    },
    run_id: ids.run,
    execution_id: sandboxExecutionId,
    columns: sandboxResultColumns,
    rows: sandboxResultRows,
    row_count: 1,
    bytes: computeSandboxResultBytes({
      columns: sandboxResultColumns,
      rows: sandboxResultRows,
    }),
    result_hash: hashes.input,
  });
  const sandboxResultHash = await computeSandboxResultHash(sandboxResultDraft);
  const sandboxResult = sandboxResultSchema.parse({
    ...sandboxResultDraft,
    result_ref: {
      ...sandboxResultDraft.result_ref,
      content_hash: sandboxResultHash,
    },
    result_hash: sandboxResultHash,
  });
  const sandboxReceiptDraft = successfulSandboxExecutionReceiptSchema.parse({
    schema_version: resourceAdmission.schema_version,
    language: "sql",
    receipt_id: authorityIds.sandboxReceipt,
    receipt_ref: {
      artifact_id: authorityIds.sandboxReceipt,
      artifact_type: "SandboxExecutionReceipt",
      app_id: ids.appA,
      tenant_id: ids.tenantA,
      environment: "test",
      run_id: ids.run,
      revision: 1,
      content_hash: hashes.input,
    },
    scope: {
      app_id: ids.appA,
      tenant_id: ids.tenantA,
      environment: "test",
    },
    run_id: ids.run,
    execution_id: sandboxExecutionId,
    idempotency_key: sandboxRequest.idempotency_key,
    input_hash: sandboxInputHash,
    execution_hash: hashes.input,
    terminal: "COMPLETED",
    reason_code: "EXECUTION_COMPLETED",
    started_at: "2026-07-25T00:00:00.000Z",
    completed_at: "2026-07-25T00:00:00.001Z",
    result_artifact_ref: sandboxResult.result_ref,
    sql_artifact_ref: sqlArtifactReference,
    execution_permit_ref: executionPermitReference,
    resource_admission_ref: resourceAdmission.receipt_ref,
    datasource_id: resourceAdmission.datasource_id,
    settings_hash: resourceAdmission.settings_hash,
    execution_settings: resourceAdmission.execution_settings,
    transaction: {
      transaction_id: sandboxExecutionId,
      read_only: true,
      isolation_level: "REPEATABLE_READ",
    },
    authority_revalidation: {
      effective_principal_id: resourceAdmission.principal_id,
      policy_receipt_ref: resourceAdmission.policy_receipt_ref,
      revalidated_at: "2026-07-25T00:00:00.000Z",
      authority_epoch: 1,
    },
    snapshot_token: "snapshot-1",
    watermark: null,
    replay_state: "REPLAYABLE",
    resource_usage: {
      elapsed_ms: 1,
      rows: sandboxResult.row_count,
      bytes: sandboxResult.bytes,
      peak_memory_mb: 1,
    },
  });
  const sandboxReceiptHash = await computeSandboxExecutionReceiptHash(sandboxReceiptDraft);
  const sandboxReceipt = successfulSandboxExecutionReceiptSchema.parse({
    ...sandboxReceiptDraft,
    receipt_ref: {
      ...sandboxReceiptDraft.receipt_ref,
      content_hash: sandboxReceiptHash,
    },
    execution_hash: sandboxReceiptHash,
  });
  persistSystemArtifact(sandboxResult.result_ref, sandboxResult);
  persistSystemArtifact(sandboxReceipt.receipt_ref, sandboxReceipt);
  const sandboxReceiptReference = sandboxReceipt.receipt_ref;
  const sandboxResultReference = sandboxResult.result_ref;
  const execution = await commit(
    "ExecutionReceipt",
    authorityIds.execution,
    [
      sqlArtifactReference,
      executionPermit.reference,
      sandboxReceiptReference,
      sandboxResultReference,
    ],
    {
      artifact_type: "ExecutionReceipt",
      sql_artifact_ref: sqlArtifactReference,
      execution_permit_ref: executionPermit.reference,
      sandbox_execution_receipt_ref: sandboxReceiptReference,
      result_artifact_ref: sandboxResultReference,
      datasource_id: ids.appA,
      schema_version: resourceAdmission.schema_version,
      snapshot_token: "snapshot-1",
      watermark: null,
      observed_at: "2026-07-25T00:00:00.002Z",
      query_hash: queryHash,
      result_hash: sandboxResult.result_hash,
      replay_state: "REPLAYABLE",
      row_count: 1,
    },
  );
  const executionReference = artifactReferenceFor("ExecutionReceipt").parse(execution.reference);
  const resultInvariantIds = ["non_empty"];
  const resultOracleEvidence = {
    oracle_version: "result-oracle@1.0.0",
    query_hash: queryHash,
    result_hash: sandboxResult.result_hash,
    result_columns: sandboxResult.columns.map(({ name }) => name),
    row_count: sandboxResult.row_count,
    invariant_verdicts: [{ invariant_id: "non_empty", verdict: "PASS" as const }],
    oracle_verdict: "PASS" as const,
    result_artifact_ref: sandboxResultReference,
  };
  const resultOracleEvidenceHash = await computeResultOracleEvidenceHash(resultOracleEvidence);
  const resultOracleDraft = resultOracleReceiptSchema.parse({
    artifact_type: "ResultOracleReceipt",
    receipt_ref: {
      artifact_id: authorityIds.resultOracle,
      artifact_type: "ResultOracleReceipt",
      app_id: ids.appA,
      tenant_id: ids.tenantA,
      environment: "test",
      run_id: ids.run,
      revision: 1,
      content_hash: hashes.input,
    },
    scope: {
      app_id: ids.appA,
      tenant_id: ids.tenantA,
      environment: "test",
    },
    run_id: ids.run,
    sql_artifact_ref: sqlArtifactReference,
    execution_receipt_ref: executionReference,
    ...resultOracleEvidence,
    evidence_hash: resultOracleEvidenceHash,
    evaluated_at: "2026-07-25T00:00:00.003Z",
    receipt_hash: hashes.input,
  });
  const resultOracleHash = await computeResultOracleReceiptHash(resultOracleDraft);
  const resultOracle = resultOracleReceiptSchema.parse({
    ...resultOracleDraft,
    receipt_ref: {
      ...resultOracleDraft.receipt_ref,
      content_hash: resultOracleHash,
    },
    receipt_hash: resultOracleHash,
  });
  persistSystemArtifact(resultOracle.receipt_ref, resultOracle);
  const postExecutionGateInputs = [
    {
      gate: "EXECUTION" as const,
      artifactId: authorityIds.executionGate,
      observations: {
        query_hash: queryHash,
        sandbox_execution_hash: sandboxReceipt.execution_hash,
        elapsed_ms: sandboxReceipt.resource_usage.elapsed_ms,
        rows: sandboxResult.row_count,
        bytes: sandboxResult.bytes,
      },
      evidenceReferences: [sandboxReceiptReference, sandboxResultReference],
    },
    {
      gate: "RESULT" as const,
      artifactId: authorityIds.resultGate,
      observations: {
        result_hash: sandboxResult.result_hash,
        oracle_version: resultOracle.oracle_version,
        invariant_ids: resultInvariantIds,
        oracle_evidence_hash: resultOracle.evidence_hash,
      },
      evidenceReferences: [sandboxResultReference, resultOracle.receipt_ref],
    },
  ] as const;
  const postExecutionGates = await Promise.all(
    postExecutionGateInputs.map(async ({ gate, artifactId, observations, evidenceReferences }) =>
      commit(
        "GateReceipt",
        artifactId,
        [sqlArtifactReference, executionReference, ...evidenceReferences],
        await sealGateReceipt({
          artifact_type: "GateReceipt",
          sql_artifact_ref: sqlArtifactReference,
          execution_receipt_ref: executionReference,
          gate,
          gate_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
          evaluator_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
          evaluator_input_hash: hashes.input,
          evaluator_evaluation_hash: hashes.execution,
          verdict: "PASS",
          reason_code: TEXT2SQL_GATE_REASON_CODES[gate].PASS[0],
          evidence_refs: [...evidenceReferences],
          observations,
          evaluated_at: "2026-07-25T00:00:00.004Z",
        }),
      ),
    ),
  );
  const allGates = [...preExecutionGates, ...postExecutionGates];
  const validation = await commit(
    "ValidationReceipt",
    authorityIds.validation,
    [sqlArtifactReference, executionReference, ...allGates.map(({ reference }) => reference)],
    {
      artifact_type: "ValidationReceipt",
      sql_artifact_ref: sqlArtifactReference,
      execution_receipt_ref: executionReference,
      gate_receipt_refs: allGates.map(({ reference }) => reference),
      validation_version: TEXT2SQL_VALIDATION_VERSION,
      sealed_at: "2026-07-25T00:00:00.005Z",
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
      result_hash: sandboxResult.result_hash,
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
      resourceAdmission: resourceAdmission.receipt_ref,
      sandboxReceipt: sandboxReceiptReference,
      sandboxResult: sandboxResultReference,
      resultOracle: resultOracle.receipt_ref,
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
