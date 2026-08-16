import { MODEL_PROVIDER_BINDINGS } from "@data-agent/agent-runtime";
import { describe, expect, it } from "vitest";
import {
  getModelProviderCatalogItem,
  MODEL_PROVIDER_CATALOG,
  NATIVE_MODEL_PROVIDER_CATALOG,
  ORDERED_MODEL_PROVIDER_CATALOG,
} from "../src/lib/model-provider-catalog";

describe("model provider catalog", () => {
  it("stays aligned with the runtime provider order and deployment defaults", () => {
    expect(
      NATIVE_MODEL_PROVIDER_CATALOG.map((provider) => ({
        provider: provider.runtimeProvider,
        defaultModelId: provider.models[0]?.id,
      })),
    ).toEqual(
      MODEL_PROVIDER_BINDINGS.map((binding) => ({
        provider: binding.provider,
        defaultModelId: binding.default_model_id,
      })),
    );
  });

  it("routes third-party platforms through explicit OpenAI-compatible endpoints", () => {
    expect(getModelProviderCatalogItem("volcengine")).toMatchObject({
      runtimeProvider: "openai",
      group: "third-party",
      defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    });
    expect(getModelProviderCatalogItem("siliconflow")).toMatchObject({
      runtimeProvider: "openai",
      group: "third-party",
      defaultBaseUrl: "https://api.siliconflow.cn/v1",
    });
  });

  it("presents DeepSeek, Kimi and GLM before the remaining API suppliers", () => {
    expect(ORDERED_MODEL_PROVIDER_CATALOG.slice(0, 3).map((provider) => provider.id)).toEqual([
      "deepseek",
      "kimi",
      "glm",
    ]);
  });

  it("uses local brand SVGs for every named model supplier", () => {
    const namedSuppliers = MODEL_PROVIDER_CATALOG.filter(
      (provider) => provider.id !== "openai-compatible",
    );

    expect(
      namedSuppliers.every((provider) => provider.iconPath?.startsWith("/provider-icons/")),
    ).toBe(true);
    expect(getModelProviderCatalogItem("openai-compatible").iconPath).toBeUndefined();
  });
});
