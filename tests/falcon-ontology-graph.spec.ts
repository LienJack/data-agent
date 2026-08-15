import { describe, expect, it } from "vitest";
import {
  buildFalconDb24OntologyGraph,
  FALCON_DB24_JOIN_SPECS,
  loadFalconPreview,
} from "../packages/evals/src/index";
import {
  compileSemanticGraphV2,
  createSemanticOntologyCoverageReceipt,
} from "../packages/semantic/src/index";

describe("Falcon db24 ontology graph", () => {
  it("compiles a complete node/edge ontology without merging the inventory snapshots", async () => {
    const preview = await loadFalconPreview();
    const mainDemoCase = preview.main_demo_cases[0];
    expect(mainDemoCase).toBeDefined();
    const graph = buildFalconDb24OntologyGraph({
      schema: mainDemoCase?.schema ?? [],
      source_digest: preview.manifest.source_digest,
      scope: {
        app_id: "00000000-0000-4000-8000-00000000da01",
        tenant_id: "00000000-0000-4000-8000-00000000da02",
        environment: "test",
      },
      created_at: "2026-08-16T00:00:00.000Z",
      join_evidence: Object.fromEntries(
        FALCON_DB24_JOIN_SPECS.map((join) => [
          join.join_id,
          {
            content_hash: preview.manifest.source_digest,
            description: `fixed snapshot ${join.join_id}`,
            cardinality: "many-to-one" as const,
          },
        ]),
      ),
    });

    const coverage = await createSemanticOntologyCoverageReceipt(graph, "2026-08-16T00:00:00.000Z");
    const compilation = await compileSemanticGraphV2(graph);

    expect(coverage.valid).toBe(true);
    expect(coverage.issues).toEqual([]);
    expect(coverage.active_node_counts).toMatchObject({
      BUSINESS_SUBJECT: 9,
      DIMENSION: 17,
      METRIC: 21,
      FORMULA: 21,
      PHYSICAL_TABLE: 9,
      PHYSICAL_COLUMN: 70,
      GLOSSARY_TERM: 10,
    });
    expect(coverage.active_edge_family_counts).toMatchObject({
      BUSINESS: 9,
      JOIN: 8,
      TERMINOLOGY: 10,
    });
    expect(compilation.runtime_bundle.metrics).toHaveLength(21);
    expect(compilation.runtime_bundle.dimensions).toHaveLength(17);
    expect(compilation.runtime_bundle.relationships).toHaveLength(8);
    expect(compilation.u5_projection.errors).toEqual([]);

    expect(graph.nodes.some((node) => node.node_id === "subject-inventory-snapshot")).toBe(true);
    expect(graph.nodes.some((node) => node.node_id === "subject-inventory-new-snapshot")).toBe(
      true,
    );
    expect(
      graph.edges.some(
        (edge) =>
          edge.edge_type === "JOINABLE_VIA" &&
          new Set([edge.source_node_id, edge.target_node_id]).has(
            "column-blinkit-inventory-product-id",
          ) &&
          new Set([edge.source_node_id, edge.target_node_id]).has(
            "column-blinkit-inventorynew-product-id",
          ),
      ),
    ).toBe(false);
    expect(
      graph.edges.some(
        (edge) =>
          edge.edge_type === "DENOTES" &&
          edge.source_node_id === "term-segment-average-customer-total" &&
          edge.target_node_id === "dimension-customer-segment",
      ),
    ).toBe(true);
  });
});
