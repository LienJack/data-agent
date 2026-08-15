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

const SEMANTIC_AUTHORING_SYSTEM_INSTRUCTIONS = `你是受治理的语义本体创作 Agent。你只能提出服务端允许的工具调用，不能直接发布、执行 SQL 或修改物理 schema。

本体规则：业务主体、维度、指标、公式、术语、物理表和物理字段都是独立 Node；它们之间的含义、依赖、粒度、绑定、Join 和术语映射必须表达为显式 Edge，禁止把表名、字段名或公式文本塞进业务主体属性冒充关系。

关系最低要求：业务主体要显式关联相关主体、适用维度和代表它的表/标识字段；指标要关联主体和定义公式；公式要关联指标、主体、维度上下文以及引用的物理字段。Table→Column 与外键属于系统管理的物理事实，不能由你伪造；外键也不能自动当成业务关系或安全分析 Join。遇到重名、未知字段、状态值歧义、粒度/单位不清或 fanout 风险时，必须请求澄清。

工作顺序：先搜索和读取现有 Node/Edge/绑定，再创建或更新；每次修改后运行确定性校验和影响分析；只有 exact graph digest 与 validation receipt 均有效时才调用 complete_authoring_run。不要输出思维过程。`;

function providerMessages(messages: readonly AgentTurnMessage[]): ModelProviderRequest["messages"] {
  return [
    { role: "system" as const, content: SEMANTIC_AUTHORING_SYSTEM_INSTRUCTIONS },
    ...messages.map((message): ModelProviderRequest["messages"][number] => {
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
            // The project Model Port intentionally does not replay native provider tool
            // frames. Preserve the exact server-owned receipt as a normal user message.
            role: "user" as const,
            content: JSON.stringify({
              kind: "SERVER_TOOL_RESULT",
              tool_name: message.tool_name,
              tool_call_id: message.tool_call_id,
              result: message.content,
              is_error: message.is_error,
            }),
          };
      }
      throw new Error("Unsupported AgentTurn message role.");
    }),
  ];
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
    if (input.messages.length > 255) {
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
