import {
  type AgentTurnPort,
  type AgentTurnRequest,
  type AgentTurnResult,
  agentTurnResultSchema,
  isAuthoritativeAgentTurnRequest,
  type PortResult,
  SEMANTIC_AUTHORING_POLICY_VERSION,
  SEMANTIC_FORMULA_AST_VERSION,
  type SemanticAuthoringCompleteInput,
  type SemanticAuthoringState,
  type SemanticAuthoringToolCall,
  sha256ContentHash,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  createSemanticAuthoringOrchestrator,
  InMemorySemanticAuthoringStore,
} from "../src/authoring/index.js";
import { createSemanticGraphV2Fixture } from "./fixtures/semantic-graph-v2.js";

const responseDigest = `sha256:${"f".repeat(64)}` as const;
const now = () => "2026-08-15T00:00:00.000Z";

function uuidFactory(): () => string {
  let counter = 1;
  return () => `10000000-0000-4000-8000-${(counter++).toString(16).padStart(12, "0")}`;
}

function toolResult(toolCalls: readonly SemanticAuthoringToolCall[]): AgentTurnResult {
  return agentTurnResultSchema.parse({
    terminal: "TOOL_CALLS",
    response_digest: responseDigest,
    assistant_text: "",
    tool_calls: JSON.parse(JSON.stringify(toolCalls)),
    usage: { input_tokens: 10, output_tokens: 10, tool_calls: toolCalls.length },
  });
}

class ScriptedAgent implements AgentTurnPort {
  readonly requests: AgentTurnRequest[] = [];
  #index = 0;

  constructor(
    private readonly steps: readonly ((
      request: AgentTurnRequest,
    ) => AgentTurnResult | Promise<AgentTurnResult>)[],
  ) {}

  async turn(input: Parameters<AgentTurnPort["turn"]>[0]): Promise<AgentTurnResult> {
    expect(isAuthoritativeAgentTurnRequest(input)).toBe(true);
    this.requests.push(input);
    const step = this.steps[this.#index++];
    if (step === undefined) throw new Error("missing scripted Agent turn");
    return step(input);
  }
}

function startInput(baseGraph = createSemanticGraphV2Fixture()) {
  return {
    schema_version: "semantic-authoring-start@1.0.0" as const,
    scope: baseGraph.metadata.scope,
    semantic_domain: "ecommerce",
    authoring_run_id: "00000000-0000-4000-8000-000000000301",
    candidate_id: "00000000-0000-4000-8000-000000000302",
    principal_id: "00000000-0000-4000-8000-000000000303",
    policy_version: SEMANTIC_AUTHORING_POLICY_VERSION,
    base_release_id: null,
    base_graph: baseGraph,
    instruction: "新增成交商品数",
    budget: { max_turns: 12, max_tool_calls: 32 },
    idempotency_key: "semantic-authoring-test-001",
  };
}

function call(
  toolCallId: string,
  toolName: SemanticAuthoringToolCall["tool_name"],
  argumentsValue: unknown,
): SemanticAuthoringToolCall {
  return {
    tool_call_id: toolCallId,
    tool_name: toolName,
    arguments: argumentsValue,
  } as SemanticAuthoringToolCall;
}

function completionFromRequest(request: AgentTurnRequest): AgentTurnResult {
  const lastValidation = [...request.messages]
    .reverse()
    .find((message) => message.role === "tool" && message.tool_name === "validate_semantic_graph");
  if (lastValidation?.role !== "tool") throw new Error("validation result missing");
  const parsed = JSON.parse(lastValidation.content) as {
    validation: { graph_digest: string; receipt_digest: string };
  };
  return toolResult([
    call("complete", "complete_authoring_run", {
      expected_graph_digest: parsed.validation.graph_digest,
      validation_receipt_digest: parsed.validation.receipt_digest,
      summary: "候选语义图已完成",
    }),
  ]);
}

describe("Semantic authoring Agent tool loop", () => {
  it("creates Metric, Formula and explicit Edges in one candidate before review", async () => {
    const base = createSemanticGraphV2Fixture();
    base.nodes = base.nodes.filter(
      (node) => !["metric-product-count", "formula-product-count"].includes(node.node_id),
    );
    base.edges = base.edges.filter(
      (edge) =>
        !["metric-product-count", "formula-product-count"].includes(edge.source_node_id) &&
        !["metric-product-count", "formula-product-count"].includes(edge.target_node_id),
    );
    const common = {
      node_version: 1,
      aliases: [],
      owner_ref: "semantic-agent",
      lifecycle: "ACTIVE" as const,
      evidence_refs: [],
      tags: [],
    };
    const metric = {
      ...common,
      node_id: "metric-product-count",
      node_type: "METRIC" as const,
      name: "成交商品数",
      unit: {
        unit_id: "unit-count",
        dimension: "count",
        base_unit: null,
        conversion_factor: null,
      },
      additivity: "non-additive" as const,
      null_policy: "exclude" as const,
      fanout_policy: "reject" as const,
    };
    const formula = {
      ...common,
      node_id: "formula-product-count",
      node_type: "FORMULA" as const,
      name: "成交商品数公式",
      formula_type: "non_additive_aggregate" as const,
      return_type: "integer" as const,
      language: "semantic-ast" as const,
      language_version: SEMANTIC_FORMULA_AST_VERSION,
      expression: {
        kind: "AGGREGATE" as const,
        function: "COUNT_DISTINCT" as const,
        input: { kind: "SLOT" as const, slot_id: "product" },
        distinct: true,
        filter: null,
      },
    };
    const agent = new ScriptedAgent([
      () =>
        toolResult([
          call("search-metric", "search_semantic_nodes", {
            query: "成交商品数",
            node_types: ["METRIC"],
            limit: 10,
          }),
        ]),
      () =>
        toolResult([
          call("create-metric", "create_semantic_node", { node: metric }),
          call("search-formula", "search_semantic_nodes", {
            query: "成交商品数公式",
            node_types: ["FORMULA"],
            limit: 10,
          }),
        ]),
      () =>
        toolResult([
          call("create-formula", "create_semantic_node", { node: formula }),
          call("read-subject", "read_semantic_node", { node_id: "subject-order-line" }),
          call("read-metric", "read_semantic_node", { node_id: "metric-product-count" }),
          call("read-formula", "read_semantic_node", { node_id: "formula-product-count" }),
          call("read-column", "read_semantic_node", {
            node_id: "column-order-item-product-id",
          }),
        ]),
      () =>
        toolResult([
          call("edge-subject-metric", "create_semantic_edge", {
            edge: {
              edge_id: "edge-subject-metric",
              edge_version: 1,
              edge_type: "HAS_METRIC",
              family: "ANALYTICAL",
              source_node_id: "subject-order-line",
              target_node_id: "metric-product-count",
              lifecycle: "ACTIVE",
              attributes: { kind: "NONE" },
              evidence_refs: [],
            },
          }),
          call("edge-metric-formula", "create_semantic_edge", {
            edge: {
              edge_id: "edge-metric-formula",
              edge_version: 1,
              edge_type: "DEFINED_BY",
              family: "FORMULA",
              source_node_id: "metric-product-count",
              target_node_id: "formula-product-count",
              lifecycle: "ACTIVE",
              attributes: { kind: "NONE" },
              evidence_refs: [],
            },
          }),
          call("edge-formula-reference", "create_semantic_edge", {
            edge: {
              edge_id: "edge-formula-reference",
              edge_version: 1,
              edge_type: "REFERENCES",
              family: "FORMULA",
              source_node_id: "formula-product-count",
              target_node_id: "column-order-item-product-id",
              lifecycle: "ACTIVE",
              attributes: { kind: "SLOT_BINDING", slot_id: "product", role: "MEASURE" },
              evidence_refs: [],
            },
          }),
          call("edge-formula-grain", "create_semantic_edge", {
            edge: {
              edge_id: "edge-formula-grain",
              edge_version: 1,
              edge_type: "AT_GRAIN",
              family: "ANALYTICAL",
              source_node_id: "formula-product-count",
              target_node_id: "subject-order-line",
              lifecycle: "ACTIVE",
              attributes: {
                kind: "GRAIN_BINDING",
                grain: { grain_id: "grain-order-line", granularity: "atomic" },
                time_domain: null,
              },
              evidence_refs: [],
            },
          }),
        ]),
      () => toolResult([call("validate", "validate_semantic_graph", {})]),
      completionFromRequest,
    ]);
    const ids = uuidFactory();
    const store = new InMemorySemanticAuthoringStore({ now, new_id: ids });
    const orchestrator = createSemanticAuthoringOrchestrator({
      agent,
      store,
      now,
      new_id: ids,
    });

    const result = await orchestrator.startAndRun(startInput(base));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.run.status).toBe("READY_FOR_REVIEW");
    expect(result.value.run.working_revision).toBe(6);
    expect(result.value.working_graph.nodes.map((node) => node.node_id)).toContain(
      "metric-product-count",
    );
    expect(result.value.working_graph.edges.map((edge) => edge.edge_id)).toContain(
      "edge-metric-formula",
    );
    const events = await store.listEvents({
      scope: base.metadata.scope,
      semantic_domain: "ecommerce",
      authoring_run_id: startInput(base).authoring_run_id,
    });
    expect(events.ok && events.value.filter((entry) => entry.type === "graph_patch")).toHaveLength(
      6,
    );
  });

  it("reads formula dependencies before an exact CAS update and impact validation", async () => {
    const base = createSemanticGraphV2Fixture();
    const formula = base.nodes.find((node) => node.node_id === "formula-product-count");
    if (formula?.node_type !== "FORMULA") throw new Error("formula fixture missing");
    const expectedDigest = await sha256ContentHash(formula);
    const updated = {
      ...formula,
      node_version: 2,
      expression: {
        ...formula.expression,
        filter: {
          kind: "BINARY" as const,
          operator: "NEQ" as const,
          left: { kind: "SLOT" as const, slot_id: "product" },
          right: { kind: "LITERAL" as const, value: "" },
        },
      },
    };
    const agent = new ScriptedAgent([
      () =>
        toolResult([
          call("read-deps", "read_formula_dependencies", {
            formula_node_id: "formula-product-count",
          }),
        ]),
      () =>
        toolResult([
          call("update-formula", "update_semantic_node", {
            node: updated,
            expected_node_version: 1,
            expected_entry_digest: expectedDigest,
          }),
        ]),
      () =>
        toolResult([
          call("impact", "analyze_semantic_impact", {}),
          call("validate", "validate_semantic_graph", {}),
        ]),
      completionFromRequest,
    ]);
    const ids = uuidFactory();
    const store = new InMemorySemanticAuthoringStore({ now, new_id: ids });
    const result = await createSemanticAuthoringOrchestrator({
      agent,
      store,
      now,
      new_id: ids,
    }).startAndRun({ ...startInput(base), instruction: "只统计已支付订单" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.run.status).toBe("READY_FOR_REVIEW");
    expect(
      result.value.working_graph.nodes.find((node) => node.node_id === "formula-product-count")
        ?.node_version,
    ).toBe(2);
  });

  it("keeps the exact pending request for provider retry without duplicate mutation", async () => {
    const base = createSemanticGraphV2Fixture();
    let failed = false;
    const delegate = new ScriptedAgent([
      () => ({
        terminal: "FINAL",
        response_digest: responseDigest,
        assistant_text: "done",
        usage: { input_tokens: 1, output_tokens: 1, tool_calls: 0 },
      }),
    ]);
    const agent: AgentTurnPort = {
      async turn(input) {
        if (!failed) {
          failed = true;
          throw new Error("temporary provider error");
        }
        return delegate.turn(input);
      },
    };
    const ids = uuidFactory();
    const store = new InMemorySemanticAuthoringStore({ now, new_id: ids });
    const orchestrator = createSemanticAuthoringOrchestrator({ agent, store, now, new_id: ids });
    const first = await orchestrator.startAndRun(startInput(base));
    expect(first).toMatchObject({ ok: false, error: { retryable: true } });
    const loaded = await store.load({
      scope: base.metadata.scope,
      semantic_domain: "ecommerce",
      authoring_run_id: startInput(base).authoring_run_id,
    });
    if (!loaded.ok || loaded.value === null) throw new Error("run missing");
    const pendingRequestId = loaded.value.checkpoint.pending_agent_request?.request_id;
    const second = await orchestrator.continueRun(loaded.value);
    expect(second.ok && second.value.run.status).toBe("FAILED");
    expect(delegate.requests[0]?.request_id).toBe(pendingRequestId);
    expect(loaded.value.run.working_revision).toBe(0);
  });

  it("recovers a committed complete tool without invoking the model or duplicating mutation", async () => {
    class FlakyCompleteStore extends InMemorySemanticAuthoringStore {
      failOnce = true;

      override async complete(
        input: SemanticAuthoringCompleteInput,
      ): Promise<PortResult<SemanticAuthoringState>> {
        if (this.failOnce) {
          this.failOnce = false;
          return {
            ok: false,
            error: {
              code: "SEMANTIC_AUTHORING_COMPLETE_TEMPORARY",
              message: "temporary",
              retryable: true,
            },
          };
        }
        return super.complete(input);
      }
    }
    const base = createSemanticGraphV2Fixture();
    const agent = new ScriptedAgent([
      () => toolResult([call("validate", "validate_semantic_graph", {})]),
      completionFromRequest,
    ]);
    const ids = uuidFactory();
    const store = new FlakyCompleteStore({ now, new_id: ids });
    const orchestrator = createSemanticAuthoringOrchestrator({ agent, store, now, new_id: ids });
    const first = await orchestrator.startAndRun(startInput(base));
    expect(first).toMatchObject({
      ok: false,
      error: { code: "SEMANTIC_AUTHORING_COMPLETE_TEMPORARY" },
    });
    const loaded = await store.load({
      scope: base.metadata.scope,
      semantic_domain: "ecommerce",
      authoring_run_id: startInput(base).authoring_run_id,
    });
    if (!loaded.ok || loaded.value === null) throw new Error("run missing");
    expect(loaded.value.checkpoint.messages.at(-1)).toMatchObject({
      role: "tool",
      tool_name: "complete_authoring_run",
    });
    const recovered = await orchestrator.continueRun(loaded.value);
    expect(recovered.ok && recovered.value.run.status).toBe("READY_FOR_REVIEW");
    expect(agent.requests).toHaveLength(2);
    expect(recovered.ok && recovered.value.run.working_revision).toBe(0);
  });

  it("fails closed when a create skips search and records no mutation", async () => {
    const base = createSemanticGraphV2Fixture();
    const existing = base.nodes.find((node) => node.node_id === "metric-product-count");
    if (existing?.node_type !== "METRIC") throw new Error("metric fixture missing");
    const agent = new ScriptedAgent([
      () =>
        toolResult([
          call("unsafe-create", "create_semantic_node", {
            node: { ...existing, node_id: "metric-unsafe", name: "未搜索指标" },
          }),
        ]),
    ]);
    const ids = uuidFactory();
    const store = new InMemorySemanticAuthoringStore({ now, new_id: ids });
    const result = await createSemanticAuthoringOrchestrator({
      agent,
      store,
      now,
      new_id: ids,
    }).startAndRun(startInput(base));
    expect(result.ok && result.value.run.status).toBe("FAILED");
    if (!result.ok) return;
    expect(result.value.run.working_revision).toBe(0);
    expect(result.value.working_graph.nodes.some((node) => node.node_id === "metric-unsafe")).toBe(
      false,
    );
  });
});
