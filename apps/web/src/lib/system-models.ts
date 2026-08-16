import "server-only";

import {
  getModelProviderBinding,
  SYSTEM_MODEL_DEPLOYMENT_OVERRIDES,
} from "@data-agent/agent-runtime";
import {
  type ModelCatalogEntry,
  type ModelProvider,
  type SyncEnvironmentModelCatalogInput,
  syncEnvironmentModelCatalogInputSchema,
} from "@data-agent/contracts";
import type { ModelConfigListItem } from "./model-types";
import { ensureRootEnvironmentLoaded } from "./root-env";

type Environment = Readonly<Record<string, string | undefined>>;

interface SystemModelDefinition {
  provider: Extract<ModelProvider, "deepseek" | "kimi" | "glm">;
  displayName: string;
  credentialNames: readonly [standard: string, alias: string];
}

export interface ResolvedSystemModel {
  profile: ModelConfigListItem;
  capabilities: ModelCatalogEntry["capabilities"];
  credential: string;
}

const SYSTEM_MODEL_DEFINITIONS: readonly SystemModelDefinition[] = Object.freeze([
  {
    provider: "deepseek",
    displayName: "DeepSeek 系统模型",
    credentialNames: ["DEEPSEEK_API_KEY", "DeepSeekAPIKey"],
  },
  {
    provider: "kimi",
    displayName: "Kimi 系统模型",
    credentialNames: ["MOONSHOT_API_KEY", "KimiAPIKey"],
  },
  {
    provider: "glm",
    displayName: "智谱 GLM 系统模型",
    credentialNames: ["ZAI_API_KEY", "GLMAPIKey"],
  },
]);

function deploymentOverride(model: ResolvedSystemModel) {
  return (
    SYSTEM_MODEL_DEPLOYMENT_OVERRIDES.find(
      (override) => override.provider === model.profile.provider,
    ) ?? { provider: model.profile.provider, model_id: model.profile.modelName }
  );
}

function credentialFrom(
  environment: Environment,
  names: SystemModelDefinition["credentialNames"],
): string | undefined {
  for (const name of names) {
    const value = environment[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function discoverSystemModels(
  environment: Environment,
  now = new Date(0).toISOString(),
): readonly ResolvedSystemModel[] {
  const configured = SYSTEM_MODEL_DEFINITIONS.flatMap((definition) => {
    const credential = credentialFrom(environment, definition.credentialNames);
    if (!credential) return [];

    const binding = getModelProviderBinding(definition.provider);
    return [
      {
        profile: {
          id: binding.profile_id,
          name: definition.displayName,
          vendorId: definition.provider,
          provider: definition.provider,
          modelName: binding.default_model_id,
          source: "environment" as const,
          isSystemModel: true,
          isSystemDefault: false,
          connectionStatus: "configured" as const,
          apiKeyMasked: "由环境变量托管",
          baseUrl: binding.base_url ?? "",
          createdAt: now,
          updatedAt: now,
        },
        capabilities: binding.capabilities,
        credential,
      },
    ];
  });

  const hasDeepSeek = configured.some((model) => model.profile.provider === "deepseek");
  return Object.freeze(
    configured.map((model, index) =>
      Object.freeze({
        ...model,
        profile: Object.freeze({
          ...model.profile,
          isSystemDefault: model.profile.provider === "deepseek" || (!hasDeepSeek && index === 0),
        }),
      }),
    ),
  );
}

/**
 * Merge environment-owned profiles into the public catalog projection.
 *
 * Environment profiles win on their stable IDs and, while DeepSeek is configured,
 * remain the only public default. Credentials are deliberately discarded here.
 */
export function mergeSystemModelsWithCatalog(
  systemModels: readonly ResolvedSystemModel[],
  catalogModels: readonly ModelConfigListItem[],
): readonly ModelConfigListItem[] {
  const systemProfiles = systemModels.map((model) => model.profile);
  const systemProfileIds = new Set(systemProfiles.map((profile) => profile.id));
  const hasSystemDefault = systemProfiles.some((profile) => profile.isSystemDefault);
  const catalogProfiles = catalogModels
    .filter((profile) => !systemProfileIds.has(profile.id))
    .map((profile) =>
      Object.freeze({
        ...profile,
        isSystemDefault: hasSystemDefault ? false : profile.isSystemDefault,
      }),
    );
  return Object.freeze([...systemProfiles, ...catalogProfiles]);
}

export function createEnvironmentModelCatalogSyncInput(
  models: readonly ResolvedSystemModel[],
): SyncEnvironmentModelCatalogInput {
  return syncEnvironmentModelCatalogInputSchema.parse({
    schema_version: "environment-model-catalog-sync@1.0.0",
    models: models.map((model) => ({
      model_profile_id: model.profile.id,
      provider: model.profile.provider,
      model_id: model.profile.modelName,
      display_name: model.profile.name,
      base_url: model.profile.baseUrl,
      capabilities: model.capabilities,
      is_system_default: model.profile.isSystemDefault,
    })),
  });
}

export function resolveSystemModelsFromProcess(): readonly ResolvedSystemModel[] {
  ensureRootEnvironmentLoaded();
  return discoverSystemModels(process.env, new Date().toISOString());
}

export function isEnvironmentSystemModelProfileId(
  profileId: string,
  environment?: Environment,
): boolean {
  const models = environment ? discoverSystemModels(environment) : resolveSystemModelsFromProcess();
  return models.some((model) => model.profile.id === profileId);
}

/** Configure the Test Center from discovered profiles without overriding operator choices. */
export function configureSystemModelRuntimeEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): readonly ResolvedSystemModel[] {
  ensureRootEnvironmentLoaded();
  const models = discoverSystemModels(environment, new Date().toISOString());
  const defaultModel = models.find((model) => model.profile.isSystemDefault);
  if (defaultModel && !environment.TEST_CENTER_MODEL_PROVIDER?.trim()) {
    environment.TEST_CENTER_MODEL_PROVIDER = defaultModel.profile.provider;
  }
  if (models.length > 0 && !environment.DATA_AGENT_MODEL_PROVIDER_OVERRIDES?.trim()) {
    environment.DATA_AGENT_MODEL_PROVIDER_OVERRIDES = JSON.stringify(
      models.map(deploymentOverride),
    );
  }
  return models;
}

export function resolveSystemModelCredential(
  provider: Extract<ModelProvider, "deepseek" | "kimi" | "glm">,
  environment: Environment = process.env,
): string | undefined {
  const definition = SYSTEM_MODEL_DEFINITIONS.find((candidate) => candidate.provider === provider);
  return definition ? credentialFrom(environment, definition.credentialNames) : undefined;
}
