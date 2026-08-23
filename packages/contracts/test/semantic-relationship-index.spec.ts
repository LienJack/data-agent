import { describe, expect, it } from "vitest";
import {
  computeSemanticRelationshipGraphManifestDigest,
  semanticRelationshipGraphManifestSchema,
  semanticRelationshipIndexCheckpointSchema,
  semanticRelationshipSearchRequestSchema,
  semanticRelationshipSearchResultSchema,
} from "../src/artifacts/semantic-relationship-index.js";

const hash = (character: string) => `sha256:${character.repeat(64)}`;

const releaseIdentity = {
  semantic_domain: "sales",
  release_id: "00000000-0000-4000-8000-000000000001",
  release_generation: 7,
  release_digest: hash("a"),
  executable_projection: {
    projection_id: "00000000-0000-4000-8000-000000000002",
    projection_digest: hash("b"),
  },
  relationship_projection: {
    projection_id: "00000000-0000-4000-8000-000000000003",
    projection_digest: hash("c"),
  },
  runtime_restriction_projection: {
    projection_id: "00000000-0000-4000-8000-000000000004",
    projection_digest: hash("d"),
  },
  published_at: "2026-08-09T00:00:00.000Z",
  published_by: "reviewer@example.com",
};

const pointerObservation = {
  current_release_id: releaseIdentity.release_id,
  current_release_generation: releaseIdentity.release_generation,
  current_release_digest: releaseIdentity.release_digest,
  pointer_generation: 11,
  observed_at: "2026-08-09T00:01:00.000Z",
};

const metricNode = {
  node_type: "semantic_object" as const,
  node_key: hash("1"),
  canonical_digest: hash("2"),
  name: "Net Revenue",
  object: {
    identity: { kind: "metric" as const, object_id: "metric-net-revenue" },
    status: "published" as const,
    canonical_digest: hash("2"),
    name: "Net Revenue",
    description: null,
    aliases: ["net sales"],
    owner: null,
    restricted: false,
    payload: {
      kind: "metric" as const,
      table_id: "orders",
      column_id: "orders.net_revenue",
      aggregation: "sum" as const,
      formula: null,
      grain: { grain_id: "order", description: null, granularity: "atomic" as const },
      unit: null,
      time_domain: null,
      time_column_id: null,
      additivity: "additive" as const,
      null_policy: "coalesce-zero" as const,
      fanout_policy: "preaggregate" as const,
      dependency_column_ids: ["orders.net_revenue"],
      tags: [],
      bindings: [],
    },
  },
};

const releaseNode = {
  node_type: "governance_object" as const,
  node_key: hash("3"),
  canonical_digest: releaseIdentity.release_digest,
  name: "SemanticRelease sales@7",
  governance_kind: "semantic_release" as const,
  governance_id: releaseIdentity.release_id,
  release_id: releaseIdentity.release_id,
  release_generation: 7,
  digest: releaseIdentity.release_digest,
};

const governEdge = {
  edge_key: hash("4"),
  edge_id: "govern:release:metric-net-revenue",
  category: "GOVERN" as const,
  source_node_key: releaseNode.node_key,
  target_node_key: metricNode.node_key,
  canonical_digest: hash("5"),
  label: "GOVERN · publishes metric",
  contract: {
    category: "GOVERN" as const,
    governance_relation: "PROJECTION_PUBLISHES_OBJECT" as const,
    projection_kind: "executable_projection" as const,
  },
};

function manifestMaterial() {
  return {
    schema_version: "semantic-relationship-graph-manifest@1.0.0" as const,
    scope: {
      app_id: "00000000-0000-4000-8000-000000000005",
      tenant_id: "00000000-0000-4000-8000-000000000006",
      environment: "test",
    },
    semantic_domain: "sales",
    release_identity: releaseIdentity,
    relationship_projection_digest: releaseIdentity.relationship_projection.projection_digest,
    nodes: [metricNode, releaseNode],
    edges: [governEdge],
    counts: {
      total_nodes: 2,
      semantic_nodes: 1,
      governance_nodes: 1,
      total_edges: 1,
      by_category: { BIZ: 0, JOIN: 0, FORMULA: 0, BIND: 0, GOVERN: 1 },
    },
  };
}

function searchRequest() {
  return {
    schema_version: "semantic-relationship-search-request@1.0.0",
    semantic_domain: "sales",
    release: { kind: "ACTIVE" },
    root: null,
    term: "revenue",
    categories: ["FORMULA", "GOVERN"],
    direction: "both",
    hop_limit: 2,
    node_limit: 100,
    edge_limit: 200,
  };
}

describe("semantic relationship graph contracts", () => {
  it("computes a deterministic exact-release manifest digest", async () => {
    const material = manifestMaterial();
    const digest = await computeSemanticRelationshipGraphManifestDigest(material);
    expect(await computeSemanticRelationshipGraphManifestDigest(structuredClone(material))).toBe(
      digest,
    );
    expect(() =>
      semanticRelationshipGraphManifestSchema.parse({ ...material, manifest_digest: digest }),
    ).not.toThrow();
  });

  it("fails closed on dangling edges, duplicate keys and count drift", async () => {
    const material = manifestMaterial();
    const digest = await computeSemanticRelationshipGraphManifestDigest(material);
    expect(() =>
      semanticRelationshipGraphManifestSchema.parse({
        ...material,
        nodes: [metricNode, metricNode],
        edges: [{ ...governEdge, target_node_key: hash("9") }],
        counts: { ...material.counts, total_edges: 2 },
        manifest_digest: digest,
      }),
    ).toThrow();
  });

  it("rejects unknown query language and unbounded or duplicate categories", () => {
    expect(() =>
      semanticRelationshipSearchRequestSchema.parse({
        ...searchRequest(),
        categories: ["FORMULA", "FORMULA"],
        hop_limit: 99,
        raw_cypher: "MATCH (n) RETURN n",
      }),
    ).toThrow();
  });

  it("requires a complete immutable READY checkpoint receipt", () => {
    const base = {
      schema_version: "semantic-relationship-index-checkpoint@1.0.0",
      semantic_domain: "sales",
      release_identity: releaseIdentity,
      state: "READY",
      attempt_id: null,
      attempt_fence: null,
      build_id: null,
      manifest_digest: null,
      relationship_projection_digest: releaseIdentity.relationship_projection.projection_digest,
      node_count: null,
      edge_count: null,
      reason_code: null,
      observed_at: "2026-08-09T00:02:00.000Z",
      indexed_at: null,
    };
    expect(() => semanticRelationshipIndexCheckpointSchema.parse(base)).toThrow();
    expect(() =>
      semanticRelationshipIndexCheckpointSchema.parse({
        ...base,
        attempt_id: "00000000-0000-4000-8000-000000000007",
        attempt_fence: 3,
        build_id: "00000000-0000-4000-8000-000000000008",
        manifest_digest: hash("7"),
        node_count: 2,
        edge_count: 1,
        indexed_at: "2026-08-09T00:03:00.000Z",
      }),
    ).not.toThrow();
  });

  it("permits Neo4j reads only for a READY, digest-bound, exact active release", () => {
    const result = {
      schema_version: "semantic-relationship-search-result@1.0.0",
      release_identity: releaseIdentity,
      pointer_observation: pointerObservation,
      is_active: true,
      source: "NEO4J",
      index_state: "READY",
      index_reason_code: null,
      manifest_digest: hash("7"),
      root: null,
      term: "revenue",
      categories: ["GOVERN"],
      nodes: [metricNode, releaseNode],
      edges: [governEdge],
      truncated: false,
      truncation_reasons: [],
      explanation: {
        summary: "Exact release Neo4j relationship search.",
        requested_hop_limit: 2,
        traversed_hops: 1,
        categories: ["GOVERN"],
        authority_revalidated: true,
        fallback_reason: null,
      },
    };
    expect(() => semanticRelationshipSearchResultSchema.parse(result)).not.toThrow();
    expect(() =>
      semanticRelationshipSearchResultSchema.parse({
        ...result,
        index_state: "STALE",
        manifest_digest: null,
      }),
    ).toThrow();
    expect(() =>
      semanticRelationshipSearchResultSchema.parse({
        ...result,
        pointer_observation: { ...pointerObservation, current_release_generation: 8 },
      }),
    ).toThrow();
  });
});
