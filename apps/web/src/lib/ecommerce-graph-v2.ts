import {
  BUILTIN_SEMANTIC_EDGE_TYPES,
  BUILTIN_SEMANTIC_NODE_TYPES,
  type PhysicalSchemaSnapshot,
  physicalSchemaSnapshotSchema,
  SEMANTIC_FORMULA_AST_VERSION,
  SEMANTIC_GRAPH_SOURCE_VERSION,
  type SemanticEvidence,
  type SemanticGraphEdge,
  type SemanticGraphNode,
  type SemanticGraphSource,
  type SemanticSourceBundle,
  semanticEvidenceSchema,
  semanticGraphEdgeSchema,
  semanticGraphNodeSchema,
  semanticGraphSourceSchema,
  semanticSourceBundleSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import {
  canonicalizeSemanticGraph,
  materializePhysicalOntology,
} from "@data-agent/semantic/authoring";

const OWNER_REF = "ecommerce-semantic-agent";
const SCHEMA_NAME = "demo_adb_ecommerce_mart";
const SOURCE_EVIDENCE_ID = "evidence-ecommerce-source-bundle@2";

interface SubjectMapping {
  readonly subject_id: string;
  readonly table_id: string;
  readonly identifier_column_ids: readonly string[];
  readonly dimension_ids: readonly string[];
}

const SUBJECTS: readonly SubjectMapping[] = [
  {
    subject_id: "ecommerce-entity-1@1",
    table_id: "dim_customer",
    identifier_column_ids: ["dim_customer.customer_id"],
    dimension_ids: ["ecommerce-customer-state@1", "ecommerce-customer-city@1"],
  },
  {
    subject_id: "ecommerce-entity-2@1",
    table_id: "fact_order",
    identifier_column_ids: ["fact_order.order_id"],
    dimension_ids: ["ecommerce-order-status@1", "ecommerce-purchase-date@1"],
  },
  {
    subject_id: "ecommerce-entity-3@1",
    table_id: "fact_order_item",
    identifier_column_ids: ["fact_order_item.order_item_id", "fact_order_item.order_id"],
    dimension_ids: ["ecommerce-product@1", "ecommerce-category@1"],
  },
  {
    subject_id: "ecommerce-entity-4@1",
    table_id: "dim_product",
    identifier_column_ids: ["dim_product.product_id"],
    dimension_ids: ["ecommerce-product@1", "ecommerce-category@1"],
  },
  {
    subject_id: "ecommerce-entity-5@1",
    table_id: "dim_category",
    identifier_column_ids: ["dim_category.category_name"],
    dimension_ids: ["ecommerce-category@1"],
  },
  {
    subject_id: "ecommerce-entity-6@1",
    table_id: "dim_seller",
    identifier_column_ids: ["dim_seller.seller_id"],
    dimension_ids: ["ecommerce-seller-state@1", "ecommerce-seller-city@1"],
  },
  {
    subject_id: "ecommerce-entity-7@1",
    table_id: "fact_payment",
    identifier_column_ids: ["fact_payment.payment_sequence", "fact_payment.order_id"],
    dimension_ids: ["ecommerce-payment-type@1"],
  },
  {
    subject_id: "ecommerce-entity-8@1",
    table_id: "fact_review",
    identifier_column_ids: ["fact_review.review_row_id"],
    dimension_ids: ["ecommerce-review-score@1"],
  },
  {
    subject_id: "ecommerce-entity-9@1",
    table_id: "fact_delivery_state_month",
    identifier_column_ids: [
      "fact_delivery_state_month.purchase_month",
      "fact_delivery_state_month.seller_state",
      "fact_delivery_state_month.customer_state",
    ],
    dimension_ids: ["ecommerce-purchase-month@1"],
  },
  {
    subject_id: "ecommerce-entity-10@1",
    table_id: "dim_geolocation_zip",
    identifier_column_ids: ["dim_geolocation_zip.zip_code_prefix", "dim_geolocation_zip.state"],
    dimension_ids: ["ecommerce-customer-state@1", "ecommerce-seller-state@1"],
  },
  {
    subject_id: "ecommerce-entity-11@1",
    table_id: "dim_date",
    identifier_column_ids: ["dim_date.date_key"],
    dimension_ids: ["ecommerce-purchase-date@1", "ecommerce-purchase-month@1"],
  },
  {
    subject_id: "ecommerce-entity-12@1",
    table_id: "dim_amazon_product",
    identifier_column_ids: ["dim_amazon_product.asin"],
    dimension_ids: ["ecommerce-amazon-brand@1", "ecommerce-amazon-category@1"],
  },
  {
    subject_id: "ecommerce-entity-13@1",
    table_id: "fact_amazon_review",
    identifier_column_ids: ["fact_amazon_review.review_row_id"],
    dimension_ids: ["ecommerce-amazon-brand@1", "ecommerce-amazon-category@1"],
  },
  {
    subject_id: "ecommerce-entity-14@1",
    table_id: "dim_ebay_listing",
    identifier_column_ids: ["dim_ebay_listing.listing_id"],
    dimension_ids: ["ecommerce-ebay-brand@1", "ecommerce-ebay-os@1"],
  },
];

const SUBJECT_BY_TABLE = new Map(SUBJECTS.map((entry) => [entry.table_id, entry.subject_id]));

const FORMULA_DIMENSIONS_BY_TABLE: Readonly<Record<string, readonly string[]>> = {
  fact_order: ["ecommerce-order-status@1", "ecommerce-purchase-date@1"],
  fact_order_item: ["ecommerce-product@1", "ecommerce-category@1"],
  fact_payment: ["ecommerce-payment-type@1"],
  fact_review: ["ecommerce-review-score@1"],
  fact_amazon_review: ["ecommerce-amazon-brand@1"],
  dim_amazon_product: ["ecommerce-amazon-brand@1", "ecommerce-amazon-category@1"],
  dim_ebay_listing: ["ecommerce-ebay-brand@1", "ecommerce-ebay-os@1"],
  fact_delivery_state_month: ["ecommerce-purchase-month@1"],
};

const BUSINESS_RELATIONS = [
  ["ecommerce-entity-1@1", "ecommerce-entity-2@1", "下单", "one-to-many"],
  ["ecommerce-entity-2@1", "ecommerce-entity-3@1", "包含明细", "one-to-many"],
  ["ecommerce-entity-3@1", "ecommerce-entity-4@1", "指向商品", "many-to-one"],
  ["ecommerce-entity-4@1", "ecommerce-entity-5@1", "归属类目", "many-to-one"],
  ["ecommerce-entity-3@1", "ecommerce-entity-6@1", "由卖家销售", "many-to-one"],
  ["ecommerce-entity-2@1", "ecommerce-entity-7@1", "发生支付", "one-to-many"],
  ["ecommerce-entity-2@1", "ecommerce-entity-8@1", "产生评价", "one-to-many"],
  ["ecommerce-entity-2@1", "ecommerce-entity-9@1", "对应配送", "many-to-one"],
  ["ecommerce-entity-1@1", "ecommerce-entity-10@1", "位于地域", "many-to-one"],
  ["ecommerce-entity-6@1", "ecommerce-entity-10@1", "位于地域", "many-to-one"],
  ["ecommerce-entity-2@1", "ecommerce-entity-11@1", "发生于日期", "many-to-one"],
  ["ecommerce-entity-13@1", "ecommerce-entity-12@1", "评价 Amazon 商品", "many-to-one"],
  ["ecommerce-entity-4@1", "ecommerce-entity-12@1", "跨平台对应", "many-to-many"],
  ["ecommerce-entity-4@1", "ecommerce-entity-14@1", "跨平台对应", "many-to-many"],
] as const;

const SOURCE_TERM_TARGETS: Readonly<Record<string, readonly string[]>> = {
  成交总额: ["ecommerce-gmv-brl@1"],
  订单量: ["ecommerce-order-count@1"],
  客单价: ["ecommerce-entity-2@1"],
  件单价: ["ecommerce-item-price-avg@1"],
  复购客户: ["ecommerce-entity-1@1"],
  复购率: ["ecommerce-entity-1@1"],
  活跃客户: ["ecommerce-entity-1@1"],
  活跃卖家: ["ecommerce-seller-count@1"],
  支付笔数: ["ecommerce-payment-count@1"],
  分期支付: ["ecommerce-installments-avg@1"],
  评价分: ["ecommerce-review-score@1"],
  低评分: ["ecommerce-review-score-min@1"],
  好评率: ["ecommerce-review-score-avg@1"],
  配送时长: ["ecommerce-entity-9@1"],
  配送延迟: ["ecommerce-delivery-delay-avg@1"],
  准时送达: ["ecommerce-entity-9@1"],
  延迟配送率: ["ecommerce-entity-9@1"],
  运费: ["ecommerce-freight-total@1"],
  运费率: ["ecommerce-freight-avg@1"],
  卖家履约: ["ecommerce-entity-6@1"],
  类目满意度: ["ecommerce-entity-5@1"],
  电子产品: ["ecommerce-entity-5@1"],
  价格带: ["ecommerce-entity-4@1"],
  价格四分位: ["ecommerce-entity-4@1"],
  跨平台商品: ["ecommerce-entity-4@1"],
  候选匹配: ["ecommerce-entity-4@1"],
  匹配置信度: ["ecommerce-entity-4@1"],
  人工审阅: ["ecommerce-entity-8@1"],
  "Amazon 标价": ["ecommerce-amazon-price-avg@1"],
  "eBay 刊登价": ["ecommerce-ebay-price-avg@1"],
  "Olist 成交价": ["ecommerce-item-price-avg@1"],
  客户州: ["ecommerce-customer-state@1"],
  卖家州: ["ecommerce-seller-state@1"],
  州对: ["ecommerce-entity-9@1"],
  购买月份: ["ecommerce-purchase-month@1"],
  运输距离: ["ecommerce-state-pair-distance-avg@1"],
  "Haversine 距离": ["ecommerce-state-pair-distance-avg@1"],
  品牌: ["ecommerce-amazon-brand@1", "ecommerce-ebay-brand@1"],
  内存容量: ["ecommerce-ebay-ram-avg@1"],
  固态硬盘容量: ["ecommerce-ebay-ssd-avg@1"],
  订单状态: ["ecommerce-order-status@1"],
  支付方式: ["ecommerce-payment-type@1"],
  商品重量: ["ecommerce-entity-4@1"],
  商品体积: ["ecommerce-entity-4@1"],
  评论文本: ["ecommerce-entity-8@1"],
  数据快照: ["ecommerce-entity-11@1"],
};

const PROFESSIONAL_TERMS = [
  {
    node_id: "ecommerce-term-business-grain@1",
    name: "业务粒度",
    definition: "一个业务事实在语义模型中被唯一识别和计算的最细层级。",
    term_kind: "ANALYTICAL",
    targets: ["ecommerce-entity-3@1"],
  },
  {
    node_id: "ecommerce-term-fanout@1",
    name: "Fanout",
    definition: "Join 导致同一业务事实被复制，从而使聚合指标发生重复计算的风险。",
    term_kind: "ANALYTICAL",
    targets: ["ecommerce-gmv-brl@1"],
  },
  {
    node_id: "ecommerce-term-row-preservation@1",
    name: "行保持",
    definition: "分析 Join 对左右两侧业务行是否必须完整保留的约束。",
    term_kind: "ANALYTICAL",
    targets: ["ecommerce-entity-2@1"],
  },
  {
    node_id: "ecommerce-term-analytical-join@1",
    name: "分析连接",
    definition: "具有基数、行保持和验证证据，可安全用于分析计算的 JOINABLE_VIA 关系。",
    term_kind: "ANALYTICAL",
    targets: ["ecommerce-entity-3@1"],
  },
  {
    node_id: "ecommerce-term-physical-lineage@1",
    name: "物理血缘",
    definition: "语义对象到数据库表、字段和快照证据的可追溯路径。",
    term_kind: "PHYSICAL",
    targets: ["formula-ecommerce-order-count@1"],
  },
  {
    node_id: "ecommerce-term-primary-key@1",
    name: "主键",
    definition: "在一个物理关系中稳定识别记录的字段或字段组合。",
    term_kind: "PHYSICAL",
    targets: ["ecommerce-entity-2@1"],
  },
] as const;

export interface EcommerceGraphJoinEvidence {
  readonly content_hash: `sha256:${string}`;
  readonly description: string;
}

export interface BuildEcommerceGraphV2Input {
  readonly bundle: SemanticSourceBundle;
  readonly snapshot: PhysicalSchemaSnapshot;
  readonly graph_id: string;
  readonly base_release_id: string;
  readonly scope: SemanticGraphSource["metadata"]["scope"];
  readonly created_at: string;
  readonly join_evidence: Readonly<Record<string, EcommerceGraphJoinEvidence>>;
}

function commonNode(evidenceRefs: readonly string[]) {
  return {
    node_version: 1,
    aliases: [] as string[],
    owner_ref: OWNER_REF,
    lifecycle: "ACTIVE" as const,
    evidence_refs: [...evidenceRefs],
    tags: ["ecommerce", "graph-v2"],
  };
}

async function stableId(prefix: string, identity: unknown): Promise<string> {
  const digest = await sha256ContentHash(identity);
  return `${prefix}-${digest.slice("sha256:".length, "sha256:".length + 32)}`;
}

function sourceColumnLocator(columnId: string): { table_id: string; column_name: string } {
  const separator = columnId.indexOf(".");
  if (
    separator < 1 ||
    separator === columnId.length - 1 ||
    columnId.indexOf(".", separator + 1) >= 0
  ) {
    throw new Error(`ECOMMERCE_GRAPH_COLUMN_ID_INVALID:${columnId}`);
  }
  return { table_id: columnId.slice(0, separator), column_name: columnId.slice(separator + 1) };
}

function formulaType(aggregation: SemanticSourceBundle["metrics"][number]["aggregation"]) {
  if (aggregation === "sum" || aggregation === "count") return "additive_aggregate" as const;
  return "non_additive_aggregate" as const;
}

function formulaFunction(aggregation: SemanticSourceBundle["metrics"][number]["aggregation"]) {
  return {
    sum: "SUM",
    count: "COUNT",
    count_distinct: "COUNT_DISTINCT",
    avg: "AVG",
    min: "MIN",
    max: "MAX",
  }[aggregation] as "SUM" | "COUNT" | "COUNT_DISTINCT" | "AVG" | "MIN" | "MAX";
}

function filterSemantics(dimension: SemanticSourceBundle["dimensions"][number]) {
  if (["date", "timestamp", "timestamptz"].includes(dimension.data_type))
    return "TEMPORAL" as const;
  return dimension.hierarchical ? ("HIERARCHICAL" as const) : ("EXACT" as const);
}

/**
 * Fixed-domain migration. Every cross-layer mapping is declared above; missing identities are
 * rejected instead of being inferred from display names or database direction.
 */
export async function buildEcommerceGraphV2(
  input: BuildEcommerceGraphV2Input,
): Promise<SemanticGraphSource> {
  const bundle = semanticSourceBundleSchema.parse(input.bundle);
  const snapshot = physicalSchemaSnapshotSchema.parse(input.snapshot);
  const physical = await materializePhysicalOntology(snapshot, "schema-discovery");
  const ontology = bundle.business_ontology;
  if (!ontology) throw new Error("ECOMMERCE_GRAPH_ONTOLOGY_MISSING");

  const tableNodes = new Map<string, Extract<SemanticGraphNode, { node_type: "PHYSICAL_TABLE" }>>();
  const columnNodes = new Map<
    string,
    Extract<SemanticGraphNode, { node_type: "PHYSICAL_COLUMN" }>
  >();
  for (const node of physical.nodes) {
    if (node.node_type === "PHYSICAL_TABLE" && node.schema_name === SCHEMA_NAME) {
      tableNodes.set(node.table_name, node);
    }
    if (node.node_type === "PHYSICAL_COLUMN" && node.schema_name === SCHEMA_NAME) {
      columnNodes.set(`${node.table_name}.${node.column_name}`, node);
    }
  }
  const tableNode = (tableId: string) => {
    const node = tableNodes.get(tableId);
    if (!node) throw new Error(`ECOMMERCE_GRAPH_TABLE_BINDING_MISSING:${tableId}`);
    return node;
  };
  const columnNode = (columnId: string) => {
    const locator = sourceColumnLocator(columnId);
    const node = columnNodes.get(`${locator.table_id}.${locator.column_name}`);
    if (!node) throw new Error(`ECOMMERCE_GRAPH_COLUMN_BINDING_MISSING:${columnId}`);
    return node;
  };

  const sourceDigest = await sha256ContentHash(bundle);
  const evidence: SemanticEvidence[] = [
    ...physical.evidence,
    semanticEvidenceSchema.parse({
      evidence_id: SOURCE_EVIDENCE_ID,
      kind: "BUSINESS_DOCUMENT",
      content_hash: sourceDigest,
      description: "AgenticDataBench E-commerce immutable Semantic V2 runtime content",
    }),
  ];
  const nodes: SemanticGraphNode[] = [...physical.nodes];
  const edges: SemanticGraphEdge[] = [...physical.edges];

  const addEdge = async (
    edge: Omit<SemanticGraphEdge, "edge_id" | "edge_version" | "lifecycle"> & {
      readonly discriminator?: unknown;
    },
  ) => {
    const { discriminator, ...payload } = edge;
    edges.push(
      semanticGraphEdgeSchema.parse({
        ...payload,
        edge_id: await stableId("edge", {
          edge_type: payload.edge_type,
          source_node_id: payload.source_node_id,
          target_node_id: payload.target_node_id,
          discriminator: discriminator ?? payload.attributes,
        }),
        edge_version: 1,
        lifecycle: "ACTIVE",
      }),
    );
  };

  const entities = new Map(ontology.entities.map((entity) => [entity.entity_id, entity]));
  for (const mapping of SUBJECTS) {
    const entity = entities.get(mapping.subject_id);
    if (!entity) throw new Error(`ECOMMERCE_GRAPH_SUBJECT_MAPPING_MISSING:${mapping.subject_id}`);
    const table = tableNode(mapping.table_id);
    nodes.push(
      semanticGraphNodeSchema.parse({
        ...commonNode([SOURCE_EVIDENCE_ID]),
        node_id: entity.entity_id,
        node_type: "BUSINESS_SUBJECT",
        name: entity.name,
        description: entity.description,
        aliases: entity.aliases,
        domain: entity.domain,
      }),
    );
    await addEdge({
      edge_type: "REPRESENTED_BY",
      family: "ANALYTICAL",
      source_node_id: entity.entity_id,
      target_node_id: table.node_id,
      attributes: { kind: "BINDING", role: "PRIMARY" },
      evidence_refs: [SOURCE_EVIDENCE_ID, ...table.evidence_refs],
    });
    await addEdge({
      edge_type: "SUPPORTED_BY",
      family: "PROVENANCE",
      source_node_id: entity.entity_id,
      target_node_id: table.node_id,
      attributes: {
        kind: "PROVENANCE",
        derivation_kind: "MIGRATED",
        note: "Semantic Graph V2 table binding",
      },
      evidence_refs: [SOURCE_EVIDENCE_ID, ...table.evidence_refs],
    });
    for (const [index, identifierColumnId] of mapping.identifier_column_ids.entries()) {
      const identifier = columnNode(identifierColumnId);
      await addEdge({
        edge_type: "IDENTIFIED_BY",
        family: "ANALYTICAL",
        source_node_id: entity.entity_id,
        target_node_id: identifier.node_id,
        attributes: { kind: "BINDING", role: index === 0 ? "PRIMARY" : "ALTERNATE" },
        evidence_refs: [SOURCE_EVIDENCE_ID, ...identifier.evidence_refs],
        discriminator: { identifier_column_id: identifierColumnId, index },
      });
    }
  }

  for (const [source, target, relationshipName, cardinality] of BUSINESS_RELATIONS) {
    await addEdge({
      edge_type: "RELATES_TO",
      family: "BUSINESS",
      source_node_id: source,
      target_node_id: target,
      attributes: { kind: "BUSINESS_RELATION", relationship_name: relationshipName, cardinality },
      evidence_refs: [SOURCE_EVIDENCE_ID],
    });
  }

  for (const dimension of bundle.dimensions) {
    const binding = columnNode(dimension.column_id);
    const subjectId = SUBJECT_BY_TABLE.get(dimension.table_id);
    if (!subjectId)
      throw new Error(`ECOMMERCE_GRAPH_DIMENSION_SUBJECT_MISSING:${dimension.dimension_id}`);
    nodes.push(
      semanticGraphNodeSchema.parse({
        ...commonNode([SOURCE_EVIDENCE_ID]),
        node_id: dimension.dimension_id,
        node_type: "DIMENSION",
        name: dimension.name,
        description: dimension.description,
        aliases: dimension.aliases,
        tags: dimension.tags,
        data_type: dimension.data_type,
        sensitivity: dimension.sensitivity,
        filter_semantics: filterSemantics(dimension),
        analysis: dimension.analysis,
      }),
    );
    await addEdge({
      edge_type: "BOUND_TO",
      family: "ANALYTICAL",
      source_node_id: dimension.dimension_id,
      target_node_id: binding.node_id,
      attributes: { kind: "BINDING", role: "PRIMARY" },
      evidence_refs: [SOURCE_EVIDENCE_ID, ...binding.evidence_refs],
    });
    await addEdge({
      edge_type: "AT_GRAIN",
      family: "ANALYTICAL",
      source_node_id: dimension.dimension_id,
      target_node_id: subjectId,
      attributes: { kind: "GRAIN_BINDING", grain: dimension.grain, time_domain: null },
      evidence_refs: [SOURCE_EVIDENCE_ID],
    });
    await addEdge({
      edge_type: "SUPPORTED_BY",
      family: "PROVENANCE",
      source_node_id: dimension.dimension_id,
      target_node_id: binding.node_id,
      attributes: {
        kind: "PROVENANCE",
        derivation_kind: "MIGRATED",
        note: "Semantic Graph V2 dimension binding",
      },
      evidence_refs: [SOURCE_EVIDENCE_ID, ...binding.evidence_refs],
    });
    if (dimension.parent_dimension_id) {
      await addEdge({
        edge_type: "ROLLS_UP_TO",
        family: "ANALYTICAL",
        source_node_id: dimension.dimension_id,
        target_node_id: dimension.parent_dimension_id,
        attributes: { kind: "NONE" },
        evidence_refs: [SOURCE_EVIDENCE_ID],
      });
    }
  }

  for (const subject of SUBJECTS) {
    for (const dimensionId of subject.dimension_ids) {
      await addEdge({
        edge_type: "HAS_DIMENSION",
        family: "ANALYTICAL",
        source_node_id: subject.subject_id,
        target_node_id: dimensionId,
        attributes: { kind: "NONE" },
        evidence_refs: [SOURCE_EVIDENCE_ID],
      });
    }
  }

  for (const metric of bundle.metrics) {
    const subjectId = SUBJECT_BY_TABLE.get(metric.table_id);
    const dimensionIds = FORMULA_DIMENSIONS_BY_TABLE[metric.table_id];
    if (!subjectId || !dimensionIds?.length) {
      throw new Error(`ECOMMERCE_GRAPH_METRIC_CONTEXT_MISSING:${metric.metric_id}`);
    }
    const measure = columnNode(metric.column_id);
    const formulaId = `formula-${metric.metric_id}`;
    nodes.push(
      semanticGraphNodeSchema.parse({
        ...commonNode([SOURCE_EVIDENCE_ID]),
        node_id: metric.metric_id,
        node_type: "METRIC",
        name: metric.name,
        description: metric.description,
        aliases: metric.aliases,
        tags: metric.tags,
        unit: metric.unit,
        additivity: metric.additivity,
        null_policy: metric.null_policy,
        fanout_policy: metric.fanout_policy,
        analysis: metric.analysis,
      }),
      semanticGraphNodeSchema.parse({
        ...commonNode([SOURCE_EVIDENCE_ID]),
        node_id: formulaId,
        node_type: "FORMULA",
        name: `${metric.name}公式`,
        description: `${metric.aggregation}(${metric.column_id})`,
        aliases: [`${metric.name} formula`],
        formula_type: formulaType(metric.aggregation),
        return_type:
          metric.aggregation === "count" || metric.aggregation === "count_distinct"
            ? "integer"
            : "numeric",
        language: "semantic-ast",
        language_version: SEMANTIC_FORMULA_AST_VERSION,
        expression: {
          kind: "AGGREGATE",
          function: formulaFunction(metric.aggregation),
          input: { kind: "SLOT", slot_id: "measure" },
          distinct: metric.aggregation === "count_distinct",
          filter: null,
        },
      }),
    );
    await addEdge({
      edge_type: "HAS_METRIC",
      family: "ANALYTICAL",
      source_node_id: subjectId,
      target_node_id: metric.metric_id,
      attributes: { kind: "NONE" },
      evidence_refs: [SOURCE_EVIDENCE_ID],
    });
    await addEdge({
      edge_type: "DEFINED_BY",
      family: "FORMULA",
      source_node_id: metric.metric_id,
      target_node_id: formulaId,
      attributes: { kind: "NONE" },
      evidence_refs: [SOURCE_EVIDENCE_ID],
    });
    await addEdge({
      edge_type: "REFERENCES",
      family: "FORMULA",
      source_node_id: formulaId,
      target_node_id: measure.node_id,
      attributes: { kind: "SLOT_BINDING", slot_id: "measure", role: "MEASURE" },
      evidence_refs: [SOURCE_EVIDENCE_ID, ...measure.evidence_refs],
    });
    if (metric.time_column_id) {
      const timeColumn = columnNode(metric.time_column_id);
      await addEdge({
        edge_type: "REFERENCES",
        family: "FORMULA",
        source_node_id: formulaId,
        target_node_id: timeColumn.node_id,
        attributes: { kind: "SLOT_BINDING", slot_id: "time-context", role: "TIME" },
        evidence_refs: [SOURCE_EVIDENCE_ID, ...timeColumn.evidence_refs],
      });
    }
    await addEdge({
      edge_type: "AT_GRAIN",
      family: "ANALYTICAL",
      source_node_id: formulaId,
      target_node_id: subjectId,
      attributes: { kind: "GRAIN_BINDING", grain: metric.grain, time_domain: metric.time_domain },
      evidence_refs: [SOURCE_EVIDENCE_ID],
    });
    for (const dimensionId of dimensionIds) {
      await addEdge({
        edge_type: "USES_DIMENSION",
        family: "FORMULA",
        source_node_id: formulaId,
        target_node_id: dimensionId,
        attributes: { kind: "DIMENSION_USE", role: "GROUP_BY" },
        evidence_refs: [SOURCE_EVIDENCE_ID],
      });
    }
    for (const sourceNodeId of [metric.metric_id, formulaId]) {
      await addEdge({
        edge_type: "SUPPORTED_BY",
        family: "PROVENANCE",
        source_node_id: sourceNodeId,
        target_node_id: measure.node_id,
        attributes: {
          kind: "PROVENANCE",
          derivation_kind: "MIGRATED",
          note: "Semantic Graph V2 metric binding",
        },
        evidence_refs: [SOURCE_EVIDENCE_ID, ...measure.evidence_refs],
      });
    }
  }

  for (const relationship of bundle.relationships) {
    const joinEvidence = input.join_evidence[relationship.relationship_id];
    if (!joinEvidence) {
      throw new Error(`ECOMMERCE_GRAPH_JOIN_EVIDENCE_MISSING:${relationship.relationship_id}`);
    }
    if (relationship.left_column_ids.length !== relationship.right_column_ids.length) {
      throw new Error(`ECOMMERCE_GRAPH_JOIN_ARITY_MISMATCH:${relationship.relationship_id}`);
    }
    const evidenceId = await stableId("evidence-join", relationship.relationship_id);
    evidence.push(
      semanticEvidenceSchema.parse({
        evidence_id: evidenceId,
        kind: "QUERY_SAMPLE",
        content_hash: joinEvidence.content_hash,
        description: joinEvidence.description,
      }),
    );
    for (const [index, leftColumnId] of relationship.left_column_ids.entries()) {
      const rightColumnId = relationship.right_column_ids[index];
      if (!rightColumnId)
        throw new Error(`ECOMMERCE_GRAPH_JOIN_ARITY_MISMATCH:${relationship.relationship_id}`);
      const left = columnNode(leftColumnId);
      const right = columnNode(rightColumnId);
      await addEdge({
        edge_type: "JOINABLE_VIA",
        family: "JOIN",
        source_node_id: left.node_id,
        target_node_id: right.node_id,
        attributes: {
          kind: "JOIN_PROOF",
          cardinality: relationship.cardinality,
          left_row_preservation: relationship.left_row_preservation,
          right_row_preservation: relationship.right_row_preservation,
          proof_kind: "SNAPSHOT_CERTIFIED",
          proof_detail: joinEvidence.description,
          analysis: relationship.analysis,
        },
        evidence_refs: [evidenceId, ...left.evidence_refs],
        discriminator: { relationship_id: relationship.relationship_id, index },
      });
    }
  }

  for (const term of ontology.terms) {
    const targets = SOURCE_TERM_TARGETS[term.name];
    if (!targets?.length) throw new Error(`ECOMMERCE_GRAPH_TERM_TARGET_MISSING:${term.term_id}`);
    nodes.push(
      semanticGraphNodeSchema.parse({
        ...commonNode([SOURCE_EVIDENCE_ID]),
        node_id: term.term_id,
        node_type: "GLOSSARY_TERM",
        name: term.name,
        definition: term.definition,
        aliases: term.aliases,
        language: "zh-CN",
        term_kind: "BUSINESS",
        abbreviation: null,
      }),
    );
    for (const target of targets) {
      await addEdge({
        edge_type: "DENOTES",
        family: "TERMINOLOGY",
        source_node_id: term.term_id,
        target_node_id: target,
        attributes: { kind: "TERM_LINK", lexical_role: "PREFERRED" },
        evidence_refs: [SOURCE_EVIDENCE_ID],
      });
    }
  }

  for (const term of PROFESSIONAL_TERMS) {
    nodes.push(
      semanticGraphNodeSchema.parse({
        ...commonNode([SOURCE_EVIDENCE_ID]),
        node_id: term.node_id,
        node_type: "GLOSSARY_TERM",
        name: term.name,
        definition: term.definition,
        language: "zh-CN",
        term_kind: term.term_kind,
        abbreviation: null,
      }),
    );
    for (const target of term.targets) {
      await addEdge({
        edge_type: "DENOTES",
        family: "TERMINOLOGY",
        source_node_id: term.node_id,
        target_node_id: target,
        attributes: { kind: "TERM_LINK", lexical_role: "PREFERRED" },
        evidence_refs: [SOURCE_EVIDENCE_ID],
      });
    }
  }

  const nodeIds = new Set(nodes.map((node) => node.node_id));
  for (const edge of edges) {
    if (!nodeIds.has(edge.source_node_id) || !nodeIds.has(edge.target_node_id)) {
      throw new Error(`ECOMMERCE_GRAPH_EDGE_TARGET_MISSING:${edge.edge_id}`);
    }
  }

  return canonicalizeSemanticGraph(
    semanticGraphSourceSchema.parse({
      metadata: {
        graph_version: SEMANTIC_GRAPH_SOURCE_VERSION,
        graph_id: input.graph_id,
        domain_id: "ecommerce",
        base_release_id: input.base_release_id,
        capability_profile: bundle.metadata.capability_profile,
        scope: input.scope,
        producer: { kind: "deterministic", id: "ecommerce-graph-v2-migration" },
        authority: {
          kind: "deterministic",
          id: "semantic-authority",
          policy_version: "ecommerce-ontology-policy@2.0.0",
        },
        created_at: input.created_at,
        description:
          "E-commerce Graph v2 ontology: explicit nodes, relationships and physical evidence",
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
    }),
  );
}
