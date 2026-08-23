import {
  buildResolutionTrace,
  buildSqlHistoryEntry,
  modelRequestPerformanceSchema,
  verifyResolutionTraceDetail,
} from "@data-agent/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResolutionTracePanel } from "@/components/qa/resolution-trace-view";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;

describe("Resolution Trace panel", () => {
  it("groups the whole conversation into collapsible Turns and exposes Request performance", async () => {
    const buildTurn = (runSuffix: number, eventSuffix: number, second: number) =>
      buildResolutionTrace({
        schema_version: "resolution-trace@1.0.0",
        scope,
        run_id: id(runSuffix),
        conversation_id: id(4),
        config_ref: null,
        nodes: [
          {
            node_id: `event:${id(eventSuffix)}`,
            kind: "TERMINAL" as const,
            source_event_id: id(eventSuffix),
            sequence: 1,
            occurred_at: new Date(Date.UTC(2026, 7, 23, 0, 0, second)).toISOString(),
            status: "COMPLETED" as const,
            title: `Turn ${runSuffix} complete`,
            summary: "已完成",
            duration_ms: 300,
            artifact_refs: [],
          },
        ],
        edges: [],
      });
    const first = await buildTurn(30, 40, 1);
    const second = await buildTurn(31, 41, 2);
    const performance = modelRequestPerformanceSchema.parse({
      schema_version: "model-request-performance@1.0.0",
      request_id: id(50),
      provider: "deepseek",
      profile_id: id(51),
      model_id: "deepseek-v4-flash",
      status: "COMPLETED",
      attempt_count: 2,
      duration_ms: 640,
      context_window_tokens: 262_144,
      reserved_output_tokens: 2_048,
      usage: {
        availability: "AVAILABLE",
        source: "PROVIDER_REPORTED",
        input_tokens: 162_000,
        output_tokens: 1_000,
        total_tokens: 163_000,
        tool_calls: 0,
        unavailable_reason: null,
      },
    });
    const html = renderToStaticMarkup(
      <ResolutionTracePanel
        trace={second}
        traces={[first, second]}
        sql={[]}
        requestPerformances={[
          {
            run_id: second.run_id,
            sequence: 3,
            occurred_at: "2026-08-23T00:00:02.000Z",
            performance,
          },
        ]}
      />,
    );
    expect(html).toContain("2 Turn");
    expect(html).toContain("Turn 1");
    expect(html).toContain("Turn 2");
    expect(html).toContain("Request 1");
    expect(html).toContain("deepseek/deepseek-v4-flash");
    expect(html).toContain("162,000 / 1,000");
  });

  it("renders bounded server-authored trace nodes without horizontal overflow", async () => {
    const trace = await buildResolutionTrace({
      schema_version: "resolution-trace@1.0.0",
      scope,
      run_id: id(3),
      conversation_id: id(4),
      config_ref: null,
      nodes: [
        {
          node_id: `event:${id(5)}`,
          kind: "PROGRESS",
          source_event_id: id(5),
          sequence: 1,
          occurred_at: "2026-08-18T12:00:00.000Z",
          status: "RUNNING",
          title: "Evidence planning",
          summary: "A".repeat(2_000),
          duration_ms: null,
          artifact_refs: [],
        },
      ],
      edges: [],
    });
    const detail = verifyResolutionTraceDetail({
      schema_version: "resolution-trace-detail@2.0.0",
      scope,
      run_id: id(3),
      node_id: `event:${id(5)}`,
      kind: "PROGRESS",
      sequence: 1,
      source_event_ids: [id(5)],
      title: "Evidence planning",
      status: "RUNNING",
      summary: "正在建立证据计划",
      hierarchy: { parent_node_ids: [], child_node_ids: [] },
      run_context: {
        state: "AVAILABLE",
        format: "FIELDS",
        text: null,
        fields: [
          { label: "用户问题", value: "统计本月订单并解释异常" },
          { label: "所属对话", value: "月度订单分析" },
          { label: "冻结模型", value: "deepseek / deepseek-v4" },
        ],
      },
      identity: [{ label: "Run ID", value: id(3), value_kind: "ID" }],
      payload: {
        state: "AVAILABLE",
        format: "TEXT",
        text: "正在建立证据计划",
        fields: [],
      },
      result: {
        state: "UNAVAILABLE",
        reason_code: "PUBLIC_RESULT_UNAVAILABLE",
        message: "尚无公开结果。",
      },
      schema: {
        state: "UNAVAILABLE",
        reason_code: "PUBLIC_SCHEMA_UNAVAILABLE",
        message: "尚无公开 Schema。",
      },
      timing: {
        occurred_at: "2026-08-18T12:00:00.000Z",
        started_at: null,
        completed_at: null,
        duration_ms: null,
        source: "SESSION_TIMESTAMPS",
      },
      relations: [],
      artifact_refs: [],
    });
    const html = renderToStaticMarkup(
      <ResolutionTracePanel
        trace={trace}
        sql={[]}
        focusSequence={1}
        initialDetails={[detail]}
        connectionState="reconnecting"
      />,
    );
    expect(html).toContain("运行与证据");
    expect(html).toContain("Evidence planning");
    expect(html).toContain("break-words");
    expect(html).toContain('aria-current="step"');
    expect(html).toContain(`id="resolution-trace-event:${id(5)}"`);
    expect(html).not.toContain("private reasoning");
    expect(html).toContain("真实耗时");
    expect(html).toContain("展开阶段");
    expect(html).toContain("展开调用");
    expect(html).toContain("调整轨迹详情宽度");
    expect(html).toContain("Run");
    expect(html).toContain("Agent");
    expect(html).toContain("Tools");
    expect(html).toContain("Evidence");
    expect(html).toContain("Summary");
    expect(html).toContain("Payload");
    expect(html).toContain("Result");
    expect(html).toContain("Schema");
    expect(html).toContain("Timing");
    expect(html).toContain("Run 与对话");
    expect(html).toContain("统计本月订单并解释异常");
    expect(html).toContain("月度订单分析");
    expect(html).toContain("deepseek / deepseek-v4");
    expect(html).toContain("正在恢复轨迹连接；Run 状态保持不变");
  });

  it("opens exact Artifact content from a selected Tool instead of ending at its ID", async () => {
    const reference = {
      artifact_id: id(9),
      artifact_type: "AnalysisReport" as const,
      ...scope,
      run_id: id(3),
      revision: 2,
      content_hash: hash("9"),
    };
    const trace = await buildResolutionTrace({
      schema_version: "resolution-trace@1.0.0",
      scope,
      run_id: id(3),
      conversation_id: id(4),
      config_ref: null,
      nodes: [
        {
          node_id: `event:${id(8)}`,
          kind: "TOOL",
          source_event_id: id(8),
          sequence: 1,
          occurred_at: "2026-08-18T12:00:00.000Z",
          status: "COMPLETED",
          title: "report.write",
          summary: "报告已提交，可直接查看正文",
          duration_ms: 80,
          artifact_refs: [reference],
        },
      ],
      edges: [],
    });
    const html = renderToStaticMarkup(<ResolutionTracePanel trace={trace} sql={[]} />);
    expect(html).toContain("Artifact 内容");
    expect(html).toContain("正在加载 Artifact");
    expect(html).toContain("AnalysisReport");
    expect(html).not.toContain(`>${reference.artifact_id}<`);
  });

  it("renders hash-only SQL history with a conversation deep link", async () => {
    const trace = await buildResolutionTrace({
      schema_version: "resolution-trace@1.0.0",
      scope,
      run_id: id(3),
      conversation_id: id(4),
      config_ref: null,
      nodes: [],
      edges: [],
    });
    const entry = await buildSqlHistoryEntry({
      schema_version: "sql-history-entry@1.0.0",
      scope,
      run_id: id(3),
      conversation_id: id(4),
      sql_artifact_ref: {
        artifact_id: id(6),
        artifact_type: "SqlArtifact",
        ...scope,
        run_id: id(3),
        revision: 1,
        content_hash: hash("1"),
      },
      execution_receipt_ref: null,
      query_evidence_ref: null,
      result_ref: null,
      schema_snapshot_ref: null,
      schema_snapshot_hash: hash("2"),
      compiler_version: "postgresql-compiler@1.0.0",
      ast_hash: hash("3"),
      statement_hash: hash("4"),
      parameter_hash: hash("5"),
      query_hash: hash("6"),
      status: "COMPILED",
      occurred_at: "2026-08-18T12:00:00.000Z",
      conversation_href: `/w/${scope.tenant_id}/qa?conversation=${id(4)}&run=${id(3)}&tab=conversation`,
    });
    const html = renderToStaticMarkup(
      <ResolutionTracePanel trace={trace} sql={[entry]} initialTab="sql" />,
    );
    expect(html).toContain("postgresql-compiler@1.0.0");
    expect(html).toContain("打开原会话");
    expect(html).not.toMatch(/parameters|rows|prompt|context/i);
    const empty = renderToStaticMarkup(<ResolutionTracePanel trace={trace} sql={[]} />);
    expect(empty).toContain("暂无运行节点");
  });
});
