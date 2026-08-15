import { describe, expect, it } from "vitest";
import {
  BUILTIN_SEMANTIC_EDGE_TYPES,
  BUILTIN_SEMANTIC_NODE_TYPES,
  SEMANTIC_GRAPH_SOURCE_VERSION,
  semanticGraphPatchSchema,
  semanticGraphSourceSchema,
} from "../src/artifacts/semantic-graph-v2.js";

const metadata = {
  graph_version: SEMANTIC_GRAPH_SOURCE_VERSION,
  graph_id: "00000000-0000-1000-8000-000000000101",
  domain_id: "ecommerce",
  base_release_id: null,
  capability_profile: "U5_EXECUTABLE_SUBSET" as const,
  scope: {
    app_id: "00000000-0000-1000-8000-000000000102",
    tenant_id: "00000000-0000-1000-8000-000000000103",
    environment: "test" as const,
  },
  producer: { kind: "deterministic" as const, id: "semantic-graph-test" },
  authority: {
    kind: "deterministic" as const,
    id: "semantic-authority",
    policy_version: "semantic-authority@2.0.0",
  },
  created_at: "2026-08-15T00:00:00Z",
};

const common = {
  node_version: 1,
  description: "fixture",
  aliases: [] as string[],
  owner_ref: "data-team",
  lifecycle: "ACTIVE" as const,
  evidence_refs: [] as string[],
  tags: [] as string[],
};

function validGraph() {
  return {
    metadata,
    node_type_registry: BUILTIN_SEMANTIC_NODE_TYPES,
    edge_type_registry: BUILTIN_SEMANTIC_EDGE_TYPES,
    evidence: [],
    nodes: [
      {
        ...common,
        node_id: "subject-order",
        node_type: "BUSINESS_SUBJECT" as const,
        name: "订单",
        domain: "ecommerce",
      },
      {
        ...common,
        node_id: "dimension-product",
        node_type: "DIMENSION" as const,
        name: "商品",
        data_type: "text" as const,
        sensitivity: "PUBLIC" as const,
        filter_semantics: "EXACT" as const,
      },
      {
        ...common,
        node_id: "metric-product-count",
        node_type: "METRIC" as const,
        name: "成交商品数",
        unit: {
          unit_id: "unit-count",
          dimension: "count" as const,
          base_unit: null,
          conversion_factor: null,
        },
        additivity: "non-additive" as const,
        null_policy: "exclude" as const,
        fanout_policy: "reject" as const,
      },
      {
        ...common,
        node_id: "formula-product-count",
        node_type: "FORMULA" as const,
        name: "成交商品数公式",
        formula_type: "non_additive_aggregate" as const,
        return_type: "integer" as const,
        language: "semantic-ast" as const,
        language_version: "semantic-formula-ast@1" as const,
        expression: {
          kind: "AGGREGATE" as const,
          function: "COUNT_DISTINCT" as const,
          input: { kind: "SLOT" as const, slot_id: "product" },
          distinct: true,
          filter: null,
        },
      },
      {
        ...common,
        node_id: "table-order-item",
        node_type: "PHYSICAL_TABLE" as const,
        name: "fact_order_item",
        schema_snapshot_id: "00000000-0000-1000-8000-000000000104",
        snapshot_content_hash: `sha256:${"1".repeat(64)}`,
        datasource_id: "00000000-0000-1000-8000-000000000105",
        schema_name: "mart",
        table_name: "fact_order_item",
        relation_kind: "TABLE" as const,
      },
      {
        ...common,
        node_id: "column-order-item-product-id",
        node_type: "PHYSICAL_COLUMN" as const,
        name: "product_id",
        schema_snapshot_id: "00000000-0000-1000-8000-000000000104",
        snapshot_content_hash: `sha256:${"1".repeat(64)}`,
        datasource_id: "00000000-0000-1000-8000-000000000105",
        schema_name: "mart",
        table_name: "fact_order_item",
        column_name: "product_id",
        ordinal: 1,
        formatted_type: "text",
        data_type: "text" as const,
        nullable: false,
        sensitivity: "PUBLIC" as const,
      },
    ],
    edges: [],
  };
}

describe("SemanticGraphSource@2 contract", () => {
  it("accepts six independent node identities and a slot-based Formula AST", () => {
    const parsed = semanticGraphSourceSchema.parse(validGraph());
    expect(new Set(parsed.nodes.map((node) => node.node_type))).toEqual(
      new Set([
        "BUSINESS_SUBJECT",
        "DIMENSION",
        "METRIC",
        "FORMULA",
        "PHYSICAL_TABLE",
        "PHYSICAL_COLUMN",
      ]),
    );
  });

  it.each(["table_id", "column_id", "formula", "dependency_node_ids"])(
    "rejects embedded cross-node field %s on Metric",
    (field) => {
      const graph = validGraph();
      const metric = graph.nodes.find((node) => node.node_type === "METRIC");
      if (metric === undefined) throw new Error("fixture Metric missing");
      Object.assign(metric, { [field]: "forbidden" });
      expect(semanticGraphSourceSchema.safeParse(graph).success).toBe(false);
    },
  );

  it("requires typed edge attributes instead of arbitrary embedded data", () => {
    const graph = validGraph();
    const edge = {
      edge_id: "edge-formula-ref",
      edge_version: 1,
      edge_type: "REFERENCES" as const,
      family: "FORMULA" as const,
      source_node_id: "formula-product-count",
      target_node_id: "column-order-item-product-id",
      lifecycle: "ACTIVE" as const,
      attributes: {
        kind: "SLOT_BINDING" as const,
        slot_id: "product",
        role: "MEASURE" as const,
      },
      evidence_refs: [] as string[],
    };
    expect(semanticGraphSourceSchema.safeParse({ ...graph, edges: [edge] }).success).toBe(true);

    expect(
      semanticGraphSourceSchema.safeParse({
        ...graph,
        edges: [{ ...edge, attributes: { ...edge.attributes, table_id: "mart.fact_order_item" } }],
      }).success,
    ).toBe(false);
  });

  it("accepts append-only graph patches with optimistic concurrency evidence", () => {
    expect(
      semanticGraphPatchSchema.safeParse({
        patch_version: "semantic-graph-patch@1",
        patch_id: "00000000-0000-1000-8000-000000000106",
        graph_id: metadata.graph_id,
        candidate_id: "00000000-0000-1000-8000-000000000107",
        from_working_revision: 7,
        to_working_revision: 8,
        before_digest: `sha256:${"2".repeat(64)}`,
        after_digest: `sha256:${"3".repeat(64)}`,
        operations: [
          {
            operation: "RETIRE_EDGE",
            edge_id: "edge-old-binding",
            expected_edge_version: 2,
            expected_entry_digest: `sha256:${"4".repeat(64)}`,
            retirement_reason: "Rebind metric formula",
          },
        ],
        patch_digest: `sha256:${"5".repeat(64)}`,
      }).success,
    ).toBe(true);
  });
});
