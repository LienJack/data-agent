import { randomUUID } from "node:crypto";
import {
  createDirectModelProviderPort,
  createModelProviderBindings,
  type ModelProviderBinding,
  type SemanticAgentTurnInvocationFactory,
  ServerModelResponseSchemaRegistry,
  SYSTEM_MODEL_DEPLOYMENT_OVERRIDES,
} from "@data-agent/agent-runtime";
import {
  type AppScope,
  createDirectModelProviderInvocation,
  modelProviderSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import type {
  AppCapability,
  createPostgresSemanticAuthoringProviderInvocation,
  SqlPool,
  TransactionalCapabilityAuthorizer,
} from "@data-agent/platform";
import {
  semanticAuthoringModelToolCatalog,
  semanticAuthoringToolCatalog,
} from "@data-agent/semantic/authoring";
import { z } from "zod";

const SEMANTIC_AGENT_RESPONSE_SCHEMA_VERSION = "semantic-agent-turn@1.0.0";
const MODEL_RESPONSE_SCHEMA_OVERHEAD_BYTES = 4_096;

/** @deprecated Retained only for replay tests; production direct calls do not use it. */
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

export interface DirectConfiguredModelProfile {
  readonly profile_id: string;
  readonly scope: AppScope;
  readonly provider: ModelProviderBinding["provider"];
  readonly model_id: string;
  readonly profile_version: string;
  readonly capabilities: ModelProviderBinding["capabilities"];
  readonly operational_constraints: ModelProviderBinding["operational_constraints"];
}

export interface SemanticAuthoringModelRuntime {
  readonly profile: DirectConfiguredModelProfile;
  readonly binding: ModelProviderBinding;
  readonly for_domain: (semanticDomain: string) => {
    readonly model_provider: ReturnType<typeof createDirectModelProviderPort>;
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
  try {
    const overrides = environment.DATA_AGENT_MODEL_PROVIDER_OVERRIDES
      ? JSON.parse(environment.DATA_AGENT_MODEL_PROVIDER_OVERRIDES)
      : SYSTEM_MODEL_DEPLOYMENT_OVERRIDES;
    return (
      createModelProviderBindings(overrides).find(
        (candidate) => candidate.provider === provider.data,
      ) ?? null
    );
  } catch {
    return null;
  }
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

/**
 * Resolve a server-configured semantic-authoring model directly. No model
 * certification receipt, invocation intent, dispatch permit, or commercial
 * lifecycle participates in this path.
 */
export async function resolveSemanticAuthoringModelRuntime(input: {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
  readonly capability: AppCapability;
  readonly environment?: NodeJS.ProcessEnv;
}): Promise<SemanticAuthoringModelRuntime | null> {
  const environment = input.environment ?? process.env;
  const binding = configuredBinding(environment);
  if (!binding || !environment[binding.credential_env]?.trim()) return null;

  const profile: DirectConfiguredModelProfile = Object.freeze({
    profile_id: binding.profile_id,
    scope: input.capability.scope,
    provider: binding.provider,
    model_id: binding.default_model_id,
    profile_version: binding.profile_version,
    capabilities: binding.capabilities,
    operational_constraints: binding.operational_constraints,
  });
  const responseSchemas = new ServerModelResponseSchemaRegistry([
    {
      response_schema_version: SEMANTIC_AGENT_RESPONSE_SCHEMA_VERSION,
      schema: z.record(z.string(), z.json()),
    },
  ]);
  const tools = semanticAuthoringModelToolCatalog();
  const tokenCountTools = semanticAuthoringToolCatalog();
  const modelProvider = createDirectModelProviderPort({
    credential_resolver: {
      resolve: async (request) =>
        request.scope.app_id === profile.scope.app_id &&
        request.scope.tenant_id === profile.scope.tenant_id &&
        request.scope.environment === profile.scope.environment &&
        request.provider === binding.provider &&
        request.credential_env === binding.credential_env
          ? (environment[binding.credential_env]?.trim() ?? null)
          : null,
    },
    binding_resolver: {
      resolve: async (request) =>
        request.scope.app_id === profile.scope.app_id &&
        request.scope.tenant_id === profile.scope.tenant_id &&
        request.scope.environment === profile.scope.environment &&
        request.provider === binding.provider &&
        request.profile_id === binding.profile_id &&
        request.profile_version === binding.profile_version
          ? binding
          : null,
    },
    response_schema_registry: responseSchemas,
    input_token_counter: {
      count: async (context) => trustedInputTokenUpperBound({ ...context, tools: tokenCountTools }),
    },
    tools,
    dispatch_marker: { mark_dispatched: async () => {} },
  });

  return Object.freeze({
    profile,
    binding,
    for_domain: (_semanticDomain: string) => {
      const createInvocation: SemanticAgentTurnInvocationFactory = async (material) => {
        const contentHash = await sha256ContentHash({
          messages: material.messages,
          tool_allowlist: material.tool_allowlist,
          turn_index: material.turn.turn_index,
        });
        return createDirectModelProviderInvocation({
          schema_version: "semantic-provider-direct@1.0.0",
          request_id: material.turn.request_id,
          attempt_id: randomUUID(),
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
        });
      };
      return Object.freeze({ model_provider: modelProvider, create_invocation: createInvocation });
    },
  });
}
