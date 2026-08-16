import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const originalDeepSeek = process.env.DEEPSEEK_API_KEY;
const originalKimi = process.env.MOONSHOT_API_KEY;

let listModels: typeof import("../src/lib/model-store").listModels;
let createManualModel: typeof import("../src/lib/model-store").createManualModel;
let deleteModelConfig: typeof import("../src/lib/model-store").deleteModelConfig;

beforeAll(async () => {
  process.env.DEEPSEEK_API_KEY = "deepseek-test-secret";
  process.env.MOONSHOT_API_KEY = "kimi-test-secret";
  ({ listModels, createManualModel, deleteModelConfig } = await import("../src/lib/model-store"));
});

afterAll(() => {
  if (originalDeepSeek === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalDeepSeek;
  if (originalKimi === undefined) delete process.env.MOONSHOT_API_KEY;
  else process.env.MOONSHOT_API_KEY = originalKimi;
});

describe("model API projection secret boundary", () => {
  it("lists generated system profiles without returning credentials", () => {
    const payload = JSON.stringify(listModels());

    expect(payload).toContain("deepseek-v4-flash");
    expect(payload).toContain("kimi-k3");
    expect(payload).not.toContain("deepseek-test-secret");
    expect(payload).not.toContain("kimi-test-secret");
  });

  it("never echoes a manually submitted credential", () => {
    const model = createManualModel({
      name: "manual-test-model",
      apiKey: "manual-test-secret",
      baseUrl: "https://example.test/v1",
    });
    const payload = JSON.stringify(model);

    expect(payload).not.toContain("manual-test-secret");
    expect(payload).toContain("manu…cret");
  });

  it("preserves the third-party platform identity and compatible runtime", () => {
    const model = createManualModel({
      name: "火山方舟测试",
      vendorId: "volcengine",
      provider: "openai",
      modelName: "ep-test-deployment",
      apiKey: "volcengine-test-secret",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3/",
    });

    expect(model).toMatchObject({
      vendorId: "volcengine",
      provider: "openai",
      modelName: "ep-test-deployment",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    });
    expect(JSON.stringify(model)).not.toContain("volcengine-test-secret");
  });

  it("refuses to delete an environment-managed system model", () => {
    expect(deleteModelConfig("30000000-0000-4000-8000-000000000003")).toBe("system_model");
  });
});
