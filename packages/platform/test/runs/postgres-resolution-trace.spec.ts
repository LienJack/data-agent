import {
  buildArtifactWorkspaceChartDocumentV2,
  buildArtifactWorkspaceChartDocumentV3,
  buildProductTeamArtifactDocument,
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
      if (handled) return handled as SqlQueryResult<Row>;
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
      derived_evidence_ref: derivedEvidenceRef,
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
    source_refs: [derivedEvidenceRef, chart.document_json.document_ref],
    provenance: null,
    projection: {
      kind: "REPORT",
      title: "经营表现复盘",
      sections: [
        {
          heading: "结论",
          body_text: "收入下降月份已定位，并附同源数据图表。",
          source_refs: [derivedEvidenceRef, chart.document_json.document_ref],
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
    const chart = await falcon24AnalysisChartRow(evidence);
    const report = await falcon24AnalysisReportRow(chart);
    const { capability, authorizer } = issueCapability();
    const { pool } = scriptedPool((text) => {
      if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
      if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
      if (text.includes("select 1") && text.includes("from artifacts")) {
        return { rows: [{}], rowCount: 1 };
      }
      if (text.includes("from artifacts")) {
        return { rows: [sql, evidence, chart, report], rowCount: 4 };
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
      calls.some(({ text }) => text.includes("select 1") && text.includes("from artifacts")),
    ).toBe(true);
    expect(result).toMatchObject({
      ok: false,
      error: { code: "RESOLUTION_TRACE_ARTIFACT_REFERENCE_MISSING" },
    });
  });

  it("projects stable trace and redacted SQL history from verified authority rows", async () => {
    const row = await eventRow();
    const sql = await sqlArtifactRow();
    const { capability, authorizer } = issueCapability();
    const { pool, calls } = scriptedPool((text) => {
      if (text.includes("from runs as run")) return { rows: [authorityRow()], rowCount: 1 };
      if (text.includes("from run_events")) return { rows: [row], rowCount: 1 };
      if (text.includes("select 1") && text.includes("from artifacts"))
        return { rows: [{}], rowCount: 1 };
      if (text.includes("from artifacts")) return { rows: [sql], rowCount: 1 };
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
