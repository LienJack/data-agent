import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  capability: vi.fn(),
  repository: {
    listUsers: vi.fn(),
    listWorkspaces: vi.fn(),
    listWorkspaceMembers: vi.fn(),
    readHealth: vi.fn(),
  },
}));

vi.mock("@/lib/workspace-identity", () => ({
  getOperationsAdminRepository: () => mocks.repository,
  getWorkspaceDeploymentId: () => "00000000-0000-4000-8000-00000000de01",
  getWorkspaceSessionFromHeaders: mocks.session,
  resolveSessionWorkspaceCapability: mocks.capability,
}));

let authorizeOperationsAdminRequest: typeof import("../src/lib/operations-admin").authorizeOperationsAdminRequest;
let authorizeWorkspaceMembersRequest: typeof import("../src/lib/operations-admin").authorizeWorkspaceMembersRequest;

beforeAll(async () => {
  ({ authorizeOperationsAdminRequest, authorizeWorkspaceMembersRequest } = await import(
    "../src/lib/operations-admin"
  ));
});

beforeEach(() => {
  mocks.session.mockReset();
  mocks.capability.mockReset().mockResolvedValue({
    ok: true,
    value: { role: "OWNER" },
  });
});

describe("operations admin request guards", () => {
  it("rejects non-super-admin access before exposing global administration", async () => {
    mocks.session.mockResolvedValue({
      ok: true,
      value: {
        principal_id: "00000000-0000-4000-8000-000000001001",
        system_role: "USER",
      },
    });
    const result = await authorizeOperationsAdminRequest(
      new NextRequest("http://localhost/api/admin/operations/users"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
      await expect(result.response.json()).resolves.toMatchObject({
        error: { code: "SUPER_ADMIN_REQUIRED" },
      });
    }
  });

  it("derives the admin repository context only from the database session", async () => {
    mocks.session.mockResolvedValue({
      ok: true,
      value: {
        principal_id: "00000000-0000-4000-8000-000000001001",
        system_role: "SUPER_ADMIN",
      },
    });
    const result = await authorizeOperationsAdminRequest(
      new NextRequest("http://localhost/api/admin/operations/users", {
        headers: { "x-principal-id": "attacker", "x-system-role": "USER" },
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

  it("passes workspace identity to the database-revalidated member boundary", async () => {
    mocks.session.mockResolvedValue({
      ok: true,
      value: {
        principal_id: "00000000-0000-4000-8000-000000001002",
        system_role: "USER",
      },
    });
    const workspaceId = "00000000-0000-4000-8000-00000000aa11";
    const result = await authorizeWorkspaceMembersRequest(
      new NextRequest(`http://localhost/api/workspaces/${workspaceId}/members`),
      workspaceId,
    );
    expect(result).toMatchObject({
      ok: true,
      value: {
        context: {
          principal_id: "00000000-0000-4000-8000-000000001002",
          workspace_id: workspaceId,
        },
      },
    });
    expect(mocks.capability).toHaveBeenCalledWith(
      expect.objectContaining({ principal_id: "00000000-0000-4000-8000-000000001002" }),
      workspaceId,
      "WRITE",
    );
  });

  it.each(["ANALYST", "VIEWER"] as const)(
    "rejects the %s workspace role before exposing the member repository",
    async (role) => {
      mocks.session.mockResolvedValue({
        ok: true,
        value: {
          principal_id: "00000000-0000-4000-8000-000000001002",
          system_role: "USER",
        },
      });
      mocks.capability.mockResolvedValue({ ok: true, value: { role } });

      const result = await authorizeWorkspaceMembersRequest(
        new NextRequest(
          "http://localhost/api/workspaces/00000000-0000-4000-8000-00000000aa11/members",
        ),
        "00000000-0000-4000-8000-00000000aa11",
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(403);
        await expect(result.response.json()).resolves.toMatchObject({
          error: { code: "WORKSPACE_MEMBER_MANAGE_REQUIRED", retryable: false },
        });
      }
    },
  );

  it.each([
    ["cross-workspace direct URL", false, 403],
    ["archived workspace", false, 403],
    ["authority outage", true, 503],
  ] as const)("fails closed for %s", async (_case, retryable, status) => {
    mocks.session.mockResolvedValue({
      ok: true,
      value: {
        principal_id: "00000000-0000-4000-8000-000000001002",
        system_role: "USER",
      },
    });
    mocks.capability.mockResolvedValue({
      ok: false,
      error: { code: "WORKSPACE_ACCESS_DENIED", message: "denied", retryable },
    });

    const result = await authorizeWorkspaceMembersRequest(
      new NextRequest(
        "http://localhost/api/workspaces/00000000-0000-4000-8000-00000000aa22/members",
      ),
      "00000000-0000-4000-8000-00000000aa22",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(status);
      const body = await result.response.json();
      expect(body).toMatchObject({
        error: { code: "WORKSPACE_MEMBER_MANAGE_REQUIRED", retryable },
      });
      expect(JSON.stringify(body)).not.toContain("denied");
    }
  });

  it("rejects a revoked or missing session before resolving workspace capability", async () => {
    mocks.session.mockResolvedValue({
      ok: false,
      error: { code: "AUTH_SESSION_INVALID", message: "请重新登录。", retryable: false },
    });

    const result = await authorizeWorkspaceMembersRequest(
      new NextRequest(
        "http://localhost/api/workspaces/00000000-0000-4000-8000-00000000aa11/members",
      ),
      "00000000-0000-4000-8000-00000000aa11",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
    expect(mocks.capability).not.toHaveBeenCalled();
  });
});
