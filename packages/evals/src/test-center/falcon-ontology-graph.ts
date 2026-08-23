import {
  BUILTIN_SEMANTIC_EDGE_TYPES,
  BUILTIN_SEMANTIC_NODE_TYPES,
  type PublicBenchmarkCase,
  SEMANTIC_FORMULA_AST_VERSION,
  SEMANTIC_GRAPH_SOURCE_VERSION,
  type SemanticEdgeFamily,
  type SemanticGraphEdge,
  type SemanticGraphNode,
  type SemanticGraphSource,
  semanticGraphSourceSchema,
} from "@data-agent/contracts";

export const FALCON_DB24_ONTOLOGY_IDS = Object.freeze({
  graph: "00000000-0000-4000-8000-00000000fa24",
  snapshot: "00000000-0000-4000-8000-00000000fa25",
  datasource: "00000000-0000-4000-8000-00000000fa01",
});

const SCHEMA_NAME = "falcon_db_24";
const SCHEMA_EVIDENCE_ID = "falcon-db24-schema-snapshot";
const OWNER_REF = "falcon-domain-team";

type FalconCaseSchema = PublicBenchmarkCase["schema"];

export interface FalconDb24JoinEvidence {
  readonly content_hash: `sha256:${string}`;
  readonly description: string;
  readonly cardinality: "one-to-one" | "one-to-many" | "many-to-one" | "many-to-many";
}

export const FALCON_DB24_JOIN_SPECS = Object.freeze([
  {
    join_id: "orders-customer",
    left_table: "blinkit_orders",
    left_column: "customer_id",
    right_table: "blinkit_customers",
    right_column: "customer_id",
  },
  {
    join_id: "order-items-order",
    left_table: "blinkit_order_items",
    left_column: "order_id",
    right_table: "blinkit_orders",
    right_column: "order_id",
  },
  {
    join_id: "order-items-product",
    left_table: "blinkit_order_items",
    left_column: "product_id",
    right_table: "blinkit_products",
    right_column: "product_id",
  },
  {
    join_id: "feedback-order",
    left_table: "blinkit_customer_feedback",
    left_column: "order_id",
    right_table: "blinkit_orders",
    right_column: "order_id",
  },
  {
    join_id: "feedback-customer",
    left_table: "blinkit_customer_feedback",
    left_column: "customer_id",
    right_table: "blinkit_customers",
    right_column: "customer_id",
  },
  {
    join_id: "delivery-order",
    left_table: "blinkit_delivery_performance",
    left_column: "order_id",
    right_table: "blinkit_orders",
    right_column: "order_id",
  },
  {
    join_id: "inventory-product",
    left_table: "blinkit_inventory",
    left_column: "product_id",
    right_table: "blinkit_products",
    right_column: "product_id",
  },
  {
    join_id: "inventory-new-product",
    left_table: "blinkit_inventoryNew",
    left_column: "product_id",
    right_table: "blinkit_products",
    right_column: "product_id",
  },
] as const);

interface SubjectDefinition {
  readonly table: string;
  readonly subject_id: string;
  readonly name: string;
  readonly description: string;
  readonly identifiers: readonly string[];
}

const SUBJECTS: readonly SubjectDefinition[] = [
  {
    table: "blinkit_customers",
    subject_id: "subject-customer",
    name: "客户",
    description: "以 customer_id 稳定标识的 Blinkit 客户。",
    identifiers: ["customer_id"],
  },
  {
    table: "blinkit_orders",
    subject_id: "subject-order",
    name: "订单",
    description: "客户提交并由配送伙伴履约的交易订单。",
    identifiers: ["order_id"],
  },
  {
    table: "blinkit_order_items",
    subject_id: "subject-order-item",
    name: "订单明细",
    description: "订单与商品之间的明细事实，粒度为订单和商品。",
    identifiers: ["order_id", "product_id"],
  },
  {
    table: "blinkit_products",
    subject_id: "subject-product",
    name: "商品",
    description: "可售商品及其品牌、类目、定价和库存阈值。",
    identifiers: ["product_id"],
  },
  {
    table: "blinkit_customer_feedback",
    subject_id: "subject-customer-feedback",
    name: "客户反馈",
    description: "客户针对订单提交的评分、反馈分类和情感记录。",
    identifiers: ["feedback_id"],
  },
  {
    table: "blinkit_delivery_performance",
    subject_id: "subject-delivery-performance",
    name: "配送履约",
    description: "订单配送伙伴的承诺时间、实际时间和履约状态。",
    identifiers: ["order_id", "delivery_partner_id"],
  },
  {
    table: "blinkit_inventory",
    subject_id: "subject-inventory-snapshot",
    name: "库存原始快照",
    description: "blinkit_inventory 原始库存快照，不与 New 快照自动合并。",
    identifiers: ["product_id", "date"],
  },
  {
    table: "blinkit_inventoryNew",
    subject_id: "subject-inventory-new-snapshot",
    name: "库存 New 快照",
    description: "独立的 blinkit_inventoryNew 原始快照，不推断覆盖旧快照。",
    identifiers: ["product_id", "date"],
  },
  {
    table: "blinkit_marketing_performance",
    subject_id: "subject-marketing-campaign",
    name: "营销活动",
    description: "按活动、渠道和日期记录的营销触达与收入表现。",
    identifiers: ["campaign_id"],
  },
];

interface DimensionDefinition {
  readonly dimension_id: string;
  readonly subject_id: string;
  readonly table: string;
  readonly column: string;
  readonly name: string;
  readonly filter_semantics: "EXACT" | "RANGE" | "HIERARCHICAL" | "TEMPORAL";
}

const DIMENSIONS: readonly DimensionDefinition[] = [
  [
    "dimension-customer-segment",
    "subject-customer",
    "blinkit_customers",
    "customer_segment",
    "客户分群",
    "EXACT",
  ],
  ["dimension-customer-area", "subject-customer", "blinkit_customers", "area", "客户区域", "EXACT"],
  [
    "dimension-customer-registration-date",
    "subject-customer",
    "blinkit_customers",
    "registration_date",
    "客户注册日期",
    "TEMPORAL",
  ],
  ["dimension-order-date", "subject-order", "blinkit_orders", "order_date", "订单日期", "TEMPORAL"],
  [
    "dimension-order-delivery-status",
    "subject-order",
    "blinkit_orders",
    "delivery_status",
    "订单配送状态",
    "EXACT",
  ],
  [
    "dimension-payment-method",
    "subject-order",
    "blinkit_orders",
    "payment_method",
    "支付方式",
    "EXACT",
  ],
  [
    "dimension-order-item-product",
    "subject-order-item",
    "blinkit_order_items",
    "product_id",
    "明细商品",
    "EXACT",
  ],
  [
    "dimension-product-category",
    "subject-product",
    "blinkit_products",
    "category",
    "商品类目",
    "HIERARCHICAL",
  ],
  ["dimension-product-brand", "subject-product", "blinkit_products", "brand", "商品品牌", "EXACT"],
  [
    "dimension-feedback-category",
    "subject-customer-feedback",
    "blinkit_customer_feedback",
    "feedback_category",
    "反馈分类",
    "EXACT",
  ],
  [
    "dimension-feedback-sentiment",
    "subject-customer-feedback",
    "blinkit_customer_feedback",
    "sentiment",
    "反馈情感",
    "EXACT",
  ],
  [
    "dimension-delivery-status",
    "subject-delivery-performance",
    "blinkit_delivery_performance",
    "delivery_status",
    "履约状态",
    "EXACT",
  ],
  [
    "dimension-delivery-partner",
    "subject-delivery-performance",
    "blinkit_delivery_performance",
    "delivery_partner_id",
    "配送伙伴",
    "EXACT",
  ],
  [
    "dimension-inventory-date",
    "subject-inventory-snapshot",
    "blinkit_inventory",
    "date",
    "库存快照日期",
    "TEMPORAL",
  ],
  [
    "dimension-inventory-new-date",
    "subject-inventory-new-snapshot",
    "blinkit_inventoryNew",
    "date",
    "New 库存快照日期",
    "TEMPORAL",
  ],
  [
    "dimension-marketing-channel",
    "subject-marketing-campaign",
    "blinkit_marketing_performance",
    "channel",
    "营销渠道",
    "EXACT",
  ],
  [
    "dimension-target-audience",
    "subject-marketing-campaign",
    "blinkit_marketing_performance",
    "target_audience",
    "目标受众",
    "EXACT",
  ],
].map(([dimension_id, subject_id, table, column, name, filter_semantics]) => ({
  dimension_id,
  subject_id,
  table,
  column,
  name,
  filter_semantics,
})) as readonly DimensionDefinition[];

type MetricAggregation = "SUM" | "AVG" | "COUNT_DISTINCT";

interface MetricDefinition {
  readonly metric_id: string;
  readonly subject_id: string;
  readonly table: string;
  readonly column: string;
  readonly dimension_id: string;
  readonly name: string;
  readonly aggregation: MetricAggregation;
  readonly unit: "count" | "currency" | "duration" | "percentage" | "other";
  readonly additivity: "additive" | "semi-additive" | "non-additive";
  readonly fanout_policy: "preaggregate" | "reject";
}

const METRICS: readonly MetricDefinition[] = [
  [
    "metric-customer-count",
    "subject-customer",
    "blinkit_customers",
    "customer_id",
    "dimension-customer-segment",
    "客户数",
    "COUNT_DISTINCT",
    "count",
    "non-additive",
    "reject",
  ],
  [
    "metric-order-count",
    "subject-order",
    "blinkit_orders",
    "order_id",
    "dimension-order-date",
    "订单数",
    "COUNT_DISTINCT",
    "count",
    "non-additive",
    "reject",
  ],
  [
    "metric-order-revenue",
    "subject-order",
    "blinkit_orders",
    "order_total",
    "dimension-order-date",
    "订单收入",
    "SUM",
    "currency",
    "additive",
    "preaggregate",
  ],
  [
    "metric-average-order-value",
    "subject-order",
    "blinkit_orders",
    "order_total",
    "dimension-payment-method",
    "平均客单价",
    "AVG",
    "currency",
    "non-additive",
    "reject",
  ],
  [
    "metric-sales-quantity",
    "subject-order-item",
    "blinkit_order_items",
    "quantity",
    "dimension-order-item-product",
    "销售数量",
    "SUM",
    "count",
    "additive",
    "preaggregate",
  ],
  [
    "metric-average-unit-price",
    "subject-order-item",
    "blinkit_order_items",
    "unit_price",
    "dimension-order-item-product",
    "平均成交单价",
    "AVG",
    "currency",
    "non-additive",
    "reject",
  ],
  [
    "metric-average-product-price",
    "subject-product",
    "blinkit_products",
    "price",
    "dimension-product-category",
    "平均商品价格",
    "AVG",
    "currency",
    "non-additive",
    "reject",
  ],
  [
    "metric-average-margin-percentage",
    "subject-product",
    "blinkit_products",
    "margin_percentage",
    "dimension-product-brand",
    "平均利润率",
    "AVG",
    "percentage",
    "non-additive",
    "reject",
  ],
  [
    "metric-average-rating",
    "subject-customer-feedback",
    "blinkit_customer_feedback",
    "rating",
    "dimension-feedback-category",
    "平均评分",
    "AVG",
    "other",
    "non-additive",
    "reject",
  ],
  [
    "metric-average-delivery-time",
    "subject-delivery-performance",
    "blinkit_delivery_performance",
    "delivery_time_minutes",
    "dimension-delivery-partner",
    "平均配送时长",
    "AVG",
    "duration",
    "non-additive",
    "reject",
  ],
  [
    "metric-average-delivery-distance",
    "subject-delivery-performance",
    "blinkit_delivery_performance",
    "distance_km",
    "dimension-delivery-partner",
    "平均配送距离",
    "AVG",
    "other",
    "non-additive",
    "reject",
  ],
  [
    "metric-stock-received",
    "subject-inventory-snapshot",
    "blinkit_inventory",
    "stock_received",
    "dimension-inventory-date",
    "入库量",
    "SUM",
    "count",
    "semi-additive",
    "preaggregate",
  ],
  [
    "metric-damaged-stock",
    "subject-inventory-snapshot",
    "blinkit_inventory",
    "damaged_stock",
    "dimension-inventory-date",
    "损坏库存量",
    "SUM",
    "count",
    "semi-additive",
    "preaggregate",
  ],
  [
    "metric-new-stock-received",
    "subject-inventory-new-snapshot",
    "blinkit_inventoryNew",
    "stock_received",
    "dimension-inventory-new-date",
    "New 入库量",
    "SUM",
    "count",
    "semi-additive",
    "preaggregate",
  ],
  [
    "metric-new-damaged-stock",
    "subject-inventory-new-snapshot",
    "blinkit_inventoryNew",
    "damaged_stock",
    "dimension-inventory-new-date",
    "New 损坏库存量",
    "SUM",
    "count",
    "semi-additive",
    "preaggregate",
  ],
  [
    "metric-marketing-impressions",
    "subject-marketing-campaign",
    "blinkit_marketing_performance",
    "impressions",
    "dimension-marketing-channel",
    "营销曝光量",
    "SUM",
    "count",
    "additive",
    "preaggregate",
  ],
  [
    "metric-marketing-clicks",
    "subject-marketing-campaign",
    "blinkit_marketing_performance",
    "clicks",
    "dimension-marketing-channel",
    "营销点击量",
    "SUM",
    "count",
    "additive",
    "preaggregate",
  ],
  [
    "metric-marketing-conversions",
    "subject-marketing-campaign",
    "blinkit_marketing_performance",
    "conversions",
    "dimension-marketing-channel",
    "营销转化量",
    "SUM",
    "count",
    "additive",
    "preaggregate",
  ],
  [
    "metric-marketing-spend",
    "subject-marketing-campaign",
    "blinkit_marketing_performance",
    "spend",
    "dimension-marketing-channel",
    "营销投入",
    "SUM",
    "currency",
    "additive",
    "preaggregate",
  ],
  [
    "metric-marketing-revenue",
    "subject-marketing-campaign",
    "blinkit_marketing_performance",
    "revenue_generated",
    "dimension-marketing-channel",
    "营销收入",
    "SUM",
    "currency",
    "additive",
    "preaggregate",
  ],
  [
    "metric-average-roas",
    "subject-marketing-campaign",
    "blinkit_marketing_performance",
    "roas",
    "dimension-marketing-channel",
    "平均广告回报率",
    "AVG",
    "other",
    "non-additive",
    "reject",
  ],
].map(
  ([
    metric_id,
    subject_id,
    table,
    column,
    dimension_id,
    name,
    aggregation,
    unit,
    additivity,
    fanout_policy,
  ]) => ({
    metric_id,
    subject_id,
    table,
    column,
    dimension_id,
    name,
    aggregation,
    unit,
    additivity,
    fanout_policy,
  }),
) as readonly MetricDefinition[];

const BUSINESS_RELATIONS = [
  ["subject-order", "subject-customer", "由客户下单", "many-to-one"],
  ["subject-order-item", "subject-order", "属于订单", "many-to-one"],
  ["subject-order-item", "subject-product", "引用商品", "many-to-one"],
  ["subject-customer-feedback", "subject-order", "评价订单", "many-to-one"],
  ["subject-customer-feedback", "subject-customer", "由客户反馈", "many-to-one"],
  ["subject-delivery-performance", "subject-order", "履约订单", "one-to-one"],
  ["subject-inventory-snapshot", "subject-product", "记录商品库存", "many-to-one"],
  ["subject-inventory-new-snapshot", "subject-product", "记录商品 New 库存", "many-to-one"],
  ["subject-marketing-campaign", "subject-customer", "面向客户群体", "many-to-many"],
] as const;

const GLOSSARY = [
  [
    "term-customer-order-total",
    "客户订单总金额",
    "先按 customer_id 对 order_total 求和得到客户级总额。",
    "metric-order-revenue",
  ],
  [
    "term-segment-average-customer-total",
    "分群平均客户订单金额",
    "先计算每个客户的订单总金额，再按 customer_segment 对客户级总额求平均；不能直接平均订单行。",
    "dimension-customer-segment",
  ],
  [
    "term-on-time-delivery",
    "准时履约",
    "实际完成时间不晚于承诺时间的订单履约。",
    "subject-delivery-performance",
  ],
  [
    "term-damaged-stock-rate",
    "库存损坏率",
    "同一快照口径下 damaged_stock 与 stock_received 的比率；两个库存源不得自动合并。",
    "metric-damaged-stock",
  ],
  [
    "term-raw-inventory",
    "原始库存快照",
    "blinkit_inventory 的独立原始快照。",
    "subject-inventory-snapshot",
  ],
  [
    "term-new-inventory",
    "New 库存快照",
    "blinkit_inventoryNew 的独立原始快照，不表示自动覆盖旧快照。",
    "subject-inventory-new-snapshot",
  ],
  [
    "term-average-order-value",
    "客单价",
    "订单行 order_total 的平均值；与客户级累计消费不同。",
    "metric-average-order-value",
  ],
  ["term-order-revenue", "订单收入", "按订单事实对 order_total 求和。", "metric-order-revenue"],
  [
    "term-delivery-partner",
    "配送伙伴",
    "通过 delivery_partner_id 标识的配送执行主体。",
    "dimension-delivery-partner",
  ],
  [
    "term-roas",
    "广告回报率",
    "营销收入与营销投入之间的回报率口径；使用源字段 roas 时保留其上游定义。",
    "metric-average-roas",
  ],
] as const;

function slug(value: string): string {
  return value
    .replaceAll("_", "-")
    .replaceAll(/[^A-Za-z0-9-]/gu, "-")
    .toLowerCase();
}

function tableNodeId(table: string): string {
  return `table-${slug(table)}`;
}

function columnNodeId(table: string, column: string): string {
  return `column-${slug(table)}-${slug(column)}`;
}

function graphDataType(
  dataType: string,
): "boolean" | "date" | "integer" | "numeric" | "text" | "timestamp" | "timestamptz" | "uuid" {
  if (dataType === "bigint" || dataType === "integer" || dataType === "smallint") return "integer";
  if (dataType === "double precision" || dataType === "numeric" || dataType === "real")
    return "numeric";
  if (dataType === "boolean") return "boolean";
  if (dataType === "date") return "date";
  if (dataType.includes("timestamp with time zone")) return "timestamptz";
  if (dataType.includes("timestamp")) return "timestamp";
  if (dataType === "uuid") return "uuid";
  return "text";
}

function commonNode(evidenceRefs: readonly string[] = [SCHEMA_EVIDENCE_ID]) {
  return {
    node_version: 1,
    aliases: [] as string[],
    owner_ref: OWNER_REF,
    lifecycle: "ACTIVE" as const,
    evidence_refs: [...evidenceRefs],
    tags: ["falcon", "db24"],
  };
}

export interface BuildFalconDb24OntologyGraphInput {
  readonly schema: FalconCaseSchema;
  readonly source_digest: `sha256:${string}`;
  readonly scope: SemanticGraphSource["metadata"]["scope"];
  readonly created_at: string;
  readonly base_release_id?: string | null;
  readonly join_evidence: Readonly<Record<string, FalconDb24JoinEvidence>>;
}

export function buildFalconDb24OntologyGraph(
  input: BuildFalconDb24OntologyGraphInput,
): SemanticGraphSource {
  const schema = [...input.schema].sort((left, right) => left.name.localeCompare(right.name));
  const schemaTables = new Map(schema.map((table) => [table.name, table]));
  if (
    schema.length !== 9 ||
    schema.reduce((total, table) => total + table.columns.length, 0) !== 70
  ) {
    throw new Error("FALCON_DB24_SCHEMA_SHAPE_INVALID");
  }
  for (const subject of SUBJECTS) {
    const table = schemaTables.get(subject.table);
    if (
      !table ||
      subject.identifiers.some(
        (identifier) => !table.columns.some((column) => column.name === identifier),
      )
    ) {
      throw new Error(`FALCON_DB24_SUBJECT_SCHEMA_MISSING:${subject.subject_id}`);
    }
  }
  for (const join of FALCON_DB24_JOIN_SPECS) {
    if (!input.join_evidence[join.join_id]) {
      throw new Error(`FALCON_DB24_JOIN_EVIDENCE_MISSING:${join.join_id}`);
    }
  }

  const nodes: SemanticGraphNode[] = [];
  const edges: SemanticGraphEdge[] = [];
  const evidence: SemanticGraphSource["evidence"] = [
    {
      evidence_id: SCHEMA_EVIDENCE_ID,
      kind: "SCHEMA_SNAPSHOT",
      content_hash: input.source_digest,
      description: "Falcon fixed commit 8ff29caa, db24 PostgreSQL schema and seed receipt.",
    },
    ...FALCON_DB24_JOIN_SPECS.map((join) => ({
      evidence_id: `falcon-db24-join-${join.join_id}`,
      kind: "QUERY_SAMPLE" as const,
      content_hash: input.join_evidence[join.join_id]?.content_hash ?? input.source_digest,
      description: input.join_evidence[join.join_id]?.description,
    })),
  ];
  let edgeOrdinal = 0;
  const addEdge = (
    edgeType: string,
    family: SemanticEdgeFamily,
    sourceNodeId: string,
    targetNodeId: string,
    attributes: SemanticGraphEdge["attributes"],
    evidenceRefs: readonly string[] = [SCHEMA_EVIDENCE_ID],
  ): void => {
    edgeOrdinal += 1;
    edges.push({
      edge_id: `falcon-db24-edge-${String(edgeOrdinal).padStart(4, "0")}`,
      edge_version: 1,
      edge_type: edgeType,
      family,
      source_node_id: sourceNodeId,
      target_node_id: targetNodeId,
      lifecycle: "ACTIVE",
      attributes,
      evidence_refs: [...evidenceRefs],
    });
  };

  for (const table of schema) {
    const tableId = tableNodeId(table.name);
    nodes.push({
      ...commonNode(),
      node_id: tableId,
      node_type: "PHYSICAL_TABLE",
      name: table.name,
      description: `${SCHEMA_NAME}.${table.name} 固定快照物理表。`,
      schema_snapshot_id: FALCON_DB24_ONTOLOGY_IDS.snapshot,
      snapshot_content_hash: input.source_digest,
      datasource_id: FALCON_DB24_ONTOLOGY_IDS.datasource,
      schema_name: SCHEMA_NAME,
      table_name: table.name,
      relation_kind: "TABLE",
    });
    for (const [ordinal, column] of table.columns.entries()) {
      const columnId = columnNodeId(table.name, column.name);
      const restricted = new Set(["email", "phone", "address"]).has(column.name);
      nodes.push({
        ...commonNode(),
        node_id: columnId,
        node_type: "PHYSICAL_COLUMN",
        name: column.name,
        description: `${SCHEMA_NAME}.${table.name}.${column.name}`,
        schema_snapshot_id: FALCON_DB24_ONTOLOGY_IDS.snapshot,
        snapshot_content_hash: input.source_digest,
        datasource_id: FALCON_DB24_ONTOLOGY_IDS.datasource,
        schema_name: SCHEMA_NAME,
        table_name: table.name,
        column_name: column.name,
        ordinal,
        formatted_type: column.data_type,
        data_type: graphDataType(column.data_type),
        nullable: column.nullable,
        sensitivity: restricted ? "RESTRICTED" : "PUBLIC",
      });
      addEdge("CONTAINS_COLUMN", "PHYSICAL", tableId, columnId, {
        kind: "PHYSICAL_FACT",
        schema_snapshot_id: FALCON_DB24_ONTOLOGY_IDS.snapshot,
        snapshot_content_hash: input.source_digest,
        fact_kind: "CONTAINS_COLUMN",
      });
    }
  }

  for (const subject of SUBJECTS) {
    nodes.push({
      ...commonNode(),
      node_id: subject.subject_id,
      node_type: "BUSINESS_SUBJECT",
      name: subject.name,
      description: subject.description,
      domain: "falcon-blinkit",
    });
    addEdge("REPRESENTED_BY", "ANALYTICAL", subject.subject_id, tableNodeId(subject.table), {
      kind: "BINDING",
      role: "PRIMARY",
    });
    addEdge("SUPPORTED_BY", "PROVENANCE", subject.subject_id, tableNodeId(subject.table), {
      kind: "PROVENANCE",
      derivation_kind: "SUPPORTED",
      note: "Falcon db24 fixed physical schema.",
    });
    for (const [index, identifier] of subject.identifiers.entries()) {
      addEdge(
        "IDENTIFIED_BY",
        "ANALYTICAL",
        subject.subject_id,
        columnNodeId(subject.table, identifier),
        { kind: "BINDING", role: index === 0 ? "PRIMARY" : "ALTERNATE" },
      );
    }
  }

  for (const [source, target, relationshipName, cardinality] of BUSINESS_RELATIONS) {
    addEdge("RELATES_TO", "BUSINESS", source, target, {
      kind: "BUSINESS_RELATION",
      relationship_name: relationshipName,
      cardinality,
    });
  }

  for (const dimension of DIMENSIONS) {
    const table = schemaTables.get(dimension.table);
    const column = table?.columns.find((candidate) => candidate.name === dimension.column);
    if (!column) throw new Error(`FALCON_DB24_DIMENSION_COLUMN_MISSING:${dimension.dimension_id}`);
    nodes.push({
      ...commonNode(),
      node_id: dimension.dimension_id,
      node_type: "DIMENSION",
      name: dimension.name,
      description: `绑定 ${dimension.table}.${dimension.column}。`,
      data_type: graphDataType(column.data_type),
      sensitivity: "PUBLIC",
      filter_semantics: dimension.filter_semantics,
      analysis: { groupable: true, pivotable: true, causal_role: null },
    });
    addEdge("HAS_DIMENSION", "ANALYTICAL", dimension.subject_id, dimension.dimension_id, {
      kind: "NONE",
    });
    addEdge(
      "BOUND_TO",
      "ANALYTICAL",
      dimension.dimension_id,
      columnNodeId(dimension.table, dimension.column),
      { kind: "BINDING", role: "PRIMARY" },
    );
    addEdge("AT_GRAIN", "ANALYTICAL", dimension.dimension_id, dimension.subject_id, {
      kind: "GRAIN_BINDING",
      grain: {
        grain_id: `grain-${dimension.subject_id}`,
        description: `${dimension.subject_id} 原子粒度`,
        granularity: "atomic",
      },
      time_domain: null,
    });
    addEdge(
      "SUPPORTED_BY",
      "PROVENANCE",
      dimension.dimension_id,
      columnNodeId(dimension.table, dimension.column),
      { kind: "PROVENANCE", derivation_kind: "SUPPORTED", note: "Primary dimension binding." },
    );
  }

  for (const metric of METRICS) {
    const formulaId = `formula-${metric.metric_id.slice("metric-".length)}`;
    const formulaFunction = metric.aggregation;
    const returnType = metric.aggregation === "COUNT_DISTINCT" ? "integer" : "numeric";
    const columnId = columnNodeId(metric.table, metric.column);
    nodes.push(
      {
        ...commonNode(),
        node_id: metric.metric_id,
        node_type: "METRIC",
        name: metric.name,
        description: `${formulaFunction}(${metric.table}.${metric.column})`,
        unit: {
          unit_id: `unit-${metric.unit}`,
          description: metric.unit,
          dimension: metric.unit,
          base_unit: null,
          conversion_factor: null,
        },
        additivity: metric.additivity,
        null_policy: "exclude",
        fanout_policy: metric.fanout_policy,
        analysis: {
          primary: metric === METRICS[0],
          priority: METRICS.indexOf(metric),
          missing_period_policy: "NULL",
          seasonality: null,
          allowed_dimension_ids: [metric.dimension_id],
          capabilities: ["CHART_DATASET", "DATA_PROFILE"],
          causal_role: null,
        },
      },
      {
        ...commonNode(),
        node_id: formulaId,
        node_type: "FORMULA",
        name: `${metric.name}公式`,
        description: `${formulaFunction}(${metric.table}.${metric.column})`,
        formula_type:
          metric.additivity === "additive"
            ? "additive_aggregate"
            : metric.additivity === "semi-additive"
              ? "semi_additive_aggregate"
              : "non_additive_aggregate",
        return_type: returnType,
        language: "semantic-ast",
        language_version: SEMANTIC_FORMULA_AST_VERSION,
        expression: {
          kind: "AGGREGATE",
          function: formulaFunction,
          input: { kind: "SLOT", slot_id: "measure" },
          distinct: metric.aggregation === "COUNT_DISTINCT",
          filter: null,
        },
      },
    );
    addEdge("HAS_METRIC", "ANALYTICAL", metric.subject_id, metric.metric_id, { kind: "NONE" });
    addEdge("DEFINED_BY", "FORMULA", metric.metric_id, formulaId, { kind: "NONE" });
    addEdge("REFERENCES", "FORMULA", formulaId, columnId, {
      kind: "SLOT_BINDING",
      slot_id: "measure",
      role: "MEASURE",
    });
    addEdge("AT_GRAIN", "ANALYTICAL", formulaId, metric.subject_id, {
      kind: "GRAIN_BINDING",
      grain: {
        grain_id: `grain-${metric.subject_id}`,
        description: `${metric.subject_id} 原子粒度`,
        granularity: "atomic",
      },
      time_domain: null,
    });
    addEdge("USES_DIMENSION", "FORMULA", formulaId, metric.dimension_id, {
      kind: "DIMENSION_USE",
      role: "GROUP_BY",
    });
    for (const sourceNodeId of [metric.metric_id, formulaId]) {
      addEdge("SUPPORTED_BY", "PROVENANCE", sourceNodeId, columnId, {
        kind: "PROVENANCE",
        derivation_kind: "SUPPORTED",
        note: "Falcon db24 fixed physical measure.",
      });
    }
  }

  for (const join of FALCON_DB24_JOIN_SPECS) {
    const joinEvidence = input.join_evidence[join.join_id];
    if (!joinEvidence) throw new Error(`FALCON_DB24_JOIN_EVIDENCE_MISSING:${join.join_id}`);
    addEdge(
      "JOINABLE_VIA",
      "JOIN",
      columnNodeId(join.left_table, join.left_column),
      columnNodeId(join.right_table, join.right_column),
      {
        kind: "JOIN_PROOF",
        cardinality: joinEvidence.cardinality,
        left_row_preservation: "optional",
        right_row_preservation: "optional",
        proof_kind: "SNAPSHOT_CERTIFIED",
        proof_detail: joinEvidence.description,
        analysis: {
          join_allowed: true,
          fanout_closed: joinEvidence.cardinality !== "many-to-many",
          ontology_path: [],
        },
      },
      [`falcon-db24-join-${join.join_id}`],
    );
  }

  for (const [termId, name, definition, target] of GLOSSARY) {
    nodes.push({
      ...commonNode(),
      node_id: termId,
      node_type: "GLOSSARY_TERM",
      name,
      definition,
      language: "zh-CN",
      term_kind: "BUSINESS",
      abbreviation: null,
    });
    addEdge("DENOTES", "TERMINOLOGY", termId, target, {
      kind: "TERM_LINK",
      lexical_role: "PREFERRED",
    });
  }

  return semanticGraphSourceSchema.parse({
    metadata: {
      graph_version: SEMANTIC_GRAPH_SOURCE_VERSION,
      graph_id: FALCON_DB24_ONTOLOGY_IDS.graph,
      domain_id: "falcon-blinkit",
      base_release_id: input.base_release_id ?? null,
      capability_profile: "U5_EXECUTABLE_SUBSET",
      scope: input.scope,
      producer: { kind: "agent", id: "falcon-semantic-authoring-agent" },
      authority: {
        kind: "deterministic",
        id: "semantic-authority",
        policy_version: "falcon-db24-ontology-policy@1.0.0",
      },
      created_at: input.created_at,
      description:
        "Falcon db24 Blinkit ontology candidate with explicit business, analytical, formula, physical, join, provenance and terminology edges.",
    },
    node_type_registry: BUILTIN_SEMANTIC_NODE_TYPES.map((definition) => ({ ...definition })),
    edge_type_registry: BUILTIN_SEMANTIC_EDGE_TYPES.map((definition) => ({
      ...definition,
      source_node_types: [...definition.source_node_types],
      target_node_types: [...definition.target_node_types],
    })),
    evidence,
    nodes,
    edges,
  });
}
