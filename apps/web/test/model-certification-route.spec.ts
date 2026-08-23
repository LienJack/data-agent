import { NextRequest, NextResponse } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  record: vi.fn(),
  discover: vi.fn(),
  listModels: vi.fn(),
}));

vi.mock("@/lib/model-control-admin", () => ({
  authorizeModelControlAdminRequest: mocks.authorize,
  modelControlResultResponse: (result: { ok: boolean; value?: unknown; error?: unknown }) =>
    result.ok
      ? NextResponse.json({ data: result.value })
      : NextResponse.json({ error: result.error }, { status: 409 }),
}));
vi.mock("@/lib/model-discovery", () => ({
  fetchProviderModelCatalog: mocks.discover,
  ModelDiscoveryError: class ModelDiscoveryError extends Error {},
}));
vi.mock("@/lib/model-provider-admin", () => ({
  findEnvironmentProviderView: () => ({
    vendor_id: "deepseek",
    base_url: "https://api.deepseek.com",
  }),
  resolveEnvironmentProviderCredential: () => "server-secret",
}));

let POST: typeof import("../src/app/api/admin/models/[modelProfileId]/certifications/route").POST;

const modelProfileId = "30000000-0000-4000-8000-000000000003";
beforeAll(async () => {
  ({ POST } = await import("../src/app/api/admin/models/[modelProfileId]/certifications/route"));
});

beforeEach(() => {
  mocks.authorize.mockReset();
  mocks.record.mockReset();
  mocks.discover.mockReset();
  mocks.listModels.mockReset();
  mocks.listModels.mockResolvedValue({
    ok: true,
    value: [
      {
        model_profile_id: modelProfileId,
        config_version: 1,
        provider: "deepseek",
        model_id: "deepseek-v4-flash",
      },
    ],
  });
  mocks.discover.mockResolvedValue([{ id: "provider-model", displayName: "Provider Model" }]);
  mocks.record.mockResolvedValue({
    ok: true,
    value: {
      schema_version: "model-certification-view@1.0.0",
      model_profile_id: modelProfileId,
      model_config_version: 1,
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      state: "PASS",
      completed_at: "2026-08-18T00:00:00.000Z",
    },
  });
  mocks.authorize.mockResolvedValue({
    ok: true,
    value: {
      context: {
        deployment_id: "40000000-0000-4000-8000-000000000003",
        principal_id: "40000000-0000-4000-8000-000000000004",
      },
      repository: {
        listModels: mocks.listModels,
        recordModelAuthentication: mocks.record,
      },
    },
  });
});

function request(profileId = modelProfileId) {
  return new NextRequest(`http://localhost/api/admin/models/${profileId}/certifications`, {
    method: "POST",
    body: JSON.stringify({
      schema_version: "model-certification-start@1.0.0",
      model_profile_id: profileId,
      expected_config_version: 1,
      idempotency_key: "model-certification-route-test",
    }),
  });
}

describe("model certification admin route", () => {
  it("certifies after the provider returns a non-empty model directory", async () => {
    const response = await POST(request(), { params: Promise.resolve({ modelProfileId }) });
    expect(response.status).toBe(200);
    const command = mocks.record.mock.calls[0]?.[1];
    expect(command).toMatchObject({
      schema_version: "model-api-authentication@1.0.0",
      model_profile_id: modelProfileId,
      response_item_count: 1,
    });
    expect(JSON.stringify(await response.json())).not.toContain("API_KEY");
  });

  it("does not certify an empty provider response", async () => {
    mocks.discover.mockResolvedValueOnce([]);
    const response = await POST(request(), { params: Promise.resolve({ modelProfileId }) });
    expect(response.status).toBe(409);
    expect(mocks.record).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MODEL_CERTIFICATION_RESPONSE_EMPTY" },
    });
  });

  it("rejects path/body profile mismatch before authorization", async () => {
    const other = "30000000-0000-4000-8000-000000000005";
    const response = await POST(request(other), { params: Promise.resolve({ modelProfileId }) });
    expect(response.status).toBe(400);
    expect(mocks.authorize).not.toHaveBeenCalled();
  });

  it("returns the SUPER_ADMIN boundary response", async () => {
    mocks.authorize.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: { code: "SUPER_ADMIN_REQUIRED" } }, { status: 403 }),
    });
    const response = await POST(request(), { params: Promise.resolve({ modelProfileId }) });
    expect(response.status).toBe(403);
    expect(mocks.record).not.toHaveBeenCalled();
  });
});
