import { normalizeMastraExecutionError } from "../mastra/errors.js";
import type { ModelProviderBinding } from "./bindings.js";
import type { ProviderCredentialedSmoke } from "./certification.js";
import { authorizeLiveProviderCredentialedSmoke } from "./credentialed-smoke-authority.js";
import { ModelRuntimeError } from "./errors.js";
import { createProviderRuntimeModel } from "./provider-model-factory.js";

const REQUEST_MARKER = "CREDENTIAL_SMOKE_REQUEST_OK";
const STRUCTURED_MARKER = "structured-ok";
const TOOL_MARKER = "tool-ok";
const INVALID_CREDENTIAL_MARKER = "credentialed-smoke-intentionally-invalid";
const DEFAULT_CALL_TIMEOUT_MS = 45_000;
const AI_SDK_API_CALL_ERROR_MARKER = Symbol.for("vercel.ai.error.AI_APICallError");
const LIVE_PROVIDER_FETCH = globalThis.fetch.bind(globalThis);

const prompt = (text: string) => [
  {
    role: "user" as const,
    content: [{ type: "text" as const, text }],
  },
];

const requestOptions = {
  prompt: prompt(`Reply with only ${REQUEST_MARKER}.`),
  // Reasoning models spend part of this budget on hidden reasoning_content.
  maxOutputTokens: 256,
};

const structuredOutputOptions = {
  prompt: prompt(
    `Return JSON with exactly {"credentialed_smoke":"${STRUCTURED_MARKER}"} and no other fields.`,
  ),
  maxOutputTokens: 256,
  responseFormat: {
    type: "json" as const,
    name: "credentialed_smoke",
    schema: {
      type: "object" as const,
      properties: {
        credentialed_smoke: {
          type: "string" as const,
          enum: [STRUCTURED_MARKER],
        },
      },
      required: ["credentialed_smoke"],
      additionalProperties: false,
    },
  },
};

const toolOptions = {
  prompt: prompt("Call credentialed_smoke_tool with probe set to tool-ok."),
  maxOutputTokens: 256,
  tools: [
    {
      type: "function" as const,
      name: "credentialed_smoke_tool",
      description: "Credentialed provider capability probe.",
      inputSchema: {
        type: "object" as const,
        properties: {
          probe: {
            type: "string" as const,
            enum: [TOOL_MARKER],
          },
        },
        required: ["probe"],
        additionalProperties: false,
      },
    },
  ],
  toolChoice: {
    type: "tool" as const,
    toolName: "credentialed_smoke_tool",
  },
};

function structuredOutputProviderOptions(binding: ModelProviderBinding) {
  if (binding.provider === "deepseek") {
    return { deepseek: { thinking: { type: "disabled" as const } } };
  }
  if (binding.provider === "kimi") {
    // createOpenAICompatible derives this key from the fixed provider name `data-agent.kimi`.
    return { "data-agent": { thinking: { type: "disabled" as const } } };
  }
  return undefined;
}

const streamOptions = {
  prompt: prompt("Reply with a short non-empty acknowledgement."),
  maxOutputTokens: 256,
};

type ProviderCredentialedSmokeResult = Awaited<ReturnType<ProviderCredentialedSmoke>>;
type ProviderCredentialedSmokeChecks = ProviderCredentialedSmokeResult["checks"];

interface ProviderTransportSmokeInput {
  readonly binding: ModelProviderBinding;
  readonly credential: string;
}

interface ProviderTransportSmokeOptions {
  readonly fetch: typeof globalThis.fetch;
  readonly call_timeout_ms?: number;
}

export interface ProviderTransportSmokeObservation {
  readonly evidence_scope: "INJECTED_TRANSPORT_TEST_ONLY";
  readonly observed_model_id: string | null;
  readonly checks: ProviderCredentialedSmokeChecks;
}

interface RawSmokeObservation {
  readonly observed_model_id: string | null;
  readonly checks: ProviderCredentialedSmokeChecks;
}

function callSignal(timeoutMs: number): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
}

function textPartsContain(
  content: Awaited<
    ReturnType<ReturnType<typeof createProviderRuntimeModel>["doGenerate"]>
  >["content"],
  predicate: (text: string) => boolean,
): boolean {
  return content.some((part) => part.type === "text" && predicate(part.text));
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return null;
    }
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

function hasMarker(value: unknown, key: string, expected: string): boolean {
  return parseRecord(value)?.[key] === expected;
}

async function evaluate(check: () => Promise<boolean>): Promise<boolean> {
  try {
    return await check();
  } catch {
    return false;
  }
}

function isSanitizedSdkError(error: unknown, credential: string): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  try {
    if (Reflect.get(error, AI_SDK_API_CALL_ERROR_MARKER) !== true) {
      return false;
    }
  } catch {
    return false;
  }

  const normalized = normalizeMastraExecutionError(error);
  const publicPayload = JSON.stringify(normalized);
  return (
    normalized.reason_code === "MODEL_PROVIDER_EXECUTION_FAILED" &&
    normalized.retryable === false &&
    !publicPayload.includes(credential) &&
    !publicPayload.includes(INVALID_CREDENTIAL_MARKER)
  );
}

async function executeProviderSmoke(
  input: ProviderTransportSmokeInput,
  options: ProviderTransportSmokeOptions,
): Promise<RawSmokeObservation> {
  const timeoutMs = options.call_timeout_ms ?? DEFAULT_CALL_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new ModelRuntimeError("PROVIDER_SMOKE_ERROR", "Smoke 超时时间必须为正整数。");
  }

  const model = createProviderRuntimeModel(input.binding, input.credential, {
    fetch: options.fetch,
  });
  let observedModelId: string | null = null;

  const requestShape = await evaluate(async () => {
    const result = await model.doGenerate({
      ...requestOptions,
      abortSignal: callSignal(timeoutMs),
    });
    observedModelId =
      typeof result.response?.modelId === "string" && result.response.modelId.length > 0
        ? result.response.modelId
        : null;
    return (
      observedModelId !== null &&
      textPartsContain(result.content, (text) => text.includes(REQUEST_MARKER))
    );
  });

  const structuredOutput = await evaluate(async () => {
    const providerOptions = structuredOutputProviderOptions(input.binding);
    const result = await model.doGenerate({
      ...structuredOutputOptions,
      ...(providerOptions ? { providerOptions } : {}),
      abortSignal: callSignal(timeoutMs),
    });
    return textPartsContain(result.content, (text) =>
      hasMarker(text, "credentialed_smoke", STRUCTURED_MARKER),
    );
  });

  const toolCalling = await evaluate(async () => {
    const providerOptions = structuredOutputProviderOptions(input.binding);
    const result = await model.doGenerate({
      ...toolOptions,
      ...(providerOptions ? { providerOptions } : {}),
      abortSignal: callSignal(timeoutMs),
    });
    return result.content.some(
      (part) =>
        part.type === "tool-call" &&
        part.toolName === "credentialed_smoke_tool" &&
        hasMarker(part.input, "probe", TOOL_MARKER),
    );
  });

  const streaming = await evaluate(async () => {
    const result = await model.doStream({
      ...streamOptions,
      abortSignal: callSignal(timeoutMs),
    });
    let deltaCount = 0;
    let text = "";
    let finished = false;
    for await (const part of result.stream) {
      if (part.type === "text-delta") {
        deltaCount += 1;
        text += part.delta;
      }
      if (part.type === "finish") {
        finished = true;
      }
      if (part.type === "error") {
        return false;
      }
    }
    return deltaCount > 0 && text.trim().length > 0 && finished;
  });

  const errorNormalization = await evaluate(async () => {
    const invalidCredentialModel = createProviderRuntimeModel(
      input.binding,
      INVALID_CREDENTIAL_MARKER,
      { fetch: options.fetch },
    );
    try {
      await invalidCredentialModel.doGenerate({
        ...requestOptions,
        abortSignal: callSignal(timeoutMs),
      });
      return false;
    } catch (error) {
      return isSanitizedSdkError(error, input.credential);
    }
  });

  return Object.freeze({
    observed_model_id: observedModelId,
    checks: Object.freeze({
      request_shape: requestShape,
      structured_output: structuredOutput,
      tool_calling: toolCalling,
      streaming,
      error_normalization: errorNormalization,
    }),
  });
}

/**
 * Creates the only production-authorized credentialed smoke callback.
 *
 * It never reads environment variables. The caller must resolve the credential
 * explicitly, and the transport is fixed to the process global fetch.
 */
export function createLiveProviderCredentialedSmoke(): ProviderCredentialedSmoke {
  return authorizeLiveProviderCredentialedSmoke(async (input) => {
    const observation = await executeProviderSmoke(input, { fetch: LIVE_PROVIDER_FETCH });
    if (observation.observed_model_id === null) {
      throw new ModelRuntimeError(
        "PROVIDER_SMOKE_ERROR",
        "Provider 响应没有可绑定的 response.modelId。",
      );
    }
    return Object.freeze({
      actual_model_id: observation.observed_model_id,
      checks: observation.checks,
    });
  });
}

/**
 * Package-private no-network seam. Its result deliberately has a different
 * shape and the callback is never registered as credentialed authority.
 */
export async function runProviderTransportSmokeForTesting(
  input: ProviderTransportSmokeInput,
  options: ProviderTransportSmokeOptions,
): Promise<ProviderTransportSmokeObservation> {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Injected Provider transport 只能用于测试。");
  }
  const observation = await executeProviderSmoke(input, options);
  return Object.freeze({
    evidence_scope: "INJECTED_TRANSPORT_TEST_ONLY",
    observed_model_id: observation.observed_model_id,
    checks: observation.checks,
  });
}
