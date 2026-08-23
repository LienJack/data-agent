import {
  type AppScope,
  appScopeSchema,
  type ModelProfile,
  modelProfileSchema,
} from "@data-agent/contracts";
import { MODEL_PROVIDER_BINDINGS, type ModelProviderBinding } from "./bindings.js";

export function createUnverifiedModelProfiles(
  scopeInput: unknown,
  bindings: readonly ModelProviderBinding[] = MODEL_PROVIDER_BINDINGS,
): readonly ModelProfile[] {
  const scope: AppScope = appScopeSchema.parse(scopeInput);
  return Object.freeze(
    bindings.map((binding) =>
      modelProfileSchema.parse({
        profile_id: binding.profile_id,
        scope,
        provider: binding.provider,
        model_id: binding.default_model_id,
        profile_version: binding.profile_version,
        capabilities: binding.capabilities,
        operational_constraints: binding.operational_constraints,
        certification_status: "UNVERIFIED",
      }),
    ),
  );
}
