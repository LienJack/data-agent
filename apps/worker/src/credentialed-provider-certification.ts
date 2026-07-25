import { randomUUID } from "node:crypto";
import {
  createLiveProviderCredentialedSmoke,
  createModelCertificationReceiptDraft,
  type ModelProviderBinding,
  type ProviderCredentialResolver,
  probeModelProvider,
} from "@data-agent/agent-runtime";
import type { AppScope } from "@data-agent/contracts";
import {
  type CredentialedProviderCertificationReport,
  runCredentialedProviderCertificationCore,
} from "./credentialed-provider-certification.internal.js";
import {
  type AuthoritativeModelCertificationReceiptStore,
  isAuthoritativeModelCertificationReceiptStore,
} from "./postgres-model-certification-receipt-store.js";

export type {
  CredentialedProviderCertificationEntry,
  CredentialedProviderCertificationReport,
} from "./credentialed-provider-certification.internal.js";

export interface CredentialedProviderCertificationInput {
  readonly scope: AppScope;
  readonly run_id: string;
  readonly worker_fence: number;
  readonly bindings: readonly ModelProviderBinding[];
  readonly resolve_credential: ProviderCredentialResolver;
  readonly receipt_store: AuthoritativeModelCertificationReceiptStore;
  readonly now?: () => Date;
}

/**
 * 显式生产入口。调用此函数就是联网 Opt-in 边界：它创建包内授权的 Live Smoke
 * Executor，并且只会访问 `bindings` 指定的 Provider。
 */
export async function runCredentialedProviderCertification(
  input: CredentialedProviderCertificationInput,
): Promise<CredentialedProviderCertificationReport> {
  if (!isAuthoritativeModelCertificationReceiptStore(input.receipt_store)) {
    throw new Error(
      "Credentialed Provider Certification 只接受 Worker 创建的权威 PostgreSQL Receipt Store。",
    );
  }
  const smoke = createLiveProviderCredentialedSmoke();
  return runCredentialedProviderCertificationCore(input, async (binding, context) => {
    const probe = await probeModelProvider({
      binding,
      scope: context.scope,
      resolve_credential: input.resolve_credential,
      smoke,
    });
    if (probe.certification_status !== "PENDING_RECEIPT_COMMIT") {
      return {
        kind: "NOT_CERTIFIED",
        provider: binding.provider,
        model_id: binding.default_model_id,
        certification_status: probe.certification_status,
        reason_code: probe.reason_code,
      };
    }

    const receiptRef = {
      artifact_id: randomUUID(),
      artifact_type: "ModelCertificationReceipt",
      ...context.scope,
      run_id: context.run_id,
      revision: 1,
      content_hash: probe.probe_hash,
    } as const;
    return {
      kind: "PENDING_RECEIPT_COMMIT",
      provider: binding.provider,
      model_id: binding.default_model_id,
      probe,
      claims: await createModelCertificationReceiptDraft({
        profile: probe.profile,
        probe,
        receipt_ref: receiptRef,
      }),
    };
  });
}
