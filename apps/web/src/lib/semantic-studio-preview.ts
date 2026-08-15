import type {
  SemanticEdgeFamily,
  SemanticGraphCluster,
  SemanticGraphEdge,
  SemanticGraphFullResult,
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
    node_id: "dimension-product",
    node_type: "DIMENSION",
    name: "Product / 商品维度",
    description: "按商品、品类和品牌分析交易",
    data_type: "text",
    sensitivity: "PUBLIC",
    filter_semantics: "HIERARCHICAL",
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
      input: {
        kind: "BINARY",
        operator: "MULTIPLY",
        left: { kind: "SLOT", slot_id: "quantity" },
        right: { kind: "SLOT", slot_id: "unit_price" },
      },
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
  {
    ...common,
    node_id: "table-customers",
    node_type: "PHYSICAL_TABLE",
    name: "dim_customer / 客户维表",
    description: "客户及其地区归属的物理维表",
    schema_snapshot_id: SNAPSHOT_ID,
    snapshot_content_hash: HASH,
    datasource_id: DATASOURCE_ID,
    schema_name: "demo_adb_ecommerce_mart",
    table_name: "dim_customer",
    relation_kind: "TABLE",
  },
  {
    ...common,
    node_id: "table-regions",
    node_type: "PHYSICAL_TABLE",
    name: "dim_region / 地区维表",
    description: "地区层级物理维表",
    schema_snapshot_id: SNAPSHOT_ID,
    snapshot_content_hash: HASH,
    datasource_id: DATASOURCE_ID,
    schema_name: "demo_adb_ecommerce_mart",
    table_name: "dim_region",
    relation_kind: "TABLE",
  },
  {
    ...common,
    node_id: "table-orders",
    node_type: "PHYSICAL_TABLE",
    name: "fct_orders / 订单事实表",
    description: "订单头粒度交易事实表",
    schema_snapshot_id: SNAPSHOT_ID,
    snapshot_content_hash: HASH,
    datasource_id: DATASOURCE_ID,
    schema_name: "demo_adb_ecommerce_mart",
    table_name: "fct_orders",
    relation_kind: "TABLE",
  },
  {
    ...common,
    node_id: "table-dates",
    node_type: "PHYSICAL_TABLE",
    name: "dim_date / 日历维表",
    description: "统一日期口径物理维表",
    schema_snapshot_id: SNAPSHOT_ID,
    snapshot_content_hash: HASH,
    datasource_id: DATASOURCE_ID,
    schema_name: "demo_adb_ecommerce_mart",
    table_name: "dim_date",
    relation_kind: "TABLE",
  },
  ...[
    ["column-customer-id", "dim_customer", "customer_id", 1, "text", "text", false],
    ["column-customer-region-id", "dim_customer", "region_id", 2, "text", "text", false],
    ["column-region-id", "dim_region", "region_id", 1, "text", "text", false],
    ["column-order-id", "fct_orders", "order_id", 1, "text", "text", false],
    ["column-order-customer-id", "fct_orders", "customer_id", 2, "text", "text", false],
    ["column-order-date-key", "fct_orders", "date_key", 3, "date", "date", false],
    ["column-order-status", "fct_orders", "order_status", 4, "text", "text", false],
    ["column-order-line-id", "fct_order_lines", "order_line_id", 1, "text", "text", false],
    ["column-line-order-id", "fct_order_lines", "order_id", 2, "text", "text", false],
    ["column-line-product-id", "fct_order_lines", "product_id", 3, "text", "text", false],
    ["column-line-quantity", "fct_order_lines", "quantity", 4, "integer", "integer", false],
    ["column-line-unit-price", "fct_order_lines", "unit_price", 5, "numeric", "numeric", false],
    ["column-line-paid", "fct_order_lines", "is_paid", 6, "boolean", "boolean", false],
    ["column-line-date-key", "fct_order_lines", "date_key", 7, "date", "date", false],
    ["column-product-id", "dim_product", "product_id", 1, "text", "text", false],
    ["column-date-key", "dim_date", "date_key", 1, "date", "date", false],
  ].map(([node_id, table_name, column_name, ordinal, formatted_type, data_type, nullable]) => ({
    ...common,
    node_id: node_id as string,
    node_type: "PHYSICAL_COLUMN" as const,
    name: `${table_name}.${column_name}`,
    description: `${table_name} 的 ${column_name} 字段`,
    schema_snapshot_id: SNAPSHOT_ID,
    snapshot_content_hash: HASH,
    datasource_id: DATASOURCE_ID,
    schema_name: "demo_adb_ecommerce_mart",
    table_name: table_name as string,
    column_name: column_name as string,
    ordinal: ordinal as number,
    formatted_type: formatted_type as string,
    data_type: data_type as "text" | "integer" | "numeric" | "boolean" | "date",
    nullable: nullable as boolean,
    sensitivity: "PUBLIC" as const,
  })),
  ...[
    ["term-business-subject", "业务主体", "具有稳定身份并参与业务关系的领域对象。", "BUSINESS"],
    ["term-dimension", "维度", "用于分组、筛选和切片指标的分析上下文。", "ANALYTICAL"],
    ["term-grain", "粒度", "一行事实或一次计算所代表的最细业务层级。", "ANALYTICAL"],
    ["term-additivity", "可加性", "指标跨维度聚合时是否可安全求和的性质。", "ANALYTICAL"],
    ["term-cardinality", "基数", "两个对象或字段之间一对一、一对多等数量关系。", "ANALYTICAL"],
    ["term-fanout", "扇出", "Join 后一行被复制为多行并导致指标重复累计的风险。", "ANALYTICAL"],
    ["term-row-preservation", "行保留", "Join 过程中左右两侧业务行是否必须被保留。", "ANALYTICAL"],
    ["term-physical-binding", "物理绑定", "语义对象与权威表或字段之间的显式映射。", "PHYSICAL"],
    [
      "term-analytical-join",
      "分析 Join",
      "具有基数、行保留和证据证明的可执行连接关系。",
      "ANALYTICAL",
    ],
    ["term-candidate", "Candidate", "尚未审核发布、只在候选图中可见的语义修订。", "GOVERNANCE"],
    [
      "term-active-release",
      "Active Release",
      "查询运行时唯一允许读取的已发布语义版本。",
      "GOVERNANCE",
    ],
  ].map(([node_id, name, definition, term_kind]) => ({
    ...common,
    node_id: node_id as string,
    node_type: "GLOSSARY_TERM" as const,
    name: name as string,
    description: definition as string,
    definition: definition as string,
    language: "zh-CN",
    term_kind: term_kind as "BUSINESS" | "ANALYTICAL" | "PHYSICAL" | "GOVERNANCE",
    abbreviation: null,
    tags: ["术语"],
  })),
];

const edge = (
  edge_id: string,
  edge_type: string,
  family: SemanticEdgeFamily,
  source_node_id: string,
  target_node_id: string,
  attributes: SemanticGraphEdge["attributes"] = { kind: "NONE" },
  evidence_refs: readonly string[] = [],
): SemanticGraphEdge => ({
  edge_id,
  edge_version: 1,
  edge_type,
  family,
  source_node_id,
  target_node_id,
  lifecycle: "ACTIVE",
  attributes,
  evidence_refs: [...evidence_refs],
});

const contains = (edgeId: string, tableId: string, columnId: string) =>
  edge(edgeId, "CONTAINS_COLUMN", "PHYSICAL", tableId, columnId, {
    kind: "PHYSICAL_FACT",
    schema_snapshot_id: SNAPSHOT_ID,
    snapshot_content_hash: HASH,
    fact_kind: "CONTAINS_COLUMN",
  });

const foreignKey = (edgeId: string, sourceId: string, targetId: string) =>
  edge(edgeId, "FOREIGN_KEY_TO", "PHYSICAL", sourceId, targetId, {
    kind: "PHYSICAL_FACT",
    schema_snapshot_id: SNAPSHOT_ID,
    snapshot_content_hash: HASH,
    fact_kind: "FOREIGN_KEY",
  });

const joinable = (edgeId: string, sourceId: string, targetId: string, cardinality: "many-to-one") =>
  edge(
    edgeId,
    "JOINABLE_VIA",
    "JOIN",
    sourceId,
    targetId,
    {
      kind: "JOIN_PROOF",
      cardinality,
      left_row_preservation: "required",
      right_row_preservation: "optional",
      proof_kind: "SNAPSHOT_CERTIFIED",
      proof_detail: "schema snapshot + uniqueness profile",
    },
    ["evidence-schema-snapshot"],
  );

const edges: SemanticGraphEdge[] = [
  edge("edge-customer-order", "RELATES_TO", "BUSINESS", "subject-customer", "subject-order", {
    kind: "BUSINESS_RELATION",
    relationship_name: "客户下单",
    cardinality: "one-to-many",
  }),
  edge("edge-order-line", "RELATES_TO", "BUSINESS", "subject-order", "subject-order-line", {
    kind: "BUSINESS_RELATION",
    relationship_name: "订单包含明细",
    cardinality: "one-to-many",
  }),
  edge("edge-line-product", "RELATES_TO", "BUSINESS", "subject-order-line", "subject-product", {
    kind: "BUSINESS_RELATION",
    relationship_name: "明细引用商品",
    cardinality: "many-to-one",
  }),
  edge(
    "edge-customer-region",
    "HAS_DIMENSION",
    "ANALYTICAL",
    "subject-customer",
    "dimension-region",
  ),
  edge("edge-order-calendar", "HAS_DIMENSION", "ANALYTICAL", "subject-order", "dimension-calendar"),
  edge("edge-line-region", "HAS_DIMENSION", "ANALYTICAL", "subject-order-line", "dimension-region"),
  edge(
    "edge-line-calendar",
    "HAS_DIMENSION",
    "ANALYTICAL",
    "subject-order-line",
    "dimension-calendar",
  ),
  edge(
    "edge-line-product-dimension",
    "HAS_DIMENSION",
    "ANALYTICAL",
    "subject-order-line",
    "dimension-product",
  ),
  edge(
    "edge-product-dimension",
    "HAS_DIMENSION",
    "ANALYTICAL",
    "subject-product",
    "dimension-product",
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
    "edge-customer-table",
    "REPRESENTED_BY",
    "ANALYTICAL",
    "subject-customer",
    "table-customers",
    { kind: "BINDING", role: "PRIMARY" },
  ),
  edge("edge-order-table", "REPRESENTED_BY", "ANALYTICAL", "subject-order", "table-orders", {
    kind: "BINDING",
    role: "PRIMARY",
  }),
  edge(
    "edge-order-line-table",
    "REPRESENTED_BY",
    "ANALYTICAL",
    "subject-order-line",
    "table-order-lines",
    { kind: "BINDING", role: "PRIMARY" },
  ),
  edge(
    "edge-product-table-binding",
    "REPRESENTED_BY",
    "ANALYTICAL",
    "subject-product",
    "table-products",
    { kind: "BINDING", role: "PRIMARY" },
  ),
  edge(
    "edge-customer-identifier",
    "IDENTIFIED_BY",
    "ANALYTICAL",
    "subject-customer",
    "column-customer-id",
    { kind: "BINDING", role: "PRIMARY" },
  ),
  edge("edge-order-identifier", "IDENTIFIED_BY", "ANALYTICAL", "subject-order", "column-order-id", {
    kind: "BINDING",
    role: "PRIMARY",
  }),
  edge(
    "edge-order-line-identifier",
    "IDENTIFIED_BY",
    "ANALYTICAL",
    "subject-order-line",
    "column-order-line-id",
    { kind: "BINDING", role: "PRIMARY" },
  ),
  edge(
    "edge-product-identifier",
    "IDENTIFIED_BY",
    "ANALYTICAL",
    "subject-product",
    "column-product-id",
    { kind: "BINDING", role: "PRIMARY" },
  ),
  edge("edge-region-binding", "BOUND_TO", "ANALYTICAL", "dimension-region", "column-region-id", {
    kind: "BINDING",
    role: "PRIMARY",
  }),
  edge("edge-calendar-binding", "BOUND_TO", "ANALYTICAL", "dimension-calendar", "column-date-key", {
    kind: "BINDING",
    role: "PRIMARY",
  }),
  edge(
    "edge-product-dimension-binding",
    "BOUND_TO",
    "ANALYTICAL",
    "dimension-product",
    "column-product-id",
    { kind: "BINDING", role: "PRIMARY" },
  ),
  edge("edge-region-grain", "AT_GRAIN", "ANALYTICAL", "dimension-region", "subject-customer", {
    kind: "GRAIN_BINDING",
    grain: { grain_id: "grain-customer", granularity: "atomic" },
    time_domain: null,
  }),
  edge("edge-calendar-grain", "AT_GRAIN", "ANALYTICAL", "dimension-calendar", "subject-order", {
    kind: "GRAIN_BINDING",
    grain: { grain_id: "grain-order", granularity: "atomic" },
    time_domain: null,
  }),
  edge(
    "edge-product-dimension-grain",
    "AT_GRAIN",
    "ANALYTICAL",
    "dimension-product",
    "subject-product",
    {
      kind: "GRAIN_BINDING",
      grain: { grain_id: "grain-product", granularity: "atomic" },
      time_domain: null,
    },
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
    "edge-product-count-grain",
    "AT_GRAIN",
    "ANALYTICAL",
    "formula-product-count",
    "subject-order-line",
    {
      kind: "GRAIN_BINDING",
      grain: { grain_id: "grain-order-line", granularity: "atomic" },
      time_domain: null,
    },
  ),
  edge(
    "edge-revenue-grain",
    "AT_GRAIN",
    "ANALYTICAL",
    "formula-gross-revenue",
    "subject-order-line",
    {
      kind: "GRAIN_BINDING",
      grain: { grain_id: "grain-order-line", granularity: "atomic" },
      time_domain: null,
    },
  ),
  edge(
    "edge-count-product-dimension",
    "USES_DIMENSION",
    "FORMULA",
    "formula-product-count",
    "dimension-product",
    { kind: "DIMENSION_USE", role: "GROUP_BY" },
  ),
  edge(
    "edge-count-calendar-dimension",
    "USES_DIMENSION",
    "FORMULA",
    "formula-product-count",
    "dimension-calendar",
    { kind: "DIMENSION_USE", role: "FILTER" },
  ),
  edge(
    "edge-revenue-product-dimension",
    "USES_DIMENSION",
    "FORMULA",
    "formula-gross-revenue",
    "dimension-product",
    { kind: "DIMENSION_USE", role: "GROUP_BY" },
  ),
  edge(
    "edge-revenue-calendar-dimension",
    "USES_DIMENSION",
    "FORMULA",
    "formula-gross-revenue",
    "dimension-calendar",
    { kind: "DIMENSION_USE", role: "TIME_CONTEXT" },
  ),
  edge(
    "edge-count-product-column",
    "REFERENCES",
    "FORMULA",
    "formula-product-count",
    "column-line-product-id",
    { kind: "SLOT_BINDING", slot_id: "product", role: "MEASURE" },
  ),
  edge(
    "edge-count-paid-column",
    "REFERENCES",
    "FORMULA",
    "formula-product-count",
    "column-line-paid",
    { kind: "SLOT_BINDING", slot_id: "paid", role: "FILTER" },
  ),
  edge(
    "edge-revenue-quantity-column",
    "REFERENCES",
    "FORMULA",
    "formula-gross-revenue",
    "column-line-quantity",
    { kind: "SLOT_BINDING", slot_id: "quantity", role: "MEASURE" },
  ),
  edge(
    "edge-revenue-price-column",
    "REFERENCES",
    "FORMULA",
    "formula-gross-revenue",
    "column-line-unit-price",
    { kind: "SLOT_BINDING", slot_id: "unit_price", role: "MEASURE" },
  ),
  edge(
    "edge-product-count-table",
    "SUPPORTED_BY",
    "PROVENANCE",
    "formula-product-count",
    "table-order-lines",
    { kind: "PROVENANCE", derivation_kind: "SUPPORTED", note: "公式字段全部来自订单明细事实表" },
  ),
  edge(
    "edge-revenue-table",
    "SUPPORTED_BY",
    "PROVENANCE",
    "formula-gross-revenue",
    "table-order-lines",
    { kind: "PROVENANCE", derivation_kind: "SUPPORTED", note: "销售额在订单明细粒度计算" },
  ),
  edge("edge-product-table", "SUPPORTED_BY", "PROVENANCE", "subject-product", "table-products", {
    kind: "PROVENANCE",
    derivation_kind: "SUPPORTED",
    note: "商品主体由商品维表承载",
  }),
  contains("edge-table-customer-id", "table-customers", "column-customer-id"),
  contains("edge-table-customer-region", "table-customers", "column-customer-region-id"),
  contains("edge-table-region-id", "table-regions", "column-region-id"),
  contains("edge-table-order-id", "table-orders", "column-order-id"),
  contains("edge-table-order-customer", "table-orders", "column-order-customer-id"),
  contains("edge-table-order-date", "table-orders", "column-order-date-key"),
  contains("edge-table-order-status", "table-orders", "column-order-status"),
  contains("edge-table-line-id", "table-order-lines", "column-order-line-id"),
  contains("edge-table-line-order", "table-order-lines", "column-line-order-id"),
  contains("edge-table-line-product", "table-order-lines", "column-line-product-id"),
  contains("edge-table-line-quantity", "table-order-lines", "column-line-quantity"),
  contains("edge-table-line-price", "table-order-lines", "column-line-unit-price"),
  contains("edge-table-line-paid", "table-order-lines", "column-line-paid"),
  contains("edge-table-line-date", "table-order-lines", "column-line-date-key"),
  contains("edge-table-product-id", "table-products", "column-product-id"),
  contains("edge-table-date-key", "table-dates", "column-date-key"),
  foreignKey("edge-fk-customer-region", "column-customer-region-id", "column-region-id"),
  foreignKey("edge-fk-order-customer", "column-order-customer-id", "column-customer-id"),
  foreignKey("edge-fk-order-date", "column-order-date-key", "column-date-key"),
  foreignKey("edge-fk-line-order", "column-line-order-id", "column-order-id"),
  foreignKey("edge-fk-line-product", "column-line-product-id", "column-product-id"),
  foreignKey("edge-fk-line-date", "column-line-date-key", "column-date-key"),
  joinable(
    "edge-join-customer-region",
    "column-customer-region-id",
    "column-region-id",
    "many-to-one",
  ),
  joinable(
    "edge-join-order-customer",
    "column-order-customer-id",
    "column-customer-id",
    "many-to-one",
  ),
  joinable("edge-join-order-date", "column-order-date-key", "column-date-key", "many-to-one"),
  joinable("edge-join-line-order", "column-line-order-id", "column-order-id", "many-to-one"),
  joinable("edge-join-line-product", "column-line-product-id", "column-product-id", "many-to-one"),
  joinable("edge-join-line-date", "column-line-date-key", "column-date-key", "many-to-one"),
  edge(
    "edge-term-business-subject",
    "DENOTES",
    "TERMINOLOGY",
    "term-business-subject",
    "subject-order-line",
    { kind: "TERM_LINK", lexical_role: "PREFERRED" },
  ),
  edge("edge-term-dimension", "DENOTES", "TERMINOLOGY", "term-dimension", "dimension-product", {
    kind: "TERM_LINK",
    lexical_role: "PREFERRED",
  }),
  edge("edge-term-grain", "DENOTES", "TERMINOLOGY", "term-grain", "formula-product-count", {
    kind: "TERM_LINK",
    lexical_role: "RELATED",
  }),
  edge(
    "edge-term-additivity",
    "DENOTES",
    "TERMINOLOGY",
    "term-additivity",
    "metric-gross-revenue",
    { kind: "TERM_LINK", lexical_role: "RELATED" },
  ),
  edge("edge-term-cardinality", "DENOTES", "TERMINOLOGY", "term-cardinality", "subject-order", {
    kind: "TERM_LINK",
    lexical_role: "RELATED",
  }),
  edge("edge-term-fanout", "DENOTES", "TERMINOLOGY", "term-fanout", "metric-product-count", {
    kind: "TERM_LINK",
    lexical_role: "RELATED",
  }),
  edge(
    "edge-term-row-preservation",
    "DENOTES",
    "TERMINOLOGY",
    "term-row-preservation",
    "table-order-lines",
    { kind: "TERM_LINK", lexical_role: "RELATED" },
  ),
  edge(
    "edge-term-physical-binding",
    "DENOTES",
    "TERMINOLOGY",
    "term-physical-binding",
    "column-product-id",
    { kind: "TERM_LINK", lexical_role: "RELATED" },
  ),
  edge(
    "edge-term-analytical-join",
    "DENOTES",
    "TERMINOLOGY",
    "term-analytical-join",
    "column-line-product-id",
    { kind: "TERM_LINK", lexical_role: "RELATED" },
  ),
  edge("edge-term-candidate", "DENOTES", "TERMINOLOGY", "term-candidate", "formula-product-count", {
    kind: "TERM_LINK",
    lexical_role: "RELATED",
  }),
  edge(
    "edge-term-active-release",
    "DENOTES",
    "TERMINOLOGY",
    "term-active-release",
    "metric-gross-revenue",
    { kind: "TERM_LINK", lexical_role: "RELATED" },
  ),
  edge(
    "edge-term-join-fanout",
    "RELATED_TERM",
    "TERMINOLOGY",
    "term-analytical-join",
    "term-fanout",
  ),
  edge(
    "edge-term-join-cardinality",
    "RELATED_TERM",
    "TERMINOLOGY",
    "term-analytical-join",
    "term-cardinality",
  ),
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
    TERMINOLOGY: 0,
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
    node_count: 9,
    edge_count: 27,
    candidate_count: 2,
    node_type_counts: {
      BUSINESS_SUBJECT: 3,
      DIMENSION: 2,
      METRIC: 2,
      FORMULA: 2,
      PHYSICAL_TABLE: 0,
      PHYSICAL_COLUMN: 0,
      GLOSSARY_TERM: 0,
    },
    top_hub_node_ids: ["subject-order-line", "metric-product-count"],
    position: { x: -0.42, y: -0.08 },
  },
  {
    cluster_id: "cluster:domain:product",
    label: "商品域",
    kind: "DOMAIN",
    node_count: 2,
    edge_count: 6,
    candidate_count: 0,
    node_type_counts: {
      BUSINESS_SUBJECT: 1,
      DIMENSION: 1,
      METRIC: 0,
      FORMULA: 0,
      PHYSICAL_TABLE: 0,
      PHYSICAL_COLUMN: 0,
      GLOSSARY_TERM: 0,
    },
    top_hub_node_ids: ["subject-product"],
    position: { x: 0.5, y: -0.42 },
  },
  {
    cluster_id: "cluster:physical:mart",
    label: "demo_adb_ecommerce_mart",
    kind: "PHYSICAL_SCHEMA",
    node_count: 22,
    edge_count: 31,
    candidate_count: 0,
    node_type_counts: {
      BUSINESS_SUBJECT: 0,
      DIMENSION: 0,
      METRIC: 0,
      FORMULA: 0,
      PHYSICAL_TABLE: 6,
      PHYSICAL_COLUMN: 16,
      GLOSSARY_TERM: 0,
    },
    top_hub_node_ids: ["table-order-lines"],
    position: { x: 0.28, y: 0.55 },
  },
  {
    cluster_id: "cluster:terminology:zh-cn",
    label: "中文业务与分析术语",
    kind: "UNASSIGNED",
    node_count: 11,
    edge_count: 13,
    candidate_count: 0,
    node_type_counts: {
      BUSINESS_SUBJECT: 0,
      DIMENSION: 0,
      METRIC: 0,
      FORMULA: 0,
      PHYSICAL_TABLE: 0,
      PHYSICAL_COLUMN: 0,
      GLOSSARY_TERM: 11,
    },
    top_hub_node_ids: ["term-analytical-join", "term-fanout"],
    position: { x: -0.45, y: 0.58 },
  },
];

function previewClusterNodeIds(clusterId: string): ReadonlySet<string> {
  switch (clusterId) {
    case "cluster:domain:commerce":
      return new Set(
        nodes
          .filter(
            (node) =>
              ["subject-customer", "subject-order", "subject-order-line"].includes(node.node_id) ||
              ["dimension-region", "dimension-calendar"].includes(node.node_id) ||
              node.node_type === "METRIC" ||
              node.node_type === "FORMULA",
          )
          .map((node) => node.node_id),
      );
    case "cluster:domain:product":
      return new Set(["subject-product", "dimension-product"]);
    case "cluster:physical:mart":
      return new Set(
        nodes
          .filter(
            (node) => node.node_type === "PHYSICAL_TABLE" || node.node_type === "PHYSICAL_COLUMN",
          )
          .map((node) => node.node_id),
      );
    case "cluster:terminology:zh-cn":
      return new Set(
        nodes.filter((node) => node.node_type === "GLOSSARY_TERM").map((node) => node.node_id),
      );
    default:
      return new Set();
  }
}

export function semanticStudioPreviewExpandedFullGraph(clusterId: string): SemanticGraphFullResult {
  const memberIds = previewClusterNodeIds(clusterId);
  const expandedNodes = readNodes.filter(({ node }) => memberIds.has(node.node_id));
  const expandedEdges = readEdges.filter(
    ({ edge: item }) => memberIds.has(item.source_node_id) && memberIds.has(item.target_node_id),
  );
  const remainingClusters = clusters.filter((cluster) => cluster.cluster_id !== clusterId);
  return {
    identity,
    hierarchy_digest: `sha256:${"4".repeat(64)}`,
    clusters: remainingClusters,
    nodes: expandedNodes,
    edges: expandedEdges,
    glyph_count: remainingClusters.length + expandedNodes.length,
    truncated: false,
    omitted_glyph_count: 0,
  };
}

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
          "dimension-product",
          "column-order-line-id",
          "column-line-product-id",
          "column-line-paid",
          "subject-product",
          "table-products",
          "column-product-id",
          "term-fanout",
          "term-grain",
          "term-candidate",
        ].includes(node.node_id),
      ),
      edges: readEdges.filter(({ edge: item }) =>
        [
          "edge-line-product-count",
          "edge-product-count-formula",
          "edge-product-count-table",
          "edge-line-calendar",
          "edge-line-product-dimension",
          "edge-order-line-table",
          "edge-order-line-identifier",
          "edge-product-count-grain",
          "edge-count-product-dimension",
          "edge-count-calendar-dimension",
          "edge-count-product-column",
          "edge-count-paid-column",
          "edge-table-line-id",
          "edge-table-line-product",
          "edge-table-line-paid",
          "edge-line-product",
          "edge-product-table-binding",
          "edge-product-identifier",
          "edge-table-product-id",
          "edge-fk-line-product",
          "edge-join-line-product",
          "edge-term-fanout",
          "edge-term-grain",
          "edge-term-candidate",
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
