import { type PublicRunEvent, publicRunEventSchema } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { parseEventBlock } from "../src/lib/api-client";
import {
  acceptedRunArtifactReferences,
  answerText,
  artifactReferencesBefore,
  assembleConversationActivity,
  assembleProcessRows,
  assembleSubagentInspector,
  buildTrajectoryRecords,
  groupTrajectoryEvents,
  isRunTerminal,
  mergePublicRunEvents,
  resumableRunFromReplay,
} from "../src/lib/qa-event-assembler";
import type { Message } from "../src/lib/qa-types";
import { selectSseCursor } from "../src/lib/sse-cursor";

const runId = "10000000-0000-4000-8000-000000000001";

function event(
  sequence: number,
  value:
    | { type: "answer"; payload: { delta: string } }
    | {
        type: "progress";
        payload: {
          phase: string;
          title: string;
          summary: string;
          status: "RUNNING" | "COMPLETED";
        };
      }
    | {
        type: "tool";
        payload: {
          call_id: string;
          tool_name: string;
          title: string;
          summary: string;
          status: "RUNNING" | "COMPLETED" | "FAILED";
          input: string | null;
          output: string | null;
          duration_ms: number | null;
          error_code: string | null;
        };
      }
    | {
        type: "reasoning";
        payload:
          | { phase: "START"; block_id: string; title: string }
          | { phase: "DELTA"; block_id: string; delta: string }
          | { phase: "END"; block_id: string; summary: string; duration_ms: number };
      }
    | {
        type: "lifecycle";
        payload: {
          name: string;
          status: "QUEUED" | "RUNNING" | "WAITING";
          summary: string;
        };
      }
    | {
        type: "terminal";
        payload: {
          status: "COMPLETED" | "FAILED" | "CANCELLED";
          summary: string;
          error_code: string | null;
        };
      },
): PublicRunEvent {
  return publicRunEventSchema.parse({
    schema_version: "public-run-event@1.0.0",
    event_id: `20000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    run_id: runId,
    sequence,
    occurred_at: `2026-08-14T00:00:0${sequence}.000Z`,
    ...value,
  });
}

function agentEvent(sequence: number): PublicRunEvent {
  return publicRunEventSchema.parse({
    schema_version: "public-run-event@2.0.0",
    event_id: `21000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    run_id: runId,
    sequence,
    occurred_at: `2026-08-14T00:00:0${sequence}.000Z`,
    type: "agent",
    payload: {
      profile_id: "governed-text2sql-agent",
      task_id: "22000000-0000-4000-8000-000000000001",
      status: "RUNNING",
      phase: "compile.query",
      title: "Text2SQL",
      summary: "正在编译查询",
      duration_ms: null,
      error_code: null,
    },
  });
}

function teamEvent(
  sequence: number,
  type: "agent" | "tool" | "answer" | "terminal",
  payload: Record<string, unknown>,
): PublicRunEvent {
  return publicRunEventSchema.parse({
    schema_version: "public-run-event@2.0.0",
    event_id: `23000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    run_id: runId,
    sequence,
    occurred_at: `2026-08-14T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    type,
    payload,
  });
}

describe("Q&A public event assembly", () => {
  it("prefers a valid Last-Event-ID and safely falls back to the query cursor", () => {
    expect(selectSseCursor("12", "4")).toBe(12);
    expect(selectSseCursor("invalid", "4")).toBe(4);
    expect(selectSseCursor("-1", "NaN")).toBe(0);
  });

  it("parses the public SSE contract and rejects unknown event shapes", () => {
    const input = event(1, { type: "answer", payload: { delta: "第一段" } });
    expect(parseEventBlock(`id: 1\ndata: ${JSON.stringify(input)}`)).toEqual(input);
    expect(() =>
      parseEventBlock(
        `data: ${JSON.stringify({ ...input, type: "hidden_reasoning", payload: {} })}`,
      ),
    ).toThrow();
  });

  it("deduplicates replayed sequences and assembles answer deltas in order", () => {
    const first = event(1, { type: "answer", payload: { delta: "A" } });
    const second = event(2, { type: "answer", payload: { delta: "B" } });
    const merged = mergePublicRunEvents([second], [first, second]);
    expect(merged).toHaveLength(2);
    expect(answerText(merged, runId)).toBe("AB");
  });

  it("resumes only the latest non-terminal replay from its durable cursor", () => {
    const first = event(1, {
      type: "lifecycle",
      payload: { name: "run.leased", status: "RUNNING", summary: "执行中" },
    });
    const second = event(2, { type: "answer", payload: { delta: "部分回答" } });
    expect(resumableRunFromReplay([second, first])).toEqual({ runId, cursor: 2 });
    expect(
      resumableRunFromReplay([
        first,
        event(3, {
          type: "terminal",
          payload: { status: "COMPLETED", summary: "完成", error_code: null },
        }),
      ]),
    ).toBeNull();
  });

  it("keeps a replayed WAITING lifecycle event as one durable trajectory record", () => {
    const waiting = event(3, {
      type: "lifecycle",
      payload: { name: "run.suspended", status: "WAITING", summary: "任务等待后续处理" },
    });
    const merged = mergePublicRunEvents([waiting], [waiting]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      type: "lifecycle",
      payload: {
        status: "WAITING",
        summary: "任务等待后续处理",
      },
    });
  });

  it("decodes a v2 Agent event into the trajectory without changing its public schema", () => {
    const agent = agentEvent(3);
    const records = buildTrajectoryRecords([agent], []);
    expect(records).toEqual([
      expect.objectContaining({
        eventType: "agent",
        status: "RUNNING",
        schema: expect.objectContaining({ schema_version: "public-run-event@2.0.0" }),
        payload: expect.objectContaining({ profile_id: "governed-text2sql-agent" }),
      }),
    ]);
  });

  it("assembles answer, Subagent and one-level owned Tool/Artifact blocks deterministically", () => {
    const taskId = "22000000-0000-4000-8000-000000000001";
    const reference = {
      artifact_id: "24000000-0000-4000-8000-000000000001",
      artifact_type: "QueryEvidence" as const,
      app_id: "24000000-0000-4000-8000-000000000002",
      tenant_id: "24000000-0000-4000-8000-000000000003",
      environment: "test" as const,
      run_id: runId,
      revision: 1,
      content_hash: `sha256:${"a".repeat(64)}` as const,
    };
    const events = [
      event(1, {
        type: "reasoning",
        payload: { phase: "START", block_id: "think", title: "规划" },
      }),
      teamEvent(2, "answer", { delta: "中间" }),
      teamEvent(3, "answer", { delta: "回答" }),
      teamEvent(4, "agent", {
        profile_id: "governed-text2sql-agent",
        task_id: taskId,
        status: "RUNNING",
        phase: "compile.query",
        title: "Text2SQL",
        summary: "正在编译查询",
        duration_ms: null,
        error_code: null,
      }),
      teamEvent(5, "tool", {
        call_id: "compile-1",
        tool_name: "sql.compiler.compile",
        profile_id: "governed-text2sql-agent",
        task_id: taskId,
        title: "编译 SQL",
        summary: "编译中",
        status: "RUNNING",
        input: "semantic query",
        output: null,
        duration_ms: null,
        error_code: null,
        artifact_refs: [],
      }),
      teamEvent(6, "tool", {
        call_id: "compile-1",
        tool_name: "sql.compiler.compile",
        profile_id: "governed-text2sql-agent",
        task_id: taskId,
        title: "编译 SQL",
        summary: "编译完成",
        status: "COMPLETED",
        input: null,
        output: "SELECT count(*)",
        duration_ms: 42,
        error_code: null,
        artifact_refs: [reference],
      }),
      teamEvent(7, "answer", { delta: "最终结论" }),
      teamEvent(8, "agent", {
        profile_id: "governed-text2sql-agent",
        task_id: taskId,
        status: "COMPLETED",
        phase: "query.accepted",
        title: "Text2SQL",
        summary: "查询证据已提交",
        duration_ms: 420,
        error_code: null,
      }),
      teamEvent(9, "terminal", { status: "COMPLETED", summary: "完成", error_code: null }),
    ];

    const blocks = assembleConversationActivity(events, runId);
    expect(blocks.map((block) => [block.kind, block.sequence])).toEqual([
      ["reasoning", 1],
      ["text", 2],
      ["agent", 4],
      ["artifact", 6],
      ["text", 7],
    ]);
    expect(blocks[1]).toMatchObject({ kind: "text", content: "中间回答" });
    expect(blocks[2]).toMatchObject({
      kind: "agent",
      agent: {
        status: "COMPLETED",
        children: [
          expect.objectContaining({
            toolName: "sql.compiler.compile",
            artifactRefs: [reference],
          }),
        ],
      },
    });
    expect(blocks[3]).toMatchObject({
      kind: "artifact",
      sequence: 6,
      reference,
    });
    expect(assembleConversationActivity([...events].reverse(), runId)).toEqual(blocks);
    expect(artifactReferencesBefore(events, 2, runId)).toEqual([]);
    expect(artifactReferencesBefore(events, 6, runId)).toEqual([]);
    expect(artifactReferencesBefore(events, 7, runId)).toEqual([reference]);
    expect(isRunTerminal(events.slice(0, -1), runId)).toBe(false);
    expect(isRunTerminal(events, runId)).toBe(true);

    const target = {
      kind: "subagent" as const,
      run_id: runId,
      profile_id: "governed-text2sql-agent" as const,
      task_id: taskId,
      anchor_sequence: 4,
    };
    expect(assembleSubagentInspector(events, target)).toMatchObject({
      state: "ready",
      cursor: 9,
      terminal: true,
      events: [
        expect.objectContaining({ sequence: 4 }),
        expect.objectContaining({ sequence: 5 }),
        expect.objectContaining({ sequence: 6 }),
        expect.objectContaining({ sequence: 8 }),
      ],
    });
    expect(
      assembleSubagentInspector(events, {
        ...target,
        task_id: "22000000-0000-4000-8000-000000000099",
      }).state,
    ).toBe("stale");
  });

  it("projects only current-Run artifacts whose owning Agent task was accepted", () => {
    const queryTaskId = "22000000-0000-4000-8000-000000000011";
    const analysisTaskId = "22000000-0000-4000-8000-000000000012";
    const artifact = (
      suffix: string,
      artifactType:
        | "QueryEvidence"
        | "ArtifactWorkspaceDocument"
        | "AnalysisReport"
        | "ConversationContextSummary"
        | "SqlArtifact",
      character: string,
    ) => ({
      artifact_id: `24000000-0000-4000-8000-${suffix}`,
      artifact_type: artifactType,
      app_id: "24000000-0000-4000-8000-000000000002",
      tenant_id: "24000000-0000-4000-8000-000000000003",
      environment: "test" as const,
      run_id: runId,
      revision: 1,
      content_hash: `sha256:${character.repeat(64)}` as const,
    });
    const query = artifact("000000000011", "QueryEvidence", "a");
    const chart = artifact("000000000012", "ArtifactWorkspaceDocument", "b");
    const rejectedReport = artifact("000000000013", "AnalysisReport", "c");
    const privateSql = artifact("000000000014", "SqlArtifact", "d");
    const conversationSummary = artifact("000000000015", "ConversationContextSummary", "e");
    const events = [
      teamEvent(1, "tool", {
        call_id: "query-1",
        tool_name: "text2sql.execute",
        profile_id: "governed-text2sql-agent",
        task_id: queryTaskId,
        title: "执行查询",
        summary: "查询与图表已提交",
        status: "COMPLETED",
        input: null,
        output: "12 rows",
        duration_ms: 41,
        error_code: null,
        artifact_refs: [chart, query, privateSql, conversationSummary],
      }),
      teamEvent(2, "tool", {
        call_id: "chart-replay-1",
        tool_name: "chart.publish",
        profile_id: "governed-text2sql-agent",
        task_id: queryTaskId,
        title: "发布图表",
        summary: "同源图表已提交",
        status: "COMPLETED",
        input: null,
        output: "chart",
        duration_ms: 8,
        error_code: null,
        artifact_refs: [chart],
      }),
      teamEvent(3, "agent", {
        profile_id: "governed-text2sql-agent",
        task_id: queryTaskId,
        status: "COMPLETED",
        phase: "query.accepted",
        title: "Text2SQL",
        summary: "查询证据已验收",
        duration_ms: 55,
        error_code: null,
      }),
      teamEvent(4, "tool", {
        call_id: "analysis-1",
        tool_name: "analysis.execute",
        profile_id: "report-writing-agent",
        task_id: analysisTaskId,
        title: "执行分析",
        summary: "报告候选已生成",
        status: "COMPLETED",
        input: null,
        output: "report",
        duration_ms: 80,
        error_code: null,
        artifact_refs: [rejectedReport],
      }),
      teamEvent(5, "agent", {
        profile_id: "report-writing-agent",
        task_id: analysisTaskId,
        status: "FAILED",
        phase: "report.rejected",
        title: "Report",
        summary: "报告验收失败",
        duration_ms: 90,
        error_code: "REPORT_ACCEPTANCE_FAILED",
      }),
      teamEvent(6, "terminal", {
        status: "COMPLETED",
        summary: "Root 已基于查询证据完成回答",
        error_code: null,
      }),
    ];

    expect(acceptedRunArtifactReferences(events, runId)).toEqual([query, chart]);
    const queryOnly = events
      .filter((event) => event.type !== "tool" || event.payload.call_id !== "chart-replay-1")
      .map((event) =>
        event.type === "tool" && event.payload.call_id === "query-1"
          ? publicRunEventSchema.parse({
              ...event,
              payload: { ...event.payload, artifact_refs: [query, privateSql] },
            })
          : event,
      );
    expect(acceptedRunArtifactReferences(queryOnly, runId)).toEqual([query]);
    expect(acceptedRunArtifactReferences(events.slice(0, -1), runId)).toEqual([]);
    expect(
      acceptedRunArtifactReferences(
        [
          ...events.slice(0, -1),
          teamEvent(6, "terminal", {
            status: "FAILED",
            summary: "Root 最终回答失败",
            error_code: "ROOT_ANSWER_REJECTED",
          }),
        ],
        runId,
      ),
    ).toEqual([]);
  });

  it("merges tool start and completion without losing the safe input", () => {
    const start = event(2, {
      type: "tool",
      payload: {
        call_id: "call-1",
        tool_name: "research_kernel",
        title: "执行研究内核",
        summary: "查询中",
        status: "RUNNING",
        input: "dataset=orders",
        output: null,
        duration_ms: null,
        error_code: null,
      },
    });
    const complete = event(3, {
      type: "tool",
      payload: {
        call_id: "call-1",
        tool_name: "research_kernel",
        title: "research_kernel",
        summary: "完成",
        status: "COMPLETED",
        input: null,
        output: "2 artifacts",
        duration_ms: 42,
        error_code: null,
      },
    });
    expect(assembleProcessRows([start, complete], runId)).toEqual([
      expect.objectContaining({
        sequence: 2,
        status: "COMPLETED",
        input: "dataset=orders",
        output: "2 artifacts",
        durationMs: 42,
      }),
    ]);
  });

  it("merges public reasoning summary chunks into one collapsible process row", () => {
    const started = event(2, {
      type: "reasoning",
      payload: { phase: "START", block_id: "reasoning-1", title: "规划执行路径" },
    });
    const delta = event(3, {
      type: "reasoning",
      payload: {
        phase: "DELTA",
        block_id: "reasoning-1",
        delta: "先确认语义口径，再执行受治理查询。",
      },
    });
    const completed = event(4, {
      type: "reasoning",
      payload: {
        phase: "END",
        block_id: "reasoning-1",
        summary: "已确认语义口径与查询边界。",
        duration_ms: 28,
      },
    });

    expect(assembleProcessRows([started, delta, completed], runId)).toEqual([
      expect.objectContaining({
        id: `${runId}:reasoning:reasoning-1`,
        kind: "reasoning",
        title: "规划执行路径",
        summary: "已确认语义口径与查询边界。",
        status: "COMPLETED",
        durationMs: 28,
      }),
    ]);
  });

  it("groups the entire conversation by run and counts unique tool calls", () => {
    const progress = event(1, {
      type: "progress",
      payload: {
        phase: "research",
        title: "分析数据",
        summary: "开始",
        status: "RUNNING",
      },
    });
    const tool = event(2, {
      type: "tool",
      payload: {
        call_id: "call-1",
        tool_name: "research_kernel",
        title: "执行研究内核",
        summary: "查询中",
        status: "RUNNING",
        input: null,
        output: null,
        duration_ms: null,
        error_code: null,
      },
    });
    const terminal = event(4, {
      type: "terminal",
      payload: { status: "COMPLETED", summary: "完成", error_code: null },
    });
    expect(groupTrajectoryEvents([terminal, tool, progress])).toEqual([
      expect.objectContaining({ runId, toolCalls: 1, durationMs: 3000 }),
    ]);
  });

  it("marks an unfinished tool as interrupted when the Run is cancelled", () => {
    const tool = event(2, {
      type: "tool",
      payload: {
        call_id: "call-cancelled",
        tool_name: "research.kernel",
        title: "Research Kernel",
        summary: "执行中",
        status: "RUNNING",
        input: null,
        output: null,
        duration_ms: null,
        error_code: null,
      },
    });
    const cancelled = event(3, {
      type: "terminal",
      payload: { status: "CANCELLED", summary: "任务已取消", error_code: null },
    });

    expect(assembleProcessRows([tool, cancelled], runId)[0]).toMatchObject({
      status: "INTERRUPTED",
      summary: "工具调用已随 Run 中断",
    });
  });

  it("marks an unfinished reasoning summary as failed with its terminal Run", () => {
    const reasoning = event(2, {
      type: "reasoning",
      payload: { phase: "START", block_id: "reasoning-failed", title: "规划执行路径" },
    });
    const failed = event(3, {
      type: "terminal",
      payload: { status: "FAILED", summary: "执行失败", error_code: "TEAM_FAILED" },
    });

    expect(assembleProcessRows([reasoning, failed], runId)[0]).toMatchObject({
      kind: "reasoning",
      status: "FAILED",
      summary: "思考摘要未完成，Run 已失败",
    });
  });

  it("closes a preallocated PENDING Agent on Run failure with a public label", () => {
    const pending = teamEvent(1, "agent", {
      profile_id: "report-writing-agent",
      task_id: null,
      status: "PENDING",
      phase: "task.pending",
      title: "report-writing-agent",
      summary: "等待上游证据",
      duration_ms: null,
      error_code: null,
    });
    const failed = teamEvent(2, "terminal", {
      status: "FAILED",
      summary: "执行失败",
      error_code: "PROVIDER_FAILED",
    });
    const block = assembleConversationActivity([pending, failed], runId)[0];
    expect(block).toMatchObject({
      kind: "agent",
      agent: {
        title: "Report",
        taskId: null,
        status: "FAILED",
        errorCode: "PROVIDER_FAILED",
      },
    });
  });

  it("surfaces an accepted AnalysisReport once across replayed Subagent events", () => {
    const taskId = "22000000-0000-4000-8000-000000000002";
    const report = {
      artifact_id: "24000000-0000-4000-8000-000000000011",
      artifact_type: "AnalysisReport" as const,
      app_id: "24000000-0000-4000-8000-000000000012",
      tenant_id: "24000000-0000-4000-8000-000000000013",
      environment: "test" as const,
      run_id: runId,
      revision: 1,
      content_hash: `sha256:${"b".repeat(64)}` as const,
    };
    const completed = teamEvent(12, "tool", {
      call_id: "semantic-read-1",
      tool_name: "semantic.catalog.read",
      profile_id: "semantic-management-agent",
      task_id: taskId,
      title: "读取语义关系图",
      summary: "已生成受治理分析报告",
      status: "COMPLETED",
      input: null,
      output: "已读取冻结语义发布版本",
      duration_ms: 31,
      error_code: null,
      artifact_refs: [report],
    });
    const replayed = mergePublicRunEvents([completed], [completed]);
    const artifacts = assembleConversationActivity(replayed, runId).filter(
      (block) => block.kind === "artifact",
    );

    expect(artifacts).toEqual([
      expect.objectContaining({
        kind: "artifact",
        sequence: 12,
        reference: report,
      }),
    ]);
  });

  it("projects user, assistant and merged tool records for the draggable inspector", () => {
    const progress = event(1, {
      type: "progress",
      payload: {
        phase: "research",
        title: "分析问题",
        summary: "正在准备执行",
        status: "RUNNING",
      },
    });
    const toolStart = event(2, {
      type: "tool",
      payload: {
        call_id: "call-inspector",
        tool_name: "research.kernel",
        title: "研究内核",
        summary: "执行中",
        status: "RUNNING",
        input: "dataset=orders",
        output: null,
        duration_ms: null,
        error_code: null,
      },
    });
    const toolComplete = event(3, {
      type: "tool",
      payload: {
        call_id: "call-inspector",
        tool_name: "research.kernel",
        title: "研究内核",
        summary: "执行完成",
        status: "COMPLETED",
        input: null,
        output: "2 artifacts",
        duration_ms: 42,
        error_code: null,
      },
    });
    const answer = event(4, { type: "answer", payload: { delta: "结论" } });
    const terminal = event(5, {
      type: "terminal",
      payload: { status: "COMPLETED", summary: "完成", error_code: null },
    });
    const messages: Message[] = [
      {
        id: "message-user",
        conversationId: "30000000-0000-4000-8000-000000000001",
        role: "user",
        content: "分析订单",
        type: "text",
        createdAt: "2026-08-14T00:00:00.000Z",
      },
      {
        id: "message-assistant",
        conversationId: "30000000-0000-4000-8000-000000000001",
        role: "agent",
        content: "结论",
        type: "text",
        runId,
        createdAt: "2026-08-14T00:00:06.000Z",
      },
    ];

    const records = buildTrajectoryRecords(
      [progress, toolStart, toolComplete, answer, terminal],
      messages,
    );
    expect(records.map((record) => record.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
      "system",
    ]);
    expect(records.find((record) => record.role === "tool")).toMatchObject({
      sequences: [2, 3],
      payload: { input: "dataset=orders" },
      result: { output: "2 artifacts", duration_ms: 42 },
    });
    expect(records.find((record) => record.eventType === "message.assistant")).toMatchObject({
      result: { content: "结论", type: "text" },
    });
  });
});
