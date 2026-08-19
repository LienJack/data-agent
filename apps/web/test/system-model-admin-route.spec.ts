import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  applyModelCommand: vi.fn(),
  session: vi.fn(),
}));

vi.mock("@/lib/workspace-identity", () => ({
  getPricingControlRepository: () => ({ applyModelCommand: mocks.applyModelCommand }),
  getWorkspaceDeploymentId: () => "00000000-0000-4000-8000-00000000de01",
  getWorkspaceSessionFromHeaders: mocks.session,
}));

const originalDeepSeek = process.env.DEEPSEEK_API_KEY;
const originalKimi = process.env.MOONSHOT_API_KEY;

let createModel: typeof import("../src/app/api/admin/models/route").POST;
let updateModelStatus: typeof import("../src/app/api/admin/models/[modelProfileId]/status/route").POST;

beforeAll(async () => {
  process.env.DEEPSEEK_API_KEY = "deepseek-admin-route-secret";
  process.env.MOONSHOT_API_KEY = "kimi-admin-route-secret";
  ({ POST: createModel } = await import("../src/app/api/admin/models/route"));
  ({ POST: updateModelStatus } = await import(
    "../src/app/api/admin/models/[modelProfileId]/status/route"
  ));
});

beforeEach(() => {
  mocks.applyModelCommand.mockReset();
  mocks.session.mockReset();
  mocks.session.mockResolvedValue({
    ok: true,
    value: {
      principal_id: "00000000-0000-4000-8000-000000001001",
      system_role: "SUPER_ADMIN",
    },
  });
});

afterAll(() => {
  if (originalDeepSeek === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalDeepSeek;
  if (originalKimi === undefined) delete process.env.MOONSHOT_API_KEY;
  else process.env.MOONSHOT_API_KEY = originalKimi;
});

describe("environment system model admin boundary", () => {
  it("refuses to overwrite the DeepSeek system profile", async () => {
    const response = await createModel(
      new NextRequest("http://localhost/api/admin/models", {
        method: "POST",
        body: JSON.stringify({
          schema_version: "model-catalog-upsert@1.0.0",
          operation_id: "00000000-0000-4000-8000-000000000101",
          idempotency_key: "system-model-overwrite",
          model_profile_id: "30000000-0000-4000-8000-000000000003",
          provider: "deepseek",
          model_id: "replacement-model",
          display_name: "伪造的 DeepSeek",
          base_url: "https://example.test/v1",
          capabilities: {
            structured_output: true,
            tool_calling: true,
            streaming: true,
            reasoning: true,
            vision: false,
          },
          credential_ref: null,
          status: "ACTIVE",
          is_system_default: false,
          expected_config_version: 0,
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "SYSTEM_MODEL_IMMUTABLE" },
    });
    expect(mocks.applyModelCommand).not.toHaveBeenCalled();
  });

  it("refuses to disable the Kimi system profile", async () => {
    const modelProfileId = "30000000-0000-4000-8000-000000000005";
    const response = await updateModelStatus(
      new NextRequest(`http://localhost/api/admin/models/${modelProfileId}/status`, {
        method: "POST",
        body: JSON.stringify({
          schema_version: "model-catalog-status@1.0.0",
          operation_id: "00000000-0000-4000-8000-000000000102",
          idempotency_key: "system-model-disable",
          model_profile_id: modelProfileId,
          status: "DISABLED",
          expected_config_version: 1,
        }),
      }),
      { params: Promise.resolve({ modelProfileId }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "SYSTEM_MODEL_IMMUTABLE" },
    });
    expect(mocks.applyModelCommand).not.toHaveBeenCalled();
  });
});
