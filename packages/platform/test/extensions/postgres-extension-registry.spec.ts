import {
  buildMcpServerRevision,
  buildSkillRevision,
  buildToolEffectIntent,
  buildToolEffectTransition,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { createPostgresMcpRegistry } from "../../src/extensions/postgres-mcp-registry.js";
import { createPostgresSkillRegistry } from "../../src/extensions/postgres-skill-registry.js";
import { createPostgresToolEffectStore } from "../../src/extensions/postgres-tool-effect-store.js";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

function authority() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: id(90), app_id: id(1), environment: "test" }],
    [{ subject: id(2), deployment_id: id(90), tenant_id: id(3), role: "OWNER" }],
  );
  const capability = registry.resolveForDeployment(id(90), { subject: id(2) });
  if (!capability.ok) throw new Error("authority fixture failed");
  return {
    capability: capability.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

function poolWith(handler: (text: string, values: readonly unknown[]) => unknown) {
  const calls: { text: string; values: readonly unknown[] }[] = [];
  let connects = 0;
  const client: SqlClient = {
    async query<Row extends object = Record<string, unknown>>(text: string, values = []) {
      calls.push({ text, values });
      if (text.includes("backend_context_matches")) {
        return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
      }
      const value = handler(text, values);
      return {
        rows: value === undefined ? [] : [{ value }],
        rowCount: value === undefined ? 0 : 1,
      } as unknown as SqlQueryResult<Row>;
    },
    release() {},
  };
  return {
    calls,
    get connects() {
      return connects;
    },
    pool: {
      connect: async () => {
        connects += 1;
        return client;
      },
    } satisfies SqlPool,
  };
}

async function mcpRevision() {
  return buildMcpServerRevision({
    schema_version: "mcp-server-revision@1.0.0",
    scope: { app_id: id(1), tenant_id: id(3), environment: "test" },
    server_id: id(4),
    revision: 1,
    endpoint: "https://mcp.example.test/v1",
    secret_ref_id: id(5),
    trust_class: "EXTERNAL_REVIEWED",
    approval_status: "APPROVED",
    audience: "PRIVATE",
    manifest_version: "commerce-mcp@1",
    tools: [
      {
        tool_id: "list_metrics",
        name: "List metrics",
        description: "List metrics.",
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
}

async function skillRevision() {
  return buildSkillRevision({
    schema_version: "skill-revision@1.0.0",
    scope: { app_id: id(1), tenant_id: id(3), environment: "test" },
    skill_id: id(6),
    revision: 1,
    name: "Commerce Analyst",
    source_url: "https://skills.example.test/commerce.json",
    package_hash: hash("3"),
    dependency_lock_hash: hash("4"),
    signer_id: id(7),
    signature_hash: hash("5"),
    publisher_trust: "TRUSTED_PUBLISHER",
    approval_status: "APPROVED",
    capabilities: ["semantic.read"],
    default_resources: [],
    install_scripts: [],
  });
}

describe("PostgreSQL extension registries", () => {
  it("commits an exact MCP revision and correlates the RPC result", async () => {
    const auth = authority();
    const revision = await mcpRevision();
    const scripted = poolWith((text) =>
      text.includes("commit_extension_revision")
        ? {
            schema_version: "extension-revision-result@1.0.0",
            disposition: "COMMITTED",
            kind: "MCP_SERVER",
            object_id: revision.server_id,
            revision: revision.revision,
            revision_hash: revision.revision_hash,
            lifecycle: "ENABLED",
            head_version: 1,
          }
        : undefined,
    );
    const registry = createPostgresMcpRegistry({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });
    await expect(
      registry.commit(auth.capability, {
        operation_id: id(8),
        idempotency_key: "mcp:commit:1",
        expected_head_version: null,
        target_lifecycle: "ENABLED",
        revision,
      }),
    ).resolves.toMatchObject({ ok: true, value: { object_id: revision.server_id } });
    expect(scripted.calls.some(({ text }) => text.includes("commit_extension_revision"))).toBe(
      true,
    );
  });

  it("loads enabled Skill revisions and verifies their hashes", async () => {
    const auth = authority();
    const revision = await skillRevision();
    const scripted = poolWith((text) =>
      text.includes("list_extension_revisions")
        ? {
            schema_version: "extension-list@1.0.0",
            kind: "SKILL",
            items: [
              {
                schema_version: "skill-registry-item@1.0.0",
                revision,
                head: {
                  schema_version: "skill-head@1.0.0",
                  scope: revision.scope,
                  skill_id: revision.skill_id,
                  active_revision: revision.revision,
                  active_revision_hash: revision.revision_hash,
                  lifecycle: "ENABLED",
                  signer_revocation_version: 0,
                  version: 1,
                  updated_at: "2026-08-17T00:00:00.000Z",
                },
              },
            ],
          }
        : undefined,
    );
    const registry = createPostgresSkillRegistry({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });
    await expect(registry.list(auth.capability, true)).resolves.toEqual({
      ok: true,
      value: [
        {
          schema_version: "skill-registry-item@1.0.0",
          revision,
          head: expect.objectContaining({ lifecycle: "ENABLED", version: 1 }),
        },
      ],
    });
  });

  it("rejects a list projection whose mutable head substitutes another revision", async () => {
    const auth = authority();
    const revision = await mcpRevision();
    const scripted = poolWith((text) =>
      text.includes("list_extension_revisions")
        ? {
            schema_version: "extension-list@1.0.0",
            kind: "MCP_SERVER",
            items: [
              {
                schema_version: "mcp-server-registry-item@1.0.0",
                revision,
                head: {
                  schema_version: "mcp-server-head@1.0.0",
                  scope: revision.scope,
                  server_id: revision.server_id,
                  active_revision: revision.revision + 1,
                  active_revision_hash: revision.revision_hash,
                  lifecycle: "ENABLED",
                  version: 2,
                  updated_at: "2026-08-17T00:00:00.000Z",
                },
              },
            ],
          }
        : undefined,
    );
    const registry = createPostgresMcpRegistry({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });

    await expect(registry.list(auth.capability)).resolves.toMatchObject({
      ok: false,
      error: { code: "EXTENSION_DATABASE_CONTRACT_INVALID" },
    });
  });

  it("rejects a tampered revision before opening a transaction", async () => {
    const auth = authority();
    const revision = await mcpRevision();
    const scripted = poolWith(() => undefined);
    const registry = createPostgresMcpRegistry({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });
    await expect(
      registry.commit(auth.capability, {
        operation_id: id(9),
        idempotency_key: "mcp:commit:2",
        expected_head_version: null,
        target_lifecycle: "ENABLED",
        revision: { ...revision, endpoint: "https://other.example.test" },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "MCP_SERVER_REVISION_INVALID" } });
    expect(scripted.connects).toBe(0);
  });

  it("persists Tool Effect intent before applying a dispatch transition", async () => {
    const auth = authority();
    const intent = await buildToolEffectIntent({
      schema_version: "tool-effect-intent@1.0.0",
      effect_id: id(20),
      scope: auth.capability.scope,
      run_id: id(21),
      attempt_id: id(22),
      worker_fence: 3,
      task_capability_hash: hash("6"),
      projection_receipt_ref: {
        app_id: auth.capability.scope.app_id,
        tenant_id: auth.capability.scope.tenant_id,
        environment: auth.capability.scope.environment,
        run_id: id(21),
        artifact_id: id(23),
        artifact_type: "AgentDataProjectionReceipt",
        revision: 1,
        content_hash: hash("7"),
      },
      server_id: id(4),
      server_revision: 1,
      server_revision_hash: hash("8"),
      tool_id: "list_metrics",
      effect_semantics: "READ_ONLY",
      remote_idempotency_key: null,
      request_payload_hash: hash("9"),
      policy_revision: 1,
    });
    const transition = await buildToolEffectTransition({
      schema_version: "tool-effect-transition@1.0.0",
      transition_id: id(24),
      effect_id: intent.effect_id,
      expected_state: "INTENT_COMMITTED",
      target_state: "DISPATCH_MARKED",
      dispatch_hash: hash("a"),
      response_hash: null,
      delivery_certainty: "DISPATCHED_KNOWN",
      reason_code: "TOOL_DISPATCHED",
      reconciliation_of: null,
    });
    const scripted = poolWith((text) => {
      if (text.includes("begin_tool_effect"))
        return {
          schema_version: "tool-effect-result@1.0.0",
          disposition: "CREATED",
          effect_id: intent.effect_id,
          state: "INTENT_COMMITTED",
          version: 1,
          intent_hash: intent.intent_hash,
        };
      if (text.includes("transition_tool_effect"))
        return {
          schema_version: "tool-effect-result@1.0.0",
          disposition: "APPLIED",
          effect_id: intent.effect_id,
          state: "DISPATCH_MARKED",
          version: 2,
          intent_hash: intent.intent_hash,
        };
      return undefined;
    });
    const store = createPostgresToolEffectStore({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });
    await expect(store.begin(auth.capability, intent)).resolves.toMatchObject({
      ok: true,
      value: { state: "INTENT_COMMITTED" },
    });
    await expect(store.transition(auth.capability, transition)).resolves.toMatchObject({
      ok: true,
      value: { state: "DISPATCH_MARKED" },
    });
    const effectCalls = scripted.calls.filter(({ text }) => text.includes("tool_effect"));
    expect(effectCalls.map(({ text }) => text.includes("begin_tool_effect"))).toContain(true);
    expect(effectCalls.map(({ text }) => text.includes("transition_tool_effect"))).toContain(true);
  });
});
