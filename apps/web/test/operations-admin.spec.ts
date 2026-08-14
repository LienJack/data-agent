import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
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
  });
});
