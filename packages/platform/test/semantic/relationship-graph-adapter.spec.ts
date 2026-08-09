import {
  computeSemanticRelationshipGraphManifestDigest,
  semanticRelationshipGraphManifestMaterialSchema,
  semanticRelationshipGraphManifestSchema,
  semanticRelationshipIndexCheckpointSchema,
  semanticRelationshipSearchRequestSchema,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  createInMemoryRelationshipGraphAdapter,
  createNeo4jRelationshipGraphAdapterFromEnvironment,
  Neo4jRelationshipIndexError,
} from "../../src/semantic/neo4j-relationship-index.js";

const ids = {
  app: "00000000-0000-4000-8000-000000000001",
  tenant: "00000000-0000-4000-8000-000000000002",
  principal: "00000000-0000-4000-8000-000000000003",
  release: "00000000-0000-4000-8000-000000000004",
  projection: "00000000-0000-4000-8000-000000000005",
  executable: "00000000-0000-4000-8000-000000000006",
  restriction: "00000000-0000-4000-8000-000000000007",
  releaseNode: "00000000-0000-4000-8000-000000000008",
  projectionNode: "00000000-0000-4000-8000-000000000009",
  attempt: "00000000-0000-4000-8000-000000000010",
  buildOne: "00000000-0000-4000-8000-000000000011",
  buildTwo: "00000000-0000-4000-8000-000000000012",
} as const;
const hash = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const scope = { app_id: ids.app, tenant_id: ids.tenant, environment: "test" } as const;

async function manifest() {
  const releaseIdentity = {
    semantic_domain: "revenue",
    release_id: ids.release,
    release_generation: 1,
    release_digest: hash("a"),
    executable_projection: {
      projection_id: ids.executable,
      projection_digest: hash("b"),
    },
    relationship_projection: {
      projection_id: ids.projection,
      projection_digest: hash("c"),
    },
    runtime_restriction_projection: {
      projection_id: ids.restriction,
      projection_digest: hash("d"),
    },
    published_at: "2026-08-09T00:00:00.000Z",
    published_by: ids.principal,
  } as const;
  const nodes = [
    {
      node_type: "governance_object" as const,
      node_key: hash("1"),
      canonical_digest: hash("2"),
      name: "Revenue release",
      governance_kind: "semantic_release" as const,
      governance_id: ids.releaseNode,
      release_id: ids.release,
      release_generation: 1,
      digest: hash("a"),
    },
    {
      node_type: "governance_object" as const,
      node_key: hash("3"),
      canonical_digest: hash("4"),
      name: "Relationship projection",
      governance_kind: "relationship_projection" as const,
      governance_id: ids.projectionNode,
      release_id: ids.release,
      release_generation: 1,
      digest: hash("c"),
    },
  ];
  const edges = [
    {
      edge_key: hash("5"),
      edge_id: "govern:release:relationship_projection",
      category: "GOVERN" as const,
      source_node_key: hash("1"),
      target_node_key: hash("3"),
      canonical_digest: hash("6"),
      label: "GOVERN · binds relationship projection",
      contract: {
        category: "GOVERN" as const,
        governance_relation: "RELEASE_BINDS_PROJECTION" as const,
        projection_kind: "relationship_projection" as const,
      },
    },
  ];
  const material = semanticRelationshipGraphManifestMaterialSchema.parse({
    schema_version: "semantic-relationship-graph-manifest@1.0.0",
    scope,
    semantic_domain: "revenue",
    release_identity: releaseIdentity,
    relationship_projection_digest: hash("c"),
    nodes,
    edges,
    counts: {
      total_nodes: 2,
      semantic_nodes: 0,
      governance_nodes: 2,
      total_edges: 1,
      by_category: { BIZ: 0, JOIN: 0, FORMULA: 0, BIND: 0, GOVERN: 1 },
    },
  });
  return semanticRelationshipGraphManifestSchema.parse({
    ...material,
    manifest_digest: await computeSemanticRelationshipGraphManifestDigest(material),
  });
}

function checkpoint(graph: Awaited<ReturnType<typeof manifest>>, buildId: string) {
  return semanticRelationshipIndexCheckpointSchema.parse({
    schema_version: "semantic-relationship-index-checkpoint@1.0.0",
    semantic_domain: "revenue",
    release_identity: graph.release_identity,
    state: "READY",
    attempt_id: ids.attempt,
    attempt_fence: 1,
    build_id: buildId,
    manifest_digest: graph.manifest_digest,
    relationship_projection_digest: graph.relationship_projection_digest,
    node_count: graph.counts.total_nodes,
    edge_count: graph.counts.total_edges,
    reason_code: null,
    observed_at: "2026-08-09T00:01:00.000Z",
    indexed_at: "2026-08-09T00:01:00.000Z",
  });
}

const request = semanticRelationshipSearchRequestSchema.parse({
  schema_version: "semantic-relationship-search-request@1.0.0",
  semantic_domain: "revenue",
  release: { kind: "HISTORICAL", release_id: ids.release },
  root: null,
  term: null,
  categories: ["GOVERN"],
  direction: "both",
  hop_limit: 2,
  node_limit: 10,
  edge_limit: 10,
});

describe("relationship graph adapter conformance", () => {
  it("accepts the same true feature-flag spellings as the Web runtime", async () => {
    expect(
      createNeo4jRelationshipGraphAdapterFromEnvironment({
        SEMANTIC_RELATIONSHIP_INDEX_ENABLED: "false",
      }),
    ).toBeNull();

    const adapter = createNeo4jRelationshipGraphAdapterFromEnvironment({
      SEMANTIC_RELATIONSHIP_INDEX_ENABLED: "1",
      NEO4J_URI: "bolt://127.0.0.1:7687",
      NEO4J_USERNAME: "neo4j",
      NEO4J_PASSWORD: "test-password",
    });
    expect(adapter).not.toBeNull();
    await adapter?.close();
  });

  it("keeps staging invisible, seals exact identities, and atomically replaces a build", async () => {
    const adapter = createInMemoryRelationshipGraphAdapter();
    const graph = await manifest();
    await adapter.initialize();
    await adapter.stageBuild({ build_id: ids.buildOne, manifest: graph });

    await expect(
      adapter.search({ scope, checkpoint: checkpoint(graph, ids.buildOne), request }),
    ).rejects.toBeInstanceOf(Neo4jRelationshipIndexError);

    await expect(
      adapter.verifyAndSeal({ build_id: ids.buildOne, manifest: graph }),
    ).resolves.toEqual({ node_count: 2, edge_count: 1 });
    await expect(
      adapter.search({ scope, checkpoint: checkpoint(graph, ids.buildOne), request }),
    ).resolves.toMatchObject({
      build_id: ids.buildOne,
      node_keys: [hash("1"), hash("3")],
      edge_keys: [hash("5")],
    });

    await adapter.stageBuild({ build_id: ids.buildTwo, manifest: graph });
    await adapter.verifyAndSeal({ build_id: ids.buildTwo, manifest: graph });
    await expect(
      adapter.search({ scope, checkpoint: checkpoint(graph, ids.buildOne), request }),
    ).rejects.toMatchObject({ reason_code: "INDEX_NOT_READY" });
    await expect(
      adapter.search({ scope, checkpoint: checkpoint(graph, ids.buildTwo), request }),
    ).resolves.toMatchObject({ build_id: ids.buildTwo, traversed_hops: 1 });
  });

  it("cleans inactive builds without deleting the active kept release", async () => {
    const adapter = createInMemoryRelationshipGraphAdapter();
    const graph = await manifest();
    await adapter.stageBuild({ build_id: ids.buildOne, manifest: graph });
    await adapter.verifyAndSeal({ build_id: ids.buildOne, manifest: graph });
    await adapter.stageBuild({ build_id: ids.buildTwo, manifest: graph });

    await expect(
      adapter.cleanup({ scope, semantic_domain: "revenue", keep_release_ids: [ids.release] }),
    ).resolves.toBe(1);
    await expect(
      adapter.search({ scope, checkpoint: checkpoint(graph, ids.buildOne), request }),
    ).resolves.toMatchObject({ build_id: ids.buildOne });
  });
});
