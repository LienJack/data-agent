import { z } from "zod";
import {
  artifactReferenceFor,
  artifactReferenceIdentity,
  artifactReferenceSchema,
} from "../artifacts/envelope.js";
import {
  canonicalizeJson,
  contentHashSchema,
  deepFreeze,
  environmentSchema,
  immutableIdSchema,
  sha256ContentHash,
  versionIdentifierSchema,
} from "../common/index.js";
import { runtimeIdentifierSchema } from "../runs/runtime.js";
import { canonicalImmutableIdSchema, canonicalU2TimestampSchema } from "../workspaces/defaults.js";
import { workspaceIdempotencyKeySchema } from "../workspaces/identity.js";

const positiveRevisionSchema = z.number().int().positive().safe();
const nonNegativeUsageSchema = z.number().int().nonnegative().safe();
const providerIdentifierSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);

export const PROVIDER_INPUT_TOKEN_BOUND_POLICY_VERSION = "utf8-byte-upper-bound@1.0.0" as const;
export const providerInputTokenBoundPolicyVersionSchema = z.literal(
  PROVIDER_INPUT_TOKEN_BOUND_POLICY_VERSION,
);

export const providerInvocationScopeSchema = z
  .strictObject({
    app_id: canonicalImmutableIdSchema,
    tenant_id: canonicalImmutableIdSchema,
    environment: environmentSchema,
    workspace_id: canonicalImmutableIdSchema,
    principal_id: canonicalImmutableIdSchema,
  })
  .superRefine((scope, ctx) => {
    if (scope.tenant_id !== scope.workspace_id) {
      ctx.addIssue({
        code: "custom",
        message: "Provider Invocation workspace_id 必须与 tenant_id 一致。",
        path: ["workspace_id"],
      });
    }
  });

export const providerEffectiveConfigReferenceSchema = z.strictObject({
  config_id: canonicalImmutableIdSchema,
  config_revision: positiveRevisionSchema,
  config_hash: contentHashSchema,
});

export const providerInvocationRecoveryCapabilitySchema = z.enum([
  "IDEMPOTENT_REQUEST",
  "INVOCATION_STATUS_QUERY",
  "INVOCATION_RECONCILIATION",
  "AT_LEAST_ONCE_ONLY",
]);

const recoveryCapabilityOrder = [
  "IDEMPOTENT_REQUEST",
  "INVOCATION_STATUS_QUERY",
  "INVOCATION_RECONCILIATION",
  "AT_LEAST_ONCE_ONLY",
] as const;

export const providerInvocationRecoveryCapabilitiesSchema = z
  .array(providerInvocationRecoveryCapabilitySchema)
  .min(1)
  .max(3)
  .superRefine((capabilities, ctx) => {
    capabilities.forEach((capability, index) => {
      const previous = capabilities[index - 1];
      if (
        previous !== undefined &&
        recoveryCapabilityOrder.indexOf(previous) >= recoveryCapabilityOrder.indexOf(capability)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Recovery capabilities 必须唯一且规范排序。",
          path: [index],
        });
      }
    });
    if (capabilities.includes("AT_LEAST_ONCE_ONLY") && capabilities.length !== 1) {
      ctx.addIssue({
        code: "custom",
        message: "AT_LEAST_ONCE_ONLY 必须独占 recovery capability 集合。",
      });
    }
  });

export const providerInvocationConnectionProofSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("SYSTEM_DEPLOYMENT"),
    deployment_id: immutableIdSchema,
    deployment_revision: positiveRevisionSchema,
    deployment_hash: contentHashSchema,
  }),
  z.strictObject({
    kind: z.literal("MANAGED_CONNECTION"),
    provider_connection_id: immutableIdSchema,
    config_version: positiveRevisionSchema,
    connection_hash: contentHashSchema,
  }),
]);

export const providerInvocationModelProfileBindingSchema = z
  .strictObject({
    profile_id: immutableIdSchema,
    model_config_version: positiveRevisionSchema,
    resource_hash: contentHashSchema,
    profile_version: versionIdentifierSchema,
    provider: providerIdentifierSchema,
    model_id: z.string().trim().min(1).max(256),
    adapter_version: versionIdentifierSchema,
  })
  .superRefine((profile, ctx) => {
    if (profile.profile_version !== `model-profile@${profile.model_config_version}`) {
      ctx.addIssue({
        code: "custom",
        message: "Profile Version 必须精确绑定 Catalog config_version。",
        path: ["profile_version"],
      });
    }
  });

export const providerDispatchLeaseBindingSchema = z.strictObject({
  outbox_id: immutableIdSchema,
  command_id: immutableIdSchema,
  attempt_id: immutableIdSchema,
  attempt_no: positiveRevisionSchema,
  worker_id: runtimeIdentifierSchema,
  lease_token: positiveRevisionSchema,
  worker_fence: positiveRevisionSchema,
});

export const providerContextReceiptReferenceSchema = z.strictObject({
  receipt_id: immutableIdSchema,
  receipt_hash: contentHashSchema,
});

export const agentDataProjectionReceiptReferenceSchema = artifactReferenceFor(
  "AgentDataProjectionReceipt",
);

const canonicalToolAllowlistSchema = z
  .array(versionIdentifierSchema)
  .max(64)
  .superRefine((tools, ctx) => {
    tools.forEach((tool, index) => {
      const previous = tools[index - 1];
      if (previous !== undefined && previous >= tool) {
        ctx.addIssue({
          code: "custom",
          message: "Tool allowlist 必须唯一并按协议顺序排列。",
          path: [index],
        });
      }
    });
  });

export const providerInvocationBudgetSchema = z.strictObject({
  timeout_ms: z.number().int().positive().max(600_000),
  max_input_tokens: z.number().int().positive().safe(),
  max_output_tokens: z.number().int().positive().safe(),
  max_tool_calls: z.number().int().nonnegative().safe(),
  provider_call_limit: z.literal(1),
});

const providerDispatchEnvelopeDraftSchema = z
  .strictObject({
    schema_version: z.literal("provider-dispatch-envelope@1.0.0"),
    invocation_id: immutableIdSchema,
    idempotency_key: workspaceIdempotencyKeySchema,
    scope: providerInvocationScopeSchema,
    run_id: immutableIdSchema,
    logical_call_id: immutableIdSchema,
    task_ref: artifactReferenceSchema,
    effective_config_ref: providerEffectiveConfigReferenceSchema,
    context_receipt_ref: providerContextReceiptReferenceSchema,
    lease: providerDispatchLeaseBindingSchema,
    model_profile: providerInvocationModelProfileBindingSchema,
    certification: z.strictObject({
      receipt_ref: artifactReferenceSchema.superRefine((reference, ctx) => {
        if (reference.artifact_type !== "ModelCertificationReceipt") {
          ctx.addIssue({ code: "custom", message: "必须引用认证 Receipt。" });
        }
      }),
      execution_profile_hash: contentHashSchema,
      recovery_capabilities: providerInvocationRecoveryCapabilitiesSchema,
      certified_context_window: z.strictObject({
        verification_status: z.literal("VERIFIED"),
        max_context_tokens: z.number().int().positive().safe(),
        max_output_tokens: z.number().int().positive().safe(),
      }),
    }),
    connection: providerInvocationConnectionProofSchema,
    request_policy: z.strictObject({
      response_schema_version: versionIdentifierSchema,
      tool_allowlist: canonicalToolAllowlistSchema,
      budget: providerInvocationBudgetSchema,
    }),
    projection: z.strictObject({
      projection_version: z.literal("agent-data-projection@2.0.0"),
      receipt_ref: agentDataProjectionReceiptReferenceSchema,
      payload_hash: contentHashSchema,
      token_bound_policy_version: providerInputTokenBoundPolicyVersionSchema,
      trusted_input_token_upper_bound: nonNegativeUsageSchema,
      reserved_output_tokens: nonNegativeUsageSchema,
      effective_context_ceiling_tokens: z.number().int().positive().safe(),
      effective_output_ceiling_tokens: nonNegativeUsageSchema,
      capacity_status: z.enum(["WITHIN_LIMIT", "EXCEEDED"]),
      taint_hash: contentHashSchema,
    }),
  })
  .superRefine((envelope, ctx) => {
    for (const [path, reference] of [["task_ref", envelope.task_ref]] as const) {
      if (
        reference.app_id !== envelope.scope.app_id ||
        reference.tenant_id !== envelope.scope.tenant_id ||
        reference.environment !== envelope.scope.environment ||
        reference.run_id !== envelope.run_id
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Provider Dispatch 引用必须属于同一 Scope/Run。",
          path: [path],
        });
      }
    }
    const certificationReference = envelope.certification.receipt_ref;
    if (
      certificationReference.app_id !== envelope.scope.app_id ||
      certificationReference.tenant_id !== envelope.scope.tenant_id ||
      certificationReference.environment !== envelope.scope.environment
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Certification Receipt 必须属于同一 App/Tenant/Environment，可来自独立 Run。",
        path: ["certification", "receipt_ref"],
      });
    }
    const projectionReceipt = envelope.projection.receipt_ref;
    if (
      projectionReceipt.app_id !== envelope.scope.app_id ||
      projectionReceipt.tenant_id !== envelope.scope.tenant_id ||
      projectionReceipt.environment !== envelope.scope.environment ||
      projectionReceipt.run_id !== envelope.run_id
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Agent Data Projection Receipt 必须属于同一 Scope/Run。",
        path: ["projection", "receipt_ref"],
      });
    }
    if (
      envelope.projection.reserved_output_tokens !==
      envelope.request_policy.budget.max_output_tokens
    ) {
      ctx.addIssue({
        code: "custom",
        message: "reserved_output_tokens 必须等于真实 Provider max output budget。",
        path: ["projection", "reserved_output_tokens"],
      });
    }
    if (
      envelope.projection.effective_context_ceiling_tokens >
        envelope.certification.certified_context_window.max_context_tokens ||
      envelope.projection.effective_output_ceiling_tokens >
        envelope.certification.certified_context_window.max_output_tokens
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Effective capacity ceiling 不能超过 Certification snapshot。",
        path: ["projection", "capacity_status"],
      });
    }
    const exceedsCapacity =
      envelope.projection.trusted_input_token_upper_bound >
        envelope.request_policy.budget.max_input_tokens ||
      envelope.projection.reserved_output_tokens >
        envelope.request_policy.budget.max_output_tokens ||
      envelope.projection.reserved_output_tokens >
        envelope.projection.effective_output_ceiling_tokens ||
      envelope.projection.trusted_input_token_upper_bound +
        envelope.projection.reserved_output_tokens >
        envelope.projection.effective_context_ceiling_tokens;
    if ((envelope.projection.capacity_status === "WITHIN_LIMIT") === exceedsCapacity) {
      ctx.addIssue({
        code: "custom",
        message:
          "Provider capacity_status 必须与 trusted input、reserved output 和有效 ceiling 精确一致。",
        path: ["projection", "capacity_status"],
      });
    }
  });

export const providerDispatchEnvelopeSchema = providerDispatchEnvelopeDraftSchema.safeExtend({
  invocation_key_hash: contentHashSchema,
  dispatch_hash: contentHashSchema,
});

export const providerInvocationStableSpecSchema = z.strictObject({
  schema_version: z.literal("provider-invocation-spec@1.0.0"),
  invocation_id: immutableIdSchema,
  idempotency_key: workspaceIdempotencyKeySchema,
  scope: providerInvocationScopeSchema,
  run_id: immutableIdSchema,
  logical_call_id: immutableIdSchema,
  task_ref: artifactReferenceSchema,
  effective_config_ref: providerEffectiveConfigReferenceSchema,
  model_profile: providerInvocationModelProfileBindingSchema,
  certification: z.strictObject({
    receipt_ref: artifactReferenceSchema,
    execution_profile_hash: contentHashSchema,
    recovery_capabilities: providerInvocationRecoveryCapabilitiesSchema,
    certified_context_window: z.strictObject({
      verification_status: z.literal("VERIFIED"),
      max_context_tokens: z.number().int().positive().safe(),
      max_output_tokens: z.number().int().positive().safe(),
    }),
  }),
  connection: providerInvocationConnectionProofSchema,
  request_policy: z.strictObject({
    response_schema_version: versionIdentifierSchema,
    tool_allowlist: canonicalToolAllowlistSchema,
    budget: providerInvocationBudgetSchema,
  }),
  projection: z.strictObject({
    projection_version: z.literal("agent-data-projection@2.0.0"),
    receipt_ref: agentDataProjectionReceiptReferenceSchema,
    payload_hash: contentHashSchema,
    token_bound_policy_version: providerInputTokenBoundPolicyVersionSchema,
    trusted_input_token_upper_bound: nonNegativeUsageSchema,
    reserved_output_tokens: nonNegativeUsageSchema,
    effective_context_ceiling_tokens: z.number().int().positive().safe(),
    effective_output_ceiling_tokens: nonNegativeUsageSchema,
    capacity_status: z.enum(["WITHIN_LIMIT", "EXCEEDED"]),
    taint_hash: contentHashSchema,
  }),
});

export function projectProviderInvocationStableSpec(input: unknown) {
  const envelope = providerDispatchEnvelopeSchema.parse(input);
  return providerInvocationStableSpecSchema.parse({
    schema_version: "provider-invocation-spec@1.0.0",
    invocation_id: envelope.invocation_id,
    idempotency_key: envelope.idempotency_key,
    scope: envelope.scope,
    run_id: envelope.run_id,
    logical_call_id: envelope.logical_call_id,
    task_ref: envelope.task_ref,
    effective_config_ref: envelope.effective_config_ref,
    model_profile: envelope.model_profile,
    certification: envelope.certification,
    connection: envelope.connection,
    request_policy: envelope.request_policy,
    projection: envelope.projection,
  });
}

export async function computeProviderInvocationKeyHash(input: unknown) {
  const envelope = providerDispatchEnvelopeDraftSchema.parse(input);
  return sha256ContentHash(
    providerInvocationStableSpecSchema.parse({
      schema_version: "provider-invocation-spec@1.0.0",
      invocation_id: envelope.invocation_id,
      idempotency_key: envelope.idempotency_key,
      scope: envelope.scope,
      run_id: envelope.run_id,
      logical_call_id: envelope.logical_call_id,
      task_ref: envelope.task_ref,
      effective_config_ref: envelope.effective_config_ref,
      model_profile: envelope.model_profile,
      certification: envelope.certification,
      connection: envelope.connection,
      request_policy: envelope.request_policy,
      projection: envelope.projection,
    }),
  );
}

export async function computeProviderDispatchHash(input: unknown) {
  const envelope = z
    .strictObject({
      ...providerDispatchEnvelopeDraftSchema.shape,
      invocation_key_hash: contentHashSchema,
    })
    .parse(input);
  return sha256ContentHash(envelope);
}

export async function buildProviderDispatchEnvelopeCandidate(input: unknown) {
  const envelope = providerDispatchEnvelopeDraftSchema.parse(input);
  const invocationKeyHash = await computeProviderInvocationKeyHash(envelope);
  return providerDispatchEnvelopeSchema.parse({
    ...envelope,
    invocation_key_hash: invocationKeyHash,
    dispatch_hash: await computeProviderDispatchHash({
      ...envelope,
      invocation_key_hash: invocationKeyHash,
    }),
  });
}

export async function verifyProviderDispatchEnvelopeCandidate(input: unknown) {
  const envelope = providerDispatchEnvelopeSchema.parse(input);
  const {
    dispatch_hash: _dispatchHash,
    invocation_key_hash: invocationKeyHash,
    ...draft
  } = envelope;
  if ((await computeProviderInvocationKeyHash(draft)) !== invocationKeyHash) {
    throw new TypeError("PROVIDER_INVOCATION_KEY_HASH_MISMATCH");
  }
  const dispatchDraft = { ...draft, invocation_key_hash: invocationKeyHash };
  if ((await computeProviderDispatchHash(dispatchDraft)) !== envelope.dispatch_hash) {
    throw new TypeError("PROVIDER_DISPATCH_HASH_MISMATCH");
  }
  return envelope;
}

const providerInvocationIntentDraftSchema = z.strictObject({
  schema_version: z.literal("provider-invocation-intent@1.0.0"),
  intent_id: immutableIdSchema,
  invocation_spec: providerInvocationStableSpecSchema,
  invocation_key_hash: contentHashSchema,
  state: z.literal("INTENT_COMMITTED"),
  committed_at: canonicalU2TimestampSchema,
});

export const providerInvocationIntentSchema = providerInvocationIntentDraftSchema.safeExtend({
  intent_hash: contentHashSchema,
});

export async function computeProviderInvocationIntentHash(input: unknown) {
  return sha256ContentHash(providerInvocationIntentDraftSchema.parse(input));
}

export async function buildProviderInvocationIntentReceipt(input: unknown) {
  const intent = providerInvocationIntentDraftSchema.parse(input);
  return providerInvocationIntentSchema.parse({
    ...intent,
    intent_hash: await computeProviderInvocationIntentHash(intent),
  });
}

export async function verifyProviderInvocationIntentReceipt(input: unknown) {
  const intent = providerInvocationIntentSchema.parse(input);
  const { intent_hash: _intentHash, ...draft } = intent;
  if ((await computeProviderInvocationIntentHash(draft)) !== intent.intent_hash) {
    throw new TypeError("PROVIDER_INVOCATION_INTENT_HASH_MISMATCH");
  }
  if ((await sha256ContentHash(intent.invocation_spec)) !== intent.invocation_key_hash) {
    throw new TypeError("PROVIDER_INVOCATION_KEY_HASH_MISMATCH");
  }
  return intent;
}

const committedProviderDispatchPermitDraftSchema = z
  .strictObject({
    schema_version: z.literal("provider-dispatch-permit@1.0.0"),
    permit_id: immutableIdSchema,
    intent_id: immutableIdSchema,
    invocation_id: immutableIdSchema,
    scope: providerInvocationScopeSchema,
    run_id: immutableIdSchema,
    dispatch_hash: contentHashSchema,
    context_receipt_ref: providerContextReceiptReferenceSchema,
    lease: providerDispatchLeaseBindingSchema,
    attempt_id: immutableIdSchema,
    worker_fence: positiveRevisionSchema,
    committed_at: canonicalU2TimestampSchema,
  })
  .superRefine((permit, ctx) => {
    if (
      permit.attempt_id !== permit.lease.attempt_id ||
      permit.worker_fence !== permit.lease.worker_fence
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Permit attempt/fence 必须与完整 Lease binding 一致。",
      });
    }
  });

export const committedProviderDispatchPermitSchema =
  committedProviderDispatchPermitDraftSchema.safeExtend({ permit_hash: contentHashSchema });

export async function computeCommittedProviderDispatchPermitHash(input: unknown) {
  return sha256ContentHash(committedProviderDispatchPermitDraftSchema.parse(input));
}

export async function buildCommittedProviderDispatchPermitReceipt(input: unknown) {
  const permit = committedProviderDispatchPermitDraftSchema.parse(input);
  return committedProviderDispatchPermitSchema.parse({
    ...permit,
    permit_hash: await computeCommittedProviderDispatchPermitHash(permit),
  });
}

export async function verifyCommittedProviderDispatchPermitReceipt(input: unknown) {
  const permit = committedProviderDispatchPermitSchema.parse(input);
  const { permit_hash: _permitHash, ...draft } = permit;
  if ((await computeCommittedProviderDispatchPermitHash(draft)) !== permit.permit_hash) {
    throw new TypeError("PROVIDER_DISPATCH_PERMIT_HASH_MISMATCH");
  }
  return permit;
}

export const providerDispatchPermitLookupSchema = z.strictObject({
  scope: providerInvocationScopeSchema,
  run_id: immutableIdSchema,
  invocation_id: immutableIdSchema,
  dispatch_hash: contentHashSchema,
});

export interface CommittedProviderDispatchPermitAuthority {
  resolve_committed(
    lookup: z.infer<typeof providerDispatchPermitLookupSchema>,
  ): Promise<unknown | null>;
}

declare const authoritativeCommittedProviderDispatchPermit: unique symbol;
const authoritativeCommittedProviderDispatchPermits = new WeakSet<object>();

export type AuthoritativeCommittedProviderDispatchPermit = z.infer<
  typeof committedProviderDispatchPermitSchema
> & { readonly [authoritativeCommittedProviderDispatchPermit]: true };

export async function authorizeCommittedProviderDispatchPermit(
  lookupInput: unknown,
  authority: CommittedProviderDispatchPermitAuthority,
): Promise<AuthoritativeCommittedProviderDispatchPermit> {
  const lookup = providerDispatchPermitLookupSchema.parse(lookupInput);
  const permit = await verifyCommittedProviderDispatchPermitReceipt(
    await authority.resolve_committed(lookup),
  );
  if (
    permit.scope.app_id !== lookup.scope.app_id ||
    permit.scope.tenant_id !== lookup.scope.tenant_id ||
    permit.scope.environment !== lookup.scope.environment ||
    permit.scope.workspace_id !== lookup.scope.workspace_id ||
    permit.scope.principal_id !== lookup.scope.principal_id ||
    permit.run_id !== lookup.run_id ||
    permit.invocation_id !== lookup.invocation_id ||
    permit.dispatch_hash !== lookup.dispatch_hash
  ) {
    throw new TypeError("PROVIDER_DISPATCH_PERMIT_NOT_COMMITTED");
  }
  authoritativeCommittedProviderDispatchPermits.add(permit);
  return deepFreeze(permit) as AuthoritativeCommittedProviderDispatchPermit;
}

export function isAuthoritativeCommittedProviderDispatchPermit(
  input: unknown,
): input is AuthoritativeCommittedProviderDispatchPermit {
  return (
    typeof input === "object" &&
    input !== null &&
    authoritativeCommittedProviderDispatchPermits.has(input)
  );
}

export const providerInvocationInternalStateSchema = z.enum([
  "INTENT_COMMITTED",
  "DISPATCH_MARKED",
  "RESPONSE_OBSERVED",
  "COMPLETED",
  "FAILED",
  "THROTTLED",
  "OUTCOME_UNKNOWN",
]);

export function decideProviderInvocationTakeover(input: {
  readonly dispatch_marker_present: boolean;
  readonly recovery_capabilities: readonly z.infer<
    typeof providerInvocationRecoveryCapabilitySchema
  >[];
}):
  | "ISSUE_NEW_PERMIT"
  | "SAFE_REDISPATCH"
  | "STATUS_QUERY_REQUIRED"
  | "RECONCILIATION_REQUIRED"
  | "MARK_OUTCOME_UNKNOWN" {
  const capabilities = providerInvocationRecoveryCapabilitiesSchema.parse(
    input.recovery_capabilities,
  );
  if (!input.dispatch_marker_present) return "ISSUE_NEW_PERMIT";
  if (capabilities.includes("AT_LEAST_ONCE_ONLY")) return "MARK_OUTCOME_UNKNOWN";
  if (capabilities.includes("IDEMPOTENT_REQUEST")) return "SAFE_REDISPATCH";
  if (capabilities.includes("INVOCATION_STATUS_QUERY")) return "STATUS_QUERY_REQUIRED";
  return "RECONCILIATION_REQUIRED";
}

export function decideStaleProviderMarkerRecoveryAction(
  capabilityInput: unknown,
): "SAFE_RETRY" | "STATUS_QUERY_REQUIRED" | "RECONCILIATION_REQUIRED" | "MANUAL_REVIEW_REQUIRED" {
  const capability = providerInvocationRecoveryCapabilitySchema.parse(capabilityInput);
  if (capability === "IDEMPOTENT_REQUEST") return "SAFE_RETRY";
  if (capability === "INVOCATION_STATUS_QUERY") return "STATUS_QUERY_REQUIRED";
  if (capability === "INVOCATION_RECONCILIATION") return "RECONCILIATION_REQUIRED";
  return "MANUAL_REVIEW_REQUIRED";
}

export const providerInvocationTerminalStatusSchema = z.enum([
  "COMPLETED",
  "FAILED",
  "THROTTLED",
  "OUTCOME_UNKNOWN",
]);

export const providerInvocationUsageUnavailableReasonSchema = z.enum([
  "PROVIDER_NOT_DISPATCHED",
  "PROVIDER_DID_NOT_REPORT_USAGE",
  "PROVIDER_INVOCATION_OUTCOME_UNKNOWN",
  "PROVIDER_PROTOCOL_VIOLATION",
]);

const providerUsageIdentityBase = {
  schema_version: z.literal("provider-invocation-usage@1.0.0"),
  usage_receipt_id: immutableIdSchema,
  outcome_id: immutableIdSchema,
  intent_id: immutableIdSchema,
  invocation_id: immutableIdSchema,
  scope: providerInvocationScopeSchema,
  run_id: immutableIdSchema,
  observed_at: canonicalU2TimestampSchema,
} as const;

const providerUsageTruthBranches = [
  z
    .strictObject({
      availability: z.literal("AVAILABLE"),
      source: z.enum(["PROVIDER_REPORTED", "ESTIMATED"]),
      input_tokens: nonNegativeUsageSchema,
      output_tokens: nonNegativeUsageSchema,
      total_tokens: nonNegativeUsageSchema,
      tool_calls: nonNegativeUsageSchema,
      provider_call_count: z.literal(1),
      capacity_status: z.literal("WITHIN_LIMIT"),
      unavailable_reason: z.null(),
    })
    .superRefine((usage, ctx) => {
      if (usage.total_tokens !== usage.input_tokens + usage.output_tokens) {
        ctx.addIssue({
          code: "custom",
          message: "total_tokens 必须精确等于 input+output。",
          path: ["total_tokens"],
        });
      }
    }),
  z.strictObject({
    availability: z.literal("NOT_APPLICABLE"),
    source: z.literal("UNAVAILABLE"),
    input_tokens: z.null(),
    output_tokens: z.null(),
    total_tokens: z.null(),
    tool_calls: z.null(),
    provider_call_count: z.literal(0),
    capacity_status: z.literal("NOT_APPLICABLE"),
    unavailable_reason: z.literal("PROVIDER_NOT_DISPATCHED"),
  }),
  z.strictObject({
    availability: z.literal("UNAVAILABLE"),
    source: z.literal("UNAVAILABLE"),
    input_tokens: z.null(),
    output_tokens: z.null(),
    total_tokens: z.null(),
    tool_calls: z.null(),
    provider_call_count: z.literal(1),
    capacity_status: z.literal("UNAVAILABLE"),
    unavailable_reason: z.enum([
      "PROVIDER_DID_NOT_REPORT_USAGE",
      "PROVIDER_INVOCATION_OUTCOME_UNKNOWN",
      "PROVIDER_PROTOCOL_VIOLATION",
    ]),
  }),
] as const;

export const providerInvocationUsageCandidateSchema = z.discriminatedUnion("availability", [
  providerUsageTruthBranches[0].safeExtend({
    schema_version: z.literal("provider-invocation-usage-candidate@1.0.0"),
  }),
  providerUsageTruthBranches[1].safeExtend({
    schema_version: z.literal("provider-invocation-usage-candidate@1.0.0"),
  }),
  providerUsageTruthBranches[2].safeExtend({
    schema_version: z.literal("provider-invocation-usage-candidate@1.0.0"),
  }),
]);

export const providerInvocationUsageReceiptCandidateSchema = z.discriminatedUnion("availability", [
  providerUsageTruthBranches[0].safeExtend(providerUsageIdentityBase),
  providerUsageTruthBranches[1].safeExtend(providerUsageIdentityBase),
  providerUsageTruthBranches[2].safeExtend(providerUsageIdentityBase),
]);

export const providerInvocationUsageReceiptSchema = z.discriminatedUnion("availability", [
  providerUsageTruthBranches[0].safeExtend({
    ...providerUsageIdentityBase,
    usage_hash: contentHashSchema,
  }),
  providerUsageTruthBranches[1].safeExtend({
    ...providerUsageIdentityBase,
    usage_hash: contentHashSchema,
  }),
  providerUsageTruthBranches[2].safeExtend({
    ...providerUsageIdentityBase,
    usage_hash: contentHashSchema,
  }),
]);

export async function computeProviderInvocationUsageHash(input: unknown) {
  return sha256ContentHash(providerInvocationUsageReceiptCandidateSchema.parse(input));
}

export async function buildProviderInvocationUsageReceipt(input: unknown) {
  const usage = providerInvocationUsageReceiptCandidateSchema.parse(input);
  return providerInvocationUsageReceiptSchema.parse({
    ...usage,
    usage_hash: await computeProviderInvocationUsageHash(usage),
  });
}

export async function verifyProviderInvocationUsageReceipt(input: unknown) {
  const usage = providerInvocationUsageReceiptSchema.parse(input);
  const { usage_hash: _usageHash, ...draft } = usage;
  if ((await computeProviderInvocationUsageHash(draft)) !== usage.usage_hash) {
    throw new TypeError("PROVIDER_INVOCATION_USAGE_HASH_MISMATCH");
  }
  return usage;
}

const providerResponseToolCallSchema = z.strictObject({
  tool_call_id: z.string().min(1).max(256),
  tool_name: versionIdentifierSchema,
  arguments: z.json(),
});

const providerResponseArtifactDocumentDraftSchema = z.strictObject({
  schema_version: z.literal("provider-response-artifact@1.0.0"),
  invocation_id: immutableIdSchema,
  output_text: z.string().max(1_000_000),
  tool_calls: z.array(providerResponseToolCallSchema).max(256),
});

export const providerResponseArtifactDocumentSchema =
  providerResponseArtifactDocumentDraftSchema.safeExtend({
    response_hash: contentHashSchema,
    content_hash: contentHashSchema,
  });

export async function computeProviderResponseHash(input: unknown) {
  const document = providerResponseArtifactDocumentDraftSchema.parse(input);
  return sha256ContentHash({
    output_text: document.output_text,
    tool_calls: document.tool_calls,
  });
}

export async function computeProviderResponseArtifactHash(input: unknown) {
  const document = providerResponseArtifactDocumentDraftSchema.parse(input);
  return sha256ContentHash({
    ...document,
    response_hash: await computeProviderResponseHash(document),
  });
}

export async function buildProviderResponseArtifactDocument(input: unknown) {
  const document = providerResponseArtifactDocumentDraftSchema.parse(input);
  const responseHash = await computeProviderResponseHash(document);
  return providerResponseArtifactDocumentSchema.parse({
    ...document,
    response_hash: responseHash,
    content_hash: await sha256ContentHash({ ...document, response_hash: responseHash }),
  });
}

export async function verifyProviderResponseArtifactDocument(input: unknown) {
  const document = providerResponseArtifactDocumentSchema.parse(input);
  const { content_hash: _contentHash, response_hash: _responseHash, ...draft } = document;
  if (
    (await computeProviderResponseHash(draft)) !== document.response_hash ||
    (await sha256ContentHash({ ...draft, response_hash: document.response_hash })) !==
      document.content_hash
  ) {
    throw new TypeError("PROVIDER_RESPONSE_ARTIFACT_HASH_MISMATCH");
  }
  return document;
}

export const providerResponseArtifactReferenceSchema = artifactReferenceFor(
  "ProviderResponseArtifact",
);

const providerTaskConversationBindingSchema = z.strictObject({
  conversation_id: canonicalImmutableIdSchema,
  resource_version: positiveRevisionSchema,
});

const providerTaskArtifactV1DocumentDraftSchema = z
  .strictObject({
    schema_version: z.literal("provider-task-artifact@1.0.0"),
    message_id: immutableIdSchema,
    accepted_event_id: immutableIdSchema,
    conversation_id: immutableIdSchema,
    conversation_resource_version: positiveRevisionSchema,
    command_id: immutableIdSchema,
    run_id: immutableIdSchema,
    message_role: z.literal("user"),
    message_type: z.literal("text"),
    question: z.string().trim().min(1).max(4_000),
  })
  .superRefine((document, ctx) => {
    if (document.message_id !== document.accepted_event_id) {
      ctx.addIssue({
        code: "custom",
        message: "Provider Task message_id 必须等于 DB-resolved run.accepted event_id。",
      });
    }
  });

const providerTaskVisibleMessageDraftSchema = z.strictObject({
  message_id: immutableIdSchema,
  role: z.enum(["user", "agent"]),
  type: z.enum(["text", "table", "report", "hypothesis", "error"]),
  content: z.string().trim().min(1).max(200_000),
  run_id: immutableIdSchema.nullable(),
});

export const providerTaskVisibleMessageSchema = providerTaskVisibleMessageDraftSchema.safeExtend({
  content_hash: contentHashSchema,
});

export const providerTaskCurrentMessageSchema = z.strictObject({
  message_id: immutableIdSchema,
  content: z.string().trim().min(1).max(4_000),
});

const providerTaskArtifactV2DocumentDraftSchema = z
  .strictObject({
    schema_version: z.literal("provider-task-artifact@2.0.0"),
    conversation_id: immutableIdSchema,
    conversation_resource_version: positiveRevisionSchema,
    current_message: providerTaskCurrentMessageSchema,
    visible_messages: z.array(providerTaskVisibleMessageSchema).min(1).max(64),
    context_summary_ref: artifactReferenceSchema.nullable(),
    context_selection_hash: contentHashSchema,
  })
  .superRefine((document, ctx) => {
    const messageIds = new Set<string>();
    document.visible_messages.forEach((message, index) => {
      if (messageIds.has(message.message_id)) {
        ctx.addIssue({
          code: "custom",
          message: "Provider Task visible message identity 不能重复。",
          path: ["visible_messages", index, "message_id"],
        });
      }
      messageIds.add(message.message_id);
    });
    const current = document.visible_messages.at(-1);
    if (
      current?.message_id !== document.current_message.message_id ||
      current.role !== "user" ||
      current.type !== "text" ||
      current.content !== document.current_message.content ||
      current.run_id === null
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Provider Task current message 必须是可见历史最后一条 current-Run user text。",
        path: ["current_message"],
      });
    }
  });

const providerTaskArtifactV1DocumentSchema = providerTaskArtifactV1DocumentDraftSchema.safeExtend({
  content_hash: contentHashSchema,
});

export const providerTaskArtifactV2DocumentSchema =
  providerTaskArtifactV2DocumentDraftSchema.safeExtend({ content_hash: contentHashSchema });
export type ProviderTaskArtifactV2Document = z.infer<typeof providerTaskArtifactV2DocumentSchema>;

export const providerTaskArtifactDocumentSchema = z.discriminatedUnion("schema_version", [
  providerTaskArtifactV1DocumentSchema,
  providerTaskArtifactV2DocumentSchema,
]);

export const providerTaskArtifactReferenceSchema = artifactReferenceFor("ProviderTaskArtifact");

export async function computeProviderTaskVisibleMessageHash(input: unknown) {
  return sha256ContentHash(providerTaskVisibleMessageDraftSchema.parse(input));
}

export async function computeProviderTaskContextSelectionHash(input: {
  readonly conversation_id: string;
  readonly conversation_resource_version: number;
  readonly current_message_id: string;
  readonly visible_messages: readonly Readonly<{ message_id: string; content_hash: string }>[];
  readonly context_summary_ref: unknown | null;
}) {
  return sha256ContentHash({
    conversation_id: immutableIdSchema.parse(input.conversation_id),
    conversation_resource_version: positiveRevisionSchema.parse(
      input.conversation_resource_version,
    ),
    current_message_id: immutableIdSchema.parse(input.current_message_id),
    visible_messages: input.visible_messages.map((message) => ({
      message_id: immutableIdSchema.parse(message.message_id),
      content_hash: contentHashSchema.parse(message.content_hash),
    })),
    context_summary_ref:
      input.context_summary_ref === null
        ? null
        : artifactReferenceSchema.parse(input.context_summary_ref),
  });
}

async function verifyProviderTaskArtifactV2Draft(
  document: z.infer<typeof providerTaskArtifactV2DocumentDraftSchema>,
) {
  for (const message of document.visible_messages) {
    const { content_hash: _contentHash, ...draft } = message;
    if ((await computeProviderTaskVisibleMessageHash(draft)) !== message.content_hash) {
      throw new TypeError("PROVIDER_TASK_VISIBLE_MESSAGE_HASH_MISMATCH");
    }
  }
  const selectionHash = await computeProviderTaskContextSelectionHash({
    conversation_id: document.conversation_id,
    conversation_resource_version: document.conversation_resource_version,
    current_message_id: document.current_message.message_id,
    visible_messages: document.visible_messages,
    context_summary_ref: document.context_summary_ref,
  });
  if (selectionHash !== document.context_selection_hash) {
    throw new TypeError("PROVIDER_TASK_CONTEXT_SELECTION_HASH_MISMATCH");
  }
  return document;
}

export async function computeProviderTaskArtifactHash(input: unknown) {
  const document = z
    .discriminatedUnion("schema_version", [
      providerTaskArtifactV1DocumentDraftSchema,
      providerTaskArtifactV2DocumentDraftSchema,
    ])
    .parse(input);
  if (document.schema_version === "provider-task-artifact@2.0.0") {
    await verifyProviderTaskArtifactV2Draft(document);
  }
  return sha256ContentHash(document);
}

export async function buildProviderTaskArtifactDocument(input: unknown) {
  const document = z
    .discriminatedUnion("schema_version", [
      providerTaskArtifactV1DocumentDraftSchema,
      providerTaskArtifactV2DocumentDraftSchema,
    ])
    .parse(input);
  return providerTaskArtifactDocumentSchema.parse({
    ...document,
    content_hash: await computeProviderTaskArtifactHash(document),
  });
}

export async function verifyProviderTaskArtifactDocument(input: unknown) {
  const document = providerTaskArtifactDocumentSchema.parse(input);
  const { content_hash: _contentHash, ...draft } = document;
  if ((await computeProviderTaskArtifactHash(draft)) !== document.content_hash) {
    throw new TypeError("PROVIDER_TASK_ARTIFACT_HASH_MISMATCH");
  }
  return document;
}

export const commitProviderTaskArtifactCommandSchema = z.strictObject({
  schema_version: z.literal("provider-task-artifact-commit@1.0.0"),
  scope: providerInvocationScopeSchema,
  run_id: immutableIdSchema,
  conversation_binding: providerTaskConversationBindingSchema,
  context_summary_ref: artifactReferenceSchema.nullable(),
});

export const commitProviderTaskArtifactResultSchema = z
  .strictObject({
    schema_version: z.literal("provider-task-artifact-commit-result@1.0.0"),
    disposition: z.enum(["CREATED", "REPLAYED"]),
    reference: providerTaskArtifactReferenceSchema,
    document: providerTaskArtifactDocumentSchema,
    committed_at: canonicalU2TimestampSchema,
  })
  .superRefine((result, ctx) => {
    const documentArtifactId =
      result.document.schema_version === "provider-task-artifact@1.0.0"
        ? result.document.message_id
        : result.document.current_message.message_id;
    const documentRunId =
      result.document.schema_version === "provider-task-artifact@1.0.0"
        ? result.document.run_id
        : result.document.visible_messages.at(-1)?.run_id;
    if (
      result.reference.artifact_id !== documentArtifactId ||
      result.reference.run_id !== documentRunId ||
      result.reference.revision !== 1 ||
      result.reference.content_hash !== result.document.content_hash
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Provider Task Artifact result 必须绑定 DB-resolved accepted message document。",
      });
    }
  });

export async function verifyCommitProviderTaskArtifactResult(
  commandInput: unknown,
  resultInput: unknown,
) {
  const command = commitProviderTaskArtifactCommandSchema.parse(commandInput);
  const result = commitProviderTaskArtifactResultSchema.parse(resultInput);
  await verifyProviderTaskArtifactDocument(result.document);
  const conversationMatches =
    result.document.schema_version === "provider-task-artifact@1.0.0"
      ? result.document.conversation_id === command.conversation_binding.conversation_id &&
        result.document.conversation_resource_version ===
          command.conversation_binding.resource_version &&
        result.document.run_id === command.run_id
      : result.document.conversation_id === command.conversation_binding.conversation_id &&
        result.document.conversation_resource_version ===
          command.conversation_binding.resource_version &&
        result.document.current_message.message_id === result.reference.artifact_id &&
        result.document.visible_messages.at(-1)?.run_id === command.run_id;
  if (
    result.reference.app_id !== command.scope.app_id ||
    result.reference.tenant_id !== command.scope.tenant_id ||
    result.reference.environment !== command.scope.environment ||
    result.reference.run_id !== command.run_id ||
    !conversationMatches
  ) {
    throw new TypeError("PROVIDER_TASK_ARTIFACT_COMMAND_RESULT_MISMATCH");
  }
  return result;
}

export const loadProviderTaskArtifactCommandSchema = z
  .strictObject({
    schema_version: z.literal("provider-task-artifact-load@1.0.0"),
    scope: providerInvocationScopeSchema,
    run_id: immutableIdSchema,
    reference: providerTaskArtifactReferenceSchema,
  })
  .superRefine((command, ctx) => {
    if (
      command.reference.app_id !== command.scope.app_id ||
      command.reference.tenant_id !== command.scope.tenant_id ||
      command.reference.environment !== command.scope.environment ||
      command.reference.run_id !== command.run_id
    ) {
      ctx.addIssue({ code: "custom", message: "Provider Task load ref 必须同 Scope/Run。" });
    }
  });

export const loadProviderTaskArtifactResultSchema = z
  .strictObject({
    schema_version: z.literal("provider-task-artifact-load-result@1.0.0"),
    reference: providerTaskArtifactReferenceSchema,
    document: providerTaskArtifactDocumentSchema,
  })
  .superRefine((result, ctx) => {
    const documentArtifactId =
      result.document.schema_version === "provider-task-artifact@1.0.0"
        ? result.document.message_id
        : result.document.current_message.message_id;
    const documentRunId =
      result.document.schema_version === "provider-task-artifact@1.0.0"
        ? result.document.run_id
        : result.document.visible_messages.at(-1)?.run_id;
    if (
      result.reference.artifact_id !== documentArtifactId ||
      result.reference.run_id !== documentRunId ||
      result.reference.revision !== 1 ||
      result.reference.content_hash !== result.document.content_hash
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Loaded Provider Task Artifact ref/document 不一致。",
      });
    }
  });

export async function verifyLoadProviderTaskArtifactResult(
  commandInput: unknown,
  resultInput: unknown,
) {
  const command = loadProviderTaskArtifactCommandSchema.parse(commandInput);
  const result = loadProviderTaskArtifactResultSchema.parse(resultInput);
  await verifyProviderTaskArtifactDocument(result.document);
  if (
    artifactReferenceIdentity(result.reference) !== artifactReferenceIdentity(command.reference)
  ) {
    throw new TypeError("PROVIDER_TASK_ARTIFACT_LOAD_RESULT_MISMATCH");
  }
  return result;
}

export const providerInvocationReasonCodeSchema = z.enum([
  "PROVIDER_PROFILE_NOT_AVAILABLE",
  "PROVIDER_CERTIFICATION_REQUIRED",
  "PROVIDER_CONTEXT_WINDOW_UNVERIFIED",
  "PROVIDER_CONTEXT_LIMIT_EXCEEDED",
  "PROVIDER_OUTPUT_LIMIT_EXCEEDED",
  "PROVIDER_CALL_LIMIT_EXCEEDED",
  "PROVIDER_EGRESS_DENIED",
  "PROVIDER_DISPATCH_ENVELOPE_INVALID",
  "PROVIDER_CONTEXT_RECEIPT_MISMATCH",
  "PROVIDER_WORKER_LEASE_STALE",
  "PROVIDER_CREDENTIAL_UNAVAILABLE",
  "PROVIDER_LOCAL_PREPARATION_FAILED",
  "PROVIDER_THROTTLED",
  "PROVIDER_TIMEOUT",
  "PROVIDER_PROTOCOL_VIOLATION",
  "PROVIDER_INVOCATION_FAILED",
  "PROVIDER_INVOCATION_OUTCOME_UNKNOWN",
  "PROVIDER_RECONCILIATION_REQUIRED",
]);

export const providerInvocationRecoveryActionSchema = z.enum([
  "NONE",
  "SAFE_RETRY",
  "STATUS_QUERY_REQUIRED",
  "RECONCILIATION_REQUIRED",
  "MANUAL_REVIEW_REQUIRED",
]);

export const providerInvocationOutcomeCandidateSchema = z
  .strictObject({
    schema_version: z.literal("provider-invocation-outcome-candidate@1.0.0"),
    intent_id: immutableIdSchema,
    invocation_id: immutableIdSchema,
    scope: providerInvocationScopeSchema,
    run_id: immutableIdSchema,
    dispatch_hash: contentHashSchema,
    status: providerInvocationTerminalStatusSchema,
    reason_code: providerInvocationReasonCodeSchema.nullable(),
    response_artifact_ref: providerResponseArtifactReferenceSchema.nullable(),
    response_hash: contentHashSchema.nullable(),
    delivery_certainty: z.enum([
      "NOT_DISPATCHED",
      "DISPATCHED_OUTCOME_KNOWN",
      "DISPATCHED_OUTCOME_UNKNOWN",
    ]),
    transition_from: z.enum([
      "INTENT_COMMITTED",
      "DISPATCH_MARKED",
      "RESPONSE_OBSERVED",
      "OUTCOME_UNKNOWN",
    ]),
    recovery_action: providerInvocationRecoveryActionSchema,
    provider_call_count: z.number().int().nonnegative().max(1),
    retry_after_ms: z.number().int().positive().max(86_400_000).nullable(),
    reconciliation_of: immutableIdSchema.nullable(),
  })
  .superRefine((outcome, ctx) => {
    const completed = outcome.status === "COMPLETED";
    if (
      completed !== (outcome.response_artifact_ref !== null) ||
      completed !== (outcome.response_hash !== null) ||
      completed !== (outcome.reason_code === null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "COMPLETED 必须且只能绑定 Response Artifact/Hash，失败终态必须有 reason。",
        path: ["status"],
      });
    }
    if (
      outcome.response_artifact_ref &&
      (outcome.response_artifact_ref.app_id !== outcome.scope.app_id ||
        outcome.response_artifact_ref.tenant_id !== outcome.scope.tenant_id ||
        outcome.response_artifact_ref.environment !== outcome.scope.environment ||
        outcome.response_artifact_ref.run_id !== outcome.run_id)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Response Artifact 必须同 Scope/Run 且 Content Hash 精确一致。",
        path: ["response_artifact_ref"],
      });
    }
    if (
      outcome.status === "COMPLETED" &&
      (outcome.delivery_certainty !== "DISPATCHED_OUTCOME_KNOWN" ||
        outcome.provider_call_count !== 1 ||
        outcome.recovery_action !== "NONE" ||
        !["RESPONSE_OBSERVED", "OUTCOME_UNKNOWN"].includes(outcome.transition_from))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "COMPLETED 必须是 direct 或 evidence-backed reconciled known outcome。",
        path: ["status"],
      });
    }
    if (
      outcome.status === "FAILED" &&
      (outcome.delivery_certainty === "DISPATCHED_OUTCOME_UNKNOWN" ||
        (outcome.transition_from === "INTENT_COMMITTED") !== (outcome.provider_call_count === 0))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "FAILED 必须精确区分 pre-dispatch 与 known post-dispatch。",
        path: ["status"],
      });
    }
    if (
      outcome.status === "THROTTLED" &&
      ((outcome.transition_from !== "RESPONSE_OBSERVED" &&
        outcome.transition_from !== "OUTCOME_UNKNOWN") ||
        outcome.delivery_certainty !== "DISPATCHED_OUTCOME_KNOWN" ||
        outcome.provider_call_count !== 1)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "THROTTLED 必须是 direct 或 evidence-backed reconciled 的确定拒绝。",
        path: ["status"],
      });
    }
    if (
      outcome.status === "OUTCOME_UNKNOWN" &&
      (!["DISPATCH_MARKED", "RESPONSE_OBSERVED"].includes(outcome.transition_from) ||
        outcome.provider_call_count !== 1 ||
        outcome.reconciliation_of !== null ||
        ![
          "SAFE_RETRY",
          "STATUS_QUERY_REQUIRED",
          "RECONCILIATION_REQUIRED",
          "MANUAL_REVIEW_REQUIRED",
        ].includes(outcome.recovery_action))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "OUTCOME_UNKNOWN 必须进入 reconcile/manual recovery。",
        path: ["status"],
      });
    }
    if (
      outcome.transition_from === "OUTCOME_UNKNOWN" &&
      (outcome.reconciliation_of === null ||
        outcome.recovery_action !== "NONE" ||
        outcome.delivery_certainty !== "DISPATCHED_OUTCOME_KNOWN")
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Reconciled terminal 必须绑定 unknown parent 和 known evidence。",
        path: ["reconciliation_of"],
      });
    }
    if ((outcome.transition_from === "OUTCOME_UNKNOWN") !== (outcome.reconciliation_of !== null)) {
      ctx.addIssue({
        code: "custom",
        message: "reconciliation_of 必须且只能绑定 OUTCOME_UNKNOWN parent。",
        path: ["reconciliation_of"],
      });
    }
    if (
      outcome.status === "OUTCOME_UNKNOWN" &&
      (outcome.delivery_certainty !== "DISPATCHED_OUTCOME_UNKNOWN" ||
        outcome.reason_code !== "PROVIDER_INVOCATION_OUTCOME_UNKNOWN")
    ) {
      ctx.addIssue({
        code: "custom",
        message: "OUTCOME_UNKNOWN 必须保留 dispatch uncertainty。",
        path: ["delivery_certainty"],
      });
    }
    if ((outcome.delivery_certainty === "NOT_DISPATCHED") !== (outcome.provider_call_count === 0)) {
      ctx.addIssue({
        code: "custom",
        message: "provider_call_count 必须与 delivery certainty 精确闭合。",
        path: ["provider_call_count"],
      });
    }
    if ((outcome.status === "THROTTLED") !== (outcome.retry_after_ms !== null)) {
      ctx.addIssue({
        code: "custom",
        message: "只有 THROTTLED 必须且只能携带 retry_after_ms。",
        path: ["retry_after_ms"],
      });
    }
  });

const providerInvocationOutcomeReceiptDraftSchema = z.strictObject({
  schema_version: z.literal("provider-invocation-outcome@1.0.0"),
  outcome_id: immutableIdSchema,
  candidate: providerInvocationOutcomeCandidateSchema,
  dispatch_marked_at: canonicalU2TimestampSchema.nullable(),
  terminal_at: canonicalU2TimestampSchema,
  latency_ms: z.number().int().nonnegative().safe().nullable(),
});

export const providerInvocationOutcomeReceiptSchema =
  providerInvocationOutcomeReceiptDraftSchema.safeExtend({ outcome_hash: contentHashSchema });

export async function computeProviderInvocationOutcomeHash(input: unknown) {
  return sha256ContentHash(providerInvocationOutcomeReceiptDraftSchema.parse(input));
}

export async function buildProviderInvocationOutcomeReceipt(input: unknown) {
  const outcome = providerInvocationOutcomeReceiptDraftSchema.parse(input);
  return providerInvocationOutcomeReceiptSchema.parse({
    ...outcome,
    outcome_hash: await computeProviderInvocationOutcomeHash(outcome),
  });
}

export async function verifyProviderInvocationOutcomeReceipt(input: unknown) {
  const outcome = providerInvocationOutcomeReceiptSchema.parse(input);
  const { outcome_hash: _outcomeHash, ...draft } = outcome;
  if ((await computeProviderInvocationOutcomeHash(draft)) !== outcome.outcome_hash) {
    throw new TypeError("PROVIDER_INVOCATION_OUTCOME_HASH_MISMATCH");
  }
  return outcome;
}

const providerInvocationDispatchMarkerDraftSchema = z.strictObject({
  schema_version: z.literal("provider-invocation-dispatch-marker@1.0.0"),
  marker_id: immutableIdSchema,
  intent_id: immutableIdSchema,
  invocation_id: immutableIdSchema,
  scope: providerInvocationScopeSchema,
  run_id: immutableIdSchema,
  dispatch_hash: contentHashSchema,
  state: z.literal("DISPATCH_MARKED"),
  dispatch_marked_at: canonicalU2TimestampSchema,
});

export const providerInvocationDispatchMarkerSchema =
  providerInvocationDispatchMarkerDraftSchema.safeExtend({ marker_hash: contentHashSchema });

export async function computeProviderInvocationDispatchMarkerHash(input: unknown) {
  return sha256ContentHash(providerInvocationDispatchMarkerDraftSchema.parse(input));
}

export async function buildProviderInvocationDispatchMarkerReceipt(input: unknown) {
  const marker = providerInvocationDispatchMarkerDraftSchema.parse(input);
  return providerInvocationDispatchMarkerSchema.parse({
    ...marker,
    marker_hash: await computeProviderInvocationDispatchMarkerHash(marker),
  });
}

export async function verifyProviderInvocationDispatchMarkerReceipt(input: unknown) {
  const marker = providerInvocationDispatchMarkerSchema.parse(input);
  const { marker_hash: _markerHash, ...draft } = marker;
  if ((await computeProviderInvocationDispatchMarkerHash(draft)) !== marker.marker_hash) {
    throw new TypeError("PROVIDER_INVOCATION_MARKER_HASH_MISMATCH");
  }
  return marker;
}

export const providerInvocationResponseObservationKindSchema = z.enum([
  "COMPLETED",
  "FAILED",
  "THROTTLED",
  "OUTCOME_UNKNOWN",
]);

const providerInvocationResponseObservedMarkerDraftSchema = z
  .strictObject({
    schema_version: z.literal("provider-invocation-response-observed-marker@1.0.0"),
    marker_id: immutableIdSchema,
    intent_id: immutableIdSchema,
    invocation_id: immutableIdSchema,
    scope: providerInvocationScopeSchema,
    run_id: immutableIdSchema,
    dispatch_hash: contentHashSchema,
    attempt_id: immutableIdSchema,
    worker_fence: positiveRevisionSchema,
    state: z.literal("RESPONSE_OBSERVED"),
    observation_kind: providerInvocationResponseObservationKindSchema,
    response_hash: contentHashSchema.nullable(),
    delivery_certainty: z.enum(["DISPATCHED_OUTCOME_KNOWN", "DISPATCHED_OUTCOME_UNKNOWN"]),
    response_observed_at: canonicalU2TimestampSchema,
  })
  .superRefine((marker, ctx) => {
    const completed = marker.observation_kind === "COMPLETED";
    const unknown = marker.observation_kind === "OUTCOME_UNKNOWN";
    if (
      completed !== (marker.response_hash !== null) ||
      unknown !== (marker.delivery_certainty === "DISPATCHED_OUTCOME_UNKNOWN")
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "RESPONSE_OBSERVED 必须精确闭合 observation kind、response hash 与 delivery certainty。",
      });
    }
  });

export const providerInvocationResponseObservedMarkerSchema =
  providerInvocationResponseObservedMarkerDraftSchema.safeExtend({
    marker_hash: contentHashSchema,
  });

export async function computeProviderInvocationResponseObservedMarkerHash(input: unknown) {
  return sha256ContentHash(providerInvocationResponseObservedMarkerDraftSchema.parse(input));
}

export async function buildProviderInvocationResponseObservedMarkerReceipt(input: unknown) {
  const marker = providerInvocationResponseObservedMarkerDraftSchema.parse(input);
  return providerInvocationResponseObservedMarkerSchema.parse({
    ...marker,
    marker_hash: await computeProviderInvocationResponseObservedMarkerHash(marker),
  });
}

export async function verifyProviderInvocationResponseObservedMarkerReceipt(input: unknown) {
  const marker = providerInvocationResponseObservedMarkerSchema.parse(input);
  const { marker_hash: _markerHash, ...draft } = marker;
  if ((await computeProviderInvocationResponseObservedMarkerHash(draft)) !== marker.marker_hash) {
    throw new TypeError("PROVIDER_INVOCATION_RESPONSE_OBSERVED_MARKER_HASH_MISMATCH");
  }
  return marker;
}

export const providerInvocationPublicProjectionSchema = z
  .strictObject({
    schema_version: z.literal("provider-invocation-public@1.0.0"),
    invocation_id: immutableIdSchema,
    run_id: immutableIdSchema,
    provider: providerIdentifierSchema,
    model_profile_id: immutableIdSchema,
    model_config_version: positiveRevisionSchema,
    profile_version: versionIdentifierSchema,
    model_id: z.string().min(1).max(256),
    certification_receipt_ref: artifactReferenceSchema,
    attempt_id: immutableIdSchema,
    attempt_no: positiveRevisionSchema,
    recovery_action: providerInvocationRecoveryActionSchema.nullable(),
    status: z.enum(["STARTED", "COMPLETED", "FAILED", "THROTTLED", "OUTCOME_UNKNOWN"]),
    reason_code: providerInvocationReasonCodeSchema.nullable(),
    dispatch_hash: contentHashSchema,
    response_hash: contentHashSchema.nullable(),
    usage_availability: z.enum(["AVAILABLE", "NOT_APPLICABLE", "UNAVAILABLE"]).nullable(),
    usage_source: z.enum(["PROVIDER_REPORTED", "ESTIMATED", "UNAVAILABLE"]).nullable(),
    input_tokens: nonNegativeUsageSchema.nullable(),
    output_tokens: nonNegativeUsageSchema.nullable(),
    total_tokens: nonNegativeUsageSchema.nullable(),
    tool_calls: nonNegativeUsageSchema.nullable(),
    provider_call_count: z.number().int().nonnegative().max(1),
    retry_after_ms: z.number().int().positive().max(86_400_000).nullable(),
    latency_ms: z.number().int().nonnegative().safe().nullable(),
    receipt_deep_link: z
      .string()
      .regex(/^\/w\/[0-9a-f-]+\/runs\/[0-9a-f-]+\/provider-invocations\/[0-9a-f-]+$/),
    terminal_at: canonicalU2TimestampSchema.nullable(),
  })
  .superRefine((projection, ctx) => {
    const startedOnly = projection.status === "STARTED";
    if (
      startedOnly &&
      (projection.reason_code !== null ||
        projection.response_hash !== null ||
        projection.usage_availability !== null ||
        projection.usage_source !== null ||
        projection.terminal_at !== null ||
        projection.recovery_action !== null ||
        projection.provider_call_count !== 1 ||
        projection.retry_after_ms !== null ||
        projection.latency_ms !== null ||
        projection.input_tokens !== null ||
        projection.output_tokens !== null ||
        projection.total_tokens !== null ||
        projection.tool_calls !== null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Public STARTED 只投影 durable DISPATCH_MARKED，不得伪造 terminal/usage。",
      });
    }
    if (
      !startedOnly &&
      (projection.usage_availability === null ||
        projection.usage_source === null ||
        projection.terminal_at === null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Public terminal 必须绑定 committed usage 和 terminal time。",
      });
    }
  });

function addTerminalResultClosureIssues(
  result: {
    outcome: z.infer<typeof providerInvocationOutcomeReceiptSchema>;
    usage: z.infer<typeof providerInvocationUsageReceiptSchema>;
    projection: z.infer<typeof providerInvocationPublicProjectionSchema>;
  },
  ctx: z.RefinementCtx,
): void {
  const candidate = result.outcome.candidate;
  const usage = result.usage;
  const projection = result.projection;
  if (
    usage.outcome_id !== result.outcome.outcome_id ||
    usage.intent_id !== candidate.intent_id ||
    usage.invocation_id !== candidate.invocation_id ||
    usage.run_id !== candidate.run_id ||
    !sameProviderInvocationScope(usage.scope, candidate.scope) ||
    usage.provider_call_count !== candidate.provider_call_count ||
    usage.observed_at !== result.outcome.terminal_at ||
    projection.invocation_id !== candidate.invocation_id ||
    projection.run_id !== candidate.run_id ||
    projection.status !== candidate.status ||
    projection.reason_code !== candidate.reason_code ||
    projection.response_hash !== candidate.response_hash ||
    projection.usage_availability !== usage.availability ||
    projection.usage_source !== usage.source ||
    projection.input_tokens !== usage.input_tokens ||
    projection.output_tokens !== usage.output_tokens ||
    projection.total_tokens !== usage.total_tokens ||
    projection.tool_calls !== usage.tool_calls ||
    projection.provider_call_count !== usage.provider_call_count ||
    projection.retry_after_ms !== candidate.retry_after_ms ||
    projection.latency_ms !== result.outcome.latency_ms ||
    projection.terminal_at !== result.outcome.terminal_at
  ) {
    ctx.addIssue({
      code: "custom",
      message: "Outcome/Usage/Public Projection 必须逐字段 exact closure。",
    });
  }
}

function sameProviderInvocationScope(
  left: z.infer<typeof providerInvocationScopeSchema>,
  right: z.infer<typeof providerInvocationScopeSchema>,
): boolean {
  return (
    left.app_id === right.app_id &&
    left.tenant_id === right.tenant_id &&
    left.environment === right.environment &&
    left.workspace_id === right.workspace_id &&
    left.principal_id === right.principal_id
  );
}

function providerInvocationProjectionMatchesAuthority(
  projection: z.infer<typeof providerInvocationPublicProjectionSchema>,
  spec: z.infer<typeof providerInvocationStableSpecSchema>,
  attempt: { attempt_id: string; attempt_no: number; dispatch_hash: string },
): boolean {
  return (
    projection.invocation_id === spec.invocation_id &&
    projection.run_id === spec.run_id &&
    projection.provider === spec.model_profile.provider &&
    projection.model_profile_id === spec.model_profile.profile_id &&
    projection.model_config_version === spec.model_profile.model_config_version &&
    projection.profile_version === spec.model_profile.profile_version &&
    projection.model_id === spec.model_profile.model_id &&
    artifactReferenceIdentity(projection.certification_receipt_ref) ===
      artifactReferenceIdentity(spec.certification.receipt_ref) &&
    projection.attempt_id === attempt.attempt_id &&
    projection.attempt_no === attempt.attempt_no &&
    projection.dispatch_hash === attempt.dispatch_hash &&
    projection.receipt_deep_link ===
      `/w/${spec.scope.workspace_id}/runs/${spec.run_id}/provider-invocations/${spec.invocation_id}`
  );
}

function addCommittedAttemptProjectionClosureIssues(
  result: {
    intent: z.infer<typeof providerInvocationIntentSchema>;
    permit: z.infer<typeof committedProviderDispatchPermitSchema>;
    projection: z.infer<typeof providerInvocationPublicProjectionSchema>;
    outcome?: z.infer<typeof providerInvocationOutcomeReceiptSchema> | null;
  },
  ctx: z.RefinementCtx,
): void {
  const spec = result.intent.invocation_spec;
  const permit = result.permit;
  const projection = result.projection;
  if (
    permit.intent_id !== result.intent.intent_id ||
    permit.invocation_id !== spec.invocation_id ||
    permit.run_id !== spec.run_id ||
    !sameProviderInvocationScope(permit.scope, spec.scope) ||
    !providerInvocationProjectionMatchesAuthority(projection, spec, {
      attempt_id: permit.attempt_id,
      attempt_no: permit.lease.attempt_no,
      dispatch_hash: permit.dispatch_hash,
    }) ||
    (result.outcome != null &&
      (result.outcome.candidate.intent_id !== result.intent.intent_id ||
        result.outcome.candidate.invocation_id !== permit.invocation_id ||
        result.outcome.candidate.run_id !== permit.run_id ||
        !sameProviderInvocationScope(result.outcome.candidate.scope, permit.scope) ||
        result.outcome.candidate.dispatch_hash !== permit.dispatch_hash))
  ) {
    ctx.addIssue({
      code: "custom",
      message: "Public Projection 必须与 committed Intent/Permit identity 全字段精确闭合。",
    });
  }
}

function addTransitionOutcomeClosureIssues(
  command: {
    intent_id: string;
    invocation_id: string;
    scope: z.infer<typeof providerInvocationScopeSchema>;
    run_id: string;
    dispatch_hash: string;
    outcome: {
      intent_id: string;
      invocation_id: string;
      scope: z.infer<typeof providerInvocationScopeSchema>;
      run_id: string;
      dispatch_hash: string;
      provider_call_count: number;
    };
    usage: z.infer<typeof providerInvocationUsageCandidateSchema>;
  },
  ctx: z.RefinementCtx,
): void {
  if (
    command.outcome.intent_id !== command.intent_id ||
    command.outcome.invocation_id !== command.invocation_id ||
    command.outcome.run_id !== command.run_id ||
    command.outcome.dispatch_hash !== command.dispatch_hash ||
    !sameProviderInvocationScope(command.outcome.scope, command.scope) ||
    command.outcome.provider_call_count !== command.usage.provider_call_count
  ) {
    ctx.addIssue({
      code: "custom",
      message: "Provider transition outcome/usage 必须与 command identity/scope 精确闭合。",
    });
  }
}

export const beginProviderInvocationCommandSchema = z.strictObject({
  schema_version: z.literal("provider-invocation-begin@1.0.0"),
  envelope: providerDispatchEnvelopeSchema,
});

export const beginProviderInvocationReadyResultSchema = z
  .strictObject({
    schema_version: z.literal("provider-invocation-begin-result@1.0.0"),
    admission: z.literal("READY"),
    disposition: z.enum(["CREATED", "REPLAYED"]),
    intent: providerInvocationIntentSchema,
    permit: committedProviderDispatchPermitSchema,
  })
  .superRefine((result, ctx) => {
    if (
      result.permit.intent_id !== result.intent.intent_id ||
      result.permit.invocation_id !== result.intent.invocation_spec.invocation_id ||
      result.permit.run_id !== result.intent.invocation_spec.run_id ||
      !sameProviderInvocationScope(result.permit.scope, result.intent.invocation_spec.scope)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "READY permit 必须与 stable Intent identity/scope 精确闭合。",
      });
    }
  });

export const beginProviderInvocationRejectedResultSchema = z
  .strictObject({
    schema_version: z.literal("provider-invocation-begin-result@1.0.0"),
    admission: z.literal("REJECTED"),
    disposition: z.enum(["CREATED", "REPLAYED"]),
    rejection_reason: z.enum([
      "PROVIDER_PROFILE_NOT_AVAILABLE",
      "PROVIDER_CERTIFICATION_REQUIRED",
      "PROVIDER_CONTEXT_WINDOW_UNVERIFIED",
      "PROVIDER_CONTEXT_LIMIT_EXCEEDED",
      "PROVIDER_OUTPUT_LIMIT_EXCEEDED",
      "PROVIDER_CALL_LIMIT_EXCEEDED",
      "PROVIDER_EGRESS_DENIED",
      "PROVIDER_DISPATCH_ENVELOPE_INVALID",
      "PROVIDER_CONTEXT_RECEIPT_MISMATCH",
      "PROVIDER_WORKER_LEASE_STALE",
    ]),
    intent: providerInvocationIntentSchema,
    permit: z.null(),
    outcome: providerInvocationOutcomeReceiptSchema,
    usage: providerInvocationUsageReceiptSchema,
    projection: providerInvocationPublicProjectionSchema,
  })
  .superRefine((result, ctx) => {
    addTerminalResultClosureIssues(result, ctx);
    if (
      result.outcome.candidate.intent_id !== result.intent.intent_id ||
      result.outcome.candidate.invocation_id !== result.intent.invocation_spec.invocation_id ||
      result.outcome.candidate.run_id !== result.intent.invocation_spec.run_id ||
      !sameProviderInvocationScope(
        result.outcome.candidate.scope,
        result.intent.invocation_spec.scope,
      ) ||
      result.outcome.candidate.status !== "FAILED" ||
      result.outcome.candidate.transition_from !== "INTENT_COMMITTED" ||
      result.outcome.candidate.delivery_certainty !== "NOT_DISPATCHED" ||
      result.outcome.candidate.provider_call_count !== 0 ||
      result.usage.availability !== "NOT_APPLICABLE" ||
      result.projection.dispatch_hash !== result.outcome.candidate.dispatch_hash ||
      !providerInvocationProjectionMatchesAuthority(
        result.projection,
        result.intent.invocation_spec,
        {
          attempt_id: result.projection.attempt_id,
          attempt_no: result.projection.attempt_no,
          dispatch_hash: result.outcome.candidate.dispatch_hash,
        },
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Begin rejection 必须提交完整 pre-dispatch terminal/usage 且无permit。",
      });
    }
  });

export const providerInvocationTerminalReplayActionSchema = z.enum([
  "RETURN_RECORDED",
  "NEW_LOGICAL_INVOCATION_REQUIRED",
  "NEW_LOGICAL_INVOCATION_AFTER_RETRY_DELAY",
  "RECONCILIATION_REQUIRED",
]);

export const beginProviderInvocationTerminalReplayResultSchema = z
  .strictObject({
    schema_version: z.literal("provider-invocation-begin-result@1.0.0"),
    admission: z.literal("TERMINAL_REPLAY"),
    disposition: z.literal("REPLAYED"),
    replay_action: providerInvocationTerminalReplayActionSchema,
    intent: providerInvocationIntentSchema,
    original_permit: committedProviderDispatchPermitSchema,
    outcome: providerInvocationOutcomeReceiptSchema,
    usage: providerInvocationUsageReceiptSchema,
    projection: providerInvocationPublicProjectionSchema,
    response_artifact_ref: providerResponseArtifactReferenceSchema.nullable(),
  })
  .superRefine((result, ctx) => {
    addTerminalResultClosureIssues(result, ctx);
    addCommittedAttemptProjectionClosureIssues(
      {
        intent: result.intent,
        permit: result.original_permit,
        outcome: result.outcome,
        projection: result.projection,
      },
      ctx,
    );
    const candidate = result.outcome.candidate;
    const responseMatches =
      candidate.response_artifact_ref !== null &&
      result.response_artifact_ref !== null &&
      canonicalizeJson(candidate.response_artifact_ref) ===
        canonicalizeJson(result.response_artifact_ref);
    const actionMatches =
      (candidate.status === "COMPLETED" &&
        result.replay_action === "RETURN_RECORDED" &&
        responseMatches) ||
      (candidate.status === "FAILED" &&
        result.replay_action === "NEW_LOGICAL_INVOCATION_REQUIRED" &&
        result.response_artifact_ref === null) ||
      (candidate.status === "THROTTLED" &&
        result.replay_action === "NEW_LOGICAL_INVOCATION_AFTER_RETRY_DELAY" &&
        candidate.retry_after_ms !== null &&
        result.response_artifact_ref === null) ||
      (candidate.status === "OUTCOME_UNKNOWN" &&
        result.replay_action === "RECONCILIATION_REQUIRED" &&
        result.response_artifact_ref === null);
    if (!actionMatches) {
      ctx.addIssue({
        code: "custom",
        message: "Terminal replay action/response ref 必须由 recorded terminal 唯一决定。",
      });
    }
  });

export const beginProviderInvocationResultSchema = z.discriminatedUnion("admission", [
  beginProviderInvocationReadyResultSchema,
  beginProviderInvocationRejectedResultSchema,
  beginProviderInvocationTerminalReplayResultSchema,
]);

const providerTransitionCommandBase = {
  intent_id: immutableIdSchema,
  invocation_id: immutableIdSchema,
  scope: providerInvocationScopeSchema,
  run_id: immutableIdSchema,
  dispatch_hash: contentHashSchema,
  attempt_id: immutableIdSchema,
  worker_fence: positiveRevisionSchema,
} as const;

export const markProviderInvocationStartedCommandSchema = z.strictObject({
  schema_version: z.literal("provider-invocation-mark-started@1.0.0"),
  ...providerTransitionCommandBase,
});

export const markProviderInvocationStartedResultSchema = z
  .strictObject({
    schema_version: z.literal("provider-invocation-mark-started-result@1.0.0"),
    disposition: z.enum(["CREATED", "REPLAYED"]),
    intent: providerInvocationIntentSchema,
    permit: committedProviderDispatchPermitSchema,
    marker: providerInvocationDispatchMarkerSchema,
    projection: providerInvocationPublicProjectionSchema,
  })
  .superRefine((result, ctx) => {
    addCommittedAttemptProjectionClosureIssues(result, ctx);
    if (
      result.marker.intent_id !== result.intent.intent_id ||
      result.marker.invocation_id !== result.permit.invocation_id ||
      result.marker.run_id !== result.permit.run_id ||
      !sameProviderInvocationScope(result.marker.scope, result.permit.scope) ||
      result.marker.dispatch_hash !== result.permit.dispatch_hash ||
      result.projection.status !== "STARTED"
    ) {
      ctx.addIssue({ code: "custom", message: "Dispatch Marker 必须与 Intent/Permit 精确闭合。" });
    }
  });

export const markProviderInvocationResponseObservedCommandSchema = z
  .strictObject({
    schema_version: z.literal("provider-invocation-mark-response-observed@1.0.0"),
    ...providerTransitionCommandBase,
    observation_kind: providerInvocationResponseObservationKindSchema,
    response_hash: contentHashSchema.nullable(),
    delivery_certainty: z.enum(["DISPATCHED_OUTCOME_KNOWN", "DISPATCHED_OUTCOME_UNKNOWN"]),
  })
  .superRefine((command, ctx) => {
    if (
      (command.observation_kind === "COMPLETED") !== (command.response_hash !== null) ||
      (command.observation_kind === "OUTCOME_UNKNOWN") !==
        (command.delivery_certainty === "DISPATCHED_OUTCOME_UNKNOWN")
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Response observed command 必须精确闭合 kind/hash/delivery certainty。",
      });
    }
  });

export const markProviderInvocationResponseObservedResultSchema = z
  .strictObject({
    schema_version: z.literal("provider-invocation-mark-response-observed-result@1.0.0"),
    disposition: z.enum(["CREATED", "REPLAYED"]),
    intent: providerInvocationIntentSchema,
    permit: committedProviderDispatchPermitSchema,
    marker: providerInvocationResponseObservedMarkerSchema,
    projection: providerInvocationPublicProjectionSchema,
  })
  .superRefine((result, ctx) => {
    addCommittedAttemptProjectionClosureIssues(result, ctx);
    if (
      result.marker.intent_id !== result.intent.intent_id ||
      result.marker.invocation_id !== result.permit.invocation_id ||
      result.marker.run_id !== result.permit.run_id ||
      !sameProviderInvocationScope(result.marker.scope, result.permit.scope) ||
      result.marker.dispatch_hash !== result.permit.dispatch_hash ||
      result.marker.attempt_id !== result.permit.attempt_id ||
      result.marker.worker_fence !== result.permit.worker_fence ||
      result.projection.status !== "STARTED"
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Response Observed Marker 必须与 Intent/Permit 精确闭合。",
      });
    }
  });

export const commitProviderInvocationTerminalCommandSchema = z
  .strictObject({
    schema_version: z.literal("provider-invocation-commit-terminal@1.0.0"),
    ...providerTransitionCommandBase,
    outcome: providerInvocationOutcomeCandidateSchema,
    usage: providerInvocationUsageCandidateSchema,
  })
  .superRefine((command, ctx) => {
    addTransitionOutcomeClosureIssues(command, ctx);
    if (command.outcome.status === "COMPLETED") {
      ctx.addIssue({
        code: "custom",
        message: "COMPLETED 必须使用原子 response+terminal commit RPC。",
      });
    }
  });

export const providerInvocationCompletedOutcomeCandidateSchema = z
  .strictObject({
    schema_version: z.literal("provider-invocation-completed-candidate@1.0.0"),
    intent_id: immutableIdSchema,
    invocation_id: immutableIdSchema,
    scope: providerInvocationScopeSchema,
    run_id: immutableIdSchema,
    dispatch_hash: contentHashSchema,
    status: z.literal("COMPLETED"),
    reason_code: z.null(),
    response_hash: contentHashSchema,
    delivery_certainty: z.literal("DISPATCHED_OUTCOME_KNOWN"),
    transition_from: z.enum(["RESPONSE_OBSERVED", "OUTCOME_UNKNOWN"]),
    recovery_action: z.literal("NONE"),
    provider_call_count: z.literal(1),
    retry_after_ms: z.null(),
    reconciliation_of: immutableIdSchema.nullable(),
  })
  .superRefine((outcome, ctx) => {
    if ((outcome.transition_from === "OUTCOME_UNKNOWN") !== (outcome.reconciliation_of !== null)) {
      ctx.addIssue({
        code: "custom",
        message: "Completed reconciliation parent 必须与 transition 精确闭合。",
      });
    }
  });

export const commitProviderInvocationCompletedCommandSchema = z
  .strictObject({
    schema_version: z.literal("provider-invocation-commit-completed@1.0.0"),
    ...providerTransitionCommandBase,
    response_document: providerResponseArtifactDocumentSchema,
    outcome: providerInvocationCompletedOutcomeCandidateSchema,
    usage: providerInvocationUsageCandidateSchema,
  })
  .superRefine((command, ctx) => {
    addTransitionOutcomeClosureIssues(command, ctx);
    if (
      command.response_document.invocation_id !== command.invocation_id ||
      command.response_document.response_hash !== command.outcome.response_hash ||
      command.outcome.intent_id !== command.intent_id ||
      command.outcome.invocation_id !== command.invocation_id ||
      command.outcome.run_id !== command.run_id ||
      command.outcome.dispatch_hash !== command.dispatch_hash ||
      command.usage.provider_call_count !== 1 ||
      command.outcome.transition_from !== "RESPONSE_OBSERVED" ||
      command.outcome.reconciliation_of !== null
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Atomic completed command 必须精确闭合 response/outcome/usage identity。",
      });
    }
  });

export const commitProviderInvocationCompletedResultSchema = z
  .strictObject({
    schema_version: z.literal("provider-invocation-commit-completed-result@1.0.0"),
    disposition: z.enum(["CREATED", "REPLAYED"]),
    intent: providerInvocationIntentSchema,
    permit: committedProviderDispatchPermitSchema,
    response_artifact_ref: providerResponseArtifactReferenceSchema,
    outcome: providerInvocationOutcomeReceiptSchema,
    usage: providerInvocationUsageReceiptSchema,
    projection: providerInvocationPublicProjectionSchema,
  })
  .superRefine((result, ctx) => {
    addCommittedAttemptProjectionClosureIssues(result, ctx);
    addTerminalResultClosureIssues(result, ctx);
    if (
      result.outcome.candidate.status !== "COMPLETED" ||
      result.outcome.candidate.response_artifact_ref === null ||
      result.outcome.candidate.response_artifact_ref.content_hash !==
        result.response_artifact_ref.content_hash
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Atomic completed result 必须返回同一 protected Response Artifact。",
      });
    }
  });

export const commitProviderInvocationTerminalResultSchema = z
  .strictObject({
    schema_version: z.literal("provider-invocation-commit-terminal-result@1.0.0"),
    disposition: z.enum(["CREATED", "REPLAYED"]),
    intent: providerInvocationIntentSchema,
    permit: committedProviderDispatchPermitSchema,
    outcome: providerInvocationOutcomeReceiptSchema,
    usage: providerInvocationUsageReceiptSchema,
    projection: providerInvocationPublicProjectionSchema,
  })
  .superRefine((result, ctx) => {
    addCommittedAttemptProjectionClosureIssues(result, ctx);
    addTerminalResultClosureIssues(result, ctx);
  });

export const markProviderInvocationOutcomeUnknownCommandSchema = z
  .strictObject({
    schema_version: z.literal("provider-invocation-mark-unknown@1.0.0"),
    ...providerTransitionCommandBase,
    outcome: providerInvocationOutcomeCandidateSchema,
    usage: providerInvocationUsageCandidateSchema,
  })
  .superRefine((command, ctx) => {
    addTransitionOutcomeClosureIssues(command, ctx);
    if (
      command.outcome.status !== "OUTCOME_UNKNOWN" ||
      command.usage.availability !== "UNAVAILABLE" ||
      command.usage.unavailable_reason !== "PROVIDER_INVOCATION_OUTCOME_UNKNOWN"
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Unknown transition 必须使用唯一 unknown outcome/usage truth。",
      });
    }
  });

export const markProviderInvocationOutcomeUnknownResultSchema = z
  .strictObject({
    schema_version: z.literal("provider-invocation-mark-unknown-result@1.0.0"),
    disposition: z.enum(["CREATED", "REPLAYED"]),
    intent: providerInvocationIntentSchema,
    permit: committedProviderDispatchPermitSchema,
    outcome: providerInvocationOutcomeReceiptSchema,
    usage: providerInvocationUsageReceiptSchema,
    projection: providerInvocationPublicProjectionSchema,
  })
  .superRefine((result, ctx) => {
    addCommittedAttemptProjectionClosureIssues(result, ctx);
    addTerminalResultClosureIssues(result, ctx);
  });

export const beginProviderInvocationReconciliationCommandSchema = z.strictObject({
  schema_version: z.literal("provider-invocation-begin-reconciliation@1.0.0"),
  ...providerTransitionCommandBase,
  unknown_outcome_id: immutableIdSchema,
  reconciliation_id: immutableIdSchema,
});

export const beginProviderInvocationReconciliationResultSchema = z.strictObject({
  schema_version: z.literal("provider-invocation-begin-reconciliation-result@1.0.0"),
  disposition: z.enum(["CREATED", "REPLAYED"]),
  reconciliation_id: immutableIdSchema,
  unknown_outcome_id: immutableIdSchema,
});

const reconcileProviderInvocationUnknownCommandBase = {
  schema_version: z.literal("provider-invocation-reconcile-unknown@1.0.0"),
  ...providerTransitionCommandBase,
  actor: z.literal("RECONCILIATION_JOB"),
  reconciliation_id: immutableIdSchema,
  unknown_outcome_ref: z.strictObject({
    outcome_id: immutableIdSchema,
    outcome_hash: contentHashSchema,
  }),
  evidence_ref: artifactReferenceSchema,
  evidence_hash: contentHashSchema,
  recovery_capability_used: z.enum([
    "IDEMPOTENT_REQUEST",
    "INVOCATION_STATUS_QUERY",
    "INVOCATION_RECONCILIATION",
  ]),
} as const;

const reconciledCompletedOutcomeCandidateSchema =
  providerInvocationCompletedOutcomeCandidateSchema.refine(
    (outcome) =>
      outcome.transition_from === "OUTCOME_UNKNOWN" && outcome.reconciliation_of !== null,
    "Reconciled COMPLETED 必须消费 exact OUTCOME_UNKNOWN parent。",
  );

const reconciledFailureOutcomeCandidateSchema = providerInvocationOutcomeCandidateSchema.refine(
  (outcome) =>
    (outcome.status === "FAILED" || outcome.status === "THROTTLED") &&
    outcome.transition_from === "OUTCOME_UNKNOWN" &&
    outcome.reconciliation_of !== null &&
    outcome.response_artifact_ref === null &&
    outcome.response_hash === null,
  "Reconciled FAILED/THROTTLED 不得携带 response document/ref/hash。",
);

export const reconcileProviderInvocationUnknownCommandSchema = z
  .union([
    z.strictObject({
      ...reconcileProviderInvocationUnknownCommandBase,
      response_document: providerResponseArtifactDocumentSchema,
      outcome: reconciledCompletedOutcomeCandidateSchema,
      usage: providerInvocationUsageCandidateSchema,
    }),
    z.strictObject({
      ...reconcileProviderInvocationUnknownCommandBase,
      response_document: z.null(),
      outcome: reconciledFailureOutcomeCandidateSchema,
      usage: providerInvocationUsageCandidateSchema,
    }),
  ])
  .superRefine((command, ctx) => {
    addTransitionOutcomeClosureIssues(command, ctx);
    if (
      command.outcome.reconciliation_of !== command.unknown_outcome_ref.outcome_id ||
      command.evidence_ref.content_hash !== command.evidence_hash ||
      command.outcome.intent_id !== command.intent_id ||
      command.outcome.invocation_id !== command.invocation_id ||
      command.outcome.run_id !== command.run_id ||
      command.outcome.dispatch_hash !== command.dispatch_hash ||
      command.outcome.provider_call_count !== command.usage.provider_call_count ||
      !sameProviderInvocationScope(command.outcome.scope, command.scope) ||
      command.evidence_ref.app_id !== command.scope.app_id ||
      command.evidence_ref.tenant_id !== command.scope.tenant_id ||
      command.evidence_ref.environment !== command.scope.environment ||
      (command.outcome.status === "COMPLETED" &&
        (command.response_document === null ||
          command.response_document.invocation_id !== command.invocation_id ||
          command.response_document.response_hash !== command.outcome.response_hash))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Reconcile 必须由 job-only exact evidence 消费 unknown parent。",
      });
    }
  });

export const reconcileProviderInvocationUnknownResultSchema = z
  .strictObject({
    schema_version: z.literal("provider-invocation-reconcile-unknown-result@1.0.0"),
    disposition: z.enum(["CREATED", "REPLAYED"]),
    reconciliation_id: immutableIdSchema,
    intent: providerInvocationIntentSchema,
    permit: committedProviderDispatchPermitSchema,
    response_artifact_ref: providerResponseArtifactReferenceSchema.nullable(),
    outcome: providerInvocationOutcomeReceiptSchema,
    usage: providerInvocationUsageReceiptSchema,
    projection: providerInvocationPublicProjectionSchema,
  })
  .superRefine((result, ctx) => {
    addCommittedAttemptProjectionClosureIssues(result, ctx);
    addTerminalResultClosureIssues(result, ctx);
    const completed = result.outcome.candidate.status === "COMPLETED";
    if (
      completed !== (result.response_artifact_ref !== null) ||
      completed !== (result.outcome.candidate.response_artifact_ref !== null) ||
      (completed &&
        result.response_artifact_ref?.content_hash !==
          result.outcome.candidate.response_artifact_ref?.content_hash)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Reconcile result 必须按终态原子闭合 protected Response Artifact。",
      });
    }
  });

const staleProviderMarkerRecoveryCommandBase = {
  schema_version: z.literal("provider-invocation-recover-stale-marker@1.0.0"),
  actor: z.literal("STALE_MARKER_RECOVERY_JOB"),
  recovery_id: immutableIdSchema,
  intent: providerInvocationIntentSchema,
  permit: committedProviderDispatchPermitSchema,
  marker: providerInvocationDispatchMarkerSchema,
  recovery_capability_used: providerInvocationRecoveryCapabilitySchema,
} as const;

const staleProviderMarkerUnknownOutcomeSchema = providerInvocationOutcomeCandidateSchema.refine(
  (outcome) =>
    outcome.status === "OUTCOME_UNKNOWN" &&
    ["DISPATCH_MARKED", "RESPONSE_OBSERVED"].includes(outcome.transition_from) &&
    outcome.reconciliation_of === null,
  "Stale marker unknown recovery 必须从 exact durable non-terminal marker 转移。",
);

export const recoverStaleProviderInvocationMarkerCommandSchema = z
  .strictObject({
    ...staleProviderMarkerRecoveryCommandBase,
    recovery_resolution: z.literal("MARK_OUTCOME_UNKNOWN"),
    outcome: staleProviderMarkerUnknownOutcomeSchema,
    usage: providerInvocationUsageCandidateSchema,
  })
  .superRefine((command, ctx) => {
    const spec = command.intent.invocation_spec;
    const expectedRecoveryAction = decideStaleProviderMarkerRecoveryAction(
      command.recovery_capability_used,
    );
    if (
      command.permit.intent_id !== command.intent.intent_id ||
      command.permit.invocation_id !== spec.invocation_id ||
      command.permit.run_id !== spec.run_id ||
      !sameProviderInvocationScope(command.permit.scope, spec.scope) ||
      command.marker.intent_id !== command.intent.intent_id ||
      command.marker.invocation_id !== spec.invocation_id ||
      command.marker.run_id !== spec.run_id ||
      !sameProviderInvocationScope(command.marker.scope, spec.scope) ||
      command.marker.dispatch_hash !== command.permit.dispatch_hash ||
      !spec.certification.recovery_capabilities.includes(command.recovery_capability_used) ||
      command.outcome.intent_id !== command.intent.intent_id ||
      command.outcome.invocation_id !== spec.invocation_id ||
      command.outcome.run_id !== spec.run_id ||
      !sameProviderInvocationScope(command.outcome.scope, spec.scope) ||
      command.outcome.dispatch_hash !== command.permit.dispatch_hash ||
      command.outcome.provider_call_count !== command.usage.provider_call_count ||
      command.outcome.recovery_action !== expectedRecoveryAction
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Stale marker recovery 必须精确闭合 Intent/Permit/Marker/Capability/Outcome。",
      });
    }
    if (
      command.usage.availability !== "UNAVAILABLE" ||
      command.usage.unavailable_reason !== "PROVIDER_INVOCATION_OUTCOME_UNKNOWN"
    ) {
      ctx.addIssue({ code: "custom", message: "Unknown recovery 必须提交唯一 unknown usage。" });
    }
  });

const providerStaleMarkerRecoveryObservationSchema = z.strictObject({
  permit_id: immutableIdSchema,
  permit_hash: contentHashSchema,
  old_attempt_id: immutableIdSchema,
  old_worker_fence: positiveRevisionSchema,
  lease_status: z.literal("INACTIVE"),
  observed_at: canonicalU2TimestampSchema,
});

export async function computeProviderStaleMarkerInactiveObservationHash(input: unknown) {
  return sha256ContentHash(providerStaleMarkerRecoveryObservationSchema.parse(input));
}

const providerStaleMarkerRecoveryReceiptDocumentDraftSchema = z.strictObject({
  schema_version: z.literal("provider-stale-marker-recovery-receipt@1.0.0"),
  recovery_id: immutableIdSchema,
  actor: z.literal("STALE_MARKER_RECOVERY_JOB"),
  intent_id: immutableIdSchema,
  intent_hash: contentHashSchema,
  invocation_id: immutableIdSchema,
  scope: providerInvocationScopeSchema,
  run_id: immutableIdSchema,
  permit_id: immutableIdSchema,
  permit_hash: contentHashSchema,
  marker_id: immutableIdSchema,
  marker_hash: contentHashSchema,
  old_attempt_id: immutableIdSchema,
  old_worker_fence: positiveRevisionSchema,
  recovery_capability_used: providerInvocationRecoveryCapabilitySchema,
  recovery_action: z.enum([
    "SAFE_RETRY",
    "STATUS_QUERY_REQUIRED",
    "RECONCILIATION_REQUIRED",
    "MANUAL_REVIEW_REQUIRED",
  ]),
  lease_status: z.literal("INACTIVE"),
  inactive_observed_at: canonicalU2TimestampSchema,
  inactive_observation_hash: contentHashSchema,
  recovered_at: canonicalU2TimestampSchema,
});

export const providerStaleMarkerRecoveryReceiptDocumentSchema =
  providerStaleMarkerRecoveryReceiptDocumentDraftSchema.safeExtend({
    content_hash: contentHashSchema,
  });

export const providerStaleMarkerRecoveryReceiptReferenceSchema = artifactReferenceFor(
  "ProviderStaleMarkerRecoveryReceipt",
);

export async function computeProviderStaleMarkerRecoveryReceiptHash(input: unknown) {
  return sha256ContentHash(providerStaleMarkerRecoveryReceiptDocumentDraftSchema.parse(input));
}

export async function buildProviderStaleMarkerRecoveryReceiptDocument(input: unknown) {
  const receipt = providerStaleMarkerRecoveryReceiptDocumentDraftSchema.parse(input);
  const expectedAction = decideStaleProviderMarkerRecoveryAction(receipt.recovery_capability_used);
  if (
    receipt.recovery_action !== expectedAction ||
    receipt.recovered_at < receipt.inactive_observed_at ||
    receipt.inactive_observation_hash !==
      (await computeProviderStaleMarkerInactiveObservationHash({
        permit_id: receipt.permit_id,
        permit_hash: receipt.permit_hash,
        old_attempt_id: receipt.old_attempt_id,
        old_worker_fence: receipt.old_worker_fence,
        lease_status: receipt.lease_status,
        observed_at: receipt.inactive_observed_at,
      }))
  ) {
    throw new TypeError("PROVIDER_STALE_MARKER_RECOVERY_OBSERVATION_MISMATCH");
  }
  return providerStaleMarkerRecoveryReceiptDocumentSchema.parse({
    ...receipt,
    content_hash: await computeProviderStaleMarkerRecoveryReceiptHash(receipt),
  });
}

export async function verifyProviderStaleMarkerRecoveryReceiptDocument(input: unknown) {
  const receipt = providerStaleMarkerRecoveryReceiptDocumentSchema.parse(input);
  const { content_hash: _contentHash, ...draft } = receipt;
  const rebuilt = await buildProviderStaleMarkerRecoveryReceiptDocument(draft);
  if (rebuilt.content_hash !== receipt.content_hash) {
    throw new TypeError("PROVIDER_STALE_MARKER_RECOVERY_RECEIPT_HASH_MISMATCH");
  }
  return receipt;
}

export const recoverStaleProviderInvocationMarkerResultSchema = z
  .strictObject({
    schema_version: z.literal("provider-invocation-recover-stale-marker-result@1.0.0"),
    disposition: z.enum(["CREATED", "REPLAYED"]),
    recovery_receipt_ref: providerStaleMarkerRecoveryReceiptReferenceSchema,
    recovery_receipt: providerStaleMarkerRecoveryReceiptDocumentSchema,
    intent: providerInvocationIntentSchema,
    permit: committedProviderDispatchPermitSchema,
    marker: providerInvocationDispatchMarkerSchema,
    outcome: providerInvocationOutcomeReceiptSchema,
    usage: providerInvocationUsageReceiptSchema,
    projection: providerInvocationPublicProjectionSchema,
  })
  .superRefine((result, ctx) => {
    addCommittedAttemptProjectionClosureIssues(result, ctx);
    addTerminalResultClosureIssues(result, ctx);
    const spec = result.intent.invocation_spec;
    if (
      result.marker.intent_id !== result.intent.intent_id ||
      result.marker.invocation_id !== spec.invocation_id ||
      result.marker.run_id !== spec.run_id ||
      !sameProviderInvocationScope(result.marker.scope, spec.scope) ||
      result.marker.dispatch_hash !== result.permit.dispatch_hash ||
      result.recovery_receipt.intent_id !== result.intent.intent_id ||
      result.recovery_receipt.intent_hash !== result.intent.intent_hash ||
      result.recovery_receipt.invocation_id !== spec.invocation_id ||
      result.recovery_receipt.run_id !== spec.run_id ||
      !sameProviderInvocationScope(result.recovery_receipt.scope, spec.scope) ||
      result.recovery_receipt.permit_id !== result.permit.permit_id ||
      result.recovery_receipt.permit_hash !== result.permit.permit_hash ||
      result.recovery_receipt.marker_id !== result.marker.marker_id ||
      result.recovery_receipt.marker_hash !== result.marker.marker_hash ||
      result.recovery_receipt.old_attempt_id !== result.permit.attempt_id ||
      result.recovery_receipt.old_worker_fence !== result.permit.worker_fence ||
      result.recovery_receipt.recovery_capability_used !==
        result.intent.invocation_spec.certification.recovery_capabilities.find(
          (capability) => capability === result.recovery_receipt.recovery_capability_used,
        ) ||
      result.recovery_receipt.recovery_action !== result.outcome.candidate.recovery_action ||
      result.recovery_receipt.lease_status !== "INACTIVE" ||
      result.recovery_receipt_ref.artifact_id !== result.recovery_receipt.recovery_id ||
      result.recovery_receipt_ref.app_id !== spec.scope.app_id ||
      result.recovery_receipt_ref.tenant_id !== spec.scope.tenant_id ||
      result.recovery_receipt_ref.environment !== spec.scope.environment ||
      result.recovery_receipt_ref.run_id !== spec.run_id ||
      result.recovery_receipt_ref.revision !== 1 ||
      result.recovery_receipt_ref.content_hash !== result.recovery_receipt.content_hash ||
      result.outcome.candidate.status !== "OUTCOME_UNKNOWN" ||
      result.usage.availability !== "UNAVAILABLE" ||
      result.usage.unavailable_reason !== "PROVIDER_INVOCATION_OUTCOME_UNKNOWN"
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Stale marker recovery result 必须闭合全部 DB-owned authority 与终态。",
      });
    }
  });

export const loadProviderInvocationCommandSchema = z.strictObject({
  schema_version: z.literal("provider-invocation-load@1.0.0"),
  scope: providerInvocationScopeSchema,
  run_id: immutableIdSchema,
  invocation_id: immutableIdSchema,
  permit_id: immutableIdSchema,
  permit_hash: contentHashSchema,
  dispatch_hash: contentHashSchema,
  attempt_id: immutableIdSchema,
  worker_fence: positiveRevisionSchema,
});

export const nonFreshProviderInvocationLoadResultSchema = z
  .strictObject({
    schema_version: z.literal("provider-invocation-load-result@1.0.0"),
    intent: providerInvocationIntentSchema,
    permit: committedProviderDispatchPermitSchema,
    marker: providerInvocationDispatchMarkerSchema.nullable(),
    response_observed: providerInvocationResponseObservedMarkerSchema.nullable(),
    outcome: providerInvocationOutcomeReceiptSchema.nullable(),
    usage: providerInvocationUsageReceiptSchema.nullable(),
    projection: providerInvocationPublicProjectionSchema,
  })
  .superRefine((result, ctx) => {
    const spec = result.intent.invocation_spec;
    addCommittedAttemptProjectionClosureIssues(result, ctx);
    if (
      result.projection.invocation_id !== spec.invocation_id ||
      result.projection.run_id !== spec.run_id ||
      result.projection.provider !== spec.model_profile.provider ||
      result.projection.model_profile_id !== spec.model_profile.profile_id ||
      result.projection.model_config_version !== spec.model_profile.model_config_version ||
      result.projection.profile_version !== spec.model_profile.profile_version ||
      result.projection.model_id !== spec.model_profile.model_id ||
      artifactReferenceIdentity(result.projection.certification_receipt_ref) !==
        artifactReferenceIdentity(spec.certification.receipt_ref)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Load projection 必须与 stable Intent identity 精确闭合。",
      });
    }
    if (
      result.marker &&
      (result.marker.intent_id !== result.intent.intent_id ||
        result.marker.invocation_id !== spec.invocation_id ||
        result.marker.run_id !== spec.run_id ||
        !sameProviderInvocationScope(result.marker.scope, spec.scope) ||
        result.marker.dispatch_hash !== result.permit.dispatch_hash)
    ) {
      ctx.addIssue({ code: "custom", message: "Load marker 必须与 Intent/Permit 精确闭合。" });
    }
    if (
      result.response_observed &&
      (result.marker === null ||
        result.response_observed.intent_id !== result.intent.intent_id ||
        result.response_observed.invocation_id !== spec.invocation_id ||
        result.response_observed.run_id !== spec.run_id ||
        !sameProviderInvocationScope(result.response_observed.scope, spec.scope) ||
        result.response_observed.dispatch_hash !== result.permit.dispatch_hash ||
        result.response_observed.attempt_id !== result.permit.attempt_id ||
        result.response_observed.worker_fence !== result.permit.worker_fence)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Load RESPONSE_OBSERVED 必须闭合 Dispatch Marker/Intent/Permit。",
      });
    }
    if (
      result.marker === null &&
      result.response_observed === null &&
      result.outcome === null &&
      result.usage === null
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Fresh exact permit 必须返回 JSON null，不得伪造空 Load record。",
      });
    }
    if ((result.outcome === null) !== (result.usage === null)) {
      ctx.addIssue({ code: "custom", message: "Load outcome/usage 必须同时存在或同时为空。" });
    } else if (result.outcome && result.usage) {
      addTerminalResultClosureIssues(
        { outcome: result.outcome, usage: result.usage, projection: result.projection },
        ctx,
      );
      if (
        result.outcome.candidate.intent_id !== result.intent.intent_id ||
        result.outcome.candidate.invocation_id !== spec.invocation_id ||
        result.outcome.candidate.run_id !== spec.run_id ||
        !sameProviderInvocationScope(result.outcome.candidate.scope, spec.scope) ||
        result.outcome.candidate.dispatch_hash !== result.permit.dispatch_hash ||
        (result.outcome.candidate.provider_call_count === 1) !== (result.marker !== null) ||
        result.projection.status === "STARTED"
      ) {
        ctx.addIssue({ code: "custom", message: "Load terminal 必须与 Intent/Permit 精确闭合。" });
      }
    } else if (
      result.marker === null ||
      result.projection.status !== "STARTED" ||
      result.projection.provider_call_count !== 1
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Non-terminal Load 只能返回 exact durable marker STARTED projection。",
      });
    }
  });

export const loadProviderInvocationResultSchema = z.union([
  z.null(),
  nonFreshProviderInvocationLoadResultSchema,
]);

async function verifyCommittedAttemptAuthority(
  intentInput: unknown,
  permitInput: unknown,
): Promise<{
  intent: z.infer<typeof providerInvocationIntentSchema>;
  permit: z.infer<typeof committedProviderDispatchPermitSchema>;
}> {
  const [intent, permit] = await Promise.all([
    verifyProviderInvocationIntentReceipt(intentInput),
    verifyCommittedProviderDispatchPermitReceipt(permitInput),
  ]);
  if (
    permit.intent_id !== intent.intent_id ||
    permit.invocation_id !== intent.invocation_spec.invocation_id ||
    permit.run_id !== intent.invocation_spec.run_id ||
    !sameProviderInvocationScope(permit.scope, intent.invocation_spec.scope)
  ) {
    throw new TypeError("PROVIDER_INVOCATION_INTENT_PERMIT_IDENTITY_MISMATCH");
  }
  return { intent, permit };
}

function assertTransitionCommandAuthority(
  command: {
    intent_id: string;
    invocation_id: string;
    scope: z.infer<typeof providerInvocationScopeSchema>;
    run_id: string;
    dispatch_hash: string;
    attempt_id: string;
    worker_fence: number;
  },
  intent: z.infer<typeof providerInvocationIntentSchema>,
  permit: z.infer<typeof committedProviderDispatchPermitSchema>,
): void {
  if (
    command.intent_id !== intent.intent_id ||
    command.invocation_id !== permit.invocation_id ||
    command.run_id !== permit.run_id ||
    !sameProviderInvocationScope(command.scope, permit.scope) ||
    command.dispatch_hash !== permit.dispatch_hash ||
    command.attempt_id !== permit.attempt_id ||
    command.worker_fence !== permit.worker_fence
  ) {
    throw new TypeError("PROVIDER_INVOCATION_COMMAND_RESULT_IDENTITY_MISMATCH");
  }
}

export async function verifyBeginProviderInvocationResult(
  commandInput: unknown,
  resultInput: unknown,
) {
  const command = beginProviderInvocationCommandSchema.parse(commandInput);
  const envelope = await verifyProviderDispatchEnvelopeCandidate(command.envelope);
  const result = beginProviderInvocationResultSchema.parse(resultInput);
  const intent = await verifyProviderInvocationIntentReceipt(result.intent);
  if (
    canonicalizeJson(intent.invocation_spec) !==
      canonicalizeJson(projectProviderInvocationStableSpec(envelope)) ||
    intent.invocation_key_hash !== envelope.invocation_key_hash
  ) {
    throw new TypeError("PROVIDER_INVOCATION_BEGIN_INTENT_MISMATCH");
  }
  if (result.admission === "READY") {
    const { permit } = await verifyCommittedAttemptAuthority(intent, result.permit);
    if (
      permit.dispatch_hash !== envelope.dispatch_hash ||
      canonicalizeJson(permit.context_receipt_ref) !==
        canonicalizeJson(envelope.context_receipt_ref) ||
      canonicalizeJson(permit.lease) !== canonicalizeJson(envelope.lease)
    ) {
      throw new TypeError("PROVIDER_INVOCATION_BEGIN_PERMIT_MISMATCH");
    }
  } else if (result.admission === "REJECTED") {
    await Promise.all([
      verifyProviderInvocationOutcomeReceipt(result.outcome),
      verifyProviderInvocationUsageReceipt(result.usage),
    ]);
    if (
      result.outcome.candidate.dispatch_hash !== envelope.dispatch_hash ||
      !providerInvocationProjectionMatchesAuthority(result.projection, intent.invocation_spec, {
        attempt_id: envelope.lease.attempt_id,
        attempt_no: envelope.lease.attempt_no,
        dispatch_hash: envelope.dispatch_hash,
      })
    ) {
      throw new TypeError("PROVIDER_INVOCATION_BEGIN_REJECTION_IDENTITY_MISMATCH");
    }
  } else {
    const { permit } = await verifyCommittedAttemptAuthority(intent, result.original_permit);
    await Promise.all([
      verifyProviderInvocationOutcomeReceipt(result.outcome),
      verifyProviderInvocationUsageReceipt(result.usage),
    ]);
    if (
      result.outcome.candidate.dispatch_hash !== permit.dispatch_hash ||
      !providerInvocationProjectionMatchesAuthority(result.projection, intent.invocation_spec, {
        attempt_id: permit.attempt_id,
        attempt_no: permit.lease.attempt_no,
        dispatch_hash: permit.dispatch_hash,
      })
    ) {
      throw new TypeError("PROVIDER_INVOCATION_BEGIN_TERMINAL_REPLAY_IDENTITY_MISMATCH");
    }
  }
  return result;
}

export async function verifyMarkProviderInvocationStartedResult(
  commandInput: unknown,
  resultInput: unknown,
) {
  const command = markProviderInvocationStartedCommandSchema.parse(commandInput);
  const result = markProviderInvocationStartedResultSchema.parse(resultInput);
  const { intent, permit } = await verifyCommittedAttemptAuthority(result.intent, result.permit);
  assertTransitionCommandAuthority(command, intent, permit);
  await verifyProviderInvocationDispatchMarkerReceipt(result.marker);
  return result;
}

export async function verifyMarkProviderInvocationResponseObservedResult(
  commandInput: unknown,
  resultInput: unknown,
) {
  const command = markProviderInvocationResponseObservedCommandSchema.parse(commandInput);
  const result = markProviderInvocationResponseObservedResultSchema.parse(resultInput);
  const { intent, permit } = await verifyCommittedAttemptAuthority(result.intent, result.permit);
  assertTransitionCommandAuthority(command, intent, permit);
  await verifyProviderInvocationResponseObservedMarkerReceipt(result.marker);
  if (
    result.marker.observation_kind !== command.observation_kind ||
    result.marker.response_hash !== command.response_hash ||
    result.marker.delivery_certainty !== command.delivery_certainty ||
    result.marker.attempt_id !== command.attempt_id ||
    result.marker.worker_fence !== command.worker_fence
  ) {
    throw new TypeError("PROVIDER_INVOCATION_RESPONSE_OBSERVED_COMMAND_RESULT_MISMATCH");
  }
  return result;
}

async function verifyTerminalResultAuthority(
  command: {
    intent_id: string;
    invocation_id: string;
    scope: z.infer<typeof providerInvocationScopeSchema>;
    run_id: string;
    dispatch_hash: string;
    attempt_id: string;
    worker_fence: number;
  },
  result: {
    intent: z.infer<typeof providerInvocationIntentSchema>;
    permit: z.infer<typeof committedProviderDispatchPermitSchema>;
    outcome: z.infer<typeof providerInvocationOutcomeReceiptSchema>;
    usage: z.infer<typeof providerInvocationUsageReceiptSchema>;
  },
): Promise<void> {
  const { intent, permit } = await verifyCommittedAttemptAuthority(result.intent, result.permit);
  assertTransitionCommandAuthority(command, intent, permit);
  await Promise.all([
    verifyProviderInvocationOutcomeReceipt(result.outcome),
    verifyProviderInvocationUsageReceipt(result.usage),
  ]);
}

export async function verifyCommitProviderInvocationTerminalResult(
  commandInput: unknown,
  resultInput: unknown,
) {
  const command = commitProviderInvocationTerminalCommandSchema.parse(commandInput);
  const result = commitProviderInvocationTerminalResultSchema.parse(resultInput);
  await verifyTerminalResultAuthority(command, result);
  return result;
}

export async function verifyCommitProviderInvocationCompletedResult(
  commandInput: unknown,
  resultInput: unknown,
) {
  const command = commitProviderInvocationCompletedCommandSchema.parse(commandInput);
  const result = commitProviderInvocationCompletedResultSchema.parse(resultInput);
  await verifyTerminalResultAuthority(command, result);
  if (
    result.response_artifact_ref.content_hash !== command.response_document.content_hash ||
    result.outcome.candidate.response_hash !== command.response_document.response_hash
  ) {
    throw new TypeError("PROVIDER_INVOCATION_COMPLETED_RESPONSE_MISMATCH");
  }
  return result;
}

export async function verifyMarkProviderInvocationOutcomeUnknownResult(
  commandInput: unknown,
  resultInput: unknown,
) {
  const command = markProviderInvocationOutcomeUnknownCommandSchema.parse(commandInput);
  const result = markProviderInvocationOutcomeUnknownResultSchema.parse(resultInput);
  await verifyTerminalResultAuthority(command, result);
  return result;
}

export async function verifyReconcileProviderInvocationUnknownResult(
  commandInput: unknown,
  resultInput: unknown,
) {
  const command = reconcileProviderInvocationUnknownCommandSchema.parse(commandInput);
  const result = reconcileProviderInvocationUnknownResultSchema.parse(resultInput);
  await verifyTerminalResultAuthority(command, result);
  if (
    result.reconciliation_id !== command.reconciliation_id ||
    result.outcome.candidate.reconciliation_of !== command.unknown_outcome_ref.outcome_id ||
    (command.outcome.status === "COMPLETED" &&
      (result.response_artifact_ref === null ||
        command.response_document === null ||
        result.response_artifact_ref.content_hash !== command.response_document.content_hash ||
        result.outcome.candidate.response_hash !== command.response_document.response_hash)) ||
    (command.outcome.status !== "COMPLETED" && result.response_artifact_ref !== null)
  ) {
    throw new TypeError("PROVIDER_INVOCATION_RECONCILIATION_RESULT_MISMATCH");
  }
  return result;
}

function projectProviderInvocationUsageCandidate(
  usage: z.infer<typeof providerInvocationUsageReceiptSchema>,
) {
  return providerInvocationUsageCandidateSchema.parse({
    schema_version: "provider-invocation-usage-candidate@1.0.0",
    availability: usage.availability,
    source: usage.source,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens,
    tool_calls: usage.tool_calls,
    provider_call_count: usage.provider_call_count,
    capacity_status: usage.capacity_status,
    unavailable_reason: usage.unavailable_reason,
  });
}

export async function verifyRecoverStaleProviderInvocationMarkerResult(
  commandInput: unknown,
  resultInput: unknown,
) {
  const command = recoverStaleProviderInvocationMarkerCommandSchema.parse(commandInput);
  const result = recoverStaleProviderInvocationMarkerResultSchema.parse(resultInput);
  await Promise.all([
    verifyProviderInvocationIntentReceipt(command.intent),
    verifyCommittedProviderDispatchPermitReceipt(command.permit),
    verifyProviderInvocationDispatchMarkerReceipt(command.marker),
    verifyProviderInvocationIntentReceipt(result.intent),
    verifyCommittedProviderDispatchPermitReceipt(result.permit),
    verifyProviderInvocationDispatchMarkerReceipt(result.marker),
    verifyProviderStaleMarkerRecoveryReceiptDocument(result.recovery_receipt),
    verifyProviderInvocationOutcomeReceipt(result.outcome),
    verifyProviderInvocationUsageReceipt(result.usage),
  ]);
  if (
    result.intent.intent_hash !== command.intent.intent_hash ||
    result.permit.permit_hash !== command.permit.permit_hash ||
    result.marker.marker_hash !== command.marker.marker_hash ||
    result.recovery_receipt.recovery_id !== command.recovery_id ||
    result.recovery_receipt.recovery_capability_used !== command.recovery_capability_used ||
    canonicalizeJson(result.outcome.candidate) !== canonicalizeJson(command.outcome) ||
    canonicalizeJson(projectProviderInvocationUsageCandidate(result.usage)) !==
      canonicalizeJson(command.usage) ||
    result.recovery_receipt.inactive_observed_at < result.marker.dispatch_marked_at
  ) {
    throw new TypeError("PROVIDER_INVOCATION_STALE_MARKER_RESULT_MISMATCH");
  }
  return result;
}

export async function verifyLoadProviderInvocationResult(
  commandInput: unknown,
  resultInput: unknown,
) {
  const command = loadProviderInvocationCommandSchema.parse(commandInput);
  const result = loadProviderInvocationResultSchema.parse(resultInput);
  if (result === null) return null;
  const intent = await verifyProviderInvocationIntentReceipt(result.intent);
  if (
    intent.invocation_spec.invocation_id !== command.invocation_id ||
    intent.invocation_spec.run_id !== command.run_id ||
    !sameProviderInvocationScope(intent.invocation_spec.scope, command.scope) ||
    result.permit.permit_id !== command.permit_id ||
    result.permit.permit_hash !== command.permit_hash ||
    result.permit.dispatch_hash !== command.dispatch_hash ||
    result.permit.attempt_id !== command.attempt_id ||
    result.permit.worker_fence !== command.worker_fence
  ) {
    throw new TypeError("PROVIDER_INVOCATION_LOAD_PERMIT_MISMATCH");
  }
  await verifyCommittedAttemptAuthority(intent, result.permit);
  await Promise.all([
    result.marker === null
      ? Promise.resolve()
      : verifyProviderInvocationDispatchMarkerReceipt(result.marker),
    result.response_observed === null
      ? Promise.resolve()
      : verifyProviderInvocationResponseObservedMarkerReceipt(result.response_observed),
    result.outcome === null
      ? Promise.resolve()
      : verifyProviderInvocationOutcomeReceipt(result.outcome),
    result.usage === null ? Promise.resolve() : verifyProviderInvocationUsageReceipt(result.usage),
  ]);
  return result;
}

export const commitProviderResponseArtifactCommandSchema = z
  .strictObject({
    schema_version: z.literal("provider-response-artifact-commit@1.0.0"),
    scope: providerInvocationScopeSchema,
    run_id: immutableIdSchema,
    invocation_id: immutableIdSchema,
    intent_id: immutableIdSchema,
    dispatch_hash: contentHashSchema,
    attempt_id: immutableIdSchema,
    worker_fence: positiveRevisionSchema,
    document: providerResponseArtifactDocumentSchema,
  })
  .superRefine((command, ctx) => {
    if (command.document.invocation_id !== command.invocation_id) {
      ctx.addIssue({
        code: "custom",
        message: "Provider Response document 必须绑定 exact invocation_id。",
        path: ["document", "invocation_id"],
      });
    }
  });

export const commitProviderResponseArtifactResultSchema = z.strictObject({
  schema_version: z.literal("provider-response-artifact-commit-result@1.0.0"),
  disposition: z.enum(["CREATED", "REPLAYED"]),
  reference: providerResponseArtifactReferenceSchema,
  document_hash: contentHashSchema,
  committed_at: canonicalU2TimestampSchema,
});

export const loadProviderResponseArtifactCommandSchema = z.strictObject({
  schema_version: z.literal("provider-response-artifact-load@1.0.0"),
  scope: providerInvocationScopeSchema,
  run_id: immutableIdSchema,
  invocation_id: immutableIdSchema,
  reference: providerResponseArtifactReferenceSchema,
});

export const loadProviderResponseArtifactResultSchema = z
  .strictObject({
    schema_version: z.literal("provider-response-artifact-load-result@1.0.0"),
    invocation_id: immutableIdSchema,
    reference: providerResponseArtifactReferenceSchema,
    document: providerResponseArtifactDocumentSchema,
  })
  .superRefine((result, ctx) => {
    if (
      result.document.invocation_id !== result.invocation_id ||
      result.document.content_hash !== result.reference.content_hash
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Loaded Provider Response 必须与 exact reference 闭合。",
      });
    }
  });

export type ProviderDispatchEnvelope = z.infer<typeof providerDispatchEnvelopeSchema>;
export type ProviderInvocationIntent = z.infer<typeof providerInvocationIntentSchema>;
export type ProviderInvocationUsageReceiptCandidate = z.infer<
  typeof providerInvocationUsageReceiptCandidateSchema
>;
export type ProviderInvocationUsageReceipt = z.infer<typeof providerInvocationUsageReceiptSchema>;
export type ProviderInvocationOutcomeCandidate = z.infer<
  typeof providerInvocationOutcomeCandidateSchema
>;
export type ProviderInvocationOutcomeReceipt = z.infer<
  typeof providerInvocationOutcomeReceiptSchema
>;
export type ProviderInvocationPublicProjection = z.infer<
  typeof providerInvocationPublicProjectionSchema
>;
