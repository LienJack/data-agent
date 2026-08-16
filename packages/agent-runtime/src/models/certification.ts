import {
  type AppScope,
  type ArtifactReference,
  appScopeSchema,
  buildModelExecutionCertificationClaims,
  computeModelExecutionProfileHash,
  computeModelProfileHash,
  deepFreeze,
  type ModelCertificationClaims,
  type ModelExecutionProfile,
  type ModelProfile,
  modelCertificationClaimsSchema,
  type modelExecutionCertificationClaimsSchema,
  modelExecutionProfileSchema,
  modelProfileSchema,
  projectModelExecutionProfileSnapshot,
  sha256ContentHash,
} from "@data-agent/contracts";
import { z } from "zod";
import type { ModelProviderBinding, ModelProviderExecutionBinding } from "./bindings.js";
import { isAuthorizedProviderCredentialedSmoke } from "./credentialed-smoke-authority.js";
import {
  type AuthoritativeGoalPreflightEvidence,
  isAuthoritativeGoalPreflightEvidence,
} from "./goal-preflight-evidence.internal.js";

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
      readonly checks?: z.infer<typeof smokeResultSchema>["checks"];
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
      checks: smoke.checks,
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

const authoritativeExecutionProviderProbes = new WeakSet<object>();
declare const authoritativeExecutionCertificationReceiptDraft: unique symbol;
const authoritativeExecutionCertificationReceiptDrafts = new WeakSet<object>();

export type ExecutionProviderProbeResult = Readonly<{
  certification_status: "PENDING_RECEIPT_COMMIT";
  reason_code: "CREDENTIAL_SMOKE_PASSED";
  execution_profile: ModelExecutionProfile;
  execution_profile_hash: `sha256:${string}`;
  probe_hash: `sha256:${string}`;
  checks: z.infer<typeof smokeResultSchema>["checks"];
}>;

function createExecutionUnverifiedProfile(
  binding: ModelProviderExecutionBinding,
  scope: AppScope,
): ModelExecutionProfile {
  return modelExecutionProfileSchema.parse({
    profile_id: binding.profile_id,
    scope,
    provider: binding.provider,
    model_id: binding.default_model_id,
    model_config_version: binding.model_config_version,
    profile_version: binding.profile_version,
    adapter_version: binding.adapter_version,
    recovery_capabilities: binding.recovery_capabilities,
    connection: binding.connection,
    capabilities: binding.capabilities,
    operational_constraints: binding.operational_constraints,
    certification_status: "UNVERIFIED",
  });
}

export async function probeExecutionModelProvider(input: {
  readonly binding: ModelProviderExecutionBinding;
  readonly scope: AppScope;
  readonly resolve_credential: ProviderCredentialResolver;
  readonly smoke: ProviderCredentialedSmoke;
}): Promise<ProviderProbeResult | ExecutionProviderProbeResult> {
  const base = await probeModelProvider(input);
  if (base.certification_status !== "PENDING_RECEIPT_COMMIT") return base;
  const executionProfile = createExecutionUnverifiedProfile(input.binding, input.scope);
  const executionProfileHash = await computeModelExecutionProfileHash(executionProfile);
  const result = deepFreeze({
    certification_status: "PENDING_RECEIPT_COMMIT" as const,
    reason_code: "CREDENTIAL_SMOKE_PASSED" as const,
    execution_profile: executionProfile,
    execution_profile_hash: executionProfileHash,
    probe_hash: await sha256ContentHash({
      probe_version: "model-execution-probe@1.0.0",
      provider: input.binding.provider,
      model_id: input.binding.default_model_id,
      model_config_version: input.binding.model_config_version,
      execution_profile_hash: executionProfileHash,
      checks: base.checks,
    }),
    checks: base.checks,
  });
  authoritativeExecutionProviderProbes.add(result);
  return result;
}

export type AuthoritativeExecutionCertificationReceiptDraft = z.infer<
  typeof modelExecutionCertificationClaimsSchema
> & { readonly [authoritativeExecutionCertificationReceiptDraft]: true };

export async function createExecutionModelCertificationReceiptDraft(input: {
  readonly probe: ExecutionProviderProbeResult;
  readonly receipt_ref: ArtifactReference;
}): Promise<AuthoritativeExecutionCertificationReceiptDraft> {
  if (!authoritativeExecutionProviderProbes.has(input.probe)) {
    throw new Error("Execution Certification 只接受本进程 exact credential smoke probe。");
  }
  const profile = modelExecutionProfileSchema.parse(input.probe.execution_profile);
  const { content_hash: _callerContentHash, ...receiptReference } = input.receipt_ref;
  const draft = deepFreeze(
    await buildModelExecutionCertificationClaims({
      schema_version: "model-execution-certification@1.0.0",
      receipt_ref: receiptReference,
      profile_id: profile.profile_id,
      model_config_version: profile.model_config_version,
      provider: profile.provider,
      model_id: profile.model_id,
      profile_version: profile.profile_version,
      adapter_version: profile.adapter_version,
      execution_profile_hash: input.probe.execution_profile_hash,
      execution_profile_snapshot: projectModelExecutionProfileSnapshot(profile),
      recovery_capabilities: profile.recovery_capabilities,
      connection: profile.connection,
      certification_basis: { kind: "CREDENTIAL_SMOKE", probe_hash: input.probe.probe_hash },
      verdict: "PASS",
    }),
  );
  authoritativeExecutionCertificationReceiptDrafts.add(draft);
  return draft as AuthoritativeExecutionCertificationReceiptDraft;
}

export async function createGoalPreflightExecutionCertificationReceiptDraftFromEvidence(input: {
  readonly profile: ModelExecutionProfile;
  readonly receipt_ref: ArtifactReference;
  readonly evidence: AuthoritativeGoalPreflightEvidence;
}): Promise<AuthoritativeExecutionCertificationReceiptDraft> {
  const profile = modelExecutionProfileSchema.parse(input.profile);
  if (!isAuthoritativeGoalPreflightEvidence(input.evidence)) {
    throw new Error("Execution Certification 只接受 authoritative Goal preflight evidence。");
  }
  const basis = input.evidence;
  if (
    basis.kind !== "GOAL_PREFLIGHT_ATTESTATION" ||
    basis.observed_provider !== profile.provider ||
    basis.observed_model_id !== profile.model_id
  ) {
    throw new Error("Goal preflight attestation 与 exact execution profile 不一致。");
  }
  const executionProfileHash = await computeModelExecutionProfileHash(profile);
  const { content_hash: _callerContentHash, ...receiptReference } = input.receipt_ref;
  const draft = deepFreeze(
    await buildModelExecutionCertificationClaims({
      schema_version: "model-execution-certification@1.0.0",
      receipt_ref: receiptReference,
      profile_id: profile.profile_id,
      model_config_version: profile.model_config_version,
      provider: profile.provider,
      model_id: profile.model_id,
      profile_version: profile.profile_version,
      adapter_version: profile.adapter_version,
      execution_profile_hash: executionProfileHash,
      execution_profile_snapshot: projectModelExecutionProfileSnapshot(profile),
      recovery_capabilities: profile.recovery_capabilities,
      connection: profile.connection,
      certification_basis: basis,
      verdict: "PASS",
    }),
  );
  authoritativeExecutionCertificationReceiptDrafts.add(draft);
  return draft as AuthoritativeExecutionCertificationReceiptDraft;
}

export function isAuthoritativeExecutionCertificationReceiptDraft(
  input: unknown,
): input is AuthoritativeExecutionCertificationReceiptDraft {
  return (
    typeof input === "object" &&
    input !== null &&
    authoritativeExecutionCertificationReceiptDrafts.has(input)
  );
}
