import {
  buildMcpServerRevision,
  buildToolEffectIntent,
  sha256ContentHash,
} from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { createGovernedMcpTransport } from "../../src/extensions/mcp-transport.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;

async function fixture() {
  const payload = { metric: "net_revenue" };
  const revision = await buildMcpServerRevision({
    schema_version: "mcp-server-revision@1.0.0",
    scope,
    server_id: id(3),
    revision: 1,
    endpoint: "https://mcp.example.test/v1",
    secret_ref_id: null,
    trust_class: "EXTERNAL_REVIEWED",
    approval_status: "APPROVED",
    audience: "PRIVATE",
    manifest_version: "commerce-mcp@1",
    tools: [
      {
        tool_id: "list_metrics",
        name: "List metrics",
        description: "List published metrics.",
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
  });
  const intent = await buildToolEffectIntent({
    schema_version: "tool-effect-intent@1.0.0",
    effect_id: id(4),
    scope,
    run_id: id(5),
    attempt_id: id(6),
    worker_fence: 3,
    task_capability_hash: hash("3"),
    projection_receipt_ref: {
      app_id: scope.app_id,
      tenant_id: scope.tenant_id,
      environment: scope.environment,
      run_id: id(5),
      artifact_id: id(7),
      artifact_type: "AgentDataProjectionReceipt",
      revision: 1,
      content_hash: hash("4"),
    },
    server_id: revision.server_id,
    server_revision: revision.revision,
    server_revision_hash: revision.revision_hash,
    tool_id: "list_metrics",
    effect_semantics: "READ_ONLY",
    remote_idempotency_key: null,
    request_payload_hash: await sha256ContentHash(payload),
    policy_revision: revision.policy_revision,
  });
  return { intent, payload, revision };
}

function effectAuthority() {
  const transitions: string[] = [];
  return {
    transitions,
    authority: {
      begin: vi.fn(async () => ({ ok: true as const, value: {} })),
      transition: vi.fn(async (_capability: unknown, transition: { target_state: string }) => {
        transitions.push(transition.target_state);
        return { ok: true as const, value: {} };
      }),
    },
  };
}

describe("governed MCP transport", () => {
  it("rejects private DNS before any network dispatch", async () => {
    const data = await fixture();
    const effects = effectAuthority();
    const send = vi.fn();
    const transport = createGovernedMcpTransport({
      dns: { resolve: async () => ["127.0.0.1"] },
      http: { send },
      effects: effects.authority,
      verify_task_capability: async () => true,
      verify_projection_receipt: async () => true,
    });
    await expect(
      transport.invoke({ capability: {}, ...data, tool_id: "list_metrics" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "MCP_ADDRESS_DENIED" },
    });
    expect(send).not.toHaveBeenCalled();
    expect(effects.transitions).toEqual(["FAILED"]);
  });

  it("marks DNS rebinding after dispatch authority as outcome unknown without network I/O", async () => {
    const data = await fixture();
    const effects = effectAuthority();
    const send = vi.fn();
    let resolution = 0;
    const transport = createGovernedMcpTransport({
      dns: { resolve: async () => (resolution++ === 0 ? ["8.8.8.8"] : ["1.1.1.1"]) },
      http: { send },
      effects: effects.authority,
      verify_task_capability: async () => true,
      verify_projection_receipt: async () => true,
    });
    await expect(
      transport.invoke({ capability: {}, ...data, tool_id: "list_metrics" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "TOOL_OUTCOME_UNKNOWN", retryable: true },
    });
    expect(send).not.toHaveBeenCalled();
    expect(effects.transitions).toEqual(["DISPATCH_MARKED", "TOOL_OUTCOME_UNKNOWN"]);
  });

  it("does not begin an effect when projection authority is missing", async () => {
    const data = await fixture();
    const effects = effectAuthority();
    const send = vi.fn();
    const transport = createGovernedMcpTransport({
      dns: { resolve: async () => ["8.8.8.8"] },
      http: { send },
      effects: effects.authority,
      verify_task_capability: async () => true,
      verify_projection_receipt: async () => false,
    });
    await expect(
      transport.invoke({ capability: {}, ...data, tool_id: "list_metrics" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "MCP_EGRESS_PROJECTION_REQUIRED" },
    });
    expect(effects.authority.begin).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("records response observation and terminal before releasing a successful body", async () => {
    const data = await fixture();
    const effects = effectAuthority();
    const body = new TextEncoder().encode('{"metrics":[]}');
    const send = vi.fn(async () => ({ status: 200, headers: {}, body }));
    const transport = createGovernedMcpTransport({
      dns: { resolve: async () => ["8.8.8.8"] },
      http: { send },
      effects: effects.authority,
      verify_task_capability: async () => true,
      verify_projection_receipt: async () => true,
    });
    const result = await transport.invoke({ capability: {}, ...data, tool_id: "list_metrics" });
    expect(result).toMatchObject({ ok: true, value: { status: 200 } });
    expect(effects.transitions).toEqual(["DISPATCH_MARKED", "RESPONSE_OBSERVED", "COMPLETED"]);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ address: "8.8.8.8", server_name: "mcp.example.test" }),
    );
  });

  it("does not follow a redirect to another host", async () => {
    const data = await fixture();
    const effects = effectAuthority();
    const send = vi.fn(async () => ({
      status: 302,
      headers: { location: "https://evil.example.test/steal" },
      body: new Uint8Array(),
    }));
    const transport = createGovernedMcpTransport({
      dns: { resolve: async () => ["8.8.8.8"] },
      http: { send },
      effects: effects.authority,
      verify_task_capability: async () => true,
      verify_projection_receipt: async () => true,
    });
    await expect(
      transport.invoke({ capability: {}, ...data, tool_id: "list_metrics" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "TOOL_OUTCOME_UNKNOWN" },
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(effects.transitions.at(-1)).toBe("TOOL_OUTCOME_UNKNOWN");
  });
});
