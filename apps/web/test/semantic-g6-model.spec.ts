import { describe, expect, it } from "vitest";
import {
  buildFullG6Data,
  buildLocalG6Data,
  semanticG6SourceId,
} from "../src/lib/semantic-g6-model";
import {
  semanticStudioPreviewExpandedFullGraph,
  semanticStudioPreviewSnapshot,
} from "../src/lib/semantic-studio-preview";

describe("semantic G6 graph model", () => {
  it("maps the bounded neighborhood to typed G6 nodes and directed edges", () => {
    const snapshot = semanticStudioPreviewSnapshot();
    const local = snapshot.local;
    expect(local).not.toBeNull();
    if (!local) throw new Error("preview local graph is required");
    const selectedNodeId = local.nodes[0]?.node.node_id ?? null;
    const data = buildLocalG6Data(local, selectedNodeId, null);

    expect(data.nodes).toHaveLength(local.nodes.length);
    expect(data.edges).toHaveLength(local.edges.length);
    expect(data.nodes?.find((node) => node.id === selectedNodeId)?.states).toContain("selected");
    expect(semanticG6SourceId(data.nodes?.[0]?.data)?.kind).toBe("semantic-node");
    expect(semanticG6SourceId(data.edges?.[0]?.data)?.kind).toBe("semantic-edge");
    expect(data.edges?.[0]).toMatchObject({
      source: local.edges[0]?.edge.source_node_id,
      target: local.edges[0]?.edge.target_node_id,
    });
  });

  it("keeps GraphRAG clusters as first-class clickable summary glyphs", () => {
    const snapshot = semanticStudioPreviewSnapshot();
    const data = buildFullG6Data(snapshot.full, null, null);
    const cluster = data.nodes?.find((node) => node.id === snapshot.full.clusters[0]?.cluster_id);

    expect(data.nodes).toHaveLength(snapshot.full.clusters.length + snapshot.full.nodes.length);
    expect(semanticG6SourceId(cluster?.data)).toEqual({
      kind: "cluster",
      sourceId: snapshot.full.clusters[0]?.cluster_id,
    });
    expect(cluster?.style?.labelText).toContain("节点");
  });

  it("shows the complete ontology chain instead of embedding physical fields", () => {
    const local = semanticStudioPreviewSnapshot().local;
    if (!local) throw new Error("preview local graph is required");
    expect([...new Set(local.nodes.map((item) => item.node.node_type))]).toEqual(
      expect.arrayContaining([
        "BUSINESS_SUBJECT",
        "DIMENSION",
        "METRIC",
        "FORMULA",
        "PHYSICAL_TABLE",
        "PHYSICAL_COLUMN",
        "GLOSSARY_TERM",
      ]),
    );
    expect(new Set(local.edges.map((item) => item.edge.family))).toEqual(
      new Set([
        "BUSINESS",
        "ANALYTICAL",
        "FORMULA",
        "PHYSICAL",
        "JOIN",
        "PROVENANCE",
        "TERMINOLOGY",
      ]),
    );
    expect(local.edges.map((item) => item.edge.edge_type)).toEqual(
      expect.arrayContaining([
        "REPRESENTED_BY",
        "IDENTIFIED_BY",
        "USES_DIMENSION",
        "REFERENCES",
        "CONTAINS_COLUMN",
        "FOREIGN_KEY_TO",
        "JOINABLE_VIA",
        "DENOTES",
      ]),
    );
  });

  it("expands a GraphRAG cluster to its own members and internal edges", () => {
    const terminology = semanticStudioPreviewExpandedFullGraph("cluster:terminology:zh-cn");
    expect(terminology.nodes).toHaveLength(11);
    expect(terminology.nodes.every((item) => item.node.node_type === "GLOSSARY_TERM")).toBe(true);
    expect(
      terminology.edges.every(
        (item) =>
          item.edge.family === "TERMINOLOGY" &&
          terminology.nodes.some((node) => node.node.node_id === item.edge.source_node_id) &&
          terminology.nodes.some((node) => node.node.node_id === item.edge.target_node_id),
      ),
    ).toBe(true);
  });

  it("does not trust arbitrary G6 custom data as a semantic identity", () => {
    expect(semanticG6SourceId({ kind: "cluster" })).toBeNull();
    expect(semanticG6SourceId({ kind: "unknown", sourceId: "node-1" })).toBeNull();
    expect(semanticG6SourceId(null)).toBeNull();
  });
});
