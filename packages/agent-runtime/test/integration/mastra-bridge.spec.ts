import {
  type AuthoritativeModelProviderInvocation,
  authorizeModelProviderInvocation,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createMastraModelExecutionBridgeForTesting,
  type TrustedModelInputTokenCounter,
} from "../../src/mastra/mastra-execution-bridge.js";
import { MastraModelProviderAdapter } from "../../src/mastra/model-provider-adapter.js";
import { ServerModelResponseSchemaRegistry } from "../../src/mastra/response-schema-registry.js";
import {
  createModelProviderBindings,
  getModelProviderBinding,
  type ModelProviderBinding,
} from "../../src/models/bindings.js";
import { createProviderRuntimeModel } from "../../src/models/provider-model-factory.js";
import { ServerOwnedToolRegistry } from "../../src/tools/registry.js";
import { makeAvailableProfile, modelFixtureIds, modelFixtureScope } from "../model-fixtures.js";

const contentHash = `sha256:${"c".repeat(64)}` as const;
const responseSchema = z.strictObject({
  confidence: z.number().min(0).max(1),
  summary: z.string(),
});
const responseSchemaRegistry = new ServerModelResponseSchemaRegistry([
  {
    response_schema_version: "1.0.0",
    schema: responseSchema,
  },
]);
const trustedInputTokenCounter: TrustedModelInputTokenCounter = {
  count: async () => 8,
};

async function makeInvocation(
  binding: ModelProviderBinding,
  options: {
    readonly tool_allowlist?: readonly string[];
    readonly max_tool_calls?: number;
    readonly max_input_tokens?: number;
    readonly response_schema_version?: string;
  } = {},
): Promise<AuthoritativeModelProviderInvocation> {
  const profile = await makeAvailableProfile({
    provider: binding.provider,
    model_id: binding.default_model_id,
    profile_id: binding.profile_id,
    profile_version: binding.profile_version,
  });
  return authorizeModelProviderInvocation(
    {
      schema_version: "1.0.0",
      request_id: modelFixtureIds.request,
      attempt_id: modelFixtureIds.attempt,
      scope: modelFixtureScope,
      run_id: modelFixtureIds.run,
      provider: profile.provider,
      profile_id: profile.profile_id,
      profile_version: profile.profile_version,
      model_id: profile.model_id,
      task_ref: {
        artifact_id: modelFixtureIds.task,
        artifact_type: "ResearchBrief",
        ...modelFixtureScope,
        run_id: modelFixtureIds.run,
        revision: 1,
        content_hash: contentHash,
      },
      context_refs: [],
      messages: [
        { role: "system", content: "只返回经过范围约束的候选分析。" },
        { role: "user", content: "给出候选结论。" },
      ],
      tool_allowlist: options.tool_allowlist ?? [],
      response_schema_version: options.response_schema_version ?? "1.0.0",
      budget: {
        timeout_ms: 1_000,
        max_input_tokens: options.max_input_tokens ?? 100,
        max_output_tokens: 100,
        max_tool_calls: options.max_tool_calls ?? 0,
      },
    },
    async () => profile,
  );
}

function createOfflineStructuredModel(
  binding: ModelProviderBinding,
  options: {
    readonly output_text: string;
    readonly usage: unknown;
  },
): ReturnType<typeof createProviderRuntimeModel> {
  return {
    specificationVersion: "v4",
    provider: "offline-test",
    modelId: binding.default_model_id,
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error("The integration uses streaming only.");
    },
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "stream-start",
            warnings: [],
          });
          controller.enqueue({
            type: "text-start",
            id: "text-1",
          });
          controller.enqueue({
            type: "text-delta",
            id: "text-1",
            delta: options.output_text,
          });
          controller.enqueue({
            type: "text-end",
            id: "text-1",
          });
          controller.enqueue({
            type: "finish",
            usage: options.usage,
            finishReason: {
              unified: "stop",
              raw: "stop",
            },
          });
          controller.close();
        },
      }),
    }),
  } as unknown as ReturnType<typeof createProviderRuntimeModel>;
}

const validProviderUsage = {
  inputTokens: {
    total: 8,
    noCache: 8,
    cacheRead: 0,
    cacheWrite: 0,
  },
  outputTokens: {
    total: 5,
    text: 5,
    reasoning: 0,
  },
};

describe("Mastra execution bridge integration", () => {
  it("runs the pinned @mastra/core Agent with an offline AI SDK v4 model", async () => {
    const deploymentBindings = createModelProviderBindings([
      {
        provider: "openai",
        model_id: "gpt-deployment-frozen",
      },
    ]);
    const deploymentBinding = getModelProviderBinding("openai", deploymentBindings);
    let receivedMaxOutputTokens: number | undefined;
    let receivedBinding: ModelProviderBinding | undefined;
    let receivedResponseFormat: unknown;
    let receivedProviderOptions: unknown;
    let preflightContext: Parameters<TrustedModelInputTokenCounter["count"]>[0] | undefined;
    let streamCalls = 0;
    const fakeModel = {
      specificationVersion: "v4",
      provider: "offline-test",
      modelId: deploymentBinding.default_model_id,
      supportedUrls: {},
      doGenerate: async () => {
        throw new Error("The integration uses streaming only.");
      },
      doStream: async (options: {
        readonly maxOutputTokens?: number;
        readonly providerOptions?: unknown;
        readonly responseFormat?: unknown;
      }) => {
        streamCalls += 1;
        receivedMaxOutputTokens = options.maxOutputTokens;
        receivedResponseFormat = options.responseFormat;
        receivedProviderOptions = options.providerOptions;
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({
                type: "stream-start",
                warnings: [],
              });
              controller.enqueue({
                type: "text-start",
                id: "text-1",
              });
              controller.enqueue({
                type: "text-delta",
                id: "text-1",
                delta: '{"summary":"离线 Mastra 候选结论","confidence":0.75}',
              });
              controller.enqueue({
                type: "text-end",
                id: "text-1",
              });
              controller.enqueue({
                type: "finish",
                usage: {
                  inputTokens: {
                    total: 8,
                    noCache: 8,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  outputTokens: {
                    total: 5,
                    text: 5,
                    reasoning: 0,
                  },
                },
                finishReason: {
                  unified: "stop",
                  raw: "stop",
                },
              });
              controller.close();
            },
          }),
        };
      },
    } as unknown as ReturnType<typeof createProviderRuntimeModel>;
    const bridge = createMastraModelExecutionBridgeForTesting({
      credential_resolver: {
        resolve: async () => "offline-placeholder-credential",
      },
      binding_resolver: {
        resolve: async () => deploymentBinding,
      },
      response_schema_registry: responseSchemaRegistry,
      input_token_counter: {
        count: async (context) => {
          preflightContext = context;
          return 8;
        },
      },
      runtime_model_factory: ((binding) => {
        receivedBinding = binding;
        return fakeModel;
      }) as typeof createProviderRuntimeModel,
    });
    const adapter = new MastraModelProviderAdapter({ bridge });
    const invocation = await makeInvocation(deploymentBinding);

    const events = [];
    for await (const event of adapter.stream(invocation)) {
      events.push(event);
    }

    expect(streamCalls).toBe(1);
    expect(receivedBinding?.default_model_id).toBe("gpt-deployment-frozen");
    expect(receivedMaxOutputTokens).toBe(100);
    expect(receivedResponseFormat).toMatchObject({
      type: "json",
      schema: {
        additionalProperties: false,
        required: ["confidence", "summary"],
        type: "object",
      },
    });
    expect(receivedProviderOptions).toBeUndefined();
    expect(preflightContext).toMatchObject({
      binding: {
        default_model_id: "gpt-deployment-frozen",
      },
      request: {
        response_schema_version: "1.0.0",
      },
      response_schema_version: "1.0.0",
    });
    expect(events.map((event) => event.event_type)).toEqual(["STARTED", "TEXT_DELTA", "COMPLETED"]);
    expect(events[1]).toMatchObject({
      event_type: "TEXT_DELTA",
      delta: '{"summary":"离线 Mastra 候选结论","confidence":0.75}',
    });
    expect(events[2]).toMatchObject({
      event_type: "COMPLETED",
      output_text: '{"confidence":0.75,"summary":"离线 Mastra 候选结论"}',
      usage: {
        input_tokens: 8,
        output_tokens: 5,
        tool_calls: 0,
      },
    });
  });

  it.each([
    ["deepseek", { deepseek: { thinking: { type: "disabled" } } }],
    ["kimi", { "data-agent": { thinking: { type: "disabled" } } }],
  ] as const)("disables %s thinking for structured output", async (provider, expectedOptions) => {
    const binding = getModelProviderBinding(provider);
    let receivedProviderOptions: unknown;
    const fakeModel = {
      ...createOfflineStructuredModel(binding, {
        output_text: '{"summary":"structured","confidence":0.75}',
        usage: validProviderUsage,
      }),
      doStream: async (options: { readonly providerOptions?: unknown }) => {
        receivedProviderOptions = options.providerOptions;
        return createOfflineStructuredModel(binding, {
          output_text: '{"summary":"structured","confidence":0.75}',
          usage: validProviderUsage,
        }).doStream(options as never);
      },
    } as unknown as ReturnType<typeof createProviderRuntimeModel>;
    const bridge = createMastraModelExecutionBridgeForTesting({
      credential_resolver: { resolve: async () => "offline-placeholder-credential" },
      binding_resolver: { resolve: async () => binding },
      response_schema_registry: responseSchemaRegistry,
      input_token_counter: trustedInputTokenCounter,
      runtime_model_factory: (() => fakeModel) as typeof createProviderRuntimeModel,
    });

    const events = [];
    for await (const event of new MastraModelProviderAdapter({ bridge }).stream(
      await makeInvocation(binding),
    )) {
      events.push(event);
    }

    expect(events.at(-1)?.event_type).toBe("COMPLETED");
    expect(receivedProviderOptions).toEqual(expectedOptions);
  });

  it("rejects a server binding that does not exactly match the authorized profile", async () => {
    const authorizedBinding = getModelProviderBinding(
      "openai",
      createModelProviderBindings([
        {
          provider: "openai",
          model_id: "gpt-authorized-deployment",
        },
      ]),
    );
    const staleBinding = getModelProviderBinding("openai");
    let modelFactoryCalled = false;
    const bridge = createMastraModelExecutionBridgeForTesting({
      credential_resolver: {
        resolve: async () => "offline-placeholder-credential",
      },
      binding_resolver: {
        resolve: async () => staleBinding,
      },
      response_schema_registry: responseSchemaRegistry,
      input_token_counter: trustedInputTokenCounter,
      runtime_model_factory: ((binding, credential) => {
        modelFactoryCalled = true;
        return createProviderRuntimeModel(binding, credential);
      }) as typeof createProviderRuntimeModel,
    });
    const adapter = new MastraModelProviderAdapter({ bridge });
    const events = [];

    for await (const event of adapter.stream(await makeInvocation(authorizedBinding))) {
      events.push(event);
    }

    expect(modelFactoryCalled).toBe(false);
    expect(events.map((event) => event.event_type)).toEqual(["STARTED", "FAILED"]);
    expect(events[1]).toMatchObject({
      reason_code: "MODEL_PROVIDER_BINDING_MISMATCH",
      retryable: false,
    });
  });

  it("fails closed before provider setup when the response schema version is unknown", async () => {
    const binding = getModelProviderBinding("openai");
    let counterCalled = false;
    let modelFactoryCalled = false;
    const bridge = createMastraModelExecutionBridgeForTesting({
      credential_resolver: {
        resolve: async () => "offline-placeholder-credential",
      },
      response_schema_registry: responseSchemaRegistry,
      input_token_counter: {
        count: async () => {
          counterCalled = true;
          return 8;
        },
      },
      runtime_model_factory: (() => {
        modelFactoryCalled = true;
        return createOfflineStructuredModel(binding, {
          output_text: '{"summary":"不应调用","confidence":0.1}',
          usage: validProviderUsage,
        });
      }) as typeof createProviderRuntimeModel,
    });
    const events = [];

    for await (const event of new MastraModelProviderAdapter({ bridge }).stream(
      await makeInvocation(binding, {
        response_schema_version: "9.9.9",
      }),
    )) {
      events.push(event);
    }

    expect(counterCalled).toBe(false);
    expect(modelFactoryCalled).toBe(false);
    expect(events.map((event) => event.event_type)).toEqual(["STARTED", "FAILED"]);
    expect(events[1]).toMatchObject({
      reason_code: "MODEL_STREAM_PROTOCOL_VIOLATION",
      retryable: false,
    });
  });

  it("fails closed when no trusted input-token counter is deployed", async () => {
    const binding = getModelProviderBinding("openai");
    let modelFactoryCalled = false;
    const bridge = createMastraModelExecutionBridgeForTesting({
      credential_resolver: {
        resolve: async () => "offline-placeholder-credential",
      },
      response_schema_registry: responseSchemaRegistry,
      runtime_model_factory: (() => {
        modelFactoryCalled = true;
        return createOfflineStructuredModel(binding, {
          output_text: '{"summary":"不应调用","confidence":0.1}',
          usage: validProviderUsage,
        });
      }) as typeof createProviderRuntimeModel,
    });
    const events = [];

    for await (const event of new MastraModelProviderAdapter({ bridge }).stream(
      await makeInvocation(binding),
    )) {
      events.push(event);
    }

    expect(modelFactoryCalled).toBe(false);
    expect(events.map((event) => event.event_type)).toEqual(["STARTED", "FAILED"]);
    expect(events[1]).toMatchObject({
      reason_code: "MODEL_USAGE_MISMATCH",
      retryable: false,
    });
  });

  it.each([
    ["negative", -1],
    ["fractional", 1.5],
    ["not finite", Number.NaN],
    ["unsafe", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects a %s trusted input-token preflight result", async (_label, tokenCount) => {
    const binding = getModelProviderBinding("openai");
    let modelFactoryCalled = false;
    const bridge = createMastraModelExecutionBridgeForTesting({
      credential_resolver: {
        resolve: async () => "offline-placeholder-credential",
      },
      response_schema_registry: responseSchemaRegistry,
      input_token_counter: {
        count: async () => tokenCount,
      },
      runtime_model_factory: (() => {
        modelFactoryCalled = true;
        return createOfflineStructuredModel(binding, {
          output_text: '{"summary":"不应调用","confidence":0.1}',
          usage: validProviderUsage,
        });
      }) as typeof createProviderRuntimeModel,
    });
    const events = [];

    for await (const event of new MastraModelProviderAdapter({ bridge }).stream(
      await makeInvocation(binding),
    )) {
      events.push(event);
    }

    expect(modelFactoryCalled).toBe(false);
    expect(events.at(-1)).toMatchObject({
      event_type: "FAILED",
      reason_code: "MODEL_USAGE_MISMATCH",
      retryable: false,
    });
  });

  it("enforces the input-token budget before constructing the provider model", async () => {
    const binding = getModelProviderBinding("openai");
    let modelFactoryCalled = false;
    const bridge = createMastraModelExecutionBridgeForTesting({
      credential_resolver: {
        resolve: async () => "offline-placeholder-credential",
      },
      response_schema_registry: responseSchemaRegistry,
      input_token_counter: {
        count: async () => 101,
      },
      runtime_model_factory: (() => {
        modelFactoryCalled = true;
        return createOfflineStructuredModel(binding, {
          output_text: '{"summary":"不应调用","confidence":0.1}',
          usage: validProviderUsage,
        });
      }) as typeof createProviderRuntimeModel,
    });
    const events = [];

    for await (const event of new MastraModelProviderAdapter({ bridge }).stream(
      await makeInvocation(binding, {
        max_input_tokens: 100,
      }),
    )) {
      events.push(event);
    }

    expect(modelFactoryCalled).toBe(false);
    expect(events.at(-1)).toMatchObject({
      event_type: "FAILED",
      reason_code: "MODEL_INPUT_TOKEN_BUDGET_EXCEEDED",
      retryable: false,
    });
  });

  it("fails closed when Mastra cannot validate the structured response", async () => {
    const binding = getModelProviderBinding("openai");
    const bridge = createMastraModelExecutionBridgeForTesting({
      credential_resolver: {
        resolve: async () => "offline-placeholder-credential",
      },
      response_schema_registry: responseSchemaRegistry,
      input_token_counter: trustedInputTokenCounter,
      runtime_model_factory: (() =>
        createOfflineStructuredModel(binding, {
          output_text: '{"unexpected":"shape"}',
          usage: validProviderUsage,
        })) as typeof createProviderRuntimeModel,
    });
    const events = [];

    for await (const event of new MastraModelProviderAdapter({ bridge }).stream(
      await makeInvocation(binding),
    )) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({
      event_type: "FAILED",
      reason_code: "MODEL_STREAM_PROTOCOL_VIOLATION",
      retryable: false,
    });
  });

  it.each([
    [
      "missing",
      {
        inputTokens: {
          total: undefined,
          noCache: undefined,
          cacheRead: 0,
          cacheWrite: 0,
        },
        outputTokens: validProviderUsage.outputTokens,
      },
    ],
    [
      "invalid",
      {
        inputTokens: validProviderUsage.inputTokens,
        outputTokens: {
          total: 1.5,
          text: 1.5,
          reasoning: 0,
        },
      },
    ],
    [
      "unsafe",
      {
        inputTokens: validProviderUsage.inputTokens,
        outputTokens: {
          total: Number.MAX_SAFE_INTEGER + 1,
          text: Number.MAX_SAFE_INTEGER + 1,
          reasoning: 0,
        },
      },
    ],
  ])("fails closed when provider %s token usage is returned", async (_label, usage) => {
    const binding = getModelProviderBinding("openai");
    const bridge = createMastraModelExecutionBridgeForTesting({
      credential_resolver: {
        resolve: async () => "offline-placeholder-credential",
      },
      response_schema_registry: responseSchemaRegistry,
      input_token_counter: trustedInputTokenCounter,
      runtime_model_factory: (() =>
        createOfflineStructuredModel(binding, {
          output_text: '{"summary":"usage 校验","confidence":0.8}',
          usage,
        })) as typeof createProviderRuntimeModel,
    });
    const events = [];

    for await (const event of new MastraModelProviderAdapter({ bridge }).stream(
      await makeInvocation(binding),
    )) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({
      event_type: "FAILED",
      reason_code: "MODEL_USAGE_MISMATCH",
      retryable: false,
    });
  });

  it("projects an offline Mastra tool call as a candidate without executing it", async () => {
    const binding = getModelProviderBinding("openai");
    let receivedResponseFormat: unknown = "not-called";
    const fakeModel = {
      specificationVersion: "v4",
      provider: "offline-test",
      modelId: binding.default_model_id,
      supportedUrls: {},
      doGenerate: async () => {
        throw new Error("The integration uses streaming only.");
      },
      doStream: async (options: { readonly responseFormat?: unknown }) => {
        receivedResponseFormat = options.responseFormat;
        return {
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue({
                type: "stream-start",
                warnings: [],
              });
              controller.enqueue({
                type: "tool-call",
                toolCallId: "tool-call-1",
                toolName: "semantic-query@1",
                input: JSON.stringify({ metric: "revenue" }),
              });
              controller.enqueue({
                type: "text-start",
                id: "text-1",
              });
              controller.enqueue({
                type: "text-delta",
                id: "text-1",
                delta: '{"summary":"需要工具候选","confidence":0.5}',
              });
              controller.enqueue({
                type: "text-end",
                id: "text-1",
              });
              controller.enqueue({
                type: "finish",
                usage: {
                  inputTokens: {
                    total: 8,
                    noCache: 8,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  outputTokens: {
                    total: 4,
                    text: 0,
                    reasoning: 0,
                  },
                },
                finishReason: {
                  unified: "tool-calls",
                  raw: "tool-calls",
                },
              });
              controller.close();
            },
          }),
        };
      },
    } as unknown as ReturnType<typeof createProviderRuntimeModel>;
    const bridge = createMastraModelExecutionBridgeForTesting({
      credential_resolver: {
        resolve: async () => "offline-placeholder-credential",
      },
      tool_registry: new ServerOwnedToolRegistry([
        {
          tool_name: "semantic-query@1",
          description: "生成受治理语义查询候选。",
          input_schema: z.strictObject({ metric: z.string() }),
        },
      ]),
      response_schema_registry: responseSchemaRegistry,
      input_token_counter: trustedInputTokenCounter,
      runtime_model_factory: (() => fakeModel) as typeof createProviderRuntimeModel,
    });
    const adapter = new MastraModelProviderAdapter({ bridge });
    const events = [];

    for await (const event of adapter.stream(
      await makeInvocation(binding, {
        tool_allowlist: ["semantic-query@1"],
        max_tool_calls: 1,
      }),
    )) {
      events.push(event);
    }

    expect(events.map((event) => event.event_type)).toEqual([
      "STARTED",
      "TOOL_CALL_CANDIDATE",
      "TEXT_DELTA",
      "COMPLETED",
    ]);
    expect(events[1]).toMatchObject({
      event_type: "TOOL_CALL_CANDIDATE",
      tool_call_id: "tool-call-1",
      tool_name: "semantic-query@1",
      arguments: { metric: "revenue" },
    });
    expect(receivedResponseFormat).toBeUndefined();
    expect(events.at(-1)).toMatchObject({
      event_type: "COMPLETED",
      output_text: '{"summary":"需要工具候选","confidence":0.5}',
    });
  });
});
