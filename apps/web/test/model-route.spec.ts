import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  listActiveModels: vi.fn(),
  session: vi.fn(),
}));

vi.mock("@/lib/workspace-identity", () => ({
  getModelControlRepository: () => ({ listActiveModels: mocks.listActiveModels }),
  getWorkspaceDeploymentId: () => "00000000-0000-4000-8000-00000000de01",
  getWorkspaceSessionFromHeaders: mocks.session,
}));

const originalDeepSeek = process.env.DEEPSEEK_API_KEY;
const originalKimi = process.env.MOONSHOT_API_KEY;

let GET: typeof import("../src/app/api/models/route").GET;

beforeAll(async () => {
  process.env.DEEPSEEK_API_KEY = "deepseek-route-secret";
  process.env.MOONSHOT_API_KEY = "kimi-route-secret";
  ({ GET } = await import("../src/app/api/models/route"));
});

beforeEach(() => {
  mocks.session.mockReset();
  mocks.listActiveModels.mockReset();
  mocks.session.mockResolvedValue({
    ok: true,
    value: { principal_id: "00000000-0000-4000-8000-000000001001" },
  });
  mocks.listActiveModels.mockResolvedValue({ ok: true, value: [] });
});

afterAll(() => {
  if (originalDeepSeek === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalDeepSeek;
  if (originalKimi === undefined) delete process.env.MOONSHOT_API_KEY;
  else process.env.MOONSHOT_API_KEY = originalKimi;
});

describe("public model route", () => {
  it("returns immutable environment models with DeepSeek as the default", async () => {
    const response = await GET(new NextRequest("http://localhost/api/models"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "deepseek",
          source: "environment",
          isSystemModel: true,
          isSystemDefault: true,
        }),
        expect.objectContaining({
          provider: "kimi",
          source: "environment",
          isSystemModel: true,
          isSystemDefault: false,
        }),
      ]),
    );
    expect(JSON.stringify(payload)).not.toContain("deepseek-route-secret");
    expect(JSON.stringify(payload)).not.toContain("kimi-route-secret");
  });
});
