import {
  type ArtifactReference,
  analysisSandboxExecutionReceiptSchema,
  buildArtifactWorkspaceChartDocumentV2,
  buildArtifactWorkspaceChartDocumentV3,
  buildProductTeamArtifactDocument,
  canonicalizeJson,
  collectL2ResearchPayloadArtifactReferences,
  computeL2ArtifactContentHash,
  computeL2ResearchEnvelopeContentHash,
  computeSqlArtifactQueryHash,
  l2ArtifactDocumentSchema,
  parseL2ResearchDocumentCandidate,
  runRuntimeEventSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresResolutionTraceProjector } from "../../src/runs/postgres-resolution-trace.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
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

async function toolCompletedEventRow(
  artifactRefs: readonly {
    readonly artifact_id: string;
    readonly artifact_type: "QueryEvidence";
    readonly app_id: string;
    readonly tenant_id: string;
    readonly environment: "test";
    readonly run_id: string;
    readonly revision: number;
    readonly content_hash: string;
  }[],
) {
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

async function productTeamQueryEvidenceRow(
  sql: Awaited<ReturnType<typeof productTeamSqlArtifactRow>>,
) {
  const sqlReference = sql.document_json.artifact_ref;
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
      schema_version: "analysis-published-chart@1.0.0",
      chart_id: "trend_chart",
      title_zh: "收入趋势",
      intent: "TREND",
      template_id: "line.multi-series@1",
      bindings: {
        x_field: "month",
        y_fields: ["revenue"],
        series_field: null,
        lower_bound_field: null,
        upper_bound_field: null,
      },
      dataset: {
        table_id: "trend_chart_dataset",
        columns: [
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
        rows: [{ month: "2026-08", revenue: 110 }],
        total_rows: 1,
      },
    },
  });
  const resultRefs = [resultRow, tableRow, chartRow].map(referenceFromFixtureRow);
  const analysisProgramRef = {
    artifact_id: id(43),
    artifact_type: "AnalysisProgram" as const,
    ...scope,
    run_id: ids.run,
    revision: 1,
    content_hash: hash("c"),
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
        input_ref: queryEvidenceRef,
        materialization_receipt_ref: materializationReceiptRef,
        content_sha256: queryEvidenceRef.content_hash,
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
      referenceOnlyRow(analysisProgramRef),
      referenceOnlyRow(materializationReceiptRef),
    ],
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
    const result = await createPostgresResolutionTraceProjector({ pool, authorizer }).loadDetail(
      capability,
      { scope, run_id: ids.run, node_id: `event:${toolEvent.event_id}` },
    );
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
    const result = await createPostgresResolutionTraceProjector({ pool, authorizer }).loadDetail(
      capability,
      { scope, run_id: ids.run, node_id: `event:${id(999)}` },
    );
    expect(result).toMatchObject({ ok: true, value: null });
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
    const detail = await createPostgresResolutionTraceProjector({ pool, authorizer }).loadDetail(
      capability,
      { scope, run_id: ids.run, node_id: `artifact:${sql.artifact_id}:${sql.revision}` },
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

  it("rejects unverified ordinary SchemaSnapshot and SandboxResult documents", async () => {
    const row = await eventRow();
    for (const artifactType of ["SchemaSnapshot", "SandboxResult"] as const) {
      const malformed = {
        artifact_id: id(995),
        artifact_type: artifactType,
        revision: 1,
        content_hash: hash("a"),
        document_json: {},
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
    const detail = await projector.loadDetail(capability, {
      scope,
      run_id: ids.run,
      node_id: chartNodeId,
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

  it("projects the Falcon24 V3 QueryEvidence to Chart to AnalysisReport authority chain", async () => {
    const row = await eventRow();
    const sql = await productTeamSqlArtifactRow();
    const evidence = await productTeamQueryEvidenceRow(sql);
    const analysis = await falcon24DerivedAuthorityRows(evidence);
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
    const chartDetail = await projector.loadDetail(capability, {
      scope,
      run_id: ids.run,
      node_id: chartNodeId,
    });
    const reportDetail = await projector.loadDetail(capability, {
      scope,
      run_id: ids.run,
      node_id: reportNodeId,
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
  });

  it("fails closed when Analysis System receipt or canonical result bytes are tampered", async () => {
    const row = await eventRow();
    const sql = await productTeamSqlArtifactRow();
    const evidence = await productTeamQueryEvidenceRow(sql);
    const analysis = await falcon24DerivedAuthorityRows(evidence);
    const mutations = [
      {
        ...analysis.receiptRow,
        payload_json: { ...analysis.receiptRow.payload_json, execution_hash: hash("9") },
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

    const configDetail = await projector.loadDetail(capability, {
      scope,
      run_id: ids.run,
      node_id: `config:${ids.config}:1`,
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
