import { randomUUID } from "node:crypto";
import {
  computeSemanticRelationshipGraphManifestDigest,
  semanticRelationshipGraphManifestMaterialSchema,
  semanticRelationshipGraphManifestSchema,
  semanticRelationshipIndexCheckpointSchema,
  semanticRelationshipSearchRequestSchema,
} from "@data-agent/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createNeo4jRelationshipGraphAdapter,
  type SemanticRelationshipGraphAdapter,
} from "../../src/semantic/neo4j-relationship-index.js";

const configured = Boolean(
  process.env.NEO4J_TEST_URI && process.env.NEO4J_TEST_USERNAME && process.env.NEO4J_TEST_PASSWORD,
);
const integration = configured ? describe : describe.skip;
const hash = (digit: string) => `sha256:${digit.repeat(64)}` as const;

integration("Neo4j relationship index integration", () => {
  const ids = {
    app: randomUUID(),
    tenant: randomUUID(),
    principal: randomUUID(),
    release: randomUUID(),
    projection: randomUUID(),
    executable: randomUUID(),
    restriction: randomUUID(),
    attempt: randomUUID(),
    buildOne: randomUUID(),
    buildTwo: randomUUID(),
    buildThree: randomUUID(),
  };
  const scope = { app_id: ids.app, tenant_id: ids.tenant, environment: "neo4j-integration" };
  let adapter: SemanticRelationshipGraphAdapter;
  let graph: Awaited<ReturnType<typeof createManifest>>;

  async function createManifest() {
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
    };
    const nodes = [
      {
        node_type: "governance_object" as const,
        node_key: hash("1"),
        canonical_digest: hash("2"),
        name: "Revenue release",
        governance_kind: "semantic_release" as const,
        governance_id: ids.release,
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
        governance_id: ids.projection,
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

  function checkpoint(buildId: string) {
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
      node_count: 2,
      edge_count: 1,
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

  beforeAll(async () => {
    adapter = createNeo4jRelationshipGraphAdapter({
      uri: process.env.NEO4J_TEST_URI ?? "",
      username: process.env.NEO4J_TEST_USERNAME ?? "",
      password: process.env.NEO4J_TEST_PASSWORD ?? "",
      database: process.env.NEO4J_TEST_DATABASE ?? "neo4j",
      batch_size: 100,
    });
    graph = await createManifest();
    await adapter.initialize();
  }, 30_000);

  afterAll(async () => {
    if (adapter) {
      await adapter.cleanup({ scope, semantic_domain: "revenue", keep_release_ids: [] });
      await adapter.close();
    }
  });

  it("keeps staging invisible and atomically switches the exact active build", async () => {
    await adapter.stageBuild({ build_id: ids.buildOne, manifest: graph });
    await expect(
      adapter.search({ scope, checkpoint: checkpoint(ids.buildOne), request }),
    ).rejects.toMatchObject({ reason_code: "INDEX_NOT_READY" });

    await expect(
      adapter.verifyAndSeal({ build_id: ids.buildOne, manifest: graph }),
    ).resolves.toEqual({ node_count: 2, edge_count: 1 });
    await expect(
      adapter.search({ scope, checkpoint: checkpoint(ids.buildOne), request }),
    ).resolves.toMatchObject({
      build_id: ids.buildOne,
      node_keys: [hash("1"), hash("3")],
      edge_keys: [hash("5")],
      traversed_hops: 1,
    });

    await adapter.stageBuild({ build_id: ids.buildTwo, manifest: graph });
    await adapter.verifyAndSeal({ build_id: ids.buildTwo, manifest: graph });
    await expect(
      adapter.search({ scope, checkpoint: checkpoint(ids.buildOne), request }),
    ).rejects.toMatchObject({ reason_code: "INDEX_NOT_READY" });
    await expect(
      adapter.search({ scope, checkpoint: checkpoint(ids.buildTwo), request }),
    ).resolves.toMatchObject({ build_id: ids.buildTwo });

    await expect(
      adapter.cleanup({
        scope,
        semantic_domain: "revenue",
        keep_release_ids: [ids.release],
      }),
    ).resolves.toBe(1);
    await expect(
      adapter.search({ scope, checkpoint: checkpoint(ids.buildTwo), request }),
    ).resolves.toMatchObject({ build_id: ids.buildTwo });

    await expect(
      adapter.cleanup({ scope, semantic_domain: "revenue", keep_release_ids: [] }),
    ).resolves.toBe(1);
    await expect(
      adapter.search({ scope, checkpoint: checkpoint(ids.buildTwo), request }),
    ).rejects.toMatchObject({ reason_code: "INDEX_NOT_READY" });

    await adapter.stageBuild({ build_id: ids.buildThree, manifest: graph });
    await adapter.verifyAndSeal({ build_id: ids.buildThree, manifest: graph });
    await expect(
      adapter.search({ scope, checkpoint: checkpoint(ids.buildThree), request }),
    ).resolves.toMatchObject({ build_id: ids.buildThree });
  }, 30_000);
});
