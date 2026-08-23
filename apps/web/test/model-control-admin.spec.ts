import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  repository: { listModels: vi.fn() },
}));

vi.mock("@/lib/workspace-identity", () => ({
  getModelControlRepository: () => mocks.repository,
  getWorkspaceDeploymentId: () => "00000000-0000-4000-8000-00000000de01",
  getWorkspaceSessionFromHeaders: mocks.session,
}));

let authorizeModelControlAdminRequest: typeof import("../src/lib/model-control-admin").authorizeModelControlAdminRequest;

beforeAll(async () => {
  ({ authorizeModelControlAdminRequest } = await import("../src/lib/model-control-admin"));
});

beforeEach(() => {
  mocks.session.mockReset();
});

describe("model control admin request guard", () => {
  it("rejects a database-resolved non-super-admin before repository access", async () => {
    mocks.session.mockResolvedValue({
      ok: true,
      value: {
        principal_id: "00000000-0000-4000-8000-000000001001",
        system_role: "USER",
      },
    });
    const result = await authorizeModelControlAdminRequest(
      new NextRequest("http://localhost/api/admin/models"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
      await expect(result.response.json()).resolves.toMatchObject({
        error: { code: "SUPER_ADMIN_REQUIRED" },
      });
    }
  });

  it("passes only the server session principal into the database repository context", async () => {
    mocks.session.mockResolvedValue({
      ok: true,
      value: {
        principal_id: "00000000-0000-4000-8000-000000001001",
        system_role: "SUPER_ADMIN",
      },
    });
    const result = await authorizeModelControlAdminRequest(
      new NextRequest("http://localhost/api/admin/models", {
        headers: { "x-system-role": "USER", "x-principal-id": "attacker" },
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        context: {
          deployment_id: "00000000-0000-4000-8000-00000000de01",
          principal_id: "00000000-0000-4000-8000-000000001001",
        },
      },
    });
  });
});
