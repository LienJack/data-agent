import { describe, expect, it } from "vitest";
import {
  buildResolutionTrace,
  buildSqlHistoryEntry,
  resolutionTraceDetailSchema,
  resolutionTraceSchema,
  sqlHistoryResultSchema,
  verifyResolutionTrace,
  verifyResolutionTraceDetail,
  verifySqlHistoryEntry,
  verifySqlHistoryResult,
} from "../src/runs/index.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const occurredAt = "2026-08-18T12:00:00.000Z";

function reference<
  const T extends "SqlArtifact" | "QueryEvidence" | "ExecutionReceipt" | "SandboxResult",
>(type: T, suffix: number) {
  return {
    artifact_id: id(suffix),
    artifact_type: type,
    ...scope,
    run_id: id(4),
    revision: 1,
    content_hash: hash(String(suffix % 10)),
  } as const;
}

describe("resolution trace contracts", () => {
  it("canonically sorts nodes and edges, hashes the trace, and rejects tampering", async () => {
    const trace = await buildResolutionTrace({
      schema_version: "resolution-trace@1.0.0",
      scope,
      run_id: id(4),
      conversation_id: id(5),
      config_ref: { config_id: id(6), config_revision: 2, config_hash: hash("a") },
      nodes: [
        {
          node_id: `event:${id(8)}`,
          kind: "TERMINAL",
          source_event_id: id(8),
          sequence: 2,
          occurred_at: occurredAt,
          status: "COMPLETED",
          title: "Completed",
          summary: "Analysis completed",
          duration_ms: null,
          artifact_refs: [],
        },
        {
          node_id: `event:${id(7)}`,
          kind: "PROGRESS",
          source_event_id: id(7),
          sequence: 1,
          occurred_at: occurredAt,
          status: "RUNNING",
          title: "Plan",
          summary: "Building an evidence plan",
          duration_ms: null,
          artifact_refs: [reference("SqlArtifact", 20)],
        },
        {
          node_id: `artifact:${id(20)}:1`,
          kind: "SQL",
          source_event_id: null,
          sequence: null,
          occurred_at: occurredAt,
          status: "AVAILABLE",
          title: "SqlArtifact",
          summary: "已提交 SQL Artifact",
          duration_ms: null,
          artifact_refs: [reference("SqlArtifact", 20)],
        },
      ],
      edges: [
        {
          from_node_id: `event:${id(7)}`,
          to_node_id: `artifact:${id(20)}:1`,
          kind: "PRODUCED",
        },
        { from_node_id: `event:${id(7)}`, to_node_id: `event:${id(8)}`, kind: "SEQUENCE" },
      ],
    });

    expect(trace.nodes.map(({ sequence }) => sequence)).toEqual([1, 2, null]);
    expect(trace.trace_hash).toMatch(/^sha256:/);
    await expect(verifyResolutionTrace(trace)).resolves.toEqual(trace);
    await expect(
      verifyResolutionTrace({
        ...trace,
        nodes: trace.nodes.map((node, index) =>
          index === 0 ? { ...node, status: "FAILED" as const } : node,
        ),
      }),
    ).rejects.toThrow("RESOLUTION_TRACE_HASH_MISMATCH");
  });

  it("fails closed on duplicate event sequence, missing edge endpoints, and scope-spliced refs", async () => {
    const node = {
      node_id: `event:${id(7)}`,
      kind: "PROGRESS" as const,
      source_event_id: id(7),
      sequence: 1,
      occurred_at: occurredAt,
      status: "RUNNING" as const,
      title: "Plan",
      summary: "Building",
      duration_ms: null,
      artifact_refs: [],
    };
    const draft = {
      schema_version: "resolution-trace@1.0.0" as const,
      scope,
      run_id: id(4),
      conversation_id: null,
      config_ref: null,
      nodes: [node],
      edges: [],
    };

    await expect(
      buildResolutionTrace({ ...draft, nodes: [node, { ...node, node_id: `event:${id(8)}` }] }),
    ).rejects.toThrow();
    await expect(
      buildResolutionTrace({
        ...draft,
        edges: [{ from_node_id: node.node_id, to_node_id: `event:${id(9)}`, kind: "SEQUENCE" }],
      }),
    ).rejects.toThrow();
    await expect(
      buildResolutionTrace({
        ...draft,
        nodes: [
          {
            ...node,
            artifact_refs: [{ ...reference("SqlArtifact", 20), tenant_id: id(99) }],
          },
        ],
      }),
    ).rejects.toThrow();
  });

  it("rejects duplicate ArtifactReference identity inside one trace node", async () => {
    const duplicatedReference = reference("SqlArtifact", 20);

    await expect(
      buildResolutionTrace({
        schema_version: "resolution-trace@1.0.0",
        scope,
        run_id: id(4),
        conversation_id: null,
        config_ref: null,
        nodes: [
          {
            node_id: `event:${id(7)}`,
            kind: "TOOL",
            source_event_id: id(7),
            sequence: 1,
            occurred_at: occurredAt,
            status: "COMPLETED",
            title: "SQL sandbox",
            summary: "查询完成",
            duration_ms: 12,
            artifact_refs: [duplicatedReference, duplicatedReference],
          },
        ],
        edges: [],
      }),
    ).rejects.toThrow("RESOLUTION_TRACE_ARTIFACT_REFERENCE_DUPLICATE");
  });

  it("requires exactly one PRODUCED edge for every event ArtifactReference", async () => {
    const producedReference = reference("QueryEvidence", 21);
    const nodes = [
      {
        node_id: `event:${id(7)}`,
        kind: "TOOL" as const,
        source_event_id: id(7),
        sequence: 1,
        occurred_at: occurredAt,
        status: "COMPLETED" as const,
        title: "SQL sandbox",
        summary: "查询完成",
        duration_ms: 12,
        artifact_refs: [producedReference],
      },
      {
        node_id: `artifact:${producedReference.artifact_id}:1`,
        kind: "ARTIFACT" as const,
        source_event_id: null,
        sequence: null,
        occurred_at: occurredAt,
        status: "AVAILABLE" as const,
        title: "QueryEvidence",
        summary: "已提交查询证据",
        duration_ms: null,
        artifact_refs: [producedReference],
      },
    ];
    const eventNodeValue = nodes[0] as (typeof nodes)[number];
    const artifactNodeValue = nodes[1] as (typeof nodes)[number];
    const draft = {
      schema_version: "resolution-trace@1.0.0" as const,
      scope,
      run_id: id(4),
      conversation_id: null,
      config_ref: null,
      nodes,
    };

    await expect(buildResolutionTrace({ ...draft, edges: [] })).rejects.toThrow(
      "RESOLUTION_TRACE_EVENT_ARTIFACT_PRODUCED_EDGE_INVALID",
    );
    await expect(
      buildResolutionTrace({
        ...draft,
        edges: [
          {
            from_node_id: eventNodeValue.node_id,
            to_node_id: artifactNodeValue.node_id,
            kind: "PRODUCED" as const,
          },
        ],
      }),
    ).resolves.toMatchObject({ edges: [{ kind: "PRODUCED" }] });

    await expect(
      buildResolutionTrace({
        ...draft,
        nodes: [{ ...eventNodeValue, artifact_refs: [] }, artifactNodeValue],
        edges: [
          {
            from_node_id: eventNodeValue.node_id,
            to_node_id: artifactNodeValue.node_id,
            kind: "PRODUCED" as const,
          },
        ],
      }),
    ).rejects.toThrow("RESOLUTION_TRACE_EVENT_ARTIFACT_PRODUCED_EDGE_INVALID");

    await expect(
      buildResolutionTrace({
        ...draft,
        nodes: [
          eventNodeValue,
          {
            ...artifactNodeValue,
            artifact_refs: [reference("QueryEvidence", 22)],
          },
        ],
        edges: [
          {
            from_node_id: eventNodeValue.node_id,
            to_node_id: artifactNodeValue.node_id,
            kind: "PRODUCED" as const,
          },
        ],
      }),
    ).rejects.toThrow("RESOLUTION_TRACE_EVENT_ARTIFACT_PRODUCED_EDGE_INVALID");
  });

  it("maps trace and detail schema failures to stable authority codes", async () => {
    await expect(
      verifyResolutionTrace({ schema_version: "resolution-trace@1.0.0" }),
    ).rejects.toThrow("RESOLUTION_TRACE_SCHEMA_INVALID");
    expect(() =>
      verifyResolutionTraceDetail({ schema_version: "resolution-trace-detail@2.0.0" }),
    ).toThrow("RESOLUTION_TRACE_DETAIL_SCHEMA_INVALID");
  });

  it("rejects unknown or private fields instead of leaking them into the public wire", async () => {
    const parsed = resolutionTraceSchema.safeParse({
      schema_version: "resolution-trace@1.0.0",
      scope,
      run_id: id(4),
      conversation_id: null,
      config_ref: null,
      nodes: [],
      edges: [],
      trace_hash: hash("f"),
      prompt: "private system prompt",
    });
    expect(parsed.success).toBe(false);
  });

  it("parses a content-first public detail and rejects private payload fields", () => {
    const detail = {
      schema_version: "resolution-trace-detail@2.0.0",
      scope,
      run_id: id(4),
      node_id: `event:${id(7)}`,
      kind: "TOOL",
      sequence: 1,
      source_event_ids: [id(7)],
      title: "读取业务文档",
      status: "COMPLETED",
      summary: "已读取 14 行公开内容",
      hierarchy: { parent_node_ids: [], child_node_ids: [] },
      run_context: {
        state: "AVAILABLE",
        format: "FIELDS",
        text: null,
        fields: [
          { label: "用户问题", value: "统计本月订单" },
          { label: "Run 状态", value: "SUCCEEDED" },
        ],
      },
      identity: [
        { label: "Tool", value: "read", value_kind: "NAME" },
        { label: "Call ID", value: "call-1", value_kind: "ID" },
      ],
      payload: {
        state: "AVAILABLE",
        format: "TEXT",
        text: '{"file_path":"notes.md","limit":14}',
        fields: [],
      },
      result: {
        state: "AVAILABLE",
        format: "TEXT",
        text: "文件正文预览",
        fields: [],
      },
      schema: {
        state: "AVAILABLE",
        schema_name: "public-run-event",
        schema_version: "public-run-event@2.0.0",
        fields: [{ name: "payload.input", type: "string | null", availability: "AVAILABLE" }],
      },
      timing: {
        occurred_at: occurredAt,
        started_at: null,
        completed_at: null,
        duration_ms: 40,
        source: "SESSION_TIMESTAMPS",
      },
      relations: [],
      artifact_refs: [],
    } as const;

    expect(resolutionTraceDetailSchema.parse(detail).result).toMatchObject({
      state: "AVAILABLE",
      text: "文件正文预览",
    });
    expect(
      resolutionTraceDetailSchema.safeParse({
        ...detail,
        provider_payload: { authorization: "Bearer secret" },
      }).success,
    ).toBe(false);
    expect(
      resolutionTraceDetailSchema.safeParse({
        ...detail,
        payload: { ...detail.payload, reasoning_content: "private chain of thought" },
      }).success,
    ).toBe(false);
  });

  it("keeps a strict content-first detail shape for all ten node kinds", () => {
    const kinds = [
      "LIFECYCLE",
      "PROGRESS",
      "AGENT",
      "REASONING",
      "TOOL",
      "ANSWER",
      "TERMINAL",
      "ARTIFACT",
      "SQL",
      "CONTEXT",
    ] as const;
    for (const [index, kind] of kinds.entries()) {
      const derived = ["ARTIFACT", "SQL", "CONTEXT"].includes(kind);
      const parsed = resolutionTraceDetailSchema.parse({
        schema_version: "resolution-trace-detail@2.0.0",
        scope,
        run_id: id(4),
        node_id: derived ? `artifact:${id(index + 30)}:1` : `event:${id(index + 30)}`,
        kind,
        sequence: derived ? null : index + 1,
        source_event_ids: derived ? [] : [id(index + 30)],
        title: `${kind} 标题`,
        status: kind === "CONTEXT" || kind === "ARTIFACT" ? "AVAILABLE" : "COMPLETED",
        summary: `${kind} 公开摘要`,
        hierarchy: { parent_node_ids: [], child_node_ids: [] },
        run_context: {
          state: "AVAILABLE",
          format: "FIELDS",
          text: null,
          fields: [{ label: "用户问题", value: "分析订单趋势" }],
        },
        identity: [{ label: "Node ID", value: id(index + 30), value_kind: "ID" }],
        payload: {
          state: "AVAILABLE",
          format: "TEXT",
          text: `${kind} 公开输入或正文`,
          fields: [],
        },
        result: {
          state: "AVAILABLE",
          format: "TEXT",
          text: `${kind} 公共结果或决策`,
          fields: [],
        },
        schema: {
          state: "AVAILABLE",
          schema_name: "public-detail",
          schema_version: "2.0.0",
          fields: [{ name: "summary", type: "string", availability: "AVAILABLE" }],
        },
        timing: {
          occurred_at: occurredAt,
          started_at: occurredAt,
          completed_at: occurredAt,
          duration_ms: 0,
          source: derived ? "ARTIFACT_TIMESTAMP" : "SESSION_TIMESTAMPS",
        },
        relations: [],
        artifact_refs: [],
      });
      expect(parsed.kind).toBe(kind);
      expect(parsed.run_context.state).toBe("AVAILABLE");
    }
  });
});

describe("SQL history contracts", () => {
  it("binds only hashes and typed refs, with no raw SQL parameters, rows, prompt, or context", async () => {
    const entry = await buildSqlHistoryEntry({
      schema_version: "sql-history-entry@1.0.0",
      scope,
      run_id: id(4),
      conversation_id: id(5),
      sql_artifact_ref: reference("SqlArtifact", 20),
      execution_receipt_ref: reference("ExecutionReceipt", 21),
      query_evidence_ref: reference("QueryEvidence", 22),
      result_ref: reference("SandboxResult", 23),
      schema_snapshot_ref: null,
      schema_snapshot_hash: hash("a"),
      compiler_version: "postgresql-compiler@1.0.0",
      ast_hash: hash("b"),
      statement_hash: hash("c"),
      parameter_hash: hash("d"),
      query_hash: hash("e"),
      status: "VALIDATED",
      occurred_at: occurredAt,
      conversation_href: `/w/${scope.tenant_id}/qa?conversation=${id(5)}&run=${id(4)}&tab=conversation`,
    });

    await expect(verifySqlHistoryEntry(entry)).resolves.toEqual(entry);
    expect(JSON.stringify(entry)).not.toMatch(
      /"(?:sql|parameters|rows|prompt|context|provider_body)"/i,
    );
    const result = sqlHistoryResultSchema.parse({
      schema_version: "sql-history-result@1.0.0",
      items: [entry],
      next_cursor: null,
    });
    expect(result.items).toHaveLength(1);
    await expect(verifySqlHistoryResult(result)).resolves.toEqual(result);
    await expect(
      verifySqlHistoryResult({
        ...result,
        items: [{ ...entry, statement_hash: hash("9") }],
      }),
    ).rejects.toThrow("SQL_HISTORY_ENTRY_HASH_MISMATCH");
    await expect(verifySqlHistoryEntry({ ...entry, query_hash: hash("0") })).rejects.toThrow(
      "SQL_HISTORY_ENTRY_HASH_MISMATCH",
    );
    await expect(
      verifySqlHistoryEntry({
        ...entry,
        conversation_href: `/w/${scope.tenant_id}/qa?conversation=${id(99)}&run=${id(4)}&tab=conversation`,
      }),
    ).rejects.toThrow();
  });
});
