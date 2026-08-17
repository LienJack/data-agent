import { describe, expect, it, vi } from "vitest";
import { createSemanticMcpToolExecutor } from "../../src/extensions/semantic-mcp-tools.js";

const success = { ok: true as const, value: { source: "existing-authority" } };

function services() {
  return {
    list_metrics: vi.fn(async () => success),
    describe_semantic_model: vi.fn(async () => success),
    resolve_context: vi.fn(async () => success),
    graph_traversal: vi.fn(async () => success),
    query: vi.fn(async () => success),
  };
}

describe("Semantic MCP tools", () => {
  it.each([
    ["list_metrics", { semantic_domain: "commerce" }, "list_metrics"],
    ["describe_semantic_model", { semantic_domain: "commerce" }, "describe_semantic_model"],
    ["resolve_context", {}, "resolve_context"],
    [
      "graph_traversal",
      {
        schema_version: "semantic-relationship-search-request@1.0.0",
        semantic_domain: "commerce",
        release: { kind: "ACTIVE" },
        root: null,
        term: "net_revenue",
        direction: "both",
        categories: ["BIZ"],
        hop_limit: 2,
        node_limit: 50,
        edge_limit: 100,
      },
      "graph_traversal",
    ],
  ] as const)("adapts %s to the existing service", async (toolName, args, serviceName) => {
    const ports = services();
    const executor = createSemanticMcpToolExecutor(ports);
    await expect(
      executor.execute({ authority: "test" }, { tool_name: toolName, arguments: args }),
    ).resolves.toEqual(success);
    expect(ports[serviceName]).toHaveBeenCalledTimes(1);
  });

  it("rejects raw SQL before the query service", async () => {
    const ports = services();
    const executor = createSemanticMcpToolExecutor(ports);
    await expect(
      executor.execute({}, { tool_name: "query", arguments: { sql: "select * from secrets" } }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "SEMANTIC_MCP_TOOL_CALL_INVALID" },
    });
    expect(ports.query).not.toHaveBeenCalled();
  });
});
