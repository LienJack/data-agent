import {
  type AgentTurnMessage,
  type AgentTurnPort,
  type AgentTurnResult,
  type AuthoritativeAgentTurnRequest,
  type AuthoritativeModelProviderInvocation,
  agentTurnResultSchema,
  isAuthoritativeAgentTurnRequest,
  isAuthoritativeModelProviderInvocation,
  type ModelProviderPort,
  type ModelProviderRequest,
  semanticAuthoringToolCallSchema,
} from "@data-agent/contracts";

export interface SemanticAgentTurnInvocationMaterial {
  readonly turn: AuthoritativeAgentTurnRequest;
  readonly messages: ModelProviderRequest["messages"];
  readonly tool_allowlist: readonly string[];
  readonly budget: ModelProviderRequest["budget"];
}

export type SemanticAgentTurnInvocationFactory = (
  input: SemanticAgentTurnInvocationMaterial,
) => Promise<AuthoritativeModelProviderInvocation>;

function providerMessages(messages: readonly AgentTurnMessage[]): ModelProviderRequest["messages"] {
  return messages.map((message) => {
    switch (message.role) {
      case "user":
        return { role: "user", content: message.content };
      case "assistant":
        return {
          role: "assistant",
          content: JSON.stringify({
            text: message.content,
            tool_calls: message.tool_calls,
          }),
        };
      case "tool":
        return {
          role: "tool",
          content: JSON.stringify({
            tool_name: message.tool_name,
            result: message.content,
            is_error: message.is_error,
          }),
          tool_call_id: message.tool_call_id,
        };
    }
    throw new Error("Unsupported AgentTurn message role.");
  });
}

function exactInvocation(
  turn: AuthoritativeAgentTurnRequest,
  invocation: AuthoritativeModelProviderInvocation,
  messages: ModelProviderRequest["messages"],
  toolAllowlist: readonly string[],
  budget: ModelProviderRequest["budget"],
): boolean {
  const sortedTools = [...toolAllowlist].sort();
  return (
    invocation.request_id === turn.request_id &&
    invocation.run_id === turn.authoring_run_id &&
    invocation.scope.app_id === turn.scope.app_id &&
    invocation.scope.tenant_id === turn.scope.tenant_id &&
    invocation.scope.environment === turn.scope.environment &&
    invocation.budget.timeout_ms === budget.timeout_ms &&
    invocation.budget.max_input_tokens === budget.max_input_tokens &&
    invocation.budget.max_output_tokens === budget.max_output_tokens &&
    invocation.budget.max_tool_calls === budget.max_tool_calls &&
    JSON.stringify(invocation.messages) === JSON.stringify(messages) &&
    JSON.stringify([...invocation.tool_allowlist].sort()) === JSON.stringify(sortedTools)
  );
}

/**
 * Provider-only AgentTurn adapter. It translates one authorized turn into one
 * authorized provider stream and returns proposed tool calls. It has no store,
 * reducer, database client, or tool executor and therefore cannot mutate Graph state.
 */
export class ModelProviderAgentTurnAdapter implements AgentTurnPort {
  readonly #provider: ModelProviderPort;
  readonly #createInvocation: SemanticAgentTurnInvocationFactory;

  constructor(options: {
    readonly provider: ModelProviderPort;
    readonly create_invocation: SemanticAgentTurnInvocationFactory;
  }) {
    this.#provider = options.provider;
    this.#createInvocation = options.create_invocation;
  }

  async turn(input: AuthoritativeAgentTurnRequest): Promise<AgentTurnResult> {
    if (!isAuthoritativeAgentTurnRequest(input)) {
      return {
        terminal: "FAILED",
        reason_code: "SEMANTIC_AGENT_TURN_NOT_AUTHORIZED",
        retryable: false,
      };
    }
    if (input.messages.length > 256) {
      return {
        terminal: "FAILED",
        reason_code: "SEMANTIC_AGENT_CONTEXT_LIMIT_EXCEEDED",
        retryable: false,
      };
    }
    const messages = providerMessages(input.messages);
    const toolAllowlist = input.tools.map((tool) => tool.name);
    const budget = {
      ...input.budget,
      max_tool_calls: 32,
    };
    const invocation = await this.#createInvocation({
      turn: input,
      messages,
      tool_allowlist: toolAllowlist,
      budget,
    });
    if (
      !isAuthoritativeModelProviderInvocation(invocation) ||
      !exactInvocation(input, invocation, messages, toolAllowlist, budget)
    ) {
      return {
        terminal: "FAILED",
        reason_code: "SEMANTIC_AGENT_PROVIDER_AUTHORITY_MISMATCH",
        retryable: false,
      };
    }

    const calls: Array<{
      tool_call_id: string;
      tool_name: string;
      arguments: unknown;
    }> = [];
    let terminal: Extract<AgentTurnResult, { terminal: "FINAL" | "FAILED" }> | null = null;
    for await (const event of this.#provider.stream(invocation)) {
      if (terminal !== null) {
        return {
          terminal: "FAILED",
          reason_code: "SEMANTIC_AGENT_PROVIDER_PROTOCOL_VIOLATION",
          retryable: false,
        };
      }
      if (event.event_type === "TOOL_CALL_CANDIDATE") {
        calls.push({
          tool_call_id: event.tool_call_id,
          tool_name: event.tool_name,
          arguments: event.arguments,
        });
      } else if (event.event_type === "FAILED") {
        terminal = {
          terminal: "FAILED",
          reason_code: event.reason_code,
          retryable: event.retryable,
        };
      } else if (event.event_type === "COMPLETED") {
        if (calls.length === 0) {
          terminal = {
            terminal: "FINAL",
            response_digest: event.response_hash,
            assistant_text: event.output_text,
            usage: event.usage,
          };
        } else {
          const parsed = calls.map((call) => semanticAuthoringToolCallSchema.safeParse(call));
          if (parsed.some((result) => !result.success)) {
            return {
              terminal: "FAILED",
              reason_code: "SEMANTIC_AGENT_TOOL_CALL_INVALID",
              retryable: false,
            };
          }
          return agentTurnResultSchema.parse({
            terminal: "TOOL_CALLS",
            response_digest: event.response_hash,
            assistant_text: event.output_text,
            tool_calls: JSON.parse(
              JSON.stringify(parsed.flatMap((result) => (result.success ? [result.data] : []))),
            ),
            usage: event.usage,
          });
        }
      }
    }
    return (
      terminal ?? {
        terminal: "FAILED",
        reason_code: "SEMANTIC_AGENT_PROVIDER_PROTOCOL_VIOLATION",
        retryable: false,
      }
    );
  }
}
