import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type PhysicalRelation,
  type PhysicalSchemaSnapshot,
  semanticSourceBundleSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import {
  compileSemanticGraphV2,
  validateSemanticGraph,
  validateSemanticOntologyCoverage,
} from "@data-agent/semantic";
import { describe, expect, it } from "vitest";
import { buildEcommerceGraphV2 } from "../src/lib/ecommerce-graph-v2";

const APP_ID = "00000000-0000-4000-8000-00000000da01";
const TENANT_ID = "00000000-0000-4000-8000-00000000ec11";
const DATASOURCE_ID = "00000000-0000-4000-8000-00000000ec01";
const GRAPH_ID = "00000000-0000-4000-8000-00000000ec40";
const BASE_RELEASE_ID = "00000000-0000-4000-8000-00000000ec25";
const SNAPSHOT_ID = "00000000-0000-4000-8000-00000000ec41";
const SNAPSHOT_HASH = `sha256:${"4".repeat(64)}` as const;
const CAPTURED_AT = "2026-08-16T00:00:00.000Z";

const bundle = semanticSourceBundleSchema.parse(
  JSON.parse(
    readFileSync(
      resolve(
        import.meta.dirname,
        "../../../infra/agenticdatabench/ecommerce-v1/semantic/ecommerce-source-bundle.json",
      ),
      "utf8",
    ),
  ),
);

const relationColumns = {
  dim_amazon_product: {
    asin: "text",
    brand: "text",
    main_category: "text",
    price_usd: "numeric",
  },
  dim_category: { category_name: "text" },
  dim_customer: { city: "text", customer_id: "text", state: "text" },
  dim_date: { date_key: "date" },
  dim_ebay_listing: {
    brand: "text",
    listing_id: "text",
    operating_system: "text",
    price_usd: "numeric",
    ram_gb: "numeric",
    ssd_gb: "numeric",
  },
  dim_geolocation_zip: { state: "text", zip_code_prefix: "integer" },
  dim_product: {
    category_name: "text",
    category_name_english: "text",
    product_id: "text",
  },
  dim_seller: { city: "text", seller_id: "text", state: "text" },
  fact_amazon_review: { asin: "text", rating: "numeric", review_row_id: "integer" },
  fact_delivery_state_month: {
    avg_delivery_delay_days: "numeric",
    avg_haversine_distance_km: "numeric",
    customer_state: "text",
    purchase_month: "date",
    seller_state: "text",
    total_orders: "integer",
  },
  fact_order: {
    customer_id: "text",
    delivery_delay_days: "numeric",
    order_id: "text",
    order_status: "text",
    purchase_date: "date",
    purchased_at: "timestamp without time zone",
  },
  fact_order_item: {
    freight_value_brl: "numeric",
    order_id: "text",
    order_item_id: "integer",
    price_brl: "numeric",
    product_id: "text",
    seller_id: "text",
  },
  fact_payment: {
    installments: "integer",
    order_id: "text",
    payment_sequence: "integer",
    payment_type: "text",
    payment_value_brl: "numeric",
  },
  fact_review: { order_id: "text", review_row_id: "integer", review_score: "integer" },
} as const;

function relation(name: keyof typeof relationColumns): PhysicalRelation {
  return {
    identity: { schema_name: "demo_adb_ecommerce_mart", relation_name: name },
    relation_kind: "TABLE",
    comment: null,
    columns: Object.entries(relationColumns[name]).map(([columnName, formattedType], index) => ({
      column_name: columnName,
      ordinal_position: index + 1,
      formatted_type: formattedType,
      type_identity: {
        type_schema: "pg_catalog",
        type_name: formattedType,
        type_kind: "BASE",
        array_dimensions: 0,
      },
      nullable: false,
      default_expression: null,
      identity_generation: null,
      generated_expression: null,
      comment: null,
    })),
    primary_key: null,
    foreign_keys: [],
    unique_constraints: [],
    check_constraints: [],
    indexes: [],
  };
}

function snapshot(reverse = false): PhysicalSchemaSnapshot {
  const relations = Object.keys(relationColumns).map((name) =>
    relation(name as keyof typeof relationColumns),
  );
  return {
    schema_version: "physical-schema-snapshot@1.0.0",
    snapshot_id: SNAPSHOT_ID,
    scan_run_id: "00000000-0000-4000-8000-00000000ec42",
    snapshot_content_hash: SNAPSHOT_HASH,
    captured_at: CAPTURED_AT,
    content: {
      schema_version: "physical-schema-content@1.0.0",
      datasource_id: DATASOURCE_ID,
      datasource_fingerprint: `sha256:${"5".repeat(64)}`,
      engine: "postgresql",
      engine_version: { major: 17, minor: 2 },
      database_identity: { database_name: "data_agent", database_oid: 16_384 },
      included_schemas: ["demo_adb_ecommerce_mart"],
      relations: reverse ? relations.reverse() : relations,
    },
  };
}

async function joinEvidence() {
  return Object.fromEntries(
    await Promise.all(
      bundle.relationships.map(async (relationship) => [
        relationship.relationship_id,
        {
          content_hash: await sha256ContentHash({
            relationship_id: relationship.relationship_id,
            orphan_count: 0,
            observed_snapshot: SNAPSHOT_HASH,
          }),
          description: `${relationship.name} orphan_count=0`,
        },
      ]),
    ),
  );
}

async function graph(reverse = false) {
  return buildEcommerceGraphV2({
    bundle,
    snapshot: snapshot(reverse),
    graph_id: GRAPH_ID,
    base_release_id: BASE_RELEASE_ID,
    scope: { app_id: APP_ID, tenant_id: TENANT_ID, environment: "local" },
    created_at: CAPTURED_AT,
    join_evidence: await joinEvidence(),
  });
}

describe("E-commerce Semantic Graph v2 migration", () => {
  it("separates ontology objects into nodes and expresses meaning through explicit edges", async () => {
    const source = await graph();

    expect(validateSemanticGraph(source)).toEqual([]);
    expect(validateSemanticOntologyCoverage(source)).toEqual([]);
    expect(source.nodes.filter((node) => node.node_type === "BUSINESS_SUBJECT")).toHaveLength(14);
    expect(source.nodes.filter((node) => node.node_type === "DIMENSION")).toHaveLength(15);
    expect(source.nodes.filter((node) => node.node_type === "METRIC")).toHaveLength(32);
    expect(source.nodes.filter((node) => node.node_type === "FORMULA")).toHaveLength(32);
    expect(source.nodes.filter((node) => node.node_type === "PHYSICAL_TABLE")).toHaveLength(14);
    expect(source.nodes.filter((node) => node.node_type === "GLOSSARY_TERM")).toHaveLength(52);
    expect(source.edges.filter((edge) => edge.edge_type === "JOINABLE_VIA")).toHaveLength(8);
    expect(source.edges.some((edge) => edge.edge_type === "FOREIGN_KEY_TO")).toBe(false);

    const metric = source.nodes.find((node) => node.node_id === "ecommerce-order-count@1");
    expect(metric).toMatchObject({ node_type: "METRIC", name: "订单量" });
    expect(metric).not.toHaveProperty("table_id");
    expect(metric).not.toHaveProperty("column_id");
    expect(metric).not.toHaveProperty("formula");
    expect(
      source.edges.map((edge) => [edge.edge_type, edge.source_node_id, edge.target_node_id]),
    ).toEqual(
      expect.arrayContaining([
        ["HAS_METRIC", "ecommerce-entity-2@1", "ecommerce-order-count@1"],
        ["DEFINED_BY", "ecommerce-order-count@1", "formula-ecommerce-order-count@1"],
        ["AT_GRAIN", "formula-ecommerce-order-count@1", "ecommerce-entity-2@1"],
        ["HAS_DIMENSION", "ecommerce-entity-2@1", "ecommerce-order-status@1"],
      ]),
    );
  });

  it("preserves metric time context without treating it as a measure dependency", async () => {
    const source = await graph();
    const compiled = await compileSemanticGraphV2(source);
    const orderCount = compiled.runtime_bundle.metrics.find(
      (metric) => metric.metric_id === "ecommerce-order-count@1",
    );
    const orderTable = source.nodes.find(
      (node) => node.node_type === "PHYSICAL_TABLE" && node.table_name === "fact_order",
    );
    const orderId = source.nodes.find(
      (node) =>
        node.node_type === "PHYSICAL_COLUMN" &&
        node.table_name === "fact_order" &&
        node.column_name === "order_id",
    );

    expect(orderCount?.time_column_id).not.toBeNull();
    expect(orderCount?.dependency_column_ids).toEqual([
      `${orderTable?.node_id}.${orderId?.node_id}`,
    ]);
  });

  it("is deterministic across physical snapshot ordering", async () => {
    await expect(graph(true)).resolves.toEqual(await graph(false));
  });

  it("fails closed when a declared analytical join has no query evidence", async () => {
    const evidence = await joinEvidence();
    delete evidence["ecommerce-order-customer@1"];

    await expect(
      buildEcommerceGraphV2({
        bundle,
        snapshot: snapshot(),
        graph_id: GRAPH_ID,
        base_release_id: BASE_RELEASE_ID,
        scope: { app_id: APP_ID, tenant_id: TENANT_ID, environment: "local" },
        created_at: CAPTURED_AT,
        join_evidence: evidence,
      }),
    ).rejects.toThrow("ECOMMERCE_GRAPH_JOIN_EVIDENCE_MISSING");
  });
});
