import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildQaResourceCatalog } from "../src/lib/qa-resource-catalog";

const systemModel = {
  profile: {
    id: "30000000-0000-4000-8000-000000000003",
    name: "DeepSeek 系统模型",
    vendorId: "deepseek" as const,
    provider: "deepseek" as const,
    modelName: "deepseek-v4-pro",
    source: "environment" as const,
    isSystemModel: true,
    isSystemDefault: true,
    connectionStatus: "configured" as const,
    apiKeyMasked: "由环境变量托管",
    baseUrl: "https://api.deepseek.com",
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
  },
  credential: "must-never-appear",
};

describe("Q&A resource catalog", () => {
  it("shows configured environment models as unbillable until authority publishes a catalog version", () => {
    const catalog = buildQaResourceCatalog({ models: [], datasources: [] }, [systemModel]);

    expect(catalog.models).toEqual([
      expect.objectContaining({
        model_profile_id: systemModel.profile.id,
        readiness: "UNBILLABLE",
        selectable: false,
      }),
    ]);
    expect(JSON.stringify(catalog)).not.toContain(systemModel.credential);
  });
});
