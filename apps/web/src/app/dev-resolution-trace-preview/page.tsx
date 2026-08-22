import { buildResolutionTrace, verifyResolutionTraceDetail } from "@data-agent/contracts";
import { notFound } from "next/navigation";
import { ResolutionTracePanel } from "@/components/qa/resolution-trace-view";

const id = (suffix: number) => `10000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

export default async function ResolutionTracePreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const kinds = [
    "LIFECYCLE",
    "PROGRESS",
    "AGENT",
    "REASONING",
    "TOOL",
    "ANSWER",
    "SQL",
    "ARTIFACT",
    "CONTEXT",
    "TERMINAL",
  ] as const;
  const trace = await buildResolutionTrace({
    schema_version: "resolution-trace@1.0.0",
    scope: { app_id: id(1), tenant_id: id(2), environment: "test" },
    run_id: id(3),
    conversation_id: id(4),
    config_ref: null,
    nodes: Array.from({ length: 80 }, (_, index) => {
      const kind = kinds[index % kinds.length] ?? "PROGRESS";
      const status =
        index === 42
          ? ("FAILED" as const)
          : index % 13 === 0
            ? ("WAITING" as const)
            : index === 79
              ? ("COMPLETED" as const)
              : index % 7 === 0
                ? ("RUNNING" as const)
                : ("COMPLETED" as const);
      return {
        node_id: `event:${id(index + 10)}`,
        kind,
        source_event_id: id(index + 10),
        sequence: index + 1,
        occurred_at: new Date(Date.UTC(2026, 7, 22, 3, 0, index)).toISOString(),
        status,
        title:
          kind === "TOOL"
            ? `semantic.release.read · 调用 ${index + 1}`
            : `${kind} · 阶段 ${index + 1}`,
        summary:
          index === 42
            ? "公开错误 SQL_TIMEOUT；可在 Inspector 查看公开输入、结果与证据。"
            : `已处理第 ${index + 1} 个公开步骤，内容摘要用于验证搜索、时间轴和紧凑列表。`,
        duration_ms: index % 5 === 0 ? null : 120 + index * 7,
        artifact_refs: [],
      };
    }),
    edges: Array.from({ length: 79 }, (_, index) => ({
      from_node_id: `event:${id(index + 10)}`,
      to_node_id: `event:${id(index + 11)}`,
      kind: "SEQUENCE" as const,
    })),
  });
  const detail = verifyResolutionTraceDetail({
    schema_version: "resolution-trace-detail@1.0.0",
    scope: trace.scope,
    run_id: trace.run_id,
    node_id: `event:${id(52)}`,
    kind: "AGENT",
    sequence: 43,
    source_event_ids: [id(52)],
    title: "AGENT · 阶段 43",
    status: "FAILED",
    summary: "公开错误 SQL_TIMEOUT；可在 Inspector 查看公开输入、结果与证据。",
    hierarchy: {
      parent_node_ids: [`event:${id(51)}`],
      child_node_ids: [`event:${id(53)}`],
    },
    identity: [
      { label: "Agent", value: "Text2SQL 专家", value_kind: "NAME" },
      { label: "Task ID", value: id(142), value_kind: "ID" },
      { label: "Error code", value: "SQL_TIMEOUT", value_kind: "STATUS" },
    ],
    payload: {
      state: "AVAILABLE",
      format: "FIELDS",
      text: null,
      fields: [
        { label: "公开任务", value: "验证订单趋势查询并解释失败原因" },
        { label: "公开输入", value: "时间范围：最近 30 天；指标：订单金额" },
      ],
    },
    result: {
      state: "AVAILABLE",
      format: "TEXT",
      text: "沙箱在 30 秒限制内未完成；建议缩小时间范围后重试。",
      fields: [],
    },
    schema: {
      state: "AVAILABLE",
      schema_name: "public-run-event",
      schema_version: "public-run-event@2.0.0",
      fields: [
        { name: "payload.summary", type: "string", availability: "AVAILABLE" },
        { name: "payload.error_code", type: "string", availability: "AVAILABLE" },
      ],
    },
    timing: {
      occurred_at: "2026-08-22T03:00:42.000Z",
      started_at: "2026-08-22T03:00:41.586Z",
      completed_at: "2026-08-22T03:00:42.000Z",
      duration_ms: 414,
      source: "SESSION_TIMESTAMPS",
    },
    relations: [
      { direction: "INCOMING", kind: "SEQUENCE", node_id: `event:${id(51)}` },
      { direction: "OUTGOING", kind: "SEQUENCE", node_id: `event:${id(53)}` },
    ],
    artifact_refs: [],
  });

  return (
    <main className="h-[100dvh] min-h-0 overflow-hidden bg-[var(--color-bg-primary)]">
      <ResolutionTracePanel trace={trace} sql={[]} focusSequence={43} initialDetails={[detail]} />
    </main>
  );
}
