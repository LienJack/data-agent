import type {
  SqlPool,
  SqlQueryResult,
  TransactionalCapabilityAuthorizer,
} from "@data-agent/platform";
import { describe, expect, it, vi } from "vitest";
import { createDeploymentRegistry } from "../../../../packages/platform/src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../../../../packages/platform/test/support/transactional-authority.js";
import { createInternalAgentDataProjectionReceipt } from "../../src/providers/agent-data-projection-receipt.internal.js";
import { createPostgresAgentDataProjectionReceiptStore } from "../../src/providers/postgres-agent-data-projection-receipt-store.js";

const ids = {
  app: "83000000-0000-4000-8000-000000000001",
  workspace: "83000000-0000-4000-8000-000000000002",
  deployment: "83000000-0000-4000-8000-000000000003",
  principal: "83000000-0000-4000-8000-000000000004",
  run: "83000000-0000-4000-8000-000000000005",
  attempt: "83000000-0000-4000-8000-000000000006",
  outbox: "83000000-0000-4000-8000-000000000007",
  command: "83000000-0000-4000-8000-000000000008",
  request: "83000000-0000-4000-8000-000000000009",
  receipt: "83000000-0000-4000-8000-000000000009",
  source: "83000000-0000-4000-8000-000000000011",
  config: "83000000-0000-4000-8000-000000000012",
} as const;

const hash = (value: string) => `sha256:${value.repeat(64)}` as const;

function authority() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: ids.deployment, app_id: ids.app, environment: "test" }],
    [
      {
        subject: ids.principal,
        deployment_id: ids.deployment,
        tenant_id: ids.workspace,
        role: "ANALYST",
      },
    ],
  );
  const resolved = registry.resolveForDeployment(ids.deployment, { subject: ids.principal });
  if (!resolved.ok) throw new Error("fixture authority missing");
  return {
    capability: resolved.value,
    // Vitest resolves Platform source while Worker package types resolve the
    // built declaration's private symbol; both represent the same test-only
    // transactional adapter at runtime.
    authorizer: asTransactionalTestAuthority(
      registry.authorizer,
    ) as unknown as TransactionalCapabilityAuthorizer,
  };
}

function lease() {
  return {
    scope: { app_id: ids.app, tenant_id: ids.workspace, environment: "test" },
    principal_id: ids.principal,
    outbox_id: ids.outbox,
    run_id: ids.run,
    command_id: ids.command,
    command_kind: "START_L2_RESEARCH",
    attempt_id: ids.attempt,
    attempt_no: 1,
    delivery_attempt_no: 1,
    lease_duration_ms: 30_000,
    worker_id: "worker-projection",
    lease_token: 2,
    worker_fence: 3,
    expires_at: "2026-08-16T01:00:00.000Z",
    payload: {
      kind: "START_L2_RESEARCH",
      effective_config_ref: { config_id: ids.config, config_revision: 1, config_hash: hash("a") },
    },
  } as const;
}

async function receipt() {
  return createInternalAgentDataProjectionReceipt({
    document: {
      artifact_type: "AgentDataProjectionReceipt",
      protocol_version: "agent-data-projection@2.0.0",
      scope: { app_id: ids.app, tenant_id: ids.workspace, environment: "test" },
      run_id: ids.run,
      request_id: ids.request,
      principal_id: ids.principal,
      model_execution_profile_hash: hash("b"),
      input_refs: [
        {
          artifact_id: ids.source,
          artifact_type: "ResearchBrief",
          app_id: ids.app,
          tenant_id: ids.workspace,
          environment: "test",
          run_id: ids.run,
          revision: 1,
          content_hash: hash("c"),
        },
      ],
      approved_fields: ["question"],
      classification: "INTERNAL",
      payload_hash: hash("d"),
      token_bound_policy_version: "utf8-byte-upper-bound@1.0.0",
      trusted_input_token_upper_bound: 42,
      redaction: { count: 0, policy_version: "redaction@1.0.0" },
      dlp: { status: "PASS", policy_version: "dlp@1.0.0" },
      taint: { policy_version: "taint@1.0.0", taint_hash: hash("e") },
    },
  });
}

function fakePool() {
  let persisted: { content_hash: string; document_json: unknown } | null = null;
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  const pool: SqlPool = {
    async connect() {
      return {
        async query<Row extends object = Record<string, unknown>>(text: string, values = []) {
          calls.push({ text, values });
          let result: SqlQueryResult;
          if (text.includes("backend_context_matches")) {
            result = { rows: [{ allowed: true }], rowCount: 1 };
          } else if (text.includes("from app_data_agent.run_attempts")) {
            result = { rows: [{ allowed: true }], rowCount: 1 };
          } else if (text.includes("select 1 from app_data_agent.artifacts")) {
            result = { rows: [{ allowed: true }], rowCount: 1 };
          } else if (text.includes("select content_hash, document_json")) {
            result = { rows: persisted ? [persisted] : [], rowCount: persisted ? 1 : 0 };
          } else if (text.includes("insert into app_data_agent.artifacts")) {
            persisted = {
              content_hash: String(values[5]),
              document_json: JSON.parse(String(values[6])),
            };
            result = { rows: [], rowCount: 1 };
          } else {
            result = { rows: [], rowCount: 0 };
          }
          return result as SqlQueryResult<Row>;
        },
        release() {},
      };
    },
  };
  return { calls, pool };
}

describe("Postgres AgentDataProjectionReceipt store", () => {
  it("commits and exactly replays a branded v2 receipt after lease and input checks", async () => {
    const { capability, authorizer } = authority();
    const fake = fakePool();
    const store = createPostgresAgentDataProjectionReceiptStore({
      pool: fake.pool,
      authorizer,
      capability,
    });
    const document = await receipt();

    const first = await store.commit(lease(), document);
    const replay = await store.commit(lease(), document);
    if (!first.ok) throw new Error(first.error.code);

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      ok: true,
      value: {
        artifact_id: ids.receipt,
        artifact_type: "AgentDataProjectionReceipt",
        revision: 1,
        content_hash: document.receipt_hash,
      },
    });
    expect(
      fake.calls.filter((call) => call.text.includes("insert into app_data_agent.artifacts")),
    ).toHaveLength(1);
    expect(fake.calls.some((call) => call.text.includes("run_attempts"))).toBe(true);
    expect(
      fake.calls
        .filter((call) => call.text.includes("run_attempts"))
        .every((call) => call.text.includes("message.lease_expires_at")),
    ).toBe(true);

    const resolver = store.committedResolverForLease(lease());
    await expect(resolver.resolve_committed(first.value)).resolves.toEqual(document);
    await expect(
      resolver.resolve_committed({ ...first.value, content_hash: hash("f") }),
    ).resolves.toBeNull();
  });

  it("rejects a raw clone before opening PostgreSQL", async () => {
    const { capability, authorizer } = authority();
    const connect = vi.fn();
    const store = createPostgresAgentDataProjectionReceiptStore({
      pool: { connect } as SqlPool,
      authorizer,
      capability,
    });

    const result = await store.commit(lease(), { ...(await receipt()) } as never);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_DATA_PROJECTION_RECEIPT_INVALID", retryable: false },
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it("rejects the superseded trusted_actual_input_tokens wire before PostgreSQL", async () => {
    const { capability, authorizer } = authority();
    const connect = vi.fn();
    const store = createPostgresAgentDataProjectionReceiptStore({
      pool: { connect } as SqlPool,
      authorizer,
      capability,
    });
    const current = await receipt();
    const { trusted_input_token_upper_bound: _upperBound, ...withoutUpperBound } = current;
    const superseded = {
      ...withoutUpperBound,
      trusted_actual_input_tokens: 42,
    };

    const result = await store.commit(lease(), superseded as never);

    expect(result).toMatchObject({
      ok: false,
      error: { code: "AGENT_DATA_PROJECTION_RECEIPT_INVALID", retryable: false },
    });
    expect(connect).not.toHaveBeenCalled();
  });
});
