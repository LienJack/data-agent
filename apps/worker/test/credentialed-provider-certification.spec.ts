import {
  createGoalPreflightExecutionCertificationReceiptDraftFromEvidence,
  createModelProviderBindings,
  type ModelProviderBinding,
} from "@data-agent/agent-runtime";
import {
  type AppScope,
  type ArtifactReference,
  artifactReferenceIdentity,
  computeModelProfileHash,
  modelCertificationClaimsSchema,
  modelExecutionProfileSchema,
  modelProfileSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import type {
  AppCapability,
  SqlPool,
  SqlQueryResult,
  TransactionalCapabilityAuthorizer,
} from "@data-agent/platform";
import { describe, expect, it, vi } from "vitest";
import { authorizeGoalPreflightEvidence } from "../../../packages/agent-runtime/dist/models/goal-preflight-evidence.internal.js";
import { createDeploymentRegistry } from "../../../packages/platform/src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../../../packages/platform/test/support/transactional-authority.js";
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
  const receipts = new Map<string, unknown>();
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
          reason_code: "FIXTURE_COMMIT_FAILED",
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

  it("PostgreSQL Receipt Store 在接触数据库前拒绝伪造的 execution claims clone", async () => {
    const connect = vi.fn();
    const store = createPostgresModelCertificationReceiptStore({
      pool: { connect } as SqlPool,
      authorizer: {} as TransactionalCapabilityAuthorizer,
      capability: {} as AppCapability,
    });
    const binding = firstBinding();
    const profile = modelExecutionProfileSchema.parse({
      profile_id: binding.profile_id,
      scope,
      provider: binding.provider,
      model_id: binding.default_model_id,
      model_config_version: 7,
      profile_version: "model-profile@7",
      adapter_version: "model-provider-adapter@1.0.0",
      recovery_capabilities: ["INVOCATION_RECONCILIATION"],
      connection: {
        kind: "SYSTEM_DEPLOYMENT",
        deployment_id: "70000000-0000-4000-8000-000000000020",
        deployment_revision: 1,
        deployment_hash: `sha256:${"a".repeat(64)}`,
      },
      capabilities: binding.capabilities,
      operational_constraints: {
        context_window: {
          verification_status: "VERIFIED",
          max_context_tokens: 16_000,
          max_output_tokens: 4_000,
        },
        region_privacy: {
          verification_status: "VERIFIED",
          processing_regions: ["cn"],
          privacy_tags: [],
        },
        fallback_compatibility: { verification_status: "UNVERIFIED" },
      },
      certification_status: "UNVERIFIED",
    });
    const certificationBasis = {
      kind: "GOAL_PREFLIGHT_ATTESTATION" as const,
      goal_execution_id: "70000000-0000-4000-8000-000000000022",
      plan_commit: "abcdef1",
      plan_hash: `sha256:${"1".repeat(64)}` as const,
      manifest_hash: `sha256:${"2".repeat(64)}` as const,
      checkpoint_hash: `sha256:${"3".repeat(64)}` as const,
      preflight_evidence_hash: `sha256:${"4".repeat(64)}` as const,
      observed_provider: binding.provider,
      observed_model_id: binding.default_model_id,
      checks: {
        request_shape: true as const,
        structured_output: true as const,
        tool_calling: true as const,
        streaming: true as const,
        error_normalization: true as const,
      },
    };
    const evidence = await authorizeGoalPreflightEvidence(certificationBasis, {
      resolve_committed: async () => certificationBasis,
    });
    const claims = await createGoalPreflightExecutionCertificationReceiptDraftFromEvidence({
      profile,
      receipt_ref: {
        artifact_id: "70000000-0000-4000-8000-000000000021",
        artifact_type: "ModelCertificationReceipt",
        ...scope,
        run_id: runId,
        revision: 1,
        content_hash: `sha256:${"0".repeat(64)}`,
      },
      evidence,
    });

    await expect(store.commit({ ...claims }, { worker_fence: 4 })).resolves.toMatchObject({
      ok: false,
      error: { code: "PERSISTENCE_INPUT_INVALID" },
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it("PostgreSQL Receipt Store 提交并精确重放 genuine execution certification", async () => {
    const deploymentId = "70000000-0000-4000-8000-000000000030";
    const registry = createDeploymentRegistry(
      [{ deployment_id: deploymentId, app_id: scope.app_id, environment: "test" }],
      [
        {
          subject: "70000000-0000-4000-8000-000000000031",
          deployment_id: deploymentId,
          tenant_id: scope.tenant_id,
          role: "ANALYST",
        },
      ],
    );
    const resolved = registry.resolveForDeployment(deploymentId, {
      subject: "70000000-0000-4000-8000-000000000031",
    });
    if (!resolved.ok) throw new Error("fixture authority missing");
    const binding = firstBinding();
    const profile = modelExecutionProfileSchema.parse({
      profile_id: binding.profile_id,
      scope,
      provider: binding.provider,
      model_id: binding.default_model_id,
      model_config_version: 7,
      profile_version: "model-profile@7",
      adapter_version: "model-provider-adapter@1.0.0",
      recovery_capabilities: ["INVOCATION_RECONCILIATION"],
      connection: {
        kind: "SYSTEM_DEPLOYMENT",
        deployment_id: deploymentId,
        deployment_revision: 1,
        deployment_hash: `sha256:${"a".repeat(64)}`,
      },
      capabilities: binding.capabilities,
      operational_constraints: {
        context_window: {
          verification_status: "VERIFIED",
          max_context_tokens: 16_000,
          max_output_tokens: 4_000,
        },
        region_privacy: {
          verification_status: "VERIFIED",
          processing_regions: ["cn"],
          privacy_tags: [],
        },
        fallback_compatibility: { verification_status: "UNVERIFIED" },
      },
      certification_status: "UNVERIFIED",
    });
    const certificationBasis = {
      kind: "GOAL_PREFLIGHT_ATTESTATION" as const,
      goal_execution_id: "70000000-0000-4000-8000-000000000033",
      plan_commit: "abcdef1",
      plan_hash: `sha256:${"1".repeat(64)}` as const,
      manifest_hash: `sha256:${"2".repeat(64)}` as const,
      checkpoint_hash: `sha256:${"3".repeat(64)}` as const,
      preflight_evidence_hash: `sha256:${"4".repeat(64)}` as const,
      observed_provider: binding.provider,
      observed_model_id: binding.default_model_id,
      checks: {
        request_shape: true as const,
        structured_output: true as const,
        tool_calling: true as const,
        streaming: true as const,
        error_normalization: true as const,
      },
    };
    const evidence = await authorizeGoalPreflightEvidence(certificationBasis, {
      resolve_committed: async () => certificationBasis,
    });
    const claims = await createGoalPreflightExecutionCertificationReceiptDraftFromEvidence({
      profile,
      receipt_ref: {
        artifact_id: "70000000-0000-4000-8000-000000000032",
        artifact_type: "ModelCertificationReceipt",
        ...scope,
        run_id: runId,
        revision: 1,
        content_hash: `sha256:${"0".repeat(64)}`,
      },
      evidence,
    });
    let persisted: { content_hash: string; document_json: unknown } | null = null;
    let inserts = 0;
    const pool: SqlPool = {
      async connect() {
        return {
          async query<Row extends object = Record<string, unknown>>(
            text: string,
            values: readonly unknown[] = [],
          ) {
            let rows: readonly object[] = [];
            if (text.includes("backend_context_matches")) rows = [{ allowed: true }];
            else if (text.includes("lock_owned_run_fence")) rows = [{ active_fence: 4 }];
            else if (text.includes("select content_hash, document_json")) {
              rows = persisted ? [persisted] : [];
            } else if (text.includes("insert into artifacts")) {
              inserts += 1;
              persisted = {
                content_hash: String(values[5]),
                document_json: JSON.parse(String(values[6])),
              };
            }
            return { rows, rowCount: rows.length } as SqlQueryResult<Row>;
          },
          release() {},
        };
      },
    };
    const transactionalAuthorizer = asTransactionalTestAuthority(
      registry.authorizer,
    ) as unknown as TransactionalCapabilityAuthorizer;
    const unauthorizedStore = createPostgresModelCertificationReceiptStore({
      pool,
      // Vitest resolves Platform source while Worker package types resolve the
      // built declaration's private symbol; this is the same test-only adapter.
      authorizer: transactionalAuthorizer,
      capability: resolved.value,
    });
    const unauthorized = await unauthorizedStore.commit(claims, { worker_fence: 4 });
    expect(unauthorized).toMatchObject({
      ok: false,
      error: { code: "MODEL_CERTIFICATION_GOAL_EVIDENCE_NOT_COMMITTED" },
    });
    expect(inserts).toBe(0);

    const store = createPostgresModelCertificationReceiptStore({
      pool,
      authorizer: transactionalAuthorizer,
      capability: resolved.value,
      goal_preflight_evidence_authority: {
        resolveCommitted: async ({ goal_execution_id, plan_commit }) =>
          goal_execution_id === certificationBasis.goal_execution_id &&
          plan_commit === certificationBasis.plan_commit
            ? certificationBasis
            : null,
      },
    });

    const first = await store.commit(claims, { worker_fence: 4 });
    const replay = await store.commit(claims, { worker_fence: 4 });

    expect(first).toEqual({ ok: true, value: claims.receipt_ref });
    expect(replay).toEqual(first);
    expect(inserts).toBe(1);
  });
});
