import { describe, expect, it } from "vitest";
import type { SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresRelationshipIndexStore } from "../../src/semantic/postgres-relationship-index.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const ids = {
  app: "00000000-0000-4000-8000-000000000001",
  tenant: "00000000-0000-4000-8000-000000000002",
  deployment: "00000000-0000-4000-8000-000000000003",
  principal: "00000000-0000-4000-8000-000000000004",
  release: "00000000-0000-4000-8000-000000000005",
  projection: "00000000-0000-4000-8000-000000000006",
  attempt: "00000000-0000-4000-8000-000000000007",
  worker: "00000000-0000-4000-8000-000000000008",
  build: "00000000-0000-4000-8000-000000000009",
} as const;
const hash = (digit: string) => `sha256:${digit.repeat(64)}` as const;

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

describe("PostgreSQL relationship index store", () => {
  it("claims through the fenced RPC after establishing the semantic domain", async () => {
    const current = authority();
    const fixture = scriptedPool((text) =>
      text.includes("semantic.claim_relationship_index_job")
        ? {
            rows: [
              {
                value: {
                  semantic_domain: "revenue",
                  release_id: ids.release,
                  release_generation: 3,
                  release_digest: hash("a"),
                  relationship_projection_id: ids.projection,
                  relationship_projection_digest: hash("b"),
                  attempt_id: ids.attempt,
                  attempt_fence: 2,
                  worker_id: ids.worker,
                  lease_expires_at: "2026-08-09T01:00:00.000Z",
                },
              },
            ],
            rowCount: 1,
          }
        : undefined,
    );

    const result = await createPostgresRelationshipIndexStore({
      pool: fixture.pool,
      authorizer: current.authorizer,
    }).claim(current.capability, {
      semantic_domain: "revenue",
      worker_id: ids.worker,
      lease_seconds: 120,
    });

    expect(result).toMatchObject({
      ok: true,
      value: { release_id: ids.release, attempt_id: ids.attempt, attempt_fence: 2 },
    });
    const domain = fixture.calls.find((call) => call.text.includes("app.semantic_domain"));
    const rpc = fixture.calls.find((call) =>
      call.text.includes("semantic.claim_relationship_index_job"),
    );
    expect(domain?.values).toEqual(["revenue"]);
    expect(rpc?.values).toEqual([
      ids.app,
      ids.tenant,
      "test",
      ids.principal,
      "revenue",
      ids.worker,
      120,
    ]);
    if (!domain || !rpc) throw new Error("expected calls");
    expect(fixture.calls.indexOf(domain)).toBeLessThan(fixture.calls.indexOf(rpc));
  });

  it("maps a stale heartbeat to a stable redacted error", async () => {
    const current = authority();
    const fixture = scriptedPool((text) => {
      if (text.includes("semantic.heartbeat_relationship_index_attempt")) {
        throw new Error("SEMANTIC_RELATIONSHIP_INDEX_ATTEMPT_STALE");
      }
      return undefined;
    });

    const result = await createPostgresRelationshipIndexStore({
      pool: fixture.pool,
      authorizer: current.authorizer,
    }).heartbeat(current.capability, {
      semantic_domain: "revenue",
      attempt_id: ids.attempt,
      attempt_fence: 1,
      worker_id: ids.worker,
      lease_seconds: 30,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "SEMANTIC_RELATIONSHIP_INDEX_ATTEMPT_STALE",
        message: "关系索引租约已失效或 fencing token 不再有效。",
        retryable: false,
      },
    });
    expect(fixture.calls.some((call) => call.text === "ROLLBACK")).toBe(true);
  });

  it("requeues only the exact READY build and manifest through the fenced RPC", async () => {
    const current = authority();
    const checkpoint = {
      schema_version: "semantic-relationship-index-checkpoint@1.0.0",
      semantic_domain: "revenue",
      release_identity: {
        semantic_domain: "revenue",
        release_id: ids.release,
        release_generation: 3,
        release_digest: hash("a"),
        executable_projection: { projection_id: ids.projection, projection_digest: hash("c") },
        relationship_projection: { projection_id: ids.projection, projection_digest: hash("b") },
        runtime_restriction_projection: {
          projection_id: ids.projection,
          projection_digest: hash("d"),
        },
        published_at: "2026-08-09T00:00:00.000Z",
        published_by: ids.principal,
      },
      state: "STALE",
      attempt_id: ids.attempt,
      attempt_fence: 2,
      build_id: ids.build,
      manifest_digest: hash("e"),
      relationship_projection_digest: hash("b"),
      node_count: 10,
      edge_count: 12,
      reason_code: "INDEX_NOT_READY",
      observed_at: "2026-08-09T00:01:00.000Z",
      indexed_at: null,
    } as const;
    const fixture = scriptedPool((text) =>
      text.includes("semantic.requeue_relationship_index_release")
        ? { rows: [{ value: checkpoint }], rowCount: 1 }
        : undefined,
    );

    const result = await createPostgresRelationshipIndexStore({
      pool: fixture.pool,
      authorizer: current.authorizer,
    }).requeue(current.capability, {
      semantic_domain: "revenue",
      release_id: ids.release,
      expected_build_id: ids.build,
      expected_manifest_digest: hash("e"),
      reason_code: "INDEX_NOT_READY",
    });

    expect(result).toEqual({ ok: true, value: checkpoint });
    expect(
      fixture.calls.find((call) =>
        call.text.includes("semantic.requeue_relationship_index_release"),
      )?.values,
    ).toEqual([
      ids.app,
      ids.tenant,
      "test",
      ids.principal,
      "revenue",
      ids.release,
      ids.build,
      hash("e"),
      "INDEX_NOT_READY",
    ]);
  });
});
