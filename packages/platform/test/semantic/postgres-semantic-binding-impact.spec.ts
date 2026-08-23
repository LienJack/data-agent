import {
  buildSemanticBindingImpactAuthorityBundle,
  buildSemanticBindingImpactPlan,
  computeSemanticBindingImpactReceiptHash,
  uuidV8FromContentHash,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresSemanticBindingImpactStore } from "../../src/semantic/postgres-semantic-binding-impact.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;

function authority() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: id(90), app_id: id(1), environment: "test" }],
    [{ subject: id(2), deployment_id: id(90), tenant_id: id(3), role: "ANALYST" }],
  );
  const capability = registry.resolveForDeployment(id(90), { subject: id(2) });
  if (!capability.ok) throw new Error("authority fixture failed");
  return {
    capability: capability.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

function poolWith(rpcValue: (text: string) => unknown) {
  const calls: string[] = [];
  const client: SqlClient = {
    async query<Row extends object = Record<string, unknown>>(text: string) {
      calls.push(text);
      if (text.includes("backend_context_matches")) {
        return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
      }
      if (text.includes("semantic_binding_impact")) {
        return { rows: [{ value: rpcValue(text) }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
      }
      return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
    },
    release() {},
  };
  return { calls, pool: { connect: async () => client } satisfies SqlPool };
}

async function bundle(scope: { app_id: string; tenant_id: string; environment: string }) {
  return buildSemanticBindingImpactAuthorityBundle({
    schema_version: "semantic-binding-impact-authority@1.0.0",
    scope: { ...scope, semantic_domain: "sales" },
    datasource_id: "warehouse/main",
    drift: {
      event: {
        schema_version: "schema-drift-event@1.0.0",
        drift_event_id: id(4),
        datasource_id: "warehouse/main",
        datasource_fingerprint: hash("1"),
        base_snapshot_content_hash: hash("2"),
        current_snapshot_content_hash: hash("3"),
        observed_at: "2026-08-23T00:00:00.000Z",
        severity: "INFO",
        binding_impact: "UNKNOWN",
        operations: [
          {
            operation_kind: "RELATION_COMMENT_CHANGED",
            severity: "INFO",
            identity: { schema_name: "public", relation_name: "orders" },
            before: null,
            after: "Orders",
          },
        ],
      },
      event_storage_digest: hash("4"),
    },
    release: { release_id: id(5), generation: 1, release_digest: hash("5") },
    packages: [
      {
        namespace_id: id(6),
        package_id: id(7),
        package_version: 1,
        package_hash: hash("6"),
        objects: [],
        physical_mappings: [],
        metric_bindings: [],
        constraints: [],
        graph_edges: [],
      },
    ],
  });
}

describe("PostgreSQL semantic binding impact store", () => {
  it("loads and verifies exact authority for non-UUID datasource identities", async () => {
    const auth = authority();
    const document = await bundle(auth.capability.scope);
    const scripted = poolWith(() => document);
    const store = createPostgresSemanticBindingImpactStore({
      pool: scripted.pool,
      authorizer: auth.authorizer,
    });
    await expect(
      store.loadAuthority(auth.capability, {
        semantic_domain: "sales",
        datasource_id: "warehouse/main",
        drift_event_id: id(4),
      }),
    ).resolves.toEqual({ ok: true, value: document });
    expect(
      scripted.calls.some((text) => text.includes("load_semantic_binding_impact_authority")),
    ).toBe(true);
  });

  it("rejects a substituted authority hash at the database boundary", async () => {
    const auth = authority();
    const document = await bundle(auth.capability.scope);
    const store = createPostgresSemanticBindingImpactStore({
      pool: poolWith(() => ({ ...document, authority_input_hash: hash("f") })).pool,
      authorizer: auth.authorizer,
    });
    await expect(
      store.loadAuthority(auth.capability, {
        semantic_domain: "sales",
        datasource_id: "warehouse/main",
        drift_event_id: id(4),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "SEMANTIC_BINDING_IMPACT_DATABASE_CONTRACT_INVALID" },
    });
  });

  it("commits a no-op receipt without creating a Candidate", async () => {
    const auth = authority();
    const document = await bundle(auth.capability.scope);
    const plan = await buildSemanticBindingImpactPlan({
      schema_version: "semantic-binding-impact-plan@1.0.0",
      impact_id: uuidV8FromContentHash(document.authority_input_hash),
      scope: document.scope,
      datasource_id: document.datasource_id,
      authority_input_hash: document.authority_input_hash,
      drift_ref: {
        drift_event_id: id(4),
        event_storage_digest: hash("4"),
        base_snapshot_content_hash: hash("2"),
        current_snapshot_content_hash: hash("3"),
      },
      release_ref: document.release,
      status: "NO_SEMANTIC_ACTION",
      risk_level: "LOW",
      direct_impacts: [],
      transitive_impacts: [],
      unchanged_object_hashes: [],
      suggested_actions: ["NO_SEMANTIC_ACTION"],
      manual_reason_codes: [],
      candidate_operations: [],
    });
    const material = {
      schema_version: "semantic-binding-impact-receipt@1.0.0" as const,
      authority: "POSTGRESQL" as const,
      impact_id: plan.impact_id,
      scope: plan.scope,
      datasource_id: plan.datasource_id,
      authority_input_hash: plan.authority_input_hash,
      plan_hash: plan.plan_hash,
      drift_event_id: id(4),
      release: plan.release_ref,
      status: "NO_SEMANTIC_ACTION" as const,
      risk_level: "LOW" as const,
      direct_impact_count: 0,
      transitive_impact_count: 0,
      suggested_actions: ["NO_SEMANTIC_ACTION" as const],
      manual_reason_codes: [],
      candidate_ref: null,
      committed_at: "2026-08-23T00:00:00.000Z",
    };
    const receipt = {
      ...material,
      receipt_hash: await computeSemanticBindingImpactReceiptHash(material),
      created: true,
    };
    const store = createPostgresSemanticBindingImpactStore({
      pool: poolWith(() => receipt).pool,
      authorizer: auth.authorizer,
    });
    await expect(store.commit(auth.capability, { plan, candidate_draft: null })).resolves.toEqual({
      ok: true,
      value: receipt,
    });
  });
});
