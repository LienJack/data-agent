import { semanticRelationshipIndexCheckpointSchema } from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { buildSemanticExplorerSnapshot } from "../src/explorer/index.js";
import {
  buildSemanticRelationshipGraphManifest,
  createSemanticRelationshipSearchService,
} from "../src/relationship-index/index.js";
import { createRawExplorerEnvelope, explorerIds } from "./fixtures/semantic-explorer.js";

const scope = {
  app_id: explorerIds.app,
  tenant_id: explorerIds.tenant,
  environment: "test",
} as const;
const attempt = "00000000-0000-4000-8000-000000000090";
const build = "00000000-0000-4000-8000-000000000091";
const authority = { capability_input: { server: true }, scope } as const;
const request = {
  schema_version: "semantic-relationship-search-request@1.0.0",
  semantic_domain: "sales",
  release: { kind: "ACTIVE" },
  root: null,
  term: "margin",
  categories: ["FORMULA", "BIND", "GOVERN"],
  direction: "both",
  hop_limit: 2,
  node_limit: 50,
  edge_limit: 100,
} as const;

async function fixture() {
  const snapshot = await buildSemanticExplorerSnapshot(await createRawExplorerEnvelope());
  const manifest = await buildSemanticRelationshipGraphManifest(scope, snapshot);
  const checkpoint = semanticRelationshipIndexCheckpointSchema.parse({
    schema_version: "semantic-relationship-index-checkpoint@1.0.0",
    semantic_domain: "sales",
    release_identity: snapshot.release_identity,
    state: "READY",
    attempt_id: attempt,
    attempt_fence: 1,
    build_id: build,
    manifest_digest: manifest.manifest_digest,
    relationship_projection_digest:
      snapshot.release_identity.relationship_projection.projection_digest,
    node_count: manifest.counts.total_nodes,
    edge_count: manifest.counts.total_edges,
    reason_code: null,
    observed_at: "2026-08-09T00:01:00.000Z",
    indexed_at: "2026-08-09T00:01:00.000Z",
  });
  return { snapshot, manifest, checkpoint };
}

describe("Semantic relationship shared search service", () => {
  it("hydrates Neo4j identity candidates from the revalidated PostgreSQL snapshot", async () => {
    const { snapshot, manifest, checkpoint } = await fixture();
    const selectedEdge = manifest.edges.find((edge) => edge.category === "FORMULA");
    if (!selectedEdge) throw new Error("fixture");
    const nodeKeys = [selectedEdge.source_node_key, selectedEdge.target_node_key];
    const graph = {
      search: vi.fn(async () => ({
        release_id: snapshot.release_identity.release_id,
        release_digest: snapshot.release_identity.release_digest,
        relationship_projection_digest:
          snapshot.release_identity.relationship_projection.projection_digest,
        build_id: build,
        manifest_digest: manifest.manifest_digest,
        node_keys: nodeKeys,
        edge_keys: [selectedEdge.edge_key],
        truncated: false,
        truncation_reasons: [],
        traversed_hops: 1,
      })),
    };
    const getActive = vi.fn(async () => ({ ok: true as const, value: snapshot }));
    const service = createSemanticRelationshipSearchService({
      snapshots: {
        getActive,
        getRelease: vi.fn(async () => ({ ok: true as const, value: snapshot })),
      },
      checkpoints: {
        getCheckpoint: vi.fn(async () => ({ ok: true as const, value: checkpoint })),
      },
      graph,
    });

    const result = await service.search(authority, request);

    expect(result).toMatchObject({
      ok: true,
      value: {
        source: "NEO4J",
        index_state: "READY",
        nodes: [{ node_key: expect.any(String) }, { node_key: expect.any(String) }],
        edges: [{ edge_key: selectedEdge.edge_key }],
        explanation: { authority_revalidated: true },
      },
    });
    expect(getActive).toHaveBeenCalledTimes(2);
    expect(graph.search).toHaveBeenCalledTimes(1);
  });

  it("falls back when the active pointer changes during Neo4j I/O", async () => {
    const { snapshot, manifest, checkpoint } = await fixture();
    const changed = {
      ...snapshot,
      pointer_observation: {
        ...snapshot.pointer_observation,
        pointer_generation: snapshot.pointer_observation.pointer_generation + 1,
      },
    };
    const getActive = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, value: snapshot })
      .mockResolvedValueOnce({ ok: true as const, value: changed });
    const service = createSemanticRelationshipSearchService({
      snapshots: {
        getActive,
        getRelease: vi.fn(async () => ({ ok: true as const, value: snapshot })),
      },
      checkpoints: {
        getCheckpoint: vi.fn(async () => ({ ok: true as const, value: checkpoint })),
      },
      graph: {
        search: vi.fn(async () => ({
          release_id: snapshot.release_identity.release_id,
          release_digest: snapshot.release_identity.release_digest,
          relationship_projection_digest: manifest.relationship_projection_digest,
          build_id: build,
          manifest_digest: manifest.manifest_digest,
          node_keys: [],
          edge_keys: [],
          truncated: false,
          truncation_reasons: [],
          traversed_hops: 0,
        })),
      },
    });

    await expect(service.search(authority, request)).resolves.toMatchObject({
      ok: true,
      value: {
        source: "POSTGRESQL_FALLBACK",
        index_state: "STALE",
        index_reason_code: "AUTHORITY_CHANGED",
        pointer_observation: { pointer_generation: changed.pointer_observation.pointer_generation },
      },
    });
  });

  it("uses the same bounded PostgreSQL DTO when Neo4j is unavailable", async () => {
    const { snapshot, checkpoint } = await fixture();
    const service = createSemanticRelationshipSearchService({
      snapshots: {
        getActive: vi.fn(async () => ({ ok: true as const, value: snapshot })),
        getRelease: vi.fn(async () => ({ ok: true as const, value: snapshot })),
      },
      checkpoints: {
        getCheckpoint: vi.fn(async () => ({ ok: true as const, value: checkpoint })),
      },
      graph: {
        search: vi.fn(async () => {
          throw { reason_code: "INDEX_UNAVAILABLE" };
        }),
      },
    });

    await expect(service.search(authority, request)).resolves.toMatchObject({
      ok: true,
      value: {
        source: "POSTGRESQL_FALLBACK",
        index_state: "FAILED",
        index_reason_code: "INDEX_UNAVAILABLE",
      },
    });
  });

  it("labels disabled, not-ready, and digest-mismatch fallback without partial graph results", async () => {
    const { snapshot, checkpoint } = await fixture();
    const snapshots = {
      getActive: vi.fn(async () => ({ ok: true as const, value: snapshot })),
      getRelease: vi.fn(async () => ({ ok: true as const, value: snapshot })),
    };
    const disabled = createSemanticRelationshipSearchService({ snapshots });
    await expect(disabled.search(authority, request)).resolves.toMatchObject({
      ok: true,
      value: {
        source: "POSTGRESQL_FALLBACK",
        index_state: "DISABLED",
        index_reason_code: "INDEX_DISABLED",
      },
    });

    const notReady = createSemanticRelationshipSearchService({
      snapshots,
      checkpoints: {
        getCheckpoint: vi.fn(async () => ({ ok: true as const, value: null })),
      },
      graph: {
        search: vi.fn(async () => {
          throw new Error("not-ready graph must not be queried");
        }),
      },
    });
    await expect(notReady.search(authority, request)).resolves.toMatchObject({
      ok: true,
      value: {
        source: "POSTGRESQL_FALLBACK",
        index_state: "PENDING",
        index_reason_code: "INDEX_NOT_READY",
      },
    });

    const mismatch = createSemanticRelationshipSearchService({
      snapshots,
      checkpoints: {
        getCheckpoint: vi.fn(async () => ({ ok: true as const, value: checkpoint })),
      },
      graph: {
        search: vi.fn(async () => {
          throw { reason_code: "INDEX_DIGEST_MISMATCH" };
        }),
      },
    });
    await expect(mismatch.search(authority, request)).resolves.toMatchObject({
      ok: true,
      value: {
        source: "POSTGRESQL_FALLBACK",
        index_state: "STALE",
        index_reason_code: "INDEX_DIGEST_MISMATCH",
      },
    });
  });
});
