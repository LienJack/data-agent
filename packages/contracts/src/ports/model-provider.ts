import { z } from "zod";
import { artifactReferenceSchema } from "../artifacts/envelope.js";
import {
  type AppScope,
  appScopeSchema,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import {
  type AvailableModelProfile,
  isAvailableModelProfile,
  modelProviderSchema,
} from "../providers/index.js";
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
    usage: z.strictObject({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
      tool_calls: z.number().int().nonnegative(),
    }),
  }),
  z.strictObject({
    ...modelEventBase,
    event_type: z.literal("FAILED"),
    reason_code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    retryable: z.boolean(),
  }),
]);

export type ModelProviderRequest = z.infer<typeof modelProviderRequestSchema>;
export type ModelProviderEvent = z.infer<typeof modelProviderEventSchema>;

export type ModelProviderProfileResolver = (input: {
  readonly scope: AppScope;
  readonly profile_id: string;
}) => Promise<AvailableModelProfile | null>;

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
