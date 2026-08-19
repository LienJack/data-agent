import {
  type SemanticExplorerDomainSummary,
  semanticExplorerSnapshotSchema,
} from "@data-agent/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const explorerApi = vi.hoisted(() => ({
  getDomains: vi.fn(),
  getActiveSnapshot: vi.fn(),
}));

vi.mock("@/lib/semantic-explorer-api", () => ({
  getExplorerDomains: explorerApi.getDomains,
  getActiveExplorerSnapshot: explorerApi.getActiveSnapshot,
}));

import { useDataLinkStore } from "@/lib/data-link-store";

const ids = {
  release: "00000000-0000-4000-8000-000000000101",
  datasource: "00000000-0000-4000-8000-000000000102",
  executable: "00000000-0000-4000-8000-000000000103",
  relationship: "00000000-0000-4000-8000-000000000104",
  restriction: "00000000-0000-4000-8000-000000000105",
} as const;
const digest = `sha256:${"d".repeat(64)}` as const;
const pointer = {
  current_release_id: ids.release,
  current_release_generation: 1,
  current_release_digest: digest,
  pointer_generation: 2,
  observed_at: "2026-08-15T10:14:00.000Z",
} as const;
const domain: SemanticExplorerDomainSummary = {
  schema_version: "semantic-explorer-domain-summary@1.0.0",
  semantic_domain: "ecommerce",
  display_name: "电商经营分析",
  description: "AgenticDataBench E-commerce 已发布语义模型",
  datasource_id: ids.datasource,
  pointer_observation: pointer,
  has_current_release: true,
};
const snapshot = semanticExplorerSnapshotSchema.parse({
  schema_version: "semantic-explorer-snapshot@1.0.0",
  authority: "POSTGRESQL",
  release_identity: {
    semantic_domain: "ecommerce",
    release_id: ids.release,
    release_generation: 1,
    release_digest: digest,
    executable_projection: { projection_id: ids.executable, projection_digest: digest },
    relationship_projection: { projection_id: ids.relationship, projection_digest: digest },
    runtime_restriction_projection: {
      projection_id: ids.restriction,
      projection_digest: digest,
    },
    published_at: "2026-08-15T10:13:00.000Z",
    published_by: "workspace-admin",
  },
  pointer_observation: pointer,
  is_active: true,
  capabilities: {
    business_ontology: true,
    physical_binding: true,
    catalog_governance: true,
  },
  objects: [
    {
      identity: { kind: "metric", object_id: "gmv" },
      status: "published",
      canonical_digest: digest,
      name: "GMV",
      description: "成交总额",
      aliases: ["商品交易总额"],
      owner: null,
      restricted: false,
      payload: {
        kind: "metric",
        table_id: "fact_order_item",
        column_id: "price_brl",
        aggregation: "sum",
        formula: null,
        grain: { grain_id: "order_item", description: "订单明细", granularity: "atomic" },
        unit: {
          unit_id: "brl",
          description: "巴西雷亚尔",
          dimension: "currency",
          base_unit: null,
          conversion_factor: null,
        },
        time_domain: null,
        time_column_id: null,
        additivity: "additive",
        null_policy: "preserve",
        fanout_policy: "reject",
        dependency_column_ids: [],
        tags: [],
        bindings: [
          {
            datasource_id: ids.datasource,
            schema_name: "demo_adb_ecommerce_mart",
            table_name: "fact_order_item",
            column_name: "price_brl",
            lifecycle: "active",
            valid_from: null,
            valid_until: null,
          },
        ],
      },
    },
    {
      identity: { kind: "dimension", object_id: "customer_state" },
      status: "published",
      canonical_digest: digest,
      name: "客户州",
      description: "客户所在州",
      aliases: [],
      owner: null,
      restricted: false,
      payload: {
        kind: "dimension",
        table_id: "dim_customer",
        column_id: "state",
        grain: { grain_id: "customer", description: "客户", granularity: "atomic" },
        data_type: "text",
        sensitivity: "PUBLIC",
        hierarchical: false,
        parent_dimension_id: null,
        tags: [],
        bindings: [
          {
            datasource_id: ids.datasource,
            schema_name: "demo_adb_ecommerce_mart",
            table_name: "dim_customer",
            column_name: "state",
            lifecycle: "active",
            valid_from: null,
            valid_until: null,
          },
        ],
      },
    },
    {
      identity: { kind: "relationship", object_id: "order_item_product" },
      status: "published",
      canonical_digest: digest,
      name: "订单明细关联商品",
      description: "通过商品标识关联",
      aliases: [],
      owner: null,
      restricted: false,
      payload: {
        kind: "relationship",
        relationship_kind: "analytical",
        left: { table_id: "fact_order_item", column_ids: ["product_id"] },
        right: { table_id: "dim_product", column_ids: ["product_id"] },
        cardinality: "many-to-one",
        direction: "left-to-right",
        row_preservation: "left",
        fanout_grain_proof: null,
        proof_kind: "DDL_ENFORCED",
        proof_detail: null,
        bindings: [],
      },
    },
  ],
  edges: [],
  counts: {
    total_objects: 3,
    by_object_kind: {
      business_entity: 0,
      business_event: 0,
      business_term: 0,
      metric: 1,
      dimension: 1,
      relationship: 1,
      datasource: 0,
    },
    total_edges: 0,
    by_edge_kind: {
      metric_dependency: 0,
      dimension_hierarchy: 0,
      analytical_relationship: 0,
      business_relationship: 0,
      physical_binding: 0,
    },
  },
});

beforeEach(() => {
  explorerApi.getDomains.mockReset();
  explorerApi.getActiveSnapshot.mockReset();
  useDataLinkStore.getState().reset();
});

describe("Data Link published model store", () => {
  it("loads active PostgreSQL releases through the Semantic Explorer authority", async () => {
    explorerApi.getDomains.mockResolvedValue([domain]);
    explorerApi.getActiveSnapshot.mockResolvedValue(snapshot);

    await useDataLinkStore.getState().loadModels();

    expect(explorerApi.getActiveSnapshot).toHaveBeenCalledWith("ecommerce");
    expect(useDataLinkStore.getState()).toMatchObject({
      loading: false,
      error: undefined,
      models: [
        {
          id: ids.release,
          name: "电商经营分析",
          domain: "ecommerce",
          version: 1,
          metrics: [{ id: "gmv", table: "demo_adb_ecommerce_mart.fact_order_item" }],
          dimensions: [{ id: "customer_state", table: "demo_adb_ecommerce_mart.dim_customer" }],
          relationships: [{ id: "order_item_product", type: "many-to-one" }],
        },
      ],
    });
    expect(useDataLinkStore.getState().models[0]?.tableMappings).toHaveLength(2);
  });

  it("surfaces an authority failure instead of silently presenting an empty model list", async () => {
    explorerApi.getDomains.mockResolvedValue([domain]);
    explorerApi.getActiveSnapshot.mockRejectedValue(new Error("语义 Release 无法读取"));

    await useDataLinkStore.getState().loadModels();

    expect(useDataLinkStore.getState()).toMatchObject({
      loading: false,
      models: [],
      error: "语义 Release 无法读取",
    });
  });
});
