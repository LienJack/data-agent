import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const workspaceId = "00000000-0000-4000-8000-000000008001";
const principalId = "00000000-0000-4000-8000-000000008002";
const hash = `sha256:${"a".repeat(64)}`;
const state = vi.hoisted(() => ({ requests: [] as unknown[], authorityCalls: [] as unknown[] }));

vi.mock("@/lib/workspace-request", () => ({
  authorizeWorkspaceRequest: async (
    _request: unknown,
    requestedWorkspaceId: string,
    access: string,
  ) => {
    state.authorityCalls.push({ workspaceId: requestedWorkspaceId, access });
    return {
      ok: true,
      value: {
        capability: {
          scope: {
            app_id: "00000000-0000-4000-8000-00000000da01",
            tenant_id: workspaceId,
            environment: "test",
          },
          principal: principalId,
        },
      },
    };
  },
  workspaceErrorResponse: (error: unknown) => NextResponse.json({ error }, { status: 400 }),
}));

vi.mock("@/lib/workspace-identity", () => ({
  getEffectiveConfigResolver: () => ({
    getWorkspaceDefaults: async () => ({
      ok: true,
      value: {
        defaults_ref: {
          defaults_id: "00000000-0000-4000-8000-000000008003",
          defaults_revision: 2,
          defaults_hash: hash,
        },
      },
    }),
  }),
  getResolvedContextService: () => ({
    preview: async (_capability: unknown, request: unknown) => {
      state.requests.push(request);
      return {
        ok: true,
        value: { package: { route_decision: { route: "METRIC", state: "READY" } } },
      };
    },
  }),
}));

describe("resolved context preview route", () => {
  beforeEach(() => {
    state.requests = [];
    state.authorityCalls = [];
  });

  it("resolves a preview against the exact current Workspace Defaults", async () => {
    const route = await import("../src/app/api/workspaces/[workspaceId]/context/preview/route");
    const response = await route.POST(
      new NextRequest("http://localhost/context/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "Gross Revenue by channel" }),
      }),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(response.status).toBe(200);
    expect(state.requests).toHaveLength(1);
    expect(state.authorityCalls).toEqual([{ workspaceId, access: "READ" }]);
    expect(state.requests[0]).toMatchObject({
      question: "Gross Revenue by channel",
      request_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      basis: {
        consumer: "PREVIEW",
        defaults_ref: { defaults_revision: 2, defaults_hash: hash },
      },
    });
  });

  it("rejects an empty question without invoking the resolver", async () => {
    const route = await import("../src/app/api/workspaces/[workspaceId]/context/preview/route");
    const response = await route.POST(
      new NextRequest("http://localhost/context/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "   " }),
      }),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(response.status).toBe(400);
    expect(state.requests).toEqual([]);
  });

  it("rejects unknown request fields without invoking the resolver", async () => {
    const route = await import("../src/app/api/workspaces/[workspaceId]/context/preview/route");
    const response = await route.POST(
      new NextRequest("http://localhost/context/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "Gross Revenue", unexpected: true }),
      }),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(response.status).toBe(400);
    expect(state.requests).toEqual([]);
  });
});
