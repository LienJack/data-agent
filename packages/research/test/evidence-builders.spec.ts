import {
  type ArtifactReference,
  AUTHORITY_ROLE_POLICY_VERSION,
  artifactReferenceIdentity,
  artifactReferenceSchema,
  computeL2ArtifactContentHash,
  computeL2ResearchEnvelopeContentHash,
  computeL2ResearchSemanticHash,
  computeSandboxExecutionReceiptHash,
  computeSandboxResultBytes,
  computeSandboxResultHash,
  computeSqlArtifactQueryHash,
  type L2ArtifactDocument,
  type L2ResearchDocumentCandidate,
  l2ArtifactDocumentSchema,
  parseL2ResearchDocumentCandidate,
  queryContractRefSchema,
  type SuccessfulSandboxExecutionReceipt,
  sandboxResultSchema,
  successfulSandboxExecutionReceiptSchema,
  TEXT2SQL_VALIDATION_VERSION,
  type VersionFrontier,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  ATOMIC_CLAIM_RENDERER_VERSION,
  type BuildAtomicClaimCandidateInput,
  type BuildObligationExecutionDecisionCandidateInput,
  type BuildQueryEvidenceCandidateInput,
  buildAtomicClaimCandidate,
  buildEvidenceRelationCandidate,
  buildObligationExecutionDecisionCandidate,
  buildQueryEvidenceCandidate,
  type ClaimObservationSource,
  type ResolvedProofObligation,
  verifyAtomicClaimDocumentDerivation,
} from "../src/evidence-builders.js";
import { computeResearchKernelHash } from "../src/internal/hash.js";
import { issueTransientOedAssuranceFromExactVerifier } from "../src/server/oed-assurance.js";
import { hashes } from "./fixtures.js";

const scope = {
  app_id: "00000000-0000-4000-8000-000000000001",
  tenant_id: "00000000-0000-4000-8000-000000000002",
  environment: "test",
} as const;
const runId = "00000000-0000-4000-8000-000000000003";
const datasourceId = "00000000-0000-4000-8000-000000000004";
const snapshotToken = "controlled-snapshot-v1";
const createdAt = "2026-07-27T00:00:00.000Z";
const startedAt = "2026-07-27T00:01:00.000Z";
const completedAt = "2026-07-27T00:01:00.010Z";
const observedAt = "2026-07-27T00:01:01.000Z";

function uuid(id: number): string {
  return `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`;
}

function reference<const T extends ArtifactReference["artifact_type"]>(
  artifactType: T,
  id: number,
  contentHash: string = hashes.a,
): ArtifactReference & { readonly artifact_type: T } {
  return {
    ...scope,
    run_id: runId,
    artifact_id: uuid(id),
    artifact_type: artifactType,
    revision: 1,
    content_hash: contentHash,
  };
}

function documentReference<const T extends ArtifactReference["artifact_type"]>(
  document: L2ArtifactDocument | L2ResearchDocumentCandidate,
  artifactType: T,
): ArtifactReference & { readonly artifact_type: T } {
  if (document.envelope.artifact_type !== artifactType) {
    throw new Error(`Expected ${artifactType}, got ${document.envelope.artifact_type}.`);
  }
  return {
    artifact_id: document.envelope.artifact_id,
    artifact_type: artifactType,
    app_id: document.envelope.app_id,
    tenant_id: document.envelope.tenant_id,
    environment: document.envelope.environment,
    run_id: document.envelope.run_id,
    revision: document.envelope.revision,
    content_hash: document.envelope.content_hash,
  };
}

function collectReferences(value: unknown): ArtifactReference[] {
  const references = new Map<string, ArtifactReference>();
  const visit = (candidate: unknown): void => {
    const parsed = artifactReferenceSchema.safeParse(candidate);
    if (parsed.success) {
      references.set(artifactReferenceIdentity(parsed.data), parsed.data);
      return;
    }
    if (Array.isArray(candidate)) {
      for (const entry of candidate) visit(entry);
      return;
    }
    if (typeof candidate === "object" && candidate !== null) {
      for (const entry of Object.values(candidate)) visit(entry);
    }
  };
  visit(value);
  return [...references.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, artifactReference]) => artifactReference);
}

function envelope(
  artifactType: ArtifactReference["artifact_type"],
  artifactId: number,
  inputRefs: readonly ArtifactReference[],
  schemaVersion: string,
) {
  return {
    artifact_id: uuid(artifactId),
    artifact_type: artifactType,
    ...scope,
    run_id: runId,
    revision: 1,
    parent_ref: null,
    attempt_id: uuid(900_000 + artifactId),
    producer: {
      kind: "deterministic",
      id: "evidence-builder-test",
    },
    input_refs: inputRefs,
    schema_version: schemaVersion,
    semantic_version: "1.0.0",
    policy_version: "1.0.0",
    model_profile_version: "1.0.0",
    content_hash: hashes.a,
    status: "CANDIDATE",
    created_at: createdAt,
  } as const;
}

async function sealL2Document(
  payload: L2ArtifactDocument["payload"],
  artifactId: number,
): Promise<L2ArtifactDocument> {
  const draft = l2ArtifactDocumentSchema.parse({
    envelope: envelope(payload.artifact_type, artifactId, collectReferences(payload), "1.0.0"),
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

async function sealResearchDocument(
  payload: L2ResearchDocumentCandidate["payload"],
  artifactId: number,
): Promise<L2ResearchDocumentCandidate> {
  const schemaVersion = "2.0.0";
  const draft = parseL2ResearchDocumentCandidate({
    envelope: envelope(
      payload.artifact_type,
      artifactId,
      collectReferences(payload),
      schemaVersion,
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

interface ObligationSpec {
  readonly obligation_id: string;
  readonly metric_id: string;
  readonly unit: string;
  readonly depends_on?: readonly string[];
}

interface ResearchWorld {
  readonly brief_document: L2ResearchDocumentCandidate;
  readonly plan_document: L2ResearchDocumentCandidate;
  readonly brief_ref: ArtifactReference & { readonly artifact_type: "ResearchBrief" };
  readonly semantic_release_ref: ArtifactReference & {
    readonly artifact_type: "SemanticRelease";
  };
  readonly schema_snapshot_ref: ArtifactReference & { readonly artifact_type: "SchemaSnapshot" };
  readonly policy_receipt_ref: ArtifactReference & { readonly artifact_type: "PolicyReceipt" };
  readonly frontier: VersionFrontier;
}

async function createResearchWorld(
  obligationSpecs: readonly ObligationSpec[],
  seed: number,
): Promise<ResearchWorld> {
  const questionFrameRef = reference("QuestionFrame", seed + 1);
  const hypothesisSetRef = reference("HypothesisSet", seed + 2);
  const semanticReleaseRef = reference("SemanticRelease", seed + 3);
  const schemaSnapshotRef = reference("SchemaSnapshot", seed + 4);
  const policyReceiptRef = reference("PolicyReceipt", seed + 5);
  const briefDocument = await sealResearchDocument(
    {
      artifact_type: "ResearchBrief",
      protocol_version: "research-brief@2.0.0",
      question_frame_ref: questionFrameRef,
      scope: {
        subject: "受控 Evidence Builder 测试",
        time_window: {
          start: "2026-01-01T00:00:00.000Z",
          end: "2026-02-01T00:00:00.000Z",
          timezone: "Asia/Shanghai",
          semantics: "HALF_OPEN",
        },
        dimensions: [],
        metric_refs: obligationSpecs.map((spec) => ({
          container_ref: semanticReleaseRef,
          node_id: spec.metric_id,
        })),
      },
      success_criteria: obligationSpecs.map((_, index) => ({
        criterion_id: `criterion-${index + 1}`,
        statement: `闭合 Obligation ${index + 1}`,
        materiality: "CRITICAL",
      })),
      evidence_policy: {
        allowed_kinds: ["QUERY"],
        minimum_support_mode: "DETERMINISTIC",
        unsupported_source_behavior: "REJECT",
      },
      hypothesis_universe_policy: {
        candidate_sources: ["METRIC_DECOMPOSITION"],
        enumerator_version: "evidence-builder-test@1.0.0",
        required_disclosure: "BOUNDED_HYPOTHESIS_UNIVERSE",
      },
      freshness_policy: {
        max_age_seconds: 3600,
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
      policy_digest: policyReceiptRef.content_hash,
      data_classification: "INTERNAL",
      retention_policy_ref: {
        policy_id: "research-retention",
        policy_version: "1.0.0",
        policy_hash: hashes.a,
      },
    },
    seed + 6,
  );
  const briefRef = documentReference(briefDocument, "ResearchBrief");
  const obligations = await Promise.all(
    obligationSpecs.map(async (spec, index) => {
      const observationContract = {
        metric_ref: {
          container_ref: semanticReleaseRef,
          node_id: spec.metric_id,
        },
        aggregation: "SUM" as const,
        unit: spec.unit,
        support_predicate: { operator: "GTE" as const, threshold: 0 },
        refute_predicate: { operator: "LTE" as const, threshold: -1 },
        null_behavior: "FAIL" as const,
      };
      return {
        obligation_id: spec.obligation_id,
        hypothesis_refs: [
          {
            container_ref: hypothesisSetRef,
            node_id: `hypothesis-${index + 1}`,
          },
        ],
        success_criterion_refs: [
          {
            container_ref: briefRef,
            node_id: `criterion-${index + 1}`,
          },
        ],
        discriminating_test_ids: [`test-${index + 1}`],
        materiality: "CRITICAL" as const,
        evidence_kind: "QUERY" as const,
        depends_on: (spec.depends_on ?? []).map((node_id) => ({ node_id })),
        observation_contract: {
          ...observationContract,
          contract_hash: await computeResearchKernelHash(
            "u6-observation-contract@1",
            observationContract,
          ),
        },
        failure_behavior: "BLOCK_READY" as const,
      };
    }),
  );
  const planDocument = await sealResearchDocument(
    {
      artifact_type: "EvidencePlan",
      protocol_version: "evidence-plan@2.0.0",
      brief_ref: briefRef,
      hypothesis_set_ref: hypothesisSetRef,
      obligations,
      planner_version: "evidence-builder-test@1.0.0",
      obligation_graph_hash: await computeResearchKernelHash("u6-obligation-graph@1", obligations),
    },
    seed + 7,
  );
  return {
    brief_document: briefDocument,
    plan_document: planDocument,
    brief_ref: briefRef,
    semantic_release_ref: semanticReleaseRef,
    schema_snapshot_ref: schemaSnapshotRef,
    policy_receipt_ref: policyReceiptRef,
    frontier: {
      semantic_release_ref: semanticReleaseRef,
      schema_snapshot_ref: schemaSnapshotRef,
      data_snapshot: {
        protocol_version: "data-snapshot-binding@1.0.0",
        datasource_id: datasourceId,
        strategy: "CONTROLLED_REVISION",
        snapshot_token: snapshotToken,
        schema_manifest_hash: hashes.a,
        data_manifest_hash: hashes.b,
        fixture_manifest_hash: hashes.c,
        replay_state: "REPLAYABLE",
        binding_hash: hashes.a,
      },
      policy_receipt_ref: policyReceiptRef,
      identity_binding: {
        principal_id: "evidence-builder-test",
        delegation_chain_hash: hashes.b,
        authority_epoch: 1,
      },
    },
  };
}

async function createSandboxResult(input: {
  readonly result_id: number;
  readonly execution_id: string;
  readonly output_alias: string;
  readonly value: number;
  readonly additional_values?: readonly number[];
}) {
  const columns = [{ name: input.output_alias, type: "NUMBER" }] as const;
  const rows = [input.value, ...(input.additional_values ?? [])].map((value) => [value]);
  const resultRef = reference("SandboxResult", input.result_id);
  const draft = sandboxResultSchema.parse({
    schema_version: "schema-v1",
    result_ref: resultRef,
    scope,
    run_id: runId,
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
  readonly receipt_id: number;
  readonly execution_id: string;
  readonly result: Awaited<ReturnType<typeof createSandboxResult>>;
  readonly sql_artifact_ref: ArtifactReference & { readonly artifact_type: "SqlArtifact" };
  readonly execution_permit_ref: ArtifactReference & {
    readonly artifact_type: "ExecutionPermit";
  };
  readonly resource_admission_ref: ArtifactReference & {
    readonly artifact_type: "ResourceAdmissionReceipt";
  };
  readonly policy_receipt_ref: ArtifactReference & { readonly artifact_type: "PolicyReceipt" };
}): Promise<SuccessfulSandboxExecutionReceipt> {
  const receiptRef = reference("SandboxExecutionReceipt", input.receipt_id);
  const draft = successfulSandboxExecutionReceiptSchema.parse({
    schema_version: "schema-v1",
    language: "sql",
    executor: {
      authority_id: uuid(800_001),
      principal_id: "sandbox-principal",
      key_id: "sandbox-key-v1",
    },
    executor_role: "SANDBOX_EXECUTION",
    authority_role_policy_version: AUTHORITY_ROLE_POLICY_VERSION,
    receipt_id: receiptRef.artifact_id,
    receipt_ref: receiptRef,
    scope,
    run_id: runId,
    execution_id: input.execution_id,
    idempotency_key: `sandbox-${input.receipt_id}`,
    input_hash: hashes.b,
    execution_hash: receiptRef.content_hash,
    terminal: "COMPLETED",
    reason_code: "EXECUTION_COMPLETED",
    started_at: startedAt,
    completed_at: completedAt,
    result_artifact_ref: input.result.result_ref,
    sql_artifact_ref: input.sql_artifact_ref,
    execution_permit_ref: input.execution_permit_ref,
    resource_admission_ref: input.resource_admission_ref,
    datasource_id: datasourceId,
    settings_hash: hashes.c,
    execution_settings: {
      database_role: "research-reader",
      search_path: ["analytics"],
      plan_cache_mode: "force_custom_plan",
      statement_timeout_ms: 1_000,
      lock_timeout_ms: 100,
    },
    transaction: {
      transaction_id: input.execution_id,
      read_only: true,
      isolation_level: "REPEATABLE_READ",
    },
    authority_revalidation: {
      effective_principal_id: "sandbox-principal",
      policy_receipt_ref: input.policy_receipt_ref,
      revalidated_at: startedAt,
      authority_epoch: 1,
    },
    snapshot_token: snapshotToken,
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

interface QueryFixture {
  readonly obligation: ResolvedProofObligation;
  readonly input: BuildQueryEvidenceCandidateInput;
  readonly query_contract_document: L2ArtifactDocument;
  readonly sandbox_result: Awaited<ReturnType<typeof createSandboxResult>>;
  readonly query_evidence_document: L2ResearchDocumentCandidate;
  readonly claim_source: ClaimObservationSource;
}

async function createQueryFixture(input: {
  readonly world: ResearchWorld;
  readonly obligation_id: string;
  readonly output_alias: string;
  readonly value: number;
  readonly unit: string;
  readonly seed: number;
  readonly dependency_evidence_documents?: readonly L2ResearchDocumentCandidate[];
  readonly binding_id?: string;
  readonly additional_values?: readonly number[];
}): Promise<QueryFixture> {
  const obligation: ResolvedProofObligation = {
    evidence_plan_document: input.world.plan_document,
    obligation_id: input.obligation_id,
  };
  const planRef = documentReference(input.world.plan_document, "EvidencePlan");
  const queryContractDocument = await sealL2Document(
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
      unit: input.unit,
      filters: [],
      datasource_id: datasourceId,
      result_contract: {
        columns: [input.output_alias],
        invariant_ids: ["single-row"],
      },
    },
    input.seed + 1,
  );
  const queryContractRef = queryContractRefSchema.parse(
    documentReference(queryContractDocument, "QueryContract"),
  );
  const sqlMaterial = {
    dialect: "postgresql" as const,
    sql: `select 1::numeric as ${input.output_alias}`,
    parameters: {},
  };
  const queryHash = await computeSqlArtifactQueryHash(sqlMaterial);
  const sqlArtifactDocument = await sealL2Document(
    {
      artifact_type: "SqlArtifact",
      logical_plan_ref: reference("LogicalPlan", input.seed + 2),
      compiler_version: "test-compiler@1.0.0",
      ast_hash: hashes.b,
      ...sqlMaterial,
      query_hash: queryHash,
    },
    input.seed + 3,
  );
  const sqlArtifactRef = documentReference(sqlArtifactDocument, "SqlArtifact");
  const executionPermitRef = reference("ExecutionPermit", input.seed + 4);
  const resourceAdmissionRef = reference("ResourceAdmissionReceipt", input.seed + 5);
  const executionId = uuid(input.seed + 6);
  const sandboxResult = await createSandboxResult({
    result_id: input.seed + 7,
    execution_id: executionId,
    output_alias: input.output_alias,
    value: input.value,
    ...(input.additional_values ? { additional_values: input.additional_values } : {}),
  });
  const sandboxReceipt = await createSandboxReceipt({
    receipt_id: input.seed + 8,
    execution_id: executionId,
    result: sandboxResult,
    sql_artifact_ref: sqlArtifactRef,
    execution_permit_ref: executionPermitRef,
    resource_admission_ref: resourceAdmissionRef,
    policy_receipt_ref: input.world.policy_receipt_ref,
  });
  const executionReceiptDocument = await sealL2Document(
    {
      artifact_type: "ExecutionReceipt",
      sql_artifact_ref: sqlArtifactRef,
      execution_permit_ref: executionPermitRef,
      sandbox_execution_receipt_ref: sandboxReceipt.receipt_ref,
      result_artifact_ref: sandboxResult.result_ref,
      datasource_id: datasourceId,
      schema_version: sandboxResult.schema_version,
      snapshot_token: snapshotToken,
      watermark: null,
      observed_at: observedAt,
      query_hash: queryHash,
      result_hash: sandboxResult.result_hash,
      replay_state: "REPLAYABLE",
      row_count: sandboxResult.row_count,
    },
    input.seed + 9,
  );
  const executionReceiptRef = documentReference(executionReceiptDocument, "ExecutionReceipt");
  const validationReceiptDocument = await sealL2Document(
    {
      artifact_type: "ValidationReceipt",
      sql_artifact_ref: sqlArtifactRef,
      execution_receipt_ref: executionReceiptRef,
      gate_receipt_refs: Array.from({ length: 7 }, (_, index) =>
        reference("GateReceipt", input.seed + 20 + index),
      ),
      validation_version: TEXT2SQL_VALIDATION_VERSION,
      sealed_at: "2026-07-27T00:01:02.000Z",
    },
    input.seed + 10,
  );
  const planPayload = input.world.plan_document.payload;
  if (planPayload.artifact_type !== "EvidencePlan") {
    throw new Error("EvidencePlan fixture 类型漂移。");
  }
  const selectedObligation = planPayload.obligations.find(
    ({ obligation_id }) => obligation_id === input.obligation_id,
  );
  if (!selectedObligation) throw new Error("Fixture Obligation 缺失。");
  const semanticMatches = {
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
  };
  const oedInput: BuildObligationExecutionDecisionCandidateInput = {
    brief_document: input.world.brief_document,
    obligation,
    query_contract_document: queryContractDocument,
    sql_artifact_document: sqlArtifactDocument,
    semantic_release_ref: input.world.semantic_release_ref,
    policy_receipt_ref: input.world.policy_receipt_ref,
    evaluator_version: "evidence-builder-test@1.0.0",
    assurance: issueTransientOedAssuranceFromExactVerifier({
      binding: {
        brief_ref: input.world.brief_ref,
        evidence_plan_ref: planRef,
        query_contract_ref: queryContractRef,
        sql_artifact_ref: sqlArtifactRef,
        semantic_release_ref: input.world.semantic_release_ref,
        policy_receipt_ref: input.world.policy_receipt_ref,
      },
      verifier_result: {
        profile: "FROZEN_QUERY_REGISTRY",
        compiler_verifier_version: "evidence-builder-compiler-verifier@1.0.0",
        compiler_evidence_hash: queryHash,
        policy_verifier_version: "evidence-builder-policy-verifier@1.0.0",
        policy_evidence_hash: input.world.policy_receipt_ref.content_hash,
        semantic_checks: semanticMatches,
      },
    }),
  };
  const oed = await buildObligationExecutionDecisionCandidate(oedInput);
  if (!oed.ok) throw new Error(oed.error.message);
  const oedDocument = await sealResearchDocument(oed.value, input.seed + 11);
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
    dependency_evidence_documents: input.dependency_evidence_documents ?? [],
    observed_version: input.world.frontier,
  };
  const queryEvidence = await buildQueryEvidenceCandidate(queryEvidenceInput);
  if (!queryEvidence.ok) throw new Error(queryEvidence.error.message);
  const queryEvidenceDocument = await sealResearchDocument(queryEvidence.value, input.seed + 12);
  return {
    obligation,
    input: queryEvidenceInput,
    query_contract_document: queryContractDocument,
    sandbox_result: sandboxResult,
    query_evidence_document: queryEvidenceDocument,
    claim_source: {
      query_evidence_document: queryEvidenceDocument,
      query_contract_document: queryContractDocument,
      obligation,
      sandbox_result: sandboxResult,
      selector: {
        binding_id: input.binding_id ?? `${input.output_alias}-binding`,
        output_alias: input.output_alias,
        row_index: 0,
      },
    },
  };
}

function descriptiveClaimInput(source: ClaimObservationSource, value: number, unit: string) {
  return {
    claim_intent: {
      claim_id: "decline-claim",
      limitations: ["Candidate-only controlled result"],
    },
    predicate: {
      claim_mode: "DESCRIPTIVE",
      observation_binding_id: source.selector.binding_id,
      operator: "EQ",
      asserted_value: {
        value_kind: "NUMBER",
        number_value: value,
        text_value: null,
        unit,
      },
    },
    observation_sources: [source],
    renderer: {
      renderer_version: ATOMIC_CLAIM_RENDERER_VERSION,
      locale: "zh-CN",
    },
  } as const satisfies BuildAtomicClaimCandidateInput;
}

describe("resolved evidence Candidate builders", () => {
  it("derives QueryEvidence observation and provenance from the strict execution closure", async () => {
    const world = await createResearchWorld(
      [{ obligation_id: "q1", metric_id: "net-revenue", unit: "yuan" }],
      1_000,
    );
    const fixture = await createQueryFixture({
      world,
      obligation_id: "q1",
      output_alias: "decline_amount",
      value: 200,
      unit: "yuan",
      seed: 2_000,
    });

    const result = await buildQueryEvidenceCandidate(fixture.input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.observation.result_hash).toBe(fixture.sandbox_result.result_hash);
    expect(result.value.observation.row_count).toBe(1);
    expect(result.value.observation.schema_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.value.provenance_group).toMatch(/^sandbox:[a-f0-9]{64}$/);
    expect(result.value).not.toHaveProperty("status");
    expect(result.value).not.toHaveProperty("authority");
  });

  it("OED 只接受 identity-bound controlled assurance，普通 root/clone/错误 SQL 与错误 Policy 全部 fail closed", async () => {
    const world = await createResearchWorld(
      [{ obligation_id: "q1", metric_id: "net-revenue", unit: "yuan" }],
      1_500,
    );
    const fixture = await createQueryFixture({
      world,
      obligation_id: "q1",
      output_alias: "decline_amount",
      value: 200,
      unit: "yuan",
      seed: 1_700,
    });
    const assured = fixture.input.obligation_execution_decision_resolution.derivation_input;
    await expect(buildObligationExecutionDecisionCandidate(assured)).resolves.toMatchObject({
      ok: true,
      value: {
        verdict: "PASS",
        sql_artifact_ref: documentReference(assured.sql_artifact_document, "SqlArtifact"),
      },
    });
    const { assurance: _assurance, ...ordinaryRootInput } = assured;
    const noAssurance = await buildObligationExecutionDecisionCandidate(ordinaryRootInput);
    expect(noAssurance).toMatchObject({
      ok: true,
      value: {
        verdict: "FAIL",
        checks: {
          metric_formula: "MISMATCH",
          authorization_scope: "MISMATCH",
        },
      },
    });
    await expect(
      buildObligationExecutionDecisionCandidate({
        ...ordinaryRootInput,
        matches: Object.fromEntries(
          [
            "metric",
            "metric_formula",
            "time_window",
            "timezone",
            "grain",
            "dimensions",
            "grouping",
            "joins",
            "canonical_predicates",
            "cohort",
            "null_semantics",
            "authorization_scope",
          ].map((check) => [check, true]),
        ),
      } as unknown as BuildObligationExecutionDecisionCandidateInput),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "OBLIGATION_QUERY_SEMANTICS_MISMATCH" },
    });

    const clonedAssurance = { ...(assured.assurance as Record<string, unknown>) };
    const cloneAttempt = await buildObligationExecutionDecisionCandidate({
      ...assured,
      assurance: clonedAssurance,
    });
    expect(cloneAttempt).toMatchObject({ ok: true, value: { verdict: "FAIL" } });
    const jsonRoundTripAttempt = await buildObligationExecutionDecisionCandidate({
      ...assured,
      assurance: JSON.parse(JSON.stringify(assured.assurance)) as unknown,
    });
    expect(jsonRoundTripAttempt).toMatchObject({ ok: true, value: { verdict: "FAIL" } });

    const originalSql = assured.sql_artifact_document.payload;
    if (originalSql.artifact_type !== "SqlArtifact") throw new Error("SqlArtifact 类型漂移。");
    for (const [index, sql] of [
      "select 999::numeric as decline_amount",
      "select 999::numeric /* as decline_amount */ as wrong_alias",
      "select 'as decline_amount'::text as wrong_alias",
    ].entries()) {
      const sqlMaterial = {
        dialect: originalSql.dialect,
        sql,
        parameters: originalSql.parameters,
      };
      const wrongSqlDocument = await sealL2Document(
        {
          ...originalSql,
          ...sqlMaterial,
          query_hash: await computeSqlArtifactQueryHash(sqlMaterial),
        },
        1_800 + index,
      );
      const wrongSqlResult = await buildObligationExecutionDecisionCandidate({
        ...ordinaryRootInput,
        sql_artifact_document: wrongSqlDocument,
      });
      expect(wrongSqlResult).toMatchObject({
        ok: true,
        value: {
          verdict: "FAIL",
          checks: {
            metric_formula: "MISMATCH",
            authorization_scope: "MISMATCH",
          },
        },
      });
    }

    const wrongPolicyAttempt = await buildObligationExecutionDecisionCandidate({
      ...assured,
      policy_receipt_ref: reference("PolicyReceipt", 1_899),
    });
    expect(wrongPolicyAttempt).toMatchObject({
      ok: false,
      error: { code: "OBLIGATION_QUERY_SEMANTICS_MISMATCH" },
    });
  });

  it("拒绝把 S1 的 replayed OED 复用于 S2 QueryEvidence", async () => {
    const world = await createResearchWorld(
      [{ obligation_id: "q1", metric_id: "net-revenue", unit: "yuan" }],
      1_900,
    );
    const first = await createQueryFixture({
      world,
      obligation_id: "q1",
      output_alias: "decline_amount",
      value: 200,
      unit: "yuan",
      seed: 2_100,
    });
    const second = await createQueryFixture({
      world,
      obligation_id: "q1",
      output_alias: "decline_amount",
      value: 201,
      unit: "yuan",
      seed: 2_300,
    });

    await expect(
      buildQueryEvidenceCandidate({
        ...second.input,
        obligation_execution_decision_resolution:
          first.input.obligation_execution_decision_resolution,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "OBLIGATION_QUERY_SEMANTICS_MISMATCH" },
    });

    const originalOed = second.input.obligation_execution_decision_resolution.document.payload;
    if (originalOed.artifact_type !== "ObligationExecutionDecision") {
      throw new Error("OED fixture 类型漂移。");
    }
    const forgedWithoutHash = {
      ...originalOed,
      evaluator_version: "self-sealed-oed@9.9.9",
      decision_semantic_hash: hashes.a,
    };
    const forgedOedDocument = await sealResearchDocument(
      {
        ...forgedWithoutHash,
        decision_semantic_hash: await computeL2ResearchSemanticHash(forgedWithoutHash),
      },
      2_499,
    );
    await expect(
      buildQueryEvidenceCandidate({
        ...second.input,
        obligation_execution_decision_resolution: {
          ...second.input.obligation_execution_decision_resolution,
          document: forgedOedDocument,
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "OBLIGATION_QUERY_SEMANTICS_MISMATCH" },
    });
  });

  it("accepts a canonically equivalent permuted EvidencePlan document", async () => {
    const world = await createResearchWorld(
      [
        { obligation_id: "q1", metric_id: "base", unit: "yuan" },
        {
          obligation_id: "q2",
          metric_id: "dependent",
          unit: "yuan",
          depends_on: ["q1"],
        },
      ],
      2_500,
    );
    const plan = world.plan_document.payload;
    if (plan.artifact_type !== "EvidencePlan") {
      throw new Error("EvidencePlan fixture 类型漂移。");
    }
    const permutedPlanDocument = await sealResearchDocument(
      {
        ...plan,
        obligations: [...plan.obligations].reverse().map((obligation) => ({
          ...obligation,
          hypothesis_refs: [...obligation.hypothesis_refs].reverse(),
          success_criterion_refs: [...obligation.success_criterion_refs].reverse(),
          discriminating_test_ids: [...obligation.discriminating_test_ids].reverse(),
          depends_on: [...obligation.depends_on].reverse(),
        })),
      },
      2_599,
    );
    const fixture = await createQueryFixture({
      world: { ...world, plan_document: permutedPlanDocument },
      obligation_id: "q1",
      output_alias: "base_amount",
      value: 100,
      unit: "yuan",
      seed: 2_600,
    });

    await expect(buildQueryEvidenceCandidate(fixture.input)).resolves.toMatchObject({
      ok: true,
    });
  });

  it("rejects caller-provided observation/provenance and exact dependency gaps", async () => {
    const world = await createResearchWorld(
      [
        { obligation_id: "q1", metric_id: "base", unit: "yuan" },
        { obligation_id: "q2", metric_id: "dependent", unit: "yuan", depends_on: ["q1"] },
      ],
      3_000,
    );
    const q1 = await createQueryFixture({
      world,
      obligation_id: "q1",
      output_alias: "base_amount",
      value: 100,
      unit: "yuan",
      seed: 4_000,
    });
    await expect(
      buildQueryEvidenceCandidate({
        ...(
          await createQueryFixture({
            world,
            obligation_id: "q2",
            output_alias: "dependent_amount",
            value: 20,
            unit: "yuan",
            seed: 5_000,
            dependency_evidence_documents: [q1.query_evidence_document],
          })
        ).input,
        provenance_group: "caller-controlled",
        observation: {
          result_hash: hashes.a,
          row_count: 999,
          schema_hash: hashes.b,
        },
      } as unknown as BuildQueryEvidenceCandidateInput),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_SUPPORT_INSUFFICIENT" },
    });

    const q2Valid = await createQueryFixture({
      world,
      obligation_id: "q2",
      output_alias: "dependent_amount",
      value: 20,
      unit: "yuan",
      seed: 6_000,
      dependency_evidence_documents: [q1.query_evidence_document],
    });
    await expect(
      buildQueryEvidenceCandidate({
        ...q2Valid.input,
        dependency_evidence_documents: [],
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_COVERAGE_INSUFFICIENT" },
    });
  });

  it("rejects cross-paired L2 and Sandbox closure segments", async () => {
    const world = await createResearchWorld(
      [{ obligation_id: "q1", metric_id: "net-revenue", unit: "yuan" }],
      7_000,
    );
    const left = await createQueryFixture({
      world,
      obligation_id: "q1",
      output_alias: "decline_amount",
      value: 200,
      unit: "yuan",
      seed: 8_000,
    });
    const right = await createQueryFixture({
      world,
      obligation_id: "q1",
      output_alias: "decline_amount",
      value: 201,
      unit: "yuan",
      seed: 9_000,
    });

    await expect(
      buildQueryEvidenceCandidate({
        ...left.input,
        l2: {
          ...left.input.l2,
          execution_receipt_document: right.input.l2.execution_receipt_document,
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_SUPPORT_INSUFFICIENT" },
    });
    await expect(
      buildQueryEvidenceCandidate({
        ...left.input,
        sandbox: {
          ...left.input.sandbox,
          sandbox_execution_receipt: right.input.sandbox.sandbox_execution_receipt,
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_SUPPORT_INSUFFICIENT" },
    });
    await expect(
      buildQueryEvidenceCandidate({
        ...left.input,
        sandbox: {
          ...left.input.sandbox,
          sandbox_result: right.input.sandbox.sandbox_result,
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_SUPPORT_INSUFFICIENT" },
    });
  });

  it("rejects document tampering and a re-hashed result that is not bound by ExecutionReceipt", async () => {
    const world = await createResearchWorld(
      [{ obligation_id: "q1", metric_id: "net-revenue", unit: "yuan" }],
      10_000,
    );
    const fixture = await createQueryFixture({
      world,
      obligation_id: "q1",
      output_alias: "decline_amount",
      value: 200,
      unit: "yuan",
      seed: 11_000,
    });
    const sqlDocument = fixture.input.l2.sql_artifact_document;
    if (sqlDocument.payload.artifact_type !== "SqlArtifact") {
      throw new Error("SqlArtifact fixture 类型漂移。");
    }
    const tamperedSqlDocument = l2ArtifactDocumentSchema.parse({
      ...sqlDocument,
      payload: {
        ...sqlDocument.payload,
        sql: "select 999::numeric as decline_amount",
      },
    });
    await expect(
      buildQueryEvidenceCandidate({
        ...fixture.input,
        l2: {
          ...fixture.input.l2,
          sql_artifact_document: tamperedSqlDocument,
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_SUPPORT_INSUFFICIENT" },
    });

    const receipt = fixture.input.sandbox.sandbox_execution_receipt;
    const tamperedReceipt = successfulSandboxExecutionReceiptSchema.parse({
      ...receipt,
      executor: {
        ...receipt.executor,
        principal_id: "tampered-sandbox-principal",
      },
    });
    await expect(
      buildQueryEvidenceCandidate({
        ...fixture.input,
        sandbox: {
          ...fixture.input.sandbox,
          sandbox_execution_receipt: tamperedReceipt,
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_SUPPORT_INSUFFICIENT" },
    });

    const rehashedResult = await createSandboxResult({
      result_id: 11_007,
      execution_id: fixture.sandbox_result.execution_id,
      output_alias: "decline_amount",
      value: 999,
    });
    await expect(
      buildQueryEvidenceCandidate({
        ...fixture.input,
        sandbox: {
          ...fixture.input.sandbox,
          sandbox_result: rehashedResult,
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_SUPPORT_INSUFFICIENT" },
    });
  });

  it("derives AtomicClaim cells and rejects caller cells plus self-sealed semantic tampering", async () => {
    const world = await createResearchWorld(
      [{ obligation_id: "q1", metric_id: "net-revenue", unit: "yuan" }],
      12_000,
    );
    const fixture = await createQueryFixture({
      world,
      obligation_id: "q1",
      output_alias: "decline_amount",
      value: 200,
      unit: "yuan",
      seed: 13_000,
    });
    const valid = descriptiveClaimInput(fixture.claim_source, 200, "yuan");

    const result = await buildAtomicClaimCandidate(valid);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.observation_bindings[0]?.observed_value).toEqual({
      value_kind: "NUMBER",
      number_value: 200,
      text_value: null,
      unit: "yuan",
    });
    expect(result.value.observation_bindings[0]?.result_cell_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    const claimDocument = await sealResearchDocument(result.value, 13_100);
    await expect(
      verifyAtomicClaimDocumentDerivation({
        claim_document: claimDocument,
        observation_sources: valid.observation_sources,
      }),
    ).resolves.toMatchObject({ ok: true });
    const selfSealedTamperedClaim = await sealResearchDocument(
      {
        ...result.value,
        statement: "caller self-sealed statement",
        statement_hash: hashes.a,
      },
      13_101,
    );
    await expect(
      verifyAtomicClaimDocumentDerivation({
        claim_document: selfSealedTamperedClaim,
        observation_sources: valid.observation_sources,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ATOMIC_CLAIM_OBSERVATION_MISMATCH" },
    });
    await expect(
      buildAtomicClaimCandidate({
        ...valid,
        authoritative_observation_cells: [
          {
            binding_id: "forged",
            observed_value: {
              value_kind: "NUMBER",
              number_value: 999,
              text_value: null,
              unit: "yuan",
            },
          },
        ],
      } as unknown as BuildAtomicClaimCandidateInput),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ATOMIC_CLAIM_OBSERVATION_MISMATCH" },
    });
  });

  it("rejects AtomicClaim QE/Result cross-pairs and unsupported multi-row paths", async () => {
    const world = await createResearchWorld(
      [{ obligation_id: "q1", metric_id: "net-revenue", unit: "yuan" }],
      14_000,
    );
    const left = await createQueryFixture({
      world,
      obligation_id: "q1",
      output_alias: "decline_amount",
      value: 200,
      unit: "yuan",
      seed: 15_000,
    });
    const right = await createQueryFixture({
      world,
      obligation_id: "q1",
      output_alias: "decline_amount",
      value: 201,
      unit: "yuan",
      seed: 16_000,
    });
    await expect(
      buildAtomicClaimCandidate(
        descriptiveClaimInput(
          {
            ...left.claim_source,
            sandbox_result: right.sandbox_result,
          },
          201,
          "yuan",
        ),
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ATOMIC_CLAIM_OBSERVATION_MISMATCH" },
    });

    const evidenceDocument = left.query_evidence_document;
    if (evidenceDocument.payload.artifact_type !== "QueryEvidence") {
      throw new Error("QueryEvidence fixture 类型漂移。");
    }
    const tamperedEvidenceDocument = parseL2ResearchDocumentCandidate({
      ...evidenceDocument,
      payload: {
        ...evidenceDocument.payload,
        observation: {
          ...evidenceDocument.payload.observation,
          row_count: 999,
        },
      },
    });
    await expect(
      buildAtomicClaimCandidate(
        descriptiveClaimInput(
          {
            ...left.claim_source,
            query_evidence_document: tamperedEvidenceDocument,
          },
          200,
          "yuan",
        ),
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ATOMIC_CLAIM_OBSERVATION_MISMATCH" },
    });

    const oneRowOnly = {
      ...left.claim_source,
      selector: {
        ...left.claim_source.selector,
        row_index: 1,
      },
    };
    await expect(
      buildAtomicClaimCandidate(
        descriptiveClaimInput(oneRowOnly as unknown as ClaimObservationSource, 200, "yuan"),
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ATOMIC_CLAIM_OBSERVATION_MISMATCH" },
    });

    const multiRow = await createQueryFixture({
      world,
      obligation_id: "q1",
      output_alias: "decline_amount",
      value: 200,
      additional_values: [201],
      unit: "yuan",
      seed: 16_500,
    });
    await expect(
      buildAtomicClaimCandidate(descriptiveClaimInput(multiRow.claim_source, 200, "yuan")),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "ATOMIC_CLAIM_OBSERVATION_MISMATCH" },
    });
  });

  it("renders DIAGNOSTIC SUM_EQUALS with the derived outcome unit", async () => {
    const world = await createResearchWorld(
      [
        { obligation_id: "outcome", metric_id: "decline", unit: "yuan" },
        { obligation_id: "promotion", metric_id: "promotion", unit: "yuan" },
        { obligation_id: "refund", metric_id: "refund", unit: "yuan" },
      ],
      17_000,
    );
    const outcome = await createQueryFixture({
      world,
      obligation_id: "outcome",
      output_alias: "decline_amount",
      value: 200,
      unit: "yuan",
      seed: 18_000,
      binding_id: "outcome-binding",
    });
    const promotion = await createQueryFixture({
      world,
      obligation_id: "promotion",
      output_alias: "promotion_contribution",
      value: 120,
      unit: "yuan",
      seed: 19_000,
      binding_id: "promotion-binding",
    });
    const refund = await createQueryFixture({
      world,
      obligation_id: "refund",
      output_alias: "refund_contribution",
      value: 80,
      unit: "yuan",
      seed: 20_000,
      binding_id: "refund-binding",
    });

    const result = await buildAtomicClaimCandidate({
      claim_intent: {
        claim_id: "diagnostic-closure",
        limitations: ["Three independent single-metric Candidate queries"],
      },
      predicate: {
        claim_mode: "DIAGNOSTIC",
        outcome_change_binding_id: "outcome-binding",
        contribution_binding_ids: ["promotion-binding", "refund-binding"],
        operator: "SUM_EQUALS",
        asserted_value: 200,
        tolerance: 0,
      },
      observation_sources: [outcome.claim_source, promotion.claim_source, refund.claim_source],
      renderer: {
        renderer_version: ATOMIC_CLAIM_RENDERER_VERSION,
        locale: "zh-CN",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.statement).toBe(
      "promotion_contribution + refund_contribution 合计等于 200 yuan，与 decline_amount 一致。",
    );
  });

  it("renders COMPARATIVE 与 DIAGNOSTIC SHARE_OF 的正向权威 Observation 路径", async () => {
    const world = await createResearchWorld(
      [
        { obligation_id: "outcome", metric_id: "decline", unit: "yuan" },
        { obligation_id: "promotion", metric_id: "promotion", unit: "yuan" },
      ],
      20_100,
    );
    const outcome = await createQueryFixture({
      world,
      obligation_id: "outcome",
      output_alias: "decline_amount",
      value: 200,
      unit: "yuan",
      seed: 20_200,
      binding_id: "outcome-binding",
    });
    const contribution = await createQueryFixture({
      world,
      obligation_id: "promotion",
      output_alias: "promotion_contribution",
      value: 100,
      unit: "yuan",
      seed: 20_300,
      binding_id: "contribution-binding",
    });
    const common = {
      claim_intent: {
        claim_id: "comparison-and-share",
        limitations: ["Two independent single-metric Candidate queries"],
      },
      observation_sources: [outcome.claim_source, contribution.claim_source],
      renderer: {
        renderer_version: ATOMIC_CLAIM_RENDERER_VERSION,
        locale: "zh-CN" as const,
      },
    };

    const comparative = await buildAtomicClaimCandidate({
      ...common,
      predicate: {
        claim_mode: "COMPARATIVE",
        left_binding_id: "outcome-binding",
        right_binding_id: "contribution-binding",
        operator: "GT",
        absolute_delta: 100,
        relative_delta: 1,
      },
    });
    expect(comparative).toMatchObject({ ok: true });
    if (comparative.ok) {
      expect(comparative.value.statement).toBe(
        "decline_amount 大于 promotion_contribution；绝对差值为 100 yuan，相对差值为 1。",
      );
    }

    const share = await buildAtomicClaimCandidate({
      ...common,
      predicate: {
        claim_mode: "DIAGNOSTIC",
        outcome_change_binding_id: "outcome-binding",
        contribution_binding_ids: ["contribution-binding"],
        operator: "SHARE_OF",
        asserted_value: 0.5,
        tolerance: 0,
      },
    });
    expect(share).toMatchObject({ ok: true });
    if (share.ok) {
      expect(share.value.statement).toBe(
        "promotion_contribution 相对 decline_amount 的占比为 0.5。",
      );
    }
  });

  it("builds adverse relations from full documents and rejects mixed evidence payloads", async () => {
    const world = await createResearchWorld(
      [{ obligation_id: "q1", metric_id: "net-revenue", unit: "yuan" }],
      21_000,
    );
    const selected = await createQueryFixture({
      world,
      obligation_id: "q1",
      output_alias: "decline_amount",
      value: 200,
      unit: "yuan",
      seed: 22_000,
    });
    const other = await createQueryFixture({
      world,
      obligation_id: "q1",
      output_alias: "decline_amount",
      value: 201,
      unit: "yuan",
      seed: 23_000,
    });
    const claim = await buildAtomicClaimCandidate(
      descriptiveClaimInput(selected.claim_source, 200, "yuan"),
    );
    if (!claim.ok) throw new Error(claim.error.message);
    const claimDocument = await sealResearchDocument(claim.value, 24_000);

    const adverse = await buildEvidenceRelationCandidate({
      claim_document: claimDocument,
      evidence_document: selected.query_evidence_document,
      obligation: selected.obligation,
      proposed_relation: "REFUTES",
      rationale: "保留反向证据，不在 Candidate builder 内选择有利关系。",
    });

    expect(adverse.ok).toBe(true);
    if (!adverse.ok) return;
    expect(adverse.value.proposed_relation).toBe("REFUTES");
    await expect(
      buildEvidenceRelationCandidate({
        claim_document: claimDocument,
        evidence_document: other.query_evidence_document,
        obligation: selected.obligation,
        proposed_relation: "SUPPORTS",
        rationale: "cross pair",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "EVIDENCE_SUPPORT_INSUFFICIENT" },
    });
  });
});
