import {
  type AppScope,
  type ArtifactReference,
  appScopeSchema,
  computeModelProfileHash,
  deepFreeze,
  type ModelCertificationClaims,
  type ModelProfile,
  modelCertificationClaimsSchema,
  modelProfileSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { z } from "zod";
import type { ModelProviderBinding } from "./bindings.js";
import { isAuthorizedProviderCredentialedSmoke } from "./credentialed-smoke-authority.js";

export const PROVIDER_CONFORMANCE_CHECKS = [
  "request_shape",
  "structured_output",
  "tool_calling",
  "streaming",
  "error_normalization",
] as const;

const smokeResultSchema = z.strictObject({
  actual_model_id: z.string().min(1).max(256),
  checks: z.strictObject({
    request_shape: z.boolean(),
    structured_output: z.boolean(),
    tool_calling: z.boolean(),
    streaming: z.boolean(),
    error_normalization: z.boolean(),
  }),
});

export type ProviderCredentialResolver = (credentialEnv: string) => Promise<string | null>;
export type ProviderCredentialedSmoke = (input: {
  readonly binding: ModelProviderBinding;
  readonly credential: string;
}) => Promise<z.infer<typeof smokeResultSchema>>;

interface ProviderProbeInput {
  readonly binding: ModelProviderBinding;
  readonly scope: AppScope;
  readonly resolve_credential: ProviderCredentialResolver;
  readonly smoke: ProviderCredentialedSmoke;
}

interface ProviderProbeBase {
  readonly provider: ModelProviderBinding["provider"];
  readonly model_id: string;
  readonly profile: ModelProfile;
  readonly probe_version: "1.0.0";
}

export type ProviderProbeResult =
  | (ProviderProbeBase & {
      readonly certification_status: "UNVERIFIED";
      readonly reason_code: "CREDENTIAL_NOT_CONFIGURED" | "CREDENTIAL_RESOLUTION_FAILED";
    })
  | (ProviderProbeBase & {
      readonly certification_status: "UNAVAILABLE";
      readonly reason_code:
        | "CERTIFIED_MODEL_ID_MISMATCH"
        | "CREDENTIAL_SMOKE_NOT_AUTHORIZED"
        | "CREDENTIAL_SMOKE_FAILED"
        | "PROVIDER_SMOKE_ERROR";
    })
  | (ProviderProbeBase & {
      readonly certification_status: "PENDING_RECEIPT_COMMIT";
      readonly reason_code: "CREDENTIAL_SMOKE_PASSED";
      readonly actual_model_id: string;
      readonly checks: z.infer<typeof smokeResultSchema>["checks"];
      readonly profile_hash: `sha256:${string}`;
      readonly probe_hash: `sha256:${string}`;
    });

const authoritativeCredentialedProviderProbes = new WeakSet<object>();
declare const authoritativeModelCertificationReceiptDraft: unique symbol;
const authoritativeModelCertificationReceiptDrafts = new WeakSet<object>();

export type AuthoritativeModelCertificationReceiptDraft = ModelCertificationClaims & {
  readonly [authoritativeModelCertificationReceiptDraft]: true;
};

function createUnverifiedProfile(binding: ModelProviderBinding, scopeInput: unknown): ModelProfile {
  const scope = appScopeSchema.parse(scopeInput);
  return modelProfileSchema.parse({
    profile_id: binding.profile_id,
    scope,
    provider: binding.provider,
    model_id: binding.default_model_id,
    profile_version: binding.profile_version,
    capabilities: binding.capabilities,
    operational_constraints: binding.operational_constraints,
    certification_status: "UNVERIFIED",
  });
}

function baseProbeResult(binding: ModelProviderBinding, scope: AppScope): ProviderProbeBase {
  return {
    provider: binding.provider,
    model_id: binding.default_model_id,
    profile: createUnverifiedProfile(binding, scope),
    probe_version: "1.0.0",
  };
}

export async function probeModelProvider(input: ProviderProbeInput): Promise<ProviderProbeResult> {
  const scope = appScopeSchema.parse(input.scope);
  const base = baseProbeResult(input.binding, scope);
  let credential: string | null;
  try {
    credential = await input.resolve_credential(input.binding.credential_env);
  } catch {
    return Object.freeze({
      ...base,
      certification_status: "UNVERIFIED",
      reason_code: "CREDENTIAL_RESOLUTION_FAILED",
    });
  }
  if (!credential || credential.trim().length === 0) {
    return Object.freeze({
      ...base,
      certification_status: "UNVERIFIED",
      reason_code: "CREDENTIAL_NOT_CONFIGURED",
    });
  }
  if (!isAuthorizedProviderCredentialedSmoke(input.smoke)) {
    return Object.freeze({
      ...base,
      certification_status: "UNAVAILABLE",
      reason_code: "CREDENTIAL_SMOKE_NOT_AUTHORIZED",
    });
  }

  let smoke: z.infer<typeof smokeResultSchema>;
  try {
    smoke = smokeResultSchema.parse(
      await input.smoke({
        binding: input.binding,
        credential,
      }),
    );
  } catch {
    return Object.freeze({
      ...base,
      certification_status: "UNAVAILABLE",
      reason_code: "PROVIDER_SMOKE_ERROR",
    });
  }
  if (smoke.actual_model_id !== input.binding.default_model_id) {
    return Object.freeze({
      ...base,
      certification_status: "UNAVAILABLE",
      reason_code: "CERTIFIED_MODEL_ID_MISMATCH",
    });
  }
  if (Object.values(smoke.checks).some((passed) => !passed)) {
    return Object.freeze({
      ...base,
      certification_status: "UNAVAILABLE",
      reason_code: "CREDENTIAL_SMOKE_FAILED",
    });
  }

  const profileHash = await computeModelProfileHash(base.profile);
  const probeHash = await sha256ContentHash({
    probe_version: base.probe_version,
    adapter_version: input.binding.adapter_version,
    provider: input.binding.provider,
    profile_id: input.binding.profile_id,
    profile_version: input.binding.profile_version,
    model_id: smoke.actual_model_id,
    profile_hash: profileHash,
    checks: smoke.checks,
  });
  const result = Object.freeze({
    ...base,
    certification_status: "PENDING_RECEIPT_COMMIT",
    reason_code: "CREDENTIAL_SMOKE_PASSED",
    actual_model_id: smoke.actual_model_id,
    checks: smoke.checks,
    profile_hash: profileHash,
    probe_hash: probeHash,
  });
  authoritativeCredentialedProviderProbes.add(result);
  return result;
}

export async function createModelCertificationReceiptDraft(input: {
  readonly profile: ModelProfile;
  readonly probe: Extract<
    ProviderProbeResult,
    { readonly certification_status: "PENDING_RECEIPT_COMMIT" }
  >;
  readonly receipt_ref: ArtifactReference;
}): Promise<AuthoritativeModelCertificationReceiptDraft> {
  if (!authoritativeCredentialedProviderProbes.has(input.probe)) {
    throw new Error("Certification Receipt Draft 只接受本进程真实 Credential Smoke Probe。");
  }
  const profile = modelProfileSchema.parse(input.profile);
  const [profileHash, probedProfileHash] = await Promise.all([
    computeModelProfileHash(profile),
    computeModelProfileHash(input.probe.profile),
  ]);
  if (
    profile.certification_status !== "UNVERIFIED" ||
    profile.profile_id !== input.probe.profile.profile_id ||
    profile.provider !== input.probe.provider ||
    profile.model_id !== input.probe.actual_model_id ||
    profile.profile_version !== input.probe.profile.profile_version ||
    profileHash !== input.probe.profile_hash ||
    probedProfileHash !== input.probe.profile_hash
  ) {
    throw new Error("Certification Receipt Draft 与 Probe/Profile 不一致。");
  }
  const draft = deepFreeze(
    modelCertificationClaimsSchema.parse({
      schema_version: "1.0.0",
      receipt_ref: input.receipt_ref,
      profile_id: profile.profile_id,
      provider: profile.provider,
      model_id: profile.model_id,
      profile_version: profile.profile_version,
      profile_hash: profileHash,
      probe_hash: input.probe.probe_hash,
      verdict: "PASS",
    }),
  );
  authoritativeModelCertificationReceiptDrafts.add(draft);
  return draft as AuthoritativeModelCertificationReceiptDraft;
}

export function isAuthoritativeModelCertificationReceiptDraft(
  input: unknown,
): input is AuthoritativeModelCertificationReceiptDraft {
  return (
    typeof input === "object" &&
    input !== null &&
    authoritativeModelCertificationReceiptDrafts.has(input)
  );
}
