import {
  type AppScope,
  type AvailableModelProfile,
  appScopeSchema,
  immutableIdSchema,
  isAvailableModelProfile,
  modelCapabilitiesSchema,
  versionIdentifierSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import { ModelRoutingError, type ModelRuntimeErrorCode } from "./errors.js";

const requiredCapabilitiesSchema = modelCapabilitiesSchema
  .partial()
  .superRefine((capabilities, ctx) => {
    for (const [key, required] of Object.entries(capabilities)) {
      if (required !== true) {
        ctx.addIssue({
          code: "custom",
          message: "Routing Requirement 只能声明必须为 true 的 Capability。",
          path: [key],
        });
      }
    }
  });

const requiredContextSchema = z.strictObject({
  input_tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  output_tokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

const requiredRegionPrivacySchema = z.strictObject({
  processing_region: versionIdentifierSchema,
  required_privacy_tags: z.array(versionIdentifierSchema).max(64),
});

const maxCostBudgetSchema = z.strictObject({
  currency: z.string().regex(/^[A-Z]{3}$/),
  max_microunits: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

export const modelRoutingRequestSchema = z
  .strictObject({
    scope: appScopeSchema,
    required_capabilities: requiredCapabilitiesSchema,
    required_context: requiredContextSchema.optional(),
    required_region_privacy: requiredRegionPrivacySchema.optional(),
    max_cost_budget: maxCostBudgetSchema.optional(),
    required_fallback_compatibility_tags: z.array(versionIdentifierSchema).max(64).default([]),
    allowed_profile_ids: z.array(immutableIdSchema).min(1),
    ordered_fallback_profile_ids: z.array(immutableIdSchema),
    max_attempts: z.number().int().positive().max(16),
  })
  .superRefine((request, ctx) => {
    const allowed = new Set(request.allowed_profile_ids);
    if (allowed.size !== request.allowed_profile_ids.length) {
      ctx.addIssue({
        code: "custom",
        message: "allowed_profile_ids 不能重复。",
        path: ["allowed_profile_ids"],
      });
    }
    const fallbacks = new Set(request.ordered_fallback_profile_ids);
    if (fallbacks.size !== request.ordered_fallback_profile_ids.length) {
      ctx.addIssue({
        code: "custom",
        message: "ordered_fallback_profile_ids 不能重复。",
        path: ["ordered_fallback_profile_ids"],
      });
    }
    if (
      request.ordered_fallback_profile_ids.length > 0 &&
      request.required_fallback_compatibility_tags.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        message: "显式 Fallback 必须声明可验证的兼容标签。",
        path: ["required_fallback_compatibility_tags"],
      });
    }
  });

export type ModelRoutingRequest = z.infer<typeof modelRoutingRequestSchema>;

export interface ModelRoutingDecision {
  readonly primary: AvailableModelProfile;
  readonly fallbacks: readonly AvailableModelProfile[];
  readonly attempt_limit: number;
  readonly reason_code: "CAPABILITY_ROUTE_MATCHED";
}

function scopesMatch(left: AppScope, right: AppScope): boolean {
  return (
    left.app_id === right.app_id &&
    left.tenant_id === right.tenant_id &&
    left.environment === right.environment
  );
}

function satisfiesCapabilities(
  profile: AvailableModelProfile,
  required: ModelRoutingRequest["required_capabilities"],
): boolean {
  return Object.entries(required).every(
    ([capability, value]) =>
      value === true &&
      profile.capabilities[capability as keyof AvailableModelProfile["capabilities"]] === true,
  );
}

interface ConstraintFailure {
  readonly code: ModelRuntimeErrorCode;
  readonly message: string;
}

function hasEveryTag(actual: readonly string[], required: readonly string[]): boolean {
  const actualTags = new Set(actual);
  return required.every((tag) => actualTags.has(tag));
}

function estimateCostMicrounits(
  inputTokens: number,
  outputTokens: number,
  inputRate: number,
  outputRate: number,
): bigint {
  const oneMillion = 1_000_000n;
  const inputCost = (BigInt(inputTokens) * BigInt(inputRate) + oneMillion - 1n) / oneMillion;
  const outputCost = (BigInt(outputTokens) * BigInt(outputRate) + oneMillion - 1n) / oneMillion;
  return inputCost + outputCost;
}

function constraintFailureFor(
  profile: AvailableModelProfile,
  request: ModelRoutingRequest,
): ConstraintFailure | null {
  if (!satisfiesCapabilities(profile, request.required_capabilities)) {
    return {
      code: "MODEL_CAPABILITY_NOT_SATISFIED",
      message: "Model Profile 不满足请求的行为 Capability。",
    };
  }

  if (request.required_context) {
    const constraint = profile.operational_constraints.context_window;
    const requiredTotal =
      BigInt(request.required_context.input_tokens) +
      BigInt(request.required_context.output_tokens);
    if (
      constraint.verification_status !== "VERIFIED" ||
      requiredTotal > BigInt(constraint.max_context_tokens) ||
      request.required_context.output_tokens > constraint.max_output_tokens
    ) {
      return {
        code: "MODEL_CONTEXT_WINDOW_NOT_SATISFIED",
        message: "Model Profile 的已验证 Context Window 不满足请求。",
      };
    }
  }

  if (request.required_region_privacy) {
    const constraint = profile.operational_constraints.region_privacy;
    if (
      constraint.verification_status !== "VERIFIED" ||
      !constraint.processing_regions.includes(request.required_region_privacy.processing_region) ||
      !hasEveryTag(constraint.privacy_tags, request.required_region_privacy.required_privacy_tags)
    ) {
      return {
        code: "MODEL_REGION_PRIVACY_NOT_SATISFIED",
        message: "Model Profile 的已验证 Region/Privacy 约束不满足请求。",
      };
    }
  }

  if (request.max_cost_budget) {
    const constraint = profile.operational_constraints.pricing;
    if (
      constraint.verification_status !== "VERIFIED" ||
      constraint.currency !== request.max_cost_budget.currency ||
      !request.required_context
    ) {
      return {
        code: "MODEL_COST_BUDGET_NOT_SATISFIED",
        message: "Model Profile 缺少可用于预算判定的已验证定价或 Token 需求。",
      };
    }
    const estimatedCost = estimateCostMicrounits(
      request.required_context.input_tokens,
      request.required_context.output_tokens,
      constraint.input_microunits_per_million_tokens,
      constraint.output_microunits_per_million_tokens,
    );
    if (estimatedCost > BigInt(request.max_cost_budget.max_microunits)) {
      return {
        code: "MODEL_COST_BUDGET_NOT_SATISFIED",
        message: "Model Profile 的保守成本估算超过请求预算。",
      };
    }
  }

  if (request.required_fallback_compatibility_tags.length > 0) {
    const constraint = profile.operational_constraints.fallback_compatibility;
    if (
      constraint.verification_status !== "VERIFIED" ||
      !hasEveryTag(constraint.tags, request.required_fallback_compatibility_tags)
    ) {
      return {
        code: "MODEL_FALLBACK_NOT_COMPATIBLE",
        message: "Model Profile 不满足已验证的 Fallback 兼容标签。",
      };
    }
  }

  return null;
}

export function routeAvailableModel(
  input: unknown,
  candidates: readonly AvailableModelProfile[],
): ModelRoutingDecision {
  const request = modelRoutingRequestSchema.parse(input);
  const allowedIds = new Set(request.allowed_profile_ids);
  const fallbackIds = new Set(request.ordered_fallback_profile_ids);
  for (const fallbackId of fallbackIds) {
    if (!allowedIds.has(fallbackId)) {
      throw new ModelRoutingError(
        "MODEL_PROFILE_NOT_ALLOWED",
        "Fallback Profile 未出现在显式允许列表。",
      );
    }
  }

  const profileById = new Map<string, AvailableModelProfile>();
  for (const profile of candidates) {
    if (!isAvailableModelProfile(profile)) {
      throw new ModelRoutingError(
        "MODEL_PROFILE_NOT_AUTHORIZED",
        "Model Router 只接受经过 Receipt Authority 授权的 AVAILABLE Profile。",
      );
    }
    if (!scopesMatch(request.scope, profile.scope)) {
      throw new ModelRoutingError(
        "MODEL_PROFILE_SCOPE_MISMATCH",
        "Model Profile 与 Routing Request Scope 不一致。",
      );
    }
    if (!allowedIds.has(profile.profile_id)) {
      throw new ModelRoutingError(
        "MODEL_PROFILE_NOT_ALLOWED",
        "Model Profile 未出现在显式允许列表。",
      );
    }
    if (profileById.has(profile.profile_id)) {
      throw new ModelRoutingError("DUPLICATE_MODEL_PROFILE", "Model Router 收到重复 Profile ID。");
    }
    profileById.set(profile.profile_id, profile);
  }

  for (const fallbackId of request.ordered_fallback_profile_ids) {
    const fallback = profileById.get(fallbackId);
    if (!fallback) {
      throw new ModelRoutingError(
        "MODEL_FALLBACK_NOT_COMPATIBLE",
        "显式 Fallback Profile 不存在或未取得 AVAILABLE 授权。",
      );
    }
    const failure = constraintFailureFor(fallback, request);
    if (failure) {
      throw new ModelRoutingError(failure.code, failure.message);
    }
  }

  const primaryIds = request.allowed_profile_ids.filter((profileId) => !fallbackIds.has(profileId));
  const routeIds = [...primaryIds, ...request.ordered_fallback_profile_ids];
  const matchingProfiles = routeIds
    .map((profileId) => profileById.get(profileId))
    .filter(
      (profile): profile is AvailableModelProfile =>
        profile !== undefined && constraintFailureFor(profile, request) === null,
    )
    .slice(0, request.max_attempts);
  const primary = matchingProfiles[0];
  if (!primary) {
    const firstFailure = routeIds
      .map((profileId) => profileById.get(profileId))
      .filter((profile): profile is AvailableModelProfile => profile !== undefined)
      .map((profile) => constraintFailureFor(profile, request))
      .find((failure): failure is ConstraintFailure => failure !== null);
    throw new ModelRoutingError(
      firstFailure?.code ?? "MODEL_CAPABILITY_NOT_SATISFIED",
      firstFailure?.message ?? "没有 AVAILABLE Profile 满足请求 Capability 与运行约束。",
    );
  }

  return Object.freeze({
    primary,
    fallbacks: Object.freeze(matchingProfiles.slice(1)),
    attempt_limit: Math.min(request.max_attempts, matchingProfiles.length),
    reason_code: "CAPABILITY_ROUTE_MATCHED",
  });
}
