import { createModelProviderBindings, type ModelProviderBinding } from "@data-agent/agent-runtime";
import {
  type AppScope,
  type ArtifactReference,
  artifactReferenceIdentity,
  computeModelProfileHash,
  type ModelCertificationClaims,
  modelCertificationClaimsSchema,
  modelProfileSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import type {
  AppCapability,
  SqlPool,
  TransactionalCapabilityAuthorizer,
} from "@data-agent/platform";
import { describe, expect, it, vi } from "vitest";
import {
  type CredentialedProviderAttempt,
  type ModelCertificationReceiptStore,
  runCredentialedProviderCertificationCore,
} from "../src/credentialed-provider-certification.internal.js";
import {
  type CredentialedProviderCertificationInput,
  runCredentialedProviderCertification,
} from "../src/credentialed-provider-certification.js";
import * as worker from "../src/index.js";
import {
  type AuthoritativeModelCertificationReceiptStore,
  createPostgresModelCertificationReceiptStore,
} from "../src/postgres-model-certification-receipt-store.js";

const scope = {
  app_id: "70000000-0000-4000-8000-000000000001",
  tenant_id: "70000000-0000-4000-8000-000000000002",
  environment: "test",
} as const satisfies AppScope;
const runId = "70000000-0000-4000-8000-000000000003";
const bindings = createModelProviderBindings().slice(0, 2);

function firstBinding(): ModelProviderBinding {
  const binding = bindings[0];
  if (!binding) throw new Error("测试前置条件失败：缺少 Provider Binding。");
  return binding;
}

function artifactIdFor(binding: ModelProviderBinding): string {
  return binding.provider === "openai"
    ? "70000000-0000-4000-8000-000000000010"
    : "70000000-0000-4000-8000-000000000011";
}

async function pendingAttempt(binding: ModelProviderBinding): Promise<CredentialedProviderAttempt> {
  const profile = modelProfileSchema.parse({
    profile_id: binding.profile_id,
    scope,
    provider: binding.provider,
    model_id: binding.default_model_id,
    profile_version: binding.profile_version,
    capabilities: binding.capabilities,
    operational_constraints: binding.operational_constraints,
    certification_status: "UNVERIFIED",
  });
  const profileHash = await computeModelProfileHash(profile);
  const probeHash = await sha256ContentHash({
    provider: binding.provider,
    model_id: binding.default_model_id,
    profile_hash: profileHash,
    fixture: "credentialed-provider-certification",
  });
  const receiptRef = {
    artifact_id: artifactIdFor(binding),
    artifact_type: "ModelCertificationReceipt",
    ...scope,
    run_id: runId,
    revision: 1,
    content_hash: probeHash,
  } as const;
  const probe = {
    provider: binding.provider,
    model_id: binding.default_model_id,
    profile,
    probe_version: "1.0.0",
    certification_status: "PENDING_RECEIPT_COMMIT",
    reason_code: "CREDENTIAL_SMOKE_PASSED",
    actual_model_id: binding.default_model_id,
    checks: {
      request_shape: true,
      structured_output: true,
      tool_calling: true,
      streaming: true,
      error_normalization: true,
    },
    profile_hash: profileHash,
    probe_hash: probeHash,
  } as const;
  return {
    kind: "PENDING_RECEIPT_COMMIT",
    provider: binding.provider,
    model_id: binding.default_model_id,
    probe,
    claims: modelCertificationClaimsSchema.parse({
      schema_version: "1.0.0",
      receipt_ref: receiptRef,
      profile_id: binding.profile_id,
      provider: binding.provider,
      model_id: binding.default_model_id,
      profile_version: binding.profile_version,
      profile_hash: profileHash,
      probe_hash: probeHash,
      verdict: "PASS",
    }),
  };
}

function inMemoryReceiptStore(
  options: {
    readonly commit?: "PASS" | "FAIL";
    readonly resolve?: "PASS" | "FAIL";
    readonly verify?: "PASS" | "FAIL";
  } = {},
): ModelCertificationReceiptStore {
  const receipts = new Map<string, ModelCertificationClaims>();
  return {
    async commit(claims) {
      if (options.commit === "FAIL") {
        return {
          ok: false,
          error: {
            code: "FIXTURE_COMMIT_FAILED",
            message: "fixture",
            retryable: false,
          },
        };
      }
      receipts.set(artifactReferenceIdentity(claims.receipt_ref), claims);
      return { ok: true, value: claims.receipt_ref };
    },
    async resolve(reference) {
      return {
        ok: true,
        value:
          options.resolve === "FAIL"
            ? null
            : (receipts.get(artifactReferenceIdentity(reference)) ?? null),
      };
    },
    async verify(reference) {
      return {
        ok: true,
        value: options.verify !== "FAIL" && receipts.has(artifactReferenceIdentity(reference)),
      };
    },
  };
}

function coreInput(receiptStore: ModelCertificationReceiptStore) {
  return {
    scope,
    run_id: runId,
    worker_fence: 4,
    bindings,
    receipt_store: receiptStore,
    now: () => new Date("2026-07-25T00:00:00.000Z"),
  } as const;
}

describe("Credentialed Provider Certification Worker", () => {
  it("包根不暴露 Credential Smoke、Store Mint 或品牌判定 seam", () => {
    const exports = Object.keys(worker);

    expect(exports).not.toContain("createPostgresModelCertificationReceiptStore");
    expect(exports).not.toContain("runCredentialedProviderCertification");
    expect(exports).not.toContain("ModelCertificationReceiptStore");
    expect(exports).not.toContain("isAuthoritativeModelCertificationReceiptStore");
    expect(exports).not.toContain("runCredentialedProviderCertificationCore");
  });

  it("两个 Provider 的 Receipt 提交、再解析与校验全部成功后才返回 PASS", async () => {
    const report = await runCredentialedProviderCertificationCore(
      coreInput(inMemoryReceiptStore()),
      pendingAttempt,
    );

    expect(report).toMatchObject({
      terminal: "PASS",
      available_providers: 2,
      reason_code: "MINIMUM_AVAILABLE_PROVIDERS_CERTIFIED",
    });
    expect(report.providers).toEqual([
      expect.objectContaining({
        provider: "openai",
        certification_status: "AVAILABLE",
        reason_code: "MODEL_CERTIFICATION_RECEIPT_COMMITTED",
      }),
      expect.objectContaining({
        provider: "anthropic",
        certification_status: "AVAILABLE",
        reason_code: "MODEL_CERTIFICATION_RECEIPT_COMMITTED",
      }),
    ]);
  });

  it("缺少 Credential 的 Provider 保持 UNVERIFIED，少于两个 AVAILABLE 时保持 HOLD", async () => {
    const report = await runCredentialedProviderCertificationCore(
      coreInput(inMemoryReceiptStore()),
      async (binding) =>
        binding.provider === "openai"
          ? pendingAttempt(binding)
          : {
              kind: "NOT_CERTIFIED",
              provider: binding.provider,
              model_id: binding.default_model_id,
              certification_status: "UNVERIFIED",
              reason_code: "CREDENTIAL_NOT_CONFIGURED",
            },
    );

    expect(report).toMatchObject({
      terminal: "HOLD",
      available_providers: 1,
      reason_code: "MINIMUM_AVAILABLE_PROVIDERS_NOT_CERTIFIED",
    });
    expect(report.providers.at(1)).toMatchObject({
      certification_status: "UNVERIFIED",
      reason_code: "CREDENTIAL_NOT_CONFIGURED",
    });
  });

  it("Receipt 提交失败或持久化 Authority 无法再解析时失败关闭", async () => {
    const commitFailure = await runCredentialedProviderCertificationCore(
      coreInput(inMemoryReceiptStore({ commit: "FAIL" })),
      pendingAttempt,
    );
    const authorityFailure = await runCredentialedProviderCertificationCore(
      coreInput(inMemoryReceiptStore({ resolve: "FAIL" })),
      pendingAttempt,
    );

    expect(commitFailure.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          certification_status: "UNAVAILABLE",
          reason_code: "MODEL_CERTIFICATION_RECEIPT_COMMIT_FAILED",
        }),
      ]),
    );
    expect(authorityFailure.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          certification_status: "UNAVAILABLE",
          reason_code: "MODEL_CERTIFICATION_AUTHORITY_REJECTED",
        }),
      ]),
    );
    expect(commitFailure.terminal).toBe("HOLD");
    expect(authorityFailure.terminal).toBe("HOLD");
  });

  it("提交返回不同 Artifact Reference 时不能投影 AVAILABLE", async () => {
    const baseStore = inMemoryReceiptStore();
    const mismatchedStore: ModelCertificationReceiptStore = {
      ...baseStore,
      async commit(claims) {
        const committed = await baseStore.commit(claims, { worker_fence: 4 });
        if (!committed.ok) return committed;
        const mismatched: ArtifactReference = {
          ...committed.value,
          artifact_id: "70000000-0000-4000-8000-000000000099",
        };
        return { ok: true, value: mismatched };
      },
    };

    const report = await runCredentialedProviderCertificationCore(
      coreInput(mismatchedStore),
      pendingAttempt,
    );

    expect(report.available_providers).toBe(0);
    expect(report.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          certification_status: "UNAVAILABLE",
          reason_code: "MODEL_CERTIFICATION_RECEIPT_COMMIT_FAILED",
        }),
      ]),
    );
  });

  it("重复 Provider Binding 在任何 Smoke 或持久化动作前失败关闭", async () => {
    const attemptProvider = vi.fn(pendingAttempt);
    const duplicate = firstBinding();
    const report = await runCredentialedProviderCertificationCore(
      {
        ...coreInput(inMemoryReceiptStore()),
        bindings: [duplicate, duplicate],
      },
      attemptProvider,
    );

    expect(attemptProvider).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      terminal: "HOLD",
      available_providers: 0,
      reason_code: "MINIMUM_AVAILABLE_PROVIDERS_NOT_CERTIFIED",
    });
    expect(report.providers).toHaveLength(2);
    expect(report.providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          certification_status: "UNAVAILABLE",
          reason_code: "DUPLICATE_PROVIDER_BINDING_REJECTED",
        }),
      ]),
    );
  });

  it("公开生产入口拒绝调用方伪造的 Receipt Store，且不会解析凭据或联网", async () => {
    const resolveCredential = vi.fn(async () => "secret");
    const fakeStore =
      inMemoryReceiptStore() as unknown as AuthoritativeModelCertificationReceiptStore;

    await expect(
      runCredentialedProviderCertification({
        scope,
        run_id: runId,
        worker_fence: 4,
        bindings,
        receipt_store: fakeStore,
        resolve_credential: resolveCredential,
        now: () => new Date("2026-07-25T00:00:00.000Z"),
      } satisfies CredentialedProviderCertificationInput),
    ).rejects.toThrow("权威 PostgreSQL Receipt Store");
    expect(resolveCredential).not.toHaveBeenCalled();
  });

  it("PostgreSQL Receipt Store 在接触数据库前拒绝结构合法但未品牌化的 Claims", async () => {
    const connect = vi.fn();
    const store = createPostgresModelCertificationReceiptStore({
      pool: { connect } as SqlPool,
      authorizer: {} as TransactionalCapabilityAuthorizer,
      capability: {} as AppCapability,
    });
    const attempt = await pendingAttempt(firstBinding());
    if (attempt.kind !== "PENDING_RECEIPT_COMMIT") {
      throw new Error("测试前置条件失败。");
    }

    await expect(store.commit({ ...attempt.claims }, { worker_fence: 4 })).resolves.toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_INPUT_INVALID" },
    });
    expect(connect).not.toHaveBeenCalled();
  });
});
