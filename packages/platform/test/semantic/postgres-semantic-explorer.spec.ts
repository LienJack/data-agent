import { describe, expect, it } from "vitest";
import type { SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresSemanticExplorerReader } from "../../src/semantic/postgres-semantic-explorer.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const ids = {
  app: "00000000-0000-4000-8000-000000000001",
  tenant: "00000000-0000-4000-8000-000000000002",
  deployment: "00000000-0000-4000-8000-000000000003",
  principal: "00000000-0000-4000-8000-000000000004",
  release: "00000000-0000-4000-8000-000000000101",
  candidate: "00000000-0000-4000-8000-000000000102",
  revision: "00000000-0000-4000-8000-000000000103",
  sourceRevision: "00000000-0000-4000-8000-000000000104",
  executable: "00000000-0000-4000-8000-000000000105",
  relationship: "00000000-0000-4000-8000-000000000106",
  restriction: "00000000-0000-4000-8000-000000000107",
  datasource: "00000000-0000-4000-8000-000000000108",
} as const;
const hash = (digit: string) => `sha256:${digit.repeat(64)}` as const;

function capability() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: ids.deployment, app_id: ids.app, environment: "test" }],
    [
      {
        subject: ids.principal,
        deployment_id: ids.deployment,
        tenant_id: ids.tenant,
        role: "VIEWER",
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
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
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
  return { calls, pool };
}

function releaseIdentity() {
  return {
    semantic_domain: "revenue",
    release_id: ids.release,
    release_generation: 1,
    release_digest: hash("d"),
    executable_projection: {
      projection_id: ids.executable,
      projection_digest: hash("a"),
    },
    relationship_projection: {
      projection_id: ids.relationship,
      projection_digest: hash("b"),
    },
    runtime_restriction_projection: {
      projection_id: ids.restriction,
      projection_digest: hash("c"),
    },
    published_at: "2026-08-09T00:00:00.000Z",
    published_by: ids.principal,
  } as const;
}

function rawSource(sourceKind: "ACTIVE" | "HISTORICAL" = "ACTIVE") {
  return {
    source_kind: sourceKind,
    observed_at: "2026-08-09T00:01:00.000Z",
    pointer: {
      semantic_domain: "revenue",
      current_release_id: ids.release,
      current_release_generation: 1,
      current_release_digest: hash("d"),
      pointer_generation: 2,
      updated_at: "2026-08-09T00:00:30.000Z",
    },
    release: {
      semantic_domain: "revenue",
      release_id: ids.release,
      release_generation: 1,
      release_digest: hash("d"),
      compiler_bundle_digest: hash("e"),
      candidate_id: ids.candidate,
      executable_projection_ref: ids.executable,
      executable_projection_hash: hash("a"),
      relationship_projection_ref: ids.relationship,
      relationship_projection_hash: hash("b"),
      runtime_restriction_projection_ref: ids.restriction,
      runtime_restriction_projection_hash: hash("c"),
      published_at: "2026-08-09T00:00:00.000Z",
      published_by: ids.principal,
    },
    executable_projection: {
      projection_id: ids.executable,
      release_id: ids.release,
      projection_digest: hash("a"),
      projection_payload: {},
    },
    relationship_projection: {
      projection_id: ids.relationship,
      release_id: ids.release,
      datasource_id: ids.datasource,
      catalog_epoch: 1,
      projection_digest: hash("b"),
      projection_payload: {},
    },
    runtime_restriction_projection: {
      projection_id: ids.restriction,
      release_id: ids.release,
      projection_digest: hash("c"),
      pointer_generation: 2,
      projection_payload: {},
    },
  } as const;
}

describe("PostgreSQL Semantic Explorer reader", () => {
  it("sets the domain fence and parses one active source envelope", async () => {
    const authority = capability();
    const scripted = scriptedPool((text) =>
      text.includes("semantic.get_active_explorer_source")
        ? { rows: [{ value: rawSource() }], rowCount: 1 }
        : undefined,
    );
    const result = await createPostgresSemanticExplorerReader({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    }).getActiveSource(authority.capability, "revenue");

    expect(result).toMatchObject({
      ok: true,
      value: { source_kind: "ACTIVE", release: { release_id: ids.release } },
    });
    const domainFence = scripted.calls.find((call) => call.text.includes("app.semantic_domain"));
    const rpc = scripted.calls.find((call) =>
      call.text.includes("semantic.get_active_explorer_source"),
    );
    if (!domainFence || !rpc) {
      throw new Error("Semantic Explorer reader did not issue the expected fenced RPC calls.");
    }
    expect(domainFence?.values).toEqual(["revenue"]);
    expect(rpc?.values).toEqual([ids.app, ids.tenant, "test", ids.principal, "revenue"]);
    expect(scripted.calls.indexOf(domainFence)).toBeLessThan(scripted.calls.indexOf(rpc));
  });

  it("parses domain summaries and the exact release timeline", async () => {
    const authority = capability();
    const pointer = {
      current_release_id: ids.release,
      current_release_generation: 1,
      current_release_digest: hash("d"),
      pointer_generation: 2,
      observed_at: "2026-08-09T00:01:00.000Z",
    };
    const domains = [
      {
        schema_version: "semantic-explorer-domain-summary@1.0.0",
        semantic_domain: "revenue",
        display_name: "Revenue",
        description: null,
        datasource_id: ids.datasource,
        pointer_observation: pointer,
        has_current_release: true,
      },
    ];
    const timeline = {
      schema_version: "semantic-explorer-release-timeline@1.0.0",
      semantic_domain: "revenue",
      pointer_observation: pointer,
      releases: [
        {
          schema_version: "semantic-explorer-release-summary@1.0.0",
          release_identity: releaseIdentity(),
          candidate_id: ids.candidate,
          is_current_at_observation: true,
        },
      ],
      next_generation_cursor: null,
    };
    const scripted = scriptedPool((text) => {
      if (text.includes("semantic.list_explorer_domains")) {
        return { rows: [{ value: domains }], rowCount: 1 };
      }
      if (text.includes("semantic.list_explorer_releases")) {
        return { rows: [{ value: timeline }], rowCount: 1 };
      }
      return undefined;
    });
    const reader = createPostgresSemanticExplorerReader({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    });

    expect(await reader.listDomains(authority.capability, ["revenue"])).toMatchObject({
      ok: true,
      value: [{ semantic_domain: "revenue", has_current_release: true }],
    });
    expect(
      await reader.listReleases(authority.capability, { semantic_domain: "revenue" }),
    ).toMatchObject({ ok: true, value: { releases: [{ is_current_at_observation: true }] } });
    const rpc = scripted.calls.find((call) => call.text.includes("list_explorer_releases"));
    expect(rpc?.values.slice(4)).toEqual(["revenue", 50, null]);
    const allowlistFence = scripted.calls.find((call) =>
      call.text.includes("app.semantic_allowed_domains"),
    );
    const domainRpc = scripted.calls.find((call) => call.text.includes("list_explorer_domains"));
    expect(allowlistFence?.values).toEqual(["revenue"]);
    expect(domainRpc?.values).toEqual([ids.app, ids.tenant, "test", ids.principal, ["revenue"]]);
  });

  it("parses historical source and keeps candidate comparison separate", async () => {
    const authority = capability();
    const candidate = {
      schema_version: "semantic-explorer-candidate-source@1.0.0",
      semantic_domain: "revenue",
      candidate_id: ids.candidate,
      revision_id: ids.revision,
      revision_number: 1,
      source_revision_id: ids.sourceRevision,
      candidate_status: "DRAFT",
      base_release: null,
      compared_release: releaseIdentity(),
      candidate_diff: {
        schema_version: "semantic-diff@1.0.0",
        summary: "Add gross margin",
        operations: [
          {
            path: "metrics.gross_margin",
            change_type: "ADD",
            after: { formula: "revenue-cost" },
          },
        ],
      },
    };
    const scripted = scriptedPool((text) => {
      if (text.includes("semantic.get_release_explorer_source")) {
        return { rows: [{ value: rawSource("HISTORICAL") }], rowCount: 1 };
      }
      if (text.includes("semantic.get_candidate_explorer_comparison")) {
        return { rows: [{ value: candidate }], rowCount: 1 };
      }
      return undefined;
    });
    const reader = createPostgresSemanticExplorerReader({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    });

    expect(
      await reader.getReleaseSource(authority.capability, {
        semantic_domain: "revenue",
        release_id: ids.release,
      }),
    ).toMatchObject({ ok: true, value: { source_kind: "HISTORICAL" } });
    expect(
      await reader.getCandidateComparison(authority.capability, {
        semantic_domain: "revenue",
        candidate_id: ids.candidate,
        revision_id: ids.revision,
      }),
    ).toMatchObject({
      ok: true,
      value: { base_release: null, compared_release: { release_id: ids.release } },
    });
  });

  it("maps binding markers and malformed rows without leaking database details", async () => {
    const authority = capability();
    let malformed = false;
    const scripted = scriptedPool((text) => {
      if (text.includes("semantic.get_active_explorer_source")) {
        if (malformed) return { rows: [{ value: { source_kind: "ACTIVE" } }], rowCount: 1 };
        throw Object.assign(new Error("SEMANTIC_EXPLORER_PROJECTION_IDENTITY_MISMATCH"), {
          code: "P0001",
        });
      }
      return undefined;
    });
    const reader = createPostgresSemanticExplorerReader({
      pool: scripted.pool,
      authorizer: authority.authorizer,
    });

    expect(await reader.getActiveSource(authority.capability, "revenue")).toEqual({
      ok: false,
      error: {
        code: "SEMANTIC_EXPLORER_SOURCE_BINDING_MISMATCH",
        message: "语义版本与其权威投影绑定不一致。",
        retryable: false,
      },
    });
    malformed = true;
    expect(await reader.getActiveSource(authority.capability, "revenue")).toMatchObject({
      ok: false,
      error: { code: "SEMANTIC_EXPLORER_INVALID_SOURCE_ENVELOPE", retryable: false },
    });
  });
});
