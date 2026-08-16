/**
 * Opt-in deployment overrides for the repository-root system models.
 *
 * DeepSeek V4 Flash identity/context limits are deployment evidence; pricing
 * remains deliberately UNVERIFIED and is not part of U3 execution readiness.
 * Kimi remains operationally unverified here because its public price is CNY
 * while the current Test Center budget contract requires USD.
 */
export const SYSTEM_MODEL_DEPLOYMENT_OVERRIDES = Object.freeze([
  Object.freeze({
    provider: "deepseek" as const,
    model_id: "deepseek-v4-flash",
    operational_constraints: Object.freeze({
      context_window: Object.freeze({
        verification_status: "VERIFIED" as const,
        max_context_tokens: 1_000_000,
        max_output_tokens: 384_000,
      }),
      region_privacy: Object.freeze({ verification_status: "UNVERIFIED" as const }),
      pricing: Object.freeze({ verification_status: "UNVERIFIED" as const }),
      fallback_compatibility: Object.freeze({ verification_status: "UNVERIFIED" as const }),
    }),
  }),
  Object.freeze({
    provider: "kimi" as const,
    model_id: "kimi-k3",
  }),
]);
