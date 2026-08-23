import {
  buildProductTeamArtifactDocument,
  computeL2ArtifactContentHash,
  computeSqlArtifactQueryHash,
  l2ArtifactDocumentSchema,
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
    schema_version: "product-team-artifact@1.0.0",
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
