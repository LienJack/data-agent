import { type AvailableModelProfile, MODEL_PROVIDERS } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  ModelRoutingError,
  type ModelRoutingRequest,
  routeAvailableModel,
} from "../src/models/index.js";
import { makeAvailableProfile, modelFixtureIds, modelFixtureScope } from "./model-fixtures.js";

const baseRequest = {
  scope: modelFixtureScope,
  required_capabilities: {
    structured_output: true,
    tool_calling: true,
    streaming: true,
  },
  required_context: {
    input_tokens: 10_000,
    output_tokens: 1_000,
  },
  required_region_privacy: {
    processing_region: "fixture-region",
    required_privacy_tags: ["no-training"],
  },
  max_cost_budget: {
    currency: "USD",
    max_microunits: 20,
  },
  required_fallback_compatibility_tags: ["json-v1"],
  allowed_profile_ids: [modelFixtureIds.profile, modelFixtureIds.profileFallback],
  ordered_fallback_profile_ids: [modelFixtureIds.profileFallback],
  max_attempts: 2,
} as const satisfies ModelRoutingRequest;

const primaryOnlyRequest = {
  ...baseRequest,
  allowed_profile_ids: [modelFixtureIds.profile],
  ordered_fallback_profile_ids: [],
  required_fallback_compatibility_tags: [],
} as const satisfies ModelRoutingRequest;

describe("Model Capability Router", () => {
  it("只按 Capability 与显式 Fallback 顺序选择经过认证的 Profile", async () => {
    const primary = await makeAvailableProfile({
      provider: "openai",
      model_id: "fixture-primary",
    });
    const fallback = await makeAvailableProfile({
      profile_id: modelFixtureIds.profileFallback,
      provider: "anthropic",
      model_id: "fixture-fallback",
    });

    const decision = routeAvailableModel(baseRequest, [fallback, primary]);

    expect(decision.primary.profile_id).toBe(modelFixtureIds.profile);
    expect(decision.fallbacks.map(({ profile_id }) => profile_id)).toEqual([
      modelFixtureIds.profileFallback,
    ]);
    expect(decision.attempt_limit).toBe(2);
    expect(decision.reason_code).toBe("CAPABILITY_ROUTE_MATCHED");
  });

  it("拒绝能力不足、跨 Scope、未授权或未显式允许的 Fallback", async () => {
    const missingToolCapability = await makeAvailableProfile({
      provider: "openai",
      model_id: "missing-tool",
      capabilities: {
        structured_output: true,
        tool_calling: false,
        streaming: true,
        reasoning: true,
        vision: false,
      },
    });
    expect(() => routeAvailableModel(primaryOnlyRequest, [missingToolCapability])).toThrowError(
      expect.objectContaining({ code: "MODEL_CAPABILITY_NOT_SATISFIED" }),
    );

    const crossScope = await makeAvailableProfile({
      provider: "openai",
      model_id: "cross-scope",
      scope: { ...modelFixtureScope, tenant_id: "10000000-0000-4000-8000-000000000099" },
    });
    expect(() => routeAvailableModel(primaryOnlyRequest, [crossScope])).toThrowError(
      expect.objectContaining({ code: "MODEL_PROFILE_SCOPE_MISMATCH" }),
    );

    const structuralForgery = {
      ...crossScope,
      scope: modelFixtureScope,
    } as unknown as AvailableModelProfile;
    expect(() => routeAvailableModel(primaryOnlyRequest, [structuralForgery])).toThrowError(
      expect.objectContaining({ code: "MODEL_PROFILE_NOT_AUTHORIZED" }),
    );

    const fallback = await makeAvailableProfile({
      profile_id: modelFixtureIds.profileFallback,
      provider: "anthropic",
      model_id: "fixture-fallback",
    });
    expect(() =>
      routeAvailableModel(
        {
          ...baseRequest,
          allowed_profile_ids: [modelFixtureIds.profile],
        },
        [fallback],
      ),
    ).toThrowError(expect.objectContaining({ code: "MODEL_PROFILE_NOT_ALLOWED" }));
  });

  it("Provider 数量变化不会在 Router 中形成厂商分支", async () => {
    const profiles = await Promise.all(
      MODEL_PROVIDERS.map((provider, index) =>
        makeAvailableProfile({
          profile_id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          provider,
          model_id: `fixture-${provider}`,
        }),
      ),
    );
    const request = {
      ...baseRequest,
      allowed_profile_ids: profiles.map(({ profile_id }) => profile_id),
      ordered_fallback_profile_ids: profiles.slice(1).map(({ profile_id }) => profile_id),
      max_attempts: profiles.length,
    };

    const decision = routeAvailableModel(request, profiles);

    expect(decision.primary.provider).toBe("openai");
    expect(decision.fallbacks).toHaveLength(MODEL_PROVIDERS.length - 1);
    expect(decision.fallbacks.map(({ provider }) => provider)).toEqual(MODEL_PROVIDERS.slice(1));
    expect(ModelRoutingError).toBeDefined();
  });

  it("Context Window 不足时失败关闭", async () => {
    const insufficientContext = await makeAvailableProfile({
      provider: "openai",
      model_id: "fixture-small-context",
      operational_constraints: {
        context_window: {
          verification_status: "VERIFIED",
          max_context_tokens: 10_500,
          max_output_tokens: 1_000,
        },
        region_privacy: {
          verification_status: "VERIFIED",
          processing_regions: ["fixture-region"],
          privacy_tags: ["no-training"],
        },
        pricing: {
          verification_status: "VERIFIED",
          currency: "USD",
          input_microunits_per_million_tokens: 1_000,
          output_microunits_per_million_tokens: 2_000,
        },
        fallback_compatibility: {
          verification_status: "VERIFIED",
          tags: ["json-v1"],
        },
      },
    });

    expect(() =>
      routeAvailableModel(
        {
          ...baseRequest,
          allowed_profile_ids: [modelFixtureIds.profile],
          ordered_fallback_profile_ids: [],
          required_fallback_compatibility_tags: [],
        },
        [insufficientContext],
      ),
    ).toThrowError(expect.objectContaining({ code: "MODEL_CONTEXT_WINDOW_NOT_SATISFIED" }));
  });

  it("Region 或 Privacy 约束不满足时失败关闭", async () => {
    const wrongRegion = await makeAvailableProfile({
      provider: "openai",
      model_id: "fixture-wrong-region",
      operational_constraints: {
        context_window: {
          verification_status: "VERIFIED",
          max_context_tokens: 128_000,
          max_output_tokens: 8_192,
        },
        region_privacy: {
          verification_status: "VERIFIED",
          processing_regions: ["other-fixture-region"],
          privacy_tags: ["tenant-isolated"],
        },
        pricing: {
          verification_status: "VERIFIED",
          currency: "USD",
          input_microunits_per_million_tokens: 1_000,
          output_microunits_per_million_tokens: 2_000,
        },
        fallback_compatibility: {
          verification_status: "VERIFIED",
          tags: ["json-v1"],
        },
      },
    });

    expect(() =>
      routeAvailableModel(
        {
          ...baseRequest,
          allowed_profile_ids: [modelFixtureIds.profile],
          ordered_fallback_profile_ids: [],
          required_fallback_compatibility_tags: [],
        },
        [wrongRegion],
      ),
    ).toThrowError(expect.objectContaining({ code: "MODEL_REGION_PRIVACY_NOT_SATISFIED" }));
  });

  it("成本未知或保守估算超预算时都失败关闭", async () => {
    const unknownCost = await makeAvailableProfile({
      provider: "openai",
      model_id: "fixture-unknown-cost",
      operational_constraints: {
        context_window: {
          verification_status: "VERIFIED",
          max_context_tokens: 128_000,
          max_output_tokens: 8_192,
        },
        region_privacy: {
          verification_status: "VERIFIED",
          processing_regions: ["fixture-region"],
          privacy_tags: ["no-training"],
        },
        pricing: { verification_status: "UNVERIFIED" },
        fallback_compatibility: {
          verification_status: "VERIFIED",
          tags: ["json-v1"],
        },
      },
    });
    const overBudget = await makeAvailableProfile({
      provider: "openai",
      model_id: "fixture-over-budget",
      operational_constraints: {
        ...unknownCost.operational_constraints,
        pricing: {
          verification_status: "VERIFIED",
          currency: "USD",
          input_microunits_per_million_tokens: 10_000_000,
          output_microunits_per_million_tokens: 20_000_000,
        },
      },
    });
    const request = {
      ...baseRequest,
      allowed_profile_ids: [modelFixtureIds.profile],
      ordered_fallback_profile_ids: [],
      required_fallback_compatibility_tags: [],
    };

    expect(() => routeAvailableModel(request, [unknownCost])).toThrowError(
      expect.objectContaining({ code: "MODEL_COST_BUDGET_NOT_SATISFIED" }),
    );
    expect(() => routeAvailableModel(request, [overBudget])).toThrowError(
      expect.objectContaining({ code: "MODEL_COST_BUDGET_NOT_SATISFIED" }),
    );
  });

  it("显式 Fallback 的兼容标签不匹配时拒绝整条路由", async () => {
    const primary = await makeAvailableProfile({
      provider: "openai",
      model_id: "fixture-primary",
    });
    const incompatibleFallback = await makeAvailableProfile({
      profile_id: modelFixtureIds.profileFallback,
      provider: "anthropic",
      model_id: "fixture-incompatible-fallback",
      operational_constraints: {
        ...primary.operational_constraints,
        fallback_compatibility: {
          verification_status: "VERIFIED",
          tags: ["different-contract"],
        },
      },
    });

    expect(() => routeAvailableModel(baseRequest, [primary, incompatibleFallback])).toThrowError(
      expect.objectContaining({ code: "MODEL_FALLBACK_NOT_COMPATIBLE" }),
    );
  });
});
