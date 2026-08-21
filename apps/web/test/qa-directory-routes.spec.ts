import { buildWorkspaceConversationDirectoryCommand } from "@data-agent/contracts";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ids = {
  workspace: "20000000-0000-4000-8000-000000000001",
  principal: "20000000-0000-4000-8000-000000000002",
  folder: "20000000-0000-4000-8000-000000000003",
  conversation: "20000000-0000-4000-8000-000000000004",
  operation: "20000000-0000-4000-8000-000000000005",
} as const;

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  apply: vi.fn(),
}));

vi.mock("@/lib/workspace-request", () => ({
  authorizeWorkspaceRequest: vi.fn().mockResolvedValue({
    ok: true,
    value: {
      capability: { principal: ids.principal, scope: { tenant_id: ids.workspace } },
      session: { principal_id: ids.principal },
    },
  }),
  workspaceErrorResponse: (error: { readonly code: string }) =>
    Response.json({ error }, { status: error.code.endsWith("_CONFLICT") ? 409 : 400 }),
}));

vi.mock("@/lib/workspace-identity", () => ({
  getWorkspaceDataRepository: () => ({
    listConversationDirectory: mocks.list,
    createConversation: mocks.create,
    applyConversationDirectoryCommand: mocks.apply,
  }),
}));

let listRoute: typeof import("../src/app/api/workspaces/[workspaceId]/qa/conversations/route").GET;
let commandRoute: typeof import("../src/app/api/workspaces/[workspaceId]/qa/directory/commands/route").POST;

beforeAll(async () => {
  ({ GET: listRoute } = await import(
    "../src/app/api/workspaces/[workspaceId]/qa/conversations/route"
  ));
  ({ POST: commandRoute } = await import(
    "../src/app/api/workspaces/[workspaceId]/qa/directory/commands/route"
  ));
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue({
    ok: true,
    value: {
      schema_version: "workspace-conversation-directory-page@1.0.0",
      workspace_id: ids.workspace,
      view: "active",
      folders: [],
      conversations: [],
      next_cursor: null,
    },
  });
  mocks.apply.mockResolvedValue({ ok: true, value: { action: "FOLDER_CREATE" } });
});

describe("Q&A private directory routes", () => {
  it("passes a strict owner directory view/search query to the repository", async () => {
    const response = await listRoute(
      new NextRequest(
        `http://localhost/api/workspaces/${ids.workspace}/qa/conversations?view=active&q=orders&limit=12`,
      ),
      { params: Promise.resolve({ workspaceId: ids.workspace }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ principal: ids.principal }), {
      schema_version: "workspace-conversation-directory-query@1.0.0",
      view: "active",
      folder_id: null,
      query: "orders",
      cursor: null,
      limit: 12,
    });
  });

  it("rejects unknown views and invalid limits before repository I/O", async () => {
    const response = await listRoute(
      new NextRequest(
        `http://localhost/api/workspaces/${ids.workspace}/qa/conversations?view=all&limit=0`,
      ),
      { params: Promise.resolve({ workspaceId: ids.workspace }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("verifies the command hash at the route boundary", async () => {
    const command = await buildWorkspaceConversationDirectoryCommand({
      schema_version: "workspace-conversation-directory-command@1.0.0",
      operation_id: ids.operation,
      idempotency_key: "directory-folder-create-1",
      action: "FOLDER_CREATE",
      folder_id: ids.folder,
      name: "研究",
      sort_order: 0,
    });
    const valid = await commandRoute(
      new NextRequest(`http://localhost/api/workspaces/${ids.workspace}/qa/directory/commands`, {
        method: "POST",
        body: JSON.stringify(command),
      }),
      { params: Promise.resolve({ workspaceId: ids.workspace }) },
    );
    const forged = await commandRoute(
      new NextRequest(`http://localhost/api/workspaces/${ids.workspace}/qa/directory/commands`, {
        method: "POST",
        body: JSON.stringify({ ...command, name: "伪造" }),
      }),
      { params: Promise.resolve({ workspaceId: ids.workspace }) },
    );

    expect(valid.status).toBe(200);
    expect(forged.status).toBe(400);
    expect(mocks.apply).toHaveBeenCalledTimes(1);
  });
});
