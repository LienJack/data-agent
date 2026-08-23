import { buildAgentProductProfileRevision } from "@data-agent/contracts";
import { NextRequest, NextResponse } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const workspaceId = id(1);
const principalId = id(2);
const scope = { app_id: id(3), tenant_id: workspaceId, environment: "test" } as const;
const state = vi.hoisted(() => ({
  accesses: [] as string[],
  commits: [] as unknown[],
  listEnabled: [] as boolean[],
  discoverableReads: 0,
  revision: null as unknown,
  traceInputs: [] as unknown[],
}));

vi.mock("@/lib/workspace-request", () => ({
  authorizeWorkspaceRequest: async (_request: unknown, _workspace: string, access: string) => {
    state.accesses.push(access);
    return {
      ok: true,
      value: {
        capability: { scope, principal: principalId, role: "OWNER", deployment_id: id(4) },
      },
    };
  },
  workspaceErrorResponse: (error: unknown) => NextResponse.json({ error }, { status: 400 }),
}));
vi.mock("@/lib/workspace-identity", () => ({
  getAgentProfileRegistry: () => ({
    list: async (_capability: unknown, enabled: boolean) => {
      state.listEnabled.push(enabled);
      return { ok: true, value: [] };
    },
    listDiscoverable: async () => {
      state.discoverableReads += 1;
      return { ok: true, value: [] };
    },
    commit: async (_capability: unknown, command: unknown) => {
      state.commits.push(command);
      return { ok: true, value: { revision: state.revision } };
    },
  }),
  getAgentTeamTraceProjector: () => ({
    load: async (_capability: unknown, input: unknown) => {
      state.traceInputs.push(input);
      return { ok: true, value: null };
    },
  }),
}));

beforeAll(async () => {
  state.revision = await buildAgentProductProfileRevision({
    schema_version: "agent-product-profile-revision@1.0.0",
    scope,
    profile_id: "semantic-management-agent",
    revision: 1,
    runtime_profile_ref: {
      profile_id: "semantic-management-agent",
      revision: 1,
      profile_hash: hash("1"),
    },
    model_profile_ref: { resource_id: id(5), resource_revision: 1, resource_hash: hash("2") },
    prompt_ref: { prompt_id: "prompt.semantic", revision: 1, prompt_hash: hash("3") },
    workflow_ref: {
      workflow_id: "workflow.semantic",
      revision: 1,
      workflow_hash: hash("4"),
    },
    direct_tool_allowlist: ["semantic.candidate.write", "semantic.catalog.read"],
    skill_refs: [{ skill_id: id(6), revision: 1, revision_hash: hash("5") }],
    context_policy_ref: { resource_id: id(7), resource_revision: 1, resource_hash: hash("6") },
    execution_safety_policy_ref: {
      resource_id: id(8),
      resource_revision: 1,
      resource_hash: hash("7"),
    },
    expected_output_artifact_types: ["SemanticGraphCandidate"],
    verifier_contract_hash: hash("8"),
    approval_status: "APPROVED",
  });
});

describe("workspace Agent Profile route", () => {
  beforeEach(() => {
    state.accesses = [];
    state.commits = [];
    state.listEnabled = [];
    state.discoverableReads = 0;
    state.traceInputs = [];
  });

  it("loads Team trace with server-owned scope and Run identity", async () => {
    const route = await import(
      "../src/app/api/workspaces/[workspaceId]/runs/[runId]/team-trace/route"
    );
    const runId = id(30);
    const response = await route.GET(new NextRequest("http://localhost/team-trace"), {
      params: Promise.resolve({ workspaceId, runId }),
    });
    expect(response.status).toBe(200);
    expect(state.traceInputs).toEqual([{ scope, run_id: runId }]);
  });

  it("lists enabled profiles through READ authority", async () => {
    const route = await import("../src/app/api/workspaces/[workspaceId]/agent-profiles/route");
    const response = await route.GET(
      new NextRequest("http://localhost/agent-profiles?enabled_only=true"),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(response.status).toBe(200);
    expect(state.accesses).toEqual(["READ"]);
    expect(state.listEnabled).toEqual([true]);
  });

  it("projects only public discovery fields from the Subagent capability endpoint", async () => {
    const route = await import(
      "../src/app/api/workspaces/[workspaceId]/subagent-capabilities/route"
    );
    const response = await route.GET(new NextRequest("http://localhost/subagent-capabilities"), {
      params: Promise.resolve({ workspaceId }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { schema_version: "subagent-capability-catalog-view@1.0.0", items: [] },
    });
    expect(state.discoverableReads).toBe(1);
  });

  it("injects server scope, actor and deterministic operation identity", async () => {
    const route = await import("../src/app/api/workspaces/[workspaceId]/agent-profiles/route");
    const response = await route.POST(
      new NextRequest("http://localhost/agent-profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotency_key: "agent-profile-route-001",
          revision: state.revision,
          expected_head_version: 0,
          target_lifecycle: "ENABLED",
        }),
      }),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(response.status).toBe(201);
    expect(state.commits[0]).toMatchObject({
      actor_principal_id: principalId,
      revision: { scope },
      command_hash: expect.stringMatching(/^sha256:/),
    });
  });
});
