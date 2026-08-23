import {
  type ArtifactReference,
  artifactReferenceFor,
  artifactReferenceIdentity,
  computeFixtureMutationRecordHash,
  computeGateEvaluationHash,
  computeGateInputHash,
  computeGroundingAuthorityDocumentHash,
  computeGroundingHash,
  computeL2ArtifactContentHash,
  computeMetamorphicFixtureEvidenceHash,
  computeMetamorphicFixtureReceiptHash,
  computeMetamorphicOracleEvidenceHash,
  computeMetamorphicOracleReceiptHash,
  computeMetamorphicRelationSampleHash,
  computePostgresqlExecutionSettingsHash,
  computeResourceAdmissionReceiptHash,
  computeResourceEstimateHash,
  computeResultOracleEvidenceHash,
  computeResultOracleReceiptHash,
  computeSqlArtifactQueryHash,
  fixtureMutationRecordSchema,
  type GateReceiptPayload,
  gateReceiptSchema,
  groundingAuthorityDocumentSchema,
  type L2ArtifactDocument,
  type L2ArtifactPersistenceAuthority,
  l2ArtifactDocumentSchema,
  metamorphicFixtureReceiptSchema,
  metamorphicOracleReceiptSchema,
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
  authorizeSandboxExecutionReceipt,
  authorizeSandboxResult,
  computeSandboxExecutionReceiptHash,
  computeSandboxExecutionRequestHash,
  computeSandboxResultBytes,
  computeSandboxResultHash,
  type SandboxResult,
  sandboxExecutionRequestSchema,
  sandboxResultSchema,
  successfulSandboxExecutionReceiptSchema,
} from "../src/ports/sandbox.js";
import {
  authorizeMetamorphicFixtureReceipt,
  authorizeMetamorphicOracleReceipt,
  authorizeResultOracleReceipt,
  createMetamorphicFixtureAuthority,
  createMetamorphicOracleAuthority,
  createResultOracleReceiptAuthority,
  registerSandboxServerAuthority,
} from "../src/server.js";
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
  metamorphicOracle: "00000000-0000-4000-8000-000000000138",
  fanOutCase: "00000000-0000-4000-8000-000000000139",
  fanOutReceipt: "00000000-0000-4000-8000-000000000140",
  fanOutResult: "00000000-0000-4000-8000-000000000141",
  nullAntiCase: "00000000-0000-4000-8000-000000000142",
  nullAntiReceipt: "00000000-0000-4000-8000-000000000143",
  nullAntiResult: "00000000-0000-4000-8000-000000000144",
  partitionCase: "00000000-0000-4000-8000-000000000145",
  leftPartitionReceipt: "00000000-0000-4000-8000-000000000146",
  leftPartitionResult: "00000000-0000-4000-8000-000000000147",
  rightPartitionReceipt: "00000000-0000-4000-8000-000000000148",
  rightPartitionResult: "00000000-0000-4000-8000-000000000149",
  distinctFactCase: "00000000-0000-4000-8000-000000000150",
  distinctFactReceipt: "00000000-0000-4000-8000-000000000151",
  distinctFactResult: "00000000-0000-4000-8000-000000000152",
  metamorphicFixture: "00000000-0000-4000-8000-000000000153",
  fanOutMutation: "00000000-0000-4000-8000-000000000154",
  nullAntiMutation: "00000000-0000-4000-8000-000000000155",
  distinctFactMutation: "00000000-0000-4000-8000-000000000156",
  fanOutProbeReceipt: "00000000-0000-4000-8000-000000000157",
  fanOutProbeResult: "00000000-0000-4000-8000-000000000158",
  nullAntiProbeReceipt: "00000000-0000-4000-8000-000000000159",
  nullAntiProbeResult: "00000000-0000-4000-8000-000000000160",
  partitionProbeReceipt: "00000000-0000-4000-8000-000000000161",
  partitionProbeResult: "00000000-0000-4000-8000-000000000162",
  distinctFactProbeReceipt: "00000000-0000-4000-8000-000000000163",
  distinctFactProbeResult: "00000000-0000-4000-8000-000000000164",
  leftPartitionSqlArtifact: "00000000-0000-4000-8000-000000000165",
  leftPartitionExecutionPermit: "00000000-0000-4000-8000-000000000166",
  leftPartitionResourceAdmission: "00000000-0000-4000-8000-000000000167",
  rightPartitionSqlArtifact: "00000000-0000-4000-8000-000000000168",
  rightPartitionExecutionPermit: "00000000-0000-4000-8000-000000000169",
  rightPartitionResourceAdmission: "00000000-0000-4000-8000-000000000170",
  failingMetamorphicOracle: "00000000-0000-4000-8000-000000000171",
  failingResultOracle: "00000000-0000-4000-8000-000000000172",
  failingResultGate: "00000000-0000-4000-8000-000000000173",
  failingMetamorphicFixture: "00000000-0000-4000-8000-000000000174",
  failingFanOutReceipt: "00000000-0000-4000-8000-000000000175",
  failingFanOutResult: "00000000-0000-4000-8000-000000000176",
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

const metamorphicAuthorityIdentities = {
  FIXTURE_MUTATION: {
    authority_id: "00000000-0000-4000-8000-000000000601",
    principal_id: "fixture-mutation-principal",
    key_id: "fixture-mutation-key@1",
  },
  SANDBOX_EXECUTION: {
    authority_id: "00000000-0000-4000-8000-000000000602",
    principal_id: "sandbox-execution-principal",
    key_id: "sandbox-execution-key@1",
  },
  METAMORPHIC_VERIFIER: {
    authority_id: "00000000-0000-4000-8000-000000000603",
    principal_id: "metamorphic-verifier-principal",
    key_id: "metamorphic-verifier-key@1",
  },
  RESULT_PRODUCER: {
    authority_id: "00000000-0000-4000-8000-000000000604",
    principal_id: "result-producer-principal",
    key_id: "result-producer-key@1",
  },
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

export type AuthoritativeReadyFixtureOptions = {
  readonly authorityPolicyInjection?: "FIXTURE_ALWAYS_TRUE";
  readonly fixtureIssuedAt?: string;
  readonly halfOpenQueryVariantBindings?: "DISTINCT" | "REUSE_BASELINE" | "SWAP";
  readonly mutationRecordBinding?: "EXACT" | "FAN_OUT_WRONG_CASE";
  readonly metamorphicEvaluatedAt?: string;
  readonly resultResolverMode?: "REUSE_RESOLVED_META" | "REAUTHORIZE_META";
  readonly metamorphicSnapshotTokens?: Partial<{
    readonly baseline: string;
    readonly fanOut: string;
    readonly nullAnti: string;
    readonly leftPartition: string;
    readonly rightPartition: string;
    readonly distinctFact: string;
  }>;
  readonly selectionProbeSnapshotTokens?: Partial<{
    readonly fanOut: string;
    readonly nullAnti: string;
    readonly partition: string;
    readonly distinctFact: string;
  }>;
};

export async function createAuthoritativeReadyFixture(
  options: AuthoritativeReadyFixtureOptions = {},
) {
  const baselineSnapshotToken = options.metamorphicSnapshotTokens?.baseline ?? "snapshot-1";
  const metamorphicSnapshotTokens = {
    baseline: baselineSnapshotToken,
    fanOut: "snapshot-fan-out",
    nullAnti: "snapshot-null-anti",
    leftPartition: baselineSnapshotToken,
    rightPartition: baselineSnapshotToken,
    distinctFact: "snapshot-distinct-fact",
    ...options.metamorphicSnapshotTokens,
  };
  const selectionProbeSnapshotTokens = {
    fanOut: metamorphicSnapshotTokens.fanOut,
    nullAnti: metamorphicSnapshotTokens.nullAnti,
    partition: metamorphicSnapshotTokens.baseline,
    distinctFact: metamorphicSnapshotTokens.distinctFact,
    ...options.selectionProbeSnapshotTokens,
  };
  const halfOpenQueryVariantBindings = options.halfOpenQueryVariantBindings ?? "DISTINCT";
  const documents = new Map<string, L2ArtifactDocument>();
  const groundingAuthorityDocuments = new Map<string, unknown>();
  const systemArtifacts = new Map<string, unknown>();
  const authorityRevisions = new Map<string, unknown>();
  const sandboxExecutionRecords = new Map<string, unknown>();
  const persistedReferences = new Set<string>();
  let expectedSqlArtifactPayload: unknown = null;
  let authoritativeExecutionPermitPayload: unknown = null;
  let resolveAuthoritativeMetamorphicFixtureReceipt: NonNullable<
    L2ArtifactPersistenceAuthority["resolveAuthoritativeMetamorphicFixtureReceipt"]
  > = async () => null;
  let resolveAuthoritativeMetamorphicOracleReceipt: NonNullable<
    L2ArtifactPersistenceAuthority["resolveAuthoritativeMetamorphicOracleReceipt"]
  > = async () => null;
  let resolveAuthoritativeResultOracleReceipt: NonNullable<
    L2ArtifactPersistenceAuthority["resolveAuthoritativeResultOracleReceipt"]
  > = async () => null;
  let resolveAuthoritativeSandboxExecutionReceipt: NonNullable<
    L2ArtifactPersistenceAuthority["resolveAuthoritativeSandboxExecutionReceipt"]
  > = async () => null;
  let resolveAuthoritativeSandboxResult: NonNullable<
    L2ArtifactPersistenceAuthority["resolveAuthoritativeSandboxResult"]
  > = async () => null;
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
    resolveAuthoritativeMetamorphicFixtureReceipt: (reference) =>
      resolveAuthoritativeMetamorphicFixtureReceipt(reference),
    resolveAuthoritativeMetamorphicOracleReceipt: (reference) =>
      resolveAuthoritativeMetamorphicOracleReceipt(reference),
    resolveAuthoritativeResultOracleReceipt: (reference, metamorphic) =>
      resolveAuthoritativeResultOracleReceipt(reference, metamorphic),
    resolveAuthoritativeSandboxExecutionReceipt: (reference) =>
      resolveAuthoritativeSandboxExecutionReceipt(reference),
    resolveAuthoritativeSandboxResult: (reference) => resolveAuthoritativeSandboxResult(reference),
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
      const verified = await verifyL2ArtifactDocument(committed, authority, {
        mode: "HISTORICAL_READ_ONLY",
      });
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
    origin: {
      origin: "published",
      published_version: "test-fixture@1.0.0",
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
          data_type: "integer",
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
    compiler_version: "postgresql-compiler@1.1.0",
    ast_hash: hashes.artifact,
    dialect: "postgresql" as const,
    sql: [
      'SELECT "orders"."region" AS "dimension.region",',
      '       pg_catalog.SUM("orders"."net_revenue") AS "metric.net_revenue"',
      'FROM "orders"',
      'WHERE "orders"."created_at" OPERATOR(pg_catalog.>=) $1::pg_catalog.timestamptz',
      '  AND "orders"."created_at" OPERATOR(pg_catalog.<) $2::pg_catalog.timestamptz',
      'GROUP BY "orders"."region"',
    ].join("\n"),
    parameters: {
      $1: "2025-01-01T00:00:00.000+08:00",
      $2: "2025-04-01T00:00:00.000+08:00",
    },
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
  authorityRevisions.set(
    artifactReferenceIdentity(sqlArtifactReference),
    structuredClone(expectedSqlArtifactPayload),
  );
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
        compiler_version: "postgresql-compiler@1.1.0",
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
  authoritativeExecutionPermitPayload = executionPermit.authorized.payload;
  authorityRevisions.set(
    artifactReferenceIdentity(executionPermitReference),
    structuredClone(authoritativeExecutionPermitPayload),
  );
  if (executionPermit.authorized.payload.artifact_type !== "ExecutionPermit") {
    throw new TypeError("权威 Gate Fixture 缺少 ExecutionPermit Payload。");
  }
  async function createHalfOpenAuthorityVariant(input: {
    readonly label: "left-half-open" | "right-half-open";
    readonly sqlArtifactId: string;
    readonly executionPermitId: string;
    readonly resourceAdmissionId: string;
  }) {
    const sqlMaterial = {
      dialect: sqlPayload.dialect,
      sql: sqlPayload.sql,
      parameters: {
        ...sqlPayload.parameters,
        $1:
          input.label === "left-half-open"
            ? "2025-01-01T00:00:00.000+08:00"
            : "2025-02-01T00:00:00.000+08:00",
        $2:
          input.label === "left-half-open"
            ? "2025-02-01T00:00:00.000+08:00"
            : "2025-04-01T00:00:00.000+08:00",
      },
    } as const;
    const variantSqlPayload = {
      ...sqlPayload,
      ...sqlMaterial,
      ast_hash: sqlPayload.ast_hash,
      query_hash: await computeSqlArtifactQueryHash(sqlMaterial),
    };
    const variantSqlReference = artifactReferenceFor("SqlArtifact").parse({
      ...sqlArtifactReference,
      artifact_id: input.sqlArtifactId,
      content_hash: await sha256ContentHash(variantSqlPayload),
    });
    const variantResourceAdmissionReference = artifactReferenceFor(
      "ResourceAdmissionReceipt",
    ).parse({
      ...resourceAdmission.receipt_ref,
      artifact_id: input.resourceAdmissionId,
      content_hash: await sha256ContentHash({
        baseline_receipt_hash: resourceAdmission.receipt_hash,
        variant: input.label,
      }),
    });
    const variantExecutionPermitPayload = {
      ...executionPermit.authorized.payload,
      sql_artifact_ref: variantSqlReference,
      resource_admission_ref: variantResourceAdmissionReference,
    };
    const variantExecutionPermitReference = artifactReferenceFor("ExecutionPermit").parse({
      ...executionPermitReference,
      artifact_id: input.executionPermitId,
      content_hash: await sha256ContentHash(variantExecutionPermitPayload),
    });
    authorityRevisions.set(
      artifactReferenceIdentity(variantSqlReference),
      structuredClone(variantSqlPayload),
    );
    authorityRevisions.set(
      artifactReferenceIdentity(variantExecutionPermitReference),
      structuredClone(variantExecutionPermitPayload),
    );
    return {
      sql_artifact_ref: variantSqlReference,
      sql_artifact: variantSqlPayload,
      execution_permit_ref: variantExecutionPermitReference,
      execution_permit: variantExecutionPermitPayload,
      resource_admission_ref: variantResourceAdmissionReference,
    };
  }
  const leftHalfOpenVariant = await createHalfOpenAuthorityVariant({
    label: "left-half-open",
    sqlArtifactId: authorityIds.leftPartitionSqlArtifact,
    executionPermitId: authorityIds.leftPartitionExecutionPermit,
    resourceAdmissionId: authorityIds.leftPartitionResourceAdmission,
  });
  const rightHalfOpenVariant = await createHalfOpenAuthorityVariant({
    label: "right-half-open",
    sqlArtifactId: authorityIds.rightPartitionSqlArtifact,
    executionPermitId: authorityIds.rightPartitionExecutionPermit,
    resourceAdmissionId: authorityIds.rightPartitionResourceAdmission,
  });
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
    { name: "metric.net_revenue", type: "INTEGER" },
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
    executor: metamorphicAuthorityIdentities.SANDBOX_EXECUTION,
    executor_role: "SANDBOX_EXECUTION",
    authority_role_policy_version: "authority_role_policy@1.0.0",
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
    snapshot_token: metamorphicSnapshotTokens.baseline,
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
  sandboxExecutionRecords.set(sandboxInputHash, {
    request: sandboxRequest,
    started_at: sandboxReceipt.started_at,
    completed_at: sandboxReceipt.completed_at,
    result_artifact_ref: sandboxResult.result_ref,
    datasource_id: sandboxReceipt.datasource_id,
    schema_version: sandboxReceipt.schema_version,
    settings_hash: sandboxReceipt.settings_hash,
    applied_execution_settings: sandboxReceipt.execution_settings,
    transaction: sandboxReceipt.transaction,
    authority_revalidation: sandboxReceipt.authority_revalidation,
    snapshot: {
      snapshot_token: sandboxReceipt.snapshot_token,
      watermark: sandboxReceipt.watermark,
      replay_state: sandboxReceipt.replay_state,
    },
    resource_usage: sandboxReceipt.resource_usage,
  });
  const resolveAuthorityRevision = async (
    reference: ArtifactReference,
  ): Promise<unknown | null> => {
    const identity = artifactReferenceIdentity(reference);
    const l2Document = documents.get(identity);
    return structuredClone(
      authorityRevisions.get(identity) ??
        systemArtifacts.get(identity) ??
        l2Document?.payload ??
        null,
    );
  };
  const verifyAuthorityRevisionCommitted = async (reference: ArtifactReference): Promise<boolean> =>
    authorityRevisions.has(artifactReferenceIdentity(reference)) ||
    systemArtifacts.has(artifactReferenceIdentity(reference)) ||
    documents.has(artifactReferenceIdentity(reference));
  const verifyExactAuthorityRevision = async (
    reference: ArtifactReference,
    artifact: unknown,
  ): Promise<boolean> => {
    const stored = await resolveAuthorityRevision(reference);
    return stored !== null && canonicalizeJson(stored) === canonicalizeJson(artifact);
  };
  const sandboxAuthority = registerSandboxServerAuthority({
    identity: metamorphicAuthorityIdentities.SANDBOX_EXECUTION,
    resolveCommitted: resolveAuthorityRevision,
    verifyCommitted: verifyAuthorityRevisionCommitted,
    resolveAuthoritativeExecutionPermit: async (reference) =>
      structuredClone(authorityRevisions.get(artifactReferenceIdentity(reference)) ?? null),
    resolveAuthoritativeSqlArtifact: async (reference) =>
      structuredClone(authorityRevisions.get(artifactReferenceIdentity(reference)) ?? null),
    verifyExactArtifactRevision: verifyExactAuthorityRevision,
    revalidateExecutionAuthority: async (input) => ({
      effective_principal_id: input.effective_principal_id,
      policy_receipt_ref: input.policy_receipt_ref,
      revalidated_at: input.transaction_started_at,
      authority_epoch: 1,
    }),
    assertAuthorityFence: async () => true,
    withSqlTransaction: async (operation) => operation(),
    claimOrLoadExecution: async (_claim, operation) => ({
      status: "EXECUTED",
      value: await operation(),
    }),
    resolveExecutionRecord: async (inputHash) =>
      structuredClone(sandboxExecutionRecords.get(inputHash) ?? null),
    now: () => new Date("2026-07-25T00:00:00.000Z"),
  });
  resolveAuthoritativeSandboxExecutionReceipt = (reference) =>
    authorizeSandboxExecutionReceipt(reference, sandboxAuthority);
  resolveAuthoritativeSandboxResult = (reference) =>
    authorizeSandboxResult(reference, sandboxAuthority);
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
      snapshot_token: metamorphicSnapshotTokens.baseline,
      watermark: null,
      observed_at: "2026-07-25T00:00:00.002Z",
      query_hash: queryHash,
      result_hash: sandboxResult.result_hash,
      replay_state: "REPLAYABLE",
      row_count: 1,
    },
  );
  const executionReference = artifactReferenceFor("ExecutionReceipt").parse(execution.reference);

  async function createMetamorphicSandboxEvidence(input: {
    readonly receiptId: string;
    readonly resultId: string;
    readonly idempotencyKey: string;
    readonly snapshotToken: string;
    readonly columns?: SandboxResult["columns"];
    readonly rows: SandboxResult["rows"];
    readonly sql_artifact_ref?: ArtifactReference & { readonly artifact_type: "SqlArtifact" };
    readonly execution_permit_ref?: ArtifactReference & {
      readonly artifact_type: "ExecutionPermit";
    };
    readonly resource_admission_ref?: ArtifactReference & {
      readonly artifact_type: "ResourceAdmissionReceipt";
    };
  }) {
    const evidenceSqlArtifactReference = input.sql_artifact_ref ?? sqlArtifactReference;
    const evidenceExecutionPermitReference = input.execution_permit_ref ?? executionPermitReference;
    const evidenceResourceAdmissionReference =
      input.resource_admission_ref ?? resourceAdmission.receipt_ref;
    const evidenceColumns = input.columns ?? sandboxResultColumns;
    const evidenceParameters =
      artifactReferenceIdentity(evidenceSqlArtifactReference) ===
      artifactReferenceIdentity(leftHalfOpenVariant.sql_artifact_ref)
        ? leftHalfOpenVariant.sql_artifact.parameters
        : artifactReferenceIdentity(evidenceSqlArtifactReference) ===
            artifactReferenceIdentity(rightHalfOpenVariant.sql_artifact_ref)
          ? rightHalfOpenVariant.sql_artifact.parameters
          : sqlPayload.parameters;
    const request = sandboxExecutionRequestSchema.parse({
      ...sandboxRequest,
      execution_id: input.receiptId,
      idempotency_key: input.idempotencyKey,
      payload: {
        ...sandboxRequest.payload,
        sql_artifact_ref: evidenceSqlArtifactReference,
        execution_permit_ref: evidenceExecutionPermitReference,
        resource_admission_ref: evidenceResourceAdmissionReference,
        parameters: evidenceParameters,
      },
    });
    const inputHash = await computeSandboxExecutionRequestHash(request);
    const resultDraft = sandboxResultSchema.parse({
      schema_version: resourceAdmission.schema_version,
      result_ref: {
        artifact_id: input.resultId,
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
      execution_id: input.receiptId,
      columns: evidenceColumns,
      rows: input.rows,
      row_count: input.rows.length,
      bytes: computeSandboxResultBytes({
        columns: evidenceColumns,
        rows: input.rows,
      }),
      result_hash: hashes.input,
    });
    const resultHash = await computeSandboxResultHash(resultDraft);
    const result = sandboxResultSchema.parse({
      ...resultDraft,
      result_ref: {
        ...resultDraft.result_ref,
        content_hash: resultHash,
      },
      result_hash: resultHash,
    });
    const receiptDraft = successfulSandboxExecutionReceiptSchema.parse({
      schema_version: resourceAdmission.schema_version,
      language: "sql",
      executor: metamorphicAuthorityIdentities.SANDBOX_EXECUTION,
      executor_role: "SANDBOX_EXECUTION",
      authority_role_policy_version: "authority_role_policy@1.0.0",
      receipt_id: input.receiptId,
      receipt_ref: {
        artifact_id: input.receiptId,
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
      execution_id: input.receiptId,
      idempotency_key: input.idempotencyKey,
      input_hash: inputHash,
      execution_hash: hashes.input,
      terminal: "COMPLETED",
      reason_code: "EXECUTION_COMPLETED",
      started_at: "2026-07-25T00:00:00.002Z",
      completed_at: "2026-07-25T00:00:00.003Z",
      result_artifact_ref: result.result_ref,
      sql_artifact_ref: evidenceSqlArtifactReference,
      execution_permit_ref: evidenceExecutionPermitReference,
      resource_admission_ref: evidenceResourceAdmissionReference,
      datasource_id: resourceAdmission.datasource_id,
      settings_hash: resourceAdmission.settings_hash,
      execution_settings: resourceAdmission.execution_settings,
      transaction: {
        transaction_id: input.receiptId,
        read_only: true,
        isolation_level: "REPEATABLE_READ",
      },
      authority_revalidation: {
        effective_principal_id: resourceAdmission.principal_id,
        policy_receipt_ref: resourceAdmission.policy_receipt_ref,
        revalidated_at: "2026-07-25T00:00:00.002Z",
        authority_epoch: 1,
      },
      snapshot_token: input.snapshotToken,
      watermark: null,
      replay_state: "REPLAYABLE",
      resource_usage: {
        elapsed_ms: 1,
        rows: result.row_count,
        bytes: result.bytes,
        peak_memory_mb: 1,
      },
    });
    const receiptHash = await computeSandboxExecutionReceiptHash(receiptDraft);
    const receipt = successfulSandboxExecutionReceiptSchema.parse({
      ...receiptDraft,
      receipt_ref: {
        ...receiptDraft.receipt_ref,
        content_hash: receiptHash,
      },
      execution_hash: receiptHash,
    });
    persistSystemArtifact(result.result_ref, result);
    persistSystemArtifact(receipt.receipt_ref, receipt);
    sandboxExecutionRecords.set(inputHash, {
      request,
      started_at: receipt.started_at,
      completed_at: receipt.completed_at,
      result_artifact_ref: result.result_ref,
      datasource_id: receipt.datasource_id,
      schema_version: receipt.schema_version,
      settings_hash: receipt.settings_hash,
      applied_execution_settings: receipt.execution_settings,
      transaction: receipt.transaction,
      authority_revalidation: receipt.authority_revalidation,
      snapshot: {
        snapshot_token: receipt.snapshot_token,
        watermark: receipt.watermark,
        replay_state: receipt.replay_state,
      },
      resource_usage: receipt.resource_usage,
    });
    return {
      evidence: {
        sandbox_execution_receipt_ref: receipt.receipt_ref,
        result_artifact_ref: result.result_ref,
      },
      input_hash: inputHash,
    };
  }

  const fanOutFollowUp = await createMetamorphicSandboxEvidence({
    receiptId: authorityIds.fanOutReceipt,
    resultId: authorityIds.fanOutResult,
    idempotencyKey: "ready-fixture-metamorphic-fan-out",
    snapshotToken: metamorphicSnapshotTokens.fanOut,
    rows: [["华南", 100]],
  });
  const nullAntiFollowUp = await createMetamorphicSandboxEvidence({
    receiptId: authorityIds.nullAntiReceipt,
    resultId: authorityIds.nullAntiResult,
    idempotencyKey: "ready-fixture-metamorphic-null-anti",
    snapshotToken: metamorphicSnapshotTokens.nullAnti,
    rows: [["华南", 100]],
  });
  const leftPartition = await createMetamorphicSandboxEvidence({
    receiptId: authorityIds.leftPartitionReceipt,
    resultId: authorityIds.leftPartitionResult,
    idempotencyKey: "ready-fixture-metamorphic-left-partition",
    snapshotToken: metamorphicSnapshotTokens.leftPartition,
    rows: [["华南", 40]],
    ...(halfOpenQueryVariantBindings === "REUSE_BASELINE"
      ? {}
      : {
          sql_artifact_ref:
            halfOpenQueryVariantBindings === "SWAP"
              ? rightHalfOpenVariant.sql_artifact_ref
              : leftHalfOpenVariant.sql_artifact_ref,
          execution_permit_ref:
            halfOpenQueryVariantBindings === "SWAP"
              ? rightHalfOpenVariant.execution_permit_ref
              : leftHalfOpenVariant.execution_permit_ref,
          resource_admission_ref:
            halfOpenQueryVariantBindings === "SWAP"
              ? rightHalfOpenVariant.resource_admission_ref
              : leftHalfOpenVariant.resource_admission_ref,
        }),
  });
  const rightPartition = await createMetamorphicSandboxEvidence({
    receiptId: authorityIds.rightPartitionReceipt,
    resultId: authorityIds.rightPartitionResult,
    idempotencyKey: "ready-fixture-metamorphic-right-partition",
    snapshotToken: metamorphicSnapshotTokens.rightPartition,
    rows: [["华南", 60]],
    ...(halfOpenQueryVariantBindings === "REUSE_BASELINE"
      ? {}
      : {
          sql_artifact_ref:
            halfOpenQueryVariantBindings === "SWAP"
              ? leftHalfOpenVariant.sql_artifact_ref
              : rightHalfOpenVariant.sql_artifact_ref,
          execution_permit_ref:
            halfOpenQueryVariantBindings === "SWAP"
              ? leftHalfOpenVariant.execution_permit_ref
              : rightHalfOpenVariant.execution_permit_ref,
          resource_admission_ref:
            halfOpenQueryVariantBindings === "SWAP"
              ? leftHalfOpenVariant.resource_admission_ref
              : rightHalfOpenVariant.resource_admission_ref,
        }),
  });
  const distinctFactFollowUp = await createMetamorphicSandboxEvidence({
    receiptId: authorityIds.distinctFactReceipt,
    resultId: authorityIds.distinctFactResult,
    idempotencyKey: "ready-fixture-metamorphic-distinct-fact",
    snapshotToken: metamorphicSnapshotTokens.distinctFact,
    rows: [["华南", 125]],
  });
  const fanOutSelectionProbe = await createMetamorphicSandboxEvidence({
    receiptId: authorityIds.fanOutProbeReceipt,
    resultId: authorityIds.fanOutProbeResult,
    idempotencyKey: "ready-fixture-selection-fan-out",
    snapshotToken: selectionProbeSnapshotTokens.fanOut,
    columns: [
      { name: "fact_key", type: "STRING" },
      { name: "dimension.region", type: "STRING" },
      { name: "measure_minor_units", type: "INTEGER" },
    ],
    rows: [["order-100", "华南", 100]],
  });
  const nullAntiSelectionProbe = await createMetamorphicSandboxEvidence({
    receiptId: authorityIds.nullAntiProbeReceipt,
    resultId: authorityIds.nullAntiProbeResult,
    idempotencyKey: "ready-fixture-selection-null-anti",
    snapshotToken: selectionProbeSnapshotTokens.nullAnti,
    columns: [
      { name: "probe_key", type: "STRING" },
      { name: "dimension.region", type: "STRING" },
      { name: "measure_minor_units", type: "INTEGER" },
    ],
    rows: [["customer-eligible", "华南", 100]],
  });
  const partitionSelectionProbe = await createMetamorphicSandboxEvidence({
    receiptId: authorityIds.partitionProbeReceipt,
    resultId: authorityIds.partitionProbeResult,
    idempotencyKey: "ready-fixture-selection-partition",
    snapshotToken: selectionProbeSnapshotTokens.partition,
    columns: [
      { name: "boundary_fact_key", type: "STRING" },
      { name: "dimension.region", type: "STRING" },
      { name: "occurred_at", type: "STRING" },
      { name: "measure_minor_units", type: "INTEGER" },
    ],
    rows: [["order-at-midpoint", "华南", "2025-02-01T00:00:00.000+08:00", 60]],
  });
  const distinctFactSelectionProbe = await createMetamorphicSandboxEvidence({
    receiptId: authorityIds.distinctFactProbeReceipt,
    resultId: authorityIds.distinctFactProbeResult,
    idempotencyKey: "ready-fixture-selection-distinct-fact",
    snapshotToken: selectionProbeSnapshotTokens.distinctFact,
    columns: [
      { name: "original_fact_key", type: "STRING" },
      { name: "dimension.region", type: "STRING" },
      { name: "occurred_at", type: "STRING" },
      { name: "measure_minor_units", type: "INTEGER" },
    ],
    rows: [["order-original", "华南", "2025-02-10T00:00:00.000+08:00", 25]],
  });
  const fixtureWitnesses = {
    fanOut: {
      fact_key: "order-100",
      group_key: '["华南"]',
      join_path: ["orders.order_items"],
      original_child_key: "line-100",
      added_child_key: "line-101",
      measure_minor_units: 100,
      baseline_multiplicity: 1,
      follow_up_multiplicity: 2,
    },
    nullAnti: {
      probe_key: "customer-eligible",
      inserted_null_row_key: "anti-row-null",
      group_key: '["华南"]',
      measure_minor_units: 100,
    },
    partition: {
      group_key: '["华南"]',
      start_at: "2025-01-01T00:00:00.000+08:00",
      midpoint_at: "2025-02-01T00:00:00.000+08:00",
      end_at: "2025-04-01T00:00:00.000+08:00",
      boundary_fact_key: "order-at-midpoint",
      boundary_measure_minor_units: 60,
    },
    distinctFact: {
      original_fact_key: "order-original",
      added_fact_key: "order-same-valued",
      group_key: '["华南"]',
      occurred_at: "2025-02-10T00:00:00.000+08:00",
      measure_minor_units: 25,
    },
  } as const;
  async function persistMutationRecord(
    artifactId: string,
    relationKind: "FAN_OUT" | "NULL_ANTI_MEMBERSHIP" | "SAME_VALUED_DISTINCT_FACT",
    caseId: string,
    followUpSnapshotId: string,
    witness: unknown,
  ) {
    const record = fixtureMutationRecordSchema.parse({
      artifact_type: "FixtureMutationRecord",
      scope: {
        app_id: ids.appA,
        tenant_id: ids.tenantA,
        environment: "test",
      },
      run_id: ids.run,
      relation_kind: relationKind,
      case_id:
        options.mutationRecordBinding === "FAN_OUT_WRONG_CASE" && relationKind === "FAN_OUT"
          ? authorityIds.nullAntiCase
          : caseId,
      baseline_snapshot_id: metamorphicSnapshotTokens.baseline,
      follow_up_snapshot_id: followUpSnapshotId,
      witness,
    });
    const descriptorHash = await computeFixtureMutationRecordHash(record);
    const reference = artifactReferenceFor("FixtureMutationRecord").parse({
      artifact_id: artifactId,
      artifact_type: "FixtureMutationRecord",
      app_id: ids.appA,
      tenant_id: ids.tenantA,
      environment: "test",
      run_id: ids.run,
      revision: 1,
      content_hash: descriptorHash,
    });
    persistSystemArtifact(reference, record);
    return { descriptorHash, reference };
  }
  const fanOutMutation = await persistMutationRecord(
    authorityIds.fanOutMutation,
    "FAN_OUT",
    authorityIds.fanOutCase,
    metamorphicSnapshotTokens.fanOut,
    fixtureWitnesses.fanOut,
  );
  const nullAntiMutation = await persistMutationRecord(
    authorityIds.nullAntiMutation,
    "NULL_ANTI_MEMBERSHIP",
    authorityIds.nullAntiCase,
    metamorphicSnapshotTokens.nullAnti,
    fixtureWitnesses.nullAnti,
  );
  const distinctFactMutation = await persistMutationRecord(
    authorityIds.distinctFactMutation,
    "SAME_VALUED_DISTINCT_FACT",
    authorityIds.distinctFactCase,
    metamorphicSnapshotTokens.distinctFact,
    fixtureWitnesses.distinctFact,
  );
  const fixtureEvidence = {
    sql_artifact_ref: sqlArtifactReference,
    query_contract_ref: queryContract.reference,
    grounding_package_ref: groundingPackage.reference,
    logical_plan_ref: logicalPlan.reference,
    oracle_id: "additive-integer",
    oracle_version: "additive-integer@1",
    fixture_id: "retail-additive",
    fixture_version: "retail-additive@1",
    issuer: metamorphicAuthorityIdentities.FIXTURE_MUTATION,
    issuer_role: "FIXTURE_MUTATION",
    authority_role_policy_version: "authority_role_policy@1.0.0",
    applicability_profile: {
      suite: "ADDITIVE_INTEGER_V1",
      aggregate_kind: "sum",
      distinct: false,
      source_measure_data_type: "integer",
      result_data_type: "INTEGER",
      metric_id: "metric.net_revenue",
      dimension_ids: ["dimension.region"],
      group_key_arity: 1,
    },
    baseline: {
      snapshot_id: metamorphicSnapshotTokens.baseline,
      execution_input_hash: sandboxInputHash,
    },
    cases: [
      {
        relation_kind: "FAN_OUT",
        case_id: authorityIds.fanOutCase,
        follow_up_snapshot_id: metamorphicSnapshotTokens.fanOut,
        follow_up_execution_input_hash: fanOutFollowUp.input_hash,
        selection_probe: fanOutSelectionProbe.evidence,
        selection_probe_input_hash: fanOutSelectionProbe.input_hash,
        mutation_record_ref: fanOutMutation.reference,
        mutation_descriptor_hash: fanOutMutation.descriptorHash,
        witness: fixtureWitnesses.fanOut,
      },
      {
        relation_kind: "NULL_ANTI_MEMBERSHIP",
        case_id: authorityIds.nullAntiCase,
        follow_up_snapshot_id: metamorphicSnapshotTokens.nullAnti,
        follow_up_execution_input_hash: nullAntiFollowUp.input_hash,
        selection_probe: nullAntiSelectionProbe.evidence,
        selection_probe_input_hash: nullAntiSelectionProbe.input_hash,
        mutation_record_ref: nullAntiMutation.reference,
        mutation_descriptor_hash: nullAntiMutation.descriptorHash,
        witness: fixtureWitnesses.nullAnti,
      },
      {
        relation_kind: "HALF_OPEN_ADDITIVE_PARTITION",
        case_id: authorityIds.partitionCase,
        snapshot_id: metamorphicSnapshotTokens.baseline,
        whole_execution_input_hash: sandboxInputHash,
        left_execution_input_hash: leftPartition.input_hash,
        right_execution_input_hash: rightPartition.input_hash,
        selection_probe: partitionSelectionProbe.evidence,
        selection_probe_input_hash: partitionSelectionProbe.input_hash,
        query_variant_hashes: {
          whole: queryHash,
          left_half_open: leftHalfOpenVariant.sql_artifact.query_hash,
          right_half_open: rightHalfOpenVariant.sql_artifact.query_hash,
        },
        witness: fixtureWitnesses.partition,
      },
      {
        relation_kind: "SAME_VALUED_DISTINCT_FACT",
        case_id: authorityIds.distinctFactCase,
        follow_up_snapshot_id: metamorphicSnapshotTokens.distinctFact,
        follow_up_execution_input_hash: distinctFactFollowUp.input_hash,
        selection_probe: distinctFactSelectionProbe.evidence,
        selection_probe_input_hash: distinctFactSelectionProbe.input_hash,
        mutation_record_ref: distinctFactMutation.reference,
        mutation_descriptor_hash: distinctFactMutation.descriptorHash,
        witness: fixtureWitnesses.distinctFact,
      },
    ],
  } as const;
  const fixtureEvidenceHash = await computeMetamorphicFixtureEvidenceHash(fixtureEvidence);
  const fixtureDraft = metamorphicFixtureReceiptSchema.parse({
    artifact_type: "MetamorphicFixtureReceipt",
    receipt_ref: {
      artifact_id: authorityIds.metamorphicFixture,
      artifact_type: "MetamorphicFixtureReceipt",
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
    ...fixtureEvidence,
    evidence_hash: fixtureEvidenceHash,
    issued_at: options.fixtureIssuedAt ?? "2026-07-25T00:00:00.004Z",
    receipt_hash: hashes.input,
  });
  const fixtureReceiptHash = await computeMetamorphicFixtureReceiptHash(fixtureDraft);
  const fixtureReceipt = metamorphicFixtureReceiptSchema.parse({
    ...fixtureDraft,
    receipt_ref: {
      ...fixtureDraft.receipt_ref,
      content_hash: fixtureReceiptHash,
    },
    receipt_hash: fixtureReceiptHash,
  });
  persistSystemArtifact(fixtureReceipt.receipt_ref, fixtureReceipt);
  const fixtureAuthorityOptions = {
    identity: metamorphicAuthorityIdentities.FIXTURE_MUTATION,
    sandbox_authority: sandboxAuthority,
    resolveCommitted: resolveAuthorityRevision,
    verifyCommitted: verifyAuthorityRevisionCommitted,
    verifyExactArtifactRevision: verifyExactAuthorityRevision,
    ...(options.authorityPolicyInjection === "FIXTURE_ALWAYS_TRUE"
      ? { verifyMutationAndSelectionClosure: async () => true }
      : {}),
  };
  const fixtureAuthority = createMetamorphicFixtureAuthority(fixtureAuthorityOptions);
  resolveAuthoritativeMetamorphicFixtureReceipt = (reference) =>
    authorizeMetamorphicFixtureReceipt(reference, fixtureAuthority);
  const relationSampleMaterials = {
    fanOut: {
      relation_kind: "FAN_OUT",
      case_id: authorityIds.fanOutCase,
      follow_up_snapshot_id: metamorphicSnapshotTokens.fanOut,
      follow_up: fanOutFollowUp.evidence,
      witness: fixtureWitnesses.fanOut,
      verdict: "PASS",
    },
    nullAnti: {
      relation_kind: "NULL_ANTI_MEMBERSHIP",
      case_id: authorityIds.nullAntiCase,
      follow_up_snapshot_id: metamorphicSnapshotTokens.nullAnti,
      follow_up: nullAntiFollowUp.evidence,
      witness: fixtureWitnesses.nullAnti,
      verdict: "PASS",
    },
    partition: {
      relation_kind: "HALF_OPEN_ADDITIVE_PARTITION",
      case_id: authorityIds.partitionCase,
      whole_source: "METAMORPHIC_BASELINE",
      snapshot_id: metamorphicSnapshotTokens.baseline,
      left_partition: leftPartition.evidence,
      right_partition: rightPartition.evidence,
      witness: fixtureWitnesses.partition,
      verdict: "PASS",
    },
    distinctFact: {
      relation_kind: "SAME_VALUED_DISTINCT_FACT",
      case_id: authorityIds.distinctFactCase,
      follow_up_snapshot_id: metamorphicSnapshotTokens.distinctFact,
      follow_up: distinctFactFollowUp.evidence,
      witness: fixtureWitnesses.distinctFact,
      verdict: "PASS",
    },
  } as const;
  const relationSamples = [
    {
      ...relationSampleMaterials.fanOut,
      sample_hash: await computeMetamorphicRelationSampleHash(relationSampleMaterials.fanOut),
    },
    {
      ...relationSampleMaterials.nullAnti,
      sample_hash: await computeMetamorphicRelationSampleHash(relationSampleMaterials.nullAnti),
    },
    {
      ...relationSampleMaterials.partition,
      sample_hash: await computeMetamorphicRelationSampleHash(relationSampleMaterials.partition),
    },
    {
      ...relationSampleMaterials.distinctFact,
      sample_hash: await computeMetamorphicRelationSampleHash(relationSampleMaterials.distinctFact),
    },
  ] as const;
  const metamorphicEvidence = {
    sql_artifact_ref: sqlArtifactReference,
    fixture_receipt_ref: fixtureReceipt.receipt_ref,
    verifier: metamorphicAuthorityIdentities.METAMORPHIC_VERIFIER,
    verifier_role: "METAMORPHIC_VERIFIER",
    authority_role_policy_version: "authority_role_policy@1.0.0",
    baseline: {
      sandbox_execution_receipt_ref: sandboxReceiptReference,
      result_artifact_ref: sandboxResultReference,
    },
    relation_samples: relationSamples,
    metamorphic_verdict: "PASS" as const,
  };
  const metamorphicEvidenceHash = await computeMetamorphicOracleEvidenceHash(metamorphicEvidence);
  const metamorphicOracleDraft = metamorphicOracleReceiptSchema.parse({
    artifact_type: "MetamorphicOracleReceipt",
    receipt_ref: {
      artifact_id: authorityIds.metamorphicOracle,
      artifact_type: "MetamorphicOracleReceipt",
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
    ...metamorphicEvidence,
    evidence_hash: metamorphicEvidenceHash,
    evaluated_at: options.metamorphicEvaluatedAt ?? "2026-07-25T00:00:00.005Z",
    receipt_hash: hashes.input,
  });
  const metamorphicOracleHash = await computeMetamorphicOracleReceiptHash(metamorphicOracleDraft);
  const metamorphicOracle = metamorphicOracleReceiptSchema.parse({
    ...metamorphicOracleDraft,
    receipt_ref: {
      ...metamorphicOracleDraft.receipt_ref,
      content_hash: metamorphicOracleHash,
    },
    receipt_hash: metamorphicOracleHash,
  });
  persistSystemArtifact(metamorphicOracle.receipt_ref, metamorphicOracle);
  const metamorphicAuthority = createMetamorphicOracleAuthority({
    identity: metamorphicAuthorityIdentities.METAMORPHIC_VERIFIER,
    fixture_authority: fixtureAuthority,
    sandbox_authority: sandboxAuthority,
    resolveCommitted: resolveAuthorityRevision,
    verifyCommitted: verifyAuthorityRevisionCommitted,
    verifyExactArtifactRevision: verifyExactAuthorityRevision,
  });
  resolveAuthoritativeMetamorphicOracleReceipt = (reference) =>
    authorizeMetamorphicOracleReceipt(reference, metamorphicAuthority);

  const resultInvariantIds = ["non_empty"];
  const resultOracleEvidence = {
    producer: metamorphicAuthorityIdentities.RESULT_PRODUCER,
    producer_role: "RESULT_PRODUCER",
    authority_role_policy_version: "authority_role_policy@1.0.0",
    oracle_version: "result-oracle@1.0.0",
    query_hash: queryHash,
    result_hash: sandboxResult.result_hash,
    result_columns: sandboxResult.columns.map(({ name }) => name),
    row_count: sandboxResult.row_count,
    invariant_verdicts: [{ invariant_id: "non_empty", verdict: "PASS" as const }],
    metamorphic_oracle_receipt_ref: metamorphicOracle.receipt_ref,
    metamorphic_verdict: metamorphicOracle.metamorphic_verdict,
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
    evaluated_at: "2026-07-25T00:00:00.006Z",
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
  const resultOracleAuthority = createResultOracleReceiptAuthority({
    identity: metamorphicAuthorityIdentities.RESULT_PRODUCER,
    metamorphic_authority: metamorphicAuthority,
    resolveCommitted: resolveAuthorityRevision,
    verifyCommitted: verifyAuthorityRevisionCommitted,
    verifyExactArtifactRevision: verifyExactAuthorityRevision,
  });
  resolveAuthoritativeResultOracleReceipt = (reference, metamorphic) =>
    options.resultResolverMode === "REAUTHORIZE_META"
      ? authorizeResultOracleReceipt(reference, resultOracleAuthority)
      : authorizeResultOracleReceipt(reference, resultOracleAuthority, metamorphic);
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
      evidenceReferences: [
        sandboxResultReference,
        metamorphicOracle.receipt_ref,
        resultOracle.receipt_ref,
      ],
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
          evaluated_at: "2026-07-25T00:00:00.007Z",
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
      sealed_at: "2026-07-25T00:00:00.008Z",
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

  async function createAuthoritativeMetamorphicFailureResultGate() {
    const failingFanOut = await createMetamorphicSandboxEvidence({
      receiptId: authorityIds.failingFanOutReceipt,
      resultId: authorityIds.failingFanOutResult,
      idempotencyKey: "ready-fixture-metamorphic-failing-fan-out",
      snapshotToken: metamorphicSnapshotTokens.fanOut,
      rows: [["华南", 200]],
    });
    const failingFixtureCases = fixtureReceipt.cases.map((fixtureCase, index) =>
      index === 0 && fixtureCase.relation_kind === "FAN_OUT"
        ? {
            ...fixtureCase,
            follow_up_execution_input_hash: failingFanOut.input_hash,
          }
        : fixtureCase,
    );
    const failingFixtureEvidence = {
      ...fixtureEvidence,
      cases: failingFixtureCases,
    };
    const failingFixtureDraft = metamorphicFixtureReceiptSchema.parse({
      ...fixtureReceipt,
      receipt_ref: {
        ...fixtureReceipt.receipt_ref,
        artifact_id: authorityIds.failingMetamorphicFixture,
        content_hash: hashes.input,
      },
      ...failingFixtureEvidence,
      evidence_hash: await computeMetamorphicFixtureEvidenceHash(failingFixtureEvidence),
      receipt_hash: hashes.input,
    });
    const failingFixtureHash = await computeMetamorphicFixtureReceiptHash(failingFixtureDraft);
    const failingFixture = metamorphicFixtureReceiptSchema.parse({
      ...failingFixtureDraft,
      receipt_ref: {
        ...failingFixtureDraft.receipt_ref,
        content_hash: failingFixtureHash,
      },
      receipt_hash: failingFixtureHash,
    });
    persistSystemArtifact(failingFixture.receipt_ref, failingFixture);

    const failingRelationSamples = await Promise.all(
      metamorphicOracle.relation_samples.map(async (sample, index) => {
        if (index !== 0) return sample;
        const material = {
          ...sample,
          follow_up: failingFanOut.evidence,
          verdict: "FAIL" as const,
        };
        return {
          ...material,
          sample_hash: await computeMetamorphicRelationSampleHash(material),
        };
      }),
    );
    const failingMetamorphicEvidence = {
      ...metamorphicEvidence,
      fixture_receipt_ref: failingFixture.receipt_ref,
      relation_samples: failingRelationSamples,
      metamorphic_verdict: "FAIL" as const,
    };
    const failingMetamorphicDraft = metamorphicOracleReceiptSchema.parse({
      ...metamorphicOracle,
      receipt_ref: {
        ...metamorphicOracle.receipt_ref,
        artifact_id: authorityIds.failingMetamorphicOracle,
        content_hash: hashes.input,
      },
      ...failingMetamorphicEvidence,
      evidence_hash: await computeMetamorphicOracleEvidenceHash(failingMetamorphicEvidence),
      receipt_hash: hashes.input,
    });
    const failingMetamorphicHash =
      await computeMetamorphicOracleReceiptHash(failingMetamorphicDraft);
    const failingMetamorphic = metamorphicOracleReceiptSchema.parse({
      ...failingMetamorphicDraft,
      receipt_ref: {
        ...failingMetamorphicDraft.receipt_ref,
        content_hash: failingMetamorphicHash,
      },
      receipt_hash: failingMetamorphicHash,
    });
    persistSystemArtifact(failingMetamorphic.receipt_ref, failingMetamorphic);

    const failingResultEvidence = {
      ...resultOracleEvidence,
      metamorphic_oracle_receipt_ref: failingMetamorphic.receipt_ref,
      metamorphic_verdict: "FAIL" as const,
      oracle_verdict: "FAIL" as const,
    };
    const failingResultDraft = resultOracleReceiptSchema.parse({
      ...resultOracle,
      receipt_ref: {
        ...resultOracle.receipt_ref,
        artifact_id: authorityIds.failingResultOracle,
        content_hash: hashes.input,
      },
      ...failingResultEvidence,
      evidence_hash: await computeResultOracleEvidenceHash(failingResultEvidence),
      receipt_hash: hashes.input,
    });
    const failingResultHash = await computeResultOracleReceiptHash(failingResultDraft);
    const failingResult = resultOracleReceiptSchema.parse({
      ...failingResultDraft,
      receipt_ref: {
        ...failingResultDraft.receipt_ref,
        content_hash: failingResultHash,
      },
      receipt_hash: failingResultHash,
    });
    persistSystemArtifact(failingResult.receipt_ref, failingResult);

    const failingGatePayload = await sealGateReceipt({
      artifact_type: "GateReceipt",
      sql_artifact_ref: sqlArtifactReference,
      execution_receipt_ref: executionReference,
      gate: "RESULT",
      gate_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
      evaluator_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
      evaluator_input_hash: hashes.input,
      evaluator_evaluation_hash: hashes.execution,
      verdict: "FAIL",
      reason_code: "RESULT_METAMORPHIC_FAILED",
      evidence_refs: [
        sandboxResultReference,
        failingMetamorphic.receipt_ref,
        failingResult.receipt_ref,
      ],
      observations: {
        result_hash: failingResult.result_hash,
        oracle_version: failingResult.oracle_version,
        invariant_ids: failingResult.invariant_verdicts.map(({ invariant_id }) => invariant_id),
        oracle_evidence_hash: failingResult.evidence_hash,
      },
      evaluated_at: "2026-07-25T00:00:00.007Z",
    });
    const gate = await commit(
      "GateReceipt",
      authorityIds.failingResultGate,
      [
        sqlArtifactReference,
        executionReference,
        sandboxResultReference,
        failingMetamorphic.receipt_ref,
        failingResult.receipt_ref,
      ],
      failingGatePayload,
    );
    return {
      fixture: failingFixture,
      gate,
      metamorphic: failingMetamorphic,
      result: failingResult,
    };
  }

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
      fixtureMutations: [
        fanOutMutation.reference,
        nullAntiMutation.reference,
        distinctFactMutation.reference,
      ],
      halfOpenSqlArtifacts: [
        sqlArtifactReference,
        leftHalfOpenVariant.sql_artifact_ref,
        rightHalfOpenVariant.sql_artifact_ref,
      ],
      metamorphicFixture: fixtureReceipt.receipt_ref,
      metamorphicOracle: metamorphicOracle.receipt_ref,
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
    authorityCallCounts: {},
    createAuthoritativeMetamorphicFailureResultGate,
  };
}
