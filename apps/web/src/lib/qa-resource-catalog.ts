import "server-only";

import {
  type ModelCertificationPublicView,
  type ProviderExecutionProfile,
  type QaResourceCatalog,
  qaResourceCatalogSchema,
  type WorkspaceDatasource,
} from "@data-agent/contracts";

export function buildQaResourceCatalog(input: {
  readonly models: readonly ProviderExecutionProfile[];
  readonly authentications?: readonly ModelCertificationPublicView[];
  readonly datasources: readonly WorkspaceDatasource[];
}): QaResourceCatalog {
  const authenticationByProfile = new Map(
    (input.authentications ?? []).map((authentication) => [
      authentication.model_profile_id,
      authentication,
    ]),
  );
  return qaResourceCatalogSchema.parse({
    schema_version: "qa-resource-catalog@1.0.0",
    models: input.models.map((model) => {
      const authentication = authenticationByProfile.get(model.model_profile_id);
      const apiAuthenticated =
        authentication?.state === "PASS" &&
        authentication.model_config_version === model.model_config_version;
      const apiSelectable =
        apiAuthenticated && model.readiness !== "DISABLED" && model.readiness !== "STALE";
      return {
        model_profile_id: model.model_profile_id,
        config_version: model.model_config_version,
        profile_version: model.profile_version,
        provider: model.provider,
        model_id: model.model_id,
        display_name: model.display_name,
        certification_receipt_ref:
          model.readiness === "AVAILABLE" ? model.certification_receipt_ref : null,
        api_authentication_state: apiAuthenticated ? "PASS" : "NOT_CERTIFIED",
        effective_context_ceiling_tokens:
          model.readiness === "AVAILABLE" ? model.effective_context_ceiling_tokens : null,
        effective_output_ceiling_tokens:
          model.readiness === "AVAILABLE" ? model.effective_output_ceiling_tokens : null,
        readiness: apiSelectable ? "AVAILABLE" : model.readiness,
        selectable: apiSelectable || model.selectable,
      };
    }),
    datasources: input.datasources.map((datasource) => ({
      datasource_id: datasource.datasource_id,
      display_name: datasource.name,
      type: datasource.type,
      status: datasource.status === "ACTIVE" ? "ACTIVE" : "DISABLED",
      selectable: datasource.status === "ACTIVE",
    })),
  });
}
