import "server-only";

import {
  type ModelCatalogEntry,
  type QaResourceCatalog,
  qaResourceCatalogSchema,
  type WorkspaceDatasource,
} from "@data-agent/contracts";
import { type ResolvedSystemModel, resolveSystemModelsFromProcess } from "./system-models";

export function buildQaResourceCatalog(
  input: {
    readonly models: readonly ModelCatalogEntry[];
    readonly datasources: readonly WorkspaceDatasource[];
  },
  runtimeSystemModels: readonly ResolvedSystemModel[] = resolveSystemModelsFromProcess(),
): QaResourceCatalog {
  const runtimeSystemProfileIds = new Set(runtimeSystemModels.map((model) => model.profile.id));
  const catalogProfileIds = new Set(input.models.map((model) => model.model_profile_id));

  return qaResourceCatalogSchema.parse({
    schema_version: "qa-resource-catalog@1.0.0",
    models: [
      ...input.models.map((model) => {
        const environmentCredentialReady = runtimeSystemProfileIds.has(model.model_profile_id);
        const secretReferenceReady = model.credential_ref?.rotation_state === "ACTIVE";
        const readiness =
          model.status === "UNBILLABLE"
            ? "UNBILLABLE"
            : environmentCredentialReady
              ? "RUNNABLE"
              : secretReferenceReady
                ? "CERTIFICATION_REQUIRED"
                : "CREDENTIAL_UNAVAILABLE";
        return {
          model_profile_id: model.model_profile_id,
          config_version: model.config_version,
          provider: model.provider,
          model_id: model.model_id,
          display_name: model.display_name,
          readiness,
          selectable: readiness === "RUNNABLE",
        };
      }),
      ...runtimeSystemModels.flatMap((model) =>
        catalogProfileIds.has(model.profile.id)
          ? []
          : [
              {
                model_profile_id: model.profile.id,
                config_version: 1,
                provider: model.profile.provider,
                model_id: model.profile.modelName,
                display_name: model.profile.name,
                readiness: "UNBILLABLE" as const,
                selectable: false,
              },
            ],
      ),
    ],
    datasources: input.datasources.map((datasource) => ({
      datasource_id: datasource.datasource_id,
      display_name: datasource.name,
      type: datasource.type,
      status: datasource.status === "ACTIVE" ? "ACTIVE" : "DISABLED",
      selectable: datasource.status === "ACTIVE",
    })),
  });
}
