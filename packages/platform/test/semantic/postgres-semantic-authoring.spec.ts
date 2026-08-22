import {
  type AuthoritativeModelProviderInvocation,
  BUILTIN_SEMANTIC_EDGE_TYPES,
  BUILTIN_SEMANTIC_NODE_TYPES,
  SEMANTIC_AUTHORING_CHECKPOINT_VERSION,
  SEMANTIC_AUTHORING_POLICY_VERSION,
  SEMANTIC_AUTHORING_RUN_VERSION,
  SEMANTIC_GRAPH_SOURCE_VERSION,
  type SemanticAuthoringState,
  type SemanticGraphSource,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import type { SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresSemanticAuthoringStore } from "../../src/semantic/postgres-semantic-authoring.js";
import { createPostgresSemanticAuthoringProviderInvocation } from "../../src/semantic/postgres-semantic-authoring-provider-invocation.js";
import { createPostgresSemanticAuthoringQueue } from "../../src/semantic/postgres-semantic-authoring-queue.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const ids = {
  app: "00000000-0000-4000-8000-000000000401",
  tenant: "00000000-0000-4000-8000-000000000402",
  deployment: "00000000-0000-4000-8000-000000000403",
  principal: "00000000-0000-4000-8000-000000000404",
  graph: "00000000-0000-4000-8000-000000000405",
  candidate: "00000000-0000-4000-8000-000000000406",
  run: "00000000-0000-4000-8000-000000000407",
  request: "00000000-0000-4000-8000-000000000408",
  lease: "00000000-0000-4000-8000-000000000409",
  attempt: "00000000-0000-4000-8000-000000000410",
} as const;
const digest = `sha256:${"a".repeat(64)}` as const;
const timestamp = "2026-08-15T00:00:00.000Z";

const graph: SemanticGraphSource = {
  metadata: {
    graph_version: SEMANTIC_GRAPH_SOURCE_VERSION,
    graph_id: ids.graph,
    domain_id: "ecommerce",
    base_release_id: null,
    capability_profile: "U5_EXECUTABLE_SUBSET",
    scope: { app_id: ids.app, tenant_id: ids.tenant, environment: "test" },
    producer: { kind: "deterministic", id: "platform-test" },
    authority: {
      kind: "deterministic",
      id: "semantic-authority",
      policy_version: "semantic-authority@2.0.0",
    },
    created_at: timestamp,
  },
  node_type_registry: [...BUILTIN_SEMANTIC_NODE_TYPES],
  edge_type_registry: [...BUILTIN_SEMANTIC_EDGE_TYPES],
  evidence: [],
  nodes: [
    {
      node_id: "subject-order",
      node_version: 1,
      node_type: "BUSINESS_SUBJECT",
      name: "订单",
      aliases: [],
      owner_ref: "data-team",
      lifecycle: "ACTIVE",
      evidence_refs: [],
      tags: [],
      domain: "ecommerce",
    },
  ],
  edges: [],
};

const checkpoint = {
  checkpoint_version: SEMANTIC_AUTHORING_CHECKPOINT_VERSION,
  messages: [{ role: "user" as const, content: "新增成交商品数" }],
  pending_agent_request: null,
  read_node_ids: [],
  read_edge_ids: [],
  searches: [],
  pending_tool_calls: [],
  last_validation: null,
};

const state: SemanticAuthoringState = {
  run: {
    schema_version: SEMANTIC_AUTHORING_RUN_VERSION,
    authority: "POSTGRESQL",
    scope: graph.metadata.scope,
    semantic_domain: "ecommerce",
    authoring_run_id: ids.run,
    candidate_id: ids.candidate,
    graph_id: ids.graph,
    base_release_id: null,
    principal_id: ids.principal,
    policy_version: SEMANTIC_AUTHORING_POLICY_VERSION,
    status: "RUNNING",
    working_revision: 0,
    graph_digest: digest,
    writer_fence: 1,
    current_turn: 0,
    pending_request_digest: null,
    used_tool_calls: 0,
    budget: { max_turns: 8, max_tool_calls: 32 },
    validation_receipt_digest: null,
    clarification: null,
    created_at: timestamp,
    updated_at: timestamp,
  },
  working_graph: graph,
  checkpoint,
  event_sequence: 0,
};

function authority() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: ids.deployment, app_id: ids.app, environment: "test" }],
    [
      {
        subject: ids.principal,
        deployment_id: ids.deployment,
        tenant_id: ids.tenant,
        role: "ANALYST",
      },
    ],
  );
  const resolved = registry.resolveForDeployment(ids.deployment, { subject: ids.principal });
  if (!resolved.ok) throw new Error("fixture");
  return {
    authorizer: asTransactionalTestAuthority(registry.authorizer),
    capability: resolved.value,
  };
}

function scriptedPool(
  handle: (text: string, values: readonly unknown[]) => SqlQueryResult | undefined,
) {
  const calls: Array<{ readonly text: string; readonly values: readonly unknown[] }> = [];
  const pool: SqlPool = {
    async connect() {
      return {
        async query<Row extends object = Record<string, unknown>>(text: string, values = []) {
          calls.push({ text, values });
          const result = handle(text, values);
          if (result) return result as SqlQueryResult<Row>;
          if (text.includes("backend_context_matches")) {
            return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
          }
          return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
        },
        release() {},
      };
    },
  };
  return { pool, calls };
}

describe("PostgreSQL semantic authoring store", () => {
  it("starts through the bound scope/domain RPC without direct table access", async () => {
    const current = authority();
    const fixture = scriptedPool((text) =>
      text.includes("semantic.start_semantic_studio_authoring")
        ? { rows: [{ value: state }], rowCount: 1 }
        : undefined,
    );
    const store = createPostgresSemanticAuthoringStore({
      pool: fixture.pool,
      authorizer: current.authorizer,
      capability: current.capability,
      semantic_domain: "ecommerce",
    });
    const input = {
      schema_version: "semantic-authoring-start@1.0.0" as const,
      scope: graph.metadata.scope,
      semantic_domain: "ecommerce",
      authoring_run_id: ids.run,
      candidate_id: ids.candidate,
      principal_id: ids.principal,
      policy_version: SEMANTIC_AUTHORING_POLICY_VERSION,
      base_release_id: null,
      base_graph: graph,
      instruction: "新增成交商品数",
      budget: { max_turns: 8, max_tool_calls: 32 },
      idempotency_key: "semantic-authoring-platform-test",
    };
    await expect(store.start(input)).resolves.toEqual({ ok: true, value: state });
    const rpc = fixture.calls.find((item) => item.text.includes("start_semantic_studio_authoring"));
    expect(rpc?.values).toEqual([ids.app, ids.tenant, "test", ids.principal, "ecommerce", input]);
    expect(fixture.calls.some((item) => /insert\s+into\s+semantic\./iu.test(item.text))).toBe(
      false,
    );
  });

  it("serializes top-level event arrays as JSON for PostgreSQL jsonb parameters", async () => {
    const current = authority();
    const fixture = scriptedPool((text) =>
      text.includes("semantic.begin_semantic_authoring_turn")
        ? { rows: [{ value: state }], rowCount: 1 }
        : undefined,
    );
    const store = createPostgresSemanticAuthoringStore({
      pool: fixture.pool,
      authorizer: current.authorizer,
      capability: current.capability,
      semantic_domain: "ecommerce",
    });
    const events = [
      {
        schema_version: "semantic-authoring-public-event@1.0.0" as const,
        event_id: "00000000-0000-4000-8000-000000000408",
        run_id: ids.run,
        sequence: 1,
        occurred_at: timestamp,
        type: "stage" as const,
        payload: {
          phase: "AGENT_TURN" as const,
          summary: "开始 Agent turn 1",
          status: "RUNNING" as const,
        },
      },
    ];

    await expect(
      store.beginTurn({
        authoring_run_id: ids.run,
        expected_writer_fence: 1,
        expected_turn: 0,
        request_digest: state.run.graph_digest,
        checkpoint: state.checkpoint,
        events,
      }),
    ).resolves.toEqual({ ok: true, value: state });
    const rpc = fixture.calls.find((item) =>
      item.text.includes("semantic.begin_semantic_authoring_turn"),
    );
    expect(rpc?.values?.at(-1)).toBe(JSON.stringify(events));
  });

  it("maps stale fenced writes to a retryable redacted conflict", async () => {
    const current = authority();
    const fixture = scriptedPool((text) => {
      if (text.includes("semantic.fail_semantic_authoring")) {
        throw new Error("SEMANTIC_AUTHORING_FAIL_CONFLICT");
      }
      return undefined;
    });
    const store = createPostgresSemanticAuthoringStore({
      pool: fixture.pool,
      authorizer: current.authorizer,
      capability: current.capability,
      semantic_domain: "ecommerce",
    });
    const result = await store.fail({
      authoring_run_id: ids.run,
      expected_writer_fence: 1,
      error_code: "SEMANTIC_AGENT_FAILED",
      event: {
        schema_version: "semantic-authoring-public-event@1.0.0",
        event_id: "00000000-0000-4000-8000-000000000408",
        run_id: ids.run,
        sequence: 1,
        occurred_at: timestamp,
        type: "authoring_terminal",
        payload: {
          status: "FAILED",
          summary: "失败",
          error_code: "SEMANTIC_AGENT_FAILED",
        },
      },
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "SEMANTIC_AUTHORING_CONFLICT",
        message: "语义创作状态已变化，请从最新 checkpoint 恢复。",
        retryable: true,
      },
    });
  });
});

describe("PostgreSQL semantic authoring Provider lifecycle", () => {
  it("persists intent, dispatch, observation, and terminal through exact domain-scoped RPCs", async () => {
    const current = authority();
    const fixture = scriptedPool((text) =>
      text.includes("semantic.commit_authoring_provider_intent") ||
      text.includes("semantic.mark_authoring_provider_dispatched") ||
      text.includes("semantic.mark_authoring_provider_response_observed") ||
      text.includes("semantic.commit_authoring_provider_terminal")
        ? { rows: [{ value: true }], rowCount: 1 }
        : undefined,
    );
    const lifecycle = createPostgresSemanticAuthoringProviderInvocation({
      pool: fixture.pool,
      authorizer: current.authorizer,
      capability: current.capability,
      semantic_domain: "ecommerce",
    });
    const request = {
      schema_version: "semantic-provider@1",
      request_id: ids.request,
      attempt_id: ids.attempt,
      scope: graph.metadata.scope,
      run_id: ids.run,
      provider: "deepseek",
      profile_id: "00000000-0000-4000-8000-000000000411",
      profile_version: "semantic-profile@1.0.0",
      model_id: "deepseek-v4-flash",
      task_ref: {
        artifact_id: ids.candidate,
        artifact_type: "SemanticGraphCandidate",
        ...graph.metadata.scope,
        run_id: ids.run,
        revision: 1,
        content_hash: digest,
      },
      context_refs: [],
      messages: [{ role: "user", content: "生成语义关系" }],
      tool_allowlist: [],
      response_schema_version: "semantic-agent-turn@1.0.0",
      budget: {
        timeout_ms: 60_000,
        max_input_tokens: 1_000,
        max_output_tokens: 1_000,
        max_tool_calls: 0,
      },
    } as unknown as AuthoritativeModelProviderInvocation;
    const completed = {
      schema_version: "semantic-provider-event@1",
      event_type: "COMPLETED" as const,
      request_id: ids.request,
      attempt_id: ids.attempt,
      scope: graph.metadata.scope,
      run_id: ids.run,
      provider: "deepseek" as const,
      profile_id: "00000000-0000-4000-8000-000000000411",
      profile_version: "semantic-profile@1.0.0",
      model_id: "deepseek-v4-flash",
      sequence: 2,
      observed_at: timestamp,
      output_text: "完成",
      response_hash: digest,
      usage: {
        availability: "AVAILABLE" as const,
        source: "PROVIDER_REPORTED" as const,
        input_tokens: 12,
        output_tokens: 2,
        tool_calls: 0,
        unavailable_reason: null,
      },
    };

    await expect(lifecycle.commitIntent(request)).resolves.toBe(true);
    await expect(lifecycle.markDispatched(request)).resolves.toBeUndefined();
    await expect(
      lifecycle.markResponseObserved({ request, event: completed }),
    ).resolves.toBeUndefined();
    await expect(lifecycle.commitTerminal({ request, event: completed })).resolves.toBeUndefined();

    const rpcCalls = fixture.calls.filter(
      (call) => call.text.includes("semantic.") && call.values.length > 5,
    );
    expect(rpcCalls.map((call) => call.text.match(/semantic\.([a-z_]+)/u)?.[1])).toEqual([
      "commit_authoring_provider_intent",
      "mark_authoring_provider_dispatched",
      "mark_authoring_provider_response_observed",
      "commit_authoring_provider_terminal",
    ]);
    expect(
      rpcCalls.every(
        (call) =>
          call.values.slice(0, 5).join(":") ===
          [ids.app, ids.tenant, "test", ids.principal, "ecommerce"].join(":"),
      ),
    ).toBe(true);
  });
});

describe("PostgreSQL semantic authoring queue", () => {
  const claimedState: SemanticAuthoringState = {
    ...state,
    run: { ...state.run, writer_fence: 2 },
  };
  const lease = {
    schema_version: "semantic-authoring-lease@1.0.0" as const,
    scope: graph.metadata.scope,
    semantic_domain: "ecommerce",
    authoring_run_id: ids.run,
    principal_id: ids.principal,
    worker_id: "semantic-worker-test",
    lease_token: ids.lease,
    writer_fence: 2,
    claimed_at: timestamp,
    expires_at: "2026-08-15T00:05:00.000Z",
  };

  it("claims through one principal-bound RPC and returns the incremented writer fence", async () => {
    const current = authority();
    const fixture = scriptedPool((text) =>
      text.includes("semantic.claim_semantic_authoring_run")
        ? { rows: [{ value: { lease, state: claimedState } }], rowCount: 1 }
        : undefined,
    );
    const queue = createPostgresSemanticAuthoringQueue({
      pool: fixture.pool,
      authorizer: current.authorizer,
      capability: current.capability,
      semantic_domain: "ecommerce",
    });

    await expect(
      queue.claimNext({
        scope: graph.metadata.scope,
        worker_id: "semantic-worker-test",
        lease_duration_ms: 300_000,
      }),
    ).resolves.toEqual({ ok: true, value: { lease, state: claimedState } });
    const rpc = fixture.calls.find((item) => item.text.includes("claim_semantic_authoring_run"));
    expect(rpc?.values).toEqual([
      ids.app,
      ids.tenant,
      "test",
      ids.principal,
      "ecommerce",
      "semantic-worker-test",
      300_000,
    ]);
    expect(fixture.calls.some((item) => /update\s+semantic\./iu.test(item.text))).toBe(false);
  });

  it("heartbeats and releases only the exact opaque lease", async () => {
    const current = authority();
    const fixture = scriptedPool((text) => {
      if (text.includes("semantic.heartbeat_semantic_authoring_run")) {
        return { rows: [{ value: lease }], rowCount: 1 };
      }
      if (text.includes("semantic.release_semantic_authoring_run")) {
        return { rows: [{ value: true }], rowCount: 1 };
      }
      return undefined;
    });
    const queue = createPostgresSemanticAuthoringQueue({
      pool: fixture.pool,
      authorizer: current.authorizer,
      capability: current.capability,
      semantic_domain: "ecommerce",
    });

    await expect(queue.heartbeat({ lease, lease_duration_ms: 300_000 })).resolves.toEqual({
      ok: true,
      value: lease,
    });
    await expect(queue.release({ lease })).resolves.toEqual({ ok: true, value: null });
    expect(
      fixture.calls.find((item) => item.text.includes("heartbeat_semantic_authoring_run"))?.values,
    ).toEqual([
      ids.app,
      ids.tenant,
      "test",
      ids.principal,
      "ecommerce",
      ids.run,
      "semantic-worker-test",
      ids.lease,
      2,
      300_000,
    ]);
  });

  it("maps stale lease takeover to one retryable public error", async () => {
    const current = authority();
    const fixture = scriptedPool((text) => {
      if (text.includes("semantic.heartbeat_semantic_authoring_run")) {
        throw new Error("SEMANTIC_AUTHORING_LEASE_STALE");
      }
      return undefined;
    });
    const queue = createPostgresSemanticAuthoringQueue({
      pool: fixture.pool,
      authorizer: current.authorizer,
      capability: current.capability,
      semantic_domain: "ecommerce",
    });

    await expect(queue.heartbeat({ lease, lease_duration_ms: 300_000 })).resolves.toEqual({
      ok: false,
      error: {
        code: "SEMANTIC_AUTHORING_LEASE_STALE",
        message: "语义创作租约已失效，Worker 必须停止写入并重新领取。",
        retryable: true,
      },
    });
  });
});
