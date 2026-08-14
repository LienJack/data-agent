import { NextRequest, NextResponse } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  userAction: vi.fn(),
  memberAction: vi.fn(),
  workspaceAction: vi.fn(),
}));

vi.mock("@/lib/operations-admin", () => ({
  authorizeOperationsAdminRequest: vi.fn(async () => ({
    ok: true,
    value: {
      principal: { principal_id: "00000000-0000-4000-8000-000000001001" },
      context: {},
      repository: {},
    },
  })),
  authorizeWorkspaceMembersRequest: vi.fn(async (_request, workspaceId) => ({
    ok: true,
    value: {
      principal: { principal_id: "00000000-0000-4000-8000-000000001001" },
      context: { workspace_id: workspaceId },
      repository: {},
    },
  })),
  operationsResultResponse: (result: unknown, status = 200) =>
    NextResponse.json(result, { status }),
}));

vi.mock("@/lib/identity-admin", () => ({
  getIdentityAdminService: () => ({
    actOnUser: mocks.userAction,
    actOnWorkspace: mocks.workspaceAction,
    actOnMember: mocks.memberAction,
  }),
}));

let patchUser: typeof import("../src/app/api/admin/operations/users/[principalId]/route").PATCH;
let patchWorkspace: typeof import("../src/app/api/admin/operations/workspaces/[workspaceId]/route").PATCH;
let patchMember: typeof import("../src/app/api/workspaces/[workspaceId]/members/route").PATCH;

beforeAll(async () => {
  ({ PATCH: patchUser } = await import(
    "../src/app/api/admin/operations/users/[principalId]/route"
  ));
  ({ PATCH: patchWorkspace } = await import(
    "../src/app/api/admin/operations/workspaces/[workspaceId]/route"
  ));
  ({ PATCH: patchMember } = await import("../src/app/api/workspaces/[workspaceId]/members/route"));
});

beforeEach(() => {
  mocks.userAction.mockReset().mockResolvedValue({ ok: true, value: {} });
  mocks.workspaceAction.mockReset().mockResolvedValue({ ok: true, value: {} });
  mocks.memberAction.mockReset().mockResolvedValue({ ok: true, value: {} });
});

describe("operations admin mutation routes", () => {
  it("uses the route principal instead of a client-supplied user target", async () => {
    const principalId = "00000000-0000-4000-8000-000000001002";
    const response = await patchUser(
      new NextRequest(`http://localhost/api/admin/operations/users/${principalId}`, {
        method: "PATCH",
        body: JSON.stringify({
          schema_version: "admin-user-action@1.0.0",
          operation_id: "00000000-0000-4000-8000-00000000b001",
          idempotency_key: "disable-user-route",
          principal_id: "00000000-0000-4000-8000-000000009999",
          expected_version: 1,
          action: "DISABLE",
          reason: "security review",
        }),
      }),
      { params: Promise.resolve({ principalId }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.userAction.mock.calls[0]?.[1]).toMatchObject({ principal_id: principalId });
  });

  it("uses the route workspace for lifecycle mutations", async () => {
    const workspaceId = "00000000-0000-4000-8000-00000000aa11";
    await patchWorkspace(
      new NextRequest(`http://localhost/api/admin/operations/workspaces/${workspaceId}`, {
        method: "PATCH",
        body: JSON.stringify({
          schema_version: "admin-workspace-action@1.0.0",
          operation_id: "00000000-0000-4000-8000-00000000b002",
          idempotency_key: "archive-workspace-route",
          workspace_id: "00000000-0000-4000-8000-000000009999",
          expected_version: 1,
          action: "ARCHIVE",
          reason: "workspace retired",
        }),
      }),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(mocks.workspaceAction.mock.calls[0]?.[1]).toMatchObject({ workspace_id: workspaceId });
  });

  it("passes the route workspace separately from the strict member command", async () => {
    const workspaceId = "00000000-0000-4000-8000-00000000aa11";
    await patchMember(
      new NextRequest(`http://localhost/api/workspaces/${workspaceId}/members`, {
        method: "PATCH",
        body: JSON.stringify({
          schema_version: "workspace-member-action@1.0.0",
          operation_id: "00000000-0000-4000-8000-00000000b003",
          idempotency_key: "member-upsert-route",
          principal_id: "00000000-0000-4000-8000-000000001002",
          action: "UPSERT",
          role: "ANALYST",
        }),
      }),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(mocks.memberAction.mock.calls[0]?.[1]).toBe(workspaceId);
    expect(mocks.memberAction.mock.calls[0]?.[2]).not.toHaveProperty("workspace_id");
  });
});
