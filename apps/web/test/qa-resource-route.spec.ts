import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ids = {
  workspace: "00000000-0000-4000-8000-00000000aa01",
  principal: "00000000-0000-4000-8000-000000001001",
  deployment: "00000000-0000-4000-8000-00000000de01",
  profile: "30000000-0000-4000-8000-000000000003",
} as const;

const systemModel = {
  profile: {
    id: ids.profile,
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
  capabilities: {
    structured_output: true,
    tool_calling: true,
    streaming: true,
    reasoning: true,
    vision: false,
  },
  credential: "must-never-cross-route-boundary",
};

const catalogModel = {
  schema_version: "model-catalog-entry@1.0.0" as const,
  app_id: "00000000-0000-4000-8000-00000000da01",
  environment: "local",
  model_profile_id: ids.profile,
  provider: "deepseek" as const,
  model_id: "deepseek-v4-pro",
  display_name: "DeepSeek 系统模型",
  base_url: "https://api.deepseek.com",
  capabilities: systemModel.capabilities,
  credential_ref: null,
  status: "ACTIVE" as const,
  config_version: 1,
  is_system_default: true,
  created_by: ids.principal,
  created_at: "2026-08-16T00:00:00.000Z",
  updated_at: "2026-08-16T00:00:00.000Z",
};

const mocks = vi.hoisted(() => ({
  syncEnvironmentModels: vi.fn(),
  listDatasources: vi.fn(),
}));

vi.mock("@/lib/system-models", () => ({
  resolveSystemModelsFromProcess: () => [systemModel],
  createEnvironmentModelCatalogSyncInput: () => ({
    schema_version: "environment-model-catalog-sync@1.0.0",
    models: [
      {
        model_profile_id: systemModel.profile.id,
        provider: systemModel.profile.provider,
        model_id: systemModel.profile.modelName,
        display_name: systemModel.profile.name,
        base_url: systemModel.profile.baseUrl,
        capabilities: systemModel.capabilities,
        is_system_default: true,
      },
    ],
  }),
}));

vi.mock("@/lib/workspace-request", () => ({
  authorizeWorkspaceRequest: vi.fn().mockResolvedValue({
    ok: true,
    value: {
      session: { principal_id: ids.principal },
      capability: { principal: ids.principal },
    },
  }),
  workspaceErrorResponse: vi.fn(),
}));

vi.mock("@/lib/workspace-identity", () => ({
  getPricingControlRepository: () => ({
    syncEnvironmentModels: mocks.syncEnvironmentModels,
  }),
  getWorkspaceDataRepository: () => ({ listDatasources: mocks.listDatasources }),
  getWorkspaceDeploymentId: () => ids.deployment,
}));

let GET: typeof import("../src/app/api/workspaces/[workspaceId]/qa/resources/route").GET;

beforeAll(async () => {
  ({ GET } = await import("../src/app/api/workspaces/[workspaceId]/qa/resources/route"));
});

beforeEach(() => {
  mocks.syncEnvironmentModels.mockReset();
  mocks.listDatasources.mockReset();
  mocks.syncEnvironmentModels.mockResolvedValue({ ok: true, value: [catalogModel] });
  mocks.listDatasources.mockResolvedValue({ ok: true, value: [] });
});

describe("Q&A resource route", () => {
  it("syncs environment profiles before returning a runnable secret-free model", async () => {
    const response = await GET(
      new NextRequest(`http://localhost/api/workspaces/${ids.workspace}/qa/resources`),
      { params: Promise.resolve({ workspaceId: ids.workspace }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.models).toEqual([
      expect.objectContaining({
        model_profile_id: ids.profile,
        readiness: "RUNNABLE",
        selectable: true,
      }),
    ]);
    expect(mocks.syncEnvironmentModels).toHaveBeenCalledOnce();
    expect(JSON.stringify(mocks.syncEnvironmentModels.mock.calls)).not.toContain(
      systemModel.credential,
    );
    expect(JSON.stringify(payload)).not.toContain(systemModel.credential);
  });
});
