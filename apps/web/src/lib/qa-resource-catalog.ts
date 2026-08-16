import "server-only";

import {
  type ProviderExecutionProfile,
  type QaResourceCatalog,
  qaResourceCatalogSchema,
  type WorkspaceDatasource,
} from "@data-agent/contracts";

export function buildQaResourceCatalog(input: {
  readonly models: readonly ProviderExecutionProfile[];
  readonly datasources: readonly WorkspaceDatasource[];
}): QaResourceCatalog {
  return qaResourceCatalogSchema.parse({
    schema_version: "qa-resource-catalog@1.0.0",
    models: input.models.map((model) => ({
      model_profile_id: model.model_profile_id,
      config_version: model.model_config_version,
      profile_version: model.profile_version,
      provider: model.provider,
      model_id: model.model_id,
      display_name: model.display_name,
      certification_receipt_ref:
        model.readiness === "AVAILABLE" ? model.certification_receipt_ref : null,
      effective_context_ceiling_tokens:
        model.readiness === "AVAILABLE" ? model.effective_context_ceiling_tokens : null,
      effective_output_ceiling_tokens:
        model.readiness === "AVAILABLE" ? model.effective_output_ceiling_tokens : null,
      readiness: model.readiness,
      selectable: model.selectable,
    })),
    datasources: input.datasources.map((datasource) => ({
      datasource_id: datasource.datasource_id,
      display_name: datasource.name,
      type: datasource.type,
      status: datasource.status === "ACTIVE" ? "ACTIVE" : "DISABLED",
      selectable: datasource.status === "ACTIVE",
    })),
  });
}
