import { buildResolutionTrace } from "@data-agent/contracts";
import { NextRequest, NextResponse } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const workspaceId = id(1);
const runId = id(2);
const conversationId = id(3);
const scope = { app_id: id(4), tenant_id: workspaceId, environment: "test" } as const;

const state = vi.hoisted(() => ({
  trace: null as unknown,
  sql: null as unknown,
  traceInputs: [] as unknown[],
  sqlInputs: [] as unknown[],
  accesses: [] as string[],
}));

vi.mock("@/lib/workspace-request", () => ({
  authorizeWorkspaceRequest: async (_request: unknown, _workspaceId: string, access: string) => {
    state.accesses.push(access);
    return {
      ok: true,
      value: { capability: { scope, principal: id(5), deployment_id: id(6), role: "ANALYST" } },
    };
  },
  workspaceErrorResponse: (error: unknown) => NextResponse.json({ error }, { status: 404 }),
}));

vi.mock("@/lib/workspace-identity", () => ({
  getResolutionTraceProjector: () => ({
    loadTrace: async (_capability: unknown, input: unknown) => {
      state.traceInputs.push(input);
      return { ok: true, value: state.trace };
    },
    listSqlHistory: async (_capability: unknown, input: unknown) => {
      state.sqlInputs.push(input);
      return { ok: true, value: state.sql };
    },
  }),
}));

beforeAll(async () => {
  state.trace = await buildResolutionTrace({
    schema_version: "resolution-trace@1.0.0",
    scope,
    run_id: runId,
    conversation_id: conversationId,
    config_ref: null,
    nodes: [],
    edges: [],
  });
  state.sql = { schema_version: "sql-history-result@1.0.0", items: [], next_cursor: null };
});

describe("Resolution Trace workspace routes", () => {
  beforeEach(() => {
    state.traceInputs = [];
    state.sqlInputs = [];
    state.accesses = [];
  });

  it("injects the authorized scope and returns the hashed Run trace", async () => {
    const route = await import(
      "../src/app/api/workspaces/[workspaceId]/runs/[runId]/resolution-trace/route"
    );
    const response = await route.GET(
      new NextRequest(
        `http://localhost/api/workspaces/${workspaceId}/runs/${runId}/resolution-trace`,
      ),
      {
        params: Promise.resolve({ workspaceId, runId }),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { run_id: runId, trace_hash: expect.stringMatching(/^sha256:/) },
    });
    expect(state.traceInputs).toEqual([{ scope, run_id: runId }]);
    expect(state.accesses).toEqual(["READ"]);
  });

  it("passes only strict SQL filters and does not expose a missing Run identity", async () => {
    const sqlRoute = await import("../src/app/api/workspaces/[workspaceId]/sql-history/route");
    const response = await sqlRoute.GET(
      new NextRequest(
        `http://localhost/api/workspaces/${workspaceId}/sql-history?run_id=${runId}&conversation_id=${conversationId}&occurred_after=2026-08-18T11%3A00%3A00.000Z&occurred_before=2026-08-18T13%3A00%3A00.000Z&limit=25`,
      ),
      {
        params: Promise.resolve({ workspaceId }),
      },
    );
    expect(response.status).toBe(200);
    expect(state.sqlInputs).toEqual([
      {
        scope,
        run_id: runId,
        conversation_id: conversationId,
        occurred_after: "2026-08-18T11:00:00.000Z",
        occurred_before: "2026-08-18T13:00:00.000Z",
        limit: 25,
      },
    ]);

    state.trace = null;
    const traceRoute = await import(
      "../src/app/api/workspaces/[workspaceId]/runs/[runId]/resolution-trace/route"
    );
    const missing = await traceRoute.GET(new NextRequest("http://localhost/trace"), {
      params: Promise.resolve({ workspaceId, runId }),
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({
      error: { code: "RESOLUTION_TRACE_NOT_FOUND_OR_DENIED" },
    });
  });
});
