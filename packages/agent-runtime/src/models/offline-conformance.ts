import type { ModelProvider } from "@data-agent/contracts";
import { normalizeMastraExecutionError } from "../mastra/errors.js";
import type { ModelProviderBinding } from "./bindings.js";
import { createProviderRuntimeModel } from "./provider-model-factory.js";

export const OFFLINE_PROVIDER_BEHAVIOR_CHECKS = [
  "request_shape",
  "structured_output",
  "tool_calling",
  "streaming",
  "error_boundary",
] as const;

type OfflineBehaviorCheck = (typeof OFFLINE_PROVIDER_BEHAVIOR_CHECKS)[number];
type MockScenario = "STRUCTURED_OUTPUT" | "TOOL_CALLING" | "STREAMING" | "ERROR";

export interface OfflineProviderBehaviorCheckResult {
  readonly status: "PASS" | "FAIL";
  readonly evidence:
    | "SDK_REQUEST_AND_RESPONSE_PATH"
    | "SDK_REQUEST_SERIALIZATION"
    | "SDK_TOOL_RESPONSE_PARSER"
    | "SDK_STREAM_RESPONSE_PARSER"
    | "SANITIZED_ERROR_BOUNDARY";
  readonly reason_code?: "OFFLINE_PROVIDER_BEHAVIOR_CHECK_FAILED";
}

export interface OfflineProviderBehaviorConformance {
  readonly status: "PASS" | "FAIL";
  readonly suite_version: "2.0.0";
  readonly evidence_scope: "MOCK_TRANSPORT_SDK_BEHAVIOR";
  readonly checks: Readonly<Record<OfflineBehaviorCheck, OfflineProviderBehaviorCheckResult>>;
}

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

export interface OfflineProviderErrorBoundaryInput {
  readonly error: unknown;
  readonly request: CapturedRequest | undefined;
  readonly binding: ModelProviderBinding;
  readonly credentialMarker: string;
  readonly remoteSecretMarker: string;
}

interface MockTransport {
  readonly fetch: typeof globalThis.fetch;
  readonly captured: CapturedRequest[];
  setScenario(scenario: MockScenario): void;
}

const prompt = [
  {
    role: "user" as const,
    content: [{ type: "text" as const, text: "offline-provider-request-marker" }],
  },
];

const structuredOutputOptions = {
  prompt,
  responseFormat: {
    type: "json" as const,
    name: "offline_fixture",
    schema: {
      type: "object" as const,
      properties: {
        fixture_value: { type: "string" as const },
      },
      required: ["fixture_value"],
      additionalProperties: false,
    },
  },
};

const toolOptions = {
  prompt,
  tools: [
    {
      type: "function" as const,
      name: "lookup_metric",
      description: "Offline conformance fixture.",
      inputSchema: {
        type: "object" as const,
        properties: {
          metric: { type: "string" as const },
        },
        required: ["metric"],
        additionalProperties: false,
      },
    },
  ],
  toolChoice: { type: "auto" as const },
};

const streamOptions = {
  prompt,
  maxOutputTokens: 32,
};

function commonUsage() {
  return {
    prompt_tokens: 4,
    completion_tokens: 2,
    total_tokens: 6,
  };
}

function openAIResponsesUsage() {
  return {
    input_tokens: 4,
    output_tokens: 2,
  };
}

function structuredOutputResponse(provider: ModelProvider, modelId: string): unknown {
  const outputText = JSON.stringify({ fixture_value: "verified" });
  switch (provider) {
    case "openai":
      return {
        id: "resp-offline",
        created_at: 1,
        model: modelId,
        output: [
          {
            type: "message",
            role: "assistant",
            id: "msg-offline",
            content: [
              {
                type: "output_text",
                text: outputText,
                annotations: [],
              },
            ],
          },
        ],
        usage: openAIResponsesUsage(),
      };
    case "grok":
      return {
        id: "resp-offline",
        created_at: 1,
        model: modelId,
        object: "response",
        output: [
          {
            type: "message",
            role: "assistant",
            id: "msg-offline",
            status: "completed",
            content: [{ type: "output_text", text: outputText }],
          },
        ],
        usage: {
          ...openAIResponsesUsage(),
          total_tokens: 6,
        },
        status: "completed",
      };
    case "anthropic":
      return {
        type: "message",
        id: "msg-offline",
        model: modelId,
        content: [{ type: "text", text: outputText }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: 4,
          output_tokens: 2,
        },
      };
    case "gemini":
      return {
        responseId: "resp-offline",
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: outputText }],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 4,
          candidatesTokenCount: 2,
          totalTokenCount: 6,
        },
      };
    case "deepseek":
    case "glm":
    case "kimi":
      return {
        id: "chatcmpl-offline",
        created: 1,
        model: modelId,
        choices: [
          {
            message: {
              role: "assistant",
              content: outputText,
            },
            finish_reason: "stop",
          },
        ],
        usage: commonUsage(),
      };
  }
}

function toolCallingResponse(provider: ModelProvider, modelId: string): unknown {
  switch (provider) {
    case "openai":
      return {
        id: "resp-tool",
        created_at: 1,
        model: modelId,
        output: [
          {
            type: "function_call",
            call_id: "call-offline",
            name: "lookup_metric",
            arguments: JSON.stringify({ metric: "revenue" }),
            id: "fc-offline",
          },
        ],
        usage: openAIResponsesUsage(),
      };
    case "grok":
      return {
        id: "resp-tool",
        created_at: 1,
        model: modelId,
        object: "response",
        output: [
          {
            type: "function_call",
            call_id: "call-offline",
            name: "lookup_metric",
            arguments: JSON.stringify({ metric: "revenue" }),
            id: "fc-offline",
          },
        ],
        usage: {
          ...openAIResponsesUsage(),
          total_tokens: 6,
        },
        status: "completed",
      };
    case "anthropic":
      return {
        type: "message",
        id: "msg-tool",
        model: modelId,
        content: [
          {
            type: "tool_use",
            id: "call-offline",
            name: "lookup_metric",
            input: { metric: "revenue" },
          },
        ],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage: {
          input_tokens: 4,
          output_tokens: 2,
        },
      };
    case "gemini":
      return {
        responseId: "resp-tool",
        candidates: [
          {
            content: {
              role: "model",
              parts: [
                {
                  functionCall: {
                    name: "lookup_metric",
                    args: { metric: "revenue" },
                  },
                },
              ],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 4,
          candidatesTokenCount: 2,
          totalTokenCount: 6,
        },
      };
    case "deepseek":
    case "glm":
    case "kimi":
      return {
        id: "chatcmpl-tool",
        created: 1,
        model: modelId,
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call-offline",
                  type: "function",
                  function: {
                    name: "lookup_metric",
                    arguments: JSON.stringify({ metric: "revenue" }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: commonUsage(),
      };
  }
}

function toEventStream(events: readonly unknown[]): Response {
  const payload = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(payload, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function streamingResponse(provider: ModelProvider, modelId: string): Response {
  switch (provider) {
    case "openai":
      return toEventStream([
        {
          type: "response.output_text.delta",
          item_id: "msg-stream",
          delta: "离线",
        },
        {
          type: "response.output_text.delta",
          item_id: "msg-stream",
          delta: "流",
        },
        {
          type: "response.completed",
          response: { usage: openAIResponsesUsage() },
        },
      ]);
    case "grok":
      return toEventStream([
        {
          type: "response.output_text.delta",
          item_id: "msg-stream",
          output_index: 0,
          content_index: 0,
          delta: "离线",
        },
        {
          type: "response.output_text.delta",
          item_id: "msg-stream",
          output_index: 0,
          content_index: 0,
          delta: "流",
        },
        {
          type: "response.completed",
          response: {
            id: "resp-stream",
            created_at: 1,
            model: modelId,
            object: "response",
            output: [],
            usage: {
              ...openAIResponsesUsage(),
              total_tokens: 6,
            },
            status: "completed",
          },
        },
      ]);
    case "anthropic":
      return toEventStream([
        {
          type: "message_start",
          message: {
            id: "msg-stream",
            model: modelId,
            role: "assistant",
            usage: { input_tokens: 4 },
            content: [],
            stop_reason: null,
            container: null,
          },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "离线" },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "流" },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 2 },
        },
        { type: "message_stop" },
      ]);
    case "gemini":
      return toEventStream([
        {
          responseId: "resp-stream",
          candidates: [
            {
              content: { role: "model", parts: [{ text: "离线" }] },
            },
          ],
        },
        {
          responseId: "resp-stream",
          candidates: [
            {
              content: { role: "model", parts: [{ text: "流" }] },
              finishReason: "STOP",
            },
          ],
          usageMetadata: {
            promptTokenCount: 4,
            candidatesTokenCount: 2,
            totalTokenCount: 6,
          },
        },
      ]);
    case "deepseek":
    case "glm":
    case "kimi":
      return toEventStream([
        {
          id: "chatcmpl-stream",
          created: 1,
          model: modelId,
          choices: [
            {
              delta: { role: "assistant", content: "离线" },
              finish_reason: null,
            },
          ],
        },
        {
          id: "chatcmpl-stream",
          created: 1,
          model: modelId,
          choices: [
            {
              delta: { content: "流" },
              finish_reason: null,
            },
          ],
        },
        {
          id: "chatcmpl-stream",
          created: 1,
          model: modelId,
          choices: [
            {
              delta: {},
              finish_reason: "stop",
            },
          ],
          usage: commonUsage(),
        },
      ]);
  }
}

function providerErrorResponse(provider: ModelProvider): Response {
  const body =
    provider === "gemini"
      ? {
          error: {
            code: 401,
            message: "remote-secret-marker",
            status: "UNAUTHENTICATED",
          },
        }
      : {
          error: {
            message: "remote-secret-marker",
            type: "authentication_error",
            code: "invalid_api_key",
          },
        };
  return new Response(JSON.stringify(body), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

function inputUrl(input: Parameters<typeof globalThis.fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

async function requestBody(
  input: Parameters<typeof globalThis.fetch>[0],
  init?: Parameters<typeof globalThis.fetch>[1],
): Promise<unknown> {
  const rawBody =
    typeof init?.body === "string"
      ? init.body
      : input instanceof Request
        ? await input.clone().text()
        : "";
  return rawBody.length > 0 ? JSON.parse(rawBody) : null;
}

function createMockTransport(binding: ModelProviderBinding): MockTransport {
  let scenario: MockScenario = "STRUCTURED_OUTPUT";
  const captured: CapturedRequest[] = [];
  const mockFetch: typeof globalThis.fetch = async (input, init) => {
    captured.push({
      url: inputUrl(input),
      method: init?.method ?? (input instanceof Request ? input.method : "GET"),
      body: await requestBody(input, init),
    });
    switch (scenario) {
      case "STRUCTURED_OUTPUT":
        return new Response(
          JSON.stringify(structuredOutputResponse(binding.provider, binding.default_model_id)),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      case "TOOL_CALLING":
        return new Response(
          JSON.stringify(toolCallingResponse(binding.provider, binding.default_model_id)),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      case "STREAMING":
        return streamingResponse(binding.provider, binding.default_model_id);
      case "ERROR":
        return providerErrorResponse(binding.provider);
    }
  };
  return {
    fetch: mockFetch,
    captured,
    setScenario(nextScenario) {
      scenario = nextScenario;
    },
  };
}

function jsonContains(value: unknown, marker: string): boolean {
  return JSON.stringify(value).includes(marker);
}

function requestTargetsBinding(request: CapturedRequest, binding: ModelProviderBinding): boolean {
  const modelInUrl = decodeURIComponent(request.url).includes(binding.default_model_id);
  const modelInBody =
    typeof request.body === "object" &&
    request.body !== null &&
    "model" in request.body &&
    request.body.model === binding.default_model_id;
  return (
    request.method === "POST" &&
    request.url.startsWith("https://") &&
    (modelInUrl || modelInBody) &&
    jsonContains(request.body, "offline-provider-request-marker")
  );
}

const AI_SDK_API_CALL_ERROR_MARKER = Symbol.for("vercel.ai.error.AI_APICallError");

/**
 * Verifies the real SDK error and the same public normalization boundary used by
 * MastraModelProviderAdapter. A random exception or a locally fabricated safe
 * error cannot satisfy this conformance check.
 */
export function evaluateOfflineProviderErrorBoundary(
  input: OfflineProviderErrorBoundaryInput,
): boolean {
  const { error, request, binding, credentialMarker, remoteSecretMarker } = input;
  if (typeof error !== "object" || error === null || request === undefined) {
    return false;
  }

  let isAiSdkApiCallError = false;
  let statusCode: unknown;
  let responseBody: unknown;
  try {
    isAiSdkApiCallError = Reflect.get(error, AI_SDK_API_CALL_ERROR_MARKER) === true;
    statusCode = Reflect.get(error, "statusCode");
    responseBody = Reflect.get(error, "responseBody");
  } catch {
    return false;
  }

  if (
    !isAiSdkApiCallError ||
    statusCode !== 401 ||
    typeof responseBody !== "string" ||
    !responseBody.includes(remoteSecretMarker) ||
    !requestTargetsBinding(request, binding)
  ) {
    return false;
  }

  const normalized = normalizeMastraExecutionError(error);
  const publicPayload = JSON.stringify(normalized);
  return (
    normalized.reason_code === "MODEL_PROVIDER_EXECUTION_FAILED" &&
    normalized.retryable === false &&
    !publicPayload.includes(remoteSecretMarker) &&
    !publicPayload.includes(credentialMarker)
  );
}

function passed(
  evidence: OfflineProviderBehaviorCheckResult["evidence"],
): OfflineProviderBehaviorCheckResult {
  return Object.freeze({ status: "PASS", evidence });
}

function failed(
  evidence: OfflineProviderBehaviorCheckResult["evidence"],
): OfflineProviderBehaviorCheckResult {
  return Object.freeze({
    status: "FAIL",
    evidence,
    reason_code: "OFFLINE_PROVIDER_BEHAVIOR_CHECK_FAILED",
  });
}

async function evaluate(
  evidence: OfflineProviderBehaviorCheckResult["evidence"],
  check: () => Promise<boolean>,
): Promise<OfflineProviderBehaviorCheckResult> {
  try {
    return (await check()) ? passed(evidence) : failed(evidence);
  } catch {
    return failed(evidence);
  }
}

export async function runOfflineProviderBehaviorConformance(
  binding: ModelProviderBinding,
): Promise<OfflineProviderBehaviorConformance> {
  const transport = createMockTransport(binding);
  const model = createProviderRuntimeModel(binding, "offline-mock-credential", {
    fetch: transport.fetch,
  });

  transport.setScenario("STRUCTURED_OUTPUT");
  const structuredOutput = await evaluate("SDK_REQUEST_AND_RESPONSE_PATH", async () => {
    const result = await model.doGenerate(structuredOutputOptions);
    const request = transport.captured.at(-1);
    return (
      request !== undefined &&
      requestTargetsBinding(request, binding) &&
      jsonContains(request.body, "fixture_value") &&
      result.content.some(
        (part) =>
          part.type === "text" && part.text === JSON.stringify({ fixture_value: "verified" }),
      )
    );
  });

  const requestShape =
    structuredOutput.status === "PASS"
      ? passed("SDK_REQUEST_SERIALIZATION")
      : failed("SDK_REQUEST_SERIALIZATION");

  transport.setScenario("TOOL_CALLING");
  const toolCalling = await evaluate("SDK_TOOL_RESPONSE_PARSER", async () => {
    const result = await model.doGenerate(toolOptions);
    const request = transport.captured.at(-1);
    return (
      request !== undefined &&
      jsonContains(request.body, "lookup_metric") &&
      result.content.some(
        (part) =>
          part.type === "tool-call" &&
          part.toolName === "lookup_metric" &&
          jsonContains(part.input, "revenue"),
      )
    );
  });

  transport.setScenario("STREAMING");
  const streaming = await evaluate("SDK_STREAM_RESPONSE_PARSER", async () => {
    const result = await model.doStream(streamOptions);
    let text = "";
    let deltaCount = 0;
    let finished = false;
    for await (const part of result.stream) {
      if (part.type === "text-delta") {
        text += part.delta;
        deltaCount += 1;
      }
      if (part.type === "finish") {
        finished = true;
      }
    }
    return text === "离线流" && deltaCount >= 2 && finished;
  });

  transport.setScenario("ERROR");
  const errorBoundary = await evaluate("SANITIZED_ERROR_BOUNDARY", async () => {
    const capturedBeforeRequest = transport.captured.length;
    try {
      await model.doGenerate(structuredOutputOptions);
      return false;
    } catch (error) {
      const request = transport.captured.at(-1);
      return (
        transport.captured.length === capturedBeforeRequest + 1 &&
        evaluateOfflineProviderErrorBoundary({
          error,
          request,
          binding,
          credentialMarker: "offline-mock-credential",
          remoteSecretMarker: "remote-secret-marker",
        })
      );
    }
  });

  const checks = Object.freeze({
    request_shape: requestShape,
    structured_output: structuredOutput,
    tool_calling: toolCalling,
    streaming,
    error_boundary: errorBoundary,
  });
  return Object.freeze({
    status: Object.values(checks).every((check) => check.status === "PASS") ? "PASS" : "FAIL",
    suite_version: "2.0.0",
    evidence_scope: "MOCK_TRANSPORT_SDK_BEHAVIOR",
    checks,
  });
}
