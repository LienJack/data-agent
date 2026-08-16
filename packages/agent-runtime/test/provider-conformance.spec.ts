import { MODEL_PROVIDERS, modelProfileSchema } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  createModelProviderBindings,
  createModelProviderExecutionBinding,
  createUnverifiedModelProfiles,
  getModelProviderBinding,
  inspectProviderRuntimeModel,
  MODEL_PROVIDER_BINDINGS,
} from "../src/models/index.js";
import {
  evaluateOfflineProviderErrorBoundary,
  runOfflineProviderBehaviorConformance,
} from "../src/models/offline-conformance.js";
import { modelFixtureScope } from "./model-fixtures.js";

function operationalConstraintsFixture() {
  return {
    context_window: {
      verification_status: "VERIFIED" as const,
      max_context_tokens: 128_000,
      max_output_tokens: 8_192,
    },
    region_privacy: { verification_status: "UNVERIFIED" as const },
    pricing: { verification_status: "UNVERIFIED" as const },
    fallback_compatibility: { verification_status: "UNVERIFIED" as const },
  };
}

describe("七类 Model Provider 离线 Conformance", () => {
  it("Registry 完整、唯一并固定真实 SDK/端点/凭据引用", () => {
    expect(MODEL_PROVIDER_BINDINGS.map(({ provider }) => provider)).toEqual(MODEL_PROVIDERS);
    expect(new Set(MODEL_PROVIDER_BINDINGS.map(({ profile_id }) => profile_id)).size).toBe(
      MODEL_PROVIDERS.length,
    );

    for (const binding of MODEL_PROVIDER_BINDINGS) {
      expect(binding.profile_version).toBe("1.0.0");
      expect(binding.adapter_version).toBe("1.0.0");
      expect(binding.credential_env).toMatch(/^[A-Z][A-Z0-9_]+$/);
      expect(binding.default_model_id).not.toHaveLength(0);
      expect(binding.sdk_package).toMatch(/^@ai-sdk\//);
      if (binding.base_url) {
        expect(new URL(binding.base_url).protocol).toBe("https:");
      }
      expect(
        Object.values(binding.operational_constraints).every(
          ({ verification_status }) => verification_status === "UNVERIFIED",
        ),
      ).toBe(true);
      expect(getModelProviderBinding(binding.provider)).toEqual(binding);
    }
    expect(getModelProviderBinding("deepseek").default_model_id).toBe("deepseek-v4-flash");
    expect(JSON.stringify(MODEL_PROVIDER_BINDINGS)).not.toContain("deepseek-v4-pro");
  });

  it("从U2 exact config动态构造execution binding且deployment不能由profile冒充", () => {
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
      operational_constraints: operationalConstraintsFixture(),
    });
    expect(binding.profile_version).toBe("model-profile@7");
    expect(binding.model_config_version).toBe(7);
    expect(() =>
      createModelProviderExecutionBinding({
        template,
        model_config_version: 7,
        model_id: "deepseek-v4-flash",
        model_resource_hash: `sha256:${"1".repeat(64)}`,
        execution_profile_hash: `sha256:${"2".repeat(64)}`,
        recovery_capabilities: ["INVOCATION_RECONCILIATION"],
        connection: {
          kind: "SYSTEM_DEPLOYMENT",
          deployment_id: template.profile_id,
          deployment_revision: 3,
          deployment_hash: `sha256:${"3".repeat(64)}`,
        },
        operational_constraints: operationalConstraintsFixture(),
      }),
    ).toThrow("deployment identity");
  });

  it("离线配置只能创建 UNVERIFIED Profile，绝不伪装为 AVAILABLE", () => {
    const profiles = createUnverifiedModelProfiles(modelFixtureScope);

    expect(profiles).toHaveLength(MODEL_PROVIDERS.length);
    for (const profile of profiles) {
      expect(modelProfileSchema.parse(profile)).toEqual(profile);
      expect(profile.certification_status).toBe("UNVERIFIED");
      expect(
        Object.values(profile.operational_constraints).every(
          ({ verification_status }) => verification_status === "UNVERIFIED",
        ),
      ).toBe(true);
      expect(profile).not.toHaveProperty("certification_receipt_ref");
      expect(profile).not.toHaveProperty("certified_model_id");
    }
  });

  it("部署可以冻结精确 Model ID，但不能重复配置或把凭据发往自定义端点", () => {
    const bindings = createModelProviderBindings([
      {
        provider: "glm",
        model_id: "deployment-frozen-glm",
      },
      {
        provider: "openai",
        model_id: "deployment-frozen-openai",
      },
    ]);

    expect(getModelProviderBinding("glm", bindings)).toMatchObject({
      default_model_id: "deployment-frozen-glm",
      base_url: "https://open.bigmodel.cn/api/paas/v4",
    });
    expect(getModelProviderBinding("openai", bindings).default_model_id).toBe(
      "deployment-frozen-openai",
    );
    expect(
      createUnverifiedModelProfiles(modelFixtureScope, bindings).every(
        ({ certification_status }) => certification_status === "UNVERIFIED",
      ),
    ).toBe(true);

    expect(() =>
      createModelProviderBindings([
        { provider: "kimi", model_id: "first" },
        { provider: "kimi", model_id: "second" },
      ]),
    ).toThrowError(expect.objectContaining({ code: "DUPLICATE_MODEL_PROVIDER_OVERRIDE" }));
    expect(() =>
      createModelProviderBindings([
        {
          provider: "openai",
          model_id: "model",
          base_url: "https://untrusted.example.test/v1",
        },
      ]),
    ).toThrow();
  });

  it("部署可冻结已验证运行约束，并把它们纳入后续 Profile Hash", () => {
    const operationalConstraints = {
      context_window: {
        verification_status: "VERIFIED" as const,
        max_context_tokens: 128_000,
        max_output_tokens: 8_192,
      },
      region_privacy: { verification_status: "UNVERIFIED" as const },
      pricing: {
        verification_status: "VERIFIED" as const,
        currency: "USD",
        input_microunits_per_million_tokens: 1_000,
        output_microunits_per_million_tokens: 2_000,
      },
      fallback_compatibility: { verification_status: "UNVERIFIED" as const },
    };
    const bindings = createModelProviderBindings([
      {
        provider: "openai",
        model_id: "deployment-frozen-openai",
        operational_constraints: operationalConstraints,
      },
    ]);

    expect(getModelProviderBinding("openai", bindings).operational_constraints).toEqual(
      operationalConstraints,
    );
    expect(createUnverifiedModelProfiles(modelFixtureScope, bindings)[0]).toMatchObject({
      certification_status: "UNVERIFIED",
      operational_constraints: operationalConstraints,
    });
  });

  it("即使 Server Binding Resolver 被误配，也不会把凭据发送到非受信兼容端点", () => {
    const glm = getModelProviderBinding("glm");

    expect(() =>
      inspectProviderRuntimeModel(
        {
          ...glm,
          base_url: "https://credential-exfiltration.example.test/v1",
        },
        "not-a-real-secret",
      ),
    ).toThrowError(expect.objectContaining({ code: "MODEL_PROVIDER_NOT_REGISTERED" }));
  });

  it.each(MODEL_PROVIDERS)(
    "%s 可以在不发出网络请求时构造真实 SDK Model，并保持期望的 Model ID",
    (provider) => {
      const binding = getModelProviderBinding(provider);
      const inspection = inspectProviderRuntimeModel(binding, "not-a-real-secret");

      expect(inspection.model_id).toBe(binding.default_model_id);
      expect(inspection.provider_runtime_id.length).toBeGreaterThan(0);
      expect(inspection.specification_version).toMatch(/^v[234]$/);
      expect(JSON.stringify(inspection)).not.toContain("not-a-real-secret");
    },
  );

  it.each(MODEL_PROVIDERS)(
    "%s 通过真实 SDK mock transport 的 Request/Structured/Tool/Stream/Error 行为验证",
    async (provider) => {
      const result = await runOfflineProviderBehaviorConformance(getModelProviderBinding(provider));

      expect(result.evidence_scope).toBe("MOCK_TRANSPORT_SDK_BEHAVIOR");
      expect(result.status).toBe("PASS");
      expect(Object.values(result.checks).map(({ status }) => status)).toEqual([
        "PASS",
        "PASS",
        "PASS",
        "PASS",
        "PASS",
      ]);
    },
  );

  it("错误边界不会把任意异常或伪造字段误判为 SDK 脱敏验证通过", () => {
    const binding = getModelProviderBinding("openai");
    const baseInput = {
      request: undefined,
      binding,
      credentialMarker: "offline-mock-credential",
      remoteSecretMarker: "remote-secret-marker",
    } as const;

    expect(
      evaluateOfflineProviderErrorBoundary({
        ...baseInput,
        error: new Error("unexpected"),
      }),
    ).toBe(false);
    expect(
      evaluateOfflineProviderErrorBoundary({
        ...baseInput,
        error: {
          statusCode: 401,
          responseBody: "remote-secret-marker",
          isRetryable: false,
        },
      }),
    ).toBe(false);
  });
});
