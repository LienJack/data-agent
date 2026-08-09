import type {
  PostgresRelationshipIndexStore,
  SemanticRelationshipGraphAdapter,
} from "@data-agent/platform";
import { describe, expect, it, vi } from "vitest";
import { createSemanticRelationshipIndexer } from "../src/semantic/relationship-indexer.js";

const ids = {
  app: "00000000-0000-4000-8000-000000000001",
  tenant: "00000000-0000-4000-8000-000000000002",
  release: "00000000-0000-4000-8000-000000000003",
  projection: "00000000-0000-4000-8000-000000000004",
  attempt: "00000000-0000-4000-8000-000000000005",
  worker: "00000000-0000-4000-8000-000000000006",
} as const;
const hash = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const scope = { app_id: ids.app, tenant_id: ids.tenant, environment: "test" } as const;

function graph(): SemanticRelationshipGraphAdapter {
  return {
    initialize: vi.fn(async () => {}),
    stageBuild: vi.fn(async () => {}),
    verifyAndSeal: vi.fn(async () => ({ node_count: 0, edge_count: 0 })),
    search: vi.fn(async () => {
      throw new Error("not used");
    }),
    cleanup: vi.fn(async () => 0),
    close: vi.fn(async () => {}),
  };
}

function store(claim: object | null) {
  const fail = vi.fn(async () => ({ ok: true as const, value: undefined }));
  const value: PostgresRelationshipIndexStore = {
    reconcile: vi.fn(async () => ({ ok: true as const, value: 1 })),
    claim: vi.fn(async () => ({
      ok: true as const,
      value: claim,
    })) as PostgresRelationshipIndexStore["claim"],
    heartbeat: vi.fn(async () => ({
      ok: true as const,
      value: "2026-08-09T00:01:00.000Z",
    })),
    commit: vi.fn(async () => {
      throw new Error("not used");
    }),
    fail,
    getCheckpoint: vi.fn(async () => ({ ok: true as const, value: null })),
    requeue: vi.fn(async () => {
      throw new Error("not used");
    }),
  };
  return { value, fail };
}

describe("semantic relationship indexer", () => {
  it("returns IDLE after reconciliation when no fenced job is claimable", async () => {
    const fixture = store(null);
    const adapter = graph();
    const indexer = createSemanticRelationshipIndexer({
      store: fixture.value,
      graph: adapter,
      snapshots: {
        getRelease: vi.fn(async () => {
          throw new Error("not used");
        }),
      },
    });

    await expect(
      indexer.runOnce({}, scope, {
        semantic_domain: "revenue",
        worker_id: ids.worker,
        lease_seconds: 120,
      }),
    ).resolves.toEqual({ state: "IDLE", reconciled_jobs: 1 });
    expect(adapter.stageBuild).not.toHaveBeenCalled();
  });

  it("records a redacted failure when the exact PostgreSQL snapshot is unavailable", async () => {
    const fixture = store({
      semantic_domain: "revenue",
      release_id: ids.release,
      release_generation: 1,
      release_digest: hash("a"),
      relationship_projection_id: ids.projection,
      relationship_projection_digest: hash("b"),
      attempt_id: ids.attempt,
      attempt_fence: 1,
      worker_id: ids.worker,
      lease_expires_at: "2026-08-09T00:02:00.000Z",
    });
    const adapter = graph();
    const indexer = createSemanticRelationshipIndexer({
      store: fixture.value,
      graph: adapter,
      snapshots: {
        getRelease: vi.fn(async () => ({
          ok: false as const,
          error: {
            code: "SEMANTIC_EXPLORER_UNAVAILABLE",
            message: "redacted",
            retryable: true,
          },
        })),
      },
    });

    await expect(
      indexer.runOnce({}, scope, {
        semantic_domain: "revenue",
        worker_id: ids.worker,
        lease_seconds: 120,
      }),
    ).resolves.toEqual({
      state: "FAILED",
      reconciled_jobs: 1,
      release_id: ids.release,
      reason_code: "INDEX_UNAVAILABLE",
    });
    expect(fixture.fail).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        attempt_id: ids.attempt,
        attempt_fence: 1,
        reason_code: "INDEX_UNAVAILABLE",
      }),
    );
    expect(adapter.stageBuild).not.toHaveBeenCalled();
  });
});
