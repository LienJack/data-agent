import "server-only";

import type { ModelCatalogEntry, ModelProviderConnection } from "@data-agent/contracts";
import { MODEL_PROVIDER_PRIORITY } from "./model-provider-catalog";
import type { ModelProviderView, ProviderModelView } from "./model-provider-view";
import { type ResolvedSystemModel, resolveSystemModelsFromProcess } from "./system-models";

const DEFAULT_CAPABILITIES = Object.freeze({
  structured_output: true,
  tool_calling: true,
  streaming: true,
  reasoning: true,
  vision: false,
});

function environmentView(model: ResolvedSystemModel): ModelProviderView {
  const profile = model.profile;
  return Object.freeze({
    provider_connection_id: profile.id,
    vendor_id: profile.vendorId,
    runtime_provider: profile.provider,
    display_name: profile.name.replace(/系统模型$/, "API"),
    base_url: profile.baseUrl,
    source: "environment" as const,
    status: "ACTIVE" as const,
    health: "configured" as const,
    config_version: 1,
    immutable: true,
    credential_state: "environment" as const,
    credential_locator: null,
    created_at: profile.createdAt,
    updated_at: profile.updatedAt,
    models: Object.freeze([
      {
        model_profile_id: profile.id,
        model_id: profile.modelName,
        display_name: profile.modelName,
        status: "ACTIVE" as const,
        config_version: 1,
        capabilities: DEFAULT_CAPABILITIES,
        is_system_default: profile.isSystemDefault,
      },
    ]),
  });
}

function catalogModel(entry: ModelCatalogEntry): ProviderModelView {
  return Object.freeze({
    model_profile_id: entry.model_profile_id,
    model_id: entry.model_id,
    display_name: entry.display_name,
    status: entry.status,
    config_version: entry.config_version,
    capabilities: entry.capabilities,
    is_system_default: entry.is_system_default,
  });
}

function manualView(
  connection: ModelProviderConnection,
  catalog: readonly ModelCatalogEntry[],
): ModelProviderView {
  return Object.freeze({
    provider_connection_id: connection.provider_connection_id,
    vendor_id: connection.vendor_id,
    runtime_provider: connection.runtime_provider,
    display_name: connection.display_name,
    base_url: connection.base_url,
    source: "manual" as const,
    status: connection.status,
    health: connection.health,
    config_version: connection.config_version,
    immutable: false,
    credential_state: connection.credential_ref ? ("secret-ref" as const) : ("missing" as const),
    credential_locator: `MODEL_PROVIDER_SECRET_${connection.provider_connection_id.replaceAll("-", "").toUpperCase()}`,
    created_at: connection.created_at,
    updated_at: connection.updated_at,
    models: Object.freeze(
      catalog
        .filter((entry) => entry.provider_connection_id === connection.provider_connection_id)
        .map(catalogModel)
        .sort((left, right) =>
          left.model_id.localeCompare(right.model_id, "en", { numeric: true }),
        ),
    ),
  });
}

export function listEnvironmentProviderViews(): readonly ModelProviderView[] {
  return Object.freeze(resolveSystemModelsFromProcess().map(environmentView));
}

export function composeModelProviderViews(
  connections: readonly ModelProviderConnection[],
  catalog: readonly ModelCatalogEntry[],
): readonly ModelProviderView[] {
  return Object.freeze(
    [
      ...listEnvironmentProviderViews(),
      ...connections.map((connection) => manualView(connection, catalog)),
    ]
      .filter((connection) => connection.status === "ACTIVE")
      .sort(
        (left, right) =>
          MODEL_PROVIDER_PRIORITY[left.vendor_id] - MODEL_PROVIDER_PRIORITY[right.vendor_id] ||
          left.display_name.localeCompare(right.display_name, "zh-CN"),
      ),
  );
}

export function findEnvironmentProviderView(connectionId: string): ModelProviderView | undefined {
  return listEnvironmentProviderViews().find(
    (connection) => connection.provider_connection_id === connectionId,
  );
}

export function resolveEnvironmentProviderCredential(connectionId: string): string | undefined {
  return resolveSystemModelsFromProcess().find((model) => model.profile.id === connectionId)
    ?.credential;
}
