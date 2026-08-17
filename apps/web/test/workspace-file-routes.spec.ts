import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ids = {
  workspace: "00000000-0000-4000-8000-000000006601",
  otherWorkspace: "00000000-0000-4000-8000-000000006699",
  principal: "00000000-0000-4000-8000-000000006602",
  file: "00000000-0000-4000-8000-000000006603",
  session: "00000000-0000-4000-8000-000000006604",
} as const;
const digest = `sha256:${"a".repeat(64)}` as const;
const storageKey = `workspace-content/v1/00000000-0000-4000-8000-00000000da01/${ids.workspace}/test/aa/${"a".repeat(64)}`;
const scope = {
  app_id: "00000000-0000-4000-8000-00000000da01",
  tenant_id: ids.workspace,
  environment: "test",
} as const;

const state = vi.hoisted(() => ({
  accesses: [] as Array<readonly [string, string]>,
  lists: [] as unknown[],
  uploads: [] as unknown[],
  promotions: [] as unknown[],
  deletions: [] as unknown[],
  downloads: [] as unknown[],
  enqueues: [] as unknown[],
  contentGets: [] as unknown[],
  contentPuts: [] as unknown[],
}));

const revision = {
  schema_version: "workspace-file-revision@1.0.0",
  scope: { ...scope, workspace_id: ids.workspace },
  file_id: ids.file,
  revision: 1,
  parent_ref: null,
  blob_hash: digest,
  byte_size: 5,
  detected_mime: "text/plain",
  original_filename: "报告.txt",
  visibility: "SESSION",
  session_id: ids.session,
  owner_principal_id: ids.principal,
  status: "QUARANTINED",
  scan_receipt_ref: null,
  promoted_from_ref: null,
  created_at: "2026-08-17T00:00:00.000Z",
  expires_at: null,
  deleted_at: null,
  revision_hash: digest,
} as const;

vi.mock("@data-agent/platform", () => ({
  createPostgresJobQueue: () => ({
    enqueue: async (command: unknown) => {
      state.enqueues.push(command);
      return {
        ok: true,
        value: {
          schema_version: "job-submission-receipt@1.0.0",
          disposition: "CREATED",
          job_id: "00000000-0000-4000-8000-000000006605",
        },
      };
    },
  }),
}));

vi.mock("@/lib/workspace-file-content", () => ({
  observeWorkspaceFileContent: async () => ({
    bytes: new Uint8Array([104, 101, 108, 108, 111]),
    blob_hash: digest,
    byte_size: 5,
    detected_mime: "text/plain",
  }),
}));

vi.mock("@/lib/workspace-request", () => ({
  authorizeWorkspaceRequest: async (_request: unknown, workspaceId: string, access: string) => {
    state.accesses.push([workspaceId, access]);
    if (workspaceId !== ids.workspace) {
      return {
        ok: false,
        error: { code: "WORKSPACE_NOT_FOUND", message: "Workspace 不可用。", retryable: false },
      };
    }
    return {
      ok: true,
      value: { capability: { scope, principal: ids.principal } },
    };
  },
  workspaceErrorResponse: (error: { code?: string }) =>
    NextResponse.json({ error }, { status: error.code === "WORKSPACE_NOT_FOUND" ? 404 : 400 }),
}));

vi.mock("@/lib/workspace-identity", () => ({
  getWorkspaceAuthority: () => ({ authorizer: {} }),
  getWorkspaceSqlPool: () => ({}),
  getWorkspaceFiles: () => ({
    list: async (_capability: unknown, input: unknown) => {
      state.lists.push(input);
      return { ok: true, value: [revision] };
    },
    commitUpload: async (_capability: unknown, command: unknown) => {
      state.uploads.push(command);
      return { ok: true, value: revision };
    },
    resolveDownload: async (_capability: unknown, input: unknown) => {
      state.downloads.push(input);
      return {
        ok: true,
        value: {
          file: { ...revision, status: "READY" },
          storage_key: storageKey,
          blob_hash: digest,
          byte_size: 5,
          detected_mime: "text/plain",
        },
      };
    },
    promote: async (_capability: unknown, command: unknown) => {
      state.promotions.push(command);
      return { ok: true, value: { ...revision, revision: 2, visibility: "WORKSPACE" } };
    },
    delete: async (_capability: unknown, command: unknown) => {
      state.deletions.push(command);
      return { ok: true, value: { revision: { ...revision, status: "DELETED" } } };
    },
  }),
  getWorkspaceContent: () => ({
    createKey: () => storageKey,
    put: async (...input: unknown[]) => {
      state.contentPuts.push(input);
      return { ok: true, value: undefined };
    },
    get: async (...input: unknown[]) => {
      state.contentGets.push(input);
      return { ok: true, value: new Uint8Array([104, 101, 108, 108, 111]) };
    },
  }),
}));

describe("Workspace file routes", () => {
  beforeEach(() => {
    state.accesses = [];
    state.lists = [];
    state.uploads = [];
    state.promotions = [];
    state.deletions = [];
    state.downloads = [];
    state.enqueues = [];
    state.contentGets = [];
    state.contentPuts = [];
  });

  it("uploads observed bytes, commits QUARANTINED authority, and enqueues FILE_SCAN", async () => {
    const { POST } = await import("../src/app/api/workspaces/[workspaceId]/files/route");
    const form = new FormData();
    form.set("file", new File(["hello"], "client-spoofed.pdf", { type: "application/pdf" }));
    form.set("session_id", ids.session);
    form.set("idempotency_key", "workspace-file-upload-route-0001");
    const response = await POST(
      new NextRequest("http://localhost/files", { method: "POST", body: form }),
      { params: Promise.resolve({ workspaceId: ids.workspace }) },
    );

    expect(response.status).toBe(202);
    expect(state.accesses).toEqual([[ids.workspace, "WRITE"]]);
    expect(state.contentPuts).toHaveLength(1);
    expect(state.uploads).toHaveLength(1);
    expect(state.enqueues).toHaveLength(1);
    expect(state.enqueues[0]).toMatchObject({
      kind: "FILE_SCAN",
      input: { kind: "FILE_SCAN", parameters: { file_id: ids.file, revision: 1 } },
    });
  });

  it("lists by session and serves exact READY bytes with safe download headers", async () => {
    const listRoute = await import("../src/app/api/workspaces/[workspaceId]/files/route");
    const fileRoute = await import("../src/app/api/workspaces/[workspaceId]/files/[fileId]/route");
    const listed = await listRoute.GET(
      new NextRequest(`http://localhost/files?sessionId=${ids.session}`),
      { params: Promise.resolve({ workspaceId: ids.workspace }) },
    );
    expect(listed.status).toBe(200);
    expect(state.lists).toEqual([{ session_id: ids.session, limit: 100 }]);

    const downloaded = await fileRoute.GET(
      new NextRequest(`http://localhost/file?revision=1&revision_hash=${digest}`),
      { params: Promise.resolve({ workspaceId: ids.workspace, fileId: ids.file }) },
    );
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-type")).toBe("text/plain");
    expect(downloaded.headers.get("cache-control")).toBe("private, no-store");
    expect(downloaded.headers.get("x-content-type-options")).toBe("nosniff");
    expect(downloaded.headers.get("content-disposition")).toContain("attachment;");
    expect(state.downloads).toEqual([{ file_id: ids.file, revision: 1, revision_hash: digest }]);
    await expect(downloaded.text()).resolves.toBe("hello");
  });

  it("binds promote and delete to exact revision identities", async () => {
    const route = await import("../src/app/api/workspaces/[workspaceId]/files/[fileId]/route");
    const context = {
      params: Promise.resolve({ workspaceId: ids.workspace, fileId: ids.file }),
    };
    const promoted = await route.PATCH(
      new NextRequest("http://localhost/file", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "PROMOTE",
          revision: 1,
          revision_hash: digest,
          idempotency_key: "workspace-file-promote-route-0001",
        }),
      }),
      context,
    );
    expect(promoted.status).toBe(200);
    expect(state.promotions[0]).toMatchObject({
      workspace_id: ids.workspace,
      file_ref: { file_id: ids.file, revision: 1, revision_hash: digest },
    });

    const deleted = await route.DELETE(
      new NextRequest("http://localhost/file", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          revision: 1,
          revision_hash: digest,
          idempotency_key: "workspace-file-delete-route-0001",
        }),
      }),
      context,
    );
    expect(deleted.status).toBe(200);
    expect(state.deletions[0]).toMatchObject({
      workspace_id: ids.workspace,
      file_ref: { file_id: ids.file, revision: 1, revision_hash: digest },
    });
  });

  it("rejects cross-workspace paths before repository or object access", async () => {
    const { GET } = await import("../src/app/api/workspaces/[workspaceId]/files/[fileId]/route");
    const response = await GET(
      new NextRequest(`http://localhost/file?revision=1&revision_hash=${digest}`),
      { params: Promise.resolve({ workspaceId: ids.otherWorkspace, fileId: ids.file }) },
    );
    expect(response.status).toBe(404);
    expect(state.downloads).toHaveLength(0);
    expect(state.contentGets).toHaveLength(0);
  });
});
