import {
  type ArtifactReference,
  AUTHORITY_ROLE_POLICY_VERSION,
  artifactReferenceSchema,
  type ContentHash,
  collectL2ResearchPayloadArtifactReferences,
  computeL2ArtifactContentHash,
  computeL2ResearchEnvelopeContentHash,
  computeL2ResearchSemanticHash,
  computeSandboxExecutionReceiptHash,
  computeSandboxResultBytes,
  computeSandboxResultHash,
  computeSqlArtifactQueryHash,
  contentHashSchema,
  L2_RESEARCH_WIRE_VERSION_MATRIX,
  type L2ArtifactDocument,
  type L2ResearchDocumentCandidate,
  l2ArtifactDocumentSchema,
  parseL2ResearchDocumentCandidate,
  proofObligationRefSchema,
  type ResearchBudgetLedgerBinding,
  type SandboxResult,
  type SuccessfulSandboxExecutionReceipt,
  sandboxResultSchema,
  sha256ContentHash,
  successfulSandboxExecutionReceiptSchema,
  TEXT2SQL_VALIDATION_VERSION,
  type VersionFrontier,
} from "@data-agent/contracts";
import {
  type AtomicClaimDocumentResolution,
  type DeriveCoverageStateInput,
  deriveCoverageStateCandidate,
  type EvidenceCheckDocumentResolution,
  type EvidenceRelationDocumentResolution,
  type HypothesisAssessmentDocumentResolution,
  type ObligationExecutionDecisionDocumentResolution,
  type QueryEvidenceDocumentResolution,
  type SupportDecisionDocumentResolution,
} from "../src/coverage.js";
import type { ResearchKernelResult } from "../src/errors.js";
import {
  ATOMIC_CLAIM_RENDERER_VERSION,
  type BuildAtomicClaimCandidateInput,
  type BuildEvidenceCheckCandidateInput,
  type BuildEvidenceRelationCandidateInput,
  type BuildHypothesisAssessmentCandidateInput,
  type BuildObligationExecutionDecisionCandidateInput,
  type BuildQueryEvidenceCandidateInput,
  type BuildSupportDecisionCandidateInput,
  buildAtomicClaimCandidate,
  buildEvidenceCheckCandidate,
  buildEvidenceRelationCandidate,
  buildHypothesisAssessmentCandidate,
  buildObligationExecutionDecisionCandidate,
  buildQueryEvidenceCandidate,
  buildSupportDecisionCandidate,
  type ClaimObservationSource,
  type ResolvedProofObligation,
} from "../src/evidence-builders.js";
import {
  compileEvidencePlanCandidate,
  compileHypothesisSetCandidate,
  compileResearchBriefCandidate,
} from "../src/planning.js";
import { issueTransientOedAssuranceForControlledKernel } from "../src/server/oed-assurance.js";
import {
  type DeriveResearchStopDecisionInput,
  deriveResearchStopDecisionFromDocumentsCandidate,
} from "../src/stop.js";

export const DOCUMENT_FIXTURE_SCOPE = {
  app_id: "00000000-0000-4000-8000-000000000001",
  tenant_id: "00000000-0000-4000-8000-000000000002",
  environment: "test",
} as const;

export const DOCUMENT_FIXTURE_RUN_ID = "00000000-0000-4000-8000-000000000003";

const FIXTURE_EPOCH_MS = Date.parse("2026-07-27T00:00:00.000Z");
const MAX_FIXTURE_SEED = 49_999_999_999;
const MAX_UUID_TAIL = 999_999_999_999;

type ResearchPayload = L2ResearchDocumentCandidate["payload"];
type ArtifactType = ArtifactReference["artifact_type"];
type ExactArtifactReference<T extends ArtifactType> = ArtifactReference & {
  readonly artifact_type: T;
};

function checkedSeed(seed: number): number {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > MAX_FIXTURE_SEED) {
    throw new RangeError(`document fixture seed 必须是 0..${MAX_FIXTURE_SEED} 的安全整数。`);
  }
  return seed;
}

function fixtureUuid(seed: number): string {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > MAX_UUID_TAIL) {
    throw new RangeError(`fixture UUID tail 必须是 0..${MAX_UUID_TAIL} 的安全整数。`);
  }
  return `00000000-0000-4000-8000-${String(seed).padStart(12, "0")}`;
}

function fixtureTimestamp(seed: number): string {
  return new Date(FIXTURE_EPOCH_MS + checkedSeed(seed) * 1_000).toISOString();
}

function researchEnvelopeSchemaVersion(payload: ResearchPayload): string {
  const tuple = L2_RESEARCH_WIRE_VERSION_MATRIX.find(
    ([artifactType, , protocolVersion]) =>
      artifactType === payload.artifact_type && protocolVersion === payload.protocol_version,
  );
  if (!tuple) {
    throw new TypeError(
      `未登记的 Research Wire tuple：${payload.artifact_type}/${payload.protocol_version}`,
    );
  }
  return tuple[1];
}

async function withExactSemanticHash(payload: ResearchPayload): Promise<ResearchPayload> {
  switch (payload.artifact_type) {
    case "ObligationExecutionDecision": {
      return {
        ...payload,
        decision_semantic_hash: await computeL2ResearchSemanticHash(payload),
      };
    }
    case "ReportReadyCertificate":
      return {
        ...payload,
        certificate_semantic_hash: await computeL2ResearchSemanticHash(payload),
      };
    case "ReadinessRevocationReceipt":
      return {
        ...payload,
        revocation_semantic_hash: await computeL2ResearchSemanticHash(payload),
      };
    default:
      return payload;
  }
}

function candidateEnvelope(
  artifactType: ArtifactType,
  seed: number,
  inputRefs: readonly ArtifactReference[],
  schemaVersion: string,
  placeholderContentHash: `sha256:${string}`,
) {
  return {
    artifact_id: fixtureUuid(seed),
    artifact_type: artifactType,
    ...DOCUMENT_FIXTURE_SCOPE,
    run_id: DOCUMENT_FIXTURE_RUN_ID,
    revision: 1,
    parent_ref: null,
    attempt_id: fixtureUuid(50_000_000_000 + checkedSeed(seed)),
    producer: {
      kind: "deterministic",
      id: "document-fixture-test",
    },
    input_refs: [...inputRefs],
    schema_version: schemaVersion,
    semantic_version: "1.0.0",
    policy_version: "1.0.0",
    model_profile_version: "1.0.0",
    content_hash: placeholderContentHash,
    status: "CANDIDATE",
    created_at: fixtureTimestamp(seed),
  } as const;
}

/**
 * 用 Research Wire 官方 collector 封装一个确定性的 test-only Candidate。
 *
 * 返回值只证明 strict wire、语义 hash 与内容寻址闭合；不证明持久化、current
 * revision、COMMITTED 或任何 authority brand。
 */
export async function sealResearchDocument(
  payloadInput: ResearchPayload,
  seed: number,
): Promise<L2ResearchDocumentCandidate> {
  const payload = await withExactSemanticHash(payloadInput);
  const inputRefs = collectL2ResearchPayloadArtifactReferences(payload);
  const placeholderContentHash = await sha256ContentHash({
    hash_domain: "u6-research-document-fixture-placeholder@1.0.0",
    seed: checkedSeed(seed),
    artifact_type: payload.artifact_type,
    protocol_version: payload.protocol_version,
  });
  const draft = parseL2ResearchDocumentCandidate({
    envelope: candidateEnvelope(
      payload.artifact_type,
      seed,
      inputRefs,
      researchEnvelopeSchemaVersion(payload),
      placeholderContentHash,
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
  }) as L2ResearchDocumentCandidate;
}

/**
 * 给少量真实 production builder closure 构造通用 L2 Candidate。
 *
 * generic L2 目前没有 Research Wire collector 等价物，因此 exact input refs 必须由
 * 调用者显式传入；helper 不做递归猜测。
 */
export async function sealL2TestDocument(
  payload: L2ArtifactDocument["payload"],
  seed: number,
  exactInputRefs: readonly ArtifactReference[],
): Promise<L2ArtifactDocument> {
  const placeholderContentHash = await sha256ContentHash({
    hash_domain: "u6-l2-document-fixture-placeholder@1.0.0",
    seed: checkedSeed(seed),
    artifact_type: payload.artifact_type,
  });
  const draft = l2ArtifactDocumentSchema.parse({
    envelope: candidateEnvelope(
      payload.artifact_type,
      seed,
      exactInputRefs,
      "1.0.0",
      placeholderContentHash,
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

export async function deriveExactResearchDocumentRef<
  const T extends ResearchPayload["artifact_type"],
>(
  documentInput: L2ResearchDocumentCandidate,
  expectedArtifactType: T,
): Promise<ExactArtifactReference<T>> {
  const document = parseL2ResearchDocumentCandidate(documentInput);
  if (
    document.envelope.artifact_type !== expectedArtifactType ||
    document.payload.artifact_type !== expectedArtifactType ||
    document.envelope.content_hash !== (await computeL2ResearchEnvelopeContentHash(document))
  ) {
    throw new TypeError(
      `Research Document exact ref 类型或 content_hash 不闭合：${expectedArtifactType}`,
    );
  }
  return {
    artifact_id: document.envelope.artifact_id,
    artifact_type: expectedArtifactType,
    app_id: document.envelope.app_id,
    tenant_id: document.envelope.tenant_id,
    environment: document.envelope.environment,
    run_id: document.envelope.run_id,
    revision: document.envelope.revision,
    content_hash: document.envelope.content_hash,
  } as ExactArtifactReference<T>;
}

export async function deriveExactL2DocumentRef<const T extends ArtifactType>(
  documentInput: L2ArtifactDocument,
  expectedArtifactType: T,
): Promise<ExactArtifactReference<T>> {
  const document = l2ArtifactDocumentSchema.parse(documentInput);
  if (
    document.envelope.artifact_type !== expectedArtifactType ||
    document.payload.artifact_type !== expectedArtifactType ||
    document.envelope.content_hash !== (await computeL2ArtifactContentHash(document))
  ) {
    throw new TypeError(
      `L2 Document exact ref 类型或 content_hash 不闭合：${expectedArtifactType}`,
    );
  }
  return {
    artifact_id: document.envelope.artifact_id,
    artifact_type: expectedArtifactType,
    app_id: document.envelope.app_id,
    tenant_id: document.envelope.tenant_id,
    environment: document.envelope.environment,
    run_id: document.envelope.run_id,
    revision: document.envelope.revision,
    content_hash: document.envelope.content_hash,
  } as ExactArtifactReference<T>;
}

/**
 * 为尚未在本 fixture 中物化为 Document 的依赖生成稳定、内容寻址的 test reference。
 *
 * 这只是结构依赖，不代表对应 Artifact 已持久化、current 或有权威性。
 */
export async function createDeterministicFixtureRef<const T extends ArtifactType>(
  artifactType: T,
  seed: number,
): Promise<ExactArtifactReference<T>> {
  const checked = checkedSeed(seed);
  const parsed = artifactReferenceSchema.parse({
    ...DOCUMENT_FIXTURE_SCOPE,
    run_id: DOCUMENT_FIXTURE_RUN_ID,
    artifact_id: fixtureUuid(checked),
    artifact_type: artifactType,
    revision: 1,
    content_hash: await sha256ContentHash({
      hash_domain: "u6-document-fixture-reference@1.0.0",
      seed: checked,
      artifact_type: artifactType,
      scope: DOCUMENT_FIXTURE_SCOPE,
      run_id: DOCUMENT_FIXTURE_RUN_ID,
    }),
  });
  return parsed as ExactArtifactReference<T>;
}

function kernelValue<T>(result: ResearchKernelResult<T>, label: string): T {
  if (!result.ok) {
    throw new Error(
      `${label} production builder 失败：${result.error.code} ${result.error.message}`,
    );
  }
  return result.value;
}

function _parsedContentHash(value: string): ContentHash {
  contentHashSchema.parse(value);
  return value as ContentHash;
}

const FIXTURE_DATASOURCE_ID = "00000000-0000-4000-8000-000000000004";
const FIXTURE_SNAPSHOT_TOKEN = "document-backed-research-fixture:r1";
const FIXTURE_EXECUTOR = {
  authority_id: "00000000-0000-4000-8000-000000000005",
  principal_id: "document-fixture-sandbox",
  key_id: "document-fixture-sandbox-key",
} as const;

async function createSandboxResult(input: {
  readonly seed: number;
  readonly execution_id: string;
  readonly output_alias: string;
  readonly value: number;
}): Promise<SandboxResult> {
  const columns = [{ name: input.output_alias, type: "NUMBER" }] as const;
  const rows = [[input.value]] as const;
  const resultRef = await createDeterministicFixtureRef("SandboxResult", input.seed);
  const draft = sandboxResultSchema.parse({
    schema_version: "document-fixture-schema-v1",
    result_ref: resultRef,
    scope: DOCUMENT_FIXTURE_SCOPE,
    run_id: DOCUMENT_FIXTURE_RUN_ID,
    execution_id: input.execution_id,
    columns,
    rows,
    row_count: rows.length,
    bytes: computeSandboxResultBytes({ columns, rows }),
    result_hash: resultRef.content_hash,
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
  readonly seed: number;
  readonly execution_id: string;
  readonly result: SandboxResult;
  readonly sql_artifact_ref: ExactArtifactReference<"SqlArtifact">;
  readonly execution_permit_ref: ExactArtifactReference<"ExecutionPermit">;
  readonly resource_admission_ref: ExactArtifactReference<"ResourceAdmissionReceipt">;
  readonly policy_receipt_ref: ExactArtifactReference<"PolicyReceipt">;
}): Promise<SuccessfulSandboxExecutionReceipt> {
  const receiptRef = await createDeterministicFixtureRef("SandboxExecutionReceipt", input.seed);
  const startedAt = fixtureTimestamp(input.seed);
  const completedAt = new Date(Date.parse(startedAt) + 10).toISOString();
  const executionSettings = {
    database_role: "research-reader",
    search_path: ["analytics"],
    plan_cache_mode: "force_custom_plan",
    statement_timeout_ms: 1_000,
    lock_timeout_ms: 100,
  } as const;
  const draft = successfulSandboxExecutionReceiptSchema.parse({
    schema_version: input.result.schema_version,
    language: "sql",
    executor: FIXTURE_EXECUTOR,
    executor_role: "SANDBOX_EXECUTION",
    authority_role_policy_version: AUTHORITY_ROLE_POLICY_VERSION,
    receipt_id: receiptRef.artifact_id,
    receipt_ref: receiptRef,
    scope: DOCUMENT_FIXTURE_SCOPE,
    run_id: DOCUMENT_FIXTURE_RUN_ID,
    execution_id: input.execution_id,
    idempotency_key: `document-fixture-${input.seed}`,
    input_hash: await sha256ContentHash({
      hash_domain: "u6-document-fixture-sandbox-input@1.0.0",
      execution_id: input.execution_id,
      sql_artifact_ref: input.sql_artifact_ref,
    }),
    execution_hash: receiptRef.content_hash,
    terminal: "COMPLETED",
    reason_code: "EXECUTION_COMPLETED",
    started_at: startedAt,
    completed_at: completedAt,
    result_artifact_ref: input.result.result_ref,
    sql_artifact_ref: input.sql_artifact_ref,
    execution_permit_ref: input.execution_permit_ref,
    resource_admission_ref: input.resource_admission_ref,
    datasource_id: FIXTURE_DATASOURCE_ID,
    settings_hash: await sha256ContentHash({
      hash_domain: "u6-document-fixture-sandbox-settings@1.0.0",
      execution_settings: executionSettings,
    }),
    execution_settings: executionSettings,
    transaction: {
      transaction_id: input.execution_id,
      read_only: true,
      isolation_level: "REPEATABLE_READ",
    },
    authority_revalidation: {
      effective_principal_id: FIXTURE_EXECUTOR.principal_id,
      policy_receipt_ref: input.policy_receipt_ref,
      revalidated_at: startedAt,
      authority_epoch: 1,
    },
    snapshot_token: FIXTURE_SNAPSHOT_TOKEN,
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

interface BuildQueryFixtureInput {
  readonly seed: number;
  readonly plan_document: L2ResearchDocumentCandidate;
  readonly brief_document: L2ResearchDocumentCandidate;
  readonly semantic_release_ref: ExactArtifactReference<"SemanticRelease">;
  readonly policy_receipt_ref: ExactArtifactReference<"PolicyReceipt">;
  readonly version_frontier: VersionFrontier;
  readonly obligation_id: string;
  readonly hypothesis_ref: {
    readonly container_ref: ExactArtifactReference<"HypothesisSet">;
    readonly node_id: string;
  };
  readonly output_alias: string;
  readonly value: number;
  readonly proposed_relation: "SUPPORTS" | "REFUTES";
  readonly dependency_evidence_documents: readonly L2ResearchDocumentCandidate[];
}

async function buildQueryFixture(input: BuildQueryFixtureInput) {
  const planPayload = input.plan_document.payload;
  if (planPayload.artifact_type !== "EvidencePlan") {
    throw new TypeError("document fixture EvidencePlan 类型漂移。");
  }
  const obligationPayload = planPayload.obligations.find(
    ({ obligation_id }) => obligation_id === input.obligation_id,
  );
  if (!obligationPayload) {
    throw new TypeError(`document fixture 缺少 Obligation：${input.obligation_id}`);
  }
  const planRef = await deriveExactResearchDocumentRef(input.plan_document, "EvidencePlan");
  const obligation: ResolvedProofObligation = {
    evidence_plan_document: input.plan_document,
    obligation_id: input.obligation_id,
  };
  const obligationRef = proofObligationRefSchema.parse({
    container_ref: planRef,
    node_id: input.obligation_id,
  });

  const queryContractDocument = await sealL2TestDocument(
    {
      artifact_type: "QueryContract",
      evidence_plan_ref: planRef,
      metric: input.output_alias,
      dimensions: [],
      grain: "scalar",
      time_range: {
        start: "2026-01-01T00:00:00.000Z",
        end: "2026-02-01T00:00:00.000Z",
        timezone: "Asia/Shanghai",
        semantics: "HALF_OPEN",
      },
      unit: obligationPayload.observation_contract.unit,
      filters: [],
      datasource_id: FIXTURE_DATASOURCE_ID,
      result_contract: {
        columns: [input.output_alias],
        invariant_ids: ["single-row"],
      },
    },
    input.seed + 1,
    [planRef],
  );
  const queryContractRef = await deriveExactL2DocumentRef(queryContractDocument, "QueryContract");
  const logicalPlanRef = await createDeterministicFixtureRef("LogicalPlan", input.seed + 2);
  const sqlMaterial = {
    dialect: "postgresql" as const,
    sql: `select ${input.value}::numeric as ${input.output_alias}`,
    parameters: {},
  };
  const queryHash = await computeSqlArtifactQueryHash(sqlMaterial);
  const sqlArtifactDocument = await sealL2TestDocument(
    {
      artifact_type: "SqlArtifact",
      logical_plan_ref: logicalPlanRef,
      compiler_version: "document-fixture-compiler@1.0.0",
      ast_hash: await sha256ContentHash({
        hash_domain: "u6-document-fixture-sql-ast@1.0.0",
        sql_material: sqlMaterial,
      }),
      ...sqlMaterial,
      query_hash: queryHash,
    },
    input.seed + 3,
    [logicalPlanRef],
  );
  const sqlArtifactRef = await deriveExactL2DocumentRef(sqlArtifactDocument, "SqlArtifact");
  const executionPermitRef = await createDeterministicFixtureRef("ExecutionPermit", input.seed + 4);
  const resourceAdmissionRef = await createDeterministicFixtureRef(
    "ResourceAdmissionReceipt",
    input.seed + 5,
  );
  const executionId = fixtureUuid(input.seed + 6);
  const sandboxResult = await createSandboxResult({
    seed: input.seed + 7,
    execution_id: executionId,
    output_alias: input.output_alias,
    value: input.value,
  });
  const sandboxReceipt = await createSandboxReceipt({
    seed: input.seed + 8,
    execution_id: executionId,
    result: sandboxResult,
    sql_artifact_ref: sqlArtifactRef,
    execution_permit_ref: executionPermitRef,
    resource_admission_ref: resourceAdmissionRef,
    policy_receipt_ref: input.policy_receipt_ref,
  });
  const executionReceiptDocument = await sealL2TestDocument(
    {
      artifact_type: "ExecutionReceipt",
      sql_artifact_ref: sqlArtifactRef,
      execution_permit_ref: executionPermitRef,
      sandbox_execution_receipt_ref: sandboxReceipt.receipt_ref,
      result_artifact_ref: sandboxResult.result_ref,
      datasource_id: FIXTURE_DATASOURCE_ID,
      schema_version: sandboxResult.schema_version,
      snapshot_token: FIXTURE_SNAPSHOT_TOKEN,
      watermark: null,
      observed_at: new Date(Date.parse(sandboxReceipt.completed_at) + 1_000).toISOString(),
      query_hash: queryHash,
      result_hash: sandboxResult.result_hash,
      replay_state: "REPLAYABLE",
      row_count: sandboxResult.row_count,
    },
    input.seed + 9,
    [sqlArtifactRef, executionPermitRef, sandboxReceipt.receipt_ref, sandboxResult.result_ref],
  );
  const executionReceiptRef = await deriveExactL2DocumentRef(
    executionReceiptDocument,
    "ExecutionReceipt",
  );
  const gateReceiptRefs = await Promise.all(
    Array.from({ length: 7 }, (_, index) =>
      createDeterministicFixtureRef("GateReceipt", input.seed + 20 + index),
    ),
  );
  const validationReceiptDocument = await sealL2TestDocument(
    {
      artifact_type: "ValidationReceipt",
      sql_artifact_ref: sqlArtifactRef,
      execution_receipt_ref: executionReceiptRef,
      gate_receipt_refs: gateReceiptRefs,
      validation_version: TEXT2SQL_VALIDATION_VERSION,
      sealed_at: new Date(Date.parse(sandboxReceipt.completed_at) + 2_000).toISOString(),
    },
    input.seed + 10,
    [sqlArtifactRef, executionReceiptRef, ...gateReceiptRefs],
  );

  const oedInput: BuildObligationExecutionDecisionCandidateInput = {
    brief_document: input.brief_document,
    obligation,
    query_contract_document: queryContractDocument,
    sql_artifact_document: sqlArtifactDocument,
    semantic_release_ref: input.semantic_release_ref,
    policy_receipt_ref: input.policy_receipt_ref,
    evaluator_version: "document-fixture-oed@1.0.0",
    assurance: issueTransientOedAssuranceForControlledKernel({
      binding: {
        brief_ref: await deriveExactResearchDocumentRef(input.brief_document, "ResearchBrief"),
        evidence_plan_ref: planRef,
        query_contract_ref: queryContractRef,
        sql_artifact_ref: sqlArtifactRef,
        semantic_release_ref: input.semantic_release_ref,
        policy_receipt_ref: input.policy_receipt_ref,
      },
      verifier_result: {
        profile: "CONTROLLED_EXACT",
        compiler_verifier_version: "document-fixture-compiler-verifier@1.0.0",
        compiler_evidence_hash: queryHash,
        policy_verifier_version: "document-fixture-policy-verifier@1.0.0",
        policy_evidence_hash: contentHashSchema.parse(
          input.policy_receipt_ref.content_hash,
        ) as ContentHash,
        semantic_checks: {
          metric: true,
          metric_formula: true,
          time_window: true,
          timezone: true,
          grain: true,
          dimensions: true,
          grouping: true,
          joins: true,
          canonical_predicates: true,
          cohort: true,
          null_semantics: true,
          authorization_scope: true,
        },
      },
    }),
  };
  const oedPayload = kernelValue(
    await buildObligationExecutionDecisionCandidate(oedInput),
    `${input.obligation_id} OED`,
  );
  const oedDocument = await sealResearchDocument(oedPayload, input.seed + 11);
  const queryEvidenceInput: BuildQueryEvidenceCandidateInput = {
    obligation,
    obligation_execution_decision_resolution: {
      document: oedDocument,
      derivation_input: oedInput,
    },
    l2: {
      query_contract_document: queryContractDocument,
      sql_artifact_document: sqlArtifactDocument,
      validation_receipt_document: validationReceiptDocument,
      execution_receipt_document: executionReceiptDocument,
    },
    sandbox: {
      sandbox_execution_receipt: sandboxReceipt,
      sandbox_result: sandboxResult,
    },
    dependency_evidence_documents: input.dependency_evidence_documents,
    observed_version: input.version_frontier,
  };
  const queryEvidencePayload = kernelValue(
    await buildQueryEvidenceCandidate(queryEvidenceInput),
    `${input.obligation_id} QueryEvidence`,
  );
  const queryEvidenceDocument = await sealResearchDocument(queryEvidencePayload, input.seed + 12);
  const claimSource: ClaimObservationSource = {
    query_evidence_document: queryEvidenceDocument,
    query_contract_document: queryContractDocument,
    obligation,
    sandbox_result: sandboxResult,
    selector: {
      binding_id: `${input.obligation_id}-observation`,
      output_alias: input.output_alias,
      row_index: 0,
    },
  };
  const claimInput: BuildAtomicClaimCandidateInput = {
    claim_intent: {
      claim_id: `${input.obligation_id}-claim`,
      limitations: ["test-only Candidate；不代表 persistence、current 或 authority"],
    },
    predicate: {
      claim_mode: "DESCRIPTIVE",
      observation_binding_id: claimSource.selector.binding_id,
      operator: "EQ",
      asserted_value: {
        value_kind: "NUMBER",
        number_value: input.value,
        text_value: null,
        unit: obligationPayload.observation_contract.unit,
      },
    },
    observation_sources: [claimSource],
    renderer: {
      renderer_version: ATOMIC_CLAIM_RENDERER_VERSION,
      locale: "zh-CN",
    },
  };
  const claimPayload = kernelValue(
    await buildAtomicClaimCandidate(claimInput),
    `${input.obligation_id} AtomicClaim`,
  );
  const claimDocument = await sealResearchDocument(claimPayload, input.seed + 13);
  const relationInput: BuildEvidenceRelationCandidateInput = {
    claim_document: claimDocument,
    evidence_document: queryEvidenceDocument,
    obligation,
    proposed_relation: input.proposed_relation,
    rationale:
      input.proposed_relation === "SUPPORTS"
        ? "确定性 observation 满足预注册支持区间。"
        : "确定性 observation 命中预注册反证区间。",
  };
  const relationPayload = kernelValue(
    await buildEvidenceRelationCandidate(relationInput),
    `${input.obligation_id} EvidenceRelation`,
  );
  const relationDocument = await sealResearchDocument(relationPayload, input.seed + 14);
  const relationRef = await deriveExactResearchDocumentRef(relationDocument, "EvidenceRelation");
  const queryEvidenceResolution: QueryEvidenceDocumentResolution = {
    document: queryEvidenceDocument,
    derivation_input: queryEvidenceInput,
  };
  const atomicClaimResolution: AtomicClaimDocumentResolution = {
    document: claimDocument,
    derivation_input: claimInput,
  };
  const evidenceRelationResolution: EvidenceRelationDocumentResolution = {
    document: relationDocument,
    derivation_input: relationInput,
  };
  const checkInput = (
    checkKind: "DETERMINISTIC_CHECK" | "PROVENANCE_CHECK",
  ): BuildEvidenceCheckCandidateInput => ({
    claim_resolution: atomicClaimResolution,
    relation_resolution: evidenceRelationResolution,
    query_evidence_resolutions: [queryEvidenceResolution],
    check_kind: checkKind,
    evaluator_version: "document-fixture-check@1.0.0",
  });
  const deterministicCheckInput = checkInput("DETERMINISTIC_CHECK");
  const provenanceCheckInput = checkInput("PROVENANCE_CHECK");
  const deterministicCheckPayload = kernelValue(
    await buildEvidenceCheckCandidate(deterministicCheckInput),
    `${input.obligation_id} deterministic check`,
  );
  const provenanceCheckPayload = kernelValue(
    await buildEvidenceCheckCandidate(provenanceCheckInput),
    `${input.obligation_id} provenance check`,
  );
  const deterministicCheckDocument = await sealResearchDocument(
    deterministicCheckPayload,
    input.seed + 15,
  );
  const provenanceCheckDocument = await sealResearchDocument(
    provenanceCheckPayload,
    input.seed + 16,
  );
  const evidenceCheckResolutions: [
    EvidenceCheckDocumentResolution,
    EvidenceCheckDocumentResolution,
  ] = [
    {
      document: deterministicCheckDocument,
      derivation_input: deterministicCheckInput,
    },
    {
      document: provenanceCheckDocument,
      derivation_input: provenanceCheckInput,
    },
  ];
  const claimRef = await deriveExactResearchDocumentRef(claimDocument, "AtomicClaim");
  const deterministicCheckRef = await deriveExactResearchDocumentRef(
    deterministicCheckDocument,
    "EvidenceCheckReceipt",
  );
  const provenanceCheckRef = await deriveExactResearchDocumentRef(
    provenanceCheckDocument,
    "EvidenceCheckReceipt",
  );
  const supportInput: BuildSupportDecisionCandidateInput = {
    claim_resolution: atomicClaimResolution,
    relation_resolutions: [evidenceRelationResolution],
    check_resolutions: evidenceCheckResolutions,
    evaluator_version: "document-fixture-support@1.0.0",
  };
  const supportPayload = kernelValue(
    await buildSupportDecisionCandidate(supportInput),
    `${input.obligation_id} SupportDecision`,
  );
  const supportDocument = await sealResearchDocument(supportPayload, input.seed + 17);
  const supportRef = await deriveExactResearchDocumentRef(supportDocument, "SupportDecision");
  const supportDecisionResolution: SupportDecisionDocumentResolution = {
    document: supportDocument,
    derivation_input: supportInput,
  };
  const assessmentInput: BuildHypothesisAssessmentCandidateInput = {
    evidence_plan_document: input.plan_document,
    hypothesis_id: input.hypothesis_ref.node_id,
    support_decision_resolutions: [supportDecisionResolution],
  };
  const assessmentPayload = kernelValue(
    await buildHypothesisAssessmentCandidate(assessmentInput),
    `${input.obligation_id} HypothesisAssessment`,
  );
  const assessmentDocument = await sealResearchDocument(assessmentPayload, input.seed + 18);
  const hypothesisAssessmentResolution: HypothesisAssessmentDocumentResolution = {
    document: assessmentDocument,
    derivation_input: assessmentInput,
  };
  const obligationExecutionDecisionResolution: ObligationExecutionDecisionDocumentResolution = {
    document: oedDocument,
    derivation_input: oedInput,
  };

  return {
    obligation,
    obligation_ref: obligationRef,
    hypothesis_ref: input.hypothesis_ref,
    outcome: supportPayload.decision,
    query_contract_document: queryContractDocument,
    sql_artifact_document: sqlArtifactDocument,
    validation_receipt_document: validationReceiptDocument,
    execution_receipt_document: executionReceiptDocument,
    sandbox_execution_receipt: sandboxReceipt,
    sandbox_result: sandboxResult,
    obligation_execution_decision_document: oedDocument,
    obligation_execution_decision_resolution: obligationExecutionDecisionResolution,
    query_evidence_resolution: queryEvidenceResolution,
    atomic_claim_resolution: atomicClaimResolution,
    evidence_relation_resolution: evidenceRelationResolution,
    evidence_check_documents: [deterministicCheckDocument, provenanceCheckDocument] as const,
    evidence_check_resolutions: evidenceCheckResolutions,
    support_decision_document: supportDocument,
    support_decision_resolution: supportDecisionResolution,
    hypothesis_assessment_document: assessmentDocument,
    hypothesis_assessment_resolution: hypothesisAssessmentResolution,
    refs: {
      query_contract: queryContractRef,
      sql_artifact: sqlArtifactRef,
      execution_receipt: executionReceiptRef,
      obligation_execution_decision: await deriveExactResearchDocumentRef(
        oedDocument,
        "ObligationExecutionDecision",
      ),
      query_evidence: await deriveExactResearchDocumentRef(queryEvidenceDocument, "QueryEvidence"),
      atomic_claim: claimRef,
      evidence_relation: relationRef,
      deterministic_check: deterministicCheckRef,
      provenance_check: provenanceCheckRef,
      support_decision: supportRef,
      hypothesis_assessment: await deriveExactResearchDocumentRef(
        assessmentDocument,
        "HypothesisAssessment",
      ),
    },
  };
}

export type DocumentBackedResearchFixtureMode = "MIXED_SUPPORTED_REFUTED" | "ALL_REFUTED";

export interface BuildDocumentBackedResearchFixtureOptions {
  readonly seed?: number;
  readonly mode?: DocumentBackedResearchFixtureMode;
}

async function createVersionFrontier(input: {
  readonly seed: number;
  readonly semantic_release_ref: ExactArtifactReference<"SemanticRelease">;
  readonly schema_snapshot_ref: ExactArtifactReference<"SchemaSnapshot">;
  readonly policy_receipt_ref: ExactArtifactReference<"PolicyReceipt">;
}): Promise<VersionFrontier> {
  const schemaManifestHash = await sha256ContentHash({
    hash_domain: "u6-document-fixture-schema-manifest@1.0.0",
    seed: input.seed,
  });
  const dataManifestHash = await sha256ContentHash({
    hash_domain: "u6-document-fixture-data-manifest@1.0.0",
    seed: input.seed,
  });
  const fixtureManifestHash = await sha256ContentHash({
    hash_domain: "u6-document-fixture-fixture-manifest@1.0.0",
    seed: input.seed,
  });
  const dataSnapshotWithoutHash = {
    protocol_version: "data-snapshot-binding@1.0.0" as const,
    datasource_id: FIXTURE_DATASOURCE_ID,
    strategy: "CONTROLLED_REVISION" as const,
    snapshot_token: FIXTURE_SNAPSHOT_TOKEN,
    schema_manifest_hash: schemaManifestHash,
    data_manifest_hash: dataManifestHash,
    fixture_manifest_hash: fixtureManifestHash,
    replay_state: "REPLAYABLE" as const,
  };
  return {
    semantic_release_ref: input.semantic_release_ref,
    schema_snapshot_ref: input.schema_snapshot_ref,
    data_snapshot: {
      ...dataSnapshotWithoutHash,
      binding_hash: await sha256ContentHash({
        hash_domain: "u6-document-fixture-data-snapshot@1.0.0",
        data_snapshot: dataSnapshotWithoutHash,
      }),
    },
    policy_receipt_ref: input.policy_receipt_ref,
    identity_binding: {
      principal_id: "document-fixture-principal",
      delegation_chain_hash: await sha256ContentHash({
        hash_domain: "u6-document-fixture-delegation@1.0.0",
        seed: input.seed,
      }),
      authority_epoch: 1,
    },
  };
}

async function createBudgetLedger(seed: number): Promise<ResearchBudgetLedgerBinding> {
  const material = {
    ledger_version: "research-budget-ledger@1.0.0" as const,
    evaluated_through_reservation_seq: 2,
    effective_limit: {
      max_steps: 8,
      max_model_calls: 8,
      max_sql_executions: 4,
      max_source_calls: 0,
      max_elapsed_ms: 8_000,
      max_provider_input_tokens_per_call: 1_000,
      max_provider_output_tokens_per_call: 1_000,
      max_provider_tokens_per_run: 8_000,
      max_provider_cost_microusd_per_run: 8_000,
    },
    used: {
      steps: 4,
      model_calls: 4,
      sql_executions: 2,
      source_calls: 0,
      elapsed_ms: 4_000,
      provider_input_tokens: 1_000,
      provider_output_tokens: 1_000,
      provider_tokens: 2_000,
      provider_cost_microusd: 4_000,
    },
    remaining: {
      steps: 4,
      model_calls: 4,
      sql_executions: 2,
      source_calls: 0,
      elapsed_ms: 4_000,
      provider_tokens: 6_000,
      provider_cost_microusd: 4_000,
    },
    top_up_allowed: false,
  } as const satisfies Omit<ResearchBudgetLedgerBinding, "ledger_hash">;
  return {
    ...material,
    ledger_hash: await sha256ContentHash({
      hash_domain: "u6-document-fixture-budget-ledger@1.0.0",
      seed,
      ledger: material,
    }),
  };
}

/**
 * 构造不依赖 controlled-composition 的最小真实 production-builder closure。
 *
 * 基线包含两个 MATERIAL Hypothesis、两个 CRITICAL Obligation、Q2→Q1 dependency，
 * 并默认得到一项 SUPPORTED 与一项 REFUTED。`ALL_REFUTED` 用于 Coverage/Stop
 * 反例组装。所有返回对象仍是 test-only Candidate，不声称持久化或 authority。
 */
export async function buildDocumentBackedResearchFixture(
  options: BuildDocumentBackedResearchFixtureOptions = {},
) {
  const seed = checkedSeed(options.seed ?? 10_000);
  const mode = options.mode ?? "MIXED_SUPPORTED_REFUTED";
  const questionFrameRef = await createDeterministicFixtureRef("QuestionFrame", seed + 1);
  const semanticReleaseRef = await createDeterministicFixtureRef("SemanticRelease", seed + 2);
  const schemaSnapshotRef = await createDeterministicFixtureRef("SchemaSnapshot", seed + 3);
  const policyReceiptRef = await createDeterministicFixtureRef("PolicyReceipt", seed + 4);
  const briefPayload = kernelValue(
    await compileResearchBriefCandidate({
      question_frame_ref: questionFrameRef,
      scope: {
        subject: "验证两项竞争解释的 document-backed 研究闭包",
        time_window: {
          start: "2026-01-01T00:00:00.000Z",
          end: "2026-02-01T00:00:00.000Z",
          timezone: "Asia/Shanghai",
          semantics: "HALF_OPEN",
        },
        dimensions: [],
        metric_refs: [
          { container_ref: semanticReleaseRef, node_id: "promotion_share" },
          { container_ref: semanticReleaseRef, node_id: "refund_share" },
        ],
      },
      success_criteria: [
        {
          criterion_id: "distinguish-two-hypotheses",
          statement: "用两项确定性查询区分两个竞争解释",
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
        enumerator_version: "document-fixture-enumerator@1.0.0",
        required_disclosure: "BOUNDED_HYPOTHESIS_UNIVERSE",
      },
      freshness_policy: {
        max_age_seconds: 3_600,
        require_snapshot_replayable: true,
      },
      source_independence_policy: {
        mode: "ONE_AUTHORITATIVE_SOURCE_WITH_DISCLOSURE",
        minimum_provenance_groups: 1,
        required_disclosures: ["SINGLE_AUTHORITY_SOURCE"],
      },
      claim_policy: {
        allowed_modes: ["DESCRIPTIVE", "COMPARATIVE", "DIAGNOSTIC"],
        forbidden_modes: ["CAUSAL", "PRESCRIPTIVE", "ACTION_EXECUTING"],
      },
      budget: {
        max_steps: 8,
        max_model_calls: 8,
        max_sql_executions: 4,
        max_source_calls: 0,
        max_elapsed_ms: 8_000,
        max_provider_input_tokens_per_call: 1_000,
        max_provider_output_tokens_per_call: 1_000,
        max_provider_tokens_per_run: 8_000,
        max_provider_cost_microusd_per_run: 8_000,
      },
      policy_ref: policyReceiptRef,
      policy_digest: await sha256ContentHash({
        hash_domain: "u6-document-fixture-policy@1.0.0",
        policy_receipt_ref: policyReceiptRef,
      }),
      data_classification: "INTERNAL",
      retention_policy_ref: {
        policy_id: "document-fixture-retention",
        policy_version: "1.0.0",
        policy_hash: await sha256ContentHash({
          hash_domain: "u6-document-fixture-retention@1.0.0",
          seed,
        }),
      },
    }),
    "ResearchBrief",
  );
  const briefDocument = await sealResearchDocument(briefPayload, seed + 10);
  const briefRef = await deriveExactResearchDocumentRef(briefDocument, "ResearchBrief");
  const hypothesisSetPayload = kernelValue(
    await compileHypothesisSetCandidate({
      brief_ref: briefRef,
      hypotheses: [
        {
          hypothesis_id: "promotion-mix",
          mechanism_class: "promotion",
          statement: "促销结构变化可以解释观测差异",
          predictions: ["promotion_share 进入支持区间"],
          falsifiers: ["promotion_share 进入反证区间"],
          discriminating_test_ids: ["promotion-share-test"],
          materiality: "MATERIAL",
        },
        {
          hypothesis_id: "late-refund",
          mechanism_class: "refund",
          statement: "延迟退款可以解释观测差异",
          predictions: ["refund_share 进入支持区间"],
          falsifiers: ["refund_share 进入反证区间"],
          discriminating_test_ids: ["refund-share-test"],
          materiality: "MATERIAL",
        },
      ],
      mechanism_validator_version: "document-fixture-mechanism@1.0.0",
    }),
    "HypothesisSet",
  );
  const hypothesisSetDocument = await sealResearchDocument(hypothesisSetPayload, seed + 11);
  const hypothesisSetRef = await deriveExactResearchDocumentRef(
    hypothesisSetDocument,
    "HypothesisSet",
  );
  const hypothesis1Ref = {
    container_ref: hypothesisSetRef,
    node_id: "promotion-mix",
  } as const;
  const hypothesis2Ref = {
    container_ref: hypothesisSetRef,
    node_id: "late-refund",
  } as const;
  const criterionRef = {
    container_ref: briefRef,
    node_id: "distinguish-two-hypotheses",
  } as const;
  const evidencePlanPayload = kernelValue(
    await compileEvidencePlanCandidate({
      brief_document: briefDocument,
      hypothesis_set_document: hypothesisSetDocument,
      obligations: [
        {
          obligation_id: "promotion-obligation",
          hypothesis_refs: [hypothesis1Ref],
          success_criterion_refs: [criterionRef],
          discriminating_test_ids: ["promotion-share-test"],
          materiality: "CRITICAL",
          evidence_kind: "QUERY",
          depends_on: [],
          observation_contract: {
            metric_ref: {
              container_ref: semanticReleaseRef,
              node_id: "promotion_share",
            },
            aggregation: "SUM",
            unit: "ratio",
            support_predicate: { operator: "GTE", threshold: 0.6 },
            refute_predicate: { operator: "LTE", threshold: 0.3 },
            null_behavior: "FAIL",
          },
          failure_behavior: "BLOCK_READY",
        },
        {
          obligation_id: "refund-obligation",
          hypothesis_refs: [hypothesis2Ref],
          success_criterion_refs: [criterionRef],
          discriminating_test_ids: ["refund-share-test"],
          materiality: "CRITICAL",
          evidence_kind: "QUERY",
          depends_on: [{ node_id: "promotion-obligation" }],
          observation_contract: {
            metric_ref: {
              container_ref: semanticReleaseRef,
              node_id: "refund_share",
            },
            aggregation: "SUM",
            unit: "ratio",
            support_predicate: { operator: "GTE", threshold: 0.6 },
            refute_predicate: { operator: "LTE", threshold: 0.3 },
            null_behavior: "FAIL",
          },
          failure_behavior: "BLOCK_READY",
        },
      ],
      planner_version: "document-fixture-planner@1.0.0",
    }),
    "EvidencePlan",
  );
  const evidencePlanDocument = await sealResearchDocument(evidencePlanPayload, seed + 12);
  const evidencePlanRef = await deriveExactResearchDocumentRef(
    evidencePlanDocument,
    "EvidencePlan",
  );
  const versionFrontier = await createVersionFrontier({
    seed,
    semantic_release_ref: semanticReleaseRef,
    schema_snapshot_ref: schemaSnapshotRef,
    policy_receipt_ref: policyReceiptRef,
  });

  const firstRelation = mode === "ALL_REFUTED" ? ("REFUTES" as const) : ("SUPPORTS" as const);
  const firstQuery = await buildQueryFixture({
    seed: seed + 100,
    plan_document: evidencePlanDocument,
    brief_document: briefDocument,
    semantic_release_ref: semanticReleaseRef,
    policy_receipt_ref: policyReceiptRef,
    version_frontier: versionFrontier,
    obligation_id: "promotion-obligation",
    hypothesis_ref: hypothesis1Ref,
    output_alias: "promotion_share",
    value: firstRelation === "SUPPORTS" ? 0.8 : 0.2,
    proposed_relation: firstRelation,
    dependency_evidence_documents: [],
  });
  const secondQuery = await buildQueryFixture({
    seed: seed + 200,
    plan_document: evidencePlanDocument,
    brief_document: briefDocument,
    semantic_release_ref: semanticReleaseRef,
    policy_receipt_ref: policyReceiptRef,
    version_frontier: versionFrontier,
    obligation_id: "refund-obligation",
    hypothesis_ref: hypothesis2Ref,
    output_alias: "refund_share",
    value: 0.2,
    proposed_relation: "REFUTES",
    dependency_evidence_documents: [firstQuery.query_evidence_resolution.document],
  });
  const queries = [firstQuery, secondQuery] as const;
  const budgetLedger = await createBudgetLedger(seed);
  const coverageInput: DeriveCoverageStateInput = {
    evidence_plan_document: evidencePlanDocument,
    obligation_execution_decision_resolutions: queries.map(
      ({ obligation_execution_decision_resolution }) => obligation_execution_decision_resolution,
    ),
    query_evidence_resolutions: queries.map(
      ({ query_evidence_resolution }) => query_evidence_resolution,
    ),
    atomic_claim_resolutions: queries.map(({ atomic_claim_resolution }) => atomic_claim_resolution),
    evidence_relation_resolutions: queries.map(
      ({ evidence_relation_resolution }) => evidence_relation_resolution,
    ),
    evidence_check_resolutions: queries.flatMap(
      ({ evidence_check_resolutions }) => evidence_check_resolutions,
    ),
    support_decision_resolutions: queries.map(
      ({ support_decision_resolution }) => support_decision_resolution,
    ),
    hypothesis_assessment_resolutions: queries.map(
      ({ hypothesis_assessment_resolution }) => hypothesis_assessment_resolution,
    ),
    blockers: [],
    execution_failure_resolutions: [],
    budget_ledger: budgetLedger,
    current_version_frontier: versionFrontier,
  };
  const coveragePayload = kernelValue(
    await deriveCoverageStateCandidate(coverageInput),
    "CoverageState",
  );
  const coverageDocument = await sealResearchDocument(coveragePayload, seed + 300);
  const coverageRef = await deriveExactResearchDocumentRef(coverageDocument, "CoverageState");
  const materialQueryEvidenceDocuments = queries.map(
    ({ query_evidence_resolution }) => query_evidence_resolution.document,
  );
  const requiredDisclosures = [
    "BOUNDED_HYPOTHESIS_UNIVERSE",
    "L2_NON_CAUSAL",
    "SINGLE_AUTHORITY_SOURCE",
  ] as const;
  const stopInput: DeriveResearchStopDecisionInput = {
    coverage_document: coverageDocument,
    coverage_resolution: coverageInput,
    candidate_queries: [],
    support_decision_documents: coverageInput.support_decision_resolutions.map(
      ({ document }) => document,
    ),
    required_disclosures: requiredDisclosures,
    pre_stop_readiness: {
      brief_document: briefDocument,
      material_query_evidence_documents: materialQueryEvidenceDocuments,
      supplied_disclosures: requiredDisclosures,
    },
    enumerator_version: "document-fixture-stop-enumerator@1.0.0",
    eig_policy_version: "document-fixture-eig@1.0.0",
  };
  const stopPayload = kernelValue(
    await deriveResearchStopDecisionFromDocumentsCandidate(stopInput),
    "ResearchStopDecision",
  );
  if (stopPayload.decision !== "STOP_READY") {
    throw new Error(`document-backed baseline 预期 STOP_READY，实际为 ${stopPayload.decision}。`);
  }
  const stopDocument = await sealResearchDocument(stopPayload, seed + 301);

  return {
    mode,
    scope: DOCUMENT_FIXTURE_SCOPE,
    run_id: DOCUMENT_FIXTURE_RUN_ID,
    brief_document: briefDocument,
    hypothesis_set_document: hypothesisSetDocument,
    evidence_plan_document: evidencePlanDocument,
    obligation_execution_decision_documents:
      coverageInput.obligation_execution_decision_resolutions.map(({ document }) => document),
    obligation_execution_decision_resolutions:
      coverageInput.obligation_execution_decision_resolutions,
    query_evidence_resolutions: coverageInput.query_evidence_resolutions,
    atomic_claim_resolutions: coverageInput.atomic_claim_resolutions,
    evidence_relation_resolutions: coverageInput.evidence_relation_resolutions,
    evidence_check_documents: coverageInput.evidence_check_resolutions.map(
      ({ document }) => document,
    ),
    evidence_check_resolutions: coverageInput.evidence_check_resolutions,
    support_decision_documents: coverageInput.support_decision_resolutions.map(
      ({ document }) => document,
    ),
    support_decision_resolutions: coverageInput.support_decision_resolutions,
    hypothesis_assessment_documents: coverageInput.hypothesis_assessment_resolutions.map(
      ({ document }) => document,
    ),
    hypothesis_assessment_resolutions: coverageInput.hypothesis_assessment_resolutions,
    material_query_evidence_documents: materialQueryEvidenceDocuments,
    version_frontier: versionFrontier,
    budget_ledger: budgetLedger,
    coverage_input: coverageInput,
    coverage_document: coverageDocument,
    stop_input: stopInput,
    stop_document: stopDocument,
    queries,
    refs: {
      question_frame: questionFrameRef,
      semantic_release: semanticReleaseRef,
      schema_snapshot: schemaSnapshotRef,
      policy_receipt: policyReceiptRef,
      brief: briefRef,
      hypothesis_set: hypothesisSetRef,
      evidence_plan: evidencePlanRef,
      coverage: coverageRef,
      stop: await deriveExactResearchDocumentRef(stopDocument, "ResearchStopDecision"),
    },
  };
}

export type DocumentBackedResearchFixture = Awaited<
  ReturnType<typeof buildDocumentBackedResearchFixture>
>;
