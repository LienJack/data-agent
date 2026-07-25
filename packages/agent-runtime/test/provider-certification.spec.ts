import {
  computeModelProfileHash,
  type ModelProfile,
  modelCertificationClaimsSchema,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  createModelCertificationReceiptDraft,
  getModelProviderBinding,
  isAuthoritativeModelCertificationReceiptDraft,
  probeModelProvider,
} from "../src/models/index.js";
import {
  certifiedModelOperationalConstraints,
  modelFixtureIds,
  modelFixtureScope,
} from "./model-fixtures.js";
import { authorizeProviderCredentialedSmokeForTesting } from "./support/credentialed-smoke-authority.js";

describe("Model Provider 认证诚实性", () => {
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
