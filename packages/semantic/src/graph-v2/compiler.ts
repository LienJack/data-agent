import {
  assertSemanticSourceBundleInvariants,
  SEMANTIC_GRAPH_PROJECTION_VERSION,
  SEMANTIC_SOURCE_BUNDLE_VERSION,
  type SemanticFormulaExpression,
  type SemanticGraphEdge,
  type SemanticGraphNode,
  type SemanticGraphProjection,
  type SemanticGraphSource,
  type SemanticSourceBundle,
  semanticGraphProjectionSchema,
  semanticSourceBundleSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { compileU5Projection, type U5Projection } from "../compiler/u5-compiler.js";
import { canonicalizeSemanticGraph, computeSemanticGraphDigest } from "./canonicalize.js";
import { SemanticGraphError, SemanticGraphErrorCode } from "./errors.js";
import { validateSemanticGraph } from "./validator.js";

export const SEMANTIC_GRAPH_COMPILER_VERSION = "semantic-graph-compiler@2.0.0" as const;

export interface SemanticGraphCompilation {
  readonly source_digest: `sha256:${string}`;
  readonly runtime_bundle: SemanticSourceBundle;
  readonly native_projection: SemanticGraphProjection;
  readonly u5_projection: U5Projection;
}

type PhysicalTableNode = Extract<SemanticGraphNode, { node_type: "PHYSICAL_TABLE" }>;
type PhysicalColumnNode = Extract<SemanticGraphNode, { node_type: "PHYSICAL_COLUMN" }>;
type MetricNode = Extract<SemanticGraphNode, { node_type: "METRIC" }>;
type DimensionNode = Extract<SemanticGraphNode, { node_type: "DIMENSION" }>;
type FormulaNode = Extract<SemanticGraphNode, { node_type: "FORMULA" }>;

function aliases(name: string, values: readonly string[]): string[] {
  return [...new Set([name, ...values])].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function activeEdges(graph: SemanticGraphSource, edgeType: string): SemanticGraphEdge[] {
  return graph.edges.filter((edge) => edge.lifecycle === "ACTIVE" && edge.edge_type === edgeType);
}

function renderExpression(expression: SemanticFormulaExpression): string {
  switch (expression.kind) {
    case "LITERAL":
      return JSON.stringify(expression.value);
    case "SLOT":
      return `slot(${expression.slot_id})`;
    case "BINARY":
      return `(${renderExpression(expression.left)} ${expression.operator} ${renderExpression(expression.right)})`;
    case "BOOLEAN":
      return `(${expression.operands.map(renderExpression).join(` ${expression.operator} `)})`;
    case "NOT":
      return `NOT(${renderExpression(expression.operand)})`;
    case "CASE":
      return `CASE ${expression.branches
        .map(
          (branch) =>
            `WHEN ${renderExpression(branch.when)} THEN ${renderExpression(branch.result)}`,
        )
        .join(
          " ",
        )}${expression.otherwise === null ? "" : ` ELSE ${renderExpression(expression.otherwise)}`} END`;
    case "AGGREGATE":
      return `${expression.function}(${expression.distinct ? "DISTINCT " : ""}${
        expression.input === null ? "*" : renderExpression(expression.input)
      })${expression.filter === null ? "" : ` FILTER(${renderExpression(expression.filter)})`}`;
    case "DATE_BUCKET":
      return `DATE_BUCKET(${expression.granularity}, ${renderExpression(expression.input)})`;
  }
}

function graphIndex(graph: SemanticGraphSource) {
  const nodesById = new Map(graph.nodes.map((node) => [node.node_id, node]));
  const contains = activeEdges(graph, "CONTAINS_COLUMN");
  const tableByColumn = new Map(contains.map((edge) => [edge.target_node_id, edge.source_node_id]));
  return { nodesById, tableByColumn };
}

function requireNode(
  nodesById: ReadonlyMap<string, SemanticGraphNode>,
  nodeId: string,
  nodeType: "PHYSICAL_TABLE",
): PhysicalTableNode;
function requireNode(
  nodesById: ReadonlyMap<string, SemanticGraphNode>,
  nodeId: string,
  nodeType: "PHYSICAL_COLUMN",
): PhysicalColumnNode;
function requireNode(
  nodesById: ReadonlyMap<string, SemanticGraphNode>,
  nodeId: string,
  nodeType: "METRIC",
): MetricNode;
function requireNode(
  nodesById: ReadonlyMap<string, SemanticGraphNode>,
  nodeId: string,
  nodeType: "DIMENSION",
): DimensionNode;
function requireNode(
  nodesById: ReadonlyMap<string, SemanticGraphNode>,
  nodeId: string,
  nodeType: "FORMULA",
): FormulaNode;
function requireNode(
  nodesById: ReadonlyMap<string, SemanticGraphNode>,
  nodeId: string,
  nodeType: SemanticGraphNode["node_type"],
): SemanticGraphNode {
  const node = nodesById.get(nodeId);
  if (node?.node_type !== nodeType) {
    throw new SemanticGraphError(
      SemanticGraphErrorCode.RUNTIME_COMPATIBILITY_UNSUPPORTED,
      `Runtime compiler 期望 ${nodeType} ${nodeId}。`,
    );
  }
  return node;
}

function qualifiedColumnId(table: PhysicalTableNode, column: PhysicalColumnNode): string {
  return `${table.node_id}.${column.node_id}`;
}

function primaryColumnForDimension(
  graph: SemanticGraphSource,
  dimension: DimensionNode,
  nodesById: ReadonlyMap<string, SemanticGraphNode>,
): PhysicalColumnNode {
  const edge = activeEdges(graph, "BOUND_TO").find(
    (candidate) =>
      candidate.source_node_id === dimension.node_id &&
      candidate.attributes.kind === "BINDING" &&
      candidate.attributes.role === "PRIMARY",
  );
  if (edge === undefined) {
    throw new SemanticGraphError(
      SemanticGraphErrorCode.RUNTIME_COMPATIBILITY_UNSUPPORTED,
      `Dimension ${dimension.node_id} 缺少 primary binding。`,
    );
  }
  return requireNode(nodesById, edge.target_node_id, "PHYSICAL_COLUMN");
}

function formulaForMetric(
  graph: SemanticGraphSource,
  metric: MetricNode,
  nodesById: ReadonlyMap<string, SemanticGraphNode>,
): FormulaNode {
  const edge = activeEdges(graph, "DEFINED_BY").find(
    (candidate) => candidate.source_node_id === metric.node_id,
  );
  if (edge === undefined) {
    throw new SemanticGraphError(
      SemanticGraphErrorCode.RUNTIME_COMPATIBILITY_UNSUPPORTED,
      `Metric ${metric.node_id} 缺少 Formula。`,
    );
  }
  return requireNode(nodesById, edge.target_node_id, "FORMULA");
}

function grainBindingFor(
  graph: SemanticGraphSource,
  sourceNodeId: string,
): Extract<SemanticGraphEdge["attributes"], { kind: "GRAIN_BINDING" }> {
  const edge = activeEdges(graph, "AT_GRAIN").find(
    (candidate) => candidate.source_node_id === sourceNodeId,
  );
  if (edge?.attributes.kind !== "GRAIN_BINDING") {
    throw new SemanticGraphError(
      SemanticGraphErrorCode.RUNTIME_COMPATIBILITY_UNSUPPORTED,
      `${sourceNodeId} 缺少可编译的 AT_GRAIN Edge。`,
    );
  }
  return edge.attributes;
}

function directAggregateBinding(
  graph: SemanticGraphSource,
  formula: FormulaNode,
  nodesById: ReadonlyMap<string, SemanticGraphNode>,
): {
  readonly column: PhysicalColumnNode;
  readonly aggregation: "sum" | "count" | "count_distinct" | "avg" | "min" | "max";
} {
  if (formula.expression.kind !== "AGGREGATE") {
    throw new SemanticGraphError(
      SemanticGraphErrorCode.RUNTIME_COMPATIBILITY_UNSUPPORTED,
      `Formula ${formula.node_id} 不是当前 runtime 支持的直接聚合。`,
      [renderExpression(formula.expression)],
    );
  }
  if (formula.expression.input?.kind !== "SLOT") {
    throw new SemanticGraphError(
      SemanticGraphErrorCode.RUNTIME_COMPATIBILITY_UNSUPPORTED,
      `Formula ${formula.node_id} 的直接聚合必须引用一个 slot。`,
    );
  }
  const slotId = formula.expression.input.slot_id;
  const edge = activeEdges(graph, "REFERENCES").find(
    (candidate) =>
      candidate.source_node_id === formula.node_id &&
      candidate.attributes.kind === "SLOT_BINDING" &&
      candidate.attributes.slot_id === slotId,
  );
  if (edge === undefined) {
    throw new SemanticGraphError(
      SemanticGraphErrorCode.FORMULA_SLOT_UNBOUND,
      `Formula ${formula.node_id} slot ${slotId} 未绑定。`,
    );
  }
  const aggregationByFunction = {
    SUM: "sum",
    COUNT: "count",
    COUNT_DISTINCT: "count_distinct",
    AVG: "avg",
    MIN: "min",
    MAX: "max",
  } as const;
  return {
    column: requireNode(nodesById, edge.target_node_id, "PHYSICAL_COLUMN"),
    aggregation: aggregationByFunction[formula.expression.function],
  };
}

function buildRuntimeBundle(graph: SemanticGraphSource): SemanticSourceBundle {
  const { nodesById, tableByColumn } = graphIndex(graph);
  const tables = graph.nodes.filter(
    (node): node is PhysicalTableNode =>
      node.node_type === "PHYSICAL_TABLE" && node.lifecycle === "ACTIVE",
  );
  const metrics = graph.nodes
    .filter(
      (node): node is MetricNode => node.node_type === "METRIC" && node.lifecycle === "ACTIVE",
    )
    .map((metric) => {
      const formula = formulaForMetric(graph, metric, nodesById);
      if (
        activeEdges(graph, "DEPENDS_ON").some((edge) => edge.source_node_id === formula.node_id)
      ) {
        throw new SemanticGraphError(
          SemanticGraphErrorCode.RUNTIME_COMPATIBILITY_UNSUPPORTED,
          `Formula ${formula.node_id} 含 Formula dependency，当前 compatibility profile 不支持。`,
        );
      }
      const { column, aggregation } = directAggregateBinding(graph, formula, nodesById);
      const tableId = tableByColumn.get(column.node_id);
      if (tableId === undefined) {
        throw new SemanticGraphError(
          SemanticGraphErrorCode.PHYSICAL_STRUCTURE_INVALID,
          `Column ${column.node_id} 没有所属表。`,
        );
      }
      const table = requireNode(nodesById, tableId, "PHYSICAL_TABLE");
      const grainBinding = grainBindingFor(graph, formula.node_id);
      const references = activeEdges(graph, "REFERENCES").filter(
        (edge) => edge.source_node_id === formula.node_id,
      );
      const dependencyColumnIds = references
        .filter(
          (edge) => edge.attributes.kind !== "SLOT_BINDING" || edge.attributes.role !== "TIME",
        )
        .map((edge) => {
          const dependencyColumn = requireNode(nodesById, edge.target_node_id, "PHYSICAL_COLUMN");
          const dependencyTableId = tableByColumn.get(dependencyColumn.node_id);
          if (dependencyTableId !== table.node_id) {
            throw new SemanticGraphError(
              SemanticGraphErrorCode.RUNTIME_COMPATIBILITY_UNSUPPORTED,
              `Metric ${metric.node_id} 的当前 runtime projection 不支持跨表 dependency。`,
            );
          }
          return qualifiedColumnId(table, dependencyColumn);
        });
      const timeReference = references.find(
        (edge) => edge.attributes.kind === "SLOT_BINDING" && edge.attributes.role === "TIME",
      );
      const timeColumn =
        timeReference === undefined
          ? null
          : requireNode(nodesById, timeReference.target_node_id, "PHYSICAL_COLUMN");
      return {
        metric_id: metric.node_id,
        name: metric.name,
        ...(metric.description === undefined ? {} : { description: metric.description }),
        aliases: aliases(metric.name, metric.aliases),
        table_id: table.node_id,
        column_id: qualifiedColumnId(table, column),
        aggregation,
        formula: null,
        grain: grainBinding.grain,
        unit: metric.unit,
        time_domain: grainBinding.time_domain,
        time_column_id: timeColumn === null ? null : qualifiedColumnId(table, timeColumn),
        additivity: metric.additivity,
        null_policy: metric.null_policy,
        fanout_policy: metric.fanout_policy,
        dependency_column_ids: [...new Set(dependencyColumnIds)].sort(),
        tags: [...metric.tags],
      };
    });
  const dimensions = graph.nodes
    .filter(
      (node): node is DimensionNode =>
        node.node_type === "DIMENSION" && node.lifecycle === "ACTIVE",
    )
    .map((dimension) => {
      const column = primaryColumnForDimension(graph, dimension, nodesById);
      const tableId = tableByColumn.get(column.node_id);
      if (tableId === undefined) {
        throw new SemanticGraphError(
          SemanticGraphErrorCode.PHYSICAL_STRUCTURE_INVALID,
          `Column ${column.node_id} 没有所属表。`,
        );
      }
      const table = requireNode(nodesById, tableId, "PHYSICAL_TABLE");
      const parentEdge = activeEdges(graph, "ROLLS_UP_TO").find(
        (edge) => edge.source_node_id === dimension.node_id,
      );
      return {
        dimension_id: dimension.node_id,
        name: dimension.name,
        ...(dimension.description === undefined ? {} : { description: dimension.description }),
        aliases: aliases(dimension.name, dimension.aliases),
        table_id: table.node_id,
        column_id: qualifiedColumnId(table, column),
        grain: grainBindingFor(graph, dimension.node_id).grain,
        data_type: dimension.data_type,
        sensitivity: dimension.sensitivity,
        hierarchical: parentEdge !== undefined,
        parent_dimension_id: parentEdge?.target_node_id ?? null,
        tags: [...dimension.tags],
      };
    });

  const relationships = activeEdges(graph, "JOINABLE_VIA").map((edge) => {
    if (edge.attributes.kind !== "JOIN_PROOF") {
      throw new SemanticGraphError(
        SemanticGraphErrorCode.EDGE_ATTRIBUTE_MISMATCH,
        `JOINABLE_VIA ${edge.edge_id} 缺少 JOIN_PROOF。`,
      );
    }
    const leftColumn = requireNode(nodesById, edge.source_node_id, "PHYSICAL_COLUMN");
    const rightColumn = requireNode(nodesById, edge.target_node_id, "PHYSICAL_COLUMN");
    const leftTable = requireNode(
      nodesById,
      tableByColumn.get(leftColumn.node_id) ?? "missing-left-table",
      "PHYSICAL_TABLE",
    );
    const rightTable = requireNode(
      nodesById,
      tableByColumn.get(rightColumn.node_id) ?? "missing-right-table",
      "PHYSICAL_TABLE",
    );
    return {
      relationship_id: edge.edge_id,
      name: edge.edge_type,
      kind: "analytical" as const,
      left_table_id: leftTable.node_id,
      left_column_ids: [qualifiedColumnId(leftTable, leftColumn)],
      right_table_id: rightTable.node_id,
      right_column_ids: [qualifiedColumnId(rightTable, rightColumn)],
      cardinality: edge.attributes.cardinality,
      left_row_preservation: edge.attributes.left_row_preservation,
      right_row_preservation: edge.attributes.right_row_preservation,
      proof_kind: edge.attributes.proof_kind,
      proof_detail: edge.attributes.proof_detail,
      tags: [],
    };
  });

  const subjects = graph.nodes.filter(
    (node): node is Extract<SemanticGraphNode, { node_type: "BUSINESS_SUBJECT" }> =>
      node.node_type === "BUSINESS_SUBJECT" && node.lifecycle === "ACTIVE",
  );
  const businessOntology =
    subjects.length === 0
      ? undefined
      : {
          domain: graph.metadata.domain_id,
          entities: subjects.map((subject) => ({
            entity_id: subject.node_id,
            name: subject.name,
            ...(subject.description === undefined ? {} : { description: subject.description }),
            aliases: [...subject.aliases],
            domain: subject.domain,
            owner: subject.owner_ref,
            lifecycle: "active" as const,
            business_relationship_types: activeEdges(graph, "RELATES_TO")
              .filter((edge) => edge.source_node_id === subject.node_id)
              .map((edge) => ({
                relationship_type:
                  edge.attributes.kind === "BUSINESS_RELATION"
                    ? edge.attributes.relationship_name
                    : edge.edge_type,
                target_entity_id: edge.target_node_id,
              })),
          })),
          events: [],
          terms: [],
          owner: graph.metadata.authority.id,
          lifecycle: "active" as const,
        };

  const catalogGovernance = {
    tables: tables.map((table) => ({
      table_id: table.node_id,
      table_name: `${table.schema_name}.${table.table_name}`,
      columns: activeEdges(graph, "CONTAINS_COLUMN")
        .filter((edge) => edge.source_node_id === table.node_id)
        .map((edge) => requireNode(nodesById, edge.target_node_id, "PHYSICAL_COLUMN"))
        .map((column) => ({
          column_id: qualifiedColumnId(table, column),
          nullable: column.nullable,
          data_type: column.data_type,
          constraint_refs: [],
        })),
      snapshot_currentness: {
        snapshot_timestamp: graph.metadata.created_at,
        staleness_threshold_seconds: null,
      },
      catalog_fence: table.snapshot_content_hash,
    })),
    data_quality_oracle_refs: [],
  };

  const physicalBindingEntries = [
    ...dimensions.map((dimension) => {
      const source = requireNode(nodesById, dimension.dimension_id, "DIMENSION");
      const column = primaryColumnForDimension(graph, source, nodesById);
      return {
        logical_object_id: dimension.dimension_id,
        logical_object_type: "dimension" as const,
        datasource_id: column.datasource_id,
        schema_name: column.schema_name,
        table_name: column.table_name,
        column_name: column.column_name,
        binding_lifecycle: "active" as const,
        valid_from: graph.metadata.created_at,
        valid_until: null,
      };
    }),
    ...metrics.map((metric) => {
      const source = requireNode(nodesById, metric.metric_id, "METRIC");
      const formula = formulaForMetric(graph, source, nodesById);
      const { column } = directAggregateBinding(graph, formula, nodesById);
      return {
        logical_object_id: metric.metric_id,
        logical_object_type: "metric" as const,
        datasource_id: column.datasource_id,
        schema_name: column.schema_name,
        table_name: column.table_name,
        column_name: column.column_name,
        binding_lifecycle: "active" as const,
        valid_from: graph.metadata.created_at,
        valid_until: null,
      };
    }),
  ];

  const bundle = semanticSourceBundleSchema.parse({
    metadata: {
      bundle_version: SEMANTIC_SOURCE_BUNDLE_VERSION,
      capability_profile: graph.metadata.capability_profile,
      bundle_id: graph.metadata.graph_id,
      scope: graph.metadata.scope,
      producer: graph.metadata.producer,
      authority: graph.metadata.authority,
      created_at: graph.metadata.created_at,
      description: "Deterministic Graph v2 compatibility projection",
    },
    formulas: [],
    metrics,
    dimensions,
    relationships,
    ...(businessOntology === undefined ? {} : { business_ontology: businessOntology }),
    physical_binding: { entries: physicalBindingEntries, default_datasource_id: null },
    catalog_governance: catalogGovernance,
  });
  assertSemanticSourceBundleInvariants(bundle);
  return bundle;
}

export async function compileSemanticGraphV2(input: unknown): Promise<SemanticGraphCompilation> {
  const graph = canonicalizeSemanticGraph(input);
  const validationIssues = validateSemanticGraph(graph);
  if (validationIssues.length > 0) {
    const first =
      validationIssues.find(
        (entry) => entry.code === SemanticGraphErrorCode.RUNTIME_COMPATIBILITY_AMBIGUOUS,
      ) ?? validationIssues.at(0);
    if (first === undefined) {
      throw new SemanticGraphError(
        SemanticGraphErrorCode.RUNTIME_COMPATIBILITY_AMBIGUOUS,
        "语义图校验失败。",
      );
    }
    throw new SemanticGraphError(first.code, first.message, first.details);
  }
  const sourceDigest = await computeSemanticGraphDigest(graph);
  const registryDigest = await sha256ContentHash({
    node_type_registry: graph.node_type_registry,
    edge_type_registry: graph.edge_type_registry,
  });
  const nativeProjection = semanticGraphProjectionSchema.parse({
    projection_version: SEMANTIC_GRAPH_PROJECTION_VERSION,
    graph_id: graph.metadata.graph_id,
    source_digest: sourceDigest,
    registry_digest: registryDigest,
    compiler_version: SEMANTIC_GRAPH_COMPILER_VERSION,
    node_count: graph.nodes.length,
    edge_count: graph.edges.length,
    nodes: graph.nodes,
    edges: graph.edges,
  });
  const runtimeBundle = buildRuntimeBundle(graph);
  const u5Projection = await compileU5Projection(runtimeBundle);
  if (u5Projection.errors.length > 0) {
    throw new SemanticGraphError(
      SemanticGraphErrorCode.RUNTIME_COMPATIBILITY_UNSUPPORTED,
      "Graph v2 compatibility projection 未通过现有 U5 compiler。",
      u5Projection.errors.map((entry) => `${entry.code}: ${entry.message}`),
    );
  }
  return {
    source_digest: sourceDigest,
    runtime_bundle: runtimeBundle,
    native_projection: nativeProjection,
    u5_projection: u5Projection,
  };
}
