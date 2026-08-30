import { publicRunEventSchema } from "@data-agent/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatMessage } from "@/components/qa/chat-message";

describe("ChatMessage activity ownership", () => {
  it("does not duplicate a Run activity stream on a user message carrying run_id", () => {
    const runId = "10000000-0000-4000-8000-000000000001";
    const answer = publicRunEventSchema.parse({
      schema_version: "public-run-event@1.0.0",
      event_id: "20000000-0000-4000-8000-000000000001",
      run_id: runId,
      sequence: 1,
      occurred_at: "2026-08-21T00:00:00.000Z",
      type: "answer",
      payload: { delta: "不应出现在用户消息中" },
    });
    const html = renderToStaticMarkup(
      <ChatMessage
        message={{
          id: "30000000-0000-4000-8000-000000000001",
          conversationId: "30000000-0000-4000-8000-000000000002",
          role: "user",
          runId,
          content: "统计数据库表数量",
          type: "text",
          createdAt: "2026-08-21T00:00:00.000Z",
        }}
        events={[answer]}
      />,
    );
    expect(html).toContain("统计数据库表数量");
    expect(html).not.toContain("不应出现在用户消息中");
    expect(html).not.toContain("Data Agent");
    expect(html).not.toContain(`id="chat-run-${runId}"`);
  });

  it("keeps user Markdown as plain text", () => {
    const html = renderToStaticMarkup(
      <ChatMessage
        message={{
          id: "30000000-0000-4000-8000-000000000003",
          conversationId: "30000000-0000-4000-8000-000000000004",
          role: "user",
          content: "# 用户标题 **不是富文本**",
          type: "text",
          createdAt: "2026-08-21T00:00:00.000Z",
        }}
      />,
    );
    expect(html).toContain("# 用户标题 **不是富文本**");
    expect(html).not.toContain("<h2");
    expect(html).not.toContain("<strong");
  });

  it("renders a DIRECT rich answer without any Subagent DOM", () => {
    const runId = "10000000-0000-4000-8000-000000000011";
    const events = [
      publicRunEventSchema.parse({
        schema_version: "public-run-event@1.0.0",
        event_id: "20000000-0000-4000-8000-000000000011",
        run_id: runId,
        sequence: 1,
        occurred_at: "2026-08-21T00:00:00.000Z",
        type: "answer",
        payload: { delta: "# 直接回答\n\n无需调用子任务。" },
      }),
      publicRunEventSchema.parse({
        schema_version: "public-run-event@1.0.0",
        event_id: "20000000-0000-4000-8000-000000000012",
        run_id: runId,
        sequence: 2,
        occurred_at: "2026-08-21T00:00:01.000Z",
        type: "terminal",
        payload: { status: "COMPLETED", summary: "完成", error_code: null },
      }),
    ];
    const html = renderToStaticMarkup(
      <ChatMessage
        message={{
          id: "30000000-0000-4000-8000-000000000011",
          conversationId: "30000000-0000-4000-8000-000000000012",
          role: "agent",
          runId,
          content: "直接回答",
          type: "text",
          createdAt: "2026-08-21T00:00:02.000Z",
        }}
        events={events}
      />,
    );
    expect(html).toContain("直接回答</h2>");
    expect(html).not.toContain("子代理");
    expect(html).not.toContain("qa-subagent-");
    expect(html).toContain('data-testid="qa-result-trace-entry"');
    expect(html).toContain(`data-run-id="${runId}"`);
    expect(html).toContain('data-terminal-status="COMPLETED"');
    expect(html).toContain(`id="chat-run-${runId}"`);
  });
});
