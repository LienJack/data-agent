import { z } from "zod";
import {
  type ArtifactReferenceVerifier,
  artifactReferenceFor,
  artifactReferenceIdentity,
} from "../artifacts/envelope.js";
import {
  appScopeSchema,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
  versionIdentifierSchema,
} from "../common/index.js";

export const MODEL_PROVIDERS = [
  "openai",
  "anthropic",
  "deepseek",
  "glm",
  "kimi",
  "grok",
  "gemini",
] as const;

export const modelProviderSchema = z.enum(MODEL_PROVIDERS);

export const modelProfileRecoveryCapabilitiesSchema = z
  .array(
    z.enum([
      "IDEMPOTENT_REQUEST",
      "INVOCATION_STATUS_QUERY",
      "INVOCATION_RECONCILIATION",
      "AT_LEAST_ONCE_ONLY",
    ]),
  )
  .min(1)
  .max(3)
  .superRefine((capabilities, ctx) => {
    const order = [
      "IDEMPOTENT_REQUEST",
      "INVOCATION_STATUS_QUERY",
      "INVOCATION_RECONCILIATION",
      "AT_LEAST_ONCE_ONLY",
    ];
    capabilities.forEach((capability, index) => {
      const previous = capabilities[index - 1];
      if (previous && order.indexOf(previous) >= order.indexOf(capability)) {
        ctx.addIssue({
          code: "custom",
          message: "Recovery capability 必须唯一且规范排序。",
          path: [index],
        });
      }
    });
    if (capabilities.includes("AT_LEAST_ONCE_ONLY") && capabilities.length !== 1) {
      ctx.addIssue({ code: "custom", message: "AT_LEAST_ONCE_ONLY 必须独占。" });
    }
  });

export const modelProfileConnectionProofSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("SYSTEM_DEPLOYMENT"),
    deployment_id: immutableIdSchema,
    deployment_revision: z.number().int().positive().safe(),
    deployment_hash: contentHashSchema,
  }),
  z.strictObject({
    kind: z.literal("MANAGED_CONNECTION"),
    provider_connection_id: immutableIdSchema,
    config_version: z.number().int().positive().safe(),
    connection_hash: contentHashSchema,
  }),
]);

export const modelCapabilitiesSchema = z.strictObject({
  structured_output: z.boolean(),
  tool_calling: z.boolean(),
  streaming: z.boolean(),
  reasoning: z.boolean(),
  vision: z.boolean(),
});

const unverifiedOperationalConstraintSchema = z.strictObject({
  verification_status: z.literal("UNVERIFIED"),
});

export const modelContextWindowConstraintSchema = z.discriminatedUnion("verification_status", [
  unverifiedOperationalConstraintSchema,
  z
    .strictObject({
      verification_status: z.literal("VERIFIED"),
      max_context_tokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      max_output_tokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    })
    .superRefine((constraint, ctx) => {
      if (constraint.max_output_tokens > constraint.max_context_tokens) {
        ctx.addIssue({
          code: "custom",
          message: "最大输出 Token 不能超过总 Context Window。",
          path: ["max_output_tokens"],
        });
      }
    }),
]);

export const modelRegionPrivacyConstraintSchema = z.discriminatedUnion("verification_status", [
  unverifiedOperationalConstraintSchema,
  z.strictObject({
    verification_status: z.literal("VERIFIED"),
    processing_regions: z.array(versionIdentifierSchema).min(1).max(64),
    privacy_tags: z.array(versionIdentifierSchema).max(64),
  }),
]);

export const modelFallbackCompatibilityConstraintSchema = z.discriminatedUnion(
  "verification_status",
  [
    unverifiedOperationalConstraintSchema,
    z.strictObject({
      verification_status: z.literal("VERIFIED"),
      tags: z.array(versionIdentifierSchema).min(1).max(64),
    }),
  ],
);

export const modelOperationalConstraintsSchema = z.strictObject({
  context_window: modelContextWindowConstraintSchema,
  region_privacy: modelRegionPrivacyConstraintSchema,
  fallback_compatibility: modelFallbackCompatibilityConstraintSchema,
});

export const UNVERIFIED_MODEL_OPERATIONAL_CONSTRAINTS = deepFreeze(
  modelOperationalConstraintsSchema.parse({
    context_window: { verification_status: "UNVERIFIED" },
    region_privacy: { verification_status: "UNVERIFIED" },
    fallback_compatibility: { verification_status: "UNVERIFIED" },
  }),
);

export const modelCertificationReceiptReferenceSchema = artifactReferenceFor(
  "ModelCertificationReceipt",
);

export const modelProfileSchema = z
  .strictObject({
    profile_id: immutableIdSchema,
    scope: appScopeSchema,
    provider: modelProviderSchema,
    model_id: z.string().min(1).max(256),
    profile_version: versionIdentifierSchema,
    capabilities: modelCapabilitiesSchema,
    operational_constraints: modelOperationalConstraintsSchema.default(
      UNVERIFIED_MODEL_OPERATIONAL_CONSTRAINTS,
    ),
    certification_status: z.enum(["UNVERIFIED", "CONFIGURED", "AVAILABLE", "UNAVAILABLE"]),
    certification_receipt_ref: modelCertificationReceiptReferenceSchema.optional(),
    certified_model_id: z.string().min(1).max(256).optional(),
  })
  .superRefine((profile, ctx) => {
    if (
      profile.certification_status === "AVAILABLE" &&
      (!profile.certification_receipt_ref || !profile.certified_model_id)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "AVAILABLE Provider 必须绑定真实 Certification Receipt 与 Model ID。",
        path: ["certification_status"],
      });
    }

    if (
      profile.certification_status === "AVAILABLE" &&
      profile.certified_model_id !== profile.model_id
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Certification Receipt 必须认证当前 Model ID。",
        path: ["certified_model_id"],
      });
    }

    const receipt = profile.certification_receipt_ref;
    if (
      receipt &&
      (receipt.app_id !== profile.scope.app_id ||
        receipt.tenant_id !== profile.scope.tenant_id ||
        receipt.environment !== profile.scope.environment)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Model Certification Receipt 必须与 Profile 属于同一 App/Tenant/Environment。",
        path: ["certification_receipt_ref"],
      });
    }
  });

export const modelExecutionProfileSchema = modelProfileSchema
  .safeExtend({
    model_config_version: z.number().int().positive().safe(),
    adapter_version: versionIdentifierSchema,
    recovery_capabilities: modelProfileRecoveryCapabilitiesSchema,
    connection: modelProfileConnectionProofSchema,
  })
  .superRefine((profile, ctx) => {
    if (profile.profile_version !== `model-profile@${profile.model_config_version}`) {
      ctx.addIssue({
        code: "custom",
        message: "Execution Profile Version 必须精确绑定 config_version。",
        path: ["profile_version"],
      });
    }
    if (profile.operational_constraints.context_window.verification_status !== "VERIFIED") {
      ctx.addIssue({
        code: "custom",
        message: "Execution Profile 必须具备 VERIFIED context window。",
        path: ["operational_constraints", "context_window"],
      });
    }
  });

export const modelExecutionProfileSnapshotSchema = z.strictObject({
  profile_id: immutableIdSchema,
  scope: appScopeSchema,
  provider: modelProviderSchema,
  model_id: z.string().min(1).max(256),
  model_config_version: z.number().int().positive().safe(),
  profile_version: versionIdentifierSchema,
  adapter_version: versionIdentifierSchema,
  recovery_capabilities: modelProfileRecoveryCapabilitiesSchema,
  connection: modelProfileConnectionProofSchema,
  capabilities: modelCapabilitiesSchema,
  context_window: modelContextWindowConstraintSchema.refine(
    (
      context,
    ): context is Extract<
      z.infer<typeof modelContextWindowConstraintSchema>,
      { verification_status: "VERIFIED" }
    > => context.verification_status === "VERIFIED",
    "Execution Profile context window 必须 VERIFIED。",
  ),
  region_privacy: modelRegionPrivacyConstraintSchema,
  fallback_compatibility: modelFallbackCompatibilityConstraintSchema,
});

export function projectModelExecutionProfileSnapshot(input: unknown) {
  const profile = modelExecutionProfileSchema.parse(input);
  return modelExecutionProfileSnapshotSchema.parse({
    profile_id: profile.profile_id,
    scope: profile.scope,
    provider: profile.provider,
    model_id: profile.model_id,
    model_config_version: profile.model_config_version,
    profile_version: profile.profile_version,
    adapter_version: profile.adapter_version,
    recovery_capabilities: profile.recovery_capabilities,
    connection: profile.connection,
    capabilities: profile.capabilities,
    context_window: profile.operational_constraints.context_window,
    region_privacy: profile.operational_constraints.region_privacy,
    fallback_compatibility: profile.operational_constraints.fallback_compatibility,
  });
}

export async function computeModelExecutionProfileHash(
  input: unknown,
): Promise<`sha256:${string}`> {
  const profile = modelExecutionProfileSchema.parse(input);
  return sha256ContentHash(projectModelExecutionProfileSnapshot(profile));
}

export const modelExecutionCertificationBasisSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("CREDENTIAL_SMOKE"),
    probe_hash: contentHashSchema,
  }),
  z.strictObject({
    kind: z.literal("GOAL_PREFLIGHT_ATTESTATION"),
    goal_execution_id: immutableIdSchema,
    plan_commit: z.string().regex(/^[0-9a-f]{7,64}$/),
    plan_hash: contentHashSchema,
    manifest_hash: contentHashSchema,
    checkpoint_hash: contentHashSchema,
    preflight_evidence_hash: contentHashSchema,
    observed_provider: modelProviderSchema,
    observed_model_id: z.string().min(1).max(256),
    checks: z.strictObject({
      request_shape: z.literal(true),
      structured_output: z.literal(true),
      tool_calling: z.literal(true),
      streaming: z.literal(true),
      error_normalization: z.literal(true),
    }),
  }),
]);

const modelExecutionCertificationReferenceDraftSchema =
  modelCertificationReceiptReferenceSchema.omit({ content_hash: true });

const modelExecutionCertificationClaimsDraftSchema = z.strictObject({
  schema_version: z.literal("model-execution-certification@1.0.0"),
  receipt_ref: modelExecutionCertificationReferenceDraftSchema,
  profile_id: immutableIdSchema,
  model_config_version: z.number().int().positive().safe(),
  provider: modelProviderSchema,
  model_id: z.string().min(1).max(256),
  profile_version: versionIdentifierSchema,
  adapter_version: versionIdentifierSchema,
  execution_profile_hash: contentHashSchema,
  execution_profile_snapshot: modelExecutionProfileSnapshotSchema,
  recovery_capabilities: modelProfileRecoveryCapabilitiesSchema,
  connection: modelProfileConnectionProofSchema,
  certification_basis: modelExecutionCertificationBasisSchema,
  verdict: z.literal("PASS"),
});

export const modelExecutionCertificationClaimsSchema =
  modelExecutionCertificationClaimsDraftSchema.safeExtend({
    receipt_ref: modelCertificationReceiptReferenceSchema,
  });

export const currentProviderExecutionCertificationRequestSchema = z.strictObject({
  schema_version: z.literal("current-provider-execution-certification-resolve@1.0.0"),
  model_profile_id: immutableIdSchema,
  model_config_version: z.number().int().positive().safe(),
  certification_receipt_ref: modelCertificationReceiptReferenceSchema,
});

export const currentProviderExecutionCertificationV2RequestSchema =
  currentProviderExecutionCertificationRequestSchema.extend({
    schema_version: z.literal("current-provider-execution-certification-resolve@2.0.0"),
  });

function addCurrentProviderCertificationClosureIssues(
  result: Readonly<{ claims: z.infer<typeof modelExecutionCertificationClaimsSchema> }>,
  context: z.RefinementCtx,
) {
  const claims = result.claims;
  if (
    claims.profile_id !== claims.execution_profile_snapshot.profile_id ||
    claims.model_config_version !== claims.execution_profile_snapshot.model_config_version ||
    claims.provider !== claims.execution_profile_snapshot.provider ||
    claims.model_id !== claims.execution_profile_snapshot.model_id ||
    claims.profile_version !== claims.execution_profile_snapshot.profile_version ||
    claims.adapter_version !== claims.execution_profile_snapshot.adapter_version ||
    JSON.stringify(claims.recovery_capabilities) !==
      JSON.stringify(claims.execution_profile_snapshot.recovery_capabilities) ||
    JSON.stringify(claims.connection) !==
      JSON.stringify(claims.execution_profile_snapshot.connection)
  ) {
    context.addIssue({
      code: "custom",
      message: "Current Provider Certification claims identity 不闭合。",
      path: ["claims"],
    });
  }
}

export const currentProviderExecutionCertificationResultSchema = z
  .strictObject({
    schema_version: z.literal("current-provider-execution-certification@1.0.0"),
    claims: modelExecutionCertificationClaimsSchema,
  })
  .superRefine(addCurrentProviderCertificationClosureIssues);

export const currentProviderExecutionCertificationV2ResultSchema = z
  .strictObject({
    schema_version: z.literal("current-provider-execution-certification@2.0.0"),
    claims: modelExecutionCertificationClaimsSchema,
  })
  .superRefine(addCurrentProviderCertificationClosureIssues);

function projectModelExecutionCertificationClaimsDraft(input: unknown) {
  const claims = modelExecutionCertificationClaimsSchema.safeParse(input);
  if (claims.success) {
    const { content_hash: _contentHash, ...receiptRef } = claims.data.receipt_ref;
    return modelExecutionCertificationClaimsDraftSchema.parse({
      ...claims.data,
      receipt_ref: receiptRef,
    });
  }
  return modelExecutionCertificationClaimsDraftSchema.parse(input);
}

export async function computeModelExecutionCertificationContentHash(
  input: unknown,
): Promise<`sha256:${string}`> {
  return sha256ContentHash(projectModelExecutionCertificationClaimsDraft(input));
}

export async function buildModelExecutionCertificationClaims(input: unknown) {
  const claims = projectModelExecutionCertificationClaimsDraft(input);
  return modelExecutionCertificationClaimsSchema.parse({
    ...claims,
    receipt_ref: {
      ...claims.receipt_ref,
      content_hash: await computeModelExecutionCertificationContentHash(claims),
    },
  });
}

export async function verifyModelExecutionCertificationClaims(input: unknown) {
  const claims = modelExecutionCertificationClaimsSchema.parse(input);
  if (
    (await computeModelExecutionCertificationContentHash(claims)) !==
      claims.receipt_ref.content_hash ||
    (await sha256ContentHash(claims.execution_profile_snapshot)) !==
      claims.execution_profile_hash ||
    claims.execution_profile_snapshot.profile_id !== claims.profile_id ||
    claims.execution_profile_snapshot.model_config_version !== claims.model_config_version ||
    claims.execution_profile_snapshot.provider !== claims.provider ||
    claims.execution_profile_snapshot.model_id !== claims.model_id ||
    claims.execution_profile_snapshot.profile_version !== claims.profile_version ||
    claims.execution_profile_snapshot.adapter_version !== claims.adapter_version ||
    JSON.stringify(claims.execution_profile_snapshot.recovery_capabilities) !==
      JSON.stringify(claims.recovery_capabilities) ||
    JSON.stringify(claims.execution_profile_snapshot.connection) !==
      JSON.stringify(claims.connection)
  ) {
    throw new ModelCertificationError("Execution Certification snapshot/hash 不一致。");
  }
  if (
    claims.certification_basis.kind === "GOAL_PREFLIGHT_ATTESTATION" &&
    (claims.certification_basis.observed_provider !== claims.provider ||
      claims.certification_basis.observed_model_id !== claims.model_id)
  ) {
    throw new ModelCertificationError("Goal preflight observation 与认证模型不一致。");
  }
  return claims;
}

declare const availableExecutionModelProfile: unique symbol;
const availableExecutionModelProfiles = new WeakSet<object>();

export type AvailableExecutionModelProfile = z.infer<typeof modelExecutionProfileSchema> & {
  readonly certification_status: "AVAILABLE";
  readonly [availableExecutionModelProfile]: true;
};

export async function authorizeAvailableExecutionModelProfile(
  input: unknown,
  authority: ModelCertificationAuthorityContext,
): Promise<AvailableExecutionModelProfile> {
  const profile = modelExecutionProfileSchema.parse(input);
  if (profile.certification_status !== "AVAILABLE" || !profile.certification_receipt_ref) {
    throw new ModelCertificationError("Execution Model Profile 尚未声明为 AVAILABLE。");
  }
  const resolved = await verifyModelExecutionCertificationClaims(
    await authority.resolve(profile.certification_receipt_ref),
  );
  if (!(await authority.verifyCommitted(profile.certification_receipt_ref))) {
    throw new ModelCertificationError("Execution Certification Receipt 尚未提交。");
  }
  const executionProfileHash = await computeModelExecutionProfileHash(profile);
  if (
    artifactReferenceIdentity(resolved.receipt_ref) !==
      artifactReferenceIdentity(profile.certification_receipt_ref) ||
    resolved.profile_id !== profile.profile_id ||
    resolved.model_config_version !== profile.model_config_version ||
    resolved.provider !== profile.provider ||
    resolved.model_id !== profile.model_id ||
    resolved.profile_version !== profile.profile_version ||
    resolved.adapter_version !== profile.adapter_version ||
    resolved.execution_profile_hash !== executionProfileHash ||
    JSON.stringify(resolved.execution_profile_snapshot) !==
      JSON.stringify(projectModelExecutionProfileSnapshot(profile)) ||
    JSON.stringify(resolved.recovery_capabilities) !==
      JSON.stringify(profile.recovery_capabilities) ||
    JSON.stringify(resolved.connection) !== JSON.stringify(profile.connection)
  ) {
    throw new ModelCertificationError("Execution Certification Claims 与 exact Profile 不一致。");
  }
  availableExecutionModelProfiles.add(profile);
  return deepFreeze(profile) as AvailableExecutionModelProfile;
}

export function isAvailableExecutionModelProfile(
  input: unknown,
): input is AvailableExecutionModelProfile {
  return typeof input === "object" && input !== null && availableExecutionModelProfiles.has(input);
}

export async function computeModelProfileHash(input: unknown): Promise<`sha256:${string}`> {
  const profile = modelProfileSchema.parse(input);
  return sha256ContentHash({
    profile_id: profile.profile_id,
    scope: profile.scope,
    provider: profile.provider,
    model_id: profile.model_id,
    profile_version: profile.profile_version,
    capabilities: profile.capabilities,
    operational_constraints: profile.operational_constraints,
  });
}

export const modelCertificationClaimsSchema = z.strictObject({
  schema_version: versionIdentifierSchema,
  receipt_ref: modelCertificationReceiptReferenceSchema,
  profile_id: immutableIdSchema,
  provider: modelProviderSchema,
  model_id: z.string().min(1).max(256),
  profile_version: versionIdentifierSchema,
  profile_hash: contentHashSchema,
  probe_hash: contentHashSchema,
  verdict: z.literal("PASS"),
});
export type ModelCertificationClaims = z.infer<typeof modelCertificationClaimsSchema>;

export interface ModelCertificationAuthorityContext {
  verifyCommitted: ArtifactReferenceVerifier;
  resolve(
    reference: z.infer<typeof modelCertificationReceiptReferenceSchema>,
  ): Promise<unknown | null>;
}

export class ModelCertificationError extends Error {
  override readonly name = "ModelCertificationError";
  readonly code = "MODEL_CERTIFICATION_NOT_VERIFIED";
}

declare const authoritativeModelCertificationReceipt: unique symbol;
const authorizedModelCertificationReceipts = new WeakSet<object>();

export type AuthoritativeModelCertificationReceipt = z.infer<
  typeof modelCertificationClaimsSchema
> & {
  readonly [authoritativeModelCertificationReceipt]: true;
};

export async function authorizeModelCertificationReceipt(
  expectedReference: z.infer<typeof modelCertificationReceiptReferenceSchema>,
  authority: ModelCertificationAuthorityContext,
): Promise<AuthoritativeModelCertificationReceipt> {
  let reference: z.infer<typeof modelCertificationReceiptReferenceSchema>;
  let resolved: unknown;
  try {
    reference = modelCertificationReceiptReferenceSchema.parse(expectedReference);
    resolved = await authority.resolve(reference);
  } catch {
    throw new ModelCertificationError("Model Certification Receipt 无法从持久化 Authority 解析。");
  }
  const claimsResult = modelCertificationClaimsSchema.safeParse(resolved);
  if (
    !claimsResult.success ||
    artifactReferenceIdentity(claimsResult.data.receipt_ref) !==
      artifactReferenceIdentity(reference)
  ) {
    throw new ModelCertificationError(
      "Model Certification Receipt 必须匹配完整的已解析 Artifact Reference。",
    );
  }
  if (!(await authority.verifyCommitted(reference))) {
    throw new ModelCertificationError("Model Certification Receipt 尚未由持久化 Authority 提交。");
  }

  const receipt = claimsResult.data;
  authorizedModelCertificationReceipts.add(receipt);
  return deepFreeze(receipt) as AuthoritativeModelCertificationReceipt;
}

export function isAuthoritativeModelCertificationReceipt(
  value: unknown,
): value is AuthoritativeModelCertificationReceipt {
  return (
    typeof value === "object" && value !== null && authorizedModelCertificationReceipts.has(value)
  );
}

declare const availableModelProfile: unique symbol;
const availableModelProfiles = new WeakSet<object>();

export type AvailableModelProfile = z.infer<typeof modelProfileSchema> & {
  readonly certification_status: "CONFIGURED" | "AVAILABLE";
  readonly [availableModelProfile]: true;
};

/** Admit a server-configured profile without any certification receipt lookup. */
export function configureAvailableModelProfile(input: unknown): AvailableModelProfile {
  const profile = modelProfileSchema.parse(input);
  if (profile.certification_status !== "CONFIGURED") {
    throw new ModelCertificationError("Direct model profile must be CONFIGURED.");
  }
  availableModelProfiles.add(profile);
  return deepFreeze(profile) as AvailableModelProfile;
}

export async function authorizeAvailableModelProfile(
  input: unknown,
  authority: ModelCertificationAuthorityContext,
): Promise<AvailableModelProfile> {
  const profile = modelProfileSchema.parse(input);
  if (profile.certification_status !== "AVAILABLE" || !profile.certification_receipt_ref) {
    throw new ModelCertificationError("Model Profile 尚未声明为 AVAILABLE。");
  }

  let receipt: AuthoritativeModelCertificationReceipt;
  try {
    receipt = await authorizeModelCertificationReceipt(
      profile.certification_receipt_ref,
      authority,
    );
  } catch {
    throw new ModelCertificationError(
      "AVAILABLE 必须绑定能认证当前 Provider、Model、Profile Version 与 Capability Hash 的已提交 Receipt。",
    );
  }
  const profileHash = await computeModelProfileHash(profile);
  if (
    receipt.profile_id !== profile.profile_id ||
    receipt.provider !== profile.provider ||
    receipt.model_id !== profile.model_id ||
    receipt.profile_version !== profile.profile_version ||
    receipt.profile_hash !== profileHash
  ) {
    throw new ModelCertificationError(
      "AVAILABLE 必须绑定能认证当前 Provider、Model、Profile Version 与 Capability Hash 的已提交 Receipt。",
    );
  }

  availableModelProfiles.add(profile);
  return deepFreeze(profile) as AvailableModelProfile;
}

export function isAvailableModelProfile(value: unknown): value is AvailableModelProfile {
  return typeof value === "object" && value !== null && availableModelProfiles.has(value);
}

export function isCanonicalPosixWorkspaceRoot(value: string): boolean {
  if (!value.startsWith("/") || value === "/" || value.includes("\0") || value.includes("\\")) {
    return false;
  }
  return value
    .slice(1)
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

const externalAgentWorkspaceRootSchema = z
  .string()
  .min(1)
  .max(1_024)
  .superRefine((root, ctx) => {
    if (!isCanonicalPosixWorkspaceRoot(root)) {
      ctx.addIssue({
        code: "custom",
        message: "External Agent Workspace Root 必须是规范的受限 POSIX 绝对路径。",
      });
    }
  });

export const externalAgentWorkspacePolicySchema = z.strictObject({
  roots: z.array(externalAgentWorkspaceRootSchema).min(1),
  writable: z.boolean(),
});

export const externalAgentPermissionPolicySchema = z.strictObject({
  allowed_tools: z.array(z.string().min(1).max(128)),
  allowed_command_ids: z.array(versionIdentifierSchema),
});

export const externalAgentCancellationSchema = z.strictObject({
  supported: z.boolean(),
  timeout_ms: z.number().int().positive(),
});

export const externalAgentAuditPolicySchema = z.strictObject({
  required: z.literal(true),
  receipt_schema_version: versionIdentifierSchema,
});

export const externalAgentProfileSchema = z.strictObject({
  profile_id: immutableIdSchema,
  profile_version: versionIdentifierSchema,
  scope: appScopeSchema,
  kind: z.literal("EXTERNAL_AGENT"),
  adapter: z.string().min(1).max(128),
  workspace_policy: externalAgentWorkspacePolicySchema,
  permission_policy: externalAgentPermissionPolicySchema,
  cancellation: externalAgentCancellationSchema,
  audit: externalAgentAuditPolicySchema,
});

export type ModelProvider = z.infer<typeof modelProviderSchema>;
export type ModelProfile = z.infer<typeof modelProfileSchema>;
export type ModelExecutionProfile = z.infer<typeof modelExecutionProfileSchema>;
export type ModelExecutionCertificationClaims = z.infer<
  typeof modelExecutionCertificationClaimsSchema
>;
export type CurrentProviderExecutionCertificationRequest = z.infer<
  typeof currentProviderExecutionCertificationRequestSchema
>;
export type CurrentProviderExecutionCertificationV2Request = z.infer<
  typeof currentProviderExecutionCertificationV2RequestSchema
>;
export type ExternalAgentProfile = z.infer<typeof externalAgentProfileSchema>;

export * from "./provider-invocation.js";
