import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const workspaceId = id(1);
const scope = { app_id: id(2), tenant_id: workspaceId, environment: "test" } as const;

const state = vi.hoisted(() => ({
  role: "OWNER" as "OWNER" | "ANALYST",
  accesses: [] as string[],
  mcpCommits: [] as unknown[],
  skillCommits: [] as unknown[],
  mcpListEnabledOnly: [] as boolean[],
}));

vi.mock("@/lib/workspace-request", () => ({
  authorizeWorkspaceRequest: async (_request: unknown, _workspaceId: string, access: string) => {
    state.accesses.push(access);
    return {
      ok: true,
      value: {
        capability: { scope, deployment_id: id(3), principal: id(4), role: state.role },
      },
    };
  },
  workspaceErrorResponse: (error: { code: string }) =>
    NextResponse.json({ error }, { status: error.code === "WORKSPACE_ROLE_DENIED" ? 403 : 400 }),
}));

vi.mock("@/lib/workspace-identity", () => ({
  getMcpRegistry: () => ({
    list: async (_capability: unknown, enabledOnly: boolean) => {
      state.mcpListEnabledOnly.push(enabledOnly);
      return { ok: true, value: [] };
    },
    commit: async (_capability: unknown, command: unknown) => {
      state.mcpCommits.push(command);
      return { ok: true, value: { kind: "MCP_SERVER" } };
    },
  }),
  getSkillRegistry: () => ({
    list: async () => ({ ok: true, value: [] }),
    commit: async (_capability: unknown, command: unknown) => {
      state.skillCommits.push(command);
      return { ok: true, value: { kind: "SKILL" } };
    },
  }),
}));

function mcpBody() {
  return {
    idempotency_key: "mcp-route-commit-1",
    expected_head_version: null,
    target_lifecycle: "ENABLED",
    revision: {
      schema_version: "mcp-server-revision@1.0.0",
      server_id: id(5),
      revision: 1,
      endpoint: "https://mcp.example.test/v1",
      secret_ref_id: null,
      trust_class: "EXTERNAL_REVIEWED",
      approval_status: "APPROVED",
      audience: "PRIVATE",
      manifest_version: "semantic@1",
      tools: [
        {
          tool_id: "list_metrics",
          name: "List metrics",
          description: "List governed metrics.",
          input_schema_hash: hash("1"),
          output_schema_hash: hash("2"),
          effect_semantics: "READ_ONLY",
          remote_idempotency_key_field: null,
          outcome_status_tool_id: null,
          required_capabilities: ["semantic.read"],
          max_timeout_ms: 10_000,
          max_response_bytes: 1_000_000,
        },
      ],
      policy_revision: 1,
    },
  };
}

function skillBody() {
  return {
    idempotency_key: "skill-route-commit-1",
    expected_head_version: null,
    target_lifecycle: "QUARANTINED",
    revision: {
      schema_version: "skill-revision@1.0.0",
      skill_id: id(6),
      revision: 1,
      name: "Commerce analyst",
      source_url: "https://skills.example.test/commerce.json",
      package_hash: hash("3"),
      dependency_lock_hash: hash("4"),
      signer_id: id(7),
      signature_hash: hash("5"),
      publisher_trust: "WORKSPACE_SIGNER",
      approval_status: "QUARANTINED",
      capabilities: ["semantic.read"],
      default_resources: [],
      install_scripts: [],
    },
  };
}

describe("workspace extension routes", () => {
  beforeEach(() => {
    state.role = "OWNER";
    state.accesses = [];
    state.mcpCommits = [];
    state.skillCommits = [];
    state.mcpListEnabledOnly = [];
  });

  it("injects authorized scope and hashes an MCP Revision before Registry commit", async () => {
    const route = await import("../src/app/api/workspaces/[workspaceId]/mcp-servers/route");
    const response = await route.POST(
      new NextRequest("http://localhost/mcp-servers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mcpBody()),
      }),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(response.status).toBe(201);
    expect(state.accesses).toEqual(["WRITE"]);
    expect(state.mcpCommits).toHaveLength(1);
    expect(state.mcpCommits[0]).toMatchObject({
      operation_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      revision: { scope, revision_hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) },
    });
  });

  it("rejects an analyst mutation before opening the Registry", async () => {
    state.role = "ANALYST";
    const route = await import("../src/app/api/workspaces/[workspaceId]/mcp-servers/route");
    const response = await route.POST(
      new NextRequest("http://localhost/mcp-servers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mcpBody()),
      }),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(response.status).toBe(403);
    expect(state.mcpCommits).toEqual([]);
  });

  it("validates list filters and forwards an exact enabled-only selection", async () => {
    const route = await import("../src/app/api/workspaces/[workspaceId]/mcp-servers/route");
    const accepted = await route.GET(
      new NextRequest("http://localhost/mcp-servers?enabled_only=true"),
      { params: Promise.resolve({ workspaceId }) },
    );
    const rejected = await route.GET(
      new NextRequest("http://localhost/mcp-servers?enabled_only=latest"),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(accepted.status).toBe(200);
    expect(rejected.status).toBe(400);
    expect(state.mcpListEnabledOnly).toEqual([true]);
  });

  it("builds a quarantined Skill Revision with fixed empty install scripts", async () => {
    const route = await import("../src/app/api/workspaces/[workspaceId]/skills/route");
    const response = await route.POST(
      new NextRequest("http://localhost/skills", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(skillBody()),
      }),
      { params: Promise.resolve({ workspaceId }) },
    );
    expect(response.status).toBe(201);
    expect(state.skillCommits[0]).toMatchObject({
      target_lifecycle: "QUARANTINED",
      revision: {
        scope,
        install_scripts: [],
        revision_hash: expect.stringMatching(/^sha256:/),
      },
    });
  });
});
