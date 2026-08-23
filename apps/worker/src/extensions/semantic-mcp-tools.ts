import {
  type PortResult,
  type SemanticMcpToolCall,
  semanticMcpToolCallSchema,
} from "@data-agent/contracts";

export interface SemanticMcpToolServices {
  readonly list_metrics: (input: {
    readonly capability: unknown;
    readonly semantic_domain: string;
  }) => Promise<PortResult<unknown>>;
  readonly describe_semantic_model: (input: {
    readonly capability: unknown;
    readonly semantic_domain: string;
  }) => Promise<PortResult<unknown>>;
  readonly resolve_context: (input: {
    readonly capability: unknown;
  }) => Promise<PortResult<unknown>>;
  readonly graph_traversal: (input: {
    readonly capability: unknown;
    readonly request: Extract<SemanticMcpToolCall, { tool_name: "graph_traversal" }>["arguments"];
  }) => Promise<PortResult<unknown>>;
  readonly query: (input: {
    readonly capability: unknown;
    readonly query_contract_ref: Extract<
      SemanticMcpToolCall,
      { tool_name: "query" }
    >["arguments"]["query_contract_ref"];
    readonly semantic_context_binding: Extract<
      SemanticMcpToolCall,
      { tool_name: "query" }
    >["arguments"]["semantic_context_binding"];
  }) => Promise<PortResult<unknown>>;
}

export function createSemanticMcpToolExecutor(services: SemanticMcpToolServices) {
  return Object.freeze({
    async execute(capability: unknown, input: unknown): Promise<PortResult<unknown>> {
      const call = semanticMcpToolCallSchema.safeParse(input);
      if (!call.success) {
        return {
          ok: false,
          error: {
            code: "SEMANTIC_MCP_TOOL_CALL_INVALID",
            message: "Semantic MCP tool call is invalid.",
            retryable: false,
          },
        };
      }
      switch (call.data.tool_name) {
        case "list_metrics":
          return services.list_metrics({
            capability,
            semantic_domain: call.data.arguments.semantic_domain,
          });
        case "describe_semantic_model":
          return services.describe_semantic_model({
            capability,
            semantic_domain: call.data.arguments.semantic_domain,
          });
        case "resolve_context":
          return services.resolve_context({ capability });
        case "graph_traversal":
          return services.graph_traversal({ capability, request: call.data.arguments });
        case "query":
          return services.query({
            capability,
            query_contract_ref: call.data.arguments.query_contract_ref,
            semantic_context_binding: call.data.arguments.semantic_context_binding,
          });
      }
    },
  });
}
