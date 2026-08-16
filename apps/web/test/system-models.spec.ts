import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let discoverSystemModels: typeof import("../src/lib/system-models").discoverSystemModels;
let configureSystemModelRuntimeEnvironment: typeof import("../src/lib/system-models").configureSystemModelRuntimeEnvironment;
let createEnvironmentModelCatalogSyncInput: typeof import("../src/lib/system-models").createEnvironmentModelCatalogSyncInput;
let mergeSystemModelsWithCatalog: typeof import("../src/lib/system-models").mergeSystemModelsWithCatalog;
let resolveSystemModelCredential: typeof import("../src/lib/system-models").resolveSystemModelCredential;

beforeAll(async () => {
  ({
    discoverSystemModels,
    configureSystemModelRuntimeEnvironment,
    createEnvironmentModelCatalogSyncInput,
    mergeSystemModelsWithCatalog,
    resolveSystemModelCredential,
  } = await import("../src/lib/system-models"));
});

describe("environment system models", () => {
  it("discovers both root .env aliases with stable public profiles", () => {
    const models = discoverSystemModels(
      { DeepSeekAPIKey: "deepseek-secret", KimiAPIKey: "kimi-secret" },
      "2026-08-10T00:00:00.000Z",
    );

    expect(models.map((model) => model.profile.provider)).toEqual(["deepseek", "kimi"]);
    expect(models[0]?.profile).toMatchObject({
      id: "30000000-0000-4000-8000-000000000003",
      modelName: "deepseek-v4-pro",
      isSystemDefault: true,
      apiKeyMasked: "由环境变量托管",
    });
    expect(models[1]?.profile).toMatchObject({
      id: "30000000-0000-4000-8000-000000000005",
      modelName: "kimi-k3",
      isSystemDefault: false,
    });
    expect(JSON.stringify(models.map((model) => model.profile))).not.toContain("secret");
  });

  it("prefers standard names and skips unconfigured providers", () => {
    const models = discoverSystemModels({
      DEEPSEEK_API_KEY: "standard",
      DeepSeekAPIKey: "legacy",
    });

    expect(models).toHaveLength(1);
    expect(models[0]?.credential).toBe("standard");
    expect(
      resolveSystemModelCredential("deepseek", {
        DEEPSEEK_API_KEY: "standard",
        DeepSeekAPIKey: "legacy",
      }),
    ).toBe("standard");
  });

  it("discovers GLM from its environment projection after DeepSeek and Kimi priority", () => {
    const models = discoverSystemModels({
      DeepSeekAPIKey: "deepseek-secret",
      KimiAPIKey: "kimi-secret",
      ZAI_API_KEY: "glm-secret",
    });

    expect(models.map((model) => model.profile.provider)).toEqual(["deepseek", "kimi", "glm"]);
    expect(models[2]?.profile).toMatchObject({
      id: "30000000-0000-4000-8000-000000000004",
      modelName: "glm-5.2",
      isSystemDefault: false,
      apiKeyMasked: "由环境变量托管",
    });
    expect(JSON.stringify(models.map((model) => model.profile))).not.toContain("glm-secret");
  });

  it("configures DeepSeek as the default Test Center deployment without secrets", () => {
    const environment = {
      NODE_ENV: "test",
      DEEPSEEK_API_KEY: "deepseek-secret",
      MOONSHOT_API_KEY: "kimi-secret",
    } as NodeJS.ProcessEnv;

    configureSystemModelRuntimeEnvironment(environment);

    expect(environment.TEST_CENTER_MODEL_PROVIDER).toBe("deepseek");
    expect(environment.DATA_AGENT_MODEL_PROVIDER_OVERRIDES).toContain("deepseek-v4-pro");
    expect(environment.DATA_AGENT_MODEL_PROVIDER_OVERRIDES).toContain("kimi-k3");
    expect(environment.DATA_AGENT_MODEL_PROVIDER_OVERRIDES).not.toContain("secret");
    const overrides = JSON.parse(environment.DATA_AGENT_MODEL_PROVIDER_OVERRIDES ?? "[]") as Array<{
      provider: string;
      operational_constraints?: { pricing: { currency: string } };
    }>;
    expect(overrides[0]).toMatchObject({
      provider: "deepseek",
      operational_constraints: { pricing: { currency: "USD" } },
    });
  });

  it("projects configured environment models into a secret-free database sync command", () => {
    const models = discoverSystemModels({
      DEEPSEEK_API_KEY: "deepseek-secret",
      MOONSHOT_API_KEY: "kimi-secret",
    });

    const command = createEnvironmentModelCatalogSyncInput(models);

    expect(command.models.map((model) => model.provider)).toEqual(["deepseek", "kimi"]);
    expect(command.models[0]).toMatchObject({
      model_profile_id: "30000000-0000-4000-8000-000000000003",
      model_id: "deepseek-v4-pro",
      is_system_default: true,
    });
    expect(JSON.stringify(command)).not.toContain("deepseek-secret");
    expect(JSON.stringify(command)).not.toContain("kimi-secret");
  });

  it("keeps DeepSeek as the only default when environment and catalog models are merged", () => {
    const systemModels = discoverSystemModels(
      { DEEPSEEK_API_KEY: "deepseek-secret", MOONSHOT_API_KEY: "kimi-secret" },
      "2026-08-10T00:00:00.000Z",
    );
    const models = mergeSystemModelsWithCatalog(systemModels, [
      {
        id: "30000000-0000-4000-8000-000000000003",
        name: "重复的 DeepSeek 目录模型",
        vendorId: "deepseek",
        provider: "deepseek",
        modelName: "deepseek-v4-pro",
        source: "manual",
        isSystemModel: false,
        isSystemDefault: true,
        connectionStatus: "unchecked",
        apiKeyMasked: "未配置",
        baseUrl: "https://api.deepseek.com",
        createdAt: "2026-08-10T00:00:00.000Z",
        updatedAt: "2026-08-10T00:00:00.000Z",
      },
      {
        id: "40000000-0000-4000-8000-000000000001",
        name: "目录默认模型",
        vendorId: "openai",
        provider: "openai",
        modelName: "gpt-5.4-mini",
        source: "manual",
        isSystemModel: false,
        isSystemDefault: true,
        connectionStatus: "configured",
        apiKeyMasked: "SecretRef 已配置",
        baseUrl: "https://api.openai.com/v1",
        createdAt: "2026-08-10T00:00:00.000Z",
        updatedAt: "2026-08-10T00:00:00.000Z",
      },
    ]);

    expect(models.map((model) => model.provider)).toEqual(["deepseek", "kimi", "openai"]);
    expect(models.filter((model) => model.isSystemDefault).map((model) => model.provider)).toEqual([
      "deepseek",
    ]);
    expect(models.filter((model) => model.isSystemModel).map((model) => model.provider)).toEqual([
      "deepseek",
      "kimi",
    ]);
    expect(JSON.stringify(models)).not.toContain("secret");
  });
});
