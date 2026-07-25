import {
  MODEL_PROVIDERS,
  type ModelProvider,
  modelCapabilitiesSchema,
  modelOperationalConstraintsSchema,
  modelProviderSchema,
  UNVERIFIED_MODEL_OPERATIONAL_CONSTRAINTS,
  versionIdentifierSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import { ModelRuntimeError } from "./errors.js";

const providerBindingSchema = z.strictObject({
  provider: modelProviderSchema,
  profile_id: z.uuid(),
  profile_version: versionIdentifierSchema,
  adapter_version: versionIdentifierSchema,
  sdk_package: z
    .string()
    .regex(/^@ai-sdk\/[a-z0-9-]+$/)
    .max(128),
  credential_env: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]+$/)
    .max(128),
  default_model_id: z.string().min(1).max(256),
  base_url: z
    .url()
    .refine((url) => new URL(url).protocol === "https:")
    .optional(),
  capabilities: modelCapabilitiesSchema,
  operational_constraints: modelOperationalConstraintsSchema,
});

export type ModelProviderBinding = z.infer<typeof providerBindingSchema>;

const providerBindingOverrideSchema = z.strictObject({
  provider: modelProviderSchema,
  model_id: z.string().min(1).max(256),
});

export type ModelProviderBindingOverride = z.infer<typeof providerBindingOverrideSchema>;

const bindingInputs = [
  {
    provider: "openai",
    profile_id: "30000000-0000-4000-8000-000000000001",
    sdk_package: "@ai-sdk/openai",
    credential_env: "OPENAI_API_KEY",
    default_model_id: "gpt-5.4-mini",
    capabilities: {
      structured_output: true,
      tool_calling: true,
      streaming: true,
      reasoning: true,
      vision: true,
    },
    operational_constraints: UNVERIFIED_MODEL_OPERATIONAL_CONSTRAINTS,
  },
  {
    provider: "anthropic",
    profile_id: "30000000-0000-4000-8000-000000000002",
    sdk_package: "@ai-sdk/anthropic",
    credential_env: "ANTHROPIC_API_KEY",
    default_model_id: "claude-sonnet-4-5",
    capabilities: {
      structured_output: true,
      tool_calling: true,
      streaming: true,
      reasoning: true,
      vision: true,
    },
    operational_constraints: UNVERIFIED_MODEL_OPERATIONAL_CONSTRAINTS,
  },
  {
    provider: "deepseek",
    profile_id: "30000000-0000-4000-8000-000000000003",
    sdk_package: "@ai-sdk/deepseek",
    credential_env: "DEEPSEEK_API_KEY",
    default_model_id: "deepseek-v4-pro",
    base_url: "https://api.deepseek.com",
    capabilities: {
      structured_output: true,
      tool_calling: true,
      streaming: true,
      reasoning: true,
      vision: false,
    },
    operational_constraints: UNVERIFIED_MODEL_OPERATIONAL_CONSTRAINTS,
  },
  {
    provider: "glm",
    profile_id: "30000000-0000-4000-8000-000000000004",
    sdk_package: "@ai-sdk/openai-compatible",
    credential_env: "ZAI_API_KEY",
    default_model_id: "glm-5.2",
    base_url: "https://open.bigmodel.cn/api/paas/v4",
    capabilities: {
      structured_output: true,
      tool_calling: true,
      streaming: true,
      reasoning: true,
      vision: false,
    },
    operational_constraints: UNVERIFIED_MODEL_OPERATIONAL_CONSTRAINTS,
  },
  {
    provider: "kimi",
    profile_id: "30000000-0000-4000-8000-000000000005",
    sdk_package: "@ai-sdk/openai-compatible",
    credential_env: "MOONSHOT_API_KEY",
    default_model_id: "kimi-k3",
    base_url: "https://api.moonshot.cn/v1",
    capabilities: {
      structured_output: true,
      tool_calling: true,
      streaming: true,
      reasoning: true,
      vision: false,
    },
    operational_constraints: UNVERIFIED_MODEL_OPERATIONAL_CONSTRAINTS,
  },
  {
    provider: "grok",
    profile_id: "30000000-0000-4000-8000-000000000006",
    sdk_package: "@ai-sdk/xai",
    credential_env: "XAI_API_KEY",
    default_model_id: "grok-4-fast-reasoning",
    capabilities: {
      structured_output: true,
      tool_calling: true,
      streaming: true,
      reasoning: true,
      vision: true,
    },
    operational_constraints: UNVERIFIED_MODEL_OPERATIONAL_CONSTRAINTS,
  },
  {
    provider: "gemini",
    profile_id: "30000000-0000-4000-8000-000000000007",
    sdk_package: "@ai-sdk/google",
    credential_env: "GOOGLE_GENERATIVE_AI_API_KEY",
    default_model_id: "gemini-2.5-flash",
    capabilities: {
      structured_output: true,
      tool_calling: true,
      streaming: true,
      reasoning: true,
      vision: true,
    },
    operational_constraints: UNVERIFIED_MODEL_OPERATIONAL_CONSTRAINTS,
  },
] as const;

export function createModelProviderBindings(
  overridesInput: unknown = [],
): readonly ModelProviderBinding[] {
  const overrides = z
    .array(providerBindingOverrideSchema)
    .max(MODEL_PROVIDERS.length)
    .parse(overridesInput);
  const overridesByProvider = new Map<ModelProvider, ModelProviderBindingOverride>();
  for (const override of overrides) {
    if (overridesByProvider.has(override.provider)) {
      throw new ModelRuntimeError(
        "DUPLICATE_MODEL_PROVIDER_OVERRIDE",
        "同一 Model Provider 只能声明一个部署配置覆盖。",
      );
    }
    overridesByProvider.set(override.provider, override);
  }

  return Object.freeze(
    bindingInputs.map((input) => {
      const override = overridesByProvider.get(input.provider);
      return Object.freeze(
        providerBindingSchema.parse({
          ...input,
          default_model_id: override?.model_id ?? input.default_model_id,
          profile_version: "1.0.0",
          adapter_version: "1.0.0",
        }),
      );
    }),
  );
}

export const MODEL_PROVIDER_BINDINGS = createModelProviderBindings();

if (
  MODEL_PROVIDER_BINDINGS.length !== MODEL_PROVIDERS.length ||
  MODEL_PROVIDER_BINDINGS.some((binding, index) => binding.provider !== MODEL_PROVIDERS[index])
) {
  throw new ModelRuntimeError(
    "MODEL_PROVIDER_NOT_REGISTERED",
    "Model Provider Registry 必须与公共 Provider 契约完整且同序。",
  );
}

export function getModelProviderBinding(
  provider: ModelProvider,
  bindings: readonly ModelProviderBinding[] = MODEL_PROVIDER_BINDINGS,
): ModelProviderBinding {
  const parsedProvider = modelProviderSchema.parse(provider);
  const binding = bindings.find((candidate) => candidate.provider === parsedProvider);
  if (!binding) {
    throw new ModelRuntimeError("MODEL_PROVIDER_NOT_REGISTERED", "请求的 Model Provider 未注册。");
  }
  return binding;
}
