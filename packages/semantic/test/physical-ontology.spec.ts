import {
  BUILTIN_SEMANTIC_EDGE_TYPES,
  BUILTIN_SEMANTIC_NODE_TYPES,
  type PhysicalSchemaSnapshot,
  type SemanticGraphSource,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { materializePhysicalOntology } from "../src/graph-v2/canonicalize.js";
import { validateSemanticGraph } from "../src/graph-v2/validator.js";

const SNAPSHOT_ID = "00000000-0000-4000-8000-000000000701";
const DATASOURCE_ID = "00000000-0000-4000-8000-000000000702";
const SNAPSHOT_HASH = `sha256:${"7".repeat(64)}` as const;

function column(column_name: string, ordinal_position: number, formatted_type: string) {
  return {
    column_name,
    ordinal_position,
    formatted_type,
    type_identity: {
      type_schema: "pg_catalog",
      type_name: formatted_type,
      type_kind: "BASE" as const,
      array_dimensions: 0,
    },
    nullable: false,
    default_expression: null,
    identity_generation: null,
    generated_expression: null,
    comment: null,
  };
}

function snapshot(reverse = false): PhysicalSchemaSnapshot {
  const relations: PhysicalSchemaSnapshot["content"]["relations"] = [
    {
      identity: { schema_name: "mart", relation_name: "fct_orders" },
      relation_kind: "TABLE",
      comment: "订单事实表",
      columns: [column("order_id", 1, "uuid"), column("customer_id", 2, "uuid")],
      primary_key: {
        constraint_name: "fct_orders_pkey",
        columns: ["order_id"],
        deferrable: false,
        initially_deferred: false,
      },
      foreign_keys: [
        {
          constraint_name: "fct_orders_customer_fk",
          referenced_relation: { schema_name: "mart", relation_name: "dim_customer" },
          column_pairs: [{ column_name: "customer_id", referenced_column_name: "customer_id" }],
          match_type: "SIMPLE",
          on_update: "NO_ACTION",
          on_delete: "NO_ACTION",
          deferrable: false,
          initially_deferred: false,
        },
      ],
      unique_constraints: [],
      check_constraints: [],
      indexes: [],
    },
    {
      identity: { schema_name: "mart", relation_name: "dim_customer" },
      relation_kind: "TABLE",
      comment: "客户维表",
      columns: [column("customer_id", 1, "uuid")],
      primary_key: {
        constraint_name: "dim_customer_pkey",
        columns: ["customer_id"],
        deferrable: false,
        initially_deferred: false,
      },
      foreign_keys: [],
      unique_constraints: [],
      check_constraints: [],
      indexes: [],
    },
  ];
  return {
    schema_version: "physical-schema-snapshot@1.0.0",
    snapshot_id: SNAPSHOT_ID,
    scan_run_id: "00000000-0000-4000-8000-000000000703",
    snapshot_content_hash: SNAPSHOT_HASH,
    captured_at: "2026-08-15T00:00:00.000Z",
    content: {
      schema_version: "physical-schema-content@1.0.0",
      datasource_id: DATASOURCE_ID,
      datasource_fingerprint: `sha256:${"8".repeat(64)}`,
      engine: "postgresql",
      engine_version: { major: 16, minor: 4 },
      database_identity: { database_name: "ecommerce", database_oid: 16_384 },
      included_schemas: ["mart"],
      relations: reverse ? [...relations].reverse() : relations,
    },
  };
}

describe("physical schema to ontology materialization", () => {
  it("deterministically creates Table, Column, CONTAINS_COLUMN and FK facts", async () => {
    const first = await materializePhysicalOntology(snapshot(), "schema-discovery");
    const second = await materializePhysicalOntology(snapshot(true), "schema-discovery");
    expect(first).toEqual(second);
    expect(first.nodes.filter((node) => node.node_type === "PHYSICAL_TABLE")).toHaveLength(2);
    expect(first.nodes.filter((node) => node.node_type === "PHYSICAL_COLUMN")).toHaveLength(3);
    expect(first.edges.filter((edge) => edge.edge_type === "CONTAINS_COLUMN")).toHaveLength(3);
    const foreignKey = first.edges.find((edge) => edge.edge_type === "FOREIGN_KEY_TO");
    expect(foreignKey).toMatchObject({
      family: "PHYSICAL",
      attributes: { kind: "PHYSICAL_FACT", fact_kind: "FOREIGN_KEY" },
    });
    expect(foreignKey?.evidence_refs).toHaveLength(2);
  });

  it("does not pretend a database FK is a business relation or safe analytical Join", async () => {
    const physical = await materializePhysicalOntology(snapshot(), "schema-discovery");
    expect(physical.edges.some((edge) => edge.edge_type === "RELATES_TO")).toBe(false);
    expect(physical.edges.some((edge) => edge.edge_type === "JOINABLE_VIA")).toBe(false);

    const graph: SemanticGraphSource = {
      metadata: {
        graph_version: "semantic-graph-source@2",
        graph_id: "00000000-0000-4000-8000-000000000704",
        domain_id: "ecommerce",
        base_release_id: null,
        capability_profile: "U5_EXECUTABLE_SUBSET",
        scope: {
          app_id: "00000000-0000-4000-8000-000000000705",
          tenant_id: "00000000-0000-4000-8000-000000000706",
          environment: "test",
        },
        producer: { kind: "deterministic", id: "schema-discovery" },
        authority: {
          kind: "deterministic",
          id: "semantic-authority",
          policy_version: "semantic-authority@2.0.0",
        },
        created_at: "2026-08-15T00:00:00.000Z",
      },
      node_type_registry: [...BUILTIN_SEMANTIC_NODE_TYPES],
      edge_type_registry: [...BUILTIN_SEMANTIC_EDGE_TYPES],
      evidence: [...physical.evidence],
      nodes: [...physical.nodes],
      edges: [...physical.edges],
    };
    expect(validateSemanticGraph(graph)).toEqual([]);
  });
});
