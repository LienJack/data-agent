import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import type { ModelProviderBinding } from "./bindings.js";
import { ModelRuntimeError } from "./errors.js";

type AnthropicRuntimeModel = ReturnType<ReturnType<typeof createAnthropic>>;
type DeepSeekRuntimeModel = ReturnType<ReturnType<typeof createDeepSeek>>;
type GeminiRuntimeModel = ReturnType<ReturnType<typeof createGoogleGenerativeAI>>;
type OpenAICompatibleRuntimeModel = ReturnType<ReturnType<typeof createOpenAICompatible>>;
type OpenAIRuntimeModel = ReturnType<ReturnType<typeof createOpenAI>>;
type XaiRuntimeModel = ReturnType<ReturnType<typeof createXai>>;

const COMPATIBLE_PROVIDER_BASE_URLS = {
  deepseek: "https://api.deepseek.com/beta",
  glm: "https://open.bigmodel.cn/api/paas/v4",
  kimi: "https://api.moonshot.cn/v1",
} as const;

export type ProviderRuntimeModel =
  | AnthropicRuntimeModel
  | DeepSeekRuntimeModel
  | GeminiRuntimeModel
  | OpenAICompatibleRuntimeModel
  | OpenAIRuntimeModel
  | XaiRuntimeModel;

export interface ProviderRuntimeModelFactoryOptions {
  readonly fetch?: typeof globalThis.fetch;
}

function requireCredential(credential: string): string {
  if (credential.trim().length === 0) {
    throw new ModelRuntimeError(
      "PROVIDER_CREDENTIAL_UNAVAILABLE",
      "Model Provider Credential 不可用。",
    );
  }
  return credential;
}

function requireCompatibleBaseUrl(binding: ModelProviderBinding): string {
  const expected =
    binding.provider === "deepseek" || binding.provider === "glm" || binding.provider === "kimi"
      ? COMPATIBLE_PROVIDER_BASE_URLS[binding.provider]
      : undefined;
  if (!binding.base_url || !expected || binding.base_url !== expected) {
    throw new ModelRuntimeError(
      "MODEL_PROVIDER_NOT_REGISTERED",
      "OpenAI-Compatible Provider 必须使用代码固定的受信 Base URL。",
    );
  }
  return binding.base_url;
}

export function createProviderRuntimeModel(
  binding: ModelProviderBinding,
  credentialInput: string,
  options: ProviderRuntimeModelFactoryOptions = {},
): ProviderRuntimeModel {
  const credential = requireCredential(credentialInput);
  const fetchOptions = options.fetch ? { fetch: options.fetch } : {};
  switch (binding.provider) {
    case "openai":
      return createOpenAI({ apiKey: credential, ...fetchOptions })(binding.default_model_id);
    case "anthropic":
      return createAnthropic({ apiKey: credential, ...fetchOptions })(binding.default_model_id);
    case "deepseek":
      return createDeepSeek({
        apiKey: credential,
        baseURL: requireCompatibleBaseUrl(binding),
        ...fetchOptions,
      })(binding.default_model_id);
    case "glm":
    case "kimi":
      return createOpenAICompatible({
        name: `data-agent.${binding.provider}`,
        baseURL: requireCompatibleBaseUrl(binding),
        apiKey: credential,
        includeUsage: true,
        supportsStructuredOutputs: true,
        ...fetchOptions,
      })(binding.default_model_id);
    case "grok":
      return createXai({ apiKey: credential, ...fetchOptions })(binding.default_model_id);
    case "gemini":
      return createGoogleGenerativeAI({ apiKey: credential, ...fetchOptions })(
        binding.default_model_id,
      );
  }
}

export interface ProviderRuntimeModelInspection {
  readonly model_id: string;
  readonly provider_runtime_id: string;
  readonly specification_version: string;
}

export function inspectProviderRuntimeModel(
  binding: ModelProviderBinding,
  credential: string,
): ProviderRuntimeModelInspection {
  const model = createProviderRuntimeModel(binding, credential);
  return Object.freeze({
    model_id: model.modelId,
    provider_runtime_id: model.provider,
    specification_version: model.specificationVersion,
  });
}
