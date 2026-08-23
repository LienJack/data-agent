import {
  createModelProviderExecutionBinding,
  createModelProviderPort,
  getModelProviderBinding,
  ROOT_AGENT_RESPONSE_SCHEMA_VERSION,
  rootAgentFinalAnswerOutputSchema,
  ServerModelResponseSchemaRegistry,
  SUBAGENT_DELEGATION_TOOL_DESCRIPTOR,
} from "@data-agent/agent-runtime";
import {
  type AvailableExecutionModelProfile,
  artifactReferenceIdentity,
  authorizeAvailableExecutionModelProfile,
  type ModelExecutionProfileResolver,
  type ProviderExecutionProfile,
  verifyModelExecutionCertificationClaims,
} from "@data-agent/contracts";
import {
  type AppCapability,
  createPostgresProviderInvocationStore,
  type SqlPool,
  type TransactionalCapabilityAuthorizer,
} from "@data-agent/platform";
import { z } from "zod";
import { createPostgresModelCertificationReceiptStore } from "../postgres-model-certification-receipt-store.js";
import type { RunBoundProviderDispatcher } from "../runs/run-execution-context.js";
import { createAuditedModelProvider } from "./audited-model-provider.js";
import { createPersistedModelProviderTransport } from "./persisted-model-provider-transport.js";
import { createPostgresAgentDataProjectionReceiptStore } from "./postgres-agent-data-projection-receipt-store.js";
import { createPostgresAuditedProviderInvocationAdapter } from "./postgres-audited-provider-invocation-store.js";
import { createPostgresProviderTaskArtifactAuthority } from "./postgres-provider-task-artifact.js";
import { createRunBoundProviderDispatcher } from "./run-bound-provider-dispatcher.js";
import { createTrustedUtf8InputTokenUpperBoundCounter } from "./trusted-input-token-upper-bound.js";

const U3_RESPONSE_SCHEMA_VERSION = "qa-answer@1.0.0";
export const TEXT2SQL_SPECIALIST_RESPONSE_SCHEMA_VERSION = "text2sql-specialist-answer@1.0.0";
export const REPORT_SPECIALIST_RESPONSE_SCHEMA_VERSION = "report-specialist-answer@1.0.0";

/** Credential presence can never widen the production connection Authority. */
export function resolveProductionProviderConnectionKinds(
  _environment: NodeJS.ProcessEnv,
): readonly ["SYSTEM_DEPLOYMENT"] {
  return ["SYSTEM_DEPLOYMENT"];
}

export function createProductionRunBoundProviderDispatcher(input: {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
  readonly capability: AppCapability;
  readonly environment: NodeJS.ProcessEnv;
}): RunBoundProviderDispatcher {
  const invocationStore = createPostgresProviderInvocationStore({
    pool: input.pool,
    authorizer: input.authorizer,
  });
  const certificationStore = createPostgresModelCertificationReceiptStore({
    pool: input.pool,
    authorizer: input.authorizer,
    capability: input.capability,
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
    const resolved = await certificationStore.resolve(technical.certification_receipt_ref);
    const committed = await certificationStore.verify(technical.certification_receipt_ref);
    if (!resolved.ok || !resolved.value || !committed.ok || !committed.value) return null;
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
          const current = await certificationStore.resolve(reference);
          return current.ok ? current.value : null;
        },
        verifyCommitted: async (reference) => {
          if (
            artifactReferenceIdentity(reference) !==
            artifactReferenceIdentity(technical.certification_receipt_ref)
          ) {
            return false;
          }
          const current = await certificationStore.verify(reference);
          return current.ok && current.value;
        },
      });
    } catch {
      return null;
    }
  };

  const responseSchemas = new ServerModelResponseSchemaRegistry([
    {
      response_schema_version: U3_RESPONSE_SCHEMA_VERSION,
      schema: z.strictObject({
        answer: z.string().min(1),
        query_kind: z.enum(["TABLE_COUNT", "MONTHLY_ORDER_TREND", "UNSUPPORTED"]).optional(),
      }),
    },
    {
      response_schema_version: ROOT_AGENT_RESPONSE_SCHEMA_VERSION,
      schema: rootAgentFinalAnswerOutputSchema,
    },
    {
      response_schema_version: TEXT2SQL_SPECIALIST_RESPONSE_SCHEMA_VERSION,
      schema: z.strictObject({
        answer: z.string().min(1),
        query_kind: z.enum(["TABLE_COUNT", "MONTHLY_ORDER_TREND", "UNSUPPORTED"]),
      }),
    },
    {
      response_schema_version: REPORT_SPECIALIST_RESPONSE_SCHEMA_VERSION,
      schema: z.strictObject({ answer: z.string().min(1) }),
    },
  ]);
  const deepseekTemplate = getModelProviderBinding("deepseek");
  const registeredResponseSchema = responseSchemas.resolve(U3_RESPONSE_SCHEMA_VERSION);
  const registeredRootResponseSchema = responseSchemas.resolve(ROOT_AGENT_RESPONSE_SCHEMA_VERSION);
  const registeredText2SqlResponseSchema = responseSchemas.resolve(
    TEXT2SQL_SPECIALIST_RESPONSE_SCHEMA_VERSION,
  );
  const registeredReportResponseSchema = responseSchemas.resolve(
    REPORT_SPECIALIST_RESPONSE_SCHEMA_VERSION,
  );
  if (!registeredResponseSchema) {
    throw new TypeError("U3_RESPONSE_SCHEMA_NOT_REGISTERED");
  }
  if (!registeredRootResponseSchema) {
    throw new TypeError("ROOT_AGENT_RESPONSE_SCHEMA_NOT_REGISTERED");
  }
  if (!registeredText2SqlResponseSchema || !registeredReportResponseSchema) {
    throw new TypeError("SPECIALIST_RESPONSE_SCHEMA_NOT_REGISTERED");
  }
  const transport = createPersistedModelProviderTransport({
    profile_resolver: resolveAvailableProfile,
    model_provider_factory: {
      create: ({ mark_dispatched: markDispatched, signal }) =>
        createModelProviderPort({
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
    response_schema_version: U3_RESPONSE_SCHEMA_VERSION,
    response_schema_bytes: registeredResponseSchema.canonical_schema_bytes,
    root_response_schema_version: ROOT_AGENT_RESPONSE_SCHEMA_VERSION,
    root_response_schema_bytes: registeredRootResponseSchema.canonical_schema_bytes,
    text2sql_response_schema_version: TEXT2SQL_SPECIALIST_RESPONSE_SCHEMA_VERSION,
    text2sql_response_schema_bytes: registeredText2SqlResponseSchema.canonical_schema_bytes,
    report_response_schema_version: REPORT_SPECIALIST_RESPONSE_SCHEMA_VERSION,
    report_response_schema_bytes: registeredReportResponseSchema.canonical_schema_bytes,
  });
}
