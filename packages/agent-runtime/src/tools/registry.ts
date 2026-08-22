import { versionIdentifierSchema } from "@data-agent/contracts";
import { z } from "zod";

export const serverOwnedToolNetworkAccessSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("DENY"),
  }),
  z.strictObject({
    mode: z.literal("HTTPS"),
  }),
]);

export type ServerOwnedToolNetworkAccess = z.infer<typeof serverOwnedToolNetworkAccessSchema>;

export interface ServerOwnedToolDescriptor {
  readonly tool_name: string;
  readonly description: string;
  readonly input_schema: z.ZodType;
  /**
   * 默认 DENY。只有服务端 Descriptor 明确声明 HTTPS 的 Tool 才能携带网络候选。
   */
  readonly network_access?: ServerOwnedToolNetworkAccess;
}

export interface RegisteredServerOwnedToolDescriptor {
  readonly tool_name: string;
  readonly description: string;
  readonly input_schema: z.ZodType;
  readonly network_access: ServerOwnedToolNetworkAccess;
}

export interface ServerOwnedToolExecutor<TContext = unknown, TResult = unknown> {
  execute(input: unknown, context: TContext): Promise<TResult>;
}

export interface ServerOwnedExecutableTool<TContext = unknown, TResult = unknown>
  extends ServerOwnedToolDescriptor {
  /**
   * Executor is registered by server composition and is never projected into
   * a model request. The model only receives the frozen descriptor.
   */
  readonly executor: ServerOwnedToolExecutor<TContext, TResult>;
}

export interface ResolvedServerOwnedExecutableTool<TContext = unknown, TResult = unknown> {
  readonly descriptor: RegisteredServerOwnedToolDescriptor;
  execute(input: unknown, context: TContext): Promise<TResult>;
}

export class ToolRegistryError extends Error {
  override readonly name = "ToolRegistryError";

  constructor(
    readonly code: "MODEL_TOOL_REGISTRY_CONFLICT" | "MODEL_TOOL_NOT_REGISTERED",
    message: string,
  ) {
    super(message);
  }
}

function parseDescriptor(input: ServerOwnedToolDescriptor): RegisteredServerOwnedToolDescriptor {
  if (
    typeof input.input_schema !== "object" ||
    input.input_schema === null ||
    typeof Reflect.get(input.input_schema, "safeParse") !== "function"
  ) {
    throw new TypeError("Server Tool Descriptor 必须提供可执行的 Zod Input Schema。");
  }
  return Object.freeze({
    tool_name: versionIdentifierSchema.parse(input.tool_name),
    description: z.string().min(1).max(2_000).parse(input.description),
    input_schema: input.input_schema,
    network_access: serverOwnedToolNetworkAccessSchema.parse(
      input.network_access ?? { mode: "DENY" },
    ),
  });
}

/**
 * Server-owned registry used to project an invocation allowlist into Mastra.
 *
 * A request can only select an already registered descriptor. It cannot provide
 * descriptions, schemas, executors, or new tool names.
 */
export class ServerOwnedToolRegistry {
  readonly #descriptors: ReadonlyMap<string, RegisteredServerOwnedToolDescriptor>;

  constructor(descriptors: readonly ServerOwnedToolDescriptor[]) {
    const registered = new Map<string, RegisteredServerOwnedToolDescriptor>();
    for (const descriptorInput of descriptors) {
      const descriptor = parseDescriptor(descriptorInput);
      if (registered.has(descriptor.tool_name)) {
        throw new ToolRegistryError(
          "MODEL_TOOL_REGISTRY_CONFLICT",
          "Server Tool Registry 不允许重复 Tool Name。",
        );
      }
      registered.set(descriptor.tool_name, descriptor);
    }
    this.#descriptors = registered;
  }

  resolve(toolNameInput: string): RegisteredServerOwnedToolDescriptor {
    const toolName = versionIdentifierSchema.parse(toolNameInput);
    const descriptor = this.#descriptors.get(toolName);
    if (!descriptor) {
      throw new ToolRegistryError("MODEL_TOOL_NOT_REGISTERED", "调用引用了未注册的 Server Tool。");
    }
    return descriptor;
  }

  resolveAllowlist(
    toolAllowlist: readonly string[],
  ): readonly RegisteredServerOwnedToolDescriptor[] {
    const resolved: RegisteredServerOwnedToolDescriptor[] = [];
    const seen = new Set<string>();

    for (const toolNameInput of toolAllowlist) {
      const toolName = versionIdentifierSchema.parse(toolNameInput);
      if (seen.has(toolName)) {
        throw new ToolRegistryError(
          "MODEL_TOOL_REGISTRY_CONFLICT",
          "Model Request 的 Tool Allowlist 不允许重复。",
        );
      }
      seen.add(toolName);

      resolved.push(this.resolve(toolName));
    }

    return Object.freeze(resolved);
  }
}

/**
 * Server-side companion to the descriptor registry. It closes the common gap
 * where a caller resolves an allowlisted name but then supplies a different
 * executor. Input is parsed by the registered Zod schema before the server
 * executor is invoked.
 */
export class ServerOwnedExecutableToolRegistry<TContext = unknown, TResult = unknown> {
  readonly #descriptors: ServerOwnedToolRegistry;
  readonly #executors: ReadonlyMap<string, ServerOwnedToolExecutor<TContext, TResult>>;

  constructor(tools: readonly ServerOwnedExecutableTool<TContext, TResult>[]) {
    this.#descriptors = new ServerOwnedToolRegistry(tools);
    this.#executors = new Map(tools.map(({ tool_name, executor }) => [tool_name, executor]));
  }

  resolve(toolName: string): ResolvedServerOwnedExecutableTool<TContext, TResult> {
    const descriptor = this.#descriptors.resolve(toolName);
    const executor = this.#executors.get(descriptor.tool_name);
    if (!executor) {
      throw new ToolRegistryError(
        "MODEL_TOOL_NOT_REGISTERED",
        "Server Tool 没有注册对应 Executor。",
      );
    }
    return Object.freeze({
      descriptor,
      execute: async (input: unknown, context: TContext) =>
        executor.execute(descriptor.input_schema.parse(input), context),
    });
  }

  resolveAllowlist(
    toolAllowlist: readonly string[],
  ): readonly ResolvedServerOwnedExecutableTool<TContext, TResult>[] {
    // Resolve descriptors first so duplicate names and unknown names fail
    // before any executable handle is returned.
    const descriptors = this.#descriptors.resolveAllowlist(toolAllowlist);
    return Object.freeze(descriptors.map(({ tool_name }) => this.resolve(tool_name)));
  }
}

export const EMPTY_SERVER_TOOL_REGISTRY = new ServerOwnedToolRegistry([]);
