import type { ModelProviderBinding, ProviderProbeResult } from "@data-agent/agent-runtime";
import {
  type AppScope,
  type ArtifactReference,
  artifactReferenceIdentity,
  authorizeAvailableModelProfile,
  type ModelCertificationClaims,
  modelCertificationClaimsSchema,
  modelProfileSchema,
  type PortResult,
} from "@data-agent/contracts";
import { z } from "zod";

const minimumAvailableProviders = 2;

const coreInputSchema = z.strictObject({
  scope: z.strictObject({
    app_id: z.uuid(),
    tenant_id: z.uuid(),
    environment: z.string().min(1).max(128),
  }),
  run_id: z.uuid(),
  worker_fence: z.number().int().nonnegative().safe(),
});

export interface ModelCertificationReceiptStore {
  commit(
    claims: ModelCertificationClaims,
    options: { readonly worker_fence: number },
  ): Promise<PortResult<ArtifactReference>>;
  resolve(reference: ArtifactReference): Promise<PortResult<unknown | null>>;
  verify(reference: ArtifactReference): Promise<PortResult<boolean>>;
}

export type CredentialedProviderAttempt =
  | {
      readonly kind: "NOT_CERTIFIED";
      readonly provider: ModelProviderBinding["provider"];
      readonly model_id: string;
      readonly certification_status: "UNVERIFIED" | "UNAVAILABLE";
      readonly reason_code: string;
    }
  | {
      readonly kind: "PENDING_RECEIPT_COMMIT";
      readonly provider: ModelProviderBinding["provider"];
      readonly model_id: string;
      readonly probe: Extract<
        ProviderProbeResult,
        { readonly certification_status: "PENDING_RECEIPT_COMMIT" }
      >;
      readonly claims: ModelCertificationClaims;
    };

export interface CredentialedProviderCertificationEntry {
  readonly provider: ModelProviderBinding["provider"];
  readonly model_id: string;
  readonly certification_status: "AVAILABLE" | "UNVERIFIED" | "UNAVAILABLE";
  readonly reason_code: string;
  readonly receipt_ref?: ArtifactReference;
}

export interface CredentialedProviderCertificationReport {
  readonly schema_version: "1.0.0";
  readonly report_type: "CredentialedProviderCertificationReport";
  readonly execution_mode: "EXPLICIT_CREDENTIALED_SMOKE";
  readonly scope: AppScope;
  readonly run_id: string;
  readonly observed_at: string;
  readonly minimum_available_providers: 2;
  readonly available_providers: number;
  readonly terminal: "PASS" | "HOLD";
  readonly reason_code:
    | "MINIMUM_AVAILABLE_PROVIDERS_CERTIFIED"
    | "MINIMUM_AVAILABLE_PROVIDERS_NOT_CERTIFIED";
  readonly providers: readonly CredentialedProviderCertificationEntry[];
}

export interface CredentialedProviderCertificationCoreInput {
  readonly scope: AppScope;
  readonly run_id: string;
  readonly worker_fence: number;
  readonly bindings: readonly ModelProviderBinding[];
  readonly receipt_store: ModelCertificationReceiptStore;
  readonly now?: () => Date;
}

function unavailableEntry(
  binding: ModelProviderBinding,
  reasonCode: string,
): CredentialedProviderCertificationEntry {
  return Object.freeze({
    provider: binding.provider,
    model_id: binding.default_model_id,
    certification_status: "UNAVAILABLE",
    reason_code: reasonCode,
  });
}

function certificationReport(input: {
  readonly scope: AppScope;
  readonly run_id: string;
  readonly observed_at: string;
  readonly entries: readonly CredentialedProviderCertificationEntry[];
}): CredentialedProviderCertificationReport {
  const availableProviders = new Set(
    input.entries
      .filter(({ certification_status }) => certification_status === "AVAILABLE")
      .map(({ provider }) => provider),
  ).size;
  const passed = availableProviders >= minimumAvailableProviders;
  return Object.freeze({
    schema_version: "1.0.0",
    report_type: "CredentialedProviderCertificationReport",
    execution_mode: "EXPLICIT_CREDENTIALED_SMOKE",
    scope: input.scope,
    run_id: input.run_id,
    observed_at: input.observed_at,
    minimum_available_providers: minimumAvailableProviders,
    available_providers: availableProviders,
    terminal: passed ? "PASS" : "HOLD",
    reason_code: passed
      ? "MINIMUM_AVAILABLE_PROVIDERS_CERTIFIED"
      : "MINIMUM_AVAILABLE_PROVIDERS_NOT_CERTIFIED",
    providers: Object.freeze([...input.entries]),
  });
}

function receiptMatchesAttempt(
  binding: ModelProviderBinding,
  input: CredentialedProviderCertificationCoreInput,
  attempt: Extract<CredentialedProviderAttempt, { readonly kind: "PENDING_RECEIPT_COMMIT" }>,
): boolean {
  const claims = modelCertificationClaimsSchema.safeParse(attempt.claims);
  const profile = modelProfileSchema.safeParse(attempt.probe.profile);
  return (
    claims.success &&
    profile.success &&
    attempt.provider === binding.provider &&
    attempt.model_id === binding.default_model_id &&
    attempt.probe.provider === binding.provider &&
    attempt.probe.actual_model_id === binding.default_model_id &&
    attempt.probe.profile.profile_id === binding.profile_id &&
    attempt.probe.profile.profile_version === binding.profile_version &&
    attempt.probe.profile.scope.app_id === input.scope.app_id &&
    attempt.probe.profile.scope.tenant_id === input.scope.tenant_id &&
    attempt.probe.profile.scope.environment === input.scope.environment &&
    claims.data.receipt_ref.app_id === input.scope.app_id &&
    claims.data.receipt_ref.tenant_id === input.scope.tenant_id &&
    claims.data.receipt_ref.environment === input.scope.environment &&
    claims.data.receipt_ref.run_id === input.run_id &&
    claims.data.receipt_ref.revision === 1 &&
    claims.data.receipt_ref.content_hash === attempt.probe.probe_hash &&
    claims.data.profile_id === binding.profile_id &&
    claims.data.provider === binding.provider &&
    claims.data.model_id === binding.default_model_id &&
    claims.data.profile_version === binding.profile_version &&
    claims.data.profile_hash === attempt.probe.profile_hash &&
    claims.data.probe_hash === attempt.probe.probe_hash
  );
}

async function authorizePersistedProfile(
  input: CredentialedProviderCertificationCoreInput,
  attempt: Extract<CredentialedProviderAttempt, { readonly kind: "PENDING_RECEIPT_COMMIT" }>,
): Promise<ArtifactReference | null> {
  const expectedReference = attempt.claims.receipt_ref;
  const committed = await input.receipt_store.commit(attempt.claims, {
    worker_fence: input.worker_fence,
  });
  if (
    !committed.ok ||
    artifactReferenceIdentity(committed.value) !== artifactReferenceIdentity(expectedReference)
  ) {
    return null;
  }

  const availableProfile = {
    ...attempt.probe.profile,
    certification_status: "AVAILABLE",
    certification_receipt_ref: expectedReference,
    certified_model_id: attempt.probe.actual_model_id,
  } as const;
  await authorizeAvailableModelProfile(availableProfile, {
    resolve: async (reference) => {
      const resolved = await input.receipt_store.resolve(reference);
      return resolved.ok ? resolved.value : null;
    },
    verifyCommitted: async (reference) => {
      const verified = await input.receipt_store.verify(reference);
      return verified.ok && verified.value;
    },
  });
  return expectedReference;
}

/**
 * 包内确定性编排核。生产入口固定创建带运行时品牌的 Live Smoke Executor；
 * 测试只能在不联网的前提下注入认证尝试，不能从 Worker 包根访问此入口。
 */
export async function runCredentialedProviderCertificationCore(
  inputValue: CredentialedProviderCertificationCoreInput,
  attemptProvider: (
    binding: ModelProviderBinding,
    context: {
      readonly scope: AppScope;
      readonly run_id: string;
    },
  ) => Promise<CredentialedProviderAttempt>,
): Promise<CredentialedProviderCertificationReport> {
  const parsed = coreInputSchema.parse({
    scope: inputValue.scope,
    run_id: inputValue.run_id,
    worker_fence: inputValue.worker_fence,
  });
  const observedAt = (inputValue.now?.() ?? new Date()).toISOString();
  const providerNames = inputValue.bindings.map(({ provider }) => provider);
  if (new Set(providerNames).size !== providerNames.length) {
    return certificationReport({
      scope: parsed.scope,
      run_id: parsed.run_id,
      observed_at: observedAt,
      entries: inputValue.bindings.map((binding) =>
        unavailableEntry(binding, "DUPLICATE_PROVIDER_BINDING_REJECTED"),
      ),
    });
  }
  const entries: CredentialedProviderCertificationEntry[] = [];

  for (const binding of inputValue.bindings) {
    let attempt: CredentialedProviderAttempt;
    try {
      attempt = await attemptProvider(binding, {
        scope: parsed.scope,
        run_id: parsed.run_id,
      });
    } catch {
      entries.push(unavailableEntry(binding, "PROVIDER_CERTIFICATION_ATTEMPT_FAILED"));
      continue;
    }

    if (attempt.kind === "NOT_CERTIFIED") {
      if (attempt.provider !== binding.provider || attempt.model_id !== binding.default_model_id) {
        entries.push(unavailableEntry(binding, "PROVIDER_CERTIFICATION_CORRELATION_MISMATCH"));
        continue;
      }
      entries.push(
        Object.freeze({
          provider: binding.provider,
          model_id: binding.default_model_id,
          certification_status: attempt.certification_status,
          reason_code: attempt.reason_code,
        }),
      );
      continue;
    }

    if (!receiptMatchesAttempt(binding, inputValue, attempt)) {
      entries.push(unavailableEntry(binding, "PROVIDER_CERTIFICATION_CORRELATION_MISMATCH"));
      continue;
    }

    try {
      const receiptReference = await authorizePersistedProfile(inputValue, attempt);
      entries.push(
        receiptReference
          ? Object.freeze({
              provider: binding.provider,
              model_id: binding.default_model_id,
              certification_status: "AVAILABLE",
              reason_code: "MODEL_CERTIFICATION_RECEIPT_COMMITTED",
              receipt_ref: receiptReference,
            })
          : unavailableEntry(binding, "MODEL_CERTIFICATION_RECEIPT_COMMIT_FAILED"),
      );
    } catch {
      entries.push(unavailableEntry(binding, "MODEL_CERTIFICATION_AUTHORITY_REJECTED"));
    }
  }

  return certificationReport({
    scope: parsed.scope,
    run_id: parsed.run_id,
    observed_at: observedAt,
    entries,
  });
}
