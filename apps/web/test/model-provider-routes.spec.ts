import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  applyProviderConnectionCommand: vi.fn(),
  listModels: vi.fn(),
  listProviderConnections: vi.fn(),
  session: vi.fn(),
}));

vi.mock("@/lib/workspace-identity", () => ({
  getModelControlRepository: () => ({
    applyProviderConnectionCommand: mocks.applyProviderConnectionCommand,
    listModels: mocks.listModels,
    listProviderConnections: mocks.listProviderConnections,
  }),
  getWorkspaceDeploymentId: () => "00000000-0000-4000-8000-00000000de01",
  getWorkspaceSessionFromHeaders: mocks.session,
}));

const originalDeepSeek = process.env.DEEPSEEK_API_KEY;
const originalGlm = process.env.ZAI_API_KEY;

let listOrCreate: typeof import("../src/app/api/admin/model-providers/route");
let mutate: typeof import("../src/app/api/admin/model-providers/[connectionId]/route");

beforeAll(async () => {
  process.env.DEEPSEEK_API_KEY = "provider-route-deepseek-secret";
  process.env.ZAI_API_KEY = "provider-route-glm-secret";
  listOrCreate = await import("../src/app/api/admin/model-providers/route");
  mutate = await import("../src/app/api/admin/model-providers/[connectionId]/route");
});

beforeEach(() => {
  mocks.applyProviderConnectionCommand.mockReset();
  mocks.listModels.mockReset();
  mocks.listProviderConnections.mockReset();
  mocks.session.mockReset();
  mocks.session.mockResolvedValue({
    ok: true,
    value: {
      principal_id: "00000000-0000-4000-8000-000000001001",
      system_role: "SUPER_ADMIN",
    },
  });
  mocks.listModels.mockResolvedValue({ ok: true, value: [] });
  mocks.listProviderConnections.mockResolvedValue({ ok: true, value: [] });
});

afterAll(() => {
  if (originalDeepSeek === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalDeepSeek;
  if (originalGlm === undefined) delete process.env.ZAI_API_KEY;
  else process.env.ZAI_API_KEY = originalGlm;
});

describe("model provider admin routes", () => {
  it("returns immutable environment suppliers without exposing credentials", async () => {
    const response = await listOrCreate.GET(
      new NextRequest("http://localhost/api/admin/model-providers"),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ vendor_id: "deepseek", immutable: true }),
        expect.objectContaining({ vendor_id: "glm", immutable: true }),
      ]),
    );
    expect(JSON.stringify(payload)).not.toContain("provider-route-deepseek-secret");
    expect(JSON.stringify(payload)).not.toContain("provider-route-glm-secret");
  });

  it("rejects plaintext credential fields before the repository boundary", async () => {
    const response = await listOrCreate.POST(
      new NextRequest("http://localhost/api/admin/model-providers", {
        method: "POST",
        body: JSON.stringify({
          schema_version: "model-provider-upsert@1.0.0",
          operation_id: "00000000-0000-4000-8000-000000000101",
          idempotency_key: "plaintext-provider-rejected",
          provider_connection_id: "00000000-0000-4000-8000-000000000102",
          vendor_id: "deepseek",
          runtime_provider: "deepseek",
          display_name: "DeepSeek Manual",
          base_url: "https://api.deepseek.com/v1",
          credential_ref: null,
          api_key: "must-not-cross-boundary",
          expected_config_version: 0,
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MODEL_PROVIDER_COMMAND_INVALID" },
    });
    expect(mocks.applyProviderConnectionCommand).not.toHaveBeenCalled();
  });

  it("refuses to delete an environment-projected GLM supplier", async () => {
    const connectionId = "30000000-0000-4000-8000-000000000004";
    const response = await mutate.DELETE(
      new NextRequest(`http://localhost/api/admin/model-providers/${connectionId}`, {
        method: "DELETE",
        body: JSON.stringify({
          schema_version: "model-provider-archive@1.0.0",
          operation_id: "00000000-0000-4000-8000-000000000103",
          idempotency_key: "archive-glm-environment",
          provider_connection_id: connectionId,
          expected_config_version: 1,
          reason: "should be rejected",
        }),
      }),
      { params: Promise.resolve({ connectionId }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "SYSTEM_MODEL_IMMUTABLE" },
    });
    expect(mocks.applyProviderConnectionCommand).not.toHaveBeenCalled();
  });
});
