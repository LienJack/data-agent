import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ids = {
  workspace: "00000000-0000-4000-8000-000000006701",
  principal: "00000000-0000-4000-8000-000000006702",
  file: "00000000-0000-4000-8000-000000006703",
  profile: "00000000-0000-4000-8000-000000006704",
  base: "00000000-0000-4000-8000-000000006705",
  generation: "00000000-0000-4000-8000-000000006706",
} as const;
const digest = `sha256:${"a".repeat(64)}` as const;
const scope = {
  app_id: "00000000-0000-4000-8000-00000000da01",
  tenant_id: ids.workspace,
  environment: "test",
};

const state = vi.hoisted(() => ({
  accesses: [] as string[],
  creates: [] as unknown[],
  rebuilds: [] as unknown[],
  searches: [] as unknown[],
}));

vi.mock("@/lib/workspace-request", () => ({
  authorizeWorkspaceRequest: async (_request: unknown, _workspaceId: string, access: string) => {
    state.accesses.push(access);
    return { ok: true, value: { capability: { scope, principal: ids.principal } } };
  },
  workspaceErrorResponse: (error: unknown) => NextResponse.json({ error }, { status: 400 }),
}));

vi.mock("@/lib/workspace-identity", () => ({
  getKnowledgeRegistry: () => ({
    list: async () => ({ ok: true, value: [] }),
    listProfiles: async () => ({ ok: true, value: [] }),
    create: async (_capability: unknown, command: unknown) => {
      state.creates.push(command);
      return { ok: true, value: { knowledge_base: {}, generation: {} } };
    },
    rebuild: async (_capability: unknown, command: unknown) => {
      state.rebuilds.push(command);
      return { ok: true, value: { knowledge_base: {}, generation: {} } };
    },
  }),
}));

vi.mock("@/lib/knowledge-runtime", () => ({
  getKnowledgeSearchService: async () => ({
    search: async (request: unknown) => {
      state.searches.push(request);
      return {
        ok: true,
        value: {
          schema_version: "knowledge-debug-search-result@1.0.0",
          status: "NOT_READY",
          reason_code: "INDEX_NOT_CONFIGURED",
          receipt: null,
        },
      };
    },
  }),
}));

describe("Knowledge Base routes", () => {
  beforeEach(() => {
    state.accesses = [];
    state.creates = [];
    state.rebuilds = [];
    state.searches = [];
  });

  it("builds a hashed create command from exact READY file/profile references", async () => {
    const route = await import("../src/app/api/workspaces/[workspaceId]/knowledge-bases/route");
    const response = await route.POST(
      new NextRequest("http://localhost/knowledge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Governed docs",
          source_file_refs: [{ file_id: ids.file, revision: 1, revision_hash: digest }],
          embedding_profile_ref: { profile_id: ids.profile, revision: 1, profile_hash: digest },
          acl: { visibility: "WORKSPACE", principal_ids: [] },
          idempotency_key: "knowledge-route-create-0001",
        }),
      }),
      { params: Promise.resolve({ workspaceId: ids.workspace }) },
    );

    expect(response.status).toBe(202);
    expect(state.accesses).toEqual(["WRITE"]);
    expect(state.creates).toHaveLength(1);
    expect(state.creates[0]).toMatchObject({
      schema_version: "knowledge-base-create@1.0.0",
      workspace_id: ids.workspace,
      source_file_refs: [{ file_id: ids.file, revision: 1, revision_hash: digest }],
      request_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
  });

  it("rejects rebuild identity substitution before the registry", async () => {
    const route = await import(
      "../src/app/api/workspaces/[workspaceId]/knowledge-bases/[knowledgeBaseId]/rebuild/route"
    );
    const response = await route.POST(
      new NextRequest("http://localhost/knowledge/rebuild", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          knowledge_base_ref: {
            knowledge_base_id: "00000000-0000-4000-8000-000000006799",
            revision: 1,
            revision_hash: digest,
          },
          idempotency_key: "knowledge-route-rebuild-0001",
        }),
      }),
      { params: Promise.resolve({ workspaceId: ids.workspace, knowledgeBaseId: ids.base }) },
    );
    expect(response.status).toBe(400);
    expect(state.rebuilds).toEqual([]);
  });

  it("keeps debug search bound to an exact generation and returns no raw chunk", async () => {
    const route = await import(
      "../src/app/api/workspaces/[workspaceId]/knowledge-bases/[knowledgeBaseId]/search/route"
    );
    const response = await route.POST(
      new NextRequest("http://localhost/knowledge/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schema_version: "knowledge-debug-search-request@1.0.0",
          knowledge_base_ref: {
            knowledge_base_id: ids.base,
            revision: 2,
            revision_hash: digest,
          },
          generation_ref: {
            generation_id: ids.generation,
            generation_revision: 1,
            generation_hash: digest,
          },
          query: "governed evidence",
          limit: 5,
        }),
      }),
      { params: Promise.resolve({ workspaceId: ids.workspace, knowledgeBaseId: ids.base }) },
    );
    expect(response.status).toBe(200);
    expect(state.searches).toHaveLength(1);
    expect(JSON.stringify(await response.json())).not.toMatch(/normalized_text|vector|storage_key/);
  });
});
