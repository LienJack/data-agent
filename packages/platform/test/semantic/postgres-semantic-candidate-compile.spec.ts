import type { SchemaFeaturePacket, SemanticAgentReceipt } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import type { SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresSemanticCandidateCompileStore } from "../../src/semantic/postgres-semantic-candidate-compile.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const ids = {
  app: "00000000-0000-4000-8000-000000000001",
  tenant: "00000000-0000-4000-8000-000000000002",
  deployment: "00000000-0000-4000-8000-000000000003",
  principal: "00000000-0000-4000-8000-000000000004",
  compile: "00000000-0000-4000-8000-000000000005",
  source: "00000000-0000-4000-8000-000000000006",
  snapshot: "00000000-0000-4000-8000-000000000007",
  idempotency: "00000000-0000-4000-8000-000000000008",
  drift: "00000000-0000-4000-8000-000000000009",
} as const;
const hash = `sha256:${"a".repeat(64)}` as const;

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
  if (!resolved.ok) throw new Error("fixture authority missing");
  return {
    capability: resolved.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
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

const packet: SchemaFeaturePacket = {
  schema_version: "schema-feature-packet@1.0.0",
  scope: {
    app_id: ids.app,
    tenant_id: ids.tenant,
    environment: "test",
    semantic_domain: "commerce",
  },
  snapshot_id: ids.snapshot,
  snapshot_digest: hash,
  drift_event_id: null,
  drift_digest: null,
  base_release: null,
  features: [],
  feature_digest: hash,
};
const receipt: SemanticAgentReceipt = {
  provider_id: "openai",
  model_id: "fixture-model",
  model_profile_digest: hash,
  prompt_digest: hash,
  tool_policy_digest: hash,
  compiler_digest: hash,
  candidate_policy_digest: hash,
};

describe("PostgreSQL semantic candidate compile store", () => {
  it("reads drift material with its PostgreSQL storage digest", async () => {
    const access = authority();
    const event = {
      schema_version: "schema-drift-event@1.0.0" as const,
      drift_event_id: ids.drift,
      datasource_id: "warehouse",
      datasource_fingerprint: hash,
      base_snapshot_content_hash: hash,
      current_snapshot_content_hash: hash,
      observed_at: "2026-08-11T00:00:00.000Z",
      severity: "INFO" as const,
      binding_impact: "UNKNOWN" as const,
      operations: [],
    };
    const scripted = scriptedPool((text) =>
      text.includes("semantic.get_schema_candidate_drift_evidence")
        ? { rows: [{ value: { event, event_storage_digest: hash } }], rowCount: 1 }
        : undefined,
    );
    const result = await createPostgresSemanticCandidateCompileStore({
      pool: scripted.pool,
      authorizer: access.authorizer,
    }).getDriftEvidence(access.capability, "commerce", "warehouse", ids.drift);

    expect(result).toEqual({ ok: true, value: { event, event_storage_digest: hash } });
    expect(
      scripted.calls.some((call) =>
        call.text.includes("semantic.get_schema_candidate_drift_evidence"),
      ),
    ).toBe(true);
  });

  it("fences the domain before calling the begin RPC", async () => {
    const access = authority();
    const scripted = scriptedPool((text) =>
      text.includes("semantic.begin_schema_candidate_compile")
        ? {
            rows: [
              {
                value: {
                  compile_run_id: ids.compile,
                  source_revision_id: ids.source,
                  terminal: "RUNNING",
                  proposal_digest: null,
                  created: true,
                },
              },
            ],
            rowCount: 1,
          }
        : undefined,
    );
    const result = await createPostgresSemanticCandidateCompileStore({
      pool: scripted.pool,
      authorizer: access.authorizer,
    }).begin(access.capability, {
      semantic_domain: "commerce",
      compile_run_id: ids.compile,
      source_revision_id: ids.source,
      idempotency_key: ids.idempotency,
      input_digest: hash,
      feature_packet: packet,
      agent_receipt: receipt,
    });

    expect(result).toMatchObject({ ok: true, value: { terminal: "RUNNING", created: true } });
    const fenceIndex = scripted.calls.findIndex((call) =>
      call.text.includes("app.semantic_domain"),
    );
    const rpcIndex = scripted.calls.findIndex((call) =>
      call.text.includes("semantic.begin_schema_candidate_compile"),
    );
    expect(fenceIndex).toBeGreaterThanOrEqual(0);
    expect(rpcIndex).toBeGreaterThan(fenceIndex);
    expect(scripted.calls[rpcIndex]?.values).toEqual([
      ids.app,
      ids.tenant,
      "test",
      ids.principal,
      "commerce",
      ids.compile,
      ids.source,
      ids.idempotency,
      hash,
      packet,
      receipt,
    ]);
  });

  it("rejects inconsistent terminal material before opening a transaction", async () => {
    const access = authority();
    const scripted = scriptedPool(() => undefined);
    const result = await createPostgresSemanticCandidateCompileStore({
      pool: scripted.pool,
      authorizer: access.authorizer,
    }).finish(access.capability, {
      semantic_domain: "commerce",
      compile_run_id: ids.compile,
      terminal: "COMPILED",
      proposal: null,
      failure_code: null,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "SEMANTIC_CANDIDATE_COMPILE_INVALID", retryable: false },
    });
    expect(scripted.calls).toHaveLength(0);
  });
});
