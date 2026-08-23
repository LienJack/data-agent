import { buildRunInterruption } from "@data-agent/contracts";
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const workspaceId = id(1);
const runId = id(2);
const principalId = id(3);
const scope = { app_id: id(4), tenant_id: workspaceId, environment: "test" } as const;

const state = vi.hoisted(() => ({
  interruption: null as unknown,
  replies: [] as unknown[],
  branches: [] as unknown[],
  accesses: [] as string[],
}));

vi.mock("@/lib/workspace-request", () => ({
  authorizeWorkspaceRequest: async (_request: unknown, _workspaceId: string, access: string) => {
    state.accesses.push(access);
    return {
      ok: true,
      value: { capability: { scope, deployment_id: id(5), principal: principalId, role: "OWNER" } },
    };
  },
  workspaceErrorResponse: (error: unknown) => NextResponse.json({ error }, { status: 400 }),
}));

vi.mock("@/lib/workspace-identity", () => ({
  getSessionRecovery: () => ({
    loadInterruption: async () => ({ ok: true, value: state.interruption }),
    reply: async (_capability: unknown, command: unknown) => {
      state.replies.push(command);
      return { ok: true, value: { disposition: "COMMITTED" } };
    },
    listBranches: async () => ({ ok: true, value: [] }),
    createBranch: async (_capability: unknown, command: unknown) => {
      state.branches.push(command);
      return { ok: true, value: { disposition: "COMMITTED" } };
    },
  }),
}));

async function interruption() {
  return buildRunInterruption({
    schema_version: "run-interruption@1.0.0",
    scope,
    interruption_id: id(6),
    run_id: runId,
    kind: "CLARIFICATION",
    question: "Which metric?",
    options: [{ option_id: "booked", label: "Booked" }],
    checkpoint_ref: { snapshot_id: id(7), snapshot_version: 2, snapshot_hash: hash("1") },
    worker_fence: 9,
    state: "OPEN",
    version: 1,
    opened_at: "2026-08-17T12:00:00.000Z",
    answered_at: null,
  });
}

describe("workspace session recovery routes", () => {
  beforeEach(async () => {
    state.interruption = await interruption();
    state.replies = [];
    state.branches = [];
    state.accesses = [];
  });

  it("loads the durable interruption and injects current version/fence into a reply", async () => {
    const route = await import(
      "../src/app/api/workspaces/[workspaceId]/runs/[runId]/interruptions/route"
    );
    const getResponse = await route.GET(new NextRequest("http://localhost/interruptions"), {
      params: Promise.resolve({ workspaceId, runId }),
    });
    expect(getResponse.status).toBe(200);
    const response = await route.POST(
      new NextRequest("http://localhost/interruptions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotency_key: "reply-route-0001",
          response: { kind: "OPTION", option_id: "booked" },
        }),
      }),
      { params: Promise.resolve({ workspaceId, runId }) },
    );
    expect(response.status).toBe(200);
    expect(state.accesses).toEqual(["READ", "WRITE"]);
    expect(state.replies[0]).toMatchObject({
      scope,
      run_id: runId,
      expected_version: 1,
      expected_worker_fence: 9,
      actor_principal_id: principalId,
      command_hash: expect.stringMatching(/^sha256:/),
    });
  });

  it("builds a reference-only branch with server-owned scope and actor", async () => {
    const route = await import(
      "../src/app/api/workspaces/[workspaceId]/runs/[runId]/branches/route"
    );
    const response = await route.POST(
      new NextRequest("http://localhost/branches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotency_key: "branch-route-0001",
          parent_conversation_id: id(8),
          parent_event_sequence: 12,
          parent_checkpoint_ref: {
            snapshot_id: id(7),
            snapshot_version: 2,
            snapshot_hash: hash("1"),
          },
          effective_config_revalidation: {
            receipt_id: id(9),
            receipt_hash: hash("2"),
            config_ref: { config_id: id(10), config_revision: 1, config_hash: hash("3") },
            revalidated_at: "2026-08-17T12:00:00.000Z",
          },
          child_conversation_id: id(11),
        }),
      }),
      { params: Promise.resolve({ workspaceId, runId }) },
    );
    expect(response.status).toBe(201);
    expect(state.branches[0]).toMatchObject({
      branch: {
        scope,
        parent_run_id: runId,
        created_by_principal_id: principalId,
        branch_hash: expect.stringMatching(/^sha256:/),
      },
      command_hash: expect.stringMatching(/^sha256:/),
    });
    expect(JSON.stringify(state.branches[0])).not.toMatch(/messages|events|effect_payload/);
  });
});
