import { describe, expect, it } from "vitest";
import {
  archiveModelProviderConnectionInputSchema,
  modelProviderConnectionSchema,
  modelProviderSelectionInputSchema,
  syncEnvironmentModelCatalogInputSchema,
  upsertModelProviderConnectionInputSchema,
} from "../src/models/index.js";

const ids = {
  app: "00000000-0000-4000-8000-00000000da01",
  principal: "00000000-0000-4000-8000-000000001001",
  connection: "00000000-0000-4000-8000-00000000c101",
  profile: "00000000-0000-4000-8000-00000000c102",
  operation: "00000000-0000-4000-8000-00000000c103",
} as const;

const capabilities = {
  structured_output: true,
  tool_calling: true,
  streaming: true,
  reasoning: true,
  vision: false,
};

describe("model provider connection contracts", () => {
  it("parses a secret-free manual connection projection", () => {
    expect(
      modelProviderConnectionSchema.parse({
        schema_version: "model-provider-connection@1.0.0",
        app_id: ids.app,
        environment: "test",
        provider_connection_id: ids.connection,
        vendor_id: "siliconflow",
        runtime_provider: "openai",
        display_name: "硅基流动主账号",
        base_url: "https://api.siliconflow.cn/v1",
        credential_ref: null,
        source: "manual",
        status: "ACTIVE",
        health: "untested",
        config_version: 1,
        created_by: ids.principal,
        created_at: "2026-08-16T00:00:00.000Z",
        updated_at: "2026-08-16T00:00:00.000Z",
      }),
    ).toMatchObject({ vendor_id: "siliconflow", runtime_provider: "openai" });
  });

  it("requires optimistic versions for update, archive and multi-model selection", () => {
    expect(
      upsertModelProviderConnectionInputSchema.parse({
        schema_version: "model-provider-upsert@1.0.0",
        operation_id: ids.operation,
        idempotency_key: "provider-upsert-one",
        provider_connection_id: ids.connection,
        vendor_id: "deepseek",
        runtime_provider: "deepseek",
        display_name: "DeepSeek 备用连接",
        base_url: "https://api.deepseek.com",
        credential_ref: null,
        expected_config_version: 0,
      }).expected_config_version,
    ).toBe(0);

    expect(
      archiveModelProviderConnectionInputSchema.safeParse({
        schema_version: "model-provider-archive@1.0.0",
        operation_id: ids.operation,
        idempotency_key: "provider-archive-one",
        provider_connection_id: ids.connection,
        expected_config_version: 0,
        reason: "不再使用",
      }).success,
    ).toBe(false);

    expect(
      modelProviderSelectionInputSchema.parse({
        schema_version: "model-provider-selection@1.0.0",
        operation_id: ids.operation,
        idempotency_key: "provider-selection-one",
        provider_connection_id: ids.connection,
        expected_connection_version: 1,
        models: [
          {
            model_profile_id: ids.profile,
            model_id: "deepseek-chat",
            display_name: "DeepSeek Chat",
            capabilities,
            enabled: true,
            expected_config_version: 0,
          },
        ],
      }).models,
    ).toHaveLength(1);
  });

  it("rejects plaintext credential-shaped fields", () => {
    const payload = {
      schema_version: "model-provider-upsert@1.0.0",
      operation_id: ids.operation,
      idempotency_key: "provider-upsert-two",
      provider_connection_id: ids.connection,
      vendor_id: "openai",
      runtime_provider: "openai",
      display_name: "OpenAI",
      base_url: "https://api.openai.com/v1",
      credential_ref: null,
      expected_config_version: 0,
      api_key: "do-not-store",
    };
    expect(upsertModelProviderConnectionInputSchema.safeParse(payload).success).toBe(false);
  });

  it("accepts only secret-free environment model catalog projections", () => {
    const input = {
      schema_version: "environment-model-catalog-sync@1.0.0",
      models: [
        {
          model_profile_id: "30000000-0000-4000-8000-000000000003",
          provider: "deepseek",
          model_id: "deepseek-v4-flash",
          display_name: "DeepSeek 系统模型",
          base_url: "https://api.deepseek.com",
          capabilities,
          is_system_default: true,
        },
      ],
    };

    expect(syncEnvironmentModelCatalogInputSchema.parse(input).models).toHaveLength(1);
    expect(
      syncEnvironmentModelCatalogInputSchema.safeParse({
        ...input,
        models: [{ ...input.models[0], api_key: "must-not-cross-boundary" }],
      }).success,
    ).toBe(false);
    expect(
      syncEnvironmentModelCatalogInputSchema.safeParse({
        ...input,
        models: [input.models[0], { ...input.models[0], model_profile_id: ids.connection }],
      }).success,
    ).toBe(false);
    expect(
      syncEnvironmentModelCatalogInputSchema.safeParse({
        ...input,
        models: [{ ...input.models[0], base_url: "http://api.deepseek.com" }],
      }).success,
    ).toBe(false);
  });
});
