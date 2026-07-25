import {
  type AppScope,
  type AuthoritativeModelProviderInvocation,
  canonicalizeJson,
  type ModelProvider,
} from "@data-agent/contracts";
import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  getModelProviderBinding,
  MODEL_PROVIDER_BINDINGS,
  type ModelProviderBinding,
} from "../models/bindings.js";
import { createProviderRuntimeModel } from "../models/provider-model-factory.js";
import {
  EMPTY_SERVER_TOOL_REGISTRY,
  type ServerOwnedToolDescriptor,
  type ServerOwnedToolRegistry,
  ToolRegistryError,
} from "../tools/index.js";
import { MastraExecutionError } from "./errors.js";
import type { ModelExecutionBridge, ModelExecutionChunk } from "./execution-bridge.js";
import {
  EMPTY_SERVER_MODEL_RESPONSE_SCHEMA_REGISTRY,
  type RegisteredServerModelResponseSchema,
  type ServerModelResponseSchemaRegistry,
} from "./response-schema-registry.js";

export interface ModelCredentialResolver {
  resolve(input: {
    readonly scope: AppScope;
    readonly provider: ModelProvider;
    readonly credential_env: string;
  }): Promise<string | null>;
}

export interface ServerModelProviderBindingResolver {
  resolve(input: {
    readonly scope: AppScope;
    readonly provider: ModelProvider;
    readonly profile_id: string;
    readonly profile_version: string;
  }): Promise<ModelProviderBinding | null>;
}

export type ProjectedModelMessage =
  | {
      readonly role: "user";
      readonly content: string;
    }
  | {
      readonly role: "assistant";
      readonly content: string;
    };

export interface TrustedModelInputTokenCounterContext {
  readonly request: AuthoritativeModelProviderInvocation;
  readonly binding: ModelProviderBinding;
  readonly instructions: string;
  readonly messages: readonly ProjectedModelMessage[];
  readonly tools: readonly ServerOwnedToolDescriptor[];
  readonly response_schema_version: string;
  readonly response_schema: RegisteredServerModelResponseSchema;
}

/**
 * Server-deployed token counter for the exact provider/profile input context.
 *
 * The bridge validates the return value at runtime. An absent counter, a
 * counter error, or any non-integer result fails closed before provider setup.
 */
export interface TrustedModelInputTokenCounter {
  count(input: TrustedModelInputTokenCounterContext): Promise<number>;
}

export interface MastraModelExecutionBridgeOptions {
  readonly credential_resolver: ModelCredentialResolver;
  readonly binding_resolver?: ServerModelProviderBindingResolver;
  readonly tool_registry?: ServerOwnedToolRegistry;
  readonly response_schema_registry?: ServerModelResponseSchemaRegistry;
  readonly input_token_counter?: TrustedModelInputTokenCounter;
}

type RuntimeModelFactory = typeof createProviderRuntimeModel;

type ResolvedMastraExecutionBridgeOptions = Omit<
  MastraModelExecutionBridgeOptions,
  "binding_resolver"
> & {
  readonly binding_resolver: ServerModelProviderBindingResolver;
  readonly runtime_model_factory: RuntimeModelFactory;
};

const defaultBindingResolver: ServerModelProviderBindingResolver = {
  resolve: async ({ provider }) => getModelProviderBinding(provider, MODEL_PROVIDER_BINDINGS),
};

const failClosedInputTokenCounter: TrustedModelInputTokenCounter = {
  count: async () => {
    throw new Error("Trusted input-token counter is not deployed.");
  },
};

function resolveTools(
  registry: ServerOwnedToolRegistry,
  allowlist: readonly string[],
): {
  readonly descriptors: readonly ServerOwnedToolDescriptor[];
  readonly mastraTools: Record<string, ReturnType<typeof createTool>>;
} {
  let descriptors: readonly ServerOwnedToolDescriptor[];
  try {
    descriptors = registry.resolveAllowlist(allowlist);
  } catch (error) {
    if (error instanceof ToolRegistryError && error.code === "MODEL_TOOL_NOT_REGISTERED") {
      throw new MastraExecutionError(
        "MODEL_TOOL_NOT_REGISTERED",
        false,
        "Model Request 引用了未注册的 Server Tool。",
      );
    }
    throw new MastraExecutionError(
      "MODEL_STREAM_PROTOCOL_VIOLATION",
      false,
      "Model Tool Registry 配置无效。",
    );
  }

  const entries = descriptors.map(
    (descriptor) =>
      [
        descriptor.tool_name,
        createTool({
          id: descriptor.tool_name,
          description: descriptor.description,
          inputSchema: descriptor.input_schema,
        }),
      ] as const,
  );

  return {
    descriptors,
    mastraTools: Object.fromEntries(entries),
  };
}

function projectMessages(request: AuthoritativeModelProviderInvocation): {
  readonly instructions: string;
  readonly messages: ProjectedModelMessage[];
} {
  const systemMessages: string[] = [];
  const messages: ProjectedModelMessage[] = [];

  for (const message of request.messages) {
    if (message.tool_call_id !== undefined || message.role === "tool") {
      throw new MastraExecutionError(
        "MODEL_MESSAGE_ROLE_UNSUPPORTED",
        false,
        "当前 Model Port 无法无损表达 Tool History，调用必须失败关闭。",
      );
    }
    if (message.role === "system") {
      systemMessages.push(message.content);
      continue;
    }
    if (message.role === "user") {
      messages.push({
        role: "user",
        content: message.content,
      });
    } else {
      messages.push({
        role: "assistant",
        content: message.content,
      });
    }
  }

  if (messages.length === 0) {
    throw new MastraExecutionError(
      "MODEL_MESSAGE_ROLE_UNSUPPORTED",
      false,
      "Model Request 至少需要一条 User 或 Assistant Message。",
    );
  }

  return {
    instructions:
      systemMessages.length > 0
        ? systemMessages.join("\n\n")
        : "仅处理当前已授权请求，并只产生候选输出；不要扩大工具、网络或数据范围。",
    messages,
  };
}

function assertBinding(
  request: AuthoritativeModelProviderInvocation,
  binding: ModelProviderBinding,
): void {
  if (
    binding.provider !== request.provider ||
    binding.profile_id !== request.profile_id ||
    binding.profile_version !== request.profile_version ||
    binding.default_model_id !== request.model_id
  ) {
    throw new MastraExecutionError(
      "MODEL_PROVIDER_BINDING_MISMATCH",
      false,
      "授权 Profile 与部署时 Provider Binding 不一致。",
    );
  }
}

function parseToolArguments(input: unknown): z.infer<ReturnType<typeof z.json>> {
  const parsed = z.json().safeParse(input ?? null);
  if (!parsed.success) {
    throw new MastraExecutionError(
      "MODEL_STREAM_PROTOCOL_VIOLATION",
      false,
      "Mastra Tool Call Arguments 不是 JSON。",
    );
  }
  return parsed.data;
}

function normalizeUsage(input: {
  readonly inputTokens?: unknown;
  readonly outputTokens?: unknown;
}): {
  readonly input_tokens: number;
  readonly output_tokens: number;
} {
  if (
    typeof input.inputTokens !== "number" ||
    !Number.isSafeInteger(input.inputTokens) ||
    input.inputTokens < 0 ||
    typeof input.outputTokens !== "number" ||
    !Number.isSafeInteger(input.outputTokens) ||
    input.outputTokens < 0
  ) {
    throw new MastraExecutionError(
      "MODEL_USAGE_MISMATCH",
      false,
      "Model Provider 必须返回完整的非负整数 Token Usage。",
    );
  }

  return {
    input_tokens: input.inputTokens,
    output_tokens: input.outputTokens,
  };
}

function resolveResponseSchema(
  registry: ServerModelResponseSchemaRegistry,
  responseSchemaVersion: string,
): RegisteredServerModelResponseSchema {
  let responseSchema: RegisteredServerModelResponseSchema | null;
  try {
    responseSchema = registry.resolve(responseSchemaVersion);
  } catch {
    throw new MastraExecutionError(
      "MODEL_STREAM_PROTOCOL_VIOLATION",
      false,
      "Server Response Schema Registry 配置无效。",
    );
  }
  if (!responseSchema) {
    throw new MastraExecutionError(
      "MODEL_STREAM_PROTOCOL_VIOLATION",
      false,
      "Model Request 引用了未注册的 Response Schema Version。",
    );
  }
  return responseSchema;
}

async function assertTrustedInputTokenBudget(
  counter: TrustedModelInputTokenCounter,
  context: TrustedModelInputTokenCounterContext,
): Promise<void> {
  let inputTokens: number;
  try {
    inputTokens = await counter.count(context);
  } catch {
    throw new MastraExecutionError(
      "MODEL_USAGE_MISMATCH",
      false,
      "Trusted Input Token Preflight 不可用。",
    );
  }

  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0) {
    throw new MastraExecutionError(
      "MODEL_USAGE_MISMATCH",
      false,
      "Trusted Input Token Preflight 必须返回非负整数。",
    );
  }
  if (inputTokens > context.request.budget.max_input_tokens) {
    throw new MastraExecutionError(
      "MODEL_INPUT_TOKEN_BUDGET_EXCEEDED",
      false,
      "Trusted Input Token Preflight 超过授权预算。",
    );
  }
}

function isStructuredOutputValidationError(input: unknown): boolean {
  if (typeof input !== "object" || input === null) {
    return false;
  }
  try {
    return Reflect.get(input, "id") === "STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED";
  } catch {
    return false;
  }
}

function canonicalizeStructuredOutput(
  responseSchema: RegisteredServerModelResponseSchema,
  input: unknown,
): string {
  const structuredResult = responseSchema.schema.safeParse(input);
  if (!structuredResult.success) {
    throw new MastraExecutionError(
      "MODEL_STREAM_PROTOCOL_VIOLATION",
      false,
      "Mastra Structured Output 不匹配服务端 Response Schema。",
    );
  }

  const jsonResult = z.json().safeParse(structuredResult.data);
  if (!jsonResult.success) {
    throw new MastraExecutionError(
      "MODEL_STREAM_PROTOCOL_VIOLATION",
      false,
      "Mastra Structured Output 不是可规范化 JSON。",
    );
  }
  try {
    return canonicalizeJson(jsonResult.data);
  } catch {
    throw new MastraExecutionError(
      "MODEL_STREAM_PROTOCOL_VIOLATION",
      false,
      "Mastra Structured Output 无法规范化。",
    );
  }
}

class MastraExecutionBridge implements ModelExecutionBridge {
  readonly #credentialResolver: ModelCredentialResolver;
  readonly #bindingResolver: ServerModelProviderBindingResolver;
  readonly #toolRegistry: ServerOwnedToolRegistry;
  readonly #responseSchemaRegistry: ServerModelResponseSchemaRegistry;
  readonly #inputTokenCounter: TrustedModelInputTokenCounter;
  readonly #runtimeModelFactory: RuntimeModelFactory;

  constructor(options: ResolvedMastraExecutionBridgeOptions) {
    this.#credentialResolver = options.credential_resolver;
    this.#bindingResolver = options.binding_resolver;
    this.#toolRegistry = options.tool_registry ?? EMPTY_SERVER_TOOL_REGISTRY;
    this.#responseSchemaRegistry =
      options.response_schema_registry ?? EMPTY_SERVER_MODEL_RESPONSE_SCHEMA_REGISTRY;
    this.#inputTokenCounter = options.input_token_counter ?? failClosedInputTokenCounter;
    this.#runtimeModelFactory = options.runtime_model_factory;
  }

  async *stream(input: {
    readonly request: AuthoritativeModelProviderInvocation;
    readonly signal: AbortSignal;
  }): AsyncIterable<ModelExecutionChunk> {
    const responseSchema = resolveResponseSchema(
      this.#responseSchemaRegistry,
      input.request.response_schema_version,
    );
    const binding = await this.#bindingResolver.resolve({
      scope: input.request.scope,
      provider: input.request.provider,
      profile_id: input.request.profile_id,
      profile_version: input.request.profile_version,
    });
    if (!binding) {
      throw new MastraExecutionError(
        "MODEL_PROVIDER_BINDING_MISMATCH",
        false,
        "授权 Profile 没有对应的服务端部署 Binding。",
      );
    }
    assertBinding(input.request, binding);

    const { descriptors, mastraTools } = resolveTools(
      this.#toolRegistry,
      input.request.tool_allowlist,
    );
    const projected = projectMessages(input.request);
    await assertTrustedInputTokenBudget(this.#inputTokenCounter, {
      request: input.request,
      binding,
      instructions: projected.instructions,
      messages: projected.messages,
      tools: descriptors,
      response_schema_version: responseSchema.response_schema_version,
      response_schema: responseSchema,
    });

    const credential = await this.#credentialResolver.resolve({
      scope: input.request.scope,
      provider: input.request.provider,
      credential_env: binding.credential_env,
    });
    if (!credential || credential.trim().length === 0) {
      throw new MastraExecutionError(
        "MODEL_PROVIDER_CREDENTIAL_UNAVAILABLE",
        false,
        "Model Provider Credential 不可用。",
      );
    }

    const model = this.#runtimeModelFactory(binding, credential);
    const agent = new Agent({
      id: `model-provider-${input.request.request_id}`,
      name: "Data Agent Model Provider Adapter",
      instructions: projected.instructions,
      model,
      tools: mastraTools,
      maxRetries: 0,
    });
    const output = await agent.stream(projected.messages, {
      abortSignal: input.signal,
      activeTools: descriptors.map((descriptor) => descriptor.tool_name),
      maxSteps: 1,
      modelSettings: {
        maxOutputTokens: input.request.budget.max_output_tokens,
      },
      runId: input.request.run_id,
      structuredOutput: {
        schema: responseSchema.schema,
      },
      toolChoice: descriptors.length === 0 ? "none" : "auto",
    });

    let observedToolCalls = 0;
    const reader = output.fullStream.getReader();
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) {
          break;
        }
        const chunk = next.value;
        switch (chunk.type) {
          case "text-delta":
            if (chunk.payload.text.length > 0) {
              yield {
                chunk_type: "TEXT_DELTA",
                delta: chunk.payload.text,
              };
            }
            break;
          case "tool-call":
            if (chunk.payload.providerExecuted === true) {
              throw new MastraExecutionError(
                "MODEL_PROVIDER_TOOL_EXECUTION_FORBIDDEN",
                false,
                "Model Provider Port 禁止 Provider 直接执行工具。",
              );
            }
            observedToolCalls += 1;
            yield {
              chunk_type: "TOOL_CALL_CANDIDATE",
              tool_call_id: chunk.payload.toolCallId,
              tool_name: chunk.payload.toolName,
              arguments: parseToolArguments(chunk.payload.args),
            };
            break;
          case "tool-result":
            throw new MastraExecutionError(
              "MODEL_PROVIDER_TOOL_EXECUTION_FORBIDDEN",
              false,
              "Model Provider Port 只允许 Tool Call Candidate，禁止执行结果。",
            );
          case "error":
            if (isStructuredOutputValidationError(chunk.payload.error)) {
              throw new MastraExecutionError(
                "MODEL_STREAM_PROTOCOL_VIOLATION",
                false,
                "Mastra Structured Output 未通过服务端 Schema 校验。",
              );
            }
            throw new MastraExecutionError(
              "MODEL_PROVIDER_EXECUTION_FAILED",
              true,
              "Mastra Stream 返回执行错误。",
            );
          default:
            break;
        }
      }
    } finally {
      reader.releaseLock();
    }

    const fullOutput = await output.getFullOutput().catch((error: unknown) => {
      if (isStructuredOutputValidationError(error)) {
        throw new MastraExecutionError(
          "MODEL_STREAM_PROTOCOL_VIOLATION",
          false,
          "Mastra Structured Output 未通过服务端 Schema 校验。",
        );
      }
      throw error;
    });
    if (fullOutput.error) {
      if (isStructuredOutputValidationError(fullOutput.error)) {
        throw new MastraExecutionError(
          "MODEL_STREAM_PROTOCOL_VIOLATION",
          false,
          "Mastra Structured Output 未通过服务端 Schema 校验。",
        );
      }
      throw new MastraExecutionError(
        "MODEL_PROVIDER_EXECUTION_FAILED",
        true,
        "Mastra Full Output 返回执行错误。",
      );
    }
    if (fullOutput.finishReason === "error" || fullOutput.finishReason === "content-filter") {
      throw new MastraExecutionError(
        "MODEL_RESPONSE_BLOCKED",
        false,
        "Model Response 未通过 Provider 结束条件。",
      );
    }

    const usage = normalizeUsage(fullOutput.totalUsage);
    const outputText = canonicalizeStructuredOutput(responseSchema, fullOutput.object);
    yield {
      chunk_type: "COMPLETED",
      output_text: outputText,
      usage: {
        ...usage,
        tool_calls: observedToolCalls,
      },
    };
  }
}

export function createMastraModelExecutionBridge(
  options: MastraModelExecutionBridgeOptions,
): ModelExecutionBridge {
  return new MastraExecutionBridge({
    ...options,
    binding_resolver: options.binding_resolver ?? defaultBindingResolver,
    runtime_model_factory: createProviderRuntimeModel,
  });
}

/**
 * Package-private test seam. It is intentionally not exported from the package
 * root, so application code cannot replace the pinned Provider model factory.
 */
export function createMastraModelExecutionBridgeForTesting(options: {
  readonly credential_resolver: ModelCredentialResolver;
  readonly binding_resolver?: ServerModelProviderBindingResolver;
  readonly tool_registry?: ServerOwnedToolRegistry;
  readonly response_schema_registry?: ServerModelResponseSchemaRegistry;
  readonly input_token_counter?: TrustedModelInputTokenCounter;
  readonly runtime_model_factory: RuntimeModelFactory;
}): ModelExecutionBridge {
  return new MastraExecutionBridge({
    ...options,
    binding_resolver: options.binding_resolver ?? defaultBindingResolver,
  });
}
