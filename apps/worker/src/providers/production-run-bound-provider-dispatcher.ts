import {
  createModelProviderExecutionBinding,
  createRootModelProviderPort,
  getModelProviderBinding,
  ROOT_AGENT_RESPONSE_SCHEMA_VERSION,
  rootAgentFinalAnswerOutputSchema,
  ServerModelResponseSchemaRegistry,
  SUBAGENT_DELEGATION_TOOL_DESCRIPTOR,
} from "@data-agent/agent-runtime";
import { artifactReferenceIdentity } from "@data-agent/contracts/artifacts";
import type { ModelExecutionProfileResolver } from "@data-agent/contracts/ports";
import {
  type AvailableExecutionModelProfile,
  authorizeAvailableExecutionModelProfile,
  verifyModelExecutionCertificationClaims,
} from "@data-agent/contracts/providers";
import type { ProviderExecutionProfile } from "@data-agent/contracts/workspaces";
import {
  createPostgresProviderInvocationStore,
  type PostgresProviderInvocationStoreOptions,
} from "@data-agent/platform/providers";
import type { AppCapability } from "@data-agent/platform/tenancy";
import type { RunBoundProviderDispatcher } from "../runs/run-execution-context.js";
import { createAuditedModelProvider } from "./audited-model-provider.js";
import { createPersistedModelProviderTransport } from "./persisted-model-provider-transport.js";
import { createPostgresAgentDataProjectionReceiptStore } from "./postgres-agent-data-projection-receipt-store.js";
import { createPostgresAuditedProviderInvocationAdapter } from "./postgres-audited-provider-invocation-store.js";
import { createPostgresProviderTaskArtifactAuthority } from "./postgres-provider-task-artifact.js";
import { createRunBoundProviderDispatcher } from "./run-bound-provider-dispatcher.js";
import { createTrustedUtf8InputTokenUpperBoundCounter } from "./trusted-input-token-upper-bound.js";

/** Credential presence can never widen the production connection Authority. */
export function resolveProductionProviderConnectionKinds(
  _environment: NodeJS.ProcessEnv,
): readonly ["SYSTEM_DEPLOYMENT"] {
  return ["SYSTEM_DEPLOYMENT"];
}

export function createProductionRunBoundProviderDispatcher(input: {
  readonly pool: PostgresProviderInvocationStoreOptions["pool"];
  readonly authorizer: PostgresProviderInvocationStoreOptions["authorizer"];
  readonly capability: AppCapability;
  readonly environment: NodeJS.ProcessEnv;
}): RunBoundProviderDispatcher {
  const invocationStore = createPostgresProviderInvocationStore({
    pool: input.pool,
    authorizer: input.authorizer,
  });
  const projectionStore = createPostgresAgentDataProjectionReceiptStore({
    pool: input.pool,
    authorizer: input.authorizer,
    capability: input.capability,
  });
  const invocationAdapter = createPostgresAuditedProviderInvocationAdapter({
    store: invocationStore,
    capability: input.capability,
  });
  const taskArtifacts = createPostgresProviderTaskArtifactAuthority({
    store: invocationStore,
    capability: input.capability,
  });
  const listProfiles = () => invocationStore.listExecutionProfiles(input.capability);

  const resolveAvailableProfile: ModelExecutionProfileResolver = async (lookup) => {
    if (
      lookup.scope.app_id !== input.capability.scope.app_id ||
      lookup.scope.tenant_id !== input.capability.scope.tenant_id ||
      lookup.scope.environment !== input.capability.scope.environment
    ) {
      return null;
    }
    const listed = await listProfiles();
    if (!listed.ok) return null;
    const technical = listed.value.find(
      (profile): profile is Extract<ProviderExecutionProfile, { readiness: "AVAILABLE" }> =>
        profile.readiness === "AVAILABLE" &&
        profile.model_profile_id === lookup.profile_id &&
        profile.model_config_version === lookup.model_config_version &&
        profile.provider === "deepseek" &&
        profile.model_id === "deepseek-v4-flash",
    );
    if (!technical) return null;
    const resolved = await invocationStore.resolveCurrentExecutionCertification(input.capability, {
      schema_version: "current-provider-execution-certification-resolve@1.0.0",
      model_profile_id: technical.model_profile_id,
      model_config_version: technical.model_config_version,
      certification_receipt_ref: technical.certification_receipt_ref,
    });
    if (!resolved.ok) return null;
    try {
      const claims = await verifyModelExecutionCertificationClaims(resolved.value);
      const snapshot = claims.execution_profile_snapshot;
      if (snapshot.connection.kind !== "SYSTEM_DEPLOYMENT") return null;
      const profile = {
        profile_id: snapshot.profile_id,
        scope: snapshot.scope,
        provider: snapshot.provider,
        model_id: snapshot.model_id,
        model_config_version: snapshot.model_config_version,
        profile_version: snapshot.profile_version,
        adapter_version: snapshot.adapter_version,
        capabilities: snapshot.capabilities,
        operational_constraints: {
          context_window: snapshot.context_window,
          region_privacy: snapshot.region_privacy,
          fallback_compatibility: snapshot.fallback_compatibility,
        },
        recovery_capabilities: snapshot.recovery_capabilities,
        connection: snapshot.connection,
        certification_status: "AVAILABLE",
        certification_receipt_ref: technical.certification_receipt_ref,
        certified_model_id: snapshot.model_id,
      } as const;
      if (
        claims.execution_profile_hash !== technical.execution_profile_hash ||
        claims.profile_id !== technical.model_profile_id ||
        claims.model_config_version !== technical.model_config_version ||
        claims.provider !== technical.provider ||
        claims.model_id !== technical.model_id
      ) {
        return null;
      }
      return await authorizeAvailableExecutionModelProfile(profile, {
        resolve: async (reference) => {
          if (
            artifactReferenceIdentity(reference) !==
            artifactReferenceIdentity(technical.certification_receipt_ref)
          ) {
            return null;
          }
          return claims;
        },
        verifyCommitted: async (reference) => {
          return (
            artifactReferenceIdentity(reference) ===
            artifactReferenceIdentity(technical.certification_receipt_ref)
          );
        },
      });
    } catch {
      return null;
    }
  };

  const responseSchemas = new ServerModelResponseSchemaRegistry([
    {
      response_schema_version: ROOT_AGENT_RESPONSE_SCHEMA_VERSION,
      schema: rootAgentFinalAnswerOutputSchema,
    },
  ]);
  const deepseekTemplate = getModelProviderBinding("deepseek");
  const registeredRootResponseSchema = responseSchemas.resolve(ROOT_AGENT_RESPONSE_SCHEMA_VERSION);
  if (!registeredRootResponseSchema) {
    throw new TypeError("ROOT_AGENT_RESPONSE_SCHEMA_NOT_REGISTERED");
  }
  const transport = createPersistedModelProviderTransport({
    profile_resolver: resolveAvailableProfile,
    model_provider_factory: {
      create: ({ mark_dispatched: markDispatched, signal }) =>
        createRootModelProviderPort({
          credential_resolver: {
            resolve: async (request) =>
              request.provider === "deepseek" &&
              request.credential_env === deepseekTemplate.credential_env
                ? (input.environment[deepseekTemplate.credential_env]?.trim() ?? null)
                : null,
          },
          binding_resolver: {
            resolve: async (request) => {
              const configVersion = Number(request.profile_version.replace("model-profile@", ""));
              if (!Number.isSafeInteger(configVersion) || configVersion < 1) return null;
              const profile: AvailableExecutionModelProfile | null = await resolveAvailableProfile({
                scope: request.scope,
                profile_id: request.profile_id,
                model_config_version: configVersion,
              });
              const listed = await listProfiles();
              const technical = listed.ok
                ? listed.value.find(
                    (candidate) =>
                      candidate.readiness === "AVAILABLE" &&
                      candidate.model_profile_id === request.profile_id &&
                      candidate.model_config_version === configVersion,
                  )
                : undefined;
              if (
                !profile ||
                !technical ||
                technical.readiness !== "AVAILABLE" ||
                profile.provider !== "deepseek" ||
                profile.model_id !== "deepseek-v4-flash" ||
                profile.profile_version !== request.profile_version
              ) {
                return null;
              }
              return createModelProviderExecutionBinding({
                template: { ...deepseekTemplate, profile_id: profile.profile_id },
                model_config_version: profile.model_config_version,
                model_id: profile.model_id,
                model_resource_hash: technical.resource_hash,
                execution_profile_hash: technical.execution_profile_hash,
                recovery_capabilities: profile.recovery_capabilities,
                connection: profile.connection,
                operational_constraints: profile.operational_constraints,
              });
            },
          },
          response_schema_registry: responseSchemas,
          input_token_counter: createTrustedUtf8InputTokenUpperBoundCounter(),
          dispatch_marker: { mark_dispatched: markDispatched },
          abort_signal: signal,
          tools: [SUBAGENT_DELEGATION_TOOL_DESCRIPTOR],
        }),
    },
  });

  return createRunBoundProviderDispatcher({
    task_artifacts: taskArtifacts,
    execution_profiles: { list: listProfiles },
    projection_store: projectionStore,
    create_audited_provider: (projectionReceipts) =>
      createAuditedModelProvider({
        invocation_store: invocationAdapter.invocation_store,
        response_artifacts: invocationAdapter.response_artifacts,
        projection_receipts: projectionReceipts,
        transport,
      }),
    allowed_providers: ["deepseek"],
    allowed_connection_kinds: resolveProductionProviderConnectionKinds(input.environment),
    system_deployment_id: input.capability.deployment_id,
    required_recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
    root_response_schema_version: ROOT_AGENT_RESPONSE_SCHEMA_VERSION,
    root_response_schema_bytes: registeredRootResponseSchema.canonical_schema_bytes,
  });
}
