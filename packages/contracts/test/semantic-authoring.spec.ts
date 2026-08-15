import { describe, expect, it } from "vitest";
import {
  authorizeAgentTurnRequest,
  SEMANTIC_AGENT_TURN_VERSION,
  SEMANTIC_AUTHORING_POLICY_VERSION,
  SEMANTIC_AUTHORING_RUN_VERSION,
  semanticAuthoringPublicEventSchema,
  semanticAuthoringRunSchema,
  semanticAuthoringToolCallSchema,
} from "../src/artifacts/semantic-authoring.js";

const scope = {
  app_id: "00000000-0000-4000-8000-00000000da01",
  tenant_id: "00000000-0000-4000-8000-000000000101",
  environment: "test" as const,
};

describe("semantic authoring contracts", () => {
  it("brands an exact server-owned AgentTurn request", () => {
    const request = authorizeAgentTurnRequest(
      {
        schema_version: SEMANTIC_AGENT_TURN_VERSION,
        request_id: "00000000-0000-4000-8000-000000000102",
        scope,
        authoring_run_id: "00000000-0000-4000-8000-000000000103",
        candidate_id: "00000000-0000-4000-8000-000000000104",
        principal_id: "00000000-0000-4000-8000-000000000105",
        policy_version: SEMANTIC_AUTHORING_POLICY_VERSION,
        turn_index: 1,
        messages: [{ role: "user", content: "新增成交商品数" }],
        tools: [
          {
            name: "search_semantic_nodes",
            description: "搜索节点",
            input_schema: { type: "object" },
          },
        ],
        budget: { timeout_ms: 30_000, max_input_tokens: 4_000, max_output_tokens: 2_000 },
      },
      {
        scope,
        authoring_run_id: "00000000-0000-4000-8000-000000000103",
        candidate_id: "00000000-0000-4000-8000-000000000104",
        principal_id: "00000000-0000-4000-8000-000000000105",
        policy_version: SEMANTIC_AUTHORING_POLICY_VERSION,
        tool_names: ["search_semantic_nodes"],
      },
    );
    expect(Object.isFrozen(request)).toBe(true);
  });

  it("rejects capability expansion and forbidden publish/raw SQL tools", () => {
    expect(() =>
      semanticAuthoringToolCallSchema.parse({
        tool_call_id: "call-1",
        tool_name: "publish_semantic_release",
        arguments: {},
      }),
    ).toThrow();
    expect(() =>
      semanticAuthoringToolCallSchema.parse({
        tool_call_id: "call-2",
        tool_name: "execute_sql",
        arguments: { sql: "drop table orders" },
      }),
    ).toThrow();
  });

  it("rejects Agent fabrication of physical Nodes at the tool boundary", () => {
    expect(() =>
      semanticAuthoringToolCallSchema.parse({
        tool_call_id: "call-3",
        tool_name: "create_semantic_node",
        arguments: {
          node: {
            node_id: "table-forged",
            node_version: 1,
            node_type: "PHYSICAL_TABLE",
            name: "forged",
            aliases: [],
            owner_ref: "agent",
            lifecycle: "ACTIVE",
            evidence_refs: [],
            tags: [],
            schema_snapshot_id: "00000000-0000-4000-8000-000000000106",
            snapshot_content_hash: `sha256:${"a".repeat(64)}`,
            datasource_id: "00000000-0000-4000-8000-000000000107",
            schema_name: "public",
            table_name: "forged",
            relation_kind: "TABLE",
          },
        },
      }),
    ).toThrow();
  });

  it("lets Agent search physical evidence and author glossary terms", () => {
    expect(
      semanticAuthoringToolCallSchema.parse({
        tool_call_id: "call-search-ontology",
        tool_name: "search_semantic_nodes",
        arguments: {
          query: "product_id",
          node_types: ["PHYSICAL_TABLE", "PHYSICAL_COLUMN", "GLOSSARY_TERM"],
          limit: 20,
        },
      }).tool_name,
    ).toBe("search_semantic_nodes");
    expect(
      semanticAuthoringToolCallSchema.parse({
        tool_call_id: "call-create-term",
        tool_name: "create_semantic_node",
        arguments: {
          node: {
            node_id: "term-fanout",
            node_version: 1,
            node_type: "GLOSSARY_TERM",
            name: "扇出",
            description: "Join 后事实行被复制的风险。",
            aliases: ["fanout"],
            owner_ref: "semantic-agent",
            lifecycle: "ACTIVE",
            evidence_refs: [],
            tags: ["分析术语"],
            definition: "Join 后一行事实被复制为多行并导致指标重复累计的风险。",
            language: "zh-CN",
            term_kind: "ANALYTICAL",
            abbreviation: null,
          },
        },
      }).tool_name,
    ).toBe("create_semantic_node");
  });

  it("keeps READY_FOR_REVIEW separate from publish authority", () => {
    const run = semanticAuthoringRunSchema.parse({
      schema_version: SEMANTIC_AUTHORING_RUN_VERSION,
      authority: "POSTGRESQL",
      scope,
      semantic_domain: "ecommerce",
      authoring_run_id: "00000000-0000-4000-8000-000000000103",
      candidate_id: "00000000-0000-4000-8000-000000000104",
      graph_id: "00000000-0000-4000-8000-000000000108",
      base_release_id: null,
      principal_id: "00000000-0000-4000-8000-000000000105",
      policy_version: SEMANTIC_AUTHORING_POLICY_VERSION,
      status: "READY_FOR_REVIEW",
      working_revision: 3,
      graph_digest: `sha256:${"b".repeat(64)}`,
      writer_fence: 1,
      current_turn: 2,
      pending_request_digest: null,
      used_tool_calls: 5,
      budget: { max_turns: 8, max_tool_calls: 32 },
      validation_receipt_digest: `sha256:${"c".repeat(64)}`,
      clarification: null,
      created_at: "2026-08-15T00:00:00.000Z",
      updated_at: "2026-08-15T00:01:00.000Z",
    });
    expect(run.status).toBe("READY_FOR_REVIEW");
    expect("publish" in run).toBe(false);
  });

  it("provides typed graph patch and clarification events for one SSE protocol", () => {
    expect(
      semanticAuthoringPublicEventSchema.parse({
        schema_version: "semantic-authoring-public-event@1.0.0",
        event_id: "00000000-0000-4000-8000-000000000109",
        run_id: "00000000-0000-4000-8000-000000000103",
        sequence: 7,
        occurred_at: "2026-08-15T00:01:00.000Z",
        type: "graph_patch",
        payload: {
          patch_id: "00000000-0000-4000-8000-000000000110",
          from_working_revision: 2,
          to_working_revision: 3,
          before_digest: `sha256:${"d".repeat(64)}`,
          after_digest: `sha256:${"e".repeat(64)}`,
          operation_count: 1,
          affected_node_ids: ["metric-product-count"],
          affected_edge_ids: [],
        },
      }).type,
    ).toBe("graph_patch");

    expect(
      semanticAuthoringPublicEventSchema.parse({
        schema_version: "semantic-authoring-public-event@1.0.0",
        event_id: "00000000-0000-4000-8000-000000000111",
        run_id: "00000000-0000-4000-8000-000000000103",
        sequence: 8,
        occurred_at: "2026-08-15T00:01:01.000Z",
        type: "clarification",
        payload: {
          clarification_id: "00000000-0000-4000-8000-000000000112",
          question: "已有相似指标，是否复用？",
          options: ["复用", "新建"],
          status: "WAITING",
        },
      }).type,
    ).toBe("clarification");
  });
});
