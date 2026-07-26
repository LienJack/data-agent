import {
  type ArtifactReference,
  AUTHORITY_ROLE_POLICY_VERSION,
  artifactReferenceIdentity,
  canonicalizeJson,
  computeGateEvaluationHash,
  computeGateInputHash,
  computePostgresqlExecutionSettingsHash,
  computeResourceAdmissionReceiptHash,
  computeResourceEstimateHash,
  computeResultOracleReceiptHash,
  computeSandboxExecutionReceiptHash,
  computeSandboxResultBytes,
  computeSandboxResultHash,
  type ExecutionReceiptPayload,
  executionPermitSchema,
  executionReceiptSchema,
  type GateReceiptPayload,
  gateReceiptSchema,
  isAuthoritativeSandboxExecutionReceipt,
  isAuthoritativeSandboxResult,
  resourceAdmissionReceiptSchema,
  resultOracleReceiptSchema,
  SANDBOX_RESULT_LIMITS,
  sandboxExecutionRequestSchema,
  sandboxResultSchema,
  sha256ContentHash,
  successfulSandboxExecutionReceiptSchema,
  validationReceiptSchema,
} from "@data-agent/contracts";
import {
  authorizeSandboxExecutionReceipt,
  authorizeSandboxResult,
  registerSandboxServerAuthority,
} from "@data-agent/contracts/server";
import {
  buildLogicalPlan,
  buildSemanticQuery,
  compilePostgresqlLogicalPlan,
  computeResultOracleEvidenceHash,
  computeSqlSandboxInputHash,
  createGateReceiptPayload,
  createGroundingPackagePayload,
  createLogicalPlanPayload,
  createSemanticQueryPayload,
  evaluatePostExecutionGates,
  evaluatePreExecutionGates,
  isPostgresqlCompilation,
  isValidatedLogicalPlan,
  type PostgresqlExplainEstimate,
  type ResourcePolicy,
  resourcePolicySchema,
  sealExecutionPermit,
  sealValidationReceipt,
  TEXT2SQL_SQL_SANDBOX_MAX_MEMORY_MB,
  validateLogicalPlan,
} from "@data-agent/text2sql";
import {
  registerTrustedGateArtifactAuthority,
  registerTrustedResourceAdmission,
  registerTrustedResultOracleAuthority,
} from "@data-agent/text2sql/server";
import { describe, expect, it } from "vitest";
import { groundQueryContract } from "../src/grounding/ground-query-contract.js";
import {
  analystPolicy,
  artifactReference,
  commerceCatalog,
  fixtureIds,
  fixturePrincipalId,
  fixtureScope,
  netRevenueContract,
} from "./support/commerce-fixture.js";
import { committedLogicalPlanAuthorityFixture } from "./support/compiler-authority-fixture.js";
import {
  createAuthoritativeMetamorphicSandboxFixture,
  createMetamorphicOracleFixture,
  type MetamorphicRelationRows,
} from "./support/metamorphic-oracle-fixture.js";

const gateMatrixIds = {
  sqlArtifact: "10000000-0000-4000-8000-000000000101",
  executionPermit: "10000000-0000-4000-8000-000000000102",
  sandboxReceipt: "10000000-0000-4000-8000-000000000103",
  sandboxResult: "10000000-0000-4000-8000-000000000110",
  execution: "10000000-0000-4000-8000-000000000104",
  sandboxExecution: "10000000-0000-4000-8000-000000000105",
  wrongSqlArtifact: "10000000-0000-4000-8000-000000000106",
  wrongTenant: "10000000-0000-4000-8000-000000000107",
  wrongExecution: "10000000-0000-4000-8000-000000000109",
  resourceAdmission: "10000000-0000-4000-8000-000000000120",
  resultOracle: "10000000-0000-4000-8000-000000000121",
  policyReceipt: "10000000-0000-4000-8000-000000000122",
  transaction: "10000000-0000-4000-8000-000000000123",
  preGateReceipts: [
    "10000000-0000-4000-8000-000000000111",
    "10000000-0000-4000-8000-000000000112",
    "10000000-0000-4000-8000-000000000113",
    "10000000-0000-4000-8000-000000000114",
    "10000000-0000-4000-8000-000000000115",
  ],
  postGateReceipts: [
    "10000000-0000-4000-8000-000000000116",
    "10000000-0000-4000-8000-000000000117",
  ],
} as const;

function matrixArtifactReference<const T extends ArtifactReference["artifact_type"]>(
  artifactType: T,
  artifactId: string,
): ArtifactReference & { readonly artifact_type: T } {
  return {
    ...artifactReference(artifactType),
    artifact_id: artifactId,
  };
}

const sqlArtifactReference = matrixArtifactReference("SqlArtifact", gateMatrixIds.sqlArtifact);
const executionPermitReference = matrixArtifactReference(
  "ExecutionPermit",
  gateMatrixIds.executionPermit,
);
const sandboxReceiptReference = matrixArtifactReference(
  "SandboxExecutionReceipt",
  gateMatrixIds.sandboxReceipt,
);
const policyReceiptReference = matrixArtifactReference(
  "PolicyReceipt",
  gateMatrixIds.policyReceipt,
);
const executionReference = matrixArtifactReference("ExecutionReceipt", gateMatrixIds.execution);
const preGateReceiptReferences = [
  matrixArtifactReference("GateReceipt", gateMatrixIds.preGateReceipts[0]),
  matrixArtifactReference("GateReceipt", gateMatrixIds.preGateReceipts[1]),
  matrixArtifactReference("GateReceipt", gateMatrixIds.preGateReceipts[2]),
  matrixArtifactReference("GateReceipt", gateMatrixIds.preGateReceipts[3]),
  matrixArtifactReference("GateReceipt", gateMatrixIds.preGateReceipts[4]),
] as const;
const postGateReceiptReferences = [
  matrixArtifactReference("GateReceipt", gateMatrixIds.postGateReceipts[0]),
  matrixArtifactReference("GateReceipt", gateMatrixIds.postGateReceipts[1]),
] as const;

const resourcePolicy = resourcePolicySchema.parse({
  policy_version: "text2sql-resource-policy@1.0.0",
  max_total_cost: 1_000,
  max_plan_rows: 1_000,
  max_plan_bytes: 100_000,
  forbidden_node_types: ["Nested Loop"],
  statement_timeout_ms: 5_000,
  lock_timeout_ms: 500,
  max_rows: 2_000,
  max_bytes: 1_000_000,
  max_memory_mb: 512,
});

const postgresqlExecutionSettings = {
  database_role: "analyst",
  search_path: ["app_data_agent", "pg_catalog"],
  plan_cache_mode: "force_custom_plan",
  statement_timeout_ms: resourcePolicy.statement_timeout_ms,
  lock_timeout_ms: resourcePolicy.lock_timeout_ms,
} as const;

const permitTimes = {
  now: "2026-07-26T00:00:00.000Z",
  expiresAt: "2026-07-26T00:05:00.000Z",
  observedAt: "2026-07-26T00:01:00.000Z",
  sealedAt: "2026-07-26T00:02:00.000Z",
} as const;

const sandboxExecutionIdentity = {
  authority_id: "10000000-0000-4000-8000-000000000130",
  principal_id: "gate-matrix-sandbox-authority",
  key_id: "gate-matrix-sandbox-key@1.0.0",
} as const;

const resultProducerIdentity = {
  authority_id: "10000000-0000-4000-8000-000000000131",
  principal_id: "gate-matrix-result-producer",
  key_id: "gate-matrix-result-producer-key@1.0.0",
} as const;

const gateMatrixCatalog = {
  ...commerceCatalog,
  tables: commerceCatalog.tables.map((table) => ({
    ...table,
    columns: table.columns.map((column) =>
      column.column_id === "orders.net_amount"
        ? { ...column, data_type: "integer" as const }
        : column,
    ),
  })),
};

function gateArtifactStore(initialNow = permitTimes.now) {
  const payloads = new Map<string, unknown>();
  let now: string = initialNow;
  let clockAdvanceOnResolve: Readonly<{ referenceIdentity: string; timestamp: string }> | undefined;
  const authority = registerTrustedGateArtifactAuthority({
    async resolveArtifact(reference) {
      if (clockAdvanceOnResolve?.referenceIdentity === artifactReferenceIdentity(reference)) {
        now = clockAdvanceOnResolve.timestamp;
        clockAdvanceOnResolve = undefined;
      }
      return payloads.get(artifactReferenceIdentity(reference)) ?? null;
    },
    async verifyCommitted(reference) {
      return payloads.has(artifactReferenceIdentity(reference));
    },
    now: () => now,
  });
  return {
    authority,
    sandboxAuthority: {
      identity: sandboxExecutionIdentity,
      resolveCommitted: async (reference: ArtifactReference) =>
        payloads.get(artifactReferenceIdentity(reference)) ?? null,
      verifyCommitted: async (reference: ArtifactReference) =>
        payloads.has(artifactReferenceIdentity(reference)),
      verifyExactArtifactRevision: async (reference: ArtifactReference, artifact: unknown) => {
        const committed = payloads.get(artifactReferenceIdentity(reference));
        return (
          committed !== undefined && canonicalizeJson(committed) === canonicalizeJson(artifact)
        );
      },
    },
    commit(reference: ArtifactReference, payload: unknown) {
      payloads.set(artifactReferenceIdentity(reference), payload);
    },
    setNow(value: string) {
      now = value;
    },
    advanceClockWhenResolving(reference: ArtifactReference, timestamp: string) {
      clockAdvanceOnResolve = {
        referenceIdentity: artifactReferenceIdentity(reference),
        timestamp,
      };
    },
  };
}

async function commerceCompilationFixture() {
  const store = gateArtifactStore();
  const queryContract = netRevenueContract();
  const groundingResult = await groundQueryContract({
    query_contract: queryContract,
    catalog: gateMatrixCatalog,
    policy: analystPolicy,
    retrieval_candidates: [],
    max_context_objects: 64,
  });
  if (groundingResult.state !== "READY") {
    throw new Error(`测试 Fixture 必须完成 Grounding，实际为 ${groundingResult.state}。`);
  }

  const semanticQuery = buildSemanticQuery({
    query_contract: queryContract,
    grounding: groundingResult.grounding,
  });
  const logicalPlanCandidate = buildLogicalPlan({
    semantic_query: semanticQuery,
    grounding: groundingResult.grounding,
  });
  const logicalPlanValidation = validateLogicalPlan({
    query_contract: queryContract,
    grounding: groundingResult.grounding,
    semantic_query: semanticQuery,
    logical_plan: logicalPlanCandidate,
  });
  if (logicalPlanValidation.state !== "VALID") {
    throw new Error(`测试 Fixture 的 LogicalPlan 必须有效：${logicalPlanValidation.reason_code}`);
  }

  const logicalPlanAuthority = await committedLogicalPlanAuthorityFixture(
    logicalPlanValidation.logical_plan,
  );
  const logicalPlanBinding = await logicalPlanAuthority.bind();
  const compilationResult = await compilePostgresqlLogicalPlan({
    logical_plan_binding: logicalPlanBinding,
    grounding: groundingResult.grounding,
  });
  if (compilationResult.state !== "COMPILED") {
    throw new Error(`测试 Fixture 必须成功编译 PostgreSQL：${compilationResult.reason_code}`);
  }

  const queryContractReference = artifactReference("QueryContract");
  const groundingPackageReference = artifactReference("GroundingPackage");
  const semanticQueryReference = artifactReference("SemanticQuery");
  const groundingPackage = createGroundingPackagePayload({
    draft: groundingResult.grounding,
    query_contract_ref: queryContractReference,
    semantic_release_ref: artifactReference("SemanticRelease"),
    schema_snapshot_ref: artifactReference("SchemaSnapshot"),
    policy_receipt_ref: policyReceiptReference,
  });
  const semanticQueryPayload = createSemanticQueryPayload({
    draft: semanticQuery,
    query_contract_ref: queryContractReference,
    grounding_package_ref: groundingPackageReference,
  });
  const logicalPlanPayload = createLogicalPlanPayload({
    draft: logicalPlanValidation.logical_plan,
    semantic_query_ref: semanticQueryReference,
  });
  store.commit(queryContractReference, queryContract);
  store.commit(groundingPackageReference, groundingPackage);
  store.commit(semanticQueryReference, semanticQueryPayload);
  store.commit(logicalPlanAuthority.reference, logicalPlanPayload);

  const resourceEstimate: PostgresqlExplainEstimate = {
    query_hash: compilationResult.compilation.sql_artifact.query_hash,
    datasource_id: queryContract.datasource_id,
    schema_version: "commerce-schema@1.0.0",
    settings_hash: await computePostgresqlExecutionSettingsHash(postgresqlExecutionSettings),
    explain_format: "JSON",
    analyze: false,
    total_cost: 100,
    plan_rows: 100,
    plan_width: 64,
    node_types: ["Aggregate", "Hash Join", "Seq Scan"],
    relation_names: ["customers", "orders"],
    has_cartesian_join: false,
  };

  return {
    queryContract,
    grounding: groundingResult.grounding,
    semanticQuery,
    queryContractReference,
    groundingPackage,
    groundingPackageReference,
    semanticQueryPayload,
    semanticQueryReference,
    logicalPlan: logicalPlanValidation.logical_plan,
    logicalPlanPayload,
    logicalPlanReference: logicalPlanAuthority.reference,
    logicalPlanBinding,
    compilation: compilationResult.compilation,
    resourceEstimate,
    store,
  };
}

async function resourceAdmission(
  fixture: Awaited<ReturnType<typeof commerceCompilationFixture>>,
  estimate: PostgresqlExplainEstimate | null = fixture.resourceEstimate,
  policy: ResourcePolicy = resourcePolicy,
) {
  if (!estimate) return undefined;
  const estimateMaterial = {
    query_hash: estimate.query_hash,
    datasource_id: estimate.datasource_id,
    schema_version: estimate.schema_version,
    settings_hash: estimate.settings_hash,
    total_cost: estimate.total_cost,
    plan_rows: estimate.plan_rows,
    plan_width: estimate.plan_width,
    node_types: [...estimate.node_types].sort(),
    relation_names: [...estimate.relation_names].sort(),
    has_cartesian_join: estimate.has_cartesian_join,
  };
  const baseReference = matrixArtifactReference(
    "ResourceAdmissionReceipt",
    gateMatrixIds.resourceAdmission,
  );
  const draft = resourceAdmissionReceiptSchema.parse({
    artifact_type: "ResourceAdmissionReceipt",
    receipt_ref: baseReference,
    scope: fixtureScope,
    run_id: fixtureIds.run,
    sql_artifact_ref: sqlArtifactReference,
    principal_id: fixturePrincipalId,
    policy_receipt_ref: policyReceiptReference,
    ...estimateMaterial,
    execution_settings: postgresqlExecutionSettings,
    estimate_hash: await computeResourceEstimateHash(estimateMaterial),
    policy_version: policy.policy_version,
    forbidden_node_types: [...policy.forbidden_node_types].sort(),
    max_total_cost: policy.max_total_cost,
    max_plan_rows: policy.max_plan_rows,
    max_plan_bytes: policy.max_plan_bytes,
    lock_timeout_ms: policy.lock_timeout_ms,
    timeout_ms: policy.statement_timeout_ms,
    max_rows: policy.max_rows,
    max_bytes: policy.max_bytes,
    max_memory_mb: policy.max_memory_mb,
    evaluated_at: permitTimes.now,
    receipt_hash: baseReference.content_hash,
  });
  const receiptHash = await computeResourceAdmissionReceiptHash(draft);
  const receipt = resourceAdmissionReceiptSchema.parse({
    ...draft,
    receipt_ref: { ...baseReference, content_hash: receiptHash },
    receipt_hash: receiptHash,
  });
  fixture.store.commit(receipt.receipt_ref, receipt);
  return registerTrustedResourceAdmission(fixture.store.authority, receipt.receipt_ref);
}

async function preExecutionInput(
  fixture: Awaited<ReturnType<typeof commerceCompilationFixture>>,
  estimate: PostgresqlExplainEstimate | null = fixture.resourceEstimate,
) {
  return {
    artifact_authority: fixture.store.authority,
    sql_artifact_ref: sqlArtifactReference,
    query_contract: fixture.queryContract,
    grounding: fixture.grounding,
    semantic_query: fixture.semanticQuery,
    logical_plan: fixture.logicalPlan,
    compilation: fixture.compilation,
    resource_admission: await resourceAdmission(fixture, estimate),
  };
}

async function preExecutionInputWithoutExplain(
  fixture: Awaited<ReturnType<typeof commerceCompilationFixture>>,
) {
  return {
    artifact_authority: fixture.store.authority,
    sql_artifact_ref: sqlArtifactReference,
    query_contract: fixture.queryContract,
    grounding: fixture.grounding,
    semantic_query: fixture.semanticQuery,
    logical_plan: fixture.logicalPlan,
    compilation: fixture.compilation,
  };
}

async function persistGateReceipts(
  store: ReturnType<typeof gateArtifactStore>,
  evaluations: readonly Parameters<typeof createGateReceiptPayload>[0]["evaluation"][],
  references: readonly ArtifactReference[],
  executionReceiptReference: GateReceiptPayload["execution_receipt_ref"],
) {
  const receipts = await Promise.all(
    evaluations.map((evaluation) =>
      createGateReceiptPayload({
        evaluation,
        sql_artifact_ref: sqlArtifactReference,
        execution_receipt_ref: executionReceiptReference,
      }),
    ),
  );
  receipts.forEach((receipt, index) => {
    const reference = references[index];
    if (!reference) throw new Error("GateReceipt 测试引用缺失。");
    store.commit(reference, receipt);
  });
  return receipts;
}

async function rewriteGateReceipt(
  receipt: GateReceiptPayload,
  patch: Readonly<{
    evidence_refs?: readonly ArtifactReference[];
    evaluated_at?: string;
  }>,
): Promise<GateReceiptPayload> {
  const inputMaterial = {
    artifact_type: receipt.artifact_type,
    sql_artifact_ref: receipt.sql_artifact_ref,
    execution_receipt_ref: receipt.execution_receipt_ref,
    gate: receipt.gate,
    gate_version: receipt.gate_version,
    evaluator_version: receipt.evaluator_version,
    evidence_refs: patch.evidence_refs ?? receipt.evidence_refs,
  };
  const inputHash = await computeGateInputHash(inputMaterial);
  const evaluationMaterial = {
    ...inputMaterial,
    input_hash: inputHash,
    evaluator_input_hash: receipt.evaluator_input_hash,
    evaluator_evaluation_hash: receipt.evaluator_evaluation_hash,
    verdict: receipt.verdict,
    reason_code: receipt.reason_code,
    observations: receipt.observations,
    evaluated_at: patch.evaluated_at ?? receipt.evaluated_at,
  };
  return gateReceiptSchema.parse({
    ...evaluationMaterial,
    evaluation_hash: await computeGateEvaluationHash(evaluationMaterial),
  });
}

async function passingPreExecutionFixture() {
  const fixture = await commerceCompilationFixture();
  const preExecutionSuite = await evaluatePreExecutionGates(await preExecutionInput(fixture));
  if (!preExecutionSuite.permit_eligible) {
    throw new Error("测试 Fixture 的五道执行前 Gate 必须全部 PASS。");
  }
  const preGateReceipts = await persistGateReceipts(
    fixture.store,
    preExecutionSuite.gates,
    preGateReceiptReferences,
    null,
  );
  const executionPermit = await sealExecutionPermit({
    authority: fixture.store.authority,
    sql_artifact_ref: sqlArtifactReference,
    pre_execution_suite: preExecutionSuite,
    gate_receipt_refs: preGateReceiptReferences,
  });
  fixture.store.commit(executionPermitReference, executionPermit);
  return {
    ...fixture,
    preExecutionSuite,
    preGateReceipts,
    executionPermit,
  };
}

async function authoritativeSandboxArtifacts(
  fixture: Awaited<ReturnType<typeof passingPreExecutionFixture>>,
  options: Readonly<{
    completed_at?: string;
    elapsed_ms?: number;
    max_memory_mb?: number;
    observed_at?: string;
    peak_memory_mb?: number;
    result_schema_version?: string;
    rows?: readonly (readonly [string, number])[];
    started_at?: string;
  }> = {},
) {
  const columns = [
    { name: fixture.queryContract.result_contract.columns[0], type: "STRING" },
    { name: fixture.queryContract.result_contract.columns[1], type: "INTEGER" },
  ] as const;
  const rows = options.rows ?? [
    ["new", 120],
    ["returning", 80],
  ];
  const baseResultReference = matrixArtifactReference("SandboxResult", gateMatrixIds.sandboxResult);
  const resultDraft = {
    schema_version: options.result_schema_version ?? fixture.resourceEstimate.schema_version,
    result_ref: baseResultReference,
    scope: fixtureScope,
    run_id: fixtureIds.run,
    execution_id: gateMatrixIds.sandboxExecution,
    columns,
    rows,
    row_count: rows.length,
    bytes: computeSandboxResultBytes({ columns, rows }),
    result_hash: baseResultReference.content_hash,
  } as const;
  const resultHash = await computeSandboxResultHash(resultDraft);
  const resultPayload = sandboxResultSchema.parse({
    ...resultDraft,
    result_ref: {
      ...baseResultReference,
      content_hash: resultHash,
    },
    result_hash: resultHash,
  });
  const request = sandboxExecutionRequestSchema.parse({
    schema_version: fixture.resourceEstimate.schema_version,
    scope: fixtureScope,
    run_id: fixtureIds.run,
    execution_id: gateMatrixIds.sandboxExecution,
    idempotency_key: "gate-matrix-execution-v1",
    budget: {
      ...fixture.executionPermit.budget,
      max_memory_mb: options.max_memory_mb ?? fixture.executionPermit.budget.max_memory_mb,
    },
    language: "sql",
    payload: {
      dialect: "postgresql",
      sql_artifact_ref: sqlArtifactReference,
      execution_permit_ref: executionPermitReference,
      resource_admission_ref: fixture.executionPermit.resource_admission_ref,
      datasource_id: fixture.executionPermit.datasource_id,
      settings_hash: fixture.executionPermit.settings_hash,
      execution_settings: fixture.executionPermit.execution_settings,
      snapshot_requirement: { mode: "REQUIRE_REPLAYABLE" },
      parameters: fixture.compilation.sql_artifact.parameters,
    },
  });
  const resourceUsage = {
    elapsed_ms: options.elapsed_ms ?? 50,
    rows: resultPayload.row_count,
    bytes: resultPayload.bytes,
    peak_memory_mb: options.peak_memory_mb ?? 8,
  };
  const startedAt = options.started_at ?? "2026-07-26T00:00:10.000Z";
  const completedAt = options.completed_at ?? "2026-07-26T00:00:10.050Z";
  const authorityRevalidation = {
    effective_principal_id: fixture.executionPermit.principal_id,
    policy_receipt_ref: fixture.executionPermit.policy_receipt_ref,
    revalidated_at: startedAt,
    authority_epoch: 0,
  } as const;
  const transaction = {
    transaction_id: gateMatrixIds.transaction,
    read_only: true,
    isolation_level: "REPEATABLE_READ",
  } as const;
  const inputHash = await computeSqlSandboxInputHash(request);
  const receiptDraft = successfulSandboxExecutionReceiptSchema.parse({
    schema_version: request.schema_version,
    language: "sql",
    executor: sandboxExecutionIdentity,
    executor_role: "SANDBOX_EXECUTION",
    authority_role_policy_version: AUTHORITY_ROLE_POLICY_VERSION,
    receipt_id: gateMatrixIds.sandboxReceipt,
    receipt_ref: sandboxReceiptReference,
    scope: fixtureScope,
    run_id: fixtureIds.run,
    execution_id: gateMatrixIds.sandboxExecution,
    idempotency_key: request.idempotency_key,
    input_hash: inputHash,
    execution_hash: sandboxReceiptReference.content_hash,
    terminal: "COMPLETED",
    reason_code: "EXECUTION_COMPLETED",
    started_at: startedAt,
    completed_at: completedAt,
    result_artifact_ref: resultPayload.result_ref,
    sql_artifact_ref: sqlArtifactReference,
    execution_permit_ref: executionPermitReference,
    resource_admission_ref: fixture.executionPermit.resource_admission_ref,
    datasource_id: fixture.executionPermit.datasource_id,
    settings_hash: fixture.executionPermit.settings_hash,
    execution_settings: fixture.executionPermit.execution_settings,
    transaction,
    authority_revalidation: authorityRevalidation,
    snapshot_token: "commerce-snapshot@2026-07-26",
    watermark: null,
    replay_state: "REPLAYABLE",
    resource_usage: resourceUsage,
  });
  const executionHash = await computeSandboxExecutionReceiptHash(receiptDraft);
  const receiptPayload = successfulSandboxExecutionReceiptSchema.parse({
    ...receiptDraft,
    receipt_ref: {
      ...receiptDraft.receipt_ref,
      content_hash: executionHash,
    },
    execution_hash: executionHash,
  });
  const executionRecord = {
    request,
    started_at: startedAt,
    completed_at: completedAt,
    result_artifact_ref: resultPayload.result_ref,
    datasource_id: fixture.executionPermit.datasource_id,
    schema_version: request.schema_version,
    settings_hash: fixture.executionPermit.settings_hash,
    applied_execution_settings: fixture.executionPermit.execution_settings,
    transaction,
    authority_revalidation: authorityRevalidation,
    snapshot: {
      snapshot_token: receiptPayload.snapshot_token,
      watermark: receiptPayload.watermark,
      replay_state: receiptPayload.replay_state,
    },
    resource_usage: resourceUsage,
  } as const;
  const authoritativeSqlArtifact = fixture.compilation.sql_artifact;
  fixture.store.commit(sqlArtifactReference, authoritativeSqlArtifact);
  const sandboxAuthority = registerSandboxServerAuthority({
    ...fixture.store.sandboxAuthority,
    async resolveAuthoritativeExecutionPermit(reference) {
      return artifactReferenceIdentity(reference) ===
        artifactReferenceIdentity(executionPermitReference)
        ? fixture.executionPermit
        : null;
    },
    async resolveAuthoritativeSqlArtifact(reference) {
      return artifactReferenceIdentity(reference) ===
        artifactReferenceIdentity(sqlArtifactReference)
        ? authoritativeSqlArtifact
        : null;
    },
    async revalidateExecutionAuthority(input) {
      return artifactReferenceIdentity(input.execution_permit_ref) ===
        artifactReferenceIdentity(executionPermitReference)
        ? authorityRevalidation
        : null;
    },
    async assertAuthorityFence() {
      return true;
    },
    async withSqlTransaction(operation) {
      return operation();
    },
    async claimOrLoadExecution(_claim, operation) {
      return {
        status: "EXECUTED" as const,
        value: await operation(),
      };
    },
    async resolveExecutionRecord(hash) {
      return hash === inputHash ? executionRecord : null;
    },
    now: () => new Date(startedAt),
  });
  fixture.store.commit(resultPayload.result_ref, resultPayload);
  fixture.store.commit(receiptPayload.receipt_ref, receiptPayload);
  const result = await authorizeSandboxResult(resultPayload.result_ref, sandboxAuthority);
  const receipt = await authorizeSandboxExecutionReceipt(
    receiptPayload.receipt_ref,
    sandboxAuthority,
  );
  expect(isAuthoritativeSandboxExecutionReceipt(receipt)).toBe(true);
  expect(isAuthoritativeSandboxResult(result)).toBe(true);
  return { request, receipt, result };
}

async function executionReceipt(
  fixture: Awaited<ReturnType<typeof passingPreExecutionFixture>>,
  sandbox: Awaited<ReturnType<typeof authoritativeSandboxArtifacts>>,
  overrides: Partial<ExecutionReceiptPayload> = {},
): Promise<ExecutionReceiptPayload> {
  return executionReceiptSchema.parse({
    artifact_type: "ExecutionReceipt",
    sql_artifact_ref: sqlArtifactReference,
    execution_permit_ref: executionPermitReference,
    sandbox_execution_receipt_ref: sandbox.receipt.receipt_ref,
    result_artifact_ref: sandbox.result.result_ref,
    datasource_id: fixture.queryContract.datasource_id,
    schema_version: fixture.resourceEstimate.schema_version,
    snapshot_token: sandbox.receipt.snapshot_token,
    watermark: sandbox.receipt.watermark,
    observed_at: permitTimes.observedAt,
    query_hash: fixture.compilation.sql_artifact.query_hash,
    result_hash: sandbox.result.result_hash,
    replay_state: sandbox.receipt.replay_state,
    row_count: sandbox.result.row_count,
    ...overrides,
  });
}

async function passingResultOracle(
  fixture: Awaited<ReturnType<typeof executableFixture>>,
  overrides: Readonly<{
    result_hash?: `sha256:${string}`;
    authority_time_on_evaluate?: string;
    metamorphic_relation_rows?: MetamorphicRelationRows;
    result_store_mode?:
      | "SYSTEM"
      | "GENERIC_ONLY"
      | "EXACT_REVISION_REJECTED"
      | "REFERENCE_PAYLOAD_MISMATCH";
  }> = {},
) {
  const baselineSnapshot = fixture.sandboxReceipt.snapshot_token;
  if (!baselineSnapshot) {
    throw new TypeError("Gate Matrix Metamorphic Baseline 必须可重放。");
  }
  const metamorphicStore = {
    resolveCommitted: (reference: ArtifactReference) =>
      fixture.store.sandboxAuthority.resolveCommitted(reference),
    verifyCommitted: (reference: ArtifactReference) =>
      fixture.store.sandboxAuthority.verifyCommitted(reference),
    verifyExactArtifactRevision: (reference: ArtifactReference, artifact: unknown) =>
      fixture.store.sandboxAuthority.verifyExactArtifactRevision(reference, artifact),
    now: () => fixture.store.authority.now(),
    commit: (reference: ArtifactReference, payload: unknown) =>
      fixture.store.commit(reference, payload),
  };
  const artifactContext = {
    query_contract_ref: fixture.queryContractReference,
    grounding_package_ref: fixture.groundingPackageReference,
    logical_plan_ref: fixture.logicalPlanReference,
    applicability_profile: {
      suite: "ADDITIVE_INTEGER_V1",
      aggregate_kind: "sum",
      distinct: false,
      source_measure_data_type: "integer",
      result_data_type: "INTEGER",
      metric_id: fixture.queryContract.metric,
      dimension_ids: fixture.queryContract.dimensions,
      group_key_arity: fixture.queryContract.dimensions.length,
    },
  } as const;
  const metamorphicSandbox = await createAuthoritativeMetamorphicSandboxFixture({
    execution_context: {
      scope: fixtureScope,
      run_id: fixtureIds.run,
      sandbox_identity: sandboxExecutionIdentity,
      sql_artifact_ref: sqlArtifactReference,
      sql_artifact: fixture.compilation.sql_artifact,
      execution_permit_ref: executionPermitReference,
      execution_permit: fixture.executionPermit,
      authority_epoch: fixture.sandboxReceipt.authority_revalidation.authority_epoch,
      artifact_context: artifactContext,
      baseline: {
        columns: fixture.sandboxResult.columns,
        rows: fixture.sandboxResult.rows,
        snapshot_token: baselineSnapshot,
        started_at: fixture.sandboxReceipt.started_at,
        completed_at: fixture.sandboxReceipt.completed_at,
      },
    },
    ...(overrides.metamorphic_relation_rows
      ? { relation_rows: overrides.metamorphic_relation_rows }
      : {}),
  });
  const metamorphicBaseline = metamorphicSandbox.evidence.baseline;
  const metamorphicExecutionReceipt = await executionReceipt(fixture, metamorphicBaseline, {
    observed_at: fixture.executionReceipt.observed_at,
  });
  fixture.store.commit(executionReference, metamorphicExecutionReceipt);
  fixture.store.setNow(metamorphicExecutionReceipt.observed_at);
  const relationVerdicts = overrides.metamorphic_relation_rows
    ? {
        ...(overrides.metamorphic_relation_rows.fan_out !== undefined
          ? { FAN_OUT: "FAIL" as const }
          : {}),
        ...(overrides.metamorphic_relation_rows.null_anti_membership !== undefined
          ? { NULL_ANTI_MEMBERSHIP: "FAIL" as const }
          : {}),
        ...(overrides.metamorphic_relation_rows.left_partition !== undefined ||
        overrides.metamorphic_relation_rows.right_partition !== undefined
          ? { HALF_OPEN_ADDITIVE_PARTITION: "FAIL" as const }
          : {}),
        ...(overrides.metamorphic_relation_rows.same_valued_distinct_fact !== undefined
          ? { SAME_VALUED_DISTINCT_FACT: "FAIL" as const }
          : {}),
      }
    : undefined;
  const metamorphic = await createMetamorphicOracleFixture({
    sandbox_fixture: metamorphicSandbox,
    store_adapter: metamorphicStore,
    artifact_context: artifactContext,
    evaluated_at: metamorphicExecutionReceipt.observed_at,
    ...(relationVerdicts ? { relation_verdicts: relationVerdicts } : {}),
    identity_overrides: {
      result_producer: resultProducerIdentity,
    },
  });
  const verdict = {
    producer: resultProducerIdentity,
    producer_role: "RESULT_PRODUCER" as const,
    authority_role_policy_version: AUTHORITY_ROLE_POLICY_VERSION,
    oracle_version: "commerce-result-oracle@1.0.0",
    query_hash: metamorphicExecutionReceipt.query_hash,
    result_hash: overrides.result_hash ?? metamorphicBaseline.result.result_hash,
    result_columns: metamorphicBaseline.result.columns.map(({ name }) => name),
    row_count: metamorphicBaseline.result.row_count,
    invariant_verdicts: fixture.queryContract.result_contract.invariant_ids.map((invariantId) => ({
      invariant_id: invariantId,
      verdict: "PASS" as const,
    })),
    metamorphic_oracle_receipt_ref: metamorphic.receipt.receipt_ref,
    metamorphic_verdict: metamorphic.receipt.metamorphic_verdict,
    oracle_verdict:
      metamorphic.receipt.metamorphic_verdict === "PASS" ? ("PASS" as const) : ("FAIL" as const),
  };
  const baseReference = matrixArtifactReference("ResultOracleReceipt", gateMatrixIds.resultOracle);
  const draft = resultOracleReceiptSchema.parse({
    artifact_type: "ResultOracleReceipt",
    receipt_ref: baseReference,
    scope: fixtureScope,
    run_id: fixtureIds.run,
    sql_artifact_ref: sqlArtifactReference,
    execution_receipt_ref: executionReference,
    ...verdict,
    result_artifact_ref: metamorphicBaseline.result.result_ref,
    evidence_hash: await computeResultOracleEvidenceHash({
      verdict,
      result_artifact_ref: metamorphicBaseline.result.result_ref,
    }),
    evaluated_at: metamorphicExecutionReceipt.observed_at,
    receipt_hash: baseReference.content_hash,
  });
  const receiptHash = await computeResultOracleReceiptHash(draft);
  const receipt = resultOracleReceiptSchema.parse({
    ...draft,
    receipt_ref: { ...baseReference, content_hash: receiptHash },
    receipt_hash: receiptHash,
  });
  const evaluatedReference =
    overrides.result_store_mode === "REFERENCE_PAYLOAD_MISMATCH"
      ? { ...receipt.receipt_ref, revision: receipt.receipt_ref.revision + 1 }
      : receipt.receipt_ref;
  const resultSystemArtifacts = new Map<string, unknown>();
  const resultOracleStoreAdapter = {
    async resolveCommitted(reference: ArtifactReference) {
      return resultSystemArtifacts.get(artifactReferenceIdentity(reference)) ?? null;
    },
    async verifyCommitted(reference: ArtifactReference) {
      return resultSystemArtifacts.has(artifactReferenceIdentity(reference));
    },
    async verifyExactArtifactRevision(reference: ArtifactReference, artifact: unknown) {
      if (overrides.result_store_mode === "EXACT_REVISION_REJECTED") return false;
      const committed = resultSystemArtifacts.get(artifactReferenceIdentity(reference));
      return committed !== undefined && canonicalizeJson(committed) === canonicalizeJson(artifact);
    },
  };
  if (overrides.result_store_mode === "GENERIC_ONLY") {
    fixture.store.commit(receipt.receipt_ref, receipt);
  } else {
    resultSystemArtifacts.set(artifactReferenceIdentity(evaluatedReference), receipt);
  }
  return {
    result_oracle_authority: registerTrustedResultOracleAuthority({
      identity: resultProducerIdentity,
      ...resultOracleStoreAdapter,
      async evaluate() {
        if (overrides.authority_time_on_evaluate) {
          fixture.store.setNow(overrides.authority_time_on_evaluate);
        }
        return evaluatedReference;
      },
    }),
    result_oracle_store_adapter: resultOracleStoreAdapter,
    result_oracle_receipt_ref: evaluatedReference,
    metamorphic_oracle_verifier: metamorphic.verifier,
    sandbox_request: metamorphicBaseline.request,
    sandbox_receipt: metamorphicBaseline.receipt,
    sandbox_result: metamorphicBaseline.result,
    execution_receipt: metamorphicExecutionReceipt,
  };
}

async function executableFixture(
  options: Parameters<typeof authoritativeSandboxArtifacts>[1] = {},
) {
  const fixture = await passingPreExecutionFixture();
  const sandbox = await authoritativeSandboxArtifacts(fixture, options);
  const receipt = await executionReceipt(fixture, sandbox, {
    observed_at: options.observed_at ?? permitTimes.observedAt,
  });
  fixture.store.commit(executionReference, receipt);
  fixture.store.setNow(receipt.observed_at);
  return {
    ...fixture,
    sandboxRequest: sandbox.request,
    sandboxReceipt: sandbox.receipt,
    sandboxResult: sandbox.result,
    executionReceipt: receipt,
  };
}

function postExecutionInput(
  fixture: Awaited<ReturnType<typeof executableFixture>>,
  oracle?: Awaited<ReturnType<typeof passingResultOracle>>,
) {
  const base = {
    artifact_authority: fixture.store.authority,
    query_contract: fixture.queryContract,
    compilation: fixture.compilation,
    sql_artifact_ref: sqlArtifactReference,
    execution_receipt_ref: executionReference,
    sandbox_request: fixture.sandboxRequest,
    sandbox_receipt: fixture.sandboxReceipt,
    sandbox_result: fixture.sandboxResult,
  };
  return oracle
    ? {
        ...base,
        sandbox_request: oracle.sandbox_request,
        sandbox_receipt: oracle.sandbox_receipt,
        sandbox_result: oracle.sandbox_result,
        result_oracle_authority: oracle.result_oracle_authority,
        metamorphic_oracle_verifier: oracle.metamorphic_oracle_verifier,
      }
    : base;
}

async function expectGateReceiptHashes(receipt: GateReceiptPayload): Promise<void> {
  const inputMaterial = {
    artifact_type: receipt.artifact_type,
    sql_artifact_ref: receipt.sql_artifact_ref,
    execution_receipt_ref: receipt.execution_receipt_ref,
    gate: receipt.gate,
    gate_version: receipt.gate_version,
    evaluator_version: receipt.evaluator_version,
    evidence_refs: receipt.evidence_refs,
  };
  expect(receipt.input_hash).toBe(await computeGateInputHash(inputMaterial));
  expect(receipt.evaluation_hash).toBe(
    await computeGateEvaluationHash({
      ...inputMaterial,
      input_hash: receipt.input_hash,
      evaluator_input_hash: receipt.evaluator_input_hash,
      evaluator_evaluation_hash: receipt.evaluator_evaluation_hash,
      verdict: receipt.verdict,
      reason_code: receipt.reason_code,
      observations: receipt.observations,
      evaluated_at: receipt.evaluated_at,
    }),
  );
  expect(gateReceiptSchema.parse(receipt)).toEqual(receipt);
  expect(Object.isFrozen(receipt)).toBe(true);
}

describe("Text2SQL 七道 Gate 矩阵", () => {
  it("commerce 链产生品牌化 LogicalPlan 与 PostgreSQL compilation", async () => {
    const fixture = await commerceCompilationFixture();

    expect(isValidatedLogicalPlan(fixture.logicalPlan)).toBe(true);
    expect(isPostgresqlCompilation(fixture.compilation)).toBe(true);
    expect(fixture.compilation).toMatchObject({
      dialect: "postgresql",
      proof: {
        dialect: "postgresql",
        grounding_hash: fixture.grounding.grounding_hash,
        policy_version: fixture.grounding.policy_version,
      },
    });
    expect(Object.isFrozen(fixture.logicalPlan)).toBe(true);
    expect(Object.isFrozen(fixture.compilation)).toBe(true);
  });

  it("执行前五道 Gate 全部 PASS 后才能封存 ExecutionPermit", async () => {
    const fixture = await commerceCompilationFixture();
    const suite = await evaluatePreExecutionGates(await preExecutionInput(fixture));

    expect(
      suite.gates.map(({ gate, verdict, reason_code: reasonCode }) => ({
        gate,
        verdict,
        reasonCode,
      })),
    ).toEqual([
      { gate: "INTENT", verdict: "PASS", reasonCode: "INTENT_VERIFIED" },
      { gate: "SEMANTIC", verdict: "PASS", reasonCode: "SEMANTIC_VERIFIED" },
      { gate: "STRUCTURAL", verdict: "PASS", reasonCode: "STRUCTURAL_VERIFIED" },
      { gate: "POLICY", verdict: "PASS", reasonCode: "POLICY_VERIFIED" },
      { gate: "RESOURCE", verdict: "PASS", reasonCode: "RESOURCE_VERIFIED" },
    ]);
    expect(suite.permit_eligible).toBe(true);
    expect(Object.isFrozen(suite)).toBe(true);
    expect(Object.isFrozen(suite.gates)).toBe(true);
    expect(
      suite.gates.every(
        (evaluation) =>
          artifactReferenceIdentity(evaluation.sql_artifact_ref) ===
            artifactReferenceIdentity(sqlArtifactReference) &&
          evaluation.execution_receipt_ref === null,
      ),
    ).toBe(true);

    await persistGateReceipts(fixture.store, suite.gates, preGateReceiptReferences, null);
    const permit = await sealExecutionPermit({
      authority: fixture.store.authority,
      sql_artifact_ref: sqlArtifactReference,
      pre_execution_suite: suite,
      gate_receipt_refs: preGateReceiptReferences,
    });
    expect(executionPermitSchema.parse(permit)).toEqual(permit);
    expect(permit.budget).toEqual({
      timeout_ms: resourcePolicy.statement_timeout_ms,
      lock_timeout_ms: resourcePolicy.lock_timeout_ms,
      max_rows: resourcePolicy.max_rows,
      max_bytes: resourcePolicy.max_bytes,
      max_memory_mb: resourcePolicy.max_memory_mb,
    });
    expect(permit).toMatchObject({
      issued_at: permitTimes.now,
      expires_at: permitTimes.expiresAt,
    });
    const permitAtLimit = executionPermitSchema.parse({
      ...permit,
      budget: {
        ...permit.budget,
        max_rows: SANDBOX_RESULT_LIMITS.max_rows,
        max_bytes: SANDBOX_RESULT_LIMITS.max_bytes,
        max_memory_mb: SANDBOX_RESULT_LIMITS.max_memory_mb,
      },
    });
    expect(
      executionPermitSchema.safeParse({
        ...permitAtLimit,
        budget: {
          ...permitAtLimit.budget,
          max_memory_mb: SANDBOX_RESULT_LIMITS.max_memory_mb + 1,
        },
      }).success,
    ).toBe(false);
    expect(Object.isFrozen(permit)).toBe(true);
  });

  it("ResourcePolicy、Admission、Permit 与 Sandbox 共用行数、字节数和内存上限", async () => {
    const policyAtLimit = resourcePolicySchema.parse({
      ...resourcePolicy,
      max_rows: SANDBOX_RESULT_LIMITS.max_rows,
      max_bytes: SANDBOX_RESULT_LIMITS.max_bytes,
      max_memory_mb: SANDBOX_RESULT_LIMITS.max_memory_mb,
    });
    expect(
      resourcePolicySchema.safeParse({
        ...policyAtLimit,
        max_rows: SANDBOX_RESULT_LIMITS.max_rows + 1,
      }).success,
    ).toBe(false);
    expect(
      resourcePolicySchema.safeParse({
        ...policyAtLimit,
        max_bytes: SANDBOX_RESULT_LIMITS.max_bytes + 1,
      }).success,
    ).toBe(false);
    expect(
      resourcePolicySchema.safeParse({
        ...policyAtLimit,
        max_memory_mb: SANDBOX_RESULT_LIMITS.max_memory_mb + 1,
      }).success,
    ).toBe(false);
    expect(TEXT2SQL_SQL_SANDBOX_MAX_MEMORY_MB).toBe(SANDBOX_RESULT_LIMITS.max_memory_mb);

    const fixture = await commerceCompilationFixture();
    const admission = await resourceAdmission(fixture, fixture.resourceEstimate, policyAtLimit);
    if (!admission) throw new Error("测试 Fixture 应生成 ResourceAdmissionReceipt。");
    expect(admission.receipt).toMatchObject({
      max_rows: SANDBOX_RESULT_LIMITS.max_rows,
      max_bytes: SANDBOX_RESULT_LIMITS.max_bytes,
      max_memory_mb: SANDBOX_RESULT_LIMITS.max_memory_mb,
    });
    const rowsOverflow = resourceAdmissionReceiptSchema.safeParse({
      ...admission.receipt,
      max_rows: SANDBOX_RESULT_LIMITS.max_rows + 1,
    });
    expect(rowsOverflow.success).toBe(false);
    if (!rowsOverflow.success) {
      expect(rowsOverflow.error.issues.some(({ path }) => path[0] === "max_rows")).toBe(true);
    }
    const bytesOverflow = resourceAdmissionReceiptSchema.safeParse({
      ...admission.receipt,
      max_bytes: SANDBOX_RESULT_LIMITS.max_bytes + 1,
    });
    expect(bytesOverflow.success).toBe(false);
    if (!bytesOverflow.success) {
      expect(bytesOverflow.error.issues.some(({ path }) => path[0] === "max_bytes")).toBe(true);
    }
    const memoryOverflow = resourceAdmissionReceiptSchema.safeParse({
      ...admission.receipt,
      max_memory_mb: SANDBOX_RESULT_LIMITS.max_memory_mb + 1,
    });
    expect(memoryOverflow.success).toBe(false);
    if (!memoryOverflow.success) {
      expect(memoryOverflow.error.issues.some(({ path }) => path[0] === "max_memory_mb")).toBe(
        true,
      );
    }
  });

  it("RESOURCE Receipt 保留真实 PostgreSQL Node Type，并要求唯一且有序", async () => {
    const fixture = await commerceCompilationFixture();
    const admission = await resourceAdmission(fixture);
    if (!admission) throw new Error("测试 Fixture 应生成 ResourceAdmissionReceipt。");

    expect(admission.receipt.node_types).toEqual(["Aggregate", "Hash Join", "Seq Scan"]);
    expect(admission.receipt.forbidden_node_types).toEqual(["Nested Loop"]);
    for (const nodeTypes of [
      ["Hash Join", "Aggregate", "Seq Scan"],
      ["Aggregate", "Hash Join", "Hash Join"],
    ]) {
      const parsed = resourceAdmissionReceiptSchema.safeParse({
        ...admission.receipt,
        node_types: nodeTypes,
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues.some(({ path }) => path[0] === "node_types")).toBe(true);
      }
    }
  });

  it("不能把两次合法评估中的 PASS Gate 拼接成伪造 Suite", async () => {
    const fixture = await commerceCompilationFixture();
    const first = await evaluatePreExecutionGates(await preExecutionInput(fixture));
    const second = await evaluatePreExecutionGates(
      await preExecutionInput(fixture, {
        ...fixture.resourceEstimate,
        total_cost: fixture.resourceEstimate.total_cost + 1,
      }),
    );
    const forgedSuite = {
      state: "EVALUATED",
      gates: [second.gates[0], second.gates[1], first.gates[2], second.gates[3], first.gates[4]],
      permit_eligible: true,
    } as const;

    const store = gateArtifactStore();
    await expect(
      sealExecutionPermit({
        authority: store.authority,
        sql_artifact_ref: sqlArtifactReference,
        pre_execution_suite: forgedSuite,
        gate_receipt_refs: preGateReceiptReferences,
      }),
    ).rejects.toThrow("TEXT2SQL_PRE_EXECUTION_GATES_NOT_ELIGIBLE");
  });

  it("缺少 EXPLAIN 时 RESOURCE 为 UNAVAILABLE 且不能签发 ExecutionPermit", async () => {
    const fixture = await commerceCompilationFixture();
    const suite = await evaluatePreExecutionGates(await preExecutionInputWithoutExplain(fixture));

    expect(suite.gates[4]).toMatchObject({
      gate: "RESOURCE",
      verdict: "UNAVAILABLE",
      reason_code: "RESOURCE_EXPLAIN_UNAVAILABLE",
    });
    expect(suite.permit_eligible).toBe(false);
    const store = gateArtifactStore();
    await expect(
      sealExecutionPermit({
        authority: store.authority,
        sql_artifact_ref: sqlArtifactReference,
        pre_execution_suite: suite,
        gate_receipt_refs: preGateReceiptReferences,
      }),
    ).rejects.toThrow("TEXT2SQL_PRE_EXECUTION_GATES_NOT_ELIGIBLE");
  });

  it("伪造的 compilation clone 丢失编译器品牌且不能获得执行资格", async () => {
    const fixture = await commerceCompilationFixture();
    const compilationClone = structuredClone(fixture.compilation);

    expect(isPostgresqlCompilation(compilationClone)).toBe(false);
    const suite = await evaluatePreExecutionGates({
      ...(await preExecutionInput(fixture)),
      compilation: compilationClone,
    });
    expect(suite.permit_eligible).toBe(false);
    expect(suite.gates[2]).toMatchObject({
      gate: "STRUCTURAL",
      verdict: "UNAVAILABLE",
      reason_code: "STRUCTURAL_COMPILER_UNAVAILABLE",
    });
  });

  it("同一 Grounding 下混用另一个有效 LogicalPlan 与旧 Compilation 时 STRUCTURAL 失败", async () => {
    const fixture = await commerceCompilationFixture();
    const alternateQueryContract = netRevenueContract({
      filters: [{ field: "orders.status", operator: "eq", value: "settled" }],
    });
    const alternateSemanticQuery = buildSemanticQuery({
      query_contract: alternateQueryContract,
      grounding: fixture.grounding,
    });
    const alternateLogicalPlanCandidate = buildLogicalPlan({
      semantic_query: alternateSemanticQuery,
      grounding: fixture.grounding,
    });
    const alternateLogicalPlanValidation = validateLogicalPlan({
      query_contract: alternateQueryContract,
      grounding: fixture.grounding,
      semantic_query: alternateSemanticQuery,
      logical_plan: alternateLogicalPlanCandidate,
    });
    if (alternateLogicalPlanValidation.state !== "VALID") {
      throw new Error(
        `替代 QueryContract 必须产生另一个有效 LogicalPlan：${alternateLogicalPlanValidation.reason_code}`,
      );
    }

    expect(isValidatedLogicalPlan(alternateLogicalPlanValidation.logical_plan)).toBe(true);
    expect(await sha256ContentHash(alternateLogicalPlanValidation.logical_plan)).not.toBe(
      fixture.compilation.proof.logical_plan_hash,
    );
    const suite = await evaluatePreExecutionGates({
      ...(await preExecutionInput(fixture)),
      query_contract: alternateQueryContract,
      semantic_query: alternateSemanticQuery,
      logical_plan: alternateLogicalPlanValidation.logical_plan,
    });

    expect(suite.gates[2]).toMatchObject({
      gate: "STRUCTURAL",
      verdict: "FAIL",
      reason_code: "STRUCTURAL_HASH_MISMATCH",
    });
    expect(suite.permit_eligible).toBe(false);
  });

  it.each([
    {
      name: "total_cost",
      patch: { total_cost: resourcePolicy.max_total_cost + 1 },
    },
    {
      name: "plan_rows",
      patch: { plan_rows: resourcePolicy.max_plan_rows + 1 },
    },
    {
      name: "planned_bytes",
      patch: { plan_rows: 1_000, plan_width: 201 },
    },
  ])("$name 超预算时 RESOURCE 必须 FAIL", async ({ patch }) => {
    const fixture = await commerceCompilationFixture();
    const suite = await evaluatePreExecutionGates(
      await preExecutionInput(fixture, {
        ...fixture.resourceEstimate,
        ...patch,
      }),
    );

    expect(suite.gates[4]).toMatchObject({
      gate: "RESOURCE",
      verdict: "FAIL",
      reason_code: "RESOURCE_BUDGET_EXCEEDED",
    });
    expect(suite.permit_eligible).toBe(false);
  });

  it.each([
    {
      name: "禁止的 EXPLAIN node",
      patch: { node_types: ["Aggregate", "Nested Loop"] },
    },
    {
      name: "笛卡尔连接",
      patch: { has_cartesian_join: true },
    },
  ])("$name 计划形状必须失败关闭", async ({ patch }) => {
    const fixture = await commerceCompilationFixture();
    const suite = await evaluatePreExecutionGates(
      await preExecutionInput(fixture, {
        ...fixture.resourceEstimate,
        ...patch,
      }),
    );

    expect(suite.gates[4]).toMatchObject({
      gate: "RESOURCE",
      verdict: "FAIL",
      reason_code: "RESOURCE_PLAN_SHAPE_FORBIDDEN",
    });
    expect(suite.permit_eligible).toBe(false);
  });

  it("普通 JSON、clone 与过期数据库上下文不能伪造 RESOURCE admission", async () => {
    const fixture = await commerceCompilationFixture();
    const trustedAdmission = await resourceAdmission(fixture);
    const plainInput = {
      ...(await preExecutionInput(fixture)),
      resource_admission: {
        policy: resourcePolicy,
        estimate: fixture.resourceEstimate,
        expected_schema_version: fixture.resourceEstimate.schema_version,
        expected_settings_hash: fixture.resourceEstimate.settings_hash,
        expected_relation_names: fixture.resourceEstimate.relation_names,
      },
    };
    const plainSuite = await evaluatePreExecutionGates(plainInput);
    const cloneSuite = await evaluatePreExecutionGates({
      ...(await preExecutionInput(fixture)),
      resource_admission: structuredClone(trustedAdmission),
    });
    const staleSchemaSuite = await evaluatePreExecutionGates({
      ...(await preExecutionInput(fixture)),
      resource_admission: await resourceAdmission(fixture, {
        ...fixture.resourceEstimate,
        query_hash: await sha256ContentHash("stale-query-context"),
      }),
    });
    const staleRelationsSuite = await evaluatePreExecutionGates({
      ...(await preExecutionInput(fixture)),
      resource_admission: await resourceAdmission(fixture, {
        ...fixture.resourceEstimate,
        relation_names: ["orders"],
      }),
    });

    for (const suite of [plainSuite, cloneSuite, staleSchemaSuite, staleRelationsSuite]) {
      expect(suite.gates[4]).toMatchObject({
        gate: "RESOURCE",
        verdict: "FAIL",
        reason_code: "RESOURCE_ESTIMATE_MISMATCH",
      });
      expect(suite.permit_eligible).toBe(false);
    }
  });

  it("GateReceipt 只能从 trusted evaluation 投影且内容 Hash 可重算", async () => {
    const fixture = await commerceCompilationFixture();
    const suite = await evaluatePreExecutionGates(await preExecutionInput(fixture));
    const receipts = await Promise.all(
      suite.gates.map((evaluation) =>
        createGateReceiptPayload({
          evaluation,
          sql_artifact_ref: sqlArtifactReference,
          execution_receipt_ref: null,
        }),
      ),
    );

    expect(receipts.map(({ gate }) => gate)).toEqual([
      "INTENT",
      "SEMANTIC",
      "STRUCTURAL",
      "POLICY",
      "RESOURCE",
    ]);
    for (const receipt of receipts) {
      await expectGateReceiptHashes(receipt);
    }

    const clonedEvaluation = structuredClone(suite.gates[0]);
    await expect(
      createGateReceiptPayload({
        evaluation: clonedEvaluation,
        sql_artifact_ref: sqlArtifactReference,
        execution_receipt_ref: null,
      }),
    ).rejects.toThrow("GATE_EVALUATION_AUTHORITY_REQUIRED");
    await expect(
      createGateReceiptPayload({
        evaluation: suite.gates[0],
        sql_artifact_ref: matrixArtifactReference("SqlArtifact", gateMatrixIds.wrongSqlArtifact),
        execution_receipt_ref: null,
      }),
    ).rejects.toThrow("GATE_EVALUATION_SQL_ARTIFACT_BINDING_MISMATCH");
  });

  it("随机、未提交、另一轮评估或篡改证据的 GateReceipt 不能签发 ExecutionPermit", async () => {
    const fixture = await commerceCompilationFixture();
    const firstSuite = await evaluatePreExecutionGates(await preExecutionInput(fixture));
    const secondSuite = await evaluatePreExecutionGates(
      await preExecutionInput(fixture, {
        ...fixture.resourceEstimate,
        total_cost: fixture.resourceEstimate.total_cost + 1,
      }),
    );
    const emptyStore = gateArtifactStore();

    await expect(
      sealExecutionPermit({
        authority: emptyStore.authority,
        sql_artifact_ref: sqlArtifactReference,
        pre_execution_suite: firstSuite,
        gate_receipt_refs: preGateReceiptReferences,
      }),
    ).rejects.toThrow("TEXT2SQL_GATE_RECEIPT_AUTHORITY_UNRESOLVED");

    await persistGateReceipts(fixture.store, secondSuite.gates, preGateReceiptReferences, null);
    await expect(
      sealExecutionPermit({
        authority: fixture.store.authority,
        sql_artifact_ref: sqlArtifactReference,
        pre_execution_suite: firstSuite,
        gate_receipt_refs: preGateReceiptReferences,
      }),
    ).rejects.toThrow("TEXT2SQL_GATE_RECEIPT_EVALUATION_MISMATCH");

    const firstReceipts = await persistGateReceipts(
      fixture.store,
      firstSuite.gates,
      preGateReceiptReferences,
      null,
    );
    const firstIntentReceipt = firstReceipts[0];
    if (!firstIntentReceipt) throw new Error("缺少 INTENT GateReceipt。");
    const forgedEvidenceReceipt = await rewriteGateReceipt(firstIntentReceipt, {
      evidence_refs: [artifactReference("QueryContract")],
    });
    fixture.store.commit(preGateReceiptReferences[0], forgedEvidenceReceipt);
    await expect(
      sealExecutionPermit({
        authority: fixture.store.authority,
        sql_artifact_ref: sqlArtifactReference,
        pre_execution_suite: firstSuite,
        gate_receipt_refs: preGateReceiptReferences,
      }),
    ).rejects.toThrow("TEXT2SQL_GATE_RECEIPT_EVALUATION_MISMATCH");
  });

  it("ResourceAdmission 慢解析导致 Gate 过期时不能返回伪新鲜 Permit", async () => {
    const fixture = await commerceCompilationFixture();
    const suite = await evaluatePreExecutionGates(await preExecutionInput(fixture));
    await persistGateReceipts(fixture.store, suite.gates, preGateReceiptReferences, null);
    const resourceAdmissionReference = suite.gates[4]?.evidence_refs.find(
      (reference) => reference.artifact_type === "ResourceAdmissionReceipt",
    );
    if (!resourceAdmissionReference) {
      throw new Error("测试 Fixture 缺少 ResourceAdmissionReceipt。");
    }
    fixture.store.advanceClockWhenResolving(resourceAdmissionReference, "2026-07-26T00:10:00.001Z");

    await expect(
      sealExecutionPermit({
        authority: fixture.store.authority,
        sql_artifact_ref: sqlArtifactReference,
        pre_execution_suite: suite,
        gate_receipt_refs: preGateReceiptReferences,
      }),
    ).rejects.toThrow("TEXT2SQL_GATE_RECEIPT_STALE");
  });

  it("ExecutionPermit 拒绝重复、错误类型、跨 Scope 与换绑的 Gate 引用", async () => {
    const fixture = await commerceCompilationFixture();
    const suite = await evaluatePreExecutionGates(await preExecutionInput(fixture));
    await persistGateReceipts(fixture.store, suite.gates, preGateReceiptReferences, null);
    const duplicateReferences = [
      preGateReceiptReferences[0],
      preGateReceiptReferences[0],
      preGateReceiptReferences[2],
      preGateReceiptReferences[3],
      preGateReceiptReferences[4],
    ] as const;

    await expect(
      sealExecutionPermit({
        authority: fixture.store.authority,
        sql_artifact_ref: sqlArtifactReference,
        pre_execution_suite: suite,
        gate_receipt_refs: duplicateReferences,
      }),
    ).rejects.toThrow("TEXT2SQL_GATE_RECEIPT_REFERENCE_DUPLICATED");
    await expect(
      sealExecutionPermit({
        authority: fixture.store.authority,
        sql_artifact_ref: sqlArtifactReference,
        pre_execution_suite: suite,
        gate_receipt_refs: [
          matrixArtifactReference("ExecutionReceipt", gateMatrixIds.preGateReceipts[0]),
          preGateReceiptReferences[1],
          preGateReceiptReferences[2],
          preGateReceiptReferences[3],
          preGateReceiptReferences[4],
        ],
      }),
    ).rejects.toThrow("TEXT2SQL_GATERECEIPT_REFERENCE_REQUIRED");
    await expect(
      sealExecutionPermit({
        authority: fixture.store.authority,
        sql_artifact_ref: sqlArtifactReference,
        pre_execution_suite: suite,
        gate_receipt_refs: [
          {
            ...preGateReceiptReferences[0],
            tenant_id: gateMatrixIds.wrongTenant,
          },
          preGateReceiptReferences[1],
          preGateReceiptReferences[2],
          preGateReceiptReferences[3],
          preGateReceiptReferences[4],
        ],
      }),
    ).rejects.toThrow("TEXT2SQL_GATE_RECEIPT_SCOPE_MISMATCH");
    await expect(
      sealExecutionPermit({
        authority: fixture.store.authority,
        sql_artifact_ref: matrixArtifactReference("SqlArtifact", gateMatrixIds.wrongSqlArtifact),
        pre_execution_suite: suite,
        gate_receipt_refs: preGateReceiptReferences,
      }),
    ).rejects.toThrow("TEXT2SQL_GATE_EVALUATION_SQL_ARTIFACT_MISMATCH");
  });

  it("权威 SandboxReceipt、ExecutionReceipt 与 ResultOracle 使执行后两道 Gate PASS", async () => {
    const fixture = await executableFixture();
    const suite = await evaluatePostExecutionGates(
      postExecutionInput(fixture, await passingResultOracle(fixture)),
    );

    expect(
      suite.gates.map(({ gate, verdict, reason_code: reasonCode }) => ({
        gate,
        verdict,
        reasonCode,
      })),
    ).toEqual([
      { gate: "EXECUTION", verdict: "PASS", reasonCode: "EXECUTION_VERIFIED" },
      { gate: "RESULT", verdict: "PASS", reasonCode: "RESULT_VERIFIED" },
    ]);
    expect(suite.validation_eligible).toBe(true);
    expect(
      suite.gates.every(
        (evaluation) =>
          artifactReferenceIdentity(evaluation.sql_artifact_ref) ===
            artifactReferenceIdentity(sqlArtifactReference) &&
          evaluation.execution_receipt_ref !== null &&
          artifactReferenceIdentity(evaluation.execution_receipt_ref) ===
            artifactReferenceIdentity(executionReference),
      ),
    ).toBe(true);
  });

  it("独立 Metamorphic verifier 的权威 FAIL 必须传播到 ResultOracle 与 RESULT Gate", async () => {
    const fixture = await executableFixture();
    const suite = await evaluatePostExecutionGates(
      postExecutionInput(
        fixture,
        await passingResultOracle(fixture, {
          metamorphic_relation_rows: {
            fan_out: [
              ["new", 240],
              ["returning", 80],
            ],
          },
        }),
      ),
    );

    expect(suite.gates[0].verdict).toBe("PASS");
    expect(suite.gates[1]).toMatchObject({
      gate: "RESULT",
      verdict: "FAIL",
      reason_code: "RESULT_METAMORPHIC_FAILED",
    });
    expect(suite.validation_eligible).toBe(false);
  });

  it("缺少或克隆 Metamorphic verifier 时 Result producer 不能单独自签 PASS", async () => {
    const fixture = await executableFixture();
    const oracle = await passingResultOracle(fixture);
    const {
      metamorphic_oracle_verifier: _metamorphicOracleVerifier,
      ...inputWithoutMetamorphicVerifier
    } = {
      ...postExecutionInput(fixture, oracle),
      metamorphic_oracle_verifier: oracle.metamorphic_oracle_verifier,
    };
    const missing = await evaluatePostExecutionGates({
      ...inputWithoutMetamorphicVerifier,
    });
    const cloned = await evaluatePostExecutionGates({
      ...inputWithoutMetamorphicVerifier,
      metamorphic_oracle_verifier: {
        verify: oracle.metamorphic_oracle_verifier.verify,
      },
    });

    for (const suite of [missing, cloned]) {
      expect(suite.gates[0].verdict).toBe("PASS");
      expect(suite.gates[1]).toMatchObject({
        gate: "RESULT",
        verdict: "UNAVAILABLE",
        reason_code: "RESULT_ORACLE_UNAVAILABLE",
      });
      expect(suite.validation_eligible).toBe(false);
    }
  });

  it("通用 Artifact Store 中的 ResultOracle 镜像不能绕过专用 System Store", async () => {
    const fixture = await executableFixture();
    const oracle = await passingResultOracle(fixture, {
      result_store_mode: "GENERIC_ONLY",
    });
    const suite = await evaluatePostExecutionGates(postExecutionInput(fixture, oracle));

    expect(suite.gates[0].verdict).toBe("PASS");
    expect(suite.gates[1]).toMatchObject({
      gate: "RESULT",
      verdict: "UNAVAILABLE",
      reason_code: "RESULT_ORACLE_UNAVAILABLE",
    });
    expect(suite.validation_eligible).toBe(false);
  });

  it.each([
    ["EXACT_REVISION_REJECTED", "专用 Store 拒绝 exact revision"],
    ["REFERENCE_PAYLOAD_MISMATCH", "专用 Store 返回 Reference A/Payload B"],
  ] as const)("%s：%s 时 RESULT 失败关闭", async (resultStoreMode, _description) => {
    const fixture = await executableFixture();
    const oracle = await passingResultOracle(fixture, {
      result_store_mode: resultStoreMode,
    });
    const suite = await evaluatePostExecutionGates(postExecutionInput(fixture, oracle));

    expect(suite.gates[0].verdict).toBe("PASS");
    expect(suite.gates[1]).toMatchObject({
      gate: "RESULT",
      verdict: "UNAVAILABLE",
      reason_code: "RESULT_ORACLE_UNAVAILABLE",
    });
    expect(suite.validation_eligible).toBe(false);
  });

  it("同一 issuer 的不同 wrapper 不能同时充当 Result producer 与 Metamorphic verifier", async () => {
    const fixture = await executableFixture();
    const oracle = await passingResultOracle(fixture);
    const sharedIssuer = {
      identity: oracle.metamorphic_oracle_verifier.identity,
      ...oracle.result_oracle_store_adapter,
      async evaluate() {
        return oracle.result_oracle_receipt_ref;
      },
    };
    const suite = await evaluatePostExecutionGates({
      ...postExecutionInput(fixture, oracle),
      result_oracle_authority: registerTrustedResultOracleAuthority(sharedIssuer),
      metamorphic_oracle_verifier: oracle.metamorphic_oracle_verifier,
    });

    expect(suite.gates[0].verdict).toBe("PASS");
    expect(suite.gates[1]).toMatchObject({
      gate: "RESULT",
      verdict: "UNAVAILABLE",
      reason_code: "RESULT_ORACLE_UNAVAILABLE",
    });
    expect(suite.validation_eligible).toBe(false);
  });

  it("缺少 ResultOracle 时 RESULT 为 UNAVAILABLE 且不能封 ValidationReceipt", async () => {
    const fixture = await executableFixture();
    const suite = await evaluatePostExecutionGates(postExecutionInput(fixture));

    expect(suite.gates[0]).toMatchObject({
      gate: "EXECUTION",
      verdict: "PASS",
      reason_code: "EXECUTION_VERIFIED",
    });
    expect(suite.gates[1]).toMatchObject({
      gate: "RESULT",
      verdict: "UNAVAILABLE",
      reason_code: "RESULT_ORACLE_UNAVAILABLE",
    });
    expect(suite.validation_eligible).toBe(false);
    await expect(
      createGateReceiptPayload({
        evaluation: suite.gates[1],
        sql_artifact_ref: sqlArtifactReference,
        execution_receipt_ref: executionReference,
      }),
    ).resolves.toMatchObject({
      gate: "RESULT",
      verdict: "UNAVAILABLE",
      evidence_refs: [executionReference],
    });
    fixture.store.setNow(permitTimes.sealedAt);
    await expect(
      sealValidationReceipt({
        authority: fixture.store.authority,
        sql_artifact_ref: sqlArtifactReference,
        execution_receipt_ref: executionReference,
        pre_execution_suite: fixture.preExecutionSuite,
        post_execution_suite: suite,
        gate_receipt_refs: [...preGateReceiptReferences, ...postGateReceiptReferences],
      }),
    ).rejects.toThrow("TEXT2SQL_VALIDATION_GATES_NOT_ELIGIBLE");
  });

  it("普通 ResultOracle callback 没有内部品牌，不能自签 RESULT PASS", async () => {
    const fixture = await executableFixture();
    const suite = await evaluatePostExecutionGates({
      ...postExecutionInput(fixture),
      result_oracle_authority: {
        async evaluate() {
          throw new Error("普通 callback 不应被调用。");
        },
      },
    });

    expect(suite.gates[0].verdict).toBe("PASS");
    expect(suite.gates[1]).toMatchObject({
      gate: "RESULT",
      verdict: "UNAVAILABLE",
      reason_code: "RESULT_ORACLE_UNAVAILABLE",
    });
    expect(suite.validation_eligible).toBe(false);
  });

  it.each([
    {
      name: "执行超时",
      kind: "timeout",
      reasonCode: "EXECUTION_TIMEOUT",
    },
    {
      name: "结果行数超限",
      kind: "rows",
      reasonCode: "EXECUTION_RESULT_CAP_EXCEEDED",
    },
    {
      name: "结果字节超限",
      kind: "bytes",
      reasonCode: "EXECUTION_RESULT_CAP_EXCEEDED",
    },
  ] as const)("$name 的伪成功回执必须被 Sandbox Authority 拒绝", async ({ kind }) => {
    const rows =
      kind === "rows"
        ? Array.from(
            { length: resourcePolicy.max_rows + 1 },
            (_, index) => [`segment-${index}`, index] as const,
          )
        : kind === "bytes"
          ? [[`segment-${"x".repeat(resourcePolicy.max_bytes + 1)}`, 1] as const]
          : undefined;
    await expect(
      executableFixture({
        elapsed_ms: kind === "timeout" ? resourcePolicy.statement_timeout_ms + 1 : 50,
        ...(kind === "timeout" ? { completed_at: "2026-07-26T00:00:15.001Z" } : {}),
        ...(rows ? { rows } : {}),
      }),
    ).rejects.toThrow("Sandbox 成功 Receipt");
  });

  it("权威墙钟跨度超过 Timeout Budget 时不能用较小 elapsed_ms 伪装成功", async () => {
    await expect(
      executableFixture({
        started_at: "2026-07-26T00:00:10.000Z",
        completed_at: "2026-07-26T01:00:10.000Z",
        observed_at: "2026-07-26T01:00:10.000Z",
        elapsed_ms: 1_000,
      }),
    ).rejects.toThrow("Sandbox 成功 Receipt");
  });

  it("请求内存超过 512MB 系统上限时在 Sandbox Request 边界失败", async () => {
    await expect(
      executableFixture({
        max_memory_mb: TEXT2SQL_SQL_SANDBOX_MAX_MEMORY_MB + 1,
      }),
    ).rejects.toThrow();
  });

  it.each([
    {
      name: "实际峰值内存超过请求预算",
      options: { max_memory_mb: 64, peak_memory_mb: 65 },
    },
    {
      name: "SandboxResult schema 与执行环境漂移",
      options: { result_schema_version: "commerce-schema@2.0.0" },
    },
  ] as const)("$name 的伪成功回执必须被 Sandbox Authority 拒绝", async ({ options }) => {
    await expect(executableFixture(options)).rejects.toThrow("Sandbox 成功 Receipt");
  });

  it("ExecutionReceipt 的 Query Hash 或 Sandbox 绑定漂移时 EXECUTION Gate 失败", async () => {
    const fixture = await executableFixture();
    const hashMismatchOracle = await passingResultOracle(fixture);
    const wrongQueryHashReceipt = executionReceiptSchema.parse({
      ...hashMismatchOracle.execution_receipt,
      query_hash: await sha256ContentHash("wrong-query"),
    });
    fixture.store.commit(executionReference, wrongQueryHashReceipt);
    const hashMismatch = await evaluatePostExecutionGates(
      postExecutionInput(fixture, hashMismatchOracle),
    );
    expect(hashMismatch.gates[0]).toMatchObject({
      verdict: "FAIL",
      reason_code: "EXECUTION_HASH_MISMATCH",
    });

    const bindingMismatchOracle = await passingResultOracle(fixture);
    const sandboxBindingMismatch = executionReceiptSchema.parse({
      ...bindingMismatchOracle.execution_receipt,
      sandbox_execution_receipt_ref: matrixArtifactReference(
        "SandboxExecutionReceipt",
        "10000000-0000-4000-8000-000000000108",
      ),
    });
    fixture.store.commit(executionReference, sandboxBindingMismatch);
    const bindingMismatch = await evaluatePostExecutionGates(
      postExecutionInput(fixture, bindingMismatchOracle),
    );
    expect(bindingMismatch.gates[0]).toMatchObject({
      verdict: "FAIL",
      reason_code: "EXECUTION_PERMIT_INVALID",
    });
  });

  it("Permit 到期前合法开始的事务可在到期后完成，由 Timeout Budget 约束时长", async () => {
    const fixture = await executableFixture({
      started_at: "2026-07-26T00:04:59.000Z",
      completed_at: "2026-07-26T00:05:01.000Z",
      observed_at: "2026-07-26T00:05:01.000Z",
      elapsed_ms: 2_000,
    });
    const suite = await evaluatePostExecutionGates(
      postExecutionInput(fixture, await passingResultOracle(fixture)),
    );

    expect(suite.gates[0]).toMatchObject({
      verdict: "PASS",
      reason_code: "EXECUTION_VERIFIED",
    });
    expect(suite.validation_eligible).toBe(true);
  });

  it("未注册的 Artifact Authority 不能把手工 Payload 升级成执行事实", async () => {
    const fixture = await executableFixture();
    await expect(
      evaluatePostExecutionGates({
        ...postExecutionInput(fixture, await passingResultOracle(fixture)),
        artifact_authority: {
          async resolveArtifact() {
            return structuredClone(fixture.executionReceipt);
          },
          async verifyCommitted() {
            return true;
          },
          now: () => permitTimes.observedAt,
        },
      }),
    ).rejects.toThrow("TEXT2SQL_GATE_ARTIFACT_AUTHORITY_REQUIRED");
  });

  it("ResultOracle 与 ExecutionReceipt 的 Result Hash 不一致时 RESULT Gate 失败", async () => {
    const fixture = await executableFixture();
    const wrongResultHash = await sha256ContentHash("wrong-result");
    const suite = await evaluatePostExecutionGates(
      postExecutionInput(
        fixture,
        await passingResultOracle(fixture, { result_hash: wrongResultHash }),
      ),
    );

    expect(suite.gates[0].verdict).toBe("PASS");
    expect(suite.gates[1]).toMatchObject({
      gate: "RESULT",
      verdict: "FAIL",
      reason_code: "RESULT_BINDING_MISMATCH",
    });
    expect(suite.validation_eligible).toBe(false);
  });

  it("七道 trusted PASS 可投影 GateReceipt 并封存 ValidationReceipt", async () => {
    const fixture = await executableFixture();
    const postExecutionSuite = await evaluatePostExecutionGates(
      postExecutionInput(fixture, await passingResultOracle(fixture)),
    );
    const postGateReceipts = await persistGateReceipts(
      fixture.store,
      postExecutionSuite.gates,
      postGateReceiptReferences,
      executionReference,
    );
    for (const receipt of [...fixture.preGateReceipts, ...postGateReceipts]) {
      await expectGateReceiptHashes(receipt);
    }

    fixture.store.setNow(permitTimes.sealedAt);
    const validationReceipt = await sealValidationReceipt({
      authority: fixture.store.authority,
      sql_artifact_ref: sqlArtifactReference,
      execution_receipt_ref: executionReference,
      pre_execution_suite: fixture.preExecutionSuite,
      post_execution_suite: postExecutionSuite,
      gate_receipt_refs: [...preGateReceiptReferences, ...postGateReceiptReferences],
    });

    expect(validationReceiptSchema.parse(validationReceipt)).toEqual(validationReceipt);
    expect(validationReceipt).toMatchObject({
      artifact_type: "ValidationReceipt",
      sql_artifact_ref: sqlArtifactReference,
      execution_receipt_ref: executionReference,
      validation_version: "text2sql-validation@2.0.0",
      sealed_at: permitTimes.sealedAt,
    });
    expect(validationReceipt.gate_receipt_refs).toHaveLength(7);
    expect(Object.isFrozen(validationReceipt)).toBe(true);
  });

  it("ValidationReceipt 拒绝时钟回拨形成的 RESULT 早于 EXECUTION Gate", async () => {
    const fixture = await executableFixture();
    const oracle = await passingResultOracle(fixture, {
      authority_time_on_evaluate: permitTimes.observedAt,
    });
    fixture.store.setNow("2026-07-26T00:01:01.000Z");
    const postExecutionSuite = await evaluatePostExecutionGates(
      postExecutionInput(fixture, oracle),
    );
    expect(postExecutionSuite.validation_eligible).toBe(true);
    await persistGateReceipts(
      fixture.store,
      postExecutionSuite.gates,
      postGateReceiptReferences,
      executionReference,
    );
    fixture.store.setNow(permitTimes.sealedAt);

    await expect(
      sealValidationReceipt({
        authority: fixture.store.authority,
        sql_artifact_ref: sqlArtifactReference,
        execution_receipt_ref: executionReference,
        pre_execution_suite: fixture.preExecutionSuite,
        post_execution_suite: postExecutionSuite,
        gate_receipt_refs: [...preGateReceiptReferences, ...postGateReceiptReferences],
      }),
    ).rejects.toThrow("TEXT2SQL_POST_EXECUTION_GATE_TIME_ORDER_INVALID");
  });

  it("ValidationReceipt 拒绝重复、错误类型与 ExecutionReceipt 换绑", async () => {
    const fixture = await executableFixture();
    const postExecutionSuite = await evaluatePostExecutionGates(
      postExecutionInput(fixture, await passingResultOracle(fixture)),
    );
    await persistGateReceipts(
      fixture.store,
      postExecutionSuite.gates,
      postGateReceiptReferences,
      executionReference,
    );
    fixture.store.setNow(permitTimes.sealedAt);

    await expect(
      sealValidationReceipt({
        authority: fixture.store.authority,
        sql_artifact_ref: sqlArtifactReference,
        execution_receipt_ref: executionReference,
        pre_execution_suite: fixture.preExecutionSuite,
        post_execution_suite: postExecutionSuite,
        gate_receipt_refs: [
          ...preGateReceiptReferences,
          postGateReceiptReferences[0],
          postGateReceiptReferences[0],
        ],
      }),
    ).rejects.toThrow("TEXT2SQL_GATE_RECEIPT_REFERENCE_DUPLICATED");
    await expect(
      sealValidationReceipt({
        authority: fixture.store.authority,
        sql_artifact_ref: sqlArtifactReference,
        execution_receipt_ref: executionReference,
        pre_execution_suite: fixture.preExecutionSuite,
        post_execution_suite: postExecutionSuite,
        gate_receipt_refs: [
          ...preGateReceiptReferences,
          matrixArtifactReference("ExecutionPermit", gateMatrixIds.postGateReceipts[0]),
          postGateReceiptReferences[1],
        ],
      }),
    ).rejects.toThrow("TEXT2SQL_GATERECEIPT_REFERENCE_REQUIRED");
    await expect(
      sealValidationReceipt({
        authority: fixture.store.authority,
        sql_artifact_ref: sqlArtifactReference,
        execution_receipt_ref: matrixArtifactReference(
          "ExecutionReceipt",
          gateMatrixIds.wrongExecution,
        ),
        pre_execution_suite: fixture.preExecutionSuite,
        post_execution_suite: postExecutionSuite,
        gate_receipt_refs: [...preGateReceiptReferences, ...postGateReceiptReferences],
      }),
    ).rejects.toThrow("TEXT2SQL_EXECUTION_RECEIPT_AUTHORITY_UNRESOLVED");
  });

  it("ValidationReceipt 拒绝调用方重写执行后 GateReceipt 的证据或评估时间", async () => {
    const fixture = await executableFixture();
    const postExecutionSuite = await evaluatePostExecutionGates(
      postExecutionInput(fixture, await passingResultOracle(fixture)),
    );
    fixture.store.setNow(permitTimes.sealedAt);

    const projectedReceipts = await persistGateReceipts(
      fixture.store,
      postExecutionSuite.gates,
      postGateReceiptReferences,
      executionReference,
    );
    const projectedExecutionReceipt = projectedReceipts[0];
    if (!projectedExecutionReceipt) throw new Error("缺少 EXECUTION GateReceipt。");
    fixture.store.commit(
      postGateReceiptReferences[0],
      await rewriteGateReceipt(projectedExecutionReceipt, {
        evidence_refs: [fixture.sandboxReceipt.receipt_ref],
      }),
    );
    await expect(
      sealValidationReceipt({
        authority: fixture.store.authority,
        sql_artifact_ref: sqlArtifactReference,
        execution_receipt_ref: executionReference,
        pre_execution_suite: fixture.preExecutionSuite,
        post_execution_suite: postExecutionSuite,
        gate_receipt_refs: [...preGateReceiptReferences, ...postGateReceiptReferences],
      }),
    ).rejects.toThrow("TEXT2SQL_GATE_RECEIPT_EVALUATION_MISMATCH");

    const reprojectedReceipts = await persistGateReceipts(
      fixture.store,
      postExecutionSuite.gates,
      postGateReceiptReferences,
      executionReference,
    );
    const reprojectedExecutionReceipt = reprojectedReceipts[0];
    if (!reprojectedExecutionReceipt) throw new Error("缺少 EXECUTION GateReceipt。");
    fixture.store.commit(
      postGateReceiptReferences[0],
      await rewriteGateReceipt(reprojectedExecutionReceipt, {
        evaluated_at: "2026-07-26T00:00:30.000Z",
      }),
    );
    await expect(
      sealValidationReceipt({
        authority: fixture.store.authority,
        sql_artifact_ref: sqlArtifactReference,
        execution_receipt_ref: executionReference,
        pre_execution_suite: fixture.preExecutionSuite,
        post_execution_suite: postExecutionSuite,
        gate_receipt_refs: [...preGateReceiptReferences, ...postGateReceiptReferences],
      }),
    ).rejects.toThrow("TEXT2SQL_GATE_RECEIPT_EVALUATION_MISMATCH");
  });
});
