import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ids = {
  workspace: "00000000-0000-4000-8000-000000007101",
  principal: "00000000-0000-4000-8000-000000007102",
  snapshot: "00000000-0000-4000-8000-000000007103",
} as const;
const digest = `sha256:${"a".repeat(64)}` as const;
const scope = {
  app_id: "00000000-0000-4000-8000-00000000da01",
  tenant_id: ids.workspace,
  environment: "test",
} as const;

const state = vi.hoisted(() => ({ registrations: [] as unknown[], enqueues: [] as unknown[] }));

vi.mock("@/lib/workspace-request", () => ({
  authorizeWorkspaceRequest: async () => ({
    ok: true,
    value: { capability: { scope, principal: ids.principal } },
  }),
  workspaceErrorResponse: (error: unknown) => NextResponse.json({ error }, { status: 400 }),
}));

vi.mock("@/lib/workspace-identity", () => ({
  getSemanticInductionRegistry: () => ({
    registerSource: async (_capability: unknown, command: unknown) => {
      state.registrations.push(command);
      return {
        ok: true,
        value: (command as { source: { source_ref: unknown } }).source.source_ref,
      };
    },
  }),
  getWorkspaceAuthority: () => ({ authorizer: {} }),
  getWorkspaceSqlPool: () => ({}),
}));

vi.mock("@data-agent/platform", async (importOriginal) => {
  const original = await importOriginal<typeof import("@data-agent/platform")>();
  return {
    ...original,
    createPostgresJobQueue: () => ({
      enqueue: async (command: unknown) => {
        state.enqueues.push(command);
        return { ok: true, value: { job_id: ids.snapshot } };
      },
    }),
  };
});

describe("semantic induction route", () => {
  beforeEach(() => {
    state.registrations = [];
    state.enqueues = [];
  });

  it("enqueues schema induction with an exact governed source and no publish fields", async () => {
    const route = await import(
      "../src/app/api/workspaces/[workspaceId]/semantic/induction-jobs/route"
    );
    const response = await route.POST(
      new NextRequest("http://localhost/semantic/induction-jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schema_version: "semantic-induction-job-start@1.0.0",
          semantic_domain: "commerce",
          induction_kind: "SCHEMA_INDUCTION",
          base_release_ref: null,
          sources: [
            {
              source_kind: "PHYSICAL_SCHEMA",
              resource_id: ids.snapshot,
              resource_revision: 1,
              resource_hash: digest,
            },
          ],
          idempotency_key: "semantic-induction-route-0001",
        }),
      }),
      { params: Promise.resolve({ workspaceId: ids.workspace }) },
    );
    expect(response.status).toBe(202);
    expect(state.registrations).toEqual([]);
    expect(state.enqueues).toHaveLength(1);
    expect(state.enqueues[0]).toMatchObject({
      kind: "SEMANTIC_INDUCTION",
      input: {
        parameters: {
          request: {
            induction_kind: "SCHEMA_INDUCTION",
            sources: [{ source_kind: "PHYSICAL_SCHEMA" }],
          },
        },
      },
    });
    expect(JSON.stringify(state.enqueues[0])).not.toMatch(/publish|approve/);
  });

  it("registers a metric package before enqueueing METRIC_IMPORT", async () => {
    const route = await import(
      "../src/app/api/workspaces/[workspaceId]/semantic/induction-jobs/route"
    );
    const response = await route.POST(
      new NextRequest("http://localhost/semantic/induction-jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schema_version: "semantic-induction-job-start@1.0.0",
          semantic_domain: "commerce",
          induction_kind: "METRIC_IMPORT",
          base_release_ref: null,
          sources: [
            {
              source_kind: "METRIC_EXCHANGE",
              resource_revision: 1,
              metric_format: "OSI_METRIC_EXCHANGE",
              facts: [],
              metrics: [
                {
                  external_id: "gmv",
                  name: "Gross Revenue",
                  expression: "sum(amount)",
                  unit: "CNY",
                },
              ],
              dependencies: [],
            },
          ],
          idempotency_key: "semantic-metric-route-0001",
        }),
      }),
      { params: Promise.resolve({ workspaceId: ids.workspace }) },
    );
    expect(response.status).toBe(202);
    expect(state.registrations).toHaveLength(1);
    expect(state.enqueues[0]).toMatchObject({ kind: "METRIC_IMPORT" });
  });
});
