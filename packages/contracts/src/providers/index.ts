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

export const modelCapabilitiesSchema = z.strictObject({
  structured_output: z.boolean(),
  tool_calling: z.boolean(),
  streaming: z.boolean(),
  reasoning: z.boolean(),
  vision: z.boolean(),
});

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
    certification_status: z.enum(["UNVERIFIED", "AVAILABLE", "UNAVAILABLE"]),
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

export async function computeModelProfileHash(input: unknown): Promise<`sha256:${string}`> {
  const profile = modelProfileSchema.parse(input);
  return sha256ContentHash({
    profile_id: profile.profile_id,
    scope: profile.scope,
    provider: profile.provider,
    model_id: profile.model_id,
    profile_version: profile.profile_version,
    capabilities: profile.capabilities,
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
  input: unknown,
  expectedReference: z.infer<typeof modelCertificationReceiptReferenceSchema>,
  verifyCommitted: ArtifactReferenceVerifier,
): Promise<AuthoritativeModelCertificationReceipt> {
  const claimsResult = modelCertificationClaimsSchema.safeParse(input);
  if (
    !claimsResult.success ||
    artifactReferenceIdentity(claimsResult.data.receipt_ref) !==
      artifactReferenceIdentity(expectedReference)
  ) {
    throw new ModelCertificationError(
      "Model Certification Receipt 必须匹配完整的已解析 Artifact Reference。",
    );
  }
  if (!(await verifyCommitted(expectedReference))) {
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
  readonly certification_status: "AVAILABLE";
  readonly [availableModelProfile]: true;
};

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
      await authority.resolve(profile.certification_receipt_ref),
      profile.certification_receipt_ref,
      (reference) => authority.verifyCommitted(reference),
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
export type ExternalAgentProfile = z.infer<typeof externalAgentProfileSchema>;
