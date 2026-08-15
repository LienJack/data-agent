import type {
  SemanticEdgeFamily,
  SemanticGraphCluster,
  SemanticGraphEdge,
  SemanticGraphNode,
  SemanticGraphReadEdge,
  SemanticGraphReadIdentity,
  SemanticGraphReadNode,
} from "@data-agent/contracts";
import type { SemanticStudioSnapshot } from "./semantic-studio-api";

const HASH = `sha256:${"1".repeat(64)}` as const;
const GRAPH_ID = "10000000-0000-4000-8000-000000000001";
const RELEASE_ID = "10000000-0000-4000-8000-000000000002";
const SNAPSHOT_ID = "10000000-0000-4000-8000-000000000003";
const DATASOURCE_ID = "10000000-0000-4000-8000-000000000004";

const common = {
  node_version: 1,
  description: "",
  aliases: [],
  owner_ref: "commerce-team",
  lifecycle: "ACTIVE" as const,
  evidence_refs: [],
  tags: ["电商"],
};

const nodes: SemanticGraphNode[] = [
  {
    ...common,
    node_id: "subject-customer",
    node_type: "BUSINESS_SUBJECT",
    name: "Customer / 客户",
    description: "购买商品并产生订单的业务主体",
    domain: "电商交易域",
  },
  {
    ...common,
    node_id: "subject-order",
    node_type: "BUSINESS_SUBJECT",
    name: "Order / 订单",
    description: "一次客户交易承诺",
    domain: "电商交易域",
  },
  {
    ...common,
    node_id: "subject-order-line",
    node_type: "BUSINESS_SUBJECT",
    name: "OrderLine / 订单明细",
    description: "订单中的商品粒度交易事实",
    domain: "电商交易域",
  },
  {
    ...common,
    node_id: "subject-product",
    node_type: "BUSINESS_SUBJECT",
    name: "Product / 商品",
    description: "可售卖商品",
    domain: "商品域",
  },
  {
    ...common,
    node_id: "dimension-region",
    node_type: "DIMENSION",
    name: "Region / 地区",
    description: "客户所在地区",
    data_type: "text",
    sensitivity: "PUBLIC",
    filter_semantics: "HIERARCHICAL",
  },
  {
    ...common,
    node_id: "dimension-calendar",
    node_type: "DIMENSION",
    name: "Calendar / 日历",
    description: "交易发生日期",
    data_type: "date",
    sensitivity: "PUBLIC",
    filter_semantics: "TEMPORAL",
  },
  {
    ...common,
    node_id: "metric-product-count",
    node_version: 2,
    node_type: "METRIC",
    name: "成交商品数",
    description: "已支付订单中按商品去重后的成交商品数量",
    unit: null,
    additivity: "non-additive",
    null_policy: "exclude",
    fanout_policy: "preaggregate",
  },
  {
    ...common,
    node_id: "metric-gross-revenue",
    node_type: "METRIC",
    name: "商品销售额",
    description: "商品成交金额（未扣除退款）",
    unit: { unit_id: "CNY", dimension: "currency", base_unit: null, conversion_factor: null },
    additivity: "additive",
    null_policy: "coalesce-zero",
    fanout_policy: "reject",
  },
  {
    ...common,
    node_id: "formula-product-count",
    node_version: 2,
    node_type: "FORMULA",
    name: "成交商品数公式",
    description: "COUNT_DISTINCT(product_id) FILTER paid",
    formula_type: "non_additive_aggregate",
    return_type: "integer",
    language: "semantic-ast",
    language_version: "semantic-formula-ast@1",
    expression: {
      kind: "AGGREGATE",
      function: "COUNT_DISTINCT",
      input: { kind: "SLOT", slot_id: "product" },
      distinct: true,
      filter: { kind: "SLOT", slot_id: "paid" },
    },
  },
  {
    ...common,
    node_id: "formula-gross-revenue",
    node_type: "FORMULA",
    name: "销售额公式",
    description: "SUM(quantity * unit_price)",
    formula_type: "additive_aggregate",
    return_type: "numeric",
    language: "semantic-ast",
    language_version: "semantic-formula-ast@1",
    expression: {
      kind: "AGGREGATE",
      function: "SUM",
      input: { kind: "SLOT", slot_id: "line_amount" },
      distinct: false,
      filter: null,
    },
  },
  {
    ...common,
    node_id: "table-order-lines",
    node_type: "PHYSICAL_TABLE",
    name: "fct_order_lines / 明细事实表",
    description: "订单明细事实表",
    schema_snapshot_id: SNAPSHOT_ID,
    snapshot_content_hash: HASH,
    datasource_id: DATASOURCE_ID,
    schema_name: "demo_adb_ecommerce_mart",
    table_name: "fct_order_lines",
    relation_kind: "TABLE",
  },
  {
    ...common,
    node_id: "table-products",
    node_type: "PHYSICAL_TABLE",
    name: "dim_product / 商品维表",
    description: "商品维度物理表",
    schema_snapshot_id: SNAPSHOT_ID,
    snapshot_content_hash: HASH,
    datasource_id: DATASOURCE_ID,
    schema_name: "demo_adb_ecommerce_mart",
    table_name: "dim_product",
    relation_kind: "TABLE",
  },
];

const edge = (
  edge_id: string,
  edge_type: string,
  family: SemanticEdgeFamily,
  source_node_id: string,
  target_node_id: string,
): SemanticGraphEdge => ({
  edge_id,
  edge_version: 1,
  edge_type,
  family,
  source_node_id,
  target_node_id,
  lifecycle: "ACTIVE",
  attributes:
    edge_type === "RELATES_TO"
      ? { kind: "BUSINESS_RELATION", relationship_name: "业务关联", cardinality: "one-to-many" }
      : { kind: "NONE" },
  evidence_refs: [],
});

const edges: SemanticGraphEdge[] = [
  edge("edge-customer-order", "RELATES_TO", "BUSINESS", "subject-customer", "subject-order"),
  edge("edge-order-line", "RELATES_TO", "BUSINESS", "subject-order", "subject-order-line"),
  edge("edge-line-product", "RELATES_TO", "BUSINESS", "subject-order-line", "subject-product"),
  edge("edge-line-region", "HAS_DIMENSION", "ANALYTICAL", "subject-order-line", "dimension-region"),
  edge(
    "edge-line-calendar",
    "HAS_DIMENSION",
    "ANALYTICAL",
    "subject-order-line",
    "dimension-calendar",
  ),
  edge(
    "edge-line-product-count",
    "HAS_METRIC",
    "ANALYTICAL",
    "subject-order-line",
    "metric-product-count",
  ),
  edge(
    "edge-line-revenue",
    "HAS_METRIC",
    "ANALYTICAL",
    "subject-order-line",
    "metric-gross-revenue",
  ),
  edge(
    "edge-product-count-formula",
    "DEFINED_BY",
    "FORMULA",
    "metric-product-count",
    "formula-product-count",
  ),
  edge(
    "edge-revenue-formula",
    "DEFINED_BY",
    "FORMULA",
    "metric-gross-revenue",
    "formula-gross-revenue",
  ),
  edge(
    "edge-product-count-table",
    "SUPPORTED_BY",
    "PROVENANCE",
    "formula-product-count",
    "table-order-lines",
  ),
  edge(
    "edge-revenue-table",
    "SUPPORTED_BY",
    "PROVENANCE",
    "formula-gross-revenue",
    "table-order-lines",
  ),
  edge("edge-product-table", "SUPPORTED_BY", "PROVENANCE", "subject-product", "table-products"),
];

const identity: SemanticGraphReadIdentity = {
  read_version: "semantic-graph-read@1",
  graph_id: GRAPH_ID,
  published_source_digest: HASH,
  candidate_source_digest: `sha256:${"2".repeat(64)}`,
  consistency_token: `sha256:${"3".repeat(64)}`,
};

function counts(nodeId: string) {
  const by_family = {
    BUSINESS: 0,
    ANALYTICAL: 0,
    FORMULA: 0,
    PHYSICAL: 0,
    JOIN: 0,
    PROVENANCE: 0,
  };
  let incoming = 0;
  let outgoing = 0;
  for (const item of edges) {
    if (item.source_node_id === nodeId) {
      outgoing += 1;
      by_family[item.family] += 1;
    }
    if (item.target_node_id === nodeId) {
      incoming += 1;
      by_family[item.family] += 1;
    }
  }
  return { incoming, outgoing, total: incoming + outgoing, by_family };
}

const readNodes: SemanticGraphReadNode[] = nodes.map((node) => ({
  node,
  status:
    node.node_id === "formula-product-count"
      ? "ADDED"
      : node.node_id === "metric-product-count"
        ? "MODIFIED"
        : "PUBLISHED",
  relation_count: counts(node.node_id),
}));

const readEdges: SemanticGraphReadEdge[] = edges.map((item) => ({
  edge: item,
  status: item.edge_id === "edge-product-count-formula" ? "ADDED" : "PUBLISHED",
}));

const clusters: SemanticGraphCluster[] = [
  {
    cluster_id: "cluster:domain:commerce",
    label: "电商交易域",
    kind: "DOMAIN",
    node_count: 8,
    edge_count: 9,
    candidate_count: 2,
    node_type_counts: {
      BUSINESS_SUBJECT: 3,
      DIMENSION: 2,
      METRIC: 2,
      FORMULA: 1,
      PHYSICAL_TABLE: 0,
      PHYSICAL_COLUMN: 0,
    },
    top_hub_node_ids: ["subject-order-line", "metric-product-count"],
    position: { x: -0.42, y: -0.08 },
  },
  {
    cluster_id: "cluster:domain:product",
    label: "商品域",
    kind: "DOMAIN",
    node_count: 1,
    edge_count: 1,
    candidate_count: 0,
    node_type_counts: {
      BUSINESS_SUBJECT: 1,
      DIMENSION: 0,
      METRIC: 0,
      FORMULA: 0,
      PHYSICAL_TABLE: 0,
      PHYSICAL_COLUMN: 0,
    },
    top_hub_node_ids: ["subject-product"],
    position: { x: 0.5, y: -0.42 },
  },
  {
    cluster_id: "cluster:physical:mart",
    label: "demo_adb_ecommerce_mart",
    kind: "PHYSICAL_SCHEMA",
    node_count: 3,
    edge_count: 2,
    candidate_count: 0,
    node_type_counts: {
      BUSINESS_SUBJECT: 0,
      DIMENSION: 0,
      METRIC: 0,
      FORMULA: 1,
      PHYSICAL_TABLE: 2,
      PHYSICAL_COLUMN: 0,
    },
    top_hub_node_ids: ["table-order-lines"],
    position: { x: 0.28, y: 0.55 },
  },
];

export function semanticStudioPreviewSnapshot(): SemanticStudioSnapshot {
  return {
    schema_version: "semantic-studio-snapshot@1.0.0",
    semantic_domain: "ecommerce",
    available_domains: ["ecommerce", "finance", "customer_success"],
    release: { release_id: RELEASE_ID, release_generation: 12, label: "Release 12" },
    list: {
      identity,
      items: readNodes,
      total: readNodes.length,
      next_cursor: null,
      domains: ["电商交易域", "商品域", "demo_adb_ecommerce_mart"],
    },
    local: {
      identity,
      center_node_id: "metric-product-count",
      nodes: readNodes.filter(({ node }) =>
        [
          "metric-product-count",
          "subject-order-line",
          "formula-product-count",
          "table-order-lines",
          "dimension-calendar",
          "dimension-region",
        ].includes(node.node_id),
      ),
      edges: readEdges.filter(({ edge: item }) =>
        [
          "edge-line-product-count",
          "edge-product-count-formula",
          "edge-product-count-table",
          "edge-line-calendar",
          "edge-line-region",
        ].includes(item.edge_id),
      ),
      truncated: false,
      omitted_node_count: 0,
      omitted_edge_count: 0,
      next_continuation: null,
    },
    full: {
      identity,
      hierarchy_digest: `sha256:${"4".repeat(64)}`,
      clusters,
      nodes: [],
      edges: [],
      glyph_count: clusters.length,
      truncated: false,
      omitted_glyph_count: 0,
    },
    authoring: null,
  };
}
