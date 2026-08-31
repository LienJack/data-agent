import {
  type ArtifactReference,
  analysisSandboxExecutionReceiptSchema,
  buildArtifactWorkspaceChartDocumentV2,
  buildArtifactWorkspaceChartDocumentV3,
  buildProductTeamArtifactDocument,
  buildQueryEvidenceSemanticBinding,
  buildSemanticQueryContext,
  canonicalizeJson,
  collectL2ResearchPayloadArtifactReferences,
  computeL2ArtifactContentHash,
  computeL2ResearchEnvelopeContentHash,
  computeSandboxResultBytes,
  computeSandboxResultHash,
  computeSqlArtifactQueryHash,
  l2ArtifactDocumentSchema,
  parseL2ResearchDocumentCandidate,
  runRuntimeEventSchema,
  sandboxResultSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { analysisResultContractFixture } from "@data-agent/contracts/testing";
import { describe, expect, it } from "vitest";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresResolutionTraceProjector } from "../../src/runs/postgres-resolution-trace.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { buildTestQueryEvidenceSemanticBinding } from "../support/query-evidence-semantic-binding.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const ids = {
  app: id(1),
  tenant: id(2),
  principal: id(3),
  run: id(4),
  conversation: id(5),
  config: id(6),
  deployment: id(7),
  event: id(8),
  command: id(9),
  sql: id(10),
  plan: id(11),
  attempt: id(12),
} as const;
const scope = { app_id: ids.app, tenant_id: ids.tenant, environment: "test" } as const;
const occurredAt = "2026-08-18T12:00:00.000Z";

function issueCapability() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: ids.deployment, app_id: ids.app, environment: "test" }],
    [
      {
        subject: ids.principal,
        deployment_id: ids.deployment,
        tenant_id: ids.tenant,
        role: "ANALYST",
      },
    ],
  );
  const resolved = registry.resolveForDeployment(ids.deployment, { subject: ids.principal });
  if (!resolved.ok) throw new Error("capability fixture failed");
  return {
    capability: resolved.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

function scriptedPool(
  handle: (text: string, values: readonly unknown[]) => SqlQueryResult | undefined,
) {
  const calls: { text: string; values: readonly unknown[] }[] = [];
  const client: SqlClient = {
    async query<Row extends object = Record<string, unknown>>(text: string, values = []) {
      calls.push({ text, values });
      const handled = handle(text, values);
      if (handled) {
        if (
          text.includes("from analysis_system_artifacts") &&
          text.includes("from text2sql_system_artifacts")
        ) {
          return {
            ...handled,
            rows: handled.rows.map((row) => ({
              source_store: "ARTIFACTS",
              is_active: true,
              document_json: null,
              payload_json: null,
              content_bytes: null,
              authority_epoch: "E1",
              authority_baseline_id: id(90),
              authority_baseline_hash: hash("e"),
              authority_activation_attempt_id: id(91),
              ...row,
            })),
          } as unknown as SqlQueryResult<Row>;
        }
        return handled as SqlQueryResult<Row>;
      }
      if (text.includes("backend_context_matches"))
        return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
      return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
    },
    release() {},
  };
  const pool: SqlPool = { connect: async () => client };
  return { pool, calls };
}

const accepted = runRuntimeEventSchema.parse({
  schema_version: "1.0.0",
  event_id: ids.event,
  scope,
  run_id: ids.run,
  sequence: 1,
  worker_fence: 0,
  idempotency_key: `event:${ids.event}`,
  occurred_at: occurredAt,
  event_type: "run.accepted",
  payload: { command_id: ids.command, payload_hash: hash("1") },
});

async function eventRow(sequence = 1, eventHash?: string) {
  const event = { ...accepted, sequence };
  return {
    app_id: scope.app_id,
    tenant_id: scope.tenant_id,
    environment: scope.environment,
    event_id: event.event_id,
    run_id: event.run_id,
    sequence,
    event_type: event.event_type,
    payload_json: event.payload,
    worker_fence: event.worker_fence,
    dedupe_key: event.idempotency_key,
    event_hash: eventHash ?? (await sha256ContentHash(event)),
    event_document: event,
    created_at: event.occurred_at,
  };
}

async function toolCompletedEventRow(artifactRefs: readonly ArtifactReference[]) {
  const event = runRuntimeEventSchema.parse({
    schema_version: "run-runtime-event@2.0.0",
    event_id: ids.event,
    scope,
    run_id: ids.run,
    sequence: 1,
    worker_fence: 1,
    idempotency_key: `event:${ids.event}`,
    occurred_at: occurredAt,
    event_type: "run.tool_completed",
    payload: {
      call_id: "call-artifact-reference",
      tool_name: "sql.sandbox.execute",
      profile_id: "governed-text2sql-agent",
      task_id: ids.attempt,
      summary: "查询完成",
      output: null,
      duration_ms: 20,
      artifact_refs: artifactRefs,
    },
  });
  return {
    app_id: scope.app_id,
    tenant_id: scope.tenant_id,
    environment: scope.environment,
    event_id: event.event_id,
    run_id: event.run_id,
    sequence: event.sequence,
    event_type: event.event_type,
    payload_json: event.payload,
    worker_fence: event.worker_fence,
    dedupe_key: event.idempotency_key,
    event_hash: await sha256ContentHash(event),
    event_document: event,
    created_at: event.occurred_at,
  };
}

function authorityRow() {
  return {
    run_id: ids.run,
    principal_id: ids.principal,
    conversation_id: ids.conversation,
    conversation_title: "订单分析",
    conversation_resource_version: 3,
    conversation_message_count: 4,
    datasource_id: id(14),
    config_id: ids.config,
    config_revision: 1,
    config_hash: hash("2"),
    schema_snapshot_hash: hash("3"),
    config_committed_at: occurredAt,
    effective_config_json: null,
    question: "统计本月订单",
    run_status: "RUNNING",
    active_fence: 1,
    active_attempt_id: ids.attempt,
    attempt_count: 2,
    run_created_at: occurredAt,
    run_updated_at: occurredAt,
    authority_epoch: "E1",
    authority_baseline_id: id(90),
    authority_baseline_hash: hash("e"),
    authority_activation_attempt_id: id(91),
    current_authority_epoch: "E1",
    current_baseline_id: id(90),
    current_baseline_hash: hash("e"),
    current_activation_attempt_id: id(91),
  };
}

async function sqlArtifactRow() {
  const logicalPlanRef = {
    artifact_id: ids.plan,
    artifact_type: "LogicalPlan" as const,
    ...scope,
    run_id: ids.run,
    revision: 1,
    content_hash: hash("4"),
  };
  const sqlPayload = {
    artifact_type: "SqlArtifact" as const,
    logical_plan_ref: logicalPlanRef,
    compiler_version: "postgresql-compiler@1.0.0",
    ast_hash: hash("5"),
    dialect: "postgresql" as const,
    sql: "select $1::integer as private_value",
    parameters: { $1: 42 },
    query_hash: await computeSqlArtifactQueryHash({
      dialect: "postgresql",
      sql: "select $1::integer as private_value",
      parameters: { $1: 42 },
    }),
  };
  const draft = l2ArtifactDocumentSchema.parse({
    envelope: {
      artifact_id: ids.sql,
      artifact_type: "SqlArtifact",
      ...scope,
      run_id: ids.run,
      revision: 1,
      parent_ref: null,
      attempt_id: ids.attempt,
      producer: { kind: "deterministic", id: "sql-compiler" },
      input_refs: [logicalPlanRef],
      schema_version: "1.0.0",
      semantic_version: "1.0.0",
      policy_version: "1.0.0",
      model_profile_version: "1.0.0",
      content_hash: hash("0"),
      status: "COMMITTED",
      created_at: occurredAt,
    },
    payload: sqlPayload,
  });
  const contentHash = await computeL2ArtifactContentHash(draft);
  const document = l2ArtifactDocumentSchema.parse({
    ...draft,
    envelope: { ...draft.envelope, content_hash: contentHash },
  });
  return {
    artifact_id: ids.sql,
    artifact_type: "SqlArtifact",
    revision: 1,
    content_hash: contentHash,
    document_json: document,
    created_at: occurredAt,
  };
}

function referenceOnlyRow(reference: ArtifactReference) {
  return {
    artifact_id: reference.artifact_id,
    artifact_type: reference.artifact_type,
    revision: reference.revision,
    content_hash: reference.content_hash,
    document_json: {},
    created_at: occurredAt,
  };
}

async function productTeamSqlArtifactRow() {
  const document = await buildProductTeamArtifactDocument({
    schema_version: "product-team-artifact@2.0.0",
    artifact_ref: {
      artifact_id: ids.sql,
      artifact_type: "SqlArtifact",
      ...scope,
      run_id: ids.run,
      revision: 1,
      content_hash: hash("0"),
    },
    profile_id: "governed-text2sql-agent",
    task_id: ids.attempt,
    source_refs: [],
    provenance: {
      kind: "TEXT2SQL_CANDIDATE",
      candidate_hash: hash("1"),
      parameters_hash: hash("2"),
      parameter_count: 0,
      datasource_ref: {
        resource_id: id(20),
        resource_revision: 1,
        resource_hash: hash("3"),
      },
      schema_snapshot_ref: { resource_id: id(21), resource_hash: hash("4") },
      semantic_context_ref: { package_id: id(22), package_hash: hash("5") },
      semantic_query_context_ref: null,
      semantic_query_context_hash: null,
      target_binding_hash: hash("6"),
    },
    projection: {
      kind: "SQL",
      dialect: "postgresql",
      sql: "select count(*) from orders",
    },
    committed_at: occurredAt,
  });
  return {
    artifact_id: document.artifact_ref.artifact_id,
    artifact_type: document.artifact_ref.artifact_type,
    revision: document.artifact_ref.revision,
    content_hash: document.artifact_ref.content_hash,
    document_json: document,
    created_at: occurredAt,
  };
}

async function productTeamSemanticContextRow() {
  const datasourceId = id(201);
  const context = await buildSemanticQueryContext({
    schema_version: "semantic-query-context@1.0.0",
    answer_scope: "SEMANTIC_FACTS_ONLY",
    scope,
    run_id: ids.run,
    semantic_domain: "commerce",
    semantic_release: {
      resource_id: id(202),
      resource_revision: 1,
      resource_hash: hash("2"),
      datasource_id: datasourceId,
      semantic_generation: 1,
      publication_status: "PUBLISHED",
    },
    schema_snapshot: {
      resource_id: id(203),
      resource_revision: 1,
      resource_hash: hash("3"),
      datasource_id: datasourceId,
      semantic_release_id: id(202),
      semantic_generation: 1,
    },
    datasource: {
      resource_id: datasourceId,
      resource_revision: 1,
      resource_hash: hash("4"),
    },
    semantic_context_ref: {
      package_id: id(204),
      package_hash: hash("5"),
      receipt_id: id(205),
      receipt_hash: hash("6"),
      retrieval_receipt_hash: hash("7"),
      inference_receipt_hash: hash("8"),
    },
    requested_object_ids: ["quality.orders_nonnegative"],
    metrics: [],
    dimensions: [],
    formulas: [],
    relationships: [],
    physical_bindings: [],
    time_semantics: [],
    quality_constraints: [
      {
        constraint_id: "quality.orders_nonnegative",
        expression: "orders.amount >= 0",
        severity: "ERROR",
        sensitivity: "INTERNAL",
      },
    ],
    unresolved_ambiguities: [],
  });
  const document = await buildProductTeamArtifactDocument({
    schema_version: "product-team-artifact@2.0.0",
    artifact_ref: {
      artifact_id: id(206),
      artifact_type: "SemanticQueryContext",
      ...scope,
      run_id: ids.run,
      revision: 1,
      content_hash: hash("0"),
    },
    profile_id: "semantic-management-agent",
    task_id: ids.attempt,
    source_refs: [],
    provenance: null,
    projection: { kind: "SEMANTIC_CONTEXT", context },
    committed_at: occurredAt,
  });
  return {
    artifact_id: document.artifact_ref.artifact_id,
    artifact_type: document.artifact_ref.artifact_type,
    revision: document.artifact_ref.revision,
    content_hash: document.artifact_ref.content_hash,
    document_json: document,
    created_at: occurredAt,
  };
}

async function productTeamQueryEvidenceRow(
  sql: Awaited<ReturnType<typeof productTeamSqlArtifactRow>>,
  bindToSql = false,
) {
  const sqlReference = sql.document_json.artifact_ref;
  const baseBinding = await buildTestQueryEvidenceSemanticBinding([
    {
      name: "order_count",
      logical_type: "NUMBER",
      nullable: false,
      semantic_role: "METRIC",
      semantic_object_id: "metric.order_count",
    },
  ]);
  const sqlProvenance = sql.document_json.provenance;
  if (sqlProvenance?.kind !== "TEXT2SQL_CANDIDATE")
    throw new Error("SQL fixture provenance missing");
  const { binding_hash: _bindingHash, ...bindingMaterial } = baseBinding;
  const binding = bindToSql
    ? await buildQueryEvidenceSemanticBinding({
        ...bindingMaterial,
        datasource_ref: sqlProvenance.datasource_ref,
        semantic_release_ref: {
          ...baseBinding.semantic_release_ref,
          datasource_id: sqlProvenance.datasource_ref.resource_id,
        },
        schema_snapshot_ref: {
          ...baseBinding.schema_snapshot_ref,
          ...sqlProvenance.schema_snapshot_ref,
          datasource_id: sqlProvenance.datasource_ref.resource_id,
        },
        semantic_context_ref: {
          ...baseBinding.semantic_context_ref,
          ...sqlProvenance.semantic_context_ref,
        },
        target_binding_hash: sqlProvenance.target_binding_hash,
      })
    : baseBinding;
  const document = await buildProductTeamArtifactDocument({
    schema_version: "product-team-artifact@2.0.0",
    artifact_ref: {
      artifact_id: id(33),
      artifact_type: "QueryEvidence",
      ...scope,
      run_id: ids.run,
      revision: 1,
      content_hash: hash("0"),
    },
    profile_id: "governed-text2sql-agent",
    task_id: ids.attempt,
    source_refs: [sqlReference],
    provenance: {
      kind: "GOVERNED_QUERY_RESULT",
      query_id: id(34),
      request_hash: hash("7"),
      result_hash: hash("8"),
      row_count: 1,
      byte_count: 64,
      elapsed_ms: 12,
      truncated: false,
      semantic_binding: binding,
    },
    projection: {
      kind: "TABLE",
      columns: [{ key: "order_count", label: "订单量", data_type: "NUMBER" }],
      rows: [{ order_count: 42 }],
      total_rows: 1,
    },
    committed_at: occurredAt,
  });
  return {
    artifact_id: document.artifact_ref.artifact_id,
    artifact_type: document.artifact_ref.artifact_type,
    revision: document.artifact_ref.revision,
    content_hash: document.artifact_ref.content_hash,
    document_json: document,
    created_at: occurredAt,
  };
}

async function productTeamChartRow(
  evidence: Awaited<ReturnType<typeof productTeamQueryEvidenceRow>>,
) {
  const document = await buildArtifactWorkspaceChartDocumentV2({
    schema_version: "artifact-workspace-chart-document@2.0.0",
    document_ref: {
      artifact_id: id(35),
      artifact_type: "ArtifactWorkspaceDocument",
      ...scope,
      run_id: ids.run,
      revision: 1,
      content_hash: hash("0"),
    },
    source_refs: [evidence.document_json.artifact_ref],
    provenance: {
      transform_version: "query-evidence-chart@1.0.0",
      dataset_hash: hash("0"),
      semantic_context: {
        package_id: id(36),
        package_hash: hash("1"),
        receipt_id: id(37),
        receipt_hash: hash("2"),
      },
    },
    projection: {
      kind: "CHART",
      chart_type: "BAR",
      title: "订单量",
      description: "由 QueryEvidence 确定性派生",
      unit: null,
      x_key: "month",
      y_keys: ["order_count"],
      legend: { visible: false },
      table: {
        kind: "TABLE",
        columns: [
          { key: "month", label: "月份", data_type: "STRING" },
          { key: "order_count", label: "订单量", data_type: "NUMBER" },
        ],
        rows: [
          { month: "2026-07", order_count: 40 },
          { month: "2026-08", order_count: 42 },
        ],
        total_rows: 2,
      },
    },
  });
  return {
    artifact_id: document.document_ref.artifact_id,
    artifact_type: document.document_ref.artifact_type,
    revision: document.document_ref.revision,
    content_hash: document.document_ref.content_hash,
    document_json: document,
    created_at: occurredAt,
  };
}

const derivedEvidenceRef = {
  artifact_id: id(38),
  artifact_type: "DerivedAnalysisEvidence" as const,
  ...scope,
  run_id: ids.run,
  revision: 1,
  content_hash: hash("3"),
};

async function falcon24AnalysisChartRow(
  evidence: Awaited<ReturnType<typeof productTeamQueryEvidenceRow>>,
  analysisEvidenceRef: ArtifactReference & {
    readonly artifact_type: "DerivedAnalysisEvidence";
  } = derivedEvidenceRef,
) {
  const document = await buildArtifactWorkspaceChartDocumentV3({
    schema_version: "artifact-workspace-chart-document@3.0.0",
    document_ref: {
      artifact_id: id(39),
      artifact_type: "ArtifactWorkspaceDocument",
      ...scope,
      run_id: ids.run,
      revision: 1,
      content_hash: hash("0"),
    },
    source_refs: {
      query_evidence_refs: [evidence.document_json.artifact_ref],
      derived_evidence_ref: analysisEvidenceRef,
    },
    provenance: {
      transform_version: "derived-analysis-chart@1.0.0",
      dataset_hash: hash("0"),
      semantic_context: {
        package_id: id(40),
        package_hash: hash("4"),
        receipt_id: id(41),
        receipt_hash: hash("5"),
      },
      algorithm_version: "falcon24-analysis-chart@1.0.0",
      parameter_hash: hash("6"),
      input_closure_hash: hash("7"),
      runtime_profile: "CORE_ANALYSIS",
      agent_image: "data-agent-analysis:fixture",
      operator_image: "data-agent-statistical-operators:fixture",
    },
    projection: {
      kind: "CHART",
      chart_type: "BAR",
      title: "经营表现",
      description: "治理分析结果",
      unit: null,
      x_key: "month",
      y_keys: ["revenue"],
      lower_bound_key: null,
      upper_bound_key: null,
      series_key: null,
      legend: { visible: false },
      evidence_level: "L4_DISCOVERY",
      table: {
        kind: "TABLE",
        columns: [
          { key: "month", label: "月份", data_type: "STRING" },
          { key: "revenue", label: "收入", data_type: "NUMBER" },
        ],
        rows: [
          { month: "2026-07", revenue: 120 },
          { month: "2026-08", revenue: 110 },
        ],
        total_rows: 2,
      },
    },
  });
  return {
    artifact_id: document.document_ref.artifact_id,
    artifact_type: document.document_ref.artifact_type,
    revision: document.document_ref.revision,
    content_hash: document.document_ref.content_hash,
    document_json: document,
    created_at: occurredAt,
  };
}

async function falcon24AnalysisReportRow(
  chart: Awaited<ReturnType<typeof falcon24AnalysisChartRow>>,
  analysisEvidenceRef: ArtifactReference & {
    readonly artifact_type: "DerivedAnalysisEvidence";
  } = derivedEvidenceRef,
) {
  const document = await buildProductTeamArtifactDocument({
    schema_version: "product-team-artifact@2.0.0",
    artifact_ref: {
      artifact_id: id(42),
      artifact_type: "AnalysisReport",
      ...scope,
      run_id: ids.run,
      revision: 1,
      content_hash: hash("0"),
    },
    profile_id: "governed-analysis-agent",
    task_id: ids.attempt,
    source_refs: [analysisEvidenceRef, chart.document_json.document_ref],
    provenance: null,
    projection: {
      kind: "REPORT",
      title: "经营表现复盘",
      sections: [
        {
          heading: "结论",
          body_text: "收入下降月份已定位，并附同源数据图表。",
          source_refs: [analysisEvidenceRef, chart.document_json.document_ref],
        },
      ],
    },
    committed_at: occurredAt,
  });
  return {
    artifact_id: document.artifact_ref.artifact_id,
    artifact_type: document.artifact_ref.artifact_type,
    revision: document.artifact_ref.revision,
    content_hash: document.artifact_ref.content_hash,
    document_json: document,
    created_at: occurredAt,
  };
}

async function analysisSystemPublishedRow(input: {
  readonly suffix: number;
  readonly stageId: string;
  readonly artifactName: string;
  readonly artifactKind: "RESULT" | "TABLE" | "CHART";
  readonly document: unknown;
}) {
  const contentBytes = new TextEncoder().encode(canonicalizeJson(input.document));
  const contentHash = await sha256ContentHash(input.document);
  return {
    source_store: "ANALYSIS_SYSTEM" as const,
    artifact_id: id(input.suffix),
    artifact_type: "SandboxResult" as const,
    revision: 1,
    content_hash: contentHash,
    payload_json: {
      stage_id: input.stageId,
      artifact: {
        artifact_name: input.artifactName,
        artifact_kind: input.artifactKind,
        media_type: "application/json",
        content_sha256: contentHash,
        bytes: contentBytes.byteLength,
      },
    },
    content_bytes: contentBytes,
    created_at: occurredAt,
  };
}

async function ordinarySandboxResultRow() {
  const columns = [{ name: "revenue", type: "NUMBER" as const }];
  const rows = [[110]];
  const reference = {
    artifact_id: id(60),
    artifact_type: "SandboxResult" as const,
    ...scope,
    run_id: ids.run,
    revision: 1,
    content_hash: hash("0"),
  };
  const draft = sandboxResultSchema.parse({
    schema_version: "sandbox-result@1.0.0",
    result_ref: reference,
    scope,
    run_id: ids.run,
    execution_id: id(61),
    columns,
    rows,
    row_count: rows.length,
    bytes: computeSandboxResultBytes({ columns, rows }),
    result_hash: reference.content_hash,
  });
  const contentHash = await computeSandboxResultHash(draft);
  const document = sandboxResultSchema.parse({
    ...draft,
    result_ref: { ...draft.result_ref, content_hash: contentHash },
    result_hash: contentHash,
  });
  return {
    source_store: "ARTIFACTS" as const,
    artifact_id: document.result_ref.artifact_id,
    artifact_type: document.result_ref.artifact_type,
    revision: document.result_ref.revision,
    content_hash: document.result_ref.content_hash,
    document_json: document,
    created_at: occurredAt,
  };
}

function referenceFromFixtureRow<const T extends ArtifactReference["artifact_type"]>(row: {
  readonly artifact_id: string;
  readonly artifact_type: T;
  readonly revision: number;
  readonly content_hash: string;
}): ArtifactReference & { readonly artifact_type: T } {
  return {
    artifact_id: row.artifact_id,
    artifact_type: row.artifact_type,
    ...scope,
    run_id: ids.run,
    revision: row.revision,
    content_hash: row.content_hash,
  } as ArtifactReference & { readonly artifact_type: T };
}

async function falcon24DerivedAuthorityRows(
  evidence: Awaited<ReturnType<typeof productTeamQueryEvidenceRow>>,
  options: {
    readonly input_ref?: ArtifactReference;
    readonly facet?: boolean;
    readonly facet_field?: string;
    readonly facet_role?: string;
  } = {},
) {
  const stageId = id(50);
  const resultRow = await analysisSystemPublishedRow({
    suffix: 45,
    stageId,
    artifactName: "result",
    artifactKind: "RESULT",
    document: {
      schema_version: "analysis-published-result@1.0.0",
      contract_id: "falcon24.result",
      contract_hash: hash("a"),
      semantic_context_hash: hash("b"),
      metrics: [],
      dimensions: [],
      grain: { dimension_ids: [], time_dimension_id: null, time_grain: "NONE" },
      lineage: [
        {
          field: "revenue",
          source_semantic_object_ids: ["metric.revenue"],
          source_physical_fields: ["orders.revenue"],
          transformation: "DIRECT",
        },
      ],
      data: { revenue: 110 },
    },
  });
  const tableRow = await analysisSystemPublishedRow({
    suffix: 46,
    stageId,
    artifactName: "table:trend",
    artifactKind: "TABLE",
    document: {
      schema_version: "analysis-published-table@1.0.0",
      table_id: "trend_table",
      title_zh: "收入趋势",
      columns: [
        {
          key: "revenue",
          label_zh: "收入",
          data_type: "NUMBER",
          nullable: false,
          semantic_object_id: "metric.revenue",
          semantic_role: "METRIC",
        },
      ],
      rows: [{ revenue: 110 }],
      total_rows: 1,
    },
  });
  const chartRow = await analysisSystemPublishedRow({
    suffix: 47,
    stageId,
    artifactName: "chart:trend",
    artifactKind: "CHART",
    document: {
      schema_version: options.facet
        ? "analysis-published-chart@1.1.0"
        : "analysis-published-chart@1.0.0",
      chart_id: "trend_chart",
      title_zh: "收入趋势",
      intent: "TREND",
      template_id: "line.multi-series@1",
      bindings: {
        x_field: "month",
        y_fields: ["revenue"],
        series_field: null,
        ...(options.facet ? { facet_field: options.facet_field ?? "audience" } : {}),
        lower_bound_field: null,
        upper_bound_field: null,
      },
      dataset: {
        table_id: "trend_chart_dataset",
        columns: [
          ...(options.facet
            ? [
                {
                  key: "audience",
                  label_zh: "客群",
                  data_type: "STRING",
                  nullable: false,
                  semantic_object_id: "dimension.audience",
                  semantic_role: options.facet_role ?? "DIMENSION",
                },
              ]
            : []),
          {
            key: "month",
            label_zh: "月份",
            data_type: "STRING",
            nullable: false,
            semantic_object_id: "dimension.order_month",
            semantic_role: "DIMENSION",
          },
          {
            key: "revenue",
            label_zh: "收入",
            data_type: "NUMBER",
            nullable: false,
            semantic_object_id: "metric.revenue",
            semantic_role: "METRIC",
          },
        ],
        rows: [{ month: "2026-08", revenue: 110, ...(options.facet ? { audience: "新客" } : {}) }],
        total_rows: 1,
      },
    },
  });
  const resultRefs = [resultRow, tableRow, chartRow].map(referenceFromFixtureRow);
  const programPayload = {
    artifact_type: "AnalysisProgram" as const,
    protocol_version: "analysis-program@1.0.0" as const,
    brief_ref: {
      artifact_id: id(80),
      artifact_type: "ResearchBrief" as const,
      ...scope,
      run_id: ids.run,
      revision: 1,
      content_hash: hash("8"),
    },
    analysis_context_hash: hash("9"),
    semantic_context_package_hash: hash("b"),
    operator_registry_digest: hash("f"),
    nodes: [
      {
        node_id: "trend",
        skill_id: "trend-change@1" as const,
        metric_refs: [
          {
            container_ref: {
              artifact_id: id(81),
              artifact_type: "SemanticRelease" as const,
              ...scope,
              run_id: ids.run,
              revision: 1,
              content_hash: hash("a"),
            },
            node_id: "revenue",
          },
        ],
        dimension_refs: ["month"],
        time_window: {
          start: "2026-07-01T00:00:00.000Z",
          end: "2026-08-01T00:00:00.000Z",
          timezone: "Asia/Shanghai",
          semantics: "HALF_OPEN" as const,
        },
        comparison_window: null,
        parameters: { grain: "month" },
        execution_mode: "MODEL_GENERATED" as const,
        generated_source_policy: "OPEN_ANALYSIS" as const,
        operator_obligations: [],
        result_contract: analysisResultContractFixture({
          semantic_context_hash: hash("b"),
          contract_id: "falcon24.result",
          metric_id: "revenue",
          dimension_id: "month",
        }),
        dependency_node_ids: [],
        activation_rule: { kind: "ALWAYS" as const },
        criticality: "CRITICAL" as const,
      },
    ],
    budget: {
      max_steps: 1,
      max_sql_executions: 1,
      max_sandbox_executions: 1,
      max_series_rows: 5_000,
      max_group_rows: 5_000,
      max_elapsed_ms: 60_000,
    },
    compiler_kind: "DETERMINISTIC_DEFAULT" as const,
    compiler_version: "analysis-program-compiler@1.0.0",
    program_hash: hash("c"),
  };
  const programInputRefs = collectL2ResearchPayloadArtifactReferences(programPayload);
  const programDraft = parseL2ResearchDocumentCandidate({
    envelope: {
      artifact_id: id(43),
      artifact_type: "AnalysisProgram",
      ...scope,
      run_id: ids.run,
      revision: 1,
      parent_ref: null,
      attempt_id: ids.attempt,
      producer: { kind: "deterministic", id: "analysis-program-compiler@1" },
      input_refs: programInputRefs,
      schema_version: "1.0.0",
      semantic_version: "1.0.0",
      policy_version: "falcon24-analysis-policy@1.0.0",
      model_profile_version: "deepseek-v4-flash@1.0.0",
      content_hash: hash("0"),
      status: "COMMITTED",
      created_at: occurredAt,
    },
    payload: programPayload,
  });
  const programContentHash = await computeL2ResearchEnvelopeContentHash(programDraft);
  const programDocument = parseL2ResearchDocumentCandidate({
    ...programDraft,
    envelope: { ...programDraft.envelope, content_hash: programContentHash },
  });
  const analysisProgramRef = {
    artifact_id: programDocument.envelope.artifact_id,
    artifact_type: "AnalysisProgram" as const,
    ...scope,
    run_id: ids.run,
    revision: programDocument.envelope.revision,
    content_hash: programContentHash,
  };
  const materializationReceiptRef = {
    artifact_id: id(49),
    artifact_type: "AnalysisInputMaterializationReceipt" as const,
    ...scope,
    run_id: ids.run,
    revision: 1,
    content_hash: hash("d"),
  };
  const queryEvidenceRef = evidence.document_json.artifact_ref;
  const materializedInputRef = options.input_ref ?? queryEvidenceRef;
  const receiptMaterial = {
    schema_version: "analysis-sandbox-execution-receipt@1.0.0" as const,
    workspace_id: scope.tenant_id,
    run_id: ids.run,
    attempt_id: ids.attempt,
    worker_fence: 1,
    fence_token: "falcon24-fence",
    idempotency_key: "falcon24-analysis-execution",
    request_hash: hash("e"),
    analysis_program_ref: analysisProgramRef,
    node_id: "trend",
    runtime_profile: "CORE_ANALYSIS" as const,
    runtime: {
      provider: "OpenSandbox" as const,
      opensandbox_sdk_version: "opensandbox-sdk@1.0.0",
      code_interpreter_sdk_version: "code-interpreter-sdk@1.0.0",
      agent_image: "data-agent-analysis@sha256:fixture",
      operator_image: "data-agent-operator@sha256:fixture",
      agent_sandbox_id: id(51),
      operator_sandbox_id: id(52),
    },
    generated_source_policy: "OPEN_ANALYSIS" as const,
    operator_registry_digest: hash("f"),
    operator_obligations: [],
    operator_receipts: [],
    operator_receipt_closure_hash: hash("1"),
    result_contract_hash: hash("2"),
    publish_manifest_hash: hash("3"),
    published_closure_hash: hash("4"),
    publish_id: "falcon24-publish",
    inputs: [
      {
        name: "query_result",
        format: "JSON" as const,
        query_evidence_ref: queryEvidenceRef,
        input_ref: materializedInputRef,
        materialization_receipt_ref: materializationReceiptRef,
        content_sha256: materializedInputRef.content_hash,
        bytes: 128,
      },
    ],
    cells: [
      {
        cell_id: "analysis",
        source_sha256: hash("5"),
        execution_id: "execution-1",
        execution_count: 1,
        elapsed_ms: 20,
        status: "SUCCEEDED" as const,
      },
    ],
    started_at: occurredAt,
    finished_at: "2026-08-18T12:00:00.020Z",
    elapsed_ms: 20,
    hard_controls: {
      network_isolated: true as const,
      scoped_filesystem: true as const,
      separate_operator_sandbox: true as const,
      resource_limits_enforced: true as const,
      secure_access: true,
    },
    status: "SUCCEEDED" as const,
    failure_code: null,
    outputs: [
      {
        artifact_name: "result",
        artifact_kind: "RESULT" as const,
        media_type: "application/json" as const,
        reference: resultRefs[0],
        content_sha256: resultRefs[0]?.content_hash,
        bytes: resultRow.content_bytes.byteLength,
      },
      {
        artifact_name: "table:trend",
        artifact_kind: "TABLE" as const,
        media_type: "application/json" as const,
        reference: resultRefs[1],
        content_sha256: resultRefs[1]?.content_hash,
        bytes: tableRow.content_bytes.byteLength,
      },
      {
        artifact_name: "chart:trend",
        artifact_kind: "CHART" as const,
        media_type: "application/json" as const,
        reference: resultRefs[2],
        content_sha256: resultRefs[2]?.content_hash,
        bytes: chartRow.content_bytes.byteLength,
      },
    ],
  };
  const executionHash = await sha256ContentHash({
    hash_domain: "analysis-sandbox-execution-receipt@1.0.0",
    value: receiptMaterial,
  });
  const receipt = analysisSandboxExecutionReceiptSchema.parse({
    ...receiptMaterial,
    execution_hash: executionHash,
  });
  const receiptRef = {
    artifact_id: id(44),
    artifact_type: "SandboxExecutionReceipt" as const,
    ...scope,
    run_id: ids.run,
    revision: 1,
    content_hash: await sha256ContentHash(receipt),
  };
  const receiptRow = {
    source_store: "ANALYSIS_SYSTEM" as const,
    artifact_id: receiptRef.artifact_id,
    artifact_type: receiptRef.artifact_type,
    revision: receiptRef.revision,
    content_hash: receiptRef.content_hash,
    payload_json: receipt,
    content_bytes: null,
    created_at: occurredAt,
  };
  const payload = {
    artifact_type: "DerivedAnalysisEvidence" as const,
    protocol_version: "derived-analysis-evidence@2.0.0" as const,
    analysis_program_ref: analysisProgramRef,
    node_id: "trend",
    skill_id: "trend-change@1",
    algorithm_version: "trend-v1",
    query_evidence_refs: [queryEvidenceRef],
    sandbox_execution_receipt_ref: receiptRef,
    sandbox_result_refs: resultRefs,
    runtime_profile: "CORE_ANALYSIS" as const,
    agent_image: receipt.runtime.agent_image,
    operator_image: receipt.runtime.operator_image,
    generated_source_policy: "OPEN_ANALYSIS" as const,
    operator_registry_digest: receipt.operator_registry_digest,
    operator_obligations: [],
    operator_receipt_closure_hash: receipt.operator_receipt_closure_hash,
    parameter_hash: hash("6"),
    input_closure_hash: hash("7"),
    result: {
      result_kind: "GENERATED_ANALYSIS" as const,
      declared_method: "governed-python@1.0.0",
      structured_output_refs: resultRefs,
      oracle_scope: "FULL" as const,
    },
    quality: {
      oracle_verdict: "PASS" as const,
      deterministic_replay: "PASS" as const,
      sample_size: 1,
      coverage_ratio: 1,
    },
    limitation_codes: [],
    mandatory_disclosures: [],
    derivation_hash: hash("8"),
  };
  const draft = parseL2ResearchDocumentCandidate({
    envelope: {
      artifact_id: derivedEvidenceRef.artifact_id,
      artifact_type: "DerivedAnalysisEvidence",
      ...scope,
      run_id: ids.run,
      revision: 1,
      parent_ref: null,
      attempt_id: ids.attempt,
      producer: { kind: "deterministic", id: "falcon24-analysis-authority@1" },
      input_refs: collectL2ResearchPayloadArtifactReferences(payload),
      schema_version: "2.0.0",
      semantic_version: "1.0.0",
      policy_version: "falcon24-analysis-policy@1.0.0",
      model_profile_version: "deepseek-v4-flash@1.0.0",
      content_hash: hash("0"),
      status: "COMMITTED",
      created_at: occurredAt,
    },
    payload,
  });
  const contentHash = await computeL2ResearchEnvelopeContentHash(draft);
  const document = parseL2ResearchDocumentCandidate({
    ...draft,
    envelope: { ...draft.envelope, content_hash: contentHash },
  });
  const derivedRow = {
    artifact_id: document.envelope.artifact_id,
    artifact_type: document.envelope.artifact_type,
    revision: document.envelope.revision,
    content_hash: contentHash,
    document_json: document,
    created_at: occurredAt,
  };
  const derivedRef = {
    artifact_id: document.envelope.artifact_id,
    artifact_type: "DerivedAnalysisEvidence" as const,
    ...scope,
    run_id: ids.run,
    revision: document.envelope.revision,
    content_hash: contentHash,
  };
  return {
    derivedRow,
    derivedRef,
    receiptRow,
    resultRows: [resultRow, tableRow, chartRow] as const,
    supportRows: [
      {
        artifact_id: analysisProgramRef.artifact_id,
        artifact_type: analysisProgramRef.artifact_type,
        revision: analysisProgramRef.revision,
        content_hash: analysisProgramRef.content_hash,
        document_json: programDocument,
        created_at: occurredAt,
      },
      referenceOnlyRow(materializationReceiptRef),
      ...programInputRefs.map(referenceOnlyRow),
    ],
  };
}

async function falcon24AnalysisCompletionRow(
  analysis: Awaited<ReturnType<typeof falcon24DerivedAuthorityRows>>,
) {
  const analysisProgramRow = analysis.supportRows[0];
  if (!analysisProgramRow) throw new Error("analysis program fixture missing");
  const analysisProgramRef = referenceFromFixtureRow(analysisProgramRow);
  const payload = {
    artifact_type: "AnalysisCompletionReceipt" as const,
    protocol_version: "analysis-completion@1.0.0" as const,
    analysis_program_ref: analysisProgramRef,
    node_results: [
      {
        node_id: "trend",
        criticality: "CRITICAL" as const,
        status: "SUCCEEDED" as const,
        evidence_ref: analysis.derivedRef,
        reason_codes: [],
      },
    ],
    budget_usage: {
      steps: 1,
      model_calls: 3,
      sql_executions: 1,
      sandbox_executions: 1,
      series_rows: 1,
      group_rows: 0,
      elapsed_ms: 20,
    },
    terminal: "READY" as const,
    limitation_codes: [],
    completion_hash: hash("6"),
  };
  const draft = parseL2ResearchDocumentCandidate({
    envelope: {
      artifact_id: id(94),
      artifact_type: "AnalysisCompletionReceipt",
      ...scope,
      run_id: ids.run,
      revision: 1,
      parent_ref: null,
      attempt_id: ids.attempt,
      producer: { kind: "deterministic", id: "falcon24-analysis-completion@1" },
      input_refs: collectL2ResearchPayloadArtifactReferences(payload),
      schema_version: "1.0.0",
      semantic_version: "1.0.0",
      policy_version: "falcon24-analysis-policy@1.0.0",
      model_profile_version: "deepseek-v4-flash@1.0.0",
      content_hash: hash("0"),
      status: "COMMITTED",
      created_at: occurredAt,
    },
    payload,
  });
  const contentHash = await computeL2ResearchEnvelopeContentHash(draft);
  return {
    artifact_id: draft.envelope.artifact_id,
    artifact_type: draft.envelope.artifact_type,
    revision: draft.envelope.revision,
    content_hash: contentHash,
    document_json: parseL2ResearchDocumentCandidate({
      ...draft,
      envelope: { ...draft.envelope, content_hash: contentHash },
    }),
    created_at: occurredAt,
  };
}

async function researchQueryEvidenceRow() {
  const reference = <T extends string>(artifactType: T, suffix: number) => ({
    artifact_id: id(suffix),
    artifact_type: artifactType,
    ...scope,
    run_id: ids.run,
    revision: 1,
    content_hash: hash(String(suffix % 10)),
  });
  const evidencePlanRef = reference("EvidencePlan", 20);
  const obligationExecutionDecisionRef = reference("ObligationExecutionDecision", 21);
  const queryContractRef = reference("QueryContract", 22);
  const sqlArtifactRef = reference("SqlArtifact", 23);
  const validationReceiptRef = reference("ValidationReceipt", 24);
  const executionReceiptRef = reference("ExecutionReceipt", 25);
  const sandboxExecutionReceiptRef = reference("SandboxExecutionReceipt", 26);
  const sandboxResultRef = reference("SandboxResult", 27);
  const semanticReleaseRef = reference("SemanticRelease", 28);
  const schemaSnapshotRef = reference("SchemaSnapshot", 29);
  const policyReceiptRef = reference("PolicyReceipt", 30);
  const payload = {
    artifact_type: "QueryEvidence" as const,
    protocol_version: "query-evidence@2.0.0" as const,
    obligation_ref: {
      container_ref: evidencePlanRef,
      node_id: "monthly-revenue-query",
    },
    obligation_execution_decision_ref: obligationExecutionDecisionRef,
    query_contract_ref: queryContractRef,
    sql_artifact_ref: sqlArtifactRef,
    validation_receipt_ref: validationReceiptRef,
    execution_receipt_ref: executionReceiptRef,
    sandbox_execution_receipt_ref: sandboxExecutionReceiptRef,
    sandbox_result_ref: sandboxResultRef,
    dependency_evidence_refs: [],
    provenance_group: `sandbox:${"1".repeat(64)}`,
    observed_version: {
      semantic_release_ref: semanticReleaseRef,
      schema_snapshot_ref: schemaSnapshotRef,
      data_snapshot: {
        protocol_version: "data-snapshot-binding@1.0.0" as const,
        datasource_id: id(31),
        strategy: "CONTROLLED_REVISION" as const,
        replay_state: "REPLAYABLE" as const,
        snapshot_token: "falcon24-fixed-snapshot",
        data_manifest_hash: hash("1"),
        schema_manifest_hash: hash("2"),
        fixture_manifest_hash: hash("3"),
        binding_hash: hash("4"),
      },
      policy_receipt_ref: policyReceiptRef,
      identity_binding: {
        principal_id: ids.principal,
        authority_epoch: 1,
        delegation_chain_hash: hash("5"),
      },
    },
    observation: {
      result_hash: sandboxResultRef.content_hash,
      row_count: 18,
      schema_hash: hash("6"),
    },
  };
  const inputRefs = [
    evidencePlanRef,
    obligationExecutionDecisionRef,
    queryContractRef,
    sqlArtifactRef,
    validationReceiptRef,
    executionReceiptRef,
    sandboxExecutionReceiptRef,
    sandboxResultRef,
    semanticReleaseRef,
    schemaSnapshotRef,
    policyReceiptRef,
  ];
  const draft = parseL2ResearchDocumentCandidate({
    envelope: {
      artifact_id: id(32),
      artifact_type: "QueryEvidence",
      ...scope,
      run_id: ids.run,
      revision: 1,
      parent_ref: null,
      attempt_id: ids.attempt,
      producer: { kind: "deterministic", id: "falcon24-query-evidence-authority@1" },
      input_refs: inputRefs,
      schema_version: "2.0.0",
      semantic_version: "1.0.0",
      policy_version: "falcon24-analysis-policy@1.0.0",
      model_profile_version: "deepseek-v4-flash@1.0.0",
      content_hash: hash("0"),
      status: "COMMITTED",
      created_at: occurredAt,
    },
    payload,
  });
  const contentHash = await computeL2ResearchEnvelopeContentHash(draft);
  const document = parseL2ResearchDocumentCandidate({
    ...draft,
    envelope: { ...draft.envelope, content_hash: contentHash },
  });
  return {
    artifact_id: document.envelope.artifact_id,
    artifact_type: document.envelope.artifact_type,
    revision: document.envelope.revision,
    content_hash: contentHash,
    document_json: document,
    created_at: occurredAt,
  };
}

describe("PostgreSQL Resolution Trace projector", () => {
  it("reads historical E1 from the Run binding without consulting current authority", async () => {
    const { capability, authorizer } = issueCapability();
    const { pool, calls } = scriptedPool((text) => {
      if (text.includes("from runs as run")) {
        return {
          rows: [
            {
              ...authorityRow(),
              current_authority_epoch: "E2",
              current_baseline_id: id(92),
              current_baseline_hash: hash("f"),
              current_activation_attempt_id: id(93),
            },
          ],
          rowCount: 1,
        };
      }
      return undefined;
    });

    await expect(
      createPostgresResolutionTraceProjector({ pool, authorizer }).loadTrace(capability, {
        scope,
        run_id: ids.run,
      }),
    ).resolves.toMatchObject({ ok: true });
    const authorityQuery = calls.find(({ text }) => text.includes("from runs as run"))?.text;
    expect(authorityQuery).not.toContain("falcon24_current_authority_epoch");
  });

  it("accepts E2 Run authority and rejects a non-canonical Run epoch", async () => {
    const { capability, authorizer } = issueCapability();
    const current = scriptedPool((text) => {
      if (text.includes("from runs as run")) {
        return { rows: [{ ...authorityRow(), authority_epoch: "E2" }], rowCount: 1 };
      }
      return undefined;
    });
    await expect(
      createPostgresResolutionTraceProjector({ pool: current.pool, authorizer }).loadTrace(
        capability,
        { scope, run_id: ids.run },
      ),
    ).resolves.toMatchObject({ ok: true });

    const corrupt = scriptedPool((text) => {
      if (text.includes("from runs as run")) {
        return { rows: [{ ...authorityRow(), authority_epoch: "E02" }], rowCount: 1 };
      }
      return undefined;
    });
    await expect(
      createPostgresResolutionTraceProjector({ pool: corrupt.pool, authorizer }).loadTrace(
        capability,
        { scope, run_id: ids.run },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "RESOLUTION_TRACE_AUTHORITY_BINDING_INVALID" },
    });
  });

  it("resolves the current attempt from ACTIVE run_attempts authority", async () => {
    const row = await eventRow();
    const { capability, authorizer } = issueCapability();
    const { pool, calls } = scriptedPool((text) => {
      if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
      if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
      if (text.includes("from artifacts")) return { rows: [], rowCount: 0 };
      return undefined;
    });

    await createPostgresResolutionTraceProjector({ pool, authorizer }).loadTrace(capability, {
      scope,
      run_id: ids.run,
    });

    const authorityQuery = calls.find(({ text }) => text.includes("from runs as run"))?.text;
    expect(authorityQuery).toBeDefined();
    expect(authorityQuery).not.toContain("run.active_attempt_id");
    expect(authorityQuery).toContain("from run_attempts as active_candidate");
    expect(authorityQuery).toContain("active_candidate.status = 'ACTIVE'");
    expect(authorityQuery).toContain("active_attempt.attempt_id as active_attempt_id");
  });

  it("projects exact public Tool input and result into a content-first detail", async () => {
    const startedEvent = runRuntimeEventSchema.parse({
      schema_version: "run-runtime-event@2.0.0",
      event_id: ids.event,
      scope,
      run_id: ids.run,
      sequence: 1,
      worker_fence: 1,
      idempotency_key: `event:${ids.event}`,
      occurred_at: occurredAt,
      event_type: "run.tool_started",
      payload: {
        call_id: "call-1",
        tool_name: "semantic.release.read",
        profile_id: "governed-text2sql-agent",
        task_id: ids.attempt,
        title: "读取语义层",
        summary: "读取已发布语义层",
        input: '{"semantic_domain":"sales"}',
        artifact_refs: [],
      },
    });
    const toolEvent = runRuntimeEventSchema.parse({
      schema_version: "run-runtime-event@2.0.0",
      event_id: id(13),
      scope,
      run_id: ids.run,
      sequence: 2,
      worker_fence: 1,
      idempotency_key: `event:${id(13)}`,
      occurred_at: "2026-08-18T12:00:00.040Z",
      event_type: "run.tool_completed",
      payload: {
        call_id: "call-1",
        tool_name: "semantic.release.read",
        profile_id: "governed-text2sql-agent",
        task_id: ids.attempt,
        summary: "读取已发布语义层",
        output: "订单事实表与月份维度",
        duration_ms: 40,
        artifact_refs: [],
      },
    });
    const rowFor = async (event: typeof startedEvent | typeof toolEvent) => ({
      app_id: scope.app_id,
      tenant_id: scope.tenant_id,
      environment: scope.environment,
      event_id: event.event_id,
      run_id: event.run_id,
      sequence: event.sequence,
      event_type: event.event_type,
      payload_json: event.payload,
      worker_fence: event.worker_fence,
      dedupe_key: event.idempotency_key,
      event_hash: await sha256ContentHash(event),
      event_document: event,
      created_at: event.occurred_at,
    });
    const rows = [await rowFor(startedEvent), await rowFor(toolEvent)];
    const { capability, authorizer } = issueCapability();
    const { pool } = scriptedPool((text) => {
      if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
      if (text.includes("from run_events")) return { rows, rowCount: 2 };
      if (text.includes("from artifacts")) return { rows: [], rowCount: 0 };
      return undefined;
    });
    const projector = createPostgresResolutionTraceProjector({ pool, authorizer });
    const trace = await projector.loadTrace(capability, { scope, run_id: ids.run });
    if (!trace.ok || !trace.value) throw new Error("trace fixture missing");
    const result = await projector.loadDetail(capability, {
      scope,
      run_id: ids.run,
      node_id: `event:${toolEvent.event_id}`,
      expected_trace_hash: trace.value.trace_hash,
    });
    expect(result.ok && result.value).toMatchObject({
      kind: "TOOL",
      title: "semantic.release.read",
      identity: expect.arrayContaining([
        { label: "Call ID", value: "call-1", value_kind: "ID" },
        { label: "Agent Profile", value: "governed-text2sql-agent", value_kind: "NAME" },
      ]),
      result: { state: "AVAILABLE", text: "订单事实表与月份维度" },
      payload: { state: "AVAILABLE", text: '{"semantic_domain":"sales"}' },
      run_context: {
        state: "AVAILABLE",
        fields: expect.arrayContaining([
          { label: "用户问题", value: "统计本月订单" },
          { label: "所属对话", value: "订单分析" },
          { label: "当前执行尝试", value: ids.attempt },
          { label: "尝试次数", value: "2" },
          { label: "对话消息数", value: "4" },
          { label: "数据源绑定", value: `${id(14)} · 历史显示名未冻结` },
        ]),
      },
      timing: {
        started_at: occurredAt,
        completed_at: "2026-08-18T12:00:00.040Z",
        duration_ms: 40,
      },
      source_event_ids: [startedEvent.event_id, toolEvent.event_id],
    });
    expect(JSON.stringify(result)).not.toMatch(/reasoning_content|authorization|secretref/i);
  });

  it("does not resolve a detail by an artifact or event outside the verified trace", async () => {
    const row = await eventRow();
    const { capability, authorizer } = issueCapability();
    const { pool } = scriptedPool((text) => {
      if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
      if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
      if (text.includes("from artifacts")) return { rows: [], rowCount: 0 };
      return undefined;
    });
    const projector = createPostgresResolutionTraceProjector({ pool, authorizer });
    const trace = await projector.loadTrace(capability, { scope, run_id: ids.run });
    if (!trace.ok || !trace.value) throw new Error("trace fixture missing");
    const result = await projector.loadDetail(capability, {
      scope,
      run_id: ids.run,
      node_id: `event:${id(999)}`,
      expected_trace_hash: trace.value.trace_hash,
    });
    expect(result).toMatchObject({ ok: true, value: null });
  });

  it("fails closed when a detail request is bound to a stale trace snapshot", async () => {
    const row = await eventRow();
    const { capability, authorizer } = issueCapability();
    const { pool } = scriptedPool((text) => {
      if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
      if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
      if (text.includes("from artifacts")) return { rows: [], rowCount: 0 };
      return undefined;
    });
    const result = await createPostgresResolutionTraceProjector({ pool, authorizer }).loadDetail(
      capability,
      {
        scope,
        run_id: ids.run,
        node_id: `event:${ids.event}`,
        expected_trace_hash: hash("0"),
      },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "RESOLUTION_TRACE_SNAPSHOT_STALE", retryable: false },
    });
  });

  it("fails closed when a public Tool event references a missing Artifact revision", async () => {
    const missingReference = {
      artifact_id: id(998),
      artifact_type: "QueryEvidence" as const,
      ...scope,
      run_id: ids.run,
      revision: 1,
      content_hash: hash("9"),
    };
    const event = runRuntimeEventSchema.parse({
      schema_version: "run-runtime-event@2.0.0",
      event_id: ids.event,
      scope,
      run_id: ids.run,
      sequence: 1,
      worker_fence: 1,
      idempotency_key: `event:${ids.event}`,
      occurred_at: occurredAt,
      event_type: "run.tool_completed",
      payload: {
        call_id: "call-missing-artifact",
        tool_name: "sql.sandbox.execute",
        profile_id: "governed-text2sql-agent",
        task_id: ids.attempt,
        summary: "查询完成",
        output: null,
        duration_ms: 20,
        artifact_refs: [missingReference],
      },
    });
    const row = {
      app_id: scope.app_id,
      tenant_id: scope.tenant_id,
      environment: scope.environment,
      event_id: event.event_id,
      run_id: event.run_id,
      sequence: event.sequence,
      event_type: event.event_type,
      payload_json: event.payload,
      worker_fence: event.worker_fence,
      dedupe_key: event.idempotency_key,
      event_hash: await sha256ContentHash(event),
      event_document: event,
      created_at: event.occurred_at,
    };
    const { capability, authorizer } = issueCapability();
    const { pool } = scriptedPool((text) => {
      if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
      if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
      if (text.includes("select 1") && text.includes("from artifacts")) {
        return { rows: [], rowCount: 0 };
      }
      return undefined;
    });
    const result = await createPostgresResolutionTraceProjector({ pool, authorizer }).loadTrace(
      capability,
      { scope, run_id: ids.run },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "RESOLUTION_TRACE_ARTIFACT_REFERENCE_MISSING" },
    });
  });

  it("fails closed when a public Tool event references an inactive exact Artifact revision", async () => {
    const inactiveReference = {
      artifact_id: id(997),
      artifact_type: "QueryEvidence" as const,
      ...scope,
      run_id: ids.run,
      revision: 2,
      content_hash: hash("8"),
    };
    const row = await toolCompletedEventRow([inactiveReference]);
    const { capability, authorizer } = issueCapability();
    const { pool, calls } = scriptedPool((text) => {
      if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
      if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
      if (text.includes("from artifacts"))
        return {
          rows: [
            {
              artifact_id: inactiveReference.artifact_id,
              artifact_type: inactiveReference.artifact_type,
              revision: inactiveReference.revision,
              content_hash: inactiveReference.content_hash,
              document_json: null,
              created_at: occurredAt,
              is_active: false,
            },
          ],
          rowCount: 1,
        };
      return undefined;
    });

    const result = await createPostgresResolutionTraceProjector({ pool, authorizer }).loadTrace(
      capability,
      { scope, run_id: ids.run },
    );

    expect(
      calls.some(
        ({ text }) =>
          text.includes("from artifacts") &&
          text.includes("from analysis_system_artifacts") &&
          text.includes("from text2sql_system_artifacts") &&
          !text.includes("is_active = true"),
      ),
    ).toBe(true);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "RESOLUTION_TRACE_ARTIFACT_REFERENCE_MISSING" },
    });
  });

  it("rejects duplicate ArtifactReference identity in a persisted Tool event", async () => {
    const reference = {
      artifact_id: id(996),
      artifact_type: "QueryEvidence" as const,
      ...scope,
      run_id: ids.run,
      revision: 1,
      content_hash: hash("7"),
    };
    const row = await toolCompletedEventRow([reference, reference]);
    const { capability, authorizer } = issueCapability();
    const { pool, calls } = scriptedPool((text) => {
      if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
      if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
      if (text.includes("select 1") && text.includes("from artifacts")) {
        return { rows: [{}], rowCount: 1 };
      }
      if (text.includes("from artifacts")) return { rows: [], rowCount: 0 };
      return undefined;
    });

    const result = await createPostgresResolutionTraceProjector({ pool, authorizer }).loadTrace(
      capability,
      { scope, run_id: ids.run },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "RESOLUTION_TRACE_ARTIFACT_REFERENCE_DUPLICATE" },
    });
    expect(calls.filter(({ text }) => text.includes("select 1"))).toHaveLength(0);
  });

  it("projects exactly one PRODUCED edge for each public event ArtifactReference", async () => {
    const sql = await productTeamSqlArtifactRow();
    const evidence = await productTeamQueryEvidenceRow(sql);
    const evidenceReference = {
      artifact_id: evidence.artifact_id,
      artifact_type: "QueryEvidence" as const,
      ...scope,
      run_id: ids.run,
      revision: evidence.revision,
      content_hash: evidence.content_hash,
    };
    const row = await toolCompletedEventRow([evidenceReference]);
    const { capability, authorizer } = issueCapability();
    const { pool } = scriptedPool((text) => {
      if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
      if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
      if (text.includes("from artifacts")) return { rows: [sql, evidence], rowCount: 2 };
      return undefined;
    });

    const result = await createPostgresResolutionTraceProjector({ pool, authorizer }).loadTrace(
      capability,
      { scope, run_id: ids.run },
    );
    const produced =
      result.ok && result.value ? result.value.edges.filter(({ kind }) => kind === "PRODUCED") : [];

    expect(produced).toEqual([
      {
        from_node_id: `event:${ids.event}`,
        to_node_id: `artifact:${evidence.artifact_id}:${evidence.revision}`,
        kind: "PRODUCED",
      },
    ]);
  });

  it("projects a verified SemanticQueryContext referenced by a public Tool event", async () => {
    const semantic = await productTeamSemanticContextRow();
    const semanticReference = semantic.document_json.artifact_ref;
    const row = await toolCompletedEventRow([semanticReference]);
    const { capability, authorizer } = issueCapability();
    const { pool } = scriptedPool((text) => {
      if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
      if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
      if (text.includes("from artifacts")) return { rows: [semantic], rowCount: 1 };
      return undefined;
    });

    const result = await createPostgresResolutionTraceProjector({ pool, authorizer }).loadTrace(
      capability,
      { scope, run_id: ids.run },
    );

    expect(result.ok && result.value?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node_id: `artifact:${semantic.artifact_id}:${semantic.revision}`,
          title: "SemanticQueryContext",
          status: "AVAILABLE",
          summary: "SEMANTIC_FACTS_ONLY · 0 metrics · 0 dimensions · 0 relationships",
        }),
      ]),
    );
    expect(result.ok && result.value?.edges).toEqual(
      expect.arrayContaining([
        {
          from_node_id: `event:${ids.event}`,
          to_node_id: `artifact:${semantic.artifact_id}:${semantic.revision}`,
          kind: "PRODUCED",
        },
      ]),
    );
  });

  it("fails closed when an active Artifact references an inactive exact source revision", async () => {
    const row = await eventRow();
    const sql = await productTeamSqlArtifactRow();
    const evidence = await productTeamQueryEvidenceRow(sql);
    const { capability, authorizer } = issueCapability();
    const { pool } = scriptedPool((text) => {
      if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
      if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
      if (text.includes("from artifacts"))
        return {
          rows: [{ ...sql, is_active: false }, evidence],
          rowCount: 2,
        };
      return undefined;
    });

    const result = await createPostgresResolutionTraceProjector({ pool, authorizer }).loadTrace(
      capability,
      { scope, run_id: ids.run },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "RESOLUTION_TRACE_ARTIFACT_REFERENCE_MISSING" },
    });
  });

  it("projects verified Product Team artifacts without requiring a legacy L2 envelope", async () => {
    const row = await eventRow();
    const sql = await productTeamSqlArtifactRow();
    const { capability, authorizer } = issueCapability();
    const { pool } = scriptedPool((text) => {
      if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
      if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
      if (text.includes("from artifacts")) return { rows: [sql], rowCount: 1 };
      return undefined;
    });

    const result = await createPostgresResolutionTraceProjector({ pool, authorizer }).loadTrace(
      capability,
      { scope, run_id: ids.run },
    );

    expect(result.ok && result.value?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "SQL",
          summary: "select count(*) from orders",
          artifact_refs: [
            expect.objectContaining({
              artifact_id: sql.artifact_id,
              content_hash: sql.content_hash,
            }),
          ],
        }),
      ]),
    );
    if (!result.ok || !result.value) throw new Error("trace fixture missing");
    const detail = await createPostgresResolutionTraceProjector({ pool, authorizer }).loadDetail(
      capability,
      {
        scope,
        run_id: ids.run,
        node_id: `artifact:${sql.artifact_id}:${sql.revision}`,
        expected_trace_hash: result.value.trace_hash,
      },
    );
    expect(detail.ok && detail.value?.payload).toMatchObject({
      state: "AVAILABLE",
      text: "select count(*) from orders",
    });
  });

  it("projects the committed Product Team SqlArtifact to QueryEvidence evidence edge", async () => {
    const row = await eventRow();
    const sql = await productTeamSqlArtifactRow();
    const evidence = await productTeamQueryEvidenceRow(sql);
    const { capability, authorizer } = issueCapability();
    const { pool } = scriptedPool((text) => {
      if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
      if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
      if (text.includes("select 1") && text.includes("from artifacts")) {
        return { rows: [{}], rowCount: 1 };
      }
      if (text.includes("from artifacts")) return { rows: [sql, evidence], rowCount: 2 };
      return undefined;
    });

    const result = await createPostgresResolutionTraceProjector({ pool, authorizer }).loadTrace(
      capability,
      { scope, run_id: ids.run },
    );
    const sqlNodeId = `artifact:${sql.artifact_id}:${sql.revision}`;
    const evidenceNodeId = `artifact:${evidence.artifact_id}:${evidence.revision}`;
    expect(result.ok && result.value?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ node_id: sqlNodeId, status: "AVAILABLE" }),
        expect.objectContaining({ node_id: evidenceNodeId, status: "AVAILABLE" }),
      ]),
    );
    expect(result.ok && result.value?.edges).toEqual(
      expect.arrayContaining([
        { from_node_id: sqlNodeId, to_node_id: evidenceNodeId, kind: "EVIDENCE" },
      ]),
    );
  });

  it("maps malformed Artifact relational identity fields to the exact corruption code", async () => {
    const row = await eventRow();
    const sql = await productTeamSqlArtifactRow();
    const mutations = [
      { ...sql, artifact_id: "not-an-artifact-id" },
      { ...sql, revision: "not-a-revision" },
      { ...sql, content_hash: "not-a-content-hash" },
      { ...sql, artifact_id: id(999) },
      { ...sql, content_hash: hash("f") },
    ];

    for (const malformed of mutations) {
      const { capability, authorizer } = issueCapability();
      const { pool } = scriptedPool((text) => {
        if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
        if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
        if (text.includes("from artifacts")) return { rows: [malformed], rowCount: 1 };
        return undefined;
      });

      const result = await createPostgresResolutionTraceProjector({ pool, authorizer }).loadTrace(
        capability,
        { scope, run_id: ids.run },
      );

      expect(result).toMatchObject({
        ok: false,
        error: { code: "RESOLUTION_TRACE_ARTIFACT_CORRUPT" },
      });
    }
  });

  it("rejects null or unverified ordinary SchemaSnapshot and SandboxResult documents", async () => {
    const row = await eventRow();
    for (const artifactType of ["SchemaSnapshot", "SandboxResult"] as const) {
      for (const documentJson of [null, {}]) {
        const malformed = {
          artifact_id: id(995),
          artifact_type: artifactType,
          revision: 1,
          content_hash: hash("a"),
          document_json: documentJson,
          created_at: occurredAt,
        };
        const { capability, authorizer } = issueCapability();
        const { pool } = scriptedPool((text) => {
          if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
          if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
          if (text.includes("from artifacts")) return { rows: [malformed], rowCount: 1 };
          return undefined;
        });

        const result = await createPostgresResolutionTraceProjector({ pool, authorizer }).loadTrace(
          capability,
          { scope, run_id: ids.run },
        );
        expect(result).toMatchObject({
          ok: false,
          error: { code: "RESOLUTION_TRACE_ARTIFACT_CORRUPT" },
        });
      }
    }
  });

  it("rejects duplicate Product Team source refs with the exact corruption code", async () => {
    const row = await eventRow();
    const sql = await productTeamSqlArtifactRow();
    const evidence = await productTeamQueryEvidenceRow(sql);
    const chart = await falcon24AnalysisChartRow(evidence);
    const report = await falcon24AnalysisReportRow(chart);
    const duplicateSourceDocument = await buildProductTeamArtifactDocument({
      ...report.document_json,
      source_refs: [chart.document_json.document_ref, chart.document_json.document_ref],
    });
    const duplicateSourceReport = {
      ...report,
      content_hash: duplicateSourceDocument.artifact_ref.content_hash,
      document_json: duplicateSourceDocument,
    };
    const { capability, authorizer } = issueCapability();
    const { pool } = scriptedPool((text) => {
      if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
      if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
      if (text.includes("from artifacts")) {
        return { rows: [duplicateSourceReport], rowCount: 1 };
      }
      return undefined;
    });

    const result = await createPostgresResolutionTraceProjector({ pool, authorizer }).loadTrace(
      capability,
      { scope, run_id: ids.run },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "RESOLUTION_TRACE_ARTIFACT_CORRUPT" },
    });
  });

  it("verifies and projects QueryEvidence to Chart lineage with content-first detail", async () => {
    const row = await eventRow();
    const sql = await productTeamSqlArtifactRow();
    const evidence = await productTeamQueryEvidenceRow(sql);
    const chart = await productTeamChartRow(evidence);
    const { capability, authorizer } = issueCapability();
    const { pool } = scriptedPool((text) => {
      if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
      if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
      if (text.includes("select 1") && text.includes("from artifacts")) {
        return { rows: [{}], rowCount: 1 };
      }
      if (text.includes("from artifacts")) return { rows: [sql, evidence, chart], rowCount: 3 };
      return undefined;
    });
    const projector = createPostgresResolutionTraceProjector({ pool, authorizer });
    const trace = await projector.loadTrace(capability, { scope, run_id: ids.run });
    const evidenceNodeId = `artifact:${evidence.artifact_id}:${evidence.revision}`;
    const chartNodeId = `artifact:${chart.artifact_id}:${chart.revision}`;
    expect(trace.ok && trace.value?.edges).toEqual(
      expect.arrayContaining([
        { from_node_id: evidenceNodeId, to_node_id: chartNodeId, kind: "EVIDENCE" },
      ]),
    );
    expect(trace.ok && trace.value?.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node_id: chartNodeId,
          kind: "ARTIFACT",
          title: "ArtifactWorkspaceDocument",
          status: "AVAILABLE",
        }),
      ]),
    );
    if (!trace.ok || !trace.value) throw new Error("trace fixture missing");
    const detail = await projector.loadDetail(capability, {
      scope,
      run_id: ids.run,
      node_id: chartNodeId,
      expected_trace_hash: trace.value.trace_hash,
    });
    expect(detail.ok && detail.value).toMatchObject({
      payload: { state: "AVAILABLE" },
      result: { state: "AVAILABLE" },
      schema: {
        state: "AVAILABLE",
        schema_name: "artifact-workspace-chart-document",
        schema_version: "artifact-workspace-chart-document@2.0.0",
      },
    });
  });

  it.each([false, true])(
    "projects the Falcon24 V3 QueryEvidence to Chart to AnalysisReport authority chain (facet=%s)",
    async (facet) => {
      const row = await eventRow();
      const sql = await productTeamSqlArtifactRow();
      const evidence = await productTeamQueryEvidenceRow(sql);
      const analysis = await falcon24DerivedAuthorityRows(evidence, { facet });
      const chart = await falcon24AnalysisChartRow(evidence, analysis.derivedRef);
      const report = await falcon24AnalysisReportRow(chart, analysis.derivedRef);
      const { capability, authorizer } = issueCapability();
      const { pool } = scriptedPool((text) => {
        if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
        if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
        if (text.includes("select 1") && text.includes("from artifacts")) {
          return { rows: [{}], rowCount: 1 };
        }
        if (text.includes("from artifacts")) {
          const rows = [
            sql,
            evidence,
            analysis.derivedRow,
            chart,
            report,
            analysis.receiptRow,
            ...analysis.resultRows,
            ...analysis.supportRows,
          ];
          return { rows, rowCount: rows.length };
        }
        return undefined;
      });
      const projector = createPostgresResolutionTraceProjector({ pool, authorizer });
      const trace = await projector.loadTrace(capability, { scope, run_id: ids.run });
      if (!trace.ok) throw new Error(trace.error.code);
      const sqlNodeId = `artifact:${sql.artifact_id}:${sql.revision}`;
      const evidenceNodeId = `artifact:${evidence.artifact_id}:${evidence.revision}`;
      const chartNodeId = `artifact:${chart.artifact_id}:${chart.revision}`;
      const reportNodeId = `artifact:${report.artifact_id}:${report.revision}`;
      expect(trace.ok && trace.value?.edges).toEqual(
        expect.arrayContaining([
          { from_node_id: sqlNodeId, to_node_id: evidenceNodeId, kind: "EVIDENCE" },
          { from_node_id: evidenceNodeId, to_node_id: chartNodeId, kind: "EVIDENCE" },
          { from_node_id: chartNodeId, to_node_id: reportNodeId, kind: "EVIDENCE" },
        ]),
      );
      expect(trace.ok && trace.value?.nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            title: "SandboxExecutionReceipt",
            status: "AVAILABLE",
          }),
          expect.objectContaining({
            title: expect.stringContaining("SandboxResult"),
            status: "AVAILABLE",
          }),
        ]),
      );
      if (!trace.ok || !trace.value) throw new Error("trace fixture missing");
      const chartDetail = await projector.loadDetail(capability, {
        scope,
        run_id: ids.run,
        node_id: chartNodeId,
        expected_trace_hash: trace.value.trace_hash,
      });
      const reportDetail = await projector.loadDetail(capability, {
        scope,
        run_id: ids.run,
        node_id: reportNodeId,
        expected_trace_hash: trace.value.trace_hash,
      });
      expect(chartDetail.ok && chartDetail.value?.schema).toMatchObject({
        state: "AVAILABLE",
        schema_name: "artifact-workspace-chart-document",
        schema_version: "artifact-workspace-chart-document@3.0.0",
      });
      expect(reportDetail.ok && reportDetail.value?.schema).toMatchObject({
        state: "AVAILABLE",
        schema_name: "product-team-artifact",
        schema_version: "product-team-artifact@2.0.0",
      });
    },
  );

  it.each(["missing-source", "non-dimension"])(
    "rejects a rehashed published facet without categorical authority: %s",
    async (kind) => {
      const row = await eventRow();
      const sql = await productTeamSqlArtifactRow();
      const evidence = await productTeamQueryEvidenceRow(sql);
      const analysis = await falcon24DerivedAuthorityRows(evidence, {
        facet: true,
        ...(kind === "missing-source" ? { facet_field: "unknown" } : { facet_role: "DERIVED" }),
      });
      const { capability, authorizer } = issueCapability();
      const { pool } = scriptedPool((text) => {
        if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
        if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
        if (text.includes("select 1") && text.includes("from artifacts"))
          return { rows: [{}], rowCount: 1 };
        if (text.includes("from artifacts")) {
          const rows = [
            sql,
            evidence,
            analysis.derivedRow,
            analysis.receiptRow,
            ...analysis.resultRows,
            ...analysis.supportRows,
          ];
          return { rows, rowCount: rows.length };
        }
        return undefined;
      });
      await expect(
        createPostgresResolutionTraceProjector({ pool, authorizer }).loadTrace(capability, {
          scope,
          run_id: ids.run,
        }),
      ).resolves.toMatchObject({
        ok: false,
        error: { code: "RESOLUTION_TRACE_ARTIFACT_CORRUPT" },
      });
    },
  );

  it("accepts an AnalysisProgram semantic release identity without a run-local mirror", async () => {
    const row = await eventRow();
    const sql = await productTeamSqlArtifactRow();
    const evidence = await productTeamQueryEvidenceRow(sql);
    const analysis = await falcon24DerivedAuthorityRows(evidence);
    const program = analysis.supportRows[0];
    const brief = analysis.supportRows.find(
      ({ artifact_type: artifactType }) => artifactType === "ResearchBrief",
    );
    if (!program || !brief) throw new Error("analysis context fixture missing");
    const { capability, authorizer } = issueCapability();
    const { pool } = scriptedPool((text) => {
      if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
      if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
      if (text.includes("from artifacts")) return { rows: [program, brief], rowCount: 2 };
      return undefined;
    });

    const result = await createPostgresResolutionTraceProjector({ pool, authorizer }).loadTrace(
      capability,
      { scope, run_id: ids.run },
    );

    expect(result).toMatchObject({ ok: true });
  });

  it("accepts a protected analysis input without exposing a run-local Artifact mirror", async () => {
    const row = await eventRow();
    const sql = await productTeamSqlArtifactRow();
    const evidence = await productTeamQueryEvidenceRow(sql);
    const analysis = await falcon24DerivedAuthorityRows(evidence, {
      input_ref: {
        artifact_id: id(82),
        artifact_type: "SensitiveExecutionArtifact",
        ...scope,
        run_id: ids.run,
        revision: 1,
        content_hash: hash("d"),
      },
    });
    const { capability, authorizer } = issueCapability();
    const { pool } = scriptedPool((text) => {
      if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
      if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
      if (text.includes("from artifacts")) {
        const rows = [
          sql,
          evidence,
          analysis.derivedRow,
          analysis.receiptRow,
          ...analysis.resultRows,
          ...analysis.supportRows,
        ];
        return { rows, rowCount: rows.length };
      }
      return undefined;
    });

    const result = await createPostgresResolutionTraceProjector({ pool, authorizer }).loadTrace(
      capability,
      { scope, run_id: ids.run },
    );

    expect(result).toMatchObject({ ok: true });
  });

  it("fails closed when Analysis System receipt or canonical result bytes are tampered", async () => {
    const row = await eventRow();
    const sql = await productTeamSqlArtifactRow();
    const evidence = await productTeamQueryEvidenceRow(sql);
    const analysis = await falcon24DerivedAuthorityRows(evidence);
    const mutations = [
      {
        ...analysis.receiptRow,
        payload_json: null,
      },
      {
        ...analysis.receiptRow,
        payload_json: { ...analysis.receiptRow.payload_json, execution_hash: hash("9") },
      },
      {
        ...analysis.resultRows[0],
        payload_json: null,
      },
      {
        ...analysis.resultRows[0],
        content_bytes: new TextEncoder().encode("{}"),
      },
    ];

    for (const mutation of mutations) {
      const { capability, authorizer } = issueCapability();
      const { pool } = scriptedPool((text) => {
        if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
        if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
        if (text.includes("from artifacts")) {
          const rows = [
            sql,
            evidence,
            analysis.derivedRow,
            mutation,
            ...(mutation.artifact_type === "SandboxExecutionReceipt"
              ? analysis.resultRows
              : [analysis.receiptRow, ...analysis.resultRows.slice(1)]),
            ...analysis.supportRows,
          ];
          return { rows, rowCount: rows.length };
        }
        return undefined;
      });

      const result = await createPostgresResolutionTraceProjector({ pool, authorizer }).loadTrace(
        capability,
        { scope, run_id: ids.run },
      );
      expect(result).toMatchObject({
        ok: false,
        error: { code: "RESOLUTION_TRACE_ARTIFACT_CORRUPT" },
      });
    }
  });

  it("fails closed when DerivedAnalysisEvidence system receipt or result is absent", async () => {
    const row = await eventRow();
    const sql = await productTeamSqlArtifactRow();
    const evidence = await productTeamQueryEvidenceRow(sql);
    const analysis = await falcon24DerivedAuthorityRows(evidence);
    const missingVariants = [
      [...analysis.resultRows, ...analysis.supportRows],
      [analysis.receiptRow, ...analysis.resultRows.slice(1), ...analysis.supportRows],
    ];

    for (const remainingAnalysisRows of missingVariants) {
      const { capability, authorizer } = issueCapability();
      const { pool } = scriptedPool((text) => {
        if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
        if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
        if (text.includes("from artifacts")) {
          const rows = [sql, evidence, analysis.derivedRow, ...remainingAnalysisRows];
          return { rows, rowCount: rows.length };
        }
        return undefined;
      });

      const result = await createPostgresResolutionTraceProjector({ pool, authorizer }).loadTrace(
        capability,
        { scope, run_id: ids.run },
      );
      expect(result).toMatchObject({
        ok: false,
        error: { code: "RESOLUTION_TRACE_ARTIFACT_REFERENCE_MISSING" },
      });
    }
  });

  it("fails closed when a READY completion has no unique current Falcon24 publication", async () => {
    const row = await eventRow();
    const sql = await productTeamSqlArtifactRow();
    const evidence = await productTeamQueryEvidenceRow(sql);
    const analysis = await falcon24DerivedAuthorityRows(evidence);
    const completion = await falcon24AnalysisCompletionRow(analysis);
    const { capability, authorizer } = issueCapability();
    const { pool, calls } = scriptedPool((text) => {
      if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
      if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
      if (text.includes("from artifacts")) {
        const rows = [
          sql,
          evidence,
          analysis.derivedRow,
          completion,
          analysis.receiptRow,
          ...analysis.resultRows,
          ...analysis.supportRows,
        ];
        return { rows, rowCount: rows.length };
      }
      return undefined;
    });

    const result = await createPostgresResolutionTraceProjector({ pool, authorizer }).loadTrace(
      capability,
      { scope, run_id: ids.run },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "RESOLUTION_TRACE_PUBLICATION_MISSING" },
    });
    const publicationQuery = calls.find(({ text }) =>
      text.includes("from falcon24_analysis_publication_current"),
    )?.text;
    expect(publicationQuery).toContain("join falcon24_analysis_publications");
    expect(publicationQuery).not.toContain("from e1_analysis_publication_current");
  });

  it("rejects an ordinary SandboxResult substituted into DerivedAnalysisEvidence", async () => {
    const row = await eventRow();
    const sql = await productTeamSqlArtifactRow();
    const evidence = await productTeamQueryEvidenceRow(sql);
    const analysis = await falcon24DerivedAuthorityRows(evidence);
    const ordinaryResult = await ordinarySandboxResultRow();
    const ordinaryResultRef = referenceFromFixtureRow(ordinaryResult);
    const originalDocument = analysis.derivedRow.document_json;
    const originalPayload = originalDocument.payload;
    if (
      originalPayload.artifact_type !== "DerivedAnalysisEvidence" ||
      originalPayload.result.result_kind !== "GENERATED_ANALYSIS"
    ) {
      throw new Error("generated analysis fixture missing");
    }
    const substitutedPayload = {
      ...originalPayload,
      sandbox_result_refs: [ordinaryResultRef, ...originalPayload.sandbox_result_refs],
      result: {
        ...originalPayload.result,
        structured_output_refs: [
          ordinaryResultRef,
          ...originalPayload.result.structured_output_refs,
        ],
      },
    };
    const substitutedDraft = parseL2ResearchDocumentCandidate({
      ...originalDocument,
      envelope: {
        ...originalDocument.envelope,
        input_refs: collectL2ResearchPayloadArtifactReferences(substitutedPayload),
        content_hash: hash("0"),
      },
      payload: substitutedPayload,
    });
    const substitutedHash = await computeL2ResearchEnvelopeContentHash(substitutedDraft);
    const substitutedDocument = parseL2ResearchDocumentCandidate({
      ...substitutedDraft,
      envelope: { ...substitutedDraft.envelope, content_hash: substitutedHash },
    });
    const substitutedDerivedRow = {
      ...analysis.derivedRow,
      content_hash: substitutedHash,
      document_json: substitutedDocument,
    };
    const { capability, authorizer } = issueCapability();
    const { pool } = scriptedPool((text) => {
      if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
      if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
      if (text.includes("from artifacts")) {
        const rows = [
          sql,
          evidence,
          substitutedDerivedRow,
          ordinaryResult,
          analysis.receiptRow,
          ...analysis.resultRows,
          ...analysis.supportRows,
        ];
        return { rows, rowCount: rows.length };
      }
      return undefined;
    });

    const result = await createPostgresResolutionTraceProjector({ pool, authorizer }).loadTrace(
      capability,
      { scope, run_id: ids.run },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "RESOLUTION_TRACE_ARTIFACT_CORRUPT" },
    });
  });

  it("rejects the same Analysis SandboxResult revision mirrored by an inactive ordinary row", async () => {
    const row = await eventRow();
    const sql = await productTeamSqlArtifactRow();
    const evidence = await productTeamQueryEvidenceRow(sql);
    const analysis = await falcon24DerivedAuthorityRows(evidence);
    const systemResult = analysis.resultRows[0];
    const ordinaryMirror = {
      artifact_id: systemResult.artifact_id,
      artifact_type: systemResult.artifact_type,
      revision: systemResult.revision,
      content_hash: systemResult.content_hash,
      document_json: {},
      created_at: occurredAt,
      is_active: false,
    };
    const { capability, authorizer } = issueCapability();
    const { pool } = scriptedPool((text) => {
      if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
      if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
      if (text.includes("from artifacts")) {
        return { rows: [ordinaryMirror, systemResult], rowCount: 2 };
      }
      return undefined;
    });

    const result = await createPostgresResolutionTraceProjector({ pool, authorizer }).loadTrace(
      capability,
      { scope, run_id: ids.run },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "RESOLUTION_TRACE_ARTIFACT_AUTHORITY_AMBIGUOUS" },
    });
  });

  it("fails closed when persisted DerivedAnalysisEvidence document/hash is corrupt", async () => {
    const row = await eventRow();
    const sql = await productTeamSqlArtifactRow();
    const evidence = await productTeamQueryEvidenceRow(sql);
    const chart = await falcon24AnalysisChartRow(evidence);
    const report = await falcon24AnalysisReportRow(chart);
    const corruptDerivedEvidence = {
      artifact_id: derivedEvidenceRef.artifact_id,
      artifact_type: derivedEvidenceRef.artifact_type,
      revision: derivedEvidenceRef.revision,
      content_hash: derivedEvidenceRef.content_hash,
      document_json: {},
      created_at: occurredAt,
    };
    const { capability, authorizer } = issueCapability();
    const { pool } = scriptedPool((text) => {
      if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
      if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
      if (text.includes("select 1") && text.includes("from artifacts")) {
        return { rows: [{}], rowCount: 1 };
      }
      if (text.includes("from artifacts")) {
        return {
          rows: [sql, evidence, corruptDerivedEvidence, chart, report],
          rowCount: 5,
        };
      }
      return undefined;
    });

    const result = await createPostgresResolutionTraceProjector({ pool, authorizer }).loadTrace(
      capability,
      { scope, run_id: ids.run },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "RESOLUTION_TRACE_ARTIFACT_CORRUPT" },
    });
  });

  it("fails closed when a Research L2 QueryEvidence source ref is missing", async () => {
    const row = await eventRow();
    const evidence = await researchQueryEvidenceRow();
    const { capability, authorizer } = issueCapability();
    const { pool, calls } = scriptedPool((text) => {
      if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
      if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
      if (text.includes("select 1") && text.includes("from artifacts")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("from artifacts")) return { rows: [evidence], rowCount: 1 };
      return undefined;
    });

    const result = await createPostgresResolutionTraceProjector({ pool, authorizer }).loadTrace(
      capability,
      { scope, run_id: ids.run },
    );

    expect(
      calls.some(
        ({ text }) =>
          text.includes("from artifacts") &&
          text.includes("from analysis_system_artifacts") &&
          text.includes("from text2sql_system_artifacts"),
      ),
    ).toBe(true);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "RESOLUTION_TRACE_ARTIFACT_REFERENCE_MISSING" },
    });
  });

  it.each([true, false])(
    "indexes current Product Team SQL with evidence=%s",
    async (withEvidence) => {
      const sql = await productTeamSqlArtifactRow();
      const evidence = await productTeamQueryEvidenceRow(sql, true);
      const { capability, authorizer } = issueCapability();
      const { pool, calls } = scriptedPool((text) => {
        if (text.includes("from runs as run"))
          return { rows: [{ ...authorityRow(), schema_snapshot_hash: hash("4") }], rowCount: 1 };
        if (text.includes("from artifacts"))
          return { rows: withEvidence ? [sql, evidence] : [sql], rowCount: withEvidence ? 2 : 1 };
        return undefined;
      });
      const projector = createPostgresResolutionTraceProjector({ pool, authorizer });
      const input = { scope, run_id: ids.run, conversation_id: ids.conversation, limit: 10 };
      const first = await projector.listSqlHistory(capability, input);
      expect(first).toMatchObject({
        ok: true,
        value: {
          items: [
            {
              schema_version: "sql-history-entry@2.0.0",
              sql_artifact_ref: sql.document_json.artifact_ref,
              query_evidence_ref: withEvidence ? evidence.document_json.artifact_ref : null,
              execution_receipt_ref: null,
              result_ref: null,
              compiler_version: null,
              ast_hash: null,
              query_hash: null,
              candidate_hash: hash("1"),
              parameter_hash: hash("2"),
              target_binding_hash: hash("6"),
              statement_hash: await sha256ContentHash("select count(*) from orders"),
              status: withEvidence ? "VALIDATED" : "EXECUTED",
            },
          ],
        },
      });
      expect(await projector.listSqlHistory(capability, input)).toEqual(first);
      expect(JSON.stringify(first)).not.toMatch(
        /select count|"(?:sql|parameters|rows|prompt|context)"/i,
      );
      expect(calls.some(({ text }) => text.includes("run.principal_id = $4"))).toBe(true);
    },
  );

  it("rejects current SQL whose published snapshot differs from its Run", async () => {
    const sql = await productTeamSqlArtifactRow();
    const { capability, authorizer } = issueCapability();
    const { pool } = scriptedPool((text) => {
      if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
      if (text.includes("from artifacts")) return { rows: [sql], rowCount: 1 };
      return undefined;
    });
    expect(
      await createPostgresResolutionTraceProjector({ pool, authorizer }).listSqlHistory(
        capability,
        { scope, run_id: ids.run },
      ),
    ).toMatchObject({ ok: false, error: { code: "RESOLUTION_TRACE_CONFIG_MISMATCH" } });
  });

  it.each(["binding", "duplicate", "hash"])(
    "rejects current SQL evidence %s drift",
    async (failure) => {
      const sql = await productTeamSqlArtifactRow();
      const evidence = await productTeamQueryEvidenceRow(sql, failure !== "binding");
      const additional =
        failure === "duplicate"
          ? await buildProductTeamArtifactDocument({
              ...evidence.document_json,
              artifact_ref: { ...evidence.document_json.artifact_ref, artifact_id: id(99) },
            })
          : null;
      const rows = [
        sql,
        failure === "hash" ? { ...evidence, content_hash: hash("0") } : evidence,
        ...(additional
          ? [
              {
                ...evidence,
                artifact_id: additional.artifact_ref.artifact_id,
                content_hash: additional.artifact_ref.content_hash,
                document_json: additional,
              },
            ]
          : []),
      ];
      const { capability, authorizer } = issueCapability();
      const { pool } = scriptedPool((text) => {
        if (text.includes("from runs as run"))
          return { rows: [{ ...authorityRow(), schema_snapshot_hash: hash("4") }], rowCount: 1 };
        if (text.includes("from artifacts")) return { rows, rowCount: rows.length };
        return undefined;
      });
      expect(
        await createPostgresResolutionTraceProjector({ pool, authorizer }).listSqlHistory(
          capability,
          { scope, run_id: ids.run },
        ),
      ).toMatchObject({
        ok: false,
        error: {
          code:
            failure === "binding"
              ? "RESOLUTION_TRACE_ARTIFACT_REFERENCE_MISMATCH"
              : failure === "duplicate"
                ? "RESOLUTION_TRACE_ARTIFACT_AUTHORITY_AMBIGUOUS"
                : "RESOLUTION_TRACE_ARTIFACT_CORRUPT",
        },
      });
    },
  );

  it("projects stable trace and redacted SQL history from verified authority rows", async () => {
    const row = await eventRow();
    const sql = await sqlArtifactRow();
    const logicalPlan = referenceOnlyRow({
      artifact_id: ids.plan,
      artifact_type: "LogicalPlan",
      ...scope,
      run_id: ids.run,
      revision: 1,
      content_hash: hash("4"),
    });
    const { capability, authorizer } = issueCapability();
    const { pool, calls } = scriptedPool((text) => {
      if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
      if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
      if (text.includes("select 1") && text.includes("from artifacts"))
        return { rows: [{}], rowCount: 1 };
      if (text.includes("from artifacts")) return { rows: [sql, logicalPlan], rowCount: 2 };
      return undefined;
    });
    const projector = createPostgresResolutionTraceProjector({ pool, authorizer });

    const first = await projector.loadTrace(capability, { scope, run_id: ids.run });
    const second = await projector.loadTrace(capability, { scope, run_id: ids.run });
    expect(first.ok && second.ok && first.value?.trace_hash).toBe(
      second.ok && second.value?.trace_hash,
    );
    expect(first.ok && first.value?.nodes.some(({ kind }) => kind === "SQL")).toBe(true);
    if (!first.ok || !first.value) throw new Error("trace fixture missing");

    const configDetail = await projector.loadDetail(capability, {
      scope,
      run_id: ids.run,
      node_id: `config:${ids.config}:1`,
      expected_trace_hash: first.value.trace_hash,
    });
    expect(configDetail.ok && configDetail.value).toMatchObject({
      kind: "CONTEXT",
      payload: { state: "UNAVAILABLE", reason_code: "HISTORICAL_CONFIG_CONTENT_UNAVAILABLE" },
      result: { state: "UNAVAILABLE", reason_code: "HISTORICAL_DISPLAY_NAME_UNAVAILABLE" },
    });
    const history = await projector.listSqlHistory(capability, {
      scope,
      run_id: ids.run,
      occurred_after: "2026-08-18T11:00:00.000Z",
      occurred_before: "2026-08-18T13:00:00.000Z",
      limit: 10,
    });
    expect(history.ok && history.value.items[0]?.status).toBe("COMPILED");
    expect(history.ok && history.value.items[0]?.schema_snapshot_hash).toBe(hash("3"));
    expect(JSON.stringify(history)).not.toContain("private_value");
    expect(JSON.stringify(history)).not.toMatch(/"(?:sql|parameters|rows|prompt|context)"/i);
    expect(calls.some(({ text }) => text.includes("run.principal_id = $4"))).toBe(true);
    expect(calls.filter(({ text }) => text.startsWith("BEGIN")).map(({ text }) => text)).toEqual(
      Array.from({ length: 4 }, () => "BEGIN ISOLATION LEVEL REPEATABLE READ"),
    );

    const outsideWindow = await projector.listSqlHistory(capability, {
      scope,
      run_id: ids.run,
      occurred_after: "2026-08-18T13:00:00.000Z",
      limit: 10,
    });
    expect(outsideWindow.ok && outsideWindow.value.items).toEqual([]);
    const callsBeforeInvalidWindow = calls.length;
    const invalidWindow = await projector.listSqlHistory(capability, {
      scope,
      occurred_after: "2026-08-18T13:00:00.000Z",
      occurred_before: "2026-08-18T11:00:00.000Z",
    });
    expect(invalidWindow).toMatchObject({
      ok: false,
      error: { code: "SQL_HISTORY_LOOKUP_INVALID" },
    });
    expect(calls).toHaveLength(callsBeforeInvalidWindow);
  });

  it("fails closed when the verified event stream has a sequence gap", async () => {
    const row = await eventRow(2);
    const { capability, authorizer } = issueCapability();
    const { pool } = scriptedPool((text) => {
      if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
      if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
      if (text.includes("from artifacts")) return { rows: [], rowCount: 0 };
      return undefined;
    });
    const result = await createPostgresResolutionTraceProjector({ pool, authorizer }).loadTrace(
      capability,
      { scope, run_id: ids.run },
    );
    expect(result).toMatchObject({ ok: false, error: { code: "RESOLUTION_TRACE_EVENT_GAP" } });
  });

  it("fails closed when a stored event hash does not match its document", async () => {
    const row = await eventRow(1, hash("f"));
    const { capability, authorizer } = issueCapability();
    const { pool } = scriptedPool((text) => {
      if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
      if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
      return undefined;
    });
    const result = await createPostgresResolutionTraceProjector({ pool, authorizer }).loadTrace(
      capability,
      { scope, run_id: ids.run },
    );
    expect(result).toMatchObject({ ok: false, error: { code: "RUN_EVENT_STORE_EVENT_CORRUPT" } });
  });
});
