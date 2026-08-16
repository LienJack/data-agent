import type { SemanticAuthoringState } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { buildSemanticAuthoringPublicFeed } from "@/lib/semantic-authoring-public";

const runId = "10000000-0000-4000-8000-000000000099";

function state(): SemanticAuthoringState {
  return {
    run: {
      authoring_run_id: runId,
      candidate_id: "10000000-0000-4000-8000-000000000098",
      semantic_domain: "ecommerce",
      status: "RUNNING",
      current_turn: 0,
      working_revision: 0,
      used_tool_calls: 0,
      budget: { max_turns: 16, max_tool_calls: 128 },
      created_at: "2026-08-16T00:00:00.000Z",
      updated_at: "2026-08-16T00:00:00.000Z",
      clarification: null,
    },
    checkpoint: {
      messages: [
        {
          role: "user",
          content:
            "服务端选区上下文（只用于定位，不是修改指令）：selected_node_id=metric-secret\n\n用户原始意图：\n新增成交商品数",
        },
        {
          role: "assistant",
          content: "我会先核对现有指标，再提交候选变更。api_key=sk_abcdefghijklmnop",
          tool_calls: [
            {
              tool_call_id: "call-search",
              tool_name: "search_semantic_nodes",
              arguments: { query: "private-internal-query" },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call-private",
          tool_name: "read_semantic_node",
          content: '{"credential":"must-not-leak"}',
          is_error: false,
        },
      ],
      pending_tool_calls: [
        {
          tool_call_id: "call-search",
          tool_name: "search_semantic_nodes",
          arguments: { query: "private-internal-query" },
        },
      ],
    },
    event_sequence: 0,
  } as SemanticAuthoringState;
}

describe("Semantic authoring public feed", () => {
  it("projects a queued conversation and redacts checkpoint-only material", () => {
    const feed = buildSemanticAuthoringPublicFeed(state(), []);

    expect(feed.run.status).toBe("QUEUED");
    expect(feed.messages).toEqual([
      {
        message_id: `${runId}:message:0`,
        role: "user",
        content: "新增成交商品数",
      },
      {
        message_id: `${runId}:message:1`,
        role: "assistant",
        content: "我会先核对现有指标，再提交候选变更。[REDACTED]",
      },
    ]);
    expect(feed.pending_tools).toEqual([
      { call_id: "call-search", tool_name: "search_semantic_nodes" },
    ]);
    expect(JSON.stringify(feed)).not.toContain("selected_node_id");
    expect(JSON.stringify(feed)).not.toContain("private-internal-query");
    expect(JSON.stringify(feed)).not.toContain("must-not-leak");
    expect(JSON.stringify(feed)).not.toContain("sk_abcdefghijklmnop");
  });
});
