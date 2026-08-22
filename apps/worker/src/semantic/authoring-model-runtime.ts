import { randomUUID } from "node:crypto";
import {
  createModelProviderBindings,
  createSemanticAuthoringModelProviderPort,
  type ModelProviderBinding,
  type ModelProviderPortCompositionInput,
  type SemanticAgentTurnInvocationFactory,
  ServerModelResponseSchemaRegistry,
  SYSTEM_MODEL_DEPLOYMENT_OVERRIDES,
} from "@data-agent/agent-runtime";
import {
  type ArtifactReference,
  type AvailableExecutionModelProfile,
  artifactReferenceIdentity,
  artifactReferenceSchema,
  authorizeAvailableExecutionModelProfile,
  authorizeSemanticAuthoringModelProviderInvocation,
  modelExecutionCertificationClaimsSchema,
  modelProviderSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import {
  type AppCapability,
  createPostgresSemanticAuthoringProviderInvocation,
  type SqlPool,
  type TransactionalCapabilityAuthorizer,
  withAppTransaction,
} from "@data-agent/platform";
import {
  semanticAuthoringModelToolCatalog,
  semanticAuthoringToolCatalog,
} from "@data-agent/semantic";
import { z } from "zod";

const SEMANTIC_AGENT_RESPONSE_SCHEMA_VERSION = "semantic-agent-turn@1.0.0";
const MODEL_RESPONSE_SCHEMA_OVERHEAD_BYTES = 4_096;
type ModelExecutionCertificationClaims = z.infer<typeof modelExecutionCertificationClaimsSchema>;

export async function resolveSemanticAuthoringProviderAttempt(input: {
  readonly lifecycle: Pick<
    ReturnType<typeof createPostgresSemanticAuthoringProviderInvocation>,
    "loadPendingIntentAttempt"
  >;
  readonly authoring_run_id: string;
  readonly turn_index: number;
  readonly request_id: string;
  readonly new_id?: () => string;
}): Promise<string> {
  const persistedAttempt = await input.lifecycle.loadPendingIntentAttempt({
    run_id: input.authoring_run_id,
    turn_index: input.turn_index,
    request_id: input.request_id,
  });
  return persistedAttempt ?? (input.new_id ?? randomUUID)();
}

interface StoredCertificationReceiptRow {
  readonly run_id: string;
  readonly artifact_id: string;
  readonly revision: number;
  readonly content_hash: string;
  readonly document_json: unknown;
}

export interface SemanticAuthoringModelRuntime {
  readonly profile: AvailableExecutionModelProfile;
  readonly binding: ModelProviderBinding;
  readonly for_domain: (semanticDomain: string) => {
    readonly model_provider: ReturnType<typeof createSemanticAuthoringModelProviderPort>;
    readonly create_invocation: SemanticAgentTurnInvocationFactory;
  };
}

function configuredBinding(environment: NodeJS.ProcessEnv): ModelProviderBinding | null {
  const provider = modelProviderSchema.safeParse(
    environment.SEMANTIC_AUTHORING_MODEL_PROVIDER ??
      environment.TEST_CENTER_MODEL_PROVIDER ??
      "deepseek",
  );
  if (!provider.success) return null;
  let overrides: unknown = SYSTEM_MODEL_DEPLOYMENT_OVERRIDES;
  try {
    if (environment.DATA_AGENT_MODEL_PROVIDER_OVERRIDES) {
      overrides = JSON.parse(environment.DATA_AGENT_MODEL_PROVIDER_OVERRIDES);
    }
    return (
      createModelProviderBindings(overrides).find(
        (candidate) => candidate.provider === provider.data,
      ) ?? null
    );
  } catch {
    return null;
  }
}

async function resolvePersistedReceipt(input: {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
  readonly capability: AppCapability;
  readonly binding: ModelProviderBinding;
}): Promise<{
  readonly reference: ArtifactReference;
  readonly claims: ModelExecutionCertificationClaims;
} | null> {
  const result = await withAppTransaction(
    input.pool,
    input.authorizer,
    input.capability,
    {
      access: "READ",
      operation_name: "semantic.resolve_authoring_model_receipt",
    },
    async ({ capability, client }) => {
      const query = await client.query<StoredCertificationReceiptRow>(
        `select run_id, artifact_id, revision, content_hash, document_json
           from app_data_agent.artifacts
          where app_id = $1::uuid
            and tenant_id = $2::uuid
            and environment = $3::text
            and artifact_type = 'ModelCertificationReceipt'
            and revision = 1
            and is_active
            and document_json ->> 'profile_id' = $4::text
            and document_json ->> 'provider' = $5::text
            and document_json ->> 'model_id' = $6::text
            and document_json ->> 'verdict' = 'PASS'
          order by created_at desc
          limit 1`,
        [
          capability.scope.app_id,
          capability.scope.tenant_id,
          capability.scope.environment,
          input.binding.profile_id,
          input.binding.provider,
          input.binding.default_model_id,
        ],
      );
      return query.rows[0] ?? null;
    },
  );
  if (!result.ok || !result.value) return null;
  const claims = modelExecutionCertificationClaimsSchema.safeParse(result.value.document_json);
  const reference = artifactReferenceSchema.safeParse({
    artifact_id: result.value.artifact_id,
    artifact_type: "ModelCertificationReceipt",
    ...input.capability.scope,
    run_id: result.value.run_id,
    revision: result.value.revision,
    content_hash: result.value.content_hash,
  });
  return claims.success && reference.success
    ? Object.freeze({ reference: reference.data, claims: claims.data })
    : null;
}

function trustedInputTokenUpperBound(input: {
  readonly instructions: string;
  readonly messages: readonly { readonly role: string; readonly content: string }[];
  readonly tools: readonly unknown[];
  readonly response_schema_version: string;
}): number {
  return (
    Buffer.byteLength(
      JSON.stringify({
        instructions: input.instructions,
        messages: input.messages,
        tools: input.tools,
        response_schema_version: input.response_schema_version,
      }),
      "utf8",
    ) + MODEL_RESPONSE_SCHEMA_OVERHEAD_BYTES
  );
}

export async function resolveSemanticAuthoringModelRuntime(input: {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
  readonly capability: AppCapability;
  readonly environment?: NodeJS.ProcessEnv;
}): Promise<SemanticAuthoringModelRuntime | null> {
  const environment = input.environment ?? process.env;
  const binding = configuredBinding(environment);
  if (!binding || !environment[binding.credential_env]?.trim()) return null;
  const receipt = await resolvePersistedReceipt({ ...input, binding });
  if (!receipt) return null;
  const receiptIdentity = artifactReferenceIdentity(receipt.reference);
  const snapshot = receipt.claims.execution_profile_snapshot;
  const certifiedBinding: ModelProviderBinding = Object.freeze({
    ...binding,
    default_model_id: snapshot.model_id,
    profile_version: snapshot.profile_version,
    adapter_version: snapshot.adapter_version,
    capabilities: snapshot.capabilities,
    operational_constraints: {
      context_window: snapshot.context_window,
      region_privacy: snapshot.region_privacy,
      pricing: { verification_status: "UNVERIFIED" as const },
      fallback_compatibility: snapshot.fallback_compatibility,
    },
  });
  let profile: AvailableExecutionModelProfile;
  try {
    profile = await authorizeAvailableExecutionModelProfile(
      {
        profile_id: snapshot.profile_id,
        scope: snapshot.scope,
        provider: snapshot.provider,
        model_id: snapshot.model_id,
        model_config_version: snapshot.model_config_version,
        profile_version: snapshot.profile_version,
        adapter_version: snapshot.adapter_version,
        capabilities: snapshot.capabilities,
        operational_constraints: certifiedBinding.operational_constraints,
        recovery_capabilities: snapshot.recovery_capabilities,
        connection: snapshot.connection,
        certification_status: "AVAILABLE",
        certification_receipt_ref: receipt.reference,
        certified_model_id: snapshot.model_id,
      },
      {
        resolve: async (reference) =>
          "artifact_type" in reference && artifactReferenceIdentity(reference) === receiptIdentity
            ? receipt.claims
            : null,
        verifyCommitted: async (reference) =>
          "artifact_type" in reference && artifactReferenceIdentity(reference) === receiptIdentity,
      },
    );
  } catch {
    return null;
  }

  const responseSchemas = new ServerModelResponseSchemaRegistry([
    {
      response_schema_version: SEMANTIC_AGENT_RESPONSE_SCHEMA_VERSION,
      // Tool turns do not request structured output, but the version remains
      // server registered so a no-tool response still fails closed.
      schema: z.record(z.string(), z.json()),
    },
  ]);
  const tools = semanticAuthoringModelToolCatalog();
  const tokenCountTools = semanticAuthoringToolCatalog();
  const commonComposition: Omit<
    ModelProviderPortCompositionInput,
    "dispatch_marker" | "terminal_recorder"
  > = {
    credential_resolver: {
      resolve: async (request) =>
        request.scope.app_id === input.capability.scope.app_id &&
        request.scope.tenant_id === input.capability.scope.tenant_id &&
        request.scope.environment === input.capability.scope.environment &&
        request.provider === certifiedBinding.provider &&
        request.credential_env === certifiedBinding.credential_env
          ? (environment[certifiedBinding.credential_env]?.trim() ?? null)
          : null,
    },
    binding_resolver: {
      resolve: async (request) =>
        request.scope.app_id === input.capability.scope.app_id &&
        request.scope.tenant_id === input.capability.scope.tenant_id &&
        request.scope.environment === input.capability.scope.environment &&
        request.provider === certifiedBinding.provider &&
        request.profile_id === certifiedBinding.profile_id &&
        request.profile_version === certifiedBinding.profile_version
          ? certifiedBinding
          : null,
    },
    response_schema_registry: responseSchemas,
    input_token_counter: {
      count: async (context) => trustedInputTokenUpperBound({ ...context, tools: tokenCountTools }),
    },
    tools,
  } as const;

  return Object.freeze({
    profile,
    binding: certifiedBinding,
    for_domain: (semanticDomain: string) => {
      const lifecycle = createPostgresSemanticAuthoringProviderInvocation({
        pool: input.pool,
        authorizer: input.authorizer,
        capability: input.capability,
        semantic_domain: semanticDomain,
      });
      const modelProvider = createSemanticAuthoringModelProviderPort({
        ...commonComposition,
        dispatch_marker: { mark_dispatched: (request) => lifecycle.markDispatched(request) },
        terminal_recorder: {
          mark_response_observed: (value) => lifecycle.markResponseObserved(value),
          commit_terminal: (value) => lifecycle.commitTerminal(value),
        },
      });
      const createInvocation: SemanticAgentTurnInvocationFactory = async (material) => {
        const contentHash = await sha256ContentHash({
          messages: material.messages,
          tool_allowlist: material.tool_allowlist,
          turn_index: material.turn.turn_index,
        });
        const attemptId = await resolveSemanticAuthoringProviderAttempt({
          lifecycle,
          authoring_run_id: material.turn.authoring_run_id,
          turn_index: material.turn.turn_index,
          request_id: material.turn.request_id,
        });
        return authorizeSemanticAuthoringModelProviderInvocation(
          {
            schema_version: "semantic-provider@1",
            request_id: material.turn.request_id,
            attempt_id: attemptId,
            scope: material.turn.scope,
            run_id: material.turn.authoring_run_id,
            provider: profile.provider,
            profile_id: profile.profile_id,
            profile_version: profile.profile_version,
            model_id: profile.model_id,
            task_ref: {
              artifact_id: material.turn.candidate_id,
              artifact_type: "SemanticGraphCandidate",
              ...material.turn.scope,
              run_id: material.turn.authoring_run_id,
              revision: material.turn.turn_index,
              content_hash: contentHash,
            },
            context_refs: [],
            messages: material.messages,
            tool_allowlist: material.tool_allowlist,
            response_schema_version: SEMANTIC_AGENT_RESPONSE_SCHEMA_VERSION,
            budget: material.budget,
          },
          async ({ scope, profile_id: profileId }) =>
            scope.app_id === profile.scope.app_id &&
            scope.tenant_id === profile.scope.tenant_id &&
            scope.environment === profile.scope.environment &&
            profileId === profile.profile_id
              ? profile
              : null,
          (request) => lifecycle.commitIntent(request),
        );
      };
      return Object.freeze({ model_provider: modelProvider, create_invocation: createInvocation });
    },
  });
}
