import { z } from "zod";
import { artifactReferenceIdentity, artifactReferenceSchema } from "../artifacts/envelope.js";
import { verifyAgentDataProjectionReceiptV2Candidate } from "../artifacts/research/system.js";
import {
  type AppScope,
  appScopeSchema,
  canonicalizeJson,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import {
  type AvailableExecutionModelProfile,
  type AvailableModelProfile,
  computeModelExecutionProfileHash,
  isAvailableExecutionModelProfile,
  isAvailableModelProfile,
  modelProviderSchema,
} from "../providers/index.js";
import {
  type AuthoritativeCommittedProviderDispatchPermit,
  agentDataProjectionReceiptReferenceSchema,
  isAuthoritativeCommittedProviderDispatchPermit,
  providerInvocationConnectionProofSchema,
  providerInvocationRecoveryCapabilitiesSchema,
  verifyProviderDispatchEnvelopeCandidate,
} from "../providers/provider-invocation.js";
import { assertPortEventCorrelation } from "./event-correlation.js";

const modelMessageSchema = z.strictObject({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string().min(1).max(200_000),
  tool_call_id: z.string().min(1).max(256).optional(),
});

export const modelProviderRequestSchema = z
  .strictObject({
    schema_version: versionIdentifierSchema,
    request_id: immutableIdSchema,
    attempt_id: immutableIdSchema,
    scope: appScopeSchema,
    run_id: immutableIdSchema,
    provider: modelProviderSchema,
    profile_id: immutableIdSchema,
    profile_version: versionIdentifierSchema,
    model_id: z.string().min(1).max(256),
    model_config_version: z.number().int().positive().safe().optional(),
    execution_profile_hash: contentHashSchema.optional(),
    recovery_capabilities: providerInvocationRecoveryCapabilitiesSchema.optional(),
    connection: providerInvocationConnectionProofSchema.optional(),
    token_bound_policy_version: z.literal("utf8-byte-upper-bound@1.0.0").optional(),
    trusted_input_token_upper_bound: z.number().int().nonnegative().safe().optional(),
    task_ref: artifactReferenceSchema,
    context_refs: z.array(artifactReferenceSchema).max(64),
    messages: z.array(modelMessageSchema).min(1).max(256),
    tool_allowlist: z.array(versionIdentifierSchema).max(64),
    response_schema_version: versionIdentifierSchema,
    budget: z.strictObject({
      timeout_ms: z.number().int().positive().max(600_000),
      max_input_tokens: z.number().int().positive(),
      max_output_tokens: z.number().int().positive(),
      max_tool_calls: z.number().int().nonnegative(),
    }),
  })
  .superRefine((request, ctx) => {
    if (
      [request.task_ref, ...request.context_refs].some(
        (reference) =>
          reference.app_id !== request.scope.app_id ||
          reference.tenant_id !== request.scope.tenant_id ||
          reference.environment !== request.scope.environment ||
          reference.run_id !== request.run_id,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Model Request 的 Artifact 必须属于同一 App/Tenant/Environment/Run。",
        path: ["context_refs"],
      });
    }
  });

const modelEventBase = {
  schema_version: versionIdentifierSchema,
  request_id: immutableIdSchema,
  attempt_id: immutableIdSchema,
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  provider: modelProviderSchema,
  profile_id: immutableIdSchema,
  profile_version: versionIdentifierSchema,
  model_id: z.string().min(1).max(256),
  sequence: z.number().int().nonnegative(),
  observed_at: timestampSchema,
} as const;

export const modelProviderEventSchema = z.discriminatedUnion("event_type", [
  z.strictObject({
    ...modelEventBase,
    event_type: z.literal("STARTED"),
  }),
  z.strictObject({
    ...modelEventBase,
    event_type: z.literal("TEXT_DELTA"),
    delta: z.string().min(1).max(100_000),
  }),
  z.strictObject({
    ...modelEventBase,
    event_type: z.literal("TOOL_CALL_CANDIDATE"),
    tool_call_id: z.string().min(1).max(256),
    tool_name: versionIdentifierSchema,
    arguments: z.json(),
  }),
  z.strictObject({
    ...modelEventBase,
    event_type: z.literal("COMPLETED"),
    output_text: z.string().max(1_000_000),
    response_hash: contentHashSchema,
    usage: z.discriminatedUnion("availability", [
      z.strictObject({
        availability: z.literal("AVAILABLE"),
        source: z.literal("PROVIDER_REPORTED"),
        input_tokens: z.number().int().nonnegative(),
        output_tokens: z.number().int().nonnegative(),
        tool_calls: z.number().int().nonnegative(),
        unavailable_reason: z.null(),
      }),
      z.strictObject({
        availability: z.literal("UNAVAILABLE"),
        source: z.literal("UNAVAILABLE"),
        input_tokens: z.null(),
        output_tokens: z.null(),
        tool_calls: z.null(),
        unavailable_reason: z.literal("PROVIDER_DID_NOT_REPORT_USAGE"),
      }),
    ]),
  }),
  z.strictObject({
    ...modelEventBase,
    event_type: z.literal("FAILED"),
    reason_code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    retryable: z.boolean(),
    delivery_certainty: z.enum(["NOT_DISPATCHED", "DISPATCHED_OUTCOME_UNKNOWN"]),
  }),
  z.strictObject({
    ...modelEventBase,
    event_type: z.literal("THROTTLED"),
    reason_code: z.literal("MODEL_PROVIDER_THROTTLED"),
    retryable: z.literal(true),
    delivery_certainty: z.literal("DISPATCHED_OUTCOME_KNOWN"),
    retry_after_ms: z.number().int().positive().max(86_400_000).nullable(),
  }),
]);

export type ModelProviderRequest = z.infer<typeof modelProviderRequestSchema>;
export type ModelProviderEvent = z.infer<typeof modelProviderEventSchema>;

export type ModelProviderProfileResolver = (input: {
  readonly scope: AppScope;
  readonly profile_id: string;
}) => Promise<AvailableModelProfile | null>;

export type ModelExecutionProfileResolver = (input: {
  readonly scope: AppScope;
  readonly profile_id: string;
  readonly model_config_version: number;
}) => Promise<AvailableExecutionModelProfile | null>;

export class ModelProviderInvocationAuthorizationError extends Error {
  override readonly name = "ModelProviderInvocationAuthorizationError";
  readonly code = "MODEL_PROVIDER_INVOCATION_NOT_AUTHORIZED";
}

declare const authoritativeModelProviderInvocation: unique symbol;
const authorizedModelProviderInvocations = new WeakSet<object>();

export type AuthoritativeModelProviderInvocation = ModelProviderRequest & {
  readonly [authoritativeModelProviderInvocation]: true;
};

export async function authorizeModelProviderInvocation(
  input: unknown,
  resolveProfile: ModelProviderProfileResolver,
): Promise<AuthoritativeModelProviderInvocation> {
  const request = modelProviderRequestSchema.parse(input);
  const profile = await resolveProfile({
    scope: request.scope,
    profile_id: request.profile_id,
  });
  if (
    !profile ||
    !isAvailableModelProfile(profile) ||
    profile.scope.app_id !== request.scope.app_id ||
    profile.scope.tenant_id !== request.scope.tenant_id ||
    profile.scope.environment !== request.scope.environment ||
    profile.provider !== request.provider ||
    profile.profile_id !== request.profile_id ||
    profile.profile_version !== request.profile_version ||
    profile.model_id !== request.model_id
  ) {
    throw new ModelProviderInvocationAuthorizationError(
      "Model Provider 调用必须绑定同 Scope 且经过 AVAILABLE 认证的 Model Profile。",
    );
  }

  authorizedModelProviderInvocations.add(request);
  return deepFreeze(request) as AuthoritativeModelProviderInvocation;
}

export function isAuthoritativeModelProviderInvocation(
  value: unknown,
): value is AuthoritativeModelProviderInvocation {
  return (
    typeof value === "object" && value !== null && authorizedModelProviderInvocations.has(value)
  );
}

declare const authoritativePersistedModelProviderInvocation: unique symbol;
const authorizedPersistedModelProviderInvocations = new WeakSet<object>();

export type AuthoritativePersistedModelProviderInvocation = AuthoritativeModelProviderInvocation & {
  readonly [authoritativePersistedModelProviderInvocation]: true;
};

export async function computeModelProviderPayloadHash(input: unknown) {
  const request = modelProviderRequestSchema.parse(input);
  return sha256ContentHash({
    task_ref: request.task_ref,
    context_refs: request.context_refs,
    messages: request.messages,
    tool_allowlist: request.tool_allowlist,
    response_schema_version: request.response_schema_version,
    budget: request.budget,
    token_bound_policy_version: request.token_bound_policy_version,
    trusted_input_token_upper_bound: request.trusted_input_token_upper_bound,
  });
}

export async function verifyPersistedModelProviderProjectionClosure(
  requestInput: unknown,
  projectionReferenceInput: unknown,
  resolver: CommittedAgentDataProjectionReceiptResolver,
) {
  if (!resolver || typeof resolver.resolve_committed !== "function") {
    throw new ModelProviderInvocationAuthorizationError(
      "Persisted transport 必须使用 trusted committed projection resolver。",
    );
  }
  const request = modelProviderRequestSchema.parse(requestInput);
  const projectionReference =
    agentDataProjectionReceiptReferenceSchema.parse(projectionReferenceInput);
  const resolved = await resolver.resolve_committed(projectionReference);
  if (resolved === null) {
    throw new ModelProviderInvocationAuthorizationError(
      "Committed projection receipt 无法从持久化 Authority 解析。",
    );
  }
  const projectionReceipt = await verifyAgentDataProjectionReceiptV2Candidate(resolved);
  const requestInputIdentities = [request.task_ref, ...request.context_refs].map(
    artifactReferenceIdentity,
  );
  const canonicalRequestInputIdentities = [...requestInputIdentities].sort();
  const projectionInputIdentities = projectionReceipt.input_refs.map(artifactReferenceIdentity);
  if (
    projectionReceipt.receipt_id !== projectionReference.artifact_id ||
    projectionReceipt.receipt_hash !== projectionReference.content_hash ||
    projectionReference.revision !== 1 ||
    projectionReceipt.scope.app_id !== projectionReference.app_id ||
    projectionReceipt.scope.tenant_id !== projectionReference.tenant_id ||
    projectionReceipt.scope.environment !== projectionReference.environment ||
    projectionReceipt.run_id !== projectionReference.run_id ||
    new Set(requestInputIdentities).size !== requestInputIdentities.length ||
    JSON.stringify(canonicalRequestInputIdentities) !== JSON.stringify(projectionInputIdentities)
  ) {
    throw new ModelProviderInvocationAuthorizationError(
      "Provider request refs 必须与 committed projection receipt 完整、唯一且规范闭合。",
    );
  }
  return { request, projection_receipt: projectionReceipt };
}

export interface CommittedAgentDataProjectionReceiptResolver {
  resolve_committed(
    reference: z.infer<typeof agentDataProjectionReceiptReferenceSchema>,
  ): Promise<unknown | null>;
}

export async function authorizePersistedModelProviderInvocation(
  input: unknown,
  envelopeInput: unknown,
  projectionResolver: CommittedAgentDataProjectionReceiptResolver,
  permit: AuthoritativeCommittedProviderDispatchPermit,
  resolveProfile: ModelExecutionProfileResolver,
): Promise<AuthoritativePersistedModelProviderInvocation> {
  if (!isAuthoritativeCommittedProviderDispatchPermit(permit)) {
    throw new ModelProviderInvocationAuthorizationError(
      "Provider transport 必须消费 committed dispatch permit。",
    );
  }
  const envelope = await verifyProviderDispatchEnvelopeCandidate(envelopeInput);
  const { request, projection_receipt: projectionReceipt } =
    await verifyPersistedModelProviderProjectionClosure(
      input,
      envelope.projection.receipt_ref,
      projectionResolver,
    );
  if (
    request.model_config_version === undefined ||
    request.execution_profile_hash === undefined ||
    request.recovery_capabilities === undefined ||
    request.connection === undefined ||
    request.token_bound_policy_version === undefined ||
    request.trusted_input_token_upper_bound === undefined
  ) {
    throw new ModelProviderInvocationAuthorizationError(
      "Persisted transport request 缺少 execution authority closure。",
    );
  }
  const profile = await resolveProfile({
    scope: request.scope,
    profile_id: envelope.model_profile.profile_id,
    model_config_version: envelope.model_profile.model_config_version,
  });
  const sameTools =
    JSON.stringify(request.tool_allowlist) ===
    JSON.stringify(envelope.request_policy.tool_allowlist);
  const sameBudget =
    JSON.stringify(request.budget) ===
    JSON.stringify({
      timeout_ms: envelope.request_policy.budget.timeout_ms,
      max_input_tokens: envelope.request_policy.budget.max_input_tokens,
      max_output_tokens: envelope.request_policy.budget.max_output_tokens,
      max_tool_calls: envelope.request_policy.budget.max_tool_calls,
    });
  const availableProfile = profile && isAvailableExecutionModelProfile(profile) ? profile : null;
  const resolvedExecutionProfileHash = availableProfile
    ? await computeModelExecutionProfileHash(availableProfile)
    : null;
  const resolvedCertificationIdentity = availableProfile?.certification_receipt_ref
    ? artifactReferenceIdentity(availableProfile.certification_receipt_ref)
    : null;
  const expectedCertificationIdentity = artifactReferenceIdentity(
    envelope.certification.receipt_ref,
  );
  if (
    permit.invocation_id !== envelope.invocation_id ||
    permit.run_id !== envelope.run_id ||
    permit.dispatch_hash !== envelope.dispatch_hash ||
    permit.attempt_id !== envelope.lease.attempt_id ||
    permit.worker_fence !== envelope.lease.worker_fence ||
    request.attempt_id !== envelope.lease.attempt_id ||
    request.request_id !== envelope.invocation_id ||
    request.run_id !== envelope.run_id ||
    request.scope.app_id !== envelope.scope.app_id ||
    request.scope.tenant_id !== envelope.scope.tenant_id ||
    request.scope.environment !== envelope.scope.environment
  ) {
    throw new ModelProviderInvocationAuthorizationError(
      "PROVIDER_TRANSPORT_INVOCATION_AUTHORITY_MISMATCH",
    );
  }
  if (
    request.profile_id !== envelope.model_profile.profile_id ||
    request.model_config_version !== envelope.model_profile.model_config_version ||
    request.profile_version !== envelope.model_profile.profile_version ||
    request.provider !== envelope.model_profile.provider ||
    request.model_id !== envelope.model_profile.model_id ||
    request.execution_profile_hash !== envelope.certification.execution_profile_hash ||
    request.token_bound_policy_version !== envelope.projection.token_bound_policy_version ||
    request.trusted_input_token_upper_bound !==
      envelope.projection.trusted_input_token_upper_bound ||
    JSON.stringify(request.recovery_capabilities) !==
      JSON.stringify(envelope.certification.recovery_capabilities) ||
    JSON.stringify(request.connection) !== JSON.stringify(envelope.connection) ||
    JSON.stringify(request.task_ref) !== JSON.stringify(envelope.task_ref)
  ) {
    throw new ModelProviderInvocationAuthorizationError(
      "PROVIDER_TRANSPORT_REQUEST_AUTHORITY_MISMATCH",
    );
  }
  if (
    projectionReceipt.receipt_id !== envelope.projection.receipt_ref.artifact_id ||
    projectionReceipt.receipt_hash !== envelope.projection.receipt_ref.content_hash ||
    envelope.projection.receipt_ref.revision !== 1 ||
    projectionReceipt.scope.app_id !== envelope.scope.app_id ||
    projectionReceipt.scope.tenant_id !== envelope.scope.tenant_id ||
    projectionReceipt.scope.environment !== envelope.scope.environment ||
    projectionReceipt.run_id !== envelope.run_id ||
    projectionReceipt.request_id !== envelope.invocation_id ||
    projectionReceipt.principal_id !== envelope.scope.principal_id ||
    projectionReceipt.model_execution_profile_hash !==
      envelope.certification.execution_profile_hash ||
    projectionReceipt.payload_hash !== envelope.projection.payload_hash ||
    projectionReceipt.token_bound_policy_version !==
      envelope.projection.token_bound_policy_version ||
    projectionReceipt.trusted_input_token_upper_bound !==
      envelope.projection.trusted_input_token_upper_bound ||
    projectionReceipt.taint.taint_hash !== envelope.projection.taint_hash
  ) {
    throw new ModelProviderInvocationAuthorizationError(
      "PROVIDER_TRANSPORT_PROJECTION_AUTHORITY_MISMATCH",
    );
  }
  if (
    request.response_schema_version !== envelope.request_policy.response_schema_version ||
    !sameTools ||
    !sameBudget ||
    (await computeModelProviderPayloadHash(request)) !== envelope.projection.payload_hash
  ) {
    throw new ModelProviderInvocationAuthorizationError(
      "PROVIDER_TRANSPORT_REQUEST_POLICY_MISMATCH",
    );
  }
  if (!availableProfile) {
    throw new ModelProviderInvocationAuthorizationError("PROVIDER_TRANSPORT_PROFILE_NOT_AVAILABLE");
  }
  if (
    availableProfile.scope.app_id !== request.scope.app_id ||
    availableProfile.scope.tenant_id !== request.scope.tenant_id ||
    availableProfile.scope.environment !== request.scope.environment ||
    availableProfile.profile_id !== envelope.model_profile.profile_id ||
    availableProfile.model_config_version !== envelope.model_profile.model_config_version ||
    availableProfile.profile_version !== envelope.model_profile.profile_version ||
    availableProfile.adapter_version !== envelope.model_profile.adapter_version ||
    availableProfile.model_id !== envelope.model_profile.model_id ||
    availableProfile.provider !== envelope.model_profile.provider
  ) {
    throw new ModelProviderInvocationAuthorizationError(
      "PROVIDER_TRANSPORT_PROFILE_IDENTITY_MISMATCH",
    );
  }
  if (
    resolvedCertificationIdentity !== expectedCertificationIdentity ||
    resolvedExecutionProfileHash !== envelope.certification.execution_profile_hash
  ) {
    throw new ModelProviderInvocationAuthorizationError(
      "PROVIDER_TRANSPORT_PROFILE_CERTIFICATION_MISMATCH",
    );
  }
  if (
    canonicalizeJson(availableProfile.recovery_capabilities) !==
      canonicalizeJson(envelope.certification.recovery_capabilities) ||
    canonicalizeJson(availableProfile.connection) !== canonicalizeJson(envelope.connection)
  ) {
    throw new ModelProviderInvocationAuthorizationError(
      "PROVIDER_TRANSPORT_PROFILE_RECOVERY_MISMATCH",
    );
  }
  if (
    availableProfile.operational_constraints.context_window.verification_status !== "VERIFIED" ||
    availableProfile.operational_constraints.context_window.max_context_tokens !==
      envelope.certification.certified_context_window.max_context_tokens ||
    availableProfile.operational_constraints.context_window.max_output_tokens !==
      envelope.certification.certified_context_window.max_output_tokens
  ) {
    throw new ModelProviderInvocationAuthorizationError(
      "PROVIDER_TRANSPORT_PROFILE_CAPACITY_MISMATCH",
    );
  }
  authorizedModelProviderInvocations.add(request);
  authorizedPersistedModelProviderInvocations.add(request);
  return deepFreeze(request) as AuthoritativePersistedModelProviderInvocation;
}

export function isAuthoritativePersistedModelProviderInvocation(
  input: unknown,
): input is AuthoritativePersistedModelProviderInvocation {
  return (
    typeof input === "object" &&
    input !== null &&
    authorizedPersistedModelProviderInvocations.has(input)
  );
}

export function parseModelProviderEventForRequest(
  request: ModelProviderRequest,
  input: unknown,
): ModelProviderEvent {
  const event = modelProviderEventSchema.parse(input);
  assertPortEventCorrelation("Model Provider", request, event, [
    { field: "request_id", expected: request.request_id, actual: event.request_id },
    { field: "provider", expected: request.provider, actual: event.provider },
    { field: "profile_id", expected: request.profile_id, actual: event.profile_id },
    {
      field: "profile_version",
      expected: request.profile_version,
      actual: event.profile_version,
    },
    { field: "model_id", expected: request.model_id, actual: event.model_id },
  ]);
  return event;
}

export interface ModelProviderPort {
  stream(input: AuthoritativeModelProviderInvocation): AsyncIterable<ModelProviderEvent>;
}
