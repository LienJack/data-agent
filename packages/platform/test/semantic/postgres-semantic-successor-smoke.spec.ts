import {
  buildSemanticRuntimeSmokeReceipt,
  buildSemanticSuccessorStage,
} from "@data-agent/contracts/artifacts";
import { describe, expect, it } from "vitest";
import type { SqlClient, SqlPool, SqlQueryResult } from "../../src/persistence/transaction.js";
import { createPostgresSemanticSuccessorSmokeAuthority } from "../../src/semantic/postgres-semantic-successor-smoke.js";
import { createDeploymentRegistry } from "../../src/tenancy/capability.js";
import { asTransactionalTestAuthority } from "../support/transactional-authority.js";

const id = (suffix: number) => `73000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;

function authority() {
  const registry = createDeploymentRegistry(
    [{ deployment_id: id(1), app_id: id(2), environment: "test" }],
    [
      {
        subject: id(3),
        deployment_id: id(1),
        tenant_id: id(4),
        role: "ANALYST",
      },
    ],
  );
  const resolved = registry.resolveForDeployment(id(1), { subject: id(3) });
  if (!resolved.ok) throw new Error("authority fixture failed");
  return {
    capability: resolved.value,
    authorizer: asTransactionalTestAuthority(registry.authorizer),
  };
}

async function fixture() {
  const projectionRefs = {
    executable: { projection_id: id(20), projection_digest: hash("a") },
    relationship: { projection_id: id(21), projection_digest: hash("b") },
    runtime_restriction: { projection_id: id(22), projection_digest: hash("c") },
    graph: { projection_id: id(23), projection_digest: hash("d") },
  };
  const stage = await buildSemanticSuccessorStage({
    schema_version: "semantic-successor-stage@1.0.0",
    stage_id: id(5),
    scope: {
      app_id: id(2),
      tenant_id: id(4),
      environment: "test",
      semantic_domain: "falcon24",
    },
    predecessor_release: { release_id: id(6), generation: 1, release_digest: hash("1") },
    expected_pointer_version: 3,
    target_generation: 2,
    change_set_ref: { change_set_id: id(7), change_set_hash: hash("2") },
    review_ref: { review_id: id(8), review_hash: hash("3") },
    source_snapshot_ref: {
      snapshot_id: id(9),
      snapshot_revision: 1,
      snapshot_hash: hash("4"),
    },
    compiler_bundle_ref: {
      compiler_version: "semantic-change-set-publication@2",
      compiler_bundle_hash: hash("5"),
    },
    candidate_release: {
      release_id: id(10),
      generation: 2,
      release_digest: hash("6"),
      datasource_id: id(11),
    },
    projection_refs: projectionRefs,
    status: "STAGED",
  });
  const projections = {
    executable: {
      projection_kind: "EXECUTABLE" as const,
      ...projectionRefs.executable,
      projection_payload: {},
    },
    relationship: {
      projection_kind: "RELATIONSHIP" as const,
      ...projectionRefs.relationship,
      projection_payload: {},
    },
    runtime_restriction: {
      projection_kind: "RUNTIME_RESTRICTION" as const,
      ...projectionRefs.runtime_restriction,
      projection_payload: {},
    },
    graph: {
      projection_kind: "GRAPH" as const,
      ...projectionRefs.graph,
      projection_payload: {},
    },
  };
  const receipt = await buildSemanticRuntimeSmokeReceipt({
    schema_version: "semantic-runtime-smoke-receipt@1.0.0",
    receipt_id: id(12),
    stage_id: stage.stage_id,
    stage_digest: stage.stage_digest,
    candidate_release: stage.candidate_release,
    projection_refs: stage.projection_refs,
    resolved_metric_id: "metric.order_revenue",
    resolved_dimension_id: "dimension.order_month",
    resolved_binding_hash: hash("7"),
    plan_hash: hash("8"),
    calendar_timezone: "Asia/Shanghai",
    window_start: "2023-11-01T00:00:00.000Z",
    window_end_exclusive: "2024-11-01T00:00:00.000Z",
    validator_identity: {
      validator_version: "semantic-runtime-closure-validator@1.0.0",
      validator_hash: hash("9"),
    },
    worker_build_identity: {
      schema_version: "runtime-build-identity@1.0.0",
      consumer_role: "worker",
      generation_id: hash("e"),
      build_id: hash("f"),
      built_at: "2026-08-28T00:00:00.000Z",
      git_commit: "1234567",
      git_dirty: false,
    },
    outcome: "PASS",
    failure_code: null,
  });
  return { stage, projections, receipt };
}

function scriptedPool(
  handle: (text: string, values: readonly unknown[]) => SqlQueryResult | undefined,
) {
  const calls: Array<{ readonly text: string; readonly values: readonly unknown[] }> = [];
  const client: SqlClient = {
    async query<Row extends object = Record<string, unknown>>(text: string, values = []) {
      calls.push({ text, values });
      const handled = handle(text, values);
      if (handled) return handled as SqlQueryResult<Row>;
      if (text.includes("backend_context_matches")) {
        return { rows: [{ allowed: true }], rowCount: 1 } as unknown as SqlQueryResult<Row>;
      }
      return { rows: [], rowCount: 0 } as SqlQueryResult<Row>;
    },
    release() {},
  };
  return { pool: { connect: async () => client } satisfies SqlPool, calls };
}

describe("PostgreSQL semantic successor smoke authority", () => {
  it("loads exact stage and promoted release envelopes through refs-only scoped RPCs", async () => {
    const current = authority();
    const { stage, projections } = await fixture();
    const promoted = { ...stage, status: "PROMOTED" as const };
    const scripted = scriptedPool((text) => {
      if (text.includes("load_promoted_semantic_successor_release")) {
        return { rows: [{ value: { stage: promoted, projections } }], rowCount: 1 };
      }
      if (text.includes("load_semantic_successor_stage")) {
        return { rows: [{ value: { stage, projections } }], rowCount: 1 };
      }
      return undefined;
    });
    const store = createPostgresSemanticSuccessorSmokeAuthority({
      pool: scripted.pool,
      authorizer: current.authorizer,
    });

    await expect(
      store.loadStage(current.capability, {
        semantic_domain: "falcon24",
        stage_id: stage.stage_id,
      }),
    ).resolves.toMatchObject({ ok: true, value: { stage: { status: "STAGED" } } });
    await expect(
      store.loadPromotedRelease(current.capability, {
        semantic_domain: "falcon24",
        release_id: stage.candidate_release.release_id,
      }),
    ).resolves.toMatchObject({ ok: true, value: { stage: { status: "PROMOTED" } } });
    const rpcCommands = scripted.calls
      .filter(({ text }) => text.includes("successor_stage") || text.includes("successor_release"))
      .map(({ values }) => values[0]) as Array<Record<string, unknown>>;
    expect(rpcCommands).toHaveLength(2);
    expect(rpcCommands[0]).toMatchObject({ stage_id: stage.stage_id });
    expect(rpcCommands[1]).toMatchObject({
      semantic_domain: "falcon24",
      release_id: stage.candidate_release.release_id,
    });
    expect(
      rpcCommands.every((command) => /^sha256:[0-9a-f]{64}$/u.test(String(command.command_hash))),
    ).toBe(true);
  });

  it("commits and verifies an exact smoke receipt through one write RPC", async () => {
    const current = authority();
    const { receipt } = await fixture();
    const scripted = scriptedPool((text) =>
      text.includes("commit_semantic_successor_smoke")
        ? { rows: [{ value: receipt }], rowCount: 1 }
        : undefined,
    );
    const store = createPostgresSemanticSuccessorSmokeAuthority({
      pool: scripted.pool,
      authorizer: current.authorizer,
    });

    await expect(
      store.commitSmoke(current.capability, {
        semantic_domain: "falcon24",
        idempotency_key: "falcon24-e4-smoke",
        receipt,
      }),
    ).resolves.toEqual({ ok: true, value: receipt });
    const rpc = scripted.calls.find(({ text }) => text.includes("commit_semantic_successor_smoke"));
    expect(rpc?.values[0]).toMatchObject({
      idempotency_key: "falcon24-e4-smoke",
      stage_id: receipt.stage_id,
      expected_stage_digest: receipt.stage_digest,
      receipt,
    });
  });
});
