/**
 * Opt-in deployment overrides for the repository-root system models.
 *
 * DeepSeek source checked 2026-08-10:
 * https://api-docs.deepseek.com/quick_start/pricing/
 * Kimi remains operationally unverified here because its public price is CNY
 * while the current Test Center budget contract requires USD.
 */
export const SYSTEM_MODEL_DEPLOYMENT_OVERRIDES = Object.freeze([
  Object.freeze({
    provider: "deepseek" as const,
    model_id: "deepseek-v4-pro",
    operational_constraints: Object.freeze({
      context_window: Object.freeze({
        verification_status: "VERIFIED" as const,
        max_context_tokens: 1_000_000,
        max_output_tokens: 384_000,
      }),
      region_privacy: Object.freeze({ verification_status: "UNVERIFIED" as const }),
      pricing: Object.freeze({
        verification_status: "VERIFIED" as const,
        currency: "USD",
        input_microunits_per_million_tokens: 435_000,
        output_microunits_per_million_tokens: 870_000,
      }),
      fallback_compatibility: Object.freeze({ verification_status: "UNVERIFIED" as const }),
    }),
  }),
  Object.freeze({
    provider: "kimi" as const,
    model_id: "kimi-k3",
  }),
]);
