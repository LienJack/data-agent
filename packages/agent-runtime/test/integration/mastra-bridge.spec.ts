import {
  type AuthoritativeModelProviderInvocation,
  authorizeModelProviderInvocation,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
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
    readonly temperature?: number;
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
      ...(options.temperature === undefined
        ? {}
        : { sampling: { temperature: options.temperature } }),
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
  it.each([
    { name: "native tool with no text", tool: true, text: "", valid: true },
    {
      name: "strict JSON final",
      tool: false,
      text: '{"summary":"facts","confidence":1}',
      valid: true,
    },
    { name: "empty final", tool: false, text: "", valid: false },
    { name: "whitespace final", tool: false, text: "  \n ", valid: false },
    { name: "blank length", tool: false, text: "  \n ", valid: false },
    { name: "blank unknown finish", tool: false, text: "  \n ", valid: false },
    { name: "blank over budget", tool: false, text: "  \n ", valid: false },
    { name: "blank interrupted", tool: false, text: "  \n ", valid: false },
    { name: "truncated final", tool: false, text: '{"summary":"private', valid: false },
    { name: "plain final", tool: false, text: "private-invalid-answer", valid: false },
    { name: "non-json unknown finish", tool: false, text: "private-invalid-answer", valid: false },
    { name: "non-json over budget", tool: false, text: "private-invalid-answer", valid: false },
    { name: "non-json interrupted", tool: false, text: "private-invalid-answer", valid: false },
    {
      name: "non-json partial native tool",
      tool: false,
      text: "private-invalid-answer",
      valid: false,
    },
    {
      name: "fenced final",
      tool: false,
      text: '```json\n{"summary":"facts","confidence":1}\n```',
      valid: false,
    },
    {
      name: "extra field",
      tool: false,
      text: '{"summary":"facts","confidence":1,"extra":true}',
      valid: false,
    },
  ])(
    "constrains DeepSeek AUTO transport to JSON without forcing a tool ($name)",
    async ({ name, tool, text, valid }) => {
      const interrupted = name.endsWith("interrupted");
      const overBudget = name.endsWith("over budget");
      const unknownFinish = name.endsWith("unknown finish");
      const partialNativeTool = name === "non-json partial native tool";
      const knownEmpty =
        !tool && text.trim().length === 0 && !interrupted && !unknownFinish && !overBudget;
      const knownInvalidJson =
        !valid &&
        !tool &&
        text.trim().length > 0 &&
        name !== "extra field" &&
        !partialNativeTool &&
        !interrupted &&
        !unknownFinish &&
        !overBudget;
      const finish =
        name === "truncated final" || name === "blank length"
          ? "length"
          : unknownFinish
            ? "unknown"
            : "stop";
      const binding = getModelProviderBinding("deepseek");
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      let marked = false;
      let calls = 0;
      const bodies: Record<string, unknown>[] = [];
      const request = await makeInvocation(binding, {
        tool_allowlist: ["semantic-query@1"],
        max_tool_calls: 1,
      });
      const original = JSON.stringify(request);
      try {
        const bridge = createMastraModelExecutionBridgeForTesting({
          credential_resolver: { resolve: async () => "offline-placeholder-credential" },
          tool_registry: new ServerOwnedToolRegistry([
            {
              tool_name: "semantic-query@1",
              description: "Return governed evidence when needed.",
              input_schema: z.strictObject({ metric: z.string() }),
            },
          ]),
          response_schema_registry: responseSchemaRegistry,
          input_token_counter: trustedInputTokenCounter,
          tool_choice_policy: "AUTO",
          runtime_model_factory: (resolved, credential) =>
            createProviderRuntimeModel(resolved, credential, {
              fetch: async (_url, init) => {
                expect(marked).toBe(true);
                calls += 1;
                bodies.push(JSON.parse(String(init?.body)));
                const common = {
                  id: "offline-auto-json",
                  object: "chat.completion.chunk",
                  created: 1,
                  model: binding.default_model_id,
                };
                const delta = tool
                  ? {
                      tool_calls: [
                        {
                          index: 0,
                          id: "native-auto-call",
                          type: "function",
                          function: {
                            name: "semantic-query_v1",
                            arguments: '{"metric":"revenue"}',
                          },
                        },
                      ],
                    }
                  : partialNativeTool
                    ? {
                        content: text,
                        tool_calls: [
                          {
                            index: 0,
                            id: "incomplete-native",
                            type: "function",
                            function: { name: "semantic-query_v1", arguments: '{"metric":' },
                          },
                        ],
                      }
                    : { content: text };
                if (interrupted)
                  return new Response(
                    new ReadableStream({
                      start(controller) {
                        controller.enqueue(
                          new TextEncoder().encode(
                            `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
                          ),
                        );
                      },
                      pull(controller) {
                        controller.error(new Error("offline interrupted stream"));
                      },
                    }),
                    { headers: { "content-type": "text/event-stream" } },
                  );
                return new Response(
                  [
                    `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
                    `data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : finish }], usage: { prompt_tokens: 8, completion_tokens: overBudget ? 101 : 5, total_tokens: overBudget ? 109 : 13 } })}\n\n`,
                    "data: [DONE]\n\n",
                  ].join(""),
                  { headers: { "content-type": "text/event-stream" } },
                );
              },
            }),
        });
        const events = [];
        for await (const event of new MastraModelProviderAdapter({
          bridge,
          dispatch_marker: {
            mark_dispatched: async () => {
              marked = true;
            },
          },
          authorization: "LEGACY_TEST_ONLY",
        }).stream(request))
          events.push(event);
        expect(calls).toBe(1);
        expect(bodies[0]).toMatchObject({
          model: binding.default_model_id,
          response_format: { type: "json_object" },
          tool_choice: "auto",
          thinking: { type: "disabled" },
          max_tokens: 100,
        });
        expect(bodies[0]?.tools).toHaveLength(1);
        expect(bodies[0]?.messages).toEqual([
          { role: "system", content: "Return JSON." },
          ...request.messages,
        ]);
        // AUTO transmits the syntax prefix, not a second generated answer/schema
        // pass; the existing byte ceiling already reserves the full response schema.
        expect(Buffer.byteLength(JSON.stringify(responseSchema.toJSONSchema()))).toBeGreaterThan(
          Buffer.byteLength("Return JSON."),
        );
        expect(JSON.stringify(request)).toBe(original);
        expect(events.at(-1)).toMatchObject(
          valid || partialNativeTool
            ? { event_type: "COMPLETED" }
            : {
                event_type: "FAILED",
                ...(interrupted || partialNativeTool
                  ? {}
                  : {
                      reason_code: knownEmpty
                        ? "MODEL_RESPONSE_EMPTY"
                        : knownInvalidJson
                          ? "MODEL_RESPONSE_INVALID_JSON"
                          : "MODEL_STREAM_PROTOCOL_VIOLATION",
                    }),
                retryable: interrupted,
                delivery_certainty:
                  knownEmpty || knownInvalidJson
                    ? "DISPATCHED_OUTCOME_KNOWN"
                    : "DISPATCHED_OUTCOME_UNKNOWN",
              },
        );
        expect(events.filter((e) => e.event_type === "TOOL_CALL_CANDIDATE")).toHaveLength(
          tool || partialNativeTool ? 1 : 0,
        );
        if (partialNativeTool) {
          // The pinned SDK normalizes this partial input into a candidate {}.
          // A completed transport is not tool admission or known text rejection.
          expect(events).toContainEqual(
            expect.objectContaining({
              event_type: "TOOL_CALL_CANDIDATE",
              tool_call_id: "incomplete-native",
              tool_name: "semantic-query@1",
              arguments: {},
            }),
          );
          expect(events.some((event) => event.event_type === "FAILED")).toBe(false);
          const candidate = events.find((event) => event.event_type === "TOOL_CALL_CANDIDATE");
          expect(
            z.strictObject({ metric: z.string() }).safeParse(candidate?.arguments).success,
          ).toBe(false);
          expect(warning).not.toHaveBeenCalled();
        }
        if (tool)
          expect(events).toContainEqual(
            expect.objectContaining({
              event_type: "TOOL_CALL_CANDIDATE",
              tool_call_id: "native-auto-call",
              tool_name: "semantic-query@1",
              arguments: { metric: "revenue" },
            }),
          );
        else if (valid)
          expect(events.at(-1)).toMatchObject({
            output_text: '{"confidence":1,"summary":"facts"}',
          });
        if (!valid && !interrupted && !partialNativeTool) expect(warning).toHaveBeenCalledTimes(1);
        if (!valid && !interrupted && !partialNativeTool && name !== "extra field") {
          expect(JSON.parse(String(warning.mock.calls[0]?.[0]))).toMatchObject({
            stage: "AUTO_RESPONSE_INVALID_JSON",
            response: {
              finish_reason: finish === "unknown" ? "other" : finish,
              text_state:
                text.length === 0 ? "EMPTY" : text.trim().length === 0 ? "WHITESPACE" : "NON_JSON",
              text_utf8_bytes: Buffer.byteLength(text),
              streamed_text_utf8_bytes: Buffer.byteLength(text),
              text_delta_chunks: text.length === 0 ? 0 : 1,
              observed_tool_calls: 0,
              output_tokens: overBudget ? 101 : 5,
            },
          });
        }
        expect(JSON.stringify(warning.mock.calls)).not.toContain("private-invalid-answer");
      } finally {
        warning.mockRestore();
      }
    },
  );

  it("keeps the real AI SDK doStream call suspended until durable dispatch marking completes", async () => {
    const binding = getModelProviderBinding("openai");
    let streamCalls = 0;
    let markerEnteredResolve: (() => void) | undefined;
    let releaseMarker: (() => void) | undefined;
    const markerEntered = new Promise<void>((resolve) => {
      markerEnteredResolve = resolve;
    });
    const markerRelease = new Promise<void>((resolve) => {
      releaseMarker = resolve;
    });
    const fakeModel = {
      ...createOfflineStructuredModel(binding, {
        output_text: '{"summary":"deferred","confidence":0.9}',
        usage: validProviderUsage,
      }),
      doStream: async (options: unknown) => {
        streamCalls += 1;
        return createOfflineStructuredModel(binding, {
          output_text: '{"summary":"deferred","confidence":0.9}',
          usage: validProviderUsage,
        }).doStream(options as never);
      },
    } as unknown as ReturnType<typeof createProviderRuntimeModel>;
    const bridge = createMastraModelExecutionBridgeForTesting({
      credential_resolver: { resolve: async () => "offline-placeholder-credential" },
      response_schema_registry: responseSchemaRegistry,
      input_token_counter: trustedInputTokenCounter,
      runtime_model_factory: (() => fakeModel) as typeof createProviderRuntimeModel,
    });
    const adapter = new MastraModelProviderAdapter({
      bridge,
      dispatch_marker: {
        mark_dispatched: async () => {
          markerEnteredResolve?.();
          await markerRelease;
        },
      },
      authorization: "LEGACY_TEST_ONLY",
    });
    const iterator = adapter.stream(await makeInvocation(binding))[Symbol.asyncIterator]();

    const firstEvent = iterator.next();
    await markerEntered;
    expect(streamCalls).toBe(0);
    releaseMarker?.();
    await expect(firstEvent).resolves.toMatchObject({
      value: { event_type: "STARTED" },
      done: false,
    });
    expect(streamCalls).toBe(0);
    await iterator.next();
    expect(streamCalls).toBe(1);
    await iterator.return?.();
  });

  it("preserves AI SDK 429 metadata through the real Mastra bridge", async () => {
    const binding = getModelProviderBinding("openai");
    const throttled = Object.assign(new Error("must-not-leak"), {
      [Symbol.for("vercel.ai.error.AI_APICallError")]: true,
      statusCode: 429,
      isRetryable: true,
      retryAfterMs: 3_000,
      responseBody: "must-not-leak",
    });
    const fakeModel = {
      specificationVersion: "v4",
      provider: "offline-test",
      modelId: binding.default_model_id,
      supportedUrls: {},
      doGenerate: async () => {
        throw new Error("The integration uses streaming only.");
      },
      doStream: async () => {
        throw throttled;
      },
    } as unknown as ReturnType<typeof createProviderRuntimeModel>;
    const bridge = createMastraModelExecutionBridgeForTesting({
      credential_resolver: { resolve: async () => "offline-placeholder-credential" },
      response_schema_registry: responseSchemaRegistry,
      input_token_counter: trustedInputTokenCounter,
      runtime_model_factory: (() => fakeModel) as typeof createProviderRuntimeModel,
    });
    const events = [];
    for await (const event of new MastraModelProviderAdapter({
      bridge,
      dispatch_marker: { mark_dispatched: async () => undefined },
      authorization: "LEGACY_TEST_ONLY",
    }).stream(await makeInvocation(binding))) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      event_type: "THROTTLED",
      reason_code: "MODEL_PROVIDER_THROTTLED",
      delivery_certainty: "DISPATCHED_OUTCOME_KNOWN",
      retry_after_ms: 3_000,
    });
    expect(JSON.stringify(events)).not.toContain("must-not-leak");
  });

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
    const adapter = new MastraModelProviderAdapter({
      bridge,
      dispatch_marker: { mark_dispatched: async () => undefined },
      authorization: "LEGACY_TEST_ONLY",
    });
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
        availability: "AVAILABLE",
        source: "PROVIDER_REPORTED",
        input_tokens: 8,
        output_tokens: 5,
        tool_calls: 0,
        unavailable_reason: null,
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
    for await (const event of new MastraModelProviderAdapter({
      bridge,
      dispatch_marker: { mark_dispatched: async () => undefined },
      authorization: "LEGACY_TEST_ONLY",
    }).stream(await makeInvocation(binding))) {
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
    const adapter = new MastraModelProviderAdapter({
      bridge,
      dispatch_marker: { mark_dispatched: async () => undefined },
      authorization: "LEGACY_TEST_ONLY",
    });
    const events = [];

    for await (const event of adapter.stream(await makeInvocation(authorizedBinding))) {
      events.push(event);
    }

    expect(modelFactoryCalled).toBe(false);
    expect(events.map((event) => event.event_type)).toEqual(["FAILED"]);
    expect(events[0]).toMatchObject({
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

    for await (const event of new MastraModelProviderAdapter({
      bridge,
      dispatch_marker: { mark_dispatched: async () => undefined },
      authorization: "LEGACY_TEST_ONLY",
    }).stream(
      await makeInvocation(binding, {
        response_schema_version: "9.9.9",
      }),
    )) {
      events.push(event);
    }

    expect(counterCalled).toBe(false);
    expect(modelFactoryCalled).toBe(false);
    expect(events.map((event) => event.event_type)).toEqual(["FAILED"]);
    expect(events[0]).toMatchObject({
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

    for await (const event of new MastraModelProviderAdapter({
      bridge,
      dispatch_marker: { mark_dispatched: async () => undefined },
      authorization: "LEGACY_TEST_ONLY",
    }).stream(await makeInvocation(binding))) {
      events.push(event);
    }

    expect(modelFactoryCalled).toBe(false);
    expect(events.map((event) => event.event_type)).toEqual(["FAILED"]);
    expect(events[0]).toMatchObject({
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

    for await (const event of new MastraModelProviderAdapter({
      bridge,
      dispatch_marker: { mark_dispatched: async () => undefined },
      authorization: "LEGACY_TEST_ONLY",
    }).stream(await makeInvocation(binding))) {
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

    for await (const event of new MastraModelProviderAdapter({
      bridge,
      dispatch_marker: { mark_dispatched: async () => undefined },
      authorization: "LEGACY_TEST_ONLY",
    }).stream(
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

    for await (const event of new MastraModelProviderAdapter({
      bridge,
      dispatch_marker: { mark_dispatched: async () => undefined },
      authorization: "LEGACY_TEST_ONLY",
    }).stream(await makeInvocation(binding))) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({
      event_type: "FAILED",
      reason_code: "MODEL_STREAM_PROTOCOL_VIOLATION",
      retryable: false,
    });
    expect(events.some((event) => event.event_type === "TEXT_DELTA")).toBe(true);
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
  ])(
    "completes with UNAVAILABLE usage when provider %s token usage is returned",
    async (_label, usage) => {
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

      for await (const event of new MastraModelProviderAdapter({
        bridge,
        dispatch_marker: { mark_dispatched: async () => undefined },
        authorization: "LEGACY_TEST_ONLY",
      }).stream(await makeInvocation(binding))) {
        events.push(event);
      }

      expect(events.at(-1)).toMatchObject({
        event_type: "COMPLETED",
        usage: {
          availability: "UNAVAILABLE",
          source: "UNAVAILABLE",
          input_tokens: null,
          output_tokens: null,
          tool_calls: null,
          unavailable_reason: "PROVIDER_DID_NOT_REPORT_USAGE",
        },
      });
    },
  );

  it.each([
    { name: "valid", text: ' {"summary":"accepted facts","confidence":1}\n', valid: true },
    { name: "invalid JSON", text: "not JSON", valid: false },
    { name: "wrong schema", text: '{"summary":7,"confidence":1}', valid: false },
    { name: "extra field", text: '{"summary":"ok","confidence":1,"extra":true}', valid: false },
    { name: "trailing prose", text: '{"summary":"ok","confidence":1} done', valid: false },
    { name: "markdown fence", text: '```json\n{"summary":"ok","confidence":1}\n```', valid: false },
    { name: "empty", text: "", valid: false },
  ])("validates an AUTO no-tool response from text ($name)", async ({ name, text, valid }) => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const binding = getModelProviderBinding("openai");
      const bridge = createMastraModelExecutionBridgeForTesting({
        credential_resolver: { resolve: async () => "offline-placeholder-credential" },
        tool_registry: new ServerOwnedToolRegistry([
          {
            tool_name: "semantic-query@1",
            description: "Produce a governed query candidate only when needed.",
            input_schema: z.strictObject({ metric: z.string() }),
          },
        ]),
        response_schema_registry: responseSchemaRegistry,
        input_token_counter: trustedInputTokenCounter,
        tool_choice_policy: "AUTO",
        runtime_model_factory: () =>
          createOfflineStructuredModel(binding, {
            output_text: text,
            usage: validProviderUsage,
          }),
      });
      const events = [];
      for await (const event of new MastraModelProviderAdapter({
        bridge,
        dispatch_marker: { mark_dispatched: async () => undefined },
        authorization: "LEGACY_TEST_ONLY",
      }).stream(
        await makeInvocation(binding, {
          tool_allowlist: ["semantic-query@1"],
          max_tool_calls: 1,
        }),
      )) {
        events.push(event);
      }
      expect(events.filter((event) => event.event_type === "TOOL_CALL_CANDIDATE")).toEqual([]);
      if (valid) expect(warning).not.toHaveBeenCalled();
      else {
        expect(warning).toHaveBeenCalledTimes(1);
        expect(JSON.parse(String(warning.mock.calls[0]?.[0]))).toMatchObject({
          stage: ["wrong schema", "extra field"].includes(name)
            ? "RESPONSE_SCHEMA_MISMATCH"
            : "AUTO_RESPONSE_INVALID_JSON",
          dispatch_marked: true,
        });
        expect(String(warning.mock.calls[0]?.[0])).not.toContain(text || "private-empty-value");
      }
      expect(events.at(-1)).toMatchObject(
        valid
          ? {
              event_type: "COMPLETED",
              output_text: '{"confidence":1,"summary":"accepted facts"}',
            }
          : {
              event_type: "FAILED",
              reason_code:
                name === "empty"
                  ? "MODEL_RESPONSE_EMPTY"
                  : ["wrong schema", "extra field"].includes(name)
                    ? "MODEL_STREAM_PROTOCOL_VIOLATION"
                    : "MODEL_RESPONSE_INVALID_JSON",
              retryable: false,
              delivery_certainty: ["wrong schema", "extra field"].includes(name)
                ? "DISPATCHED_OUTCOME_UNKNOWN"
                : "DISPATCHED_OUTCOME_KNOWN",
            },
      );
    } finally {
      warning.mockRestore();
    }
  });

  it.each([
    {
      policy: undefined,
      expectedToolChoice: { type: "required" },
      expectedResponseFormat: "JSON" as const,
    },
    {
      policy: "AUTO" as const,
      expectedToolChoice: { type: "auto" },
      expectedResponseFormat: "NONE" as const,
    },
  ])(
    "projects an offline Mastra tool call without executing it ($policy)",
    async ({ policy, expectedToolChoice, expectedResponseFormat }) => {
      const binding = getModelProviderBinding("openai");
      let receivedResponseFormat: unknown = "not-called";
      let receivedToolChoice: unknown = "not-called";
      let receivedTemperature: unknown = "not-called";
      const fakeModel = {
        specificationVersion: "v4",
        provider: "offline-test",
        modelId: binding.default_model_id,
        supportedUrls: {},
        doGenerate: async () => {
          throw new Error("The integration uses streaming only.");
        },
        doStream: async (options: {
          readonly responseFormat?: unknown;
          readonly toolChoice?: unknown;
          readonly temperature?: unknown;
        }) => {
          receivedResponseFormat = options.responseFormat;
          receivedToolChoice = options.toolChoice;
          receivedTemperature = options.temperature;
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
                  toolName: "semantic-query_v1",
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
        ...(policy ? { tool_choice_policy: policy } : {}),
        runtime_model_factory: (() => fakeModel) as typeof createProviderRuntimeModel,
      });
      const adapter = new MastraModelProviderAdapter({
        bridge,
        dispatch_marker: { mark_dispatched: async () => undefined },
        authorization: "LEGACY_TEST_ONLY",
      });
      const events = [];

      for await (const event of adapter.stream(
        await makeInvocation(binding, {
          tool_allowlist: ["semantic-query@1"],
          max_tool_calls: 1,
          temperature: 0,
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
      if (expectedResponseFormat === "JSON") {
        expect(receivedResponseFormat).toMatchObject({ type: "json" });
      } else {
        expect(receivedResponseFormat).toBeUndefined();
      }
      expect(receivedToolChoice).toEqual(expectedToolChoice);
      expect(receivedTemperature).toBe(0);
      expect(events.at(-1)).toMatchObject({
        event_type: "COMPLETED",
        output_text: '{"summary":"需要工具候选","confidence":0.5}',
      });
    },
  );
});
