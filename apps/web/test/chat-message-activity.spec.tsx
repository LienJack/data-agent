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
  });
});
