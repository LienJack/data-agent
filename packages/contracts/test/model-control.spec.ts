import { describe, expect, it } from "vitest";
import {
  modelCatalogEntrySchema,
  modelProviderConnectionSchema,
  upsertModelCatalogEntryInputSchema,
} from "../src/models/index.js";

const baseModel = {
  schema_version: "model-catalog-entry@1.0.0",
  app_id: "00000000-0000-4000-8000-00000000da01",
  environment: "test",
  model_profile_id: "00000000-0000-4000-8000-00000000a301",
  provider: "deepseek",
  model_id: "deepseek-chat",
  display_name: "DeepSeek Chat",
  base_url: "https://api.deepseek.com/v1",
  capabilities: {
    structured_output: true,
    tool_calling: true,
    streaming: true,
    reasoning: true,
    vision: false,
  },
  credential_ref: null,
  status: "ACTIVE",
  config_version: 1,
  is_system_default: true,
  created_by: "00000000-0000-4000-8000-000000001001",
  created_at: "2026-08-23T00:00:00.000Z",
  updated_at: "2026-08-23T00:00:00.000Z",
} as const;

describe("model control contracts", () => {
  it("projects technical model metadata without commercial fields", () => {
    const parsed = modelCatalogEntrySchema.parse(baseModel);

    expect(parsed).not.toHaveProperty("price");
    expect(parsed).not.toHaveProperty("currency");
    expect(parsed).not.toHaveProperty("credit");
    expect(parsed).not.toHaveProperty("bill");
  });

  it("rejects commercial fields at strict model and provider boundaries", () => {
    expect(modelCatalogEntrySchema.safeParse({ ...baseModel, status: "UNBILLABLE" }).success).toBe(
      false,
    );
    expect(modelCatalogEntrySchema.safeParse({ ...baseModel, unit_price: "1.00" }).success).toBe(
      false,
    );
    expect(
      upsertModelCatalogEntryInputSchema.safeParse({
        ...baseModel,
        schema_version: "model-catalog-upsert@1.0.0",
        operation_id: "00000000-0000-4000-8000-00000000a302",
        idempotency_key: "model-control-one",
        expected_config_version: 0,
        currency: "CNY",
      }).success,
    ).toBe(false);
    expect(
      modelProviderConnectionSchema.safeParse({
        schema_version: "model-provider-connection@1.0.0",
        app_id: baseModel.app_id,
        environment: baseModel.environment,
        provider_connection_id: "00000000-0000-4000-8000-00000000a303",
        vendor_id: "deepseek",
        runtime_provider: "deepseek",
        display_name: "DeepSeek",
        base_url: "https://api.deepseek.com/v1",
        credential_ref: null,
        source: "manual",
        status: "ACTIVE",
        health: "configured",
        config_version: 1,
        created_by: baseModel.created_by,
        created_at: baseModel.created_at,
        updated_at: baseModel.updated_at,
        fx_rate: "1.00",
      }).success,
    ).toBe(false);
  });
});
