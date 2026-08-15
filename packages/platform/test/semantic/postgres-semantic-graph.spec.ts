import {
  SEMANTIC_GRAPH_PROJECTION_VERSION,
  type SemanticGraphProjection,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import type { SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresSemanticGraphStore } from "../../src/semantic/postgres-semantic-graph.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const ids = {
  app: "00000000-0000-4000-8000-000000000301",
  tenant: "00000000-0000-4000-8000-000000000302",
  deployment: "00000000-0000-4000-8000-000000000303",
  principal: "00000000-0000-4000-8000-000000000304",
  graph: "00000000-0000-4000-8000-000000000305",
  source: "00000000-0000-4000-8000-000000000306",
  projection: "00000000-0000-4000-8000-000000000307",
  release: "00000000-0000-4000-8000-000000000308",
} as const;
const hash = (digit: string) => `sha256:${digit.repeat(64)}` as const;

const projection: SemanticGraphProjection = {
  projection_version: SEMANTIC_GRAPH_PROJECTION_VERSION,
  graph_id: ids.graph,
  source_digest: hash("1"),
  registry_digest: hash("2"),
  compiler_version: "semantic-graph-compiler@2.0.0",
  node_count: 0,
  edge_count: 0,
  nodes: [],
  edges: [],
};

const receipt = {
  projection_id: ids.projection,
  graph_id: ids.graph,
  source_revision_id: ids.source,
  source_revision_digest: hash("4"),
  source_digest: hash("1"),
  registry_digest: hash("2"),
  compiler_version: "semantic-graph-compiler@2.0.0",
  projection_storage_digest: hash("3"),
  node_count: 0,
  edge_count: 0,
  created_at: "2026-08-15T12:00:00.000Z",
  created: true,
} as const;

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

describe("PostgreSQL semantic graph projection store", () => {
  it("commits a compiler projection only through the scoped authority RPC", async () => {
    const current = authority();
    const fixture = scriptedPool((text) =>
      text.includes("semantic.commit_semantic_graph_projection")
        ? { rows: [{ value: receipt }], rowCount: 1 }
        : undefined,
    );

    const result = await createPostgresSemanticGraphStore({
      pool: fixture.pool,
      authorizer: current.authorizer,
    }).commit(current.capability, {
      semantic_domain: "ecommerce",
      projection_id: ids.projection,
      source_revision_id: ids.source,
      projection,
    });

    expect(result).toEqual({ ok: true, value: receipt });
    const domainCall = fixture.calls.find((call) => call.text.includes("app.semantic_domain"));
    const rpcCall = fixture.calls.find((call) =>
      call.text.includes("semantic.commit_semantic_graph_projection"),
    );
    expect(domainCall?.values).toEqual(["ecommerce"]);
    expect(rpcCall?.values).toEqual([
      ids.app,
      ids.tenant,
      "test",
      ids.principal,
      "ecommerce",
      ids.projection,
      ids.source,
      projection,
    ]);
    if (!domainCall || !rpcCall) throw new Error("expected calls");
    expect(fixture.calls.indexOf(domainCall)).toBeLessThan(fixture.calls.indexOf(rpcCall));
  });

  it("maps idempotency mismatches to a stable redacted conflict", async () => {
    const current = authority();
    const fixture = scriptedPool((text) => {
      if (text.includes("semantic.commit_semantic_graph_projection")) {
        throw new Error("SEMANTIC_GRAPH_PROJECTION_IDEMPOTENCY_CONFLICT");
      }
      return undefined;
    });
    const result = await createPostgresSemanticGraphStore({
      pool: fixture.pool,
      authorizer: current.authorizer,
    }).commit(current.capability, {
      semantic_domain: "ecommerce",
      projection_id: ids.projection,
      source_revision_id: ids.source,
      projection,
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "SEMANTIC_GRAPH_PROJECTION_CONFLICT",
        message: "该投影 ID 已绑定到不同的 Graph 内容。",
        retryable: false,
      },
    });
  });

  it("reads an exact projection through the same tenant/domain boundary", async () => {
    const current = authority();
    const fixture = scriptedPool((text) =>
      text.includes("semantic.get_semantic_graph_projection")
        ? { rows: [{ value: projection }], rowCount: 1 }
        : undefined,
    );
    const result = await createPostgresSemanticGraphStore({
      pool: fixture.pool,
      authorizer: current.authorizer,
    }).get(current.capability, "ecommerce", ids.projection);
    expect(result).toEqual({ ok: true, value: projection });
  });
});
