import {
  type AnalysisContext,
  type ArtifactReference,
  AUTHORITY_ROLE_POLICY_VERSION,
  collectL2ResearchPayloadArtifactReferences,
  computeDataSnapshotBindingHash,
  computeL2ArtifactContentHash,
  computeL2ResearchEnvelopeContentHash,
  computePostgresqlExecutionSettingsHash,
  computeSandboxExecutionReceiptHash,
  computeSandboxResultBytes,
  computeSandboxResultHash,
  computeSqlArtifactQueryHash,
  L2_RESEARCH_WIRE_VERSION_MATRIX,
  type L2ArtifactDocument,
  type L2ResearchDocumentCandidate,
  l2ArtifactDocumentSchema,
  parseL2ResearchDocumentCandidate,
  researchArtifactCommitInputSchema,
  sandboxResultSchema,
  successfulSandboxExecutionReceiptSchema,
  TEXT2SQL_VALIDATION_VERSION,
  type VersionFrontier,
  verifyAnalysisContext,
} from "@data-agent/contracts";
import { artifactReferenceSchema } from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import type { ResearchArtifactAuthorityPort } from "@data-agent/contracts/ports";
import type { RunWorkLease } from "@data-agent/contracts/runs";
import { FALCON24_AGENT_ANALYSIS_CASES } from "@data-agent/evals";
import {
  buildQueryEvidenceCandidate,
  compileEvidencePlanCandidate,
  compileHypothesisSetCandidate,
  compileResearchBriefCandidate,
  type ObligationExecutionDecisionDocumentResolution,
  type ResolvedProofObligation,
} from "@data-agent/research";
import { buildFrozenQueryRegistryOedCandidate } from "@data-agent/research/server";
import { deterministicAnalysisUuid } from "../analysis/deterministic-id.js";
import type { ResearchAuthorityCapabilityResolver } from "../runs/research-authority-capabilities.js";
import { verifyFalcon24AnalysisDataOracleReceipt } from "./falcon24-analysis-data-oracle.js";
import {
  FALCON24_ANALYSIS_QUERY_SPECS,
  type Falcon24AnalysisQuerySpec,
  normalizeFalcon24QueryResult,
} from "./falcon24-analysis-queries.js";
import type { Falcon24ExactQueryEvidenceAuthority } from "./falcon24-governed-query-port.js";

type TypedReference<T extends ArtifactReference["artifact_type"]> = ArtifactReference & {
  readonly artifact_type: T;
};

const CASES = new Map(
  FALCON24_AGENT_ANALYSIS_CASES.map((testCase) => [testCase.case_id, testCase]),
);
const INVARIANTS = ["ordered-columns-exact", "row-count-exact", "type-nullability-exact"] as const;

function fail(code: string): never {
  throw new TypeError(code);
}

function mustKernel<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } },
): T {
  if (!result.ok) fail(`${result.error.code}:${result.error.message}`);
  return result.value;
}

function sameScopeAndRun(reference: ArtifactReference, lease: RunWorkLease): boolean {
  return (
    reference.app_id === lease.scope.app_id &&
    reference.tenant_id === lease.scope.tenant_id &&
    reference.environment === lease.scope.environment &&
    reference.run_id === lease.run_id
  );
}

function typedReference<T extends ArtifactReference["artifact_type"]>(
  artifactType: T,
  lease: RunWorkLease,
  label: string,
  contentHash: `sha256:${string}`,
): TypedReference<T> {
  return artifactReferenceSchema.parse({
    artifact_id: deterministicAnalysisUuid(`falcon24-query-evidence\0${lease.run_id}\0${label}`),
    artifact_type: artifactType,
    ...lease.scope,
    run_id: lease.run_id,
    revision: 1,
    content_hash: contentHash,
  }) as TypedReference<T>;
}

async function contentAddressedReference<T extends ArtifactReference["artifact_type"]>(
  artifactType: T,
  lease: RunWorkLease,
  label: string,
  material: unknown,
): Promise<TypedReference<T>> {
  return typedReference(
    artifactType,
    lease,
    label,
    await sha256ContentHash({
      hash_domain: "falcon24-query-evidence-reference@1.0.0",
      artifact_type: artifactType,
      label,
      material,
    }),
  );
}

function documentReference<T extends ArtifactReference["artifact_type"]>(
  document: L2ArtifactDocument | L2ResearchDocumentCandidate,
  artifactType: T,
): TypedReference<T> {
  if (document.envelope.artifact_type !== artifactType) fail("FALCON24_DOCUMENT_TYPE_DRIFT");
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
      return fail(`FALCON24_L2_TYPE_UNSUPPORTED:${payload.artifact_type}`);
  }
}

function envelope(input: {
  readonly artifact_type: ArtifactReference["artifact_type"];
  readonly lease: RunWorkLease;
  readonly label: string;
  readonly input_refs: readonly ArtifactReference[];
  readonly schema_version: string;
  readonly content_hash: `sha256:${string}`;
  readonly created_at: string;
}) {
  return {
    artifact_id: deterministicAnalysisUuid(
      `falcon24-query-evidence-document\0${input.lease.run_id}\0${input.label}`,
    ),
    artifact_type: input.artifact_type,
    ...input.lease.scope,
    run_id: input.lease.run_id,
    revision: 1,
    parent_ref: null,
    attempt_id: input.lease.attempt_id,
    producer: { kind: "deterministic" as const, id: "falcon24-query-evidence-authority@1" },
    input_refs: [...input.input_refs],
    schema_version: input.schema_version,
    semantic_version: "1.0.0",
    policy_version: "falcon24-analysis-policy@1.0.0",
    model_profile_version: "deepseek-v4-flash@1.0.0",
    content_hash: input.content_hash,
    status: "CANDIDATE" as const,
    created_at: input.created_at,
  };
}

async function sealL2Document(input: {
  readonly payload: L2ArtifactDocument["payload"];
  readonly lease: RunWorkLease;
  readonly label: string;
  readonly created_at: string;
}): Promise<L2ArtifactDocument> {
  const placeholder = await sha256ContentHash({ label: input.label, placeholder: true });
  const draft = l2ArtifactDocumentSchema.parse({
    envelope: envelope({
      artifact_type: input.payload.artifact_type,
      lease: input.lease,
      label: input.label,
      input_refs: l2PayloadReferences(input.payload),
      schema_version: "1.0.0",
      content_hash: placeholder,
      created_at: input.created_at,
    }),
    payload: input.payload,
  });
  return l2ArtifactDocumentSchema.parse({
    ...draft,
    envelope: { ...draft.envelope, content_hash: await computeL2ArtifactContentHash(draft) },
  });
}

function researchSchemaVersion(payload: L2ResearchDocumentCandidate["payload"]): string {
  const tuple = L2_RESEARCH_WIRE_VERSION_MATRIX.find(
    ([artifactType, , protocolVersion]) =>
      artifactType === payload.artifact_type && protocolVersion === payload.protocol_version,
  );
  if (!tuple) fail("FALCON24_RESEARCH_WIRE_UNREGISTERED");
  return tuple[1];
}

async function sealResearchDocument(input: {
  readonly payload: L2ResearchDocumentCandidate["payload"];
  readonly lease: RunWorkLease;
  readonly label: string;
  readonly created_at: string;
}): Promise<L2ResearchDocumentCandidate> {
  const placeholder = await sha256ContentHash({ label: input.label, placeholder: true });
  const draft = parseL2ResearchDocumentCandidate({
    envelope: envelope({
      artifact_type: input.payload.artifact_type,
      lease: input.lease,
      label: input.label,
      input_refs: collectL2ResearchPayloadArtifactReferences(input.payload),
      schema_version: researchSchemaVersion(input.payload),
      content_hash: placeholder,
      created_at: input.created_at,
    }),
    payload: input.payload,
  });
  return parseL2ResearchDocumentCandidate({
    ...draft,
    envelope: {
      ...draft.envelope,
      content_hash: await computeL2ResearchEnvelopeContentHash(draft),
    },
  });
}

function aggregation(spec: Falcon24AnalysisQuerySpec): "SUM" | "AVG" | "RATIO" {
  if (spec.semantic_contract.unit === "ratio") return "RATIO";
  if (spec.semantic_contract.primary_metric_id === "metric.delivery_minutes") return "AVG";
  return "SUM";
}

async function exactSpecHash(spec: Falcon24AnalysisQuerySpec): Promise<`sha256:${string}`> {
  return sha256ContentHash({
    protocol_version: "falcon24-analysis-query@1.0.0",
    case_id: spec.case_id,
    input_name: spec.input_name,
    sql: spec.sql,
    columns: spec.columns,
    expected_rows: spec.expected_rows,
    semantic_contract: spec.semantic_contract,
  });
}

function verifyCorrelation(input: {
  readonly lease: RunWorkLease;
  readonly analysis_program_ref: ArtifactReference;
  readonly node_id: string;
  readonly spec: Falcon24AnalysisQuerySpec;
  readonly registered_spec: Falcon24AnalysisQuerySpec;
  readonly context: AnalysisContext;
}): void {
  if (
    input.node_id !== input.spec.case_id ||
    input.spec !== input.registered_spec ||
    input.analysis_program_ref.artifact_type !== "AnalysisProgram" ||
    !sameScopeAndRun(input.analysis_program_ref, input.lease) ||
    input.context.scope.app_id !== input.lease.scope.app_id ||
    input.context.scope.tenant_id !== input.lease.scope.tenant_id ||
    input.context.scope.environment !== input.lease.scope.environment
  ) {
    fail("FALCON24_QUERY_EVIDENCE_CORRELATION_INVALID");
  }
}

export function createFalcon24ExactQueryEvidenceAuthority(input: {
  readonly analysis_context: AnalysisContext;
  readonly datasource_id: string;
  readonly research_artifacts: ResearchArtifactAuthorityPort;
  readonly capabilities: ResearchAuthorityCapabilityResolver;
}): Falcon24ExactQueryEvidenceAuthority {
  return Object.freeze({
    async issue(command: Parameters<Falcon24ExactQueryEvidenceAuthority["issue"]>[0]) {
      const context = await verifyAnalysisContext(input.analysis_context);
      const registeredSpec =
        FALCON24_ANALYSIS_QUERY_SPECS[
          command.node_id as keyof typeof FALCON24_ANALYSIS_QUERY_SPECS
        ];
      if (!registeredSpec) fail("FALCON24_QUERY_CASE_NOT_REGISTERED");
      verifyCorrelation({ ...command, registered_spec: registeredSpec, context });
      if ((await exactSpecHash(command.spec)) !== command.spec_hash) {
        fail("FALCON24_QUERY_SPEC_HASH_INVALID");
      }
      const oracle = await verifyFalcon24AnalysisDataOracleReceipt(command.data_oracle_receipt);
      const normalized = normalizeFalcon24QueryResult(command.spec, command.rows);
      const semanticMetric = context.metrics.find(
        ({ metric_ref: metricRef }) =>
          metricRef.node_id === command.spec.semantic_contract.primary_metric_id,
      );
      if (!semanticMetric) fail("FALCON24_QUERY_PRIMARY_METRIC_NOT_AUTHORIZED");
      if (
        semanticMetric.metric_ref.container_ref.content_hash !==
        context.semantic_release_ref.content_hash
      ) {
        fail("FALCON24_QUERY_PRIMARY_METRIC_RELEASE_DRIFT");
      }
      const testCase = CASES.get(command.spec.case_id);
      if (!testCase) fail("FALCON24_QUERY_CASE_NOT_REGISTERED");
      const createdAt = command.execution_completed_at;
      const questionFrameRef = await contentAddressedReference(
        "QuestionFrame",
        command.lease,
        `${command.node_id}:question-frame`,
        { question: testCase.question, analysis_context_hash: context.context_hash },
      );
      const policyDigest = await sha256ContentHash({
        policy_receipt_ref: context.policy_receipt_ref,
        analysis_context_hash: context.context_hash,
      });
      const retentionHash = await sha256ContentHash({
        policy: "falcon24-analysis-retention@1.0.0",
      });
      const briefPayload = mustKernel(
        await compileResearchBriefCandidate({
          question_frame_ref: questionFrameRef,
          scope: {
            subject: testCase.question,
            time_window: command.spec.semantic_contract.time_range,
            dimensions: command.spec.columns.slice(0, -1).map(({ name }) => name),
            metric_refs: [semanticMetric.metric_ref],
          },
          success_criteria: [
            {
              criterion_id: `${command.node_id}-exact-evidence`,
              statement: "冻结查询、语义契约、数据快照与结果必须形成可重放的精确证据闭包。",
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
            enumerator_version: "falcon24-hypothesis-enumerator@1.0.0",
            required_disclosure: "BOUNDED_HYPOTHESIS_UNIVERSE",
          },
          freshness_policy: { max_age_seconds: 3_600, require_snapshot_replayable: true },
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
            max_model_calls: 8,
            max_sql_executions: 1,
            max_source_calls: 0,
            max_elapsed_ms: 300_000,
            max_provider_input_tokens_per_call: 32_000,
            max_provider_output_tokens_per_call: 8_000,
            max_provider_tokens_per_run: 64_000,
            max_provider_cost_microusd_per_run: 5_000_000,
          },
          policy_ref: context.policy_receipt_ref,
          policy_digest: policyDigest,
          data_classification: "INTERNAL",
          retention_policy_ref: {
            policy_id: "falcon24-analysis-retention",
            policy_version: "1.0.0",
            policy_hash: retentionHash,
          },
        }),
      );
      const briefDocument = await sealResearchDocument({
        payload: briefPayload,
        lease: command.lease,
        label: `${command.node_id}:brief`,
        created_at: createdAt,
      });
      const briefRef = documentReference(briefDocument, "ResearchBrief");
      const hypothesisPayload = mustKernel(
        await compileHypothesisSetCandidate({
          brief_ref: briefRef,
          hypotheses: [
            {
              hypothesis_id: `${command.node_id}-signal`,
              mechanism_class: "observed-business-signal",
              statement: "业务指标变化与题目所述主要业务信号一致。",
              predictions: [`${command.spec.semantic_contract.metric_output} 产生可观测变化`],
              falsifiers: [`${command.spec.semantic_contract.metric_output} 不存在有效观测`],
              discriminating_test_ids: [`${command.node_id}-signal-test`],
              materiality: "MATERIAL",
            },
            {
              hypothesis_id: `${command.node_id}-alternative`,
              mechanism_class: "alternative-business-signal",
              statement: "替代业务机制比主要信号更能解释观测变化。",
              predictions: ["替代分组或滞后结构产生更强观测"],
              falsifiers: ["替代分组或滞后结构不产生有效观测"],
              discriminating_test_ids: [`${command.node_id}-alternative-test`],
              materiality: "MATERIAL",
            },
          ],
          mechanism_validator_version: "falcon24-mechanism-validator@1.0.0",
        }),
      );
      const hypothesisDocument = await sealResearchDocument({
        payload: hypothesisPayload,
        lease: command.lease,
        label: `${command.node_id}:hypotheses`,
        created_at: createdAt,
      });
      const hypothesisRef = documentReference(hypothesisDocument, "HypothesisSet");
      const evidencePlanPayload = mustKernel(
        await compileEvidencePlanCandidate({
          brief_document: briefDocument,
          hypothesis_set_document: hypothesisDocument,
          obligations: [
            {
              obligation_id: `${command.node_id}-query`,
              hypothesis_refs: [
                { container_ref: hypothesisRef, node_id: `${command.node_id}-signal` },
                { container_ref: hypothesisRef, node_id: `${command.node_id}-alternative` },
              ],
              success_criterion_refs: [
                { container_ref: briefRef, node_id: `${command.node_id}-exact-evidence` },
              ],
              discriminating_test_ids: [
                `${command.node_id}-signal-test`,
                `${command.node_id}-alternative-test`,
              ],
              materiality: "CRITICAL",
              evidence_kind: "QUERY",
              depends_on: [],
              observation_contract: {
                metric_ref: semanticMetric.metric_ref,
                aggregation: aggregation(command.spec),
                unit: command.spec.semantic_contract.unit,
                support_predicate: { operator: "GTE", threshold: 0 },
                refute_predicate: { operator: "LT", threshold: 0 },
                null_behavior: "FAIL",
              },
              failure_behavior: "BLOCK_READY",
            },
          ],
          planner_version: "falcon24-evidence-planner@1.0.0",
        }),
      );
      const evidencePlanDocument = await sealResearchDocument({
        payload: evidencePlanPayload,
        lease: command.lease,
        label: `${command.node_id}:evidence-plan`,
        created_at: createdAt,
      });
      const evidencePlanRef = documentReference(evidencePlanDocument, "EvidencePlan");
      const queryContractDocument = await sealL2Document({
        payload: {
          artifact_type: "QueryContract",
          evidence_plan_ref: evidencePlanRef,
          metric: command.spec.semantic_contract.metric_output,
          dimensions: command.spec.columns.slice(0, -1).map(({ name }) => name),
          grain: command.spec.semantic_contract.grain,
          time_range: command.spec.semantic_contract.time_range,
          unit: command.spec.semantic_contract.unit,
          filters: [],
          datasource_id: input.datasource_id,
          result_contract: {
            columns: command.spec.columns.map(({ name }) => name),
            invariant_ids: [...INVARIANTS],
          },
        },
        lease: command.lease,
        label: `${command.node_id}:query-contract`,
        created_at: createdAt,
      });
      const queryContractRef = documentReference(queryContractDocument, "QueryContract");
      const logicalPlanRef = await contentAddressedReference(
        "LogicalPlan",
        command.lease,
        `${command.node_id}:logical-plan`,
        { query_contract_ref: queryContractRef, spec_hash: command.spec_hash },
      );
      const queryHash = await computeSqlArtifactQueryHash({
        dialect: "postgresql",
        sql: command.spec.sql,
        parameters: {},
      });
      const sqlArtifactDocument = await sealL2Document({
        payload: {
          artifact_type: "SqlArtifact",
          logical_plan_ref: logicalPlanRef,
          compiler_version: "falcon24-frozen-query-compiler@1.0.0",
          ast_hash: await sha256ContentHash({
            sql: command.spec.sql,
            spec_hash: command.spec_hash,
          }),
          dialect: "postgresql",
          sql: command.spec.sql,
          parameters: {},
          query_hash: queryHash,
          semantic_context_binding_hash: context.context_hash,
        },
        lease: command.lease,
        label: `${command.node_id}:sql`,
        created_at: createdAt,
      });
      const sqlArtifactRef = documentReference(sqlArtifactDocument, "SqlArtifact");
      const obligation: ResolvedProofObligation = {
        evidence_plan_document: evidencePlanDocument,
        obligation_id: `${command.node_id}-query`,
      };
      const oedResult = mustKernel(
        await buildFrozenQueryRegistryOedCandidate({
          binding: {
            brief_ref: briefRef,
            evidence_plan_ref: evidencePlanRef,
            query_contract_ref: queryContractRef,
            sql_artifact_ref: sqlArtifactRef,
            semantic_release_ref: context.semantic_release_ref,
            policy_receipt_ref: context.policy_receipt_ref,
          },
          derivation_input: {
            brief_document: briefDocument,
            obligation,
            query_contract_document: queryContractDocument,
            sql_artifact_document: sqlArtifactDocument,
            semantic_release_ref: context.semantic_release_ref,
            policy_receipt_ref: context.policy_receipt_ref,
            evaluator_version: "falcon24-obligation-evaluator@1.0.0",
          },
          verifier_result: {
            profile: "FROZEN_QUERY_REGISTRY",
            compiler_verifier_version: "falcon24-frozen-query-verifier@1.0.0",
            compiler_evidence_hash: queryHash,
            policy_verifier_version: "falcon24-policy-verifier@1.0.0",
            policy_evidence_hash: context.policy_receipt_ref.content_hash,
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
      );
      const oedDocument = await sealResearchDocument({
        payload: oedResult.payload,
        lease: command.lease,
        label: `${command.node_id}:oed`,
        created_at: createdAt,
      });
      const oedResolution: ObligationExecutionDecisionDocumentResolution = {
        document: oedDocument,
        derivation_input: oedResult.derivation_input,
      };
      const executionId = deterministicAnalysisUuid(
        `falcon24-query-execution\0${command.lease.run_id}\0${command.idempotency_key}`,
      );
      const snapshotToken = `falcon24-${oracle.receipt_hash.slice("sha256:".length, "sha256:".length + 24)}`;
      const placeholderResultRef = await contentAddressedReference(
        "SandboxResult",
        command.lease,
        `${command.node_id}:sandbox-result`,
        { execution_id: executionId, spec_hash: command.spec_hash },
      );
      const resultDraft = sandboxResultSchema.parse({
        schema_version: "falcon24-query-result@1.0.0",
        result_ref: placeholderResultRef,
        scope: command.lease.scope,
        run_id: command.lease.run_id,
        execution_id: executionId,
        columns: normalized.columns,
        rows: normalized.rows,
        row_count: normalized.rows.length,
        bytes: computeSandboxResultBytes(normalized),
        result_hash: placeholderResultRef.content_hash,
      });
      const resultHash = await computeSandboxResultHash(resultDraft);
      const sandboxResult = sandboxResultSchema.parse({
        ...resultDraft,
        result_ref: { ...resultDraft.result_ref, content_hash: resultHash },
        result_hash: resultHash,
      });
      const executionPermitRef = await contentAddressedReference(
        "ExecutionPermit",
        command.lease,
        `${command.node_id}:execution-permit`,
        { sql_artifact_ref: sqlArtifactRef, policy_receipt_ref: context.policy_receipt_ref },
      );
      const resourceAdmissionRef = await contentAddressedReference(
        "ResourceAdmissionReceipt",
        command.lease,
        `${command.node_id}:resource-admission`,
        { datasource_id: input.datasource_id, expected_rows: command.spec.expected_rows },
      );
      const executionSettings = {
        database_role: "falcon24-analysis-reader",
        search_path: ["falcon_db_24"],
        plan_cache_mode: "force_custom_plan" as const,
        statement_timeout_ms: command.statement_timeout_ms,
        lock_timeout_ms: Math.max(1, Math.min(1_000, command.statement_timeout_ms - 1)),
      };
      const placeholderReceiptRef = await contentAddressedReference(
        "SandboxExecutionReceipt",
        command.lease,
        `${command.node_id}:sandbox-receipt`,
        { execution_id: executionId, result_ref: sandboxResult.result_ref },
      );
      const elapsedMs = Math.max(
        0,
        Date.parse(command.execution_completed_at) - Date.parse(command.execution_started_at),
      );
      const receiptDraft = successfulSandboxExecutionReceiptSchema.parse({
        schema_version: "falcon24-query-result@1.0.0",
        language: "sql",
        executor: {
          authority_id: deterministicAnalysisUuid("falcon24-query-evidence-authority"),
          principal_id: command.lease.principal_id,
          key_id: "falcon24-query-evidence-key@1.0.0",
        },
        executor_role: "SANDBOX_EXECUTION",
        authority_role_policy_version: AUTHORITY_ROLE_POLICY_VERSION,
        receipt_id: placeholderReceiptRef.artifact_id,
        receipt_ref: placeholderReceiptRef,
        scope: command.lease.scope,
        run_id: command.lease.run_id,
        execution_id: executionId,
        idempotency_key: command.idempotency_key,
        input_hash: await sha256ContentHash({
          spec_hash: command.spec_hash,
          snapshot_receipt_hash: oracle.receipt_hash,
          execution_permit_ref: executionPermitRef,
        }),
        execution_hash: placeholderReceiptRef.content_hash,
        terminal: "COMPLETED",
        reason_code: "EXECUTION_COMPLETED",
        started_at: command.execution_started_at,
        completed_at: command.execution_completed_at,
        result_artifact_ref: sandboxResult.result_ref,
        sql_artifact_ref: sqlArtifactRef,
        execution_permit_ref: executionPermitRef,
        resource_admission_ref: resourceAdmissionRef,
        datasource_id: input.datasource_id,
        settings_hash: await computePostgresqlExecutionSettingsHash(executionSettings),
        execution_settings: executionSettings,
        transaction: {
          transaction_id: executionId,
          read_only: true,
          isolation_level: "REPEATABLE_READ",
        },
        authority_revalidation: {
          effective_principal_id: command.lease.principal_id,
          policy_receipt_ref: context.policy_receipt_ref,
          revalidated_at: command.execution_started_at,
          authority_epoch: command.lease.worker_fence,
        },
        snapshot_token: snapshotToken,
        watermark: null,
        replay_state: "REPLAYABLE",
        resource_usage: {
          elapsed_ms: elapsedMs,
          rows: sandboxResult.row_count,
          bytes: sandboxResult.bytes,
          peak_memory_mb: 1,
        },
      });
      const executionHash = await computeSandboxExecutionReceiptHash(receiptDraft);
      const sandboxReceipt = successfulSandboxExecutionReceiptSchema.parse({
        ...receiptDraft,
        receipt_ref: { ...receiptDraft.receipt_ref, content_hash: executionHash },
        execution_hash: executionHash,
      });
      const executionReceiptDocument = await sealL2Document({
        payload: {
          artifact_type: "ExecutionReceipt",
          sql_artifact_ref: sqlArtifactRef,
          execution_permit_ref: executionPermitRef,
          sandbox_execution_receipt_ref: sandboxReceipt.receipt_ref,
          result_artifact_ref: sandboxResult.result_ref,
          datasource_id: input.datasource_id,
          schema_version: sandboxResult.schema_version,
          snapshot_token: snapshotToken,
          watermark: null,
          observed_at: command.execution_completed_at,
          query_hash: queryHash,
          result_hash: sandboxResult.result_hash,
          replay_state: "REPLAYABLE",
          row_count: sandboxResult.row_count,
        },
        lease: command.lease,
        label: `${command.node_id}:execution-receipt`,
        created_at: createdAt,
      });
      const executionReceiptRef = documentReference(executionReceiptDocument, "ExecutionReceipt");
      const gateReceiptRefs = await Promise.all(
        ["INTENT", "SEMANTIC", "STRUCTURAL", "POLICY", "RESOURCE", "EXECUTION", "RESULT"].map(
          (gate) =>
            contentAddressedReference(
              "GateReceipt",
              command.lease,
              `${command.node_id}:gate:${gate}`,
              {
                gate,
                verdict: "PASS",
                spec_hash: command.spec_hash,
                execution_receipt_ref: executionReceiptRef,
              },
            ),
        ),
      );
      const validationReceiptDocument = await sealL2Document({
        payload: {
          artifact_type: "ValidationReceipt",
          sql_artifact_ref: sqlArtifactRef,
          execution_receipt_ref: executionReceiptRef,
          gate_receipt_refs: gateReceiptRefs,
          validation_version: TEXT2SQL_VALIDATION_VERSION,
          sealed_at: command.execution_completed_at,
        },
        lease: command.lease,
        label: `${command.node_id}:validation-receipt`,
        created_at: createdAt,
      });
      const snapshotDraft = {
        protocol_version: "data-snapshot-binding@1.0.0" as const,
        datasource_id: input.datasource_id,
        strategy: "CONTROLLED_REVISION" as const,
        snapshot_token: snapshotToken,
        schema_manifest_hash: context.schema_snapshot_ref.content_hash,
        data_manifest_hash: oracle.receipt_hash,
        fixture_manifest_hash: command.spec_hash,
        replay_state: "REPLAYABLE" as const,
      };
      const observedVersion: VersionFrontier = {
        semantic_release_ref: context.semantic_release_ref,
        schema_snapshot_ref: context.schema_snapshot_ref,
        data_snapshot: {
          ...snapshotDraft,
          binding_hash: await computeDataSnapshotBindingHash(snapshotDraft),
        },
        policy_receipt_ref: context.policy_receipt_ref,
        identity_binding: {
          principal_id: command.lease.principal_id,
          delegation_chain_hash: await sha256ContentHash({
            principal_id: command.lease.principal_id,
            run_id: command.lease.run_id,
            attempt_id: command.lease.attempt_id,
          }),
          authority_epoch: command.lease.worker_fence,
        },
      };
      const queryEvidencePayload = mustKernel(
        await buildQueryEvidenceCandidate({
          obligation,
          obligation_execution_decision_resolution: oedResolution,
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
          dependency_evidence_documents: [],
          observed_version: observedVersion,
        }),
      );
      const queryEvidenceDocument = await sealResearchDocument({
        payload: queryEvidencePayload,
        lease: command.lease,
        label: `${command.node_id}:query-evidence`,
        created_at: createdAt,
      });
      const queryEvidenceRef = documentReference(queryEvidenceDocument, "QueryEvidence");
      const commit = researchArtifactCommitInputSchema.parse({
        schema_version: "1.0.0",
        scope: command.lease.scope,
        run_id: command.lease.run_id,
        principal_id: command.lease.principal_id,
        idempotency_key: `${command.idempotency_key}:query-evidence`,
        commit_id: deterministicAnalysisUuid(
          `falcon24-query-evidence-commit\0${command.lease.run_id}\0${command.idempotency_key}`,
        ),
        attempt_id: command.lease.attempt_id,
        worker_fence: command.lease.worker_fence,
        candidate: queryEvidenceDocument,
        expected_parent_ref: null,
      });
      const committed = await input.research_artifacts.commitCurrent(
        input.capabilities.forArtifactType("QueryEvidence"),
        commit,
      );
      if (!committed.ok) fail(`FALCON24_QUERY_EVIDENCE_COMMIT_FAILED:${committed.error.code}`);
      if (
        committed.value.reference.artifact_type !== "QueryEvidence" ||
        committed.value.reference.content_hash !== queryEvidenceRef.content_hash ||
        !sameScopeAndRun(committed.value.reference, command.lease)
      ) {
        fail("FALCON24_QUERY_EVIDENCE_COMMIT_CORRELATION_INVALID");
      }
      return {
        query_evidence_ref: committed.value.reference as TypedReference<"QueryEvidence">,
        query_evidence_document: queryEvidenceDocument,
      };
    },
  });
}
