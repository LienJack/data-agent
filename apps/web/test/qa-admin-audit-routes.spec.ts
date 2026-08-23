import { NextRequest, NextResponse } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ids = {
  workspace: "20000000-0000-4000-8000-000000000001",
  owner: "20000000-0000-4000-8000-000000000002",
  conversation: "20000000-0000-4000-8000-000000000003",
  run: "20000000-0000-4000-8000-000000000004",
  artifact: "20000000-0000-4000-8000-000000000005",
} as const;

const mocks = vi.hoisted(() => ({
  directory: vi.fn(),
  conversation: vi.fn(),
  events: vi.fn(),
  artifact: vi.fn(),
}));

vi.mock("@/lib/qa-admin-audit", () => ({
  authorizeQaAdminAuditRequest: vi.fn(async () => ({
    ok: true,
    value: {
      session: { principal_id: "20000000-0000-4000-8000-000000000020" },
      capability: { scope: { tenant_id: ids.workspace }, role: "OWNER" },
      repository: {
        readDirectory: mocks.directory,
        readConversation: mocks.conversation,
        readRunEvents: mocks.events,
        authorizeArtifactAccess: mocks.artifact,
      },
    },
  })),
  qaAdminResultResponse: (result: { readonly ok: boolean }) =>
    result.ok
      ? NextResponse.json({ data: "value" })
      : NextResponse.json({ error: "invalid" }, { status: 400 }),
  issueQaAdminCursor: vi.fn(() => "signed.cursor"),
  verifyQaAdminCursor: vi.fn((token: string) => (token === "signed.cursor" ? "25" : null)),
}));

let directoryRoute: typeof import("../src/app/api/workspaces/[workspaceId]/qa/admin/directory/route").GET;
let conversationRoute: typeof import("../src/app/api/workspaces/[workspaceId]/qa/admin/conversations/[conversationId]/route").GET;
let eventsRoute: typeof import("../src/app/api/workspaces/[workspaceId]/qa/admin/conversations/[conversationId]/events/route").GET;
let artifactRoute: typeof import("../src/app/api/workspaces/[workspaceId]/qa/admin/conversations/[conversationId]/artifacts/route").POST;

beforeAll(async () => {
  ({ GET: directoryRoute } = await import(
    "../src/app/api/workspaces/[workspaceId]/qa/admin/directory/route"
  ));
  ({ GET: conversationRoute } = await import(
    "../src/app/api/workspaces/[workspaceId]/qa/admin/conversations/[conversationId]/route"
  ));
  ({ GET: eventsRoute } = await import(
    "../src/app/api/workspaces/[workspaceId]/qa/admin/conversations/[conversationId]/events/route"
  ));
  ({ POST: artifactRoute } = await import(
    "../src/app/api/workspaces/[workspaceId]/qa/admin/conversations/[conversationId]/artifacts/route"
  ));
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of Object.values(mocks)) mock.mockResolvedValue({ ok: true, value: {} });
});

describe("Q&A admin audited routes", () => {
  it("binds directory scope and strict filters on the server", async () => {
    const response = await directoryRoute(
      new NextRequest(
        `http://localhost/api/workspaces/${ids.workspace}/qa/admin/directory?ownerPrincipalId=${ids.owner}&lifecycle=TRASH&liveState=COMPLETED&limit=17`,
      ),
      { params: Promise.resolve({ workspaceId: ids.workspace }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.directory).toHaveBeenCalledWith(expect.anything(), {
      schema_version: "qa-admin-directory-query@1.0.0",
      workspace_id: ids.workspace,
      owner_principal_id: ids.owner,
      folder_id: null,
      lifecycle: "TRASH",
      live_state: "COMPLETED",
      query: null,
      cursor: null,
      limit: 17,
    });
  });

  it("rejects malformed filters before repository I/O", async () => {
    const response = await directoryRoute(
      new NextRequest(
        `http://localhost/api/workspaces/${ids.workspace}/qa/admin/directory?lifecycle=DELETED`,
      ),
      { params: Promise.resolve({ workspaceId: ids.workspace }) },
    );
    expect(response.status).toBe(400);
    expect(mocks.directory).not.toHaveBeenCalled();
  });

  it("rejects a forged cursor before repository I/O", async () => {
    const response = await directoryRoute(
      new NextRequest(
        `http://localhost/api/workspaces/${ids.workspace}/qa/admin/directory?cursor=forged.cursor`,
      ),
      { params: Promise.resolve({ workspaceId: ids.workspace }) },
    );
    expect(response.status).toBe(400);
    expect(mocks.directory).not.toHaveBeenCalled();
  });

  it("requires an exact owner and binds the route conversation", async () => {
    await conversationRoute(
      new NextRequest(
        `http://localhost/api/workspaces/${ids.workspace}/qa/admin/conversations/${ids.conversation}?ownerPrincipalId=${ids.owner}`,
      ),
      { params: Promise.resolve({ workspaceId: ids.workspace, conversationId: ids.conversation }) },
    );
    expect(mocks.conversation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        operation: "MESSAGES_READ",
        workspace_id: ids.workspace,
        owner_principal_id: ids.owner,
        conversation_id: ids.conversation,
      }),
    );
  });

  it("passes exact subagent identity to the audited event repository", async () => {
    const taskId = "20000000-0000-4000-8000-000000000006";
    await eventsRoute(
      new NextRequest(
        `http://localhost/api/workspaces/${ids.workspace}/qa/admin/conversations/${ids.conversation}/events?operation=SUBAGENT_READ&ownerPrincipalId=${ids.owner}&runId=${ids.run}&profileId=report-writing-agent&taskId=${taskId}`,
      ),
      { params: Promise.resolve({ workspaceId: ids.workspace, conversationId: ids.conversation }) },
    );
    expect(mocks.events).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        operation: "SUBAGENT_READ",
        run_id: ids.run,
        profile_id: "report-writing-agent",
        task_id: taskId,
      }),
    );
  });

  it("returns an audited short-page SSE replay without changing the repository query", async () => {
    mocks.events.mockResolvedValueOnce({
      ok: true,
      value: {
        schema_version: "qa-admin-run-events-page@1.0.0",
        events: [],
        receipt: { operation: "RUN_REPLAY" },
      },
    });
    const response = await eventsRoute(
      new NextRequest(
        `http://localhost/api/workspaces/${ids.workspace}/qa/admin/conversations/${ids.conversation}/events?operation=RUN_REPLAY&ownerPrincipalId=${ids.owner}&runId=${ids.run}&transport=sse`,
      ),
      { params: Promise.resolve({ workspaceId: ids.workspace, conversationId: ids.conversation }) },
    );
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await response.text()).toContain("event: replay");
    expect(mocks.events).toHaveBeenCalledTimes(1);
    expect(mocks.events).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ operation: "RUN_REPLAY", after_sequence: 0 }),
    );
  });

  it("overrides client workspace and conversation claims for artifact preview", async () => {
    const reference = {
      artifact_id: ids.artifact,
      artifact_type: "SqlArtifact",
      app_id: "20000000-0000-4000-8000-000000000010",
      tenant_id: ids.workspace,
      environment: "test",
      run_id: ids.run,
      revision: 1,
      content_hash: `sha256:${"a".repeat(64)}`,
    };
    await artifactRoute(
      new NextRequest(
        `http://localhost/api/workspaces/${ids.workspace}/qa/admin/conversations/${ids.conversation}/artifacts`,
        {
          method: "POST",
          body: JSON.stringify({
            schema_version: "qa-admin-artifact-access-query@1.0.0",
            operation: "ARTIFACT_PREVIEW",
            workspace_id: "20000000-0000-4000-8000-000000000099",
            owner_principal_id: ids.owner,
            conversation_id: "20000000-0000-4000-8000-000000000098",
            run_id: ids.run,
            reference,
          }),
        },
      ),
      { params: Promise.resolve({ workspaceId: ids.workspace, conversationId: ids.conversation }) },
    );
    expect(mocks.artifact).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workspace_id: ids.workspace, conversation_id: ids.conversation }),
    );
  });
});
