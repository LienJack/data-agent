import type {
  ModelCatalogEntry,
  ModelProvider,
  ModelProviderConnection,
  ModelVendorId,
} from "@data-agent/contracts";

export interface ProviderModelView {
  readonly model_profile_id: string;
  readonly model_id: string;
  readonly display_name: string;
  readonly status: ModelCatalogEntry["status"];
  readonly config_version: number;
  readonly capabilities: ModelCatalogEntry["capabilities"];
  readonly is_system_default: boolean;
}

export interface ModelProviderView {
  readonly provider_connection_id: string;
  readonly vendor_id: ModelVendorId;
  readonly runtime_provider: ModelProvider;
  readonly display_name: string;
  readonly base_url: string;
  readonly source: ModelProviderConnection["source"];
  readonly status: ModelProviderConnection["status"];
  readonly health: ModelProviderConnection["health"];
  readonly config_version: number;
  readonly immutable: boolean;
  readonly credential_state: "environment" | "secret-ref" | "missing";
  readonly credential_locator: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly models: readonly ProviderModelView[];
}

export interface DiscoveredProviderModelView {
  readonly id: string;
  readonly display_name: string;
  readonly description?: string;
}
