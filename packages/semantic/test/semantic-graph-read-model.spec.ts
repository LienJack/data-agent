import {
  SEMANTIC_GRAPH_PROJECTION_VERSION,
  type SemanticGraphEdge,
  type SemanticGraphNode,
  type SemanticGraphProjection,
  sha256ContentHash,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { compileSemanticGraphV2 } from "../src/graph-v2/compiler.js";
import {
  createSemanticGraphReadModel,
  projectSemanticGraphSourceForRead,
} from "../src/read-model/index.js";
import { createSemanticGraphV2Fixture } from "./fixtures/semantic-graph-v2.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("fixture entry missing");
  return value;
}

async function smallProjection(): Promise<SemanticGraphProjection> {
  return (await compileSemanticGraphV2(createSemanticGraphV2Fixture())).native_projection;
}

function businessNode(index: number, domain = `domain-${index % 20}`): SemanticGraphNode {
  return {
    node_id: `subject-${index}`,
    node_version: 1,
    node_type: "BUSINESS_SUBJECT",
    name: `业务主体 ${index.toString().padStart(5, "0")}`,
    description: `规模测试节点 ${index}`,
    aliases: [],
    owner_ref: "owner-data",
    lifecycle: "ACTIVE",
    evidence_refs: [],
    tags: [],
    domain,
  };
}

async function projection(
  nodes: readonly SemanticGraphNode[],
  edges: readonly SemanticGraphEdge[],
): Promise<SemanticGraphProjection> {
  return {
    projection_version: SEMANTIC_GRAPH_PROJECTION_VERSION,
    graph_id: "10000000-0000-4000-8000-000000000001",
    source_digest: await sha256ContentHash({ nodes, edges }),
    registry_digest: await sha256ContentHash({ registry: "fixture" }),
    compiler_version: "semantic-graph-compiler@test",
    node_count: nodes.length,
    edge_count: edges.length,
    nodes: [...nodes],
    edges: [...edges],
  };
}

describe("Semantic Graph unified read model", () => {
  it("keeps published and candidate status identical across list, local and full views", async () => {
    const published = await smallProjection();
    const candidate = structuredClone(published);
    const metric = required(candidate.nodes.find((node) => node.node_type === "METRIC"));
    if (metric.node_type !== "METRIC") throw new Error("metric missing");
    metric.name = "候选成交商品数";
    metric.node_version += 1;
    const dimension = required(candidate.nodes.find((node) => node.node_type === "DIMENSION"));
    candidate.nodes.push({ ...dimension, node_id: "dimension-category", name: "商品品类" });
    const reference = required(candidate.edges.find((edge) => edge.edge_type === "REFERENCES"));
    reference.lifecycle = "RETIRED";
    reference.edge_version += 1;
    candidate.node_count = candidate.nodes.length;
    candidate.source_digest = await sha256ContentHash({
      nodes: candidate.nodes,
      edges: candidate.edges,
    });

    const model = await createSemanticGraphReadModel(published, candidate);
    const list = model.listNodes({ statuses: ["MODIFIED"] });
    expect(list.items.map(({ node }) => node.node_id)).toEqual(["metric-product-count"]);
    expect(model.getNode("dimension-category")?.status).toBe("ADDED");
    expect(model.getEdge(reference.edge_id)?.status).toBe("RETIRED");

    const local = model.neighborhood({
      center_node_id: "metric-product-count",
      hops: 2,
      direction: "BOTH",
      families: [],
      continuation: 0,
      node_limit: 250,
      edge_limit: 500,
    });
    expect(local.identity.consistency_token).toBe(model.identity.consistency_token);
    expect(local.nodes.find(({ node }) => node.node_id === "metric-product-count")?.status).toBe(
      "MODIFIED",
    );

    const clusterId = model.fullGraph().clusters[0]?.cluster_id;
    expect(clusterId).toBeDefined();
    const full = model.fullGraph({ expanded_cluster_ids: [required(clusterId)] });
    expect(full.identity.consistency_token).toBe(model.identity.consistency_token);
    expect(full.nodes.find(({ node }) => node.node_id === "metric-product-count")?.status).toBe(
      "MODIFIED",
    );
  });

  it("returns deterministic paths, downstream impact and relation counts", async () => {
    const model = await createSemanticGraphReadModel(await smallProjection());
    expect(
      model.getNode("formula-product-count")?.relation_count.by_family.FORMULA,
    ).toBeGreaterThan(0);
    const path = model.shortestPath({
      source_node_id: "subject-order-line",
      target_node_id: "column-order-item-product-id",
      families: [],
      max_hops: 6,
    });
    expect(path.found).toBe(true);
    expect(path.nodes[0]?.node.node_id).toBe("subject-order-line");
    expect(path.nodes.at(-1)?.node.node_id).toBe("column-order-item-product-id");
    expect(model.impact("formula-product-count").nodes.map(({ node }) => node.node_id)).toContain(
      "metric-product-count",
    );
  });

  it("projects an incomplete candidate for live rendering without runtime compilation", async () => {
    const candidate = createSemanticGraphV2Fixture();
    candidate.edges = candidate.edges.filter((edge) => edge.edge_type !== "REFERENCES");
    const readProjection = await projectSemanticGraphSourceForRead(candidate);
    expect(readProjection.nodes).toHaveLength(candidate.nodes.length);
    expect(readProjection.edges).toHaveLength(candidate.edges.length);
    expect(readProjection.compiler_version).toBe("semantic-graph-read-projection@1");
  });

  it("enforces local 250/500 budgets and reports omitted entries", async () => {
    const nodes = Array.from({ length: 301 }, (_, index) => businessNode(index, "commerce"));
    const edges: SemanticGraphEdge[] = Array.from({ length: 600 }, (_, index) => ({
      edge_id: `edge-${index}`,
      edge_version: 1,
      edge_type: "RELATES_TO",
      family: "BUSINESS",
      source_node_id: "subject-0",
      target_node_id: `subject-${(index % 300) + 1}`,
      lifecycle: "ACTIVE",
      attributes: {
        kind: "BUSINESS_RELATION",
        relationship_name: `关系 ${index}`,
        cardinality: "one-to-many",
      },
      evidence_refs: [],
    }));
    const model = await createSemanticGraphReadModel(await projection(nodes, edges));
    const local = model.neighborhood({
      center_node_id: "subject-0",
      hops: 1,
      direction: "BOTH",
      families: [],
      continuation: 0,
      node_limit: 250,
      edge_limit: 500,
    });
    expect(local.nodes).toHaveLength(250);
    expect(local.edges.length).toBeLessThanOrEqual(500);
    expect(local.truncated).toBe(true);
    expect(local.omitted_node_count).toBe(51);
    expect(local.omitted_edge_count).toBeGreaterThan(0);
    expect(local.next_continuation).toBe(249);
  });

  it("serves a 10,000-node graph as stable cluster glyphs on first load", async () => {
    const nodes = Array.from({ length: 10_000 }, (_, index) => businessNode(index));
    const source = await projection(nodes, []);
    const first = await createSemanticGraphReadModel(source);
    const second = await createSemanticGraphReadModel({
      ...source,
      nodes: [...source.nodes].reverse(),
    });
    const firstFull = first.fullGraph();
    const secondFull = second.fullGraph();
    expect(firstFull.nodes).toEqual([]);
    expect(firstFull.clusters).toHaveLength(20);
    expect(firstFull.glyph_count).toBe(20);
    expect(firstFull.hierarchy_digest).toBe(secondFull.hierarchy_digest);
    expect(first.listNodes({ limit: 50 }).items).toHaveLength(50);
  });
});
