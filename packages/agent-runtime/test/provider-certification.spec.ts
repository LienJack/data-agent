import {
  computeModelExecutionCertificationContentHash,
  computeModelProfileHash,
  type ModelProfile,
  modelCertificationClaimsSchema,
  verifyModelExecutionCertificationClaims,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  authorizeGoalPreflightEvidence,
  isAuthoritativeGoalPreflightEvidence,
} from "../src/models/goal-preflight-evidence.internal.js";
import * as publicModelExports from "../src/models/index.js";
import {
  createExecutionModelCertificationReceiptDraft,
  createGoalPreflightExecutionCertificationReceiptDraftFromEvidence,
  createModelCertificationReceiptDraft,
  createModelProviderExecutionBinding,
  getModelProviderBinding,
  isAuthoritativeExecutionCertificationReceiptDraft,
  isAuthoritativeModelCertificationReceiptDraft,
  probeExecutionModelProvider,
  probeModelProvider,
} from "../src/models/index.js";
import {
  certifiedModelOperationalConstraints,
  modelFixtureIds,
  modelFixtureScope,
} from "./model-fixtures.js";
import { authorizeProviderCredentialedSmokeForTesting } from "./support/credentialed-smoke-authority.js";

describe("Model Provider 认证诚实性", () => {
  it("认证exact config=7 execution profile且支持冻结Goal preflight basis而不再次调用Provider", async () => {
    const template = getModelProviderBinding("deepseek");
    const binding = createModelProviderExecutionBinding({
      template,
      model_config_version: 7,
      model_id: "deepseek-v4-flash",
      model_resource_hash: `sha256:${"1".repeat(64)}`,
      execution_profile_hash: `sha256:${"2".repeat(64)}`,
      recovery_capabilities: ["INVOCATION_RECONCILIATION"],
      connection: {
        kind: "SYSTEM_DEPLOYMENT",
        deployment_id: "40000000-0000-4000-8000-000000000001",
        deployment_revision: 3,
        deployment_hash: `sha256:${"3".repeat(64)}`,
      },
      operational_constraints: certifiedModelOperationalConstraints,
    });
    const probe = await probeExecutionModelProvider({
      binding,
      scope: modelFixtureScope,
      resolve_credential: async () => "secret",
      smoke: authorizeProviderCredentialedSmokeForTesting(async () => ({
        actual_model_id: "deepseek-v4-flash",
        checks: {
          request_shape: true,
          structured_output: true,
          tool_calling: true,
          streaming: true,
          error_normalization: true,
        },
      })),
    });
    expect(probe.certification_status).toBe("PENDING_RECEIPT_COMMIT");
    if (!("execution_profile" in probe)) throw new Error("expected execution probe");
    const receiptRef = {
      artifact_id: modelFixtureIds.receipt,
      artifact_type: "ModelCertificationReceipt" as const,
      ...modelFixtureScope,
      run_id: modelFixtureIds.run,
      revision: 1,
      content_hash: probe.probe_hash,
    };
    const claims = await createExecutionModelCertificationReceiptDraft({
      probe,
      receipt_ref: receiptRef,
    });
    expect(claims).toMatchObject({
      model_config_version: 7,
      model_id: "deepseek-v4-flash",
      profile_version: "model-profile@7",
      certification_basis: { kind: "CREDENTIAL_SMOKE" },
    });
    expect(claims.receipt_ref.content_hash).not.toBe(receiptRef.content_hash);
    expect(claims.receipt_ref.content_hash).toBe(
      await computeModelExecutionCertificationContentHash(claims),
    );
    await expect(verifyModelExecutionCertificationClaims(claims)).resolves.toEqual(claims);
    await expect(
      verifyModelExecutionCertificationClaims({
        ...claims,
        receipt_ref: { ...claims.receipt_ref, content_hash: receiptRef.content_hash },
      }),
    ).rejects.toThrow("Execution Certification");

    const preflightBasis = {
      kind: "GOAL_PREFLIGHT_ATTESTATION" as const,
      goal_execution_id: "40000000-0000-4000-8000-000000000002",
      plan_commit: "abcdef1",
      plan_hash: `sha256:${"4".repeat(64)}` as const,
      manifest_hash: `sha256:${"5".repeat(64)}` as const,
      checkpoint_hash: `sha256:${"6".repeat(64)}` as const,
      preflight_evidence_hash: `sha256:${"7".repeat(64)}` as const,
      observed_provider: "deepseek" as const,
      observed_model_id: "deepseek-v4-flash",
      checks: {
        request_shape: true as const,
        structured_output: true as const,
        tool_calling: true as const,
        streaming: true as const,
        error_normalization: true as const,
      },
    };
    const evidence = await authorizeGoalPreflightEvidence(preflightBasis, {
      resolve_committed: async (lookup) =>
        lookup.goal_execution_id === preflightBasis.goal_execution_id &&
        lookup.plan_commit === preflightBasis.plan_commit
          ? preflightBasis
          : null,
    });
    expect(isAuthoritativeGoalPreflightEvidence(evidence)).toBe(true);
    const preflight = await createGoalPreflightExecutionCertificationReceiptDraftFromEvidence({
      profile: probe.execution_profile,
      receipt_ref: receiptRef,
      evidence,
    });
    expect(preflight.certification_basis.kind).toBe("GOAL_PREFLIGHT_ATTESTATION");
    expect(isAuthoritativeExecutionCertificationReceiptDraft(preflight)).toBe(true);
    expect(isAuthoritativeExecutionCertificationReceiptDraft({ ...preflight })).toBe(false);
    await expect(
      createGoalPreflightExecutionCertificationReceiptDraftFromEvidence({
        profile: probe.execution_profile,
        receipt_ref: receiptRef,
        evidence: { ...evidence } as never,
      }),
    ).rejects.toThrow("authoritative Goal preflight evidence");
    expect(publicModelExports).not.toHaveProperty(
      "createGoalPreflightExecutionCertificationReceiptDraft",
    );
  });
  it("缺少 Credential 时保持 UNVERIFIED，且不调用 Smoke Executor", async () => {
    const smoke = vi.fn();
    const result = await probeModelProvider({
      binding: getModelProviderBinding("openai"),
      scope: modelFixtureScope,
      resolve_credential: async () => null,
      smoke,
    });

    expect(result.certification_status).toBe("UNVERIFIED");
    expect(result.reason_code).toBe("CREDENTIAL_NOT_CONFIGURED");
    expect(result).not.toHaveProperty("probe_hash");
    expect(smoke).not.toHaveBeenCalled();
  });

  it("Credential 存在时拒绝未由 Live Smoke Authority 签发的任意 Callback", async () => {
    const smoke = vi.fn(async () => ({
      actual_model_id: getModelProviderBinding("openai").default_model_id,
      checks: {
        request_shape: true,
        structured_output: true,
        tool_calling: true,
        streaming: true,
        error_normalization: true,
      },
    }));
    const result = await probeModelProvider({
      binding: getModelProviderBinding("openai"),
      scope: modelFixtureScope,
      resolve_credential: async () => "secret",
      smoke,
    });

    expect(result.certification_status).toBe("UNAVAILABLE");
    expect(result.reason_code).toBe("CREDENTIAL_SMOKE_NOT_AUTHORIZED");
    expect(smoke).not.toHaveBeenCalled();
  });

  it("Credential 存在仍需真实 Smoke 全部通过且返回精确 Model ID", async () => {
    const binding = getModelProviderBinding("deepseek");
    const mismatch = await probeModelProvider({
      binding,
      scope: modelFixtureScope,
      resolve_credential: async () => "secret",
      smoke: authorizeProviderCredentialedSmokeForTesting(async () => ({
        actual_model_id: "different-model",
        checks: {
          request_shape: true,
          structured_output: true,
          tool_calling: true,
          streaming: true,
          error_normalization: true,
        },
      })),
    });
    expect(mismatch.certification_status).toBe("UNAVAILABLE");
    expect(mismatch.reason_code).toBe("CERTIFIED_MODEL_ID_MISMATCH");

    const failedCheck = await probeModelProvider({
      binding,
      scope: modelFixtureScope,
      resolve_credential: async () => "secret",
      smoke: authorizeProviderCredentialedSmokeForTesting(async () => ({
        actual_model_id: binding.default_model_id,
        checks: {
          request_shape: true,
          structured_output: true,
          tool_calling: false,
          streaming: true,
          error_normalization: true,
        },
      })),
    });
    expect(failedCheck.certification_status).toBe("UNAVAILABLE");
    expect(failedCheck.reason_code).toBe("CREDENTIAL_SMOKE_FAILED");
    expect(failedCheck).toMatchObject({ checks: { tool_calling: false } });
  });

  it("Smoke PASS 只生成待提交 Receipt Claims，不直接赋予 AVAILABLE 品牌", async () => {
    const binding = getModelProviderBinding("gemini");
    const probe = await probeModelProvider({
      binding,
      scope: modelFixtureScope,
      resolve_credential: async () => "secret",
      smoke: authorizeProviderCredentialedSmokeForTesting(async () => ({
        actual_model_id: binding.default_model_id,
        checks: {
          request_shape: true,
          structured_output: true,
          tool_calling: true,
          streaming: true,
          error_normalization: true,
        },
      })),
    });
    expect(probe.certification_status).toBe("PENDING_RECEIPT_COMMIT");
    if (probe.certification_status !== "PENDING_RECEIPT_COMMIT") {
      throw new Error("测试前置条件失败。");
    }

    const claims = await createModelCertificationReceiptDraft({
      profile: probe.profile,
      probe,
      receipt_ref: {
        artifact_id: modelFixtureIds.receipt,
        artifact_type: "ModelCertificationReceipt",
        app_id: modelFixtureScope.app_id,
        tenant_id: modelFixtureScope.tenant_id,
        environment: modelFixtureScope.environment,
        run_id: modelFixtureIds.run,
        revision: 1,
        content_hash: probe.probe_hash,
      },
    });

    expect(modelCertificationClaimsSchema.parse(claims)).toEqual(claims);
    expect(isAuthoritativeModelCertificationReceiptDraft(claims)).toBe(true);
    expect(isAuthoritativeModelCertificationReceiptDraft({ ...claims })).toBe(false);
    expect(probe.profile_hash).toBe(await computeModelProfileHash(probe.profile));
    expect(claims.profile_hash).toBe(probe.profile_hash);
    expect(probe.profile.certification_status).toBe("UNVERIFIED");
    expect(probe).not.toHaveProperty("available_profile");
  });

  it("Receipt Draft 拒绝 Probe 后漂移的 Scope、Capabilities 与 Operational Constraints", async () => {
    const binding = getModelProviderBinding("gemini");
    const probe = await probeModelProvider({
      binding,
      scope: modelFixtureScope,
      resolve_credential: async () => "secret",
      smoke: authorizeProviderCredentialedSmokeForTesting(async () => ({
        actual_model_id: binding.default_model_id,
        checks: {
          request_shape: true,
          structured_output: true,
          tool_calling: true,
          streaming: true,
          error_normalization: true,
        },
      })),
    });
    expect(probe.certification_status).toBe("PENDING_RECEIPT_COMMIT");
    if (probe.certification_status !== "PENDING_RECEIPT_COMMIT") {
      throw new Error("测试前置条件失败。");
    }

    const mutatedProfiles: readonly ModelProfile[] = [
      {
        ...probe.profile,
        scope: {
          ...probe.profile.scope,
          tenant_id: modelFixtureIds.profileFallback,
        },
      },
      {
        ...probe.profile,
        capabilities: {
          ...probe.profile.capabilities,
          vision: !probe.profile.capabilities.vision,
        },
      },
      {
        ...probe.profile,
        operational_constraints: certifiedModelOperationalConstraints,
      },
    ];

    for (const profile of mutatedProfiles) {
      await expect(
        createModelCertificationReceiptDraft({
          profile,
          probe,
          receipt_ref: {
            artifact_id: modelFixtureIds.receipt,
            artifact_type: "ModelCertificationReceipt",
            app_id: modelFixtureScope.app_id,
            tenant_id: modelFixtureScope.tenant_id,
            environment: modelFixtureScope.environment,
            run_id: modelFixtureIds.run,
            revision: 1,
            content_hash: probe.probe_hash,
          },
        }),
      ).rejects.toThrow("Probe/Profile");
    }
  });

  it("Receipt Draft 拒绝结构相同但未由 Credential Smoke Authority 产生的 Probe", async () => {
    const binding = getModelProviderBinding("gemini");
    const probe = await probeModelProvider({
      binding,
      scope: modelFixtureScope,
      resolve_credential: async () => "secret",
      smoke: authorizeProviderCredentialedSmokeForTesting(async () => ({
        actual_model_id: binding.default_model_id,
        checks: {
          request_shape: true,
          structured_output: true,
          tool_calling: true,
          streaming: true,
          error_normalization: true,
        },
      })),
    });
    expect(probe.certification_status).toBe("PENDING_RECEIPT_COMMIT");
    if (probe.certification_status !== "PENDING_RECEIPT_COMMIT") {
      throw new Error("测试前置条件失败。");
    }

    await expect(
      createModelCertificationReceiptDraft({
        profile: probe.profile,
        probe: { ...probe },
        receipt_ref: {
          artifact_id: modelFixtureIds.receipt,
          artifact_type: "ModelCertificationReceipt",
          app_id: modelFixtureScope.app_id,
          tenant_id: modelFixtureScope.tenant_id,
          environment: modelFixtureScope.environment,
          run_id: modelFixtureIds.run,
          revision: 1,
          content_hash: probe.probe_hash,
        },
      }),
    ).rejects.toThrow("Credential Smoke Probe");
  });
});
