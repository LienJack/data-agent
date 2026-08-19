import "server-only";

import crypto from "node:crypto";
import type { ModelProvider } from "@data-agent/contracts";
import { getDefaultModelVendorId, getModelProviderCatalogItem } from "./model-provider-catalog";
import type {
  CreateModelConfigInput,
  ModelConfig,
  ModelConfigListItem,
  ModelConfigSource,
} from "./model-types";
import { configureSystemModelRuntimeEnvironment } from "./system-models";

interface StoredModelConfig extends ModelConfigListItem {
  apiKey: string;
}

const MODEL_STORE = Symbol.for("data-agent.model-config-store");

function store(): Map<string, StoredModelConfig> {
  const globals = globalThis as typeof globalThis & {
    [MODEL_STORE]?: Map<string, StoredModelConfig>;
  };
  globals[MODEL_STORE] ??= new Map<string, StoredModelConfig>();
  return globals[MODEL_STORE];
}

function publicProjection(model: StoredModelConfig): ModelConfigListItem {
  const { apiKey: _secret, ...publicModel } = model;
  return {
    ...publicModel,
    vendorId: publicModel.vendorId ?? getDefaultModelVendorId(publicModel.provider),
  };
}

function maskManualApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

function syncSystemModels(): void {
  const models = store();
  const discovered = configureSystemModelRuntimeEnvironment();
  const discoveredIds = new Set(discovered.map((model) => model.profile.id));

  for (const [id, model] of models) {
    if (model.source === "environment" && !discoveredIds.has(id)) models.delete(id);
  }

  for (const model of discovered) {
    const existing = models.get(model.profile.id);
    models.set(model.profile.id, {
      ...model.profile,
      createdAt: existing?.createdAt ?? model.profile.createdAt,
      apiKey: model.credential,
    });
  }
}

export function initializeSystemModels(): readonly ModelConfigListItem[] {
  return listModels();
}

export function listModels(): readonly ModelConfigListItem[] {
  syncSystemModels();
  return Array.from(store().values())
    .sort((left, right) => {
      if (left.isSystemDefault !== right.isSystemDefault) return left.isSystemDefault ? -1 : 1;
      if (left.isSystemModel !== right.isSystemModel) return left.isSystemModel ? -1 : 1;
      return left.createdAt.localeCompare(right.createdAt);
    })
    .map(publicProjection);
}

export function createManualModel(input: CreateModelConfigInput): ModelConfig {
  const now = new Date().toISOString();
  const requestedProvider: ModelProvider = input.provider ?? "openai";
  const vendorId = input.vendorId ?? getDefaultModelVendorId(requestedProvider);
  const vendor = getModelProviderCatalogItem(vendorId);
  if (input.provider && input.provider !== vendor.runtimeProvider) {
    throw new ModelConfigValidationError(
      `${vendor.label} 必须使用 ${vendor.runtimeProvider} 运行协议`,
    );
  }
  const stored: StoredModelConfig = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    vendorId,
    provider: vendor.runtimeProvider,
    modelName: input.modelName?.trim() || input.name.trim(),
    source: "manual" satisfies ModelConfigSource,
    isSystemModel: false,
    isSystemDefault: false,
    connectionStatus: "unchecked",
    apiKey: input.apiKey.trim(),
    apiKeyMasked: maskManualApiKey(input.apiKey.trim()),
    baseUrl: input.baseUrl.trim().replace(/\/+$/, ""),
    createdAt: now,
    updatedAt: now,
  };
  store().set(stored.id, stored);
  return publicProjection(stored);
}

export class ModelConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelConfigValidationError";
  }
}

export type DeleteModelResult = "deleted" | "not_found" | "system_model";

export function deleteModelConfig(id: string): DeleteModelResult {
  syncSystemModels();
  const model = store().get(id);
  if (!model) return "not_found";
  if (model.isSystemModel) return "system_model";
  store().delete(id);
  return "deleted";
}
