import {
  SEMANTIC_ONTOLOGY_COVERAGE_RECEIPT_VERSION,
  type SemanticEdgeFamily,
  type SemanticFormulaExpression,
  type SemanticGraphEdge,
  type SemanticGraphNode,
  type SemanticGraphSource,
  type SemanticNodeType,
  type SemanticOntologyCoverageIssue,
  type SemanticOntologyCoverageReceipt,
  semanticGraphSourceSchema,
  semanticOntologyCoverageReceiptSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { computeSemanticGraphDigest } from "./canonicalize.js";
import { SemanticGraphErrorCode, type SemanticGraphValidationIssue } from "./errors.js";

function issue(
  code: SemanticGraphErrorCode,
  message: string,
  entryId?: string,
  details: readonly string[] = [],
): SemanticGraphValidationIssue {
  return { code, message, ...(entryId === undefined ? {} : { entry_id: entryId }), details };
}

function activeEdges(graph: SemanticGraphSource, edgeType?: string): SemanticGraphEdge[] {
  return graph.edges.filter(
    (edge) =>
      edge.lifecycle === "ACTIVE" && (edgeType === undefined || edge.edge_type === edgeType),
  );
}

function collectSlots(
  expression: SemanticFormulaExpression,
  slots = new Set<string>(),
): Set<string> {
  switch (expression.kind) {
    case "SLOT":
      slots.add(expression.slot_id);
      break;
    case "BINARY":
      collectSlots(expression.left, slots);
      collectSlots(expression.right, slots);
      break;
    case "BOOLEAN":
      for (const operand of expression.operands) collectSlots(operand, slots);
      break;
    case "NOT":
      collectSlots(expression.operand, slots);
      break;
    case "CASE":
      for (const branch of expression.branches) {
        collectSlots(branch.when, slots);
        collectSlots(branch.result, slots);
      }
      if (expression.otherwise !== null) collectSlots(expression.otherwise, slots);
      break;
    case "AGGREGATE":
      if (expression.input !== null) collectSlots(expression.input, slots);
      if (expression.filter !== null) collectSlots(expression.filter, slots);
      break;
    case "DATE_BUCKET":
      collectSlots(expression.input, slots);
      break;
    case "LITERAL":
      break;
  }
  return slots;
}

function cycleNodes(edges: readonly SemanticGraphEdge[]): string[] {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = adjacency.get(edge.source_node_id) ?? [];
    targets.push(edge.target_node_id);
    adjacency.set(edge.source_node_id, targets);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycle = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visiting.has(nodeId)) {
      cycle.add(nodeId);
      return;
    }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const target of adjacency.get(nodeId) ?? []) {
      visit(target);
      if (cycle.has(target)) cycle.add(nodeId);
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const nodeId of adjacency.keys()) visit(nodeId);
  return [...cycle].sort();
}

function validateRegistry(
  graph: SemanticGraphSource,
  nodesById: ReadonlyMap<string, SemanticGraphNode>,
): SemanticGraphValidationIssue[] {
  const issues: SemanticGraphValidationIssue[] = [];
  const nodeDefinitions = new Map<string, (typeof graph.node_type_registry)[number]>();
  for (const definition of graph.node_type_registry) {
    if (nodeDefinitions.has(definition.node_type)) {
      issues.push(
        issue(
          SemanticGraphErrorCode.DUPLICATE_IDENTITY,
          `Node type registry 重复定义 ${definition.node_type}。`,
          definition.node_type,
        ),
      );
    }
    nodeDefinitions.set(definition.node_type, definition);
  }
  for (const node of graph.nodes) {
    const definition = nodeDefinitions.get(node.node_type);
    if (definition === undefined) {
      issues.push(
        issue(
          SemanticGraphErrorCode.REGISTRY_MISSING,
          `Node ${node.node_id} 的类型 ${node.node_type} 未注册。`,
          node.node_id,
        ),
      );
    }
    if (
      (node.node_type === "PHYSICAL_TABLE" || node.node_type === "PHYSICAL_COLUMN") &&
      definition?.authoring_policy !== "SYSTEM_MANAGED"
    ) {
      issues.push(
        issue(
          SemanticGraphErrorCode.PHYSICAL_STRUCTURE_INVALID,
          `物理 Node ${node.node_id} 必须由 schema snapshot 管理。`,
          node.node_id,
        ),
      );
    }
  }

  const edgeDefinitions = new Map<string, (typeof graph.edge_type_registry)[number]>();
  for (const definition of graph.edge_type_registry) {
    if (edgeDefinitions.has(definition.edge_type)) {
      issues.push(
        issue(
          SemanticGraphErrorCode.DUPLICATE_IDENTITY,
          `Edge type registry 重复定义 ${definition.edge_type}。`,
          definition.edge_type,
        ),
      );
    }
    edgeDefinitions.set(definition.edge_type, definition);
  }
  for (const edge of graph.edges) {
    const definition = edgeDefinitions.get(edge.edge_type);
    if (definition === undefined) {
      issues.push(
        issue(
          SemanticGraphErrorCode.REGISTRY_MISSING,
          `Edge ${edge.edge_id} 的类型 ${edge.edge_type} 未注册。`,
          edge.edge_id,
        ),
      );
      continue;
    }
    const source = nodesById.get(edge.source_node_id);
    const target = nodesById.get(edge.target_node_id);
    if (source === undefined || target === undefined) {
      issues.push(
        issue(
          SemanticGraphErrorCode.DANGLING_EDGE,
          `Edge ${edge.edge_id} 指向不存在的 Node。`,
          edge.edge_id,
          [edge.source_node_id, edge.target_node_id],
        ),
      );
      continue;
    }
    if (
      !definition.source_node_types.includes(source.node_type) ||
      !definition.target_node_types.includes(target.node_type)
    ) {
      issues.push(
        issue(
          SemanticGraphErrorCode.REGISTRY_ENDPOINT_MISMATCH,
          `Edge ${edge.edge_id} 的端点不符合 ${edge.edge_type} registry。`,
          edge.edge_id,
          [source.node_type, target.node_type],
        ),
      );
    }
    if (definition.family !== edge.family) {
      issues.push(
        issue(
          SemanticGraphErrorCode.EDGE_FAMILY_MISMATCH,
          `Edge ${edge.edge_id} family 与 registry 不一致。`,
          edge.edge_id,
        ),
      );
    }
    if (definition.attribute_kind !== edge.attributes.kind) {
      issues.push(
        issue(
          SemanticGraphErrorCode.EDGE_ATTRIBUTE_MISMATCH,
          `Edge ${edge.edge_id} attributes 与 registry 不一致。`,
          edge.edge_id,
        ),
      );
    }
    if (
      (edge.edge_type === "CONTAINS_COLUMN" || edge.edge_type === "FOREIGN_KEY_TO") &&
      definition.authoring_policy !== "SYSTEM_MANAGED"
    ) {
      issues.push(
        issue(
          SemanticGraphErrorCode.PHYSICAL_STRUCTURE_INVALID,
          `物理 Edge ${edge.edge_id} 必须由 schema snapshot 管理。`,
          edge.edge_id,
        ),
      );
    }
  }
  return issues;
}

function validatePhysicalStructure(
  graph: SemanticGraphSource,
  nodesById: ReadonlyMap<string, SemanticGraphNode>,
): SemanticGraphValidationIssue[] {
  const issues: SemanticGraphValidationIssue[] = [];
  const contains = activeEdges(graph, "CONTAINS_COLUMN");
  for (const column of graph.nodes.filter(
    (node): node is Extract<SemanticGraphNode, { node_type: "PHYSICAL_COLUMN" }> =>
      node.node_type === "PHYSICAL_COLUMN" && node.lifecycle === "ACTIVE",
  )) {
    const parents = contains.filter((edge) => edge.target_node_id === column.node_id);
    if (parents.length !== 1) {
      issues.push(
        issue(
          SemanticGraphErrorCode.PHYSICAL_STRUCTURE_INVALID,
          `PhysicalColumn ${column.node_id} 必须且只能属于一个 PhysicalTable。`,
          column.node_id,
        ),
      );
      continue;
    }
    const parent = parents.at(0);
    if (parent === undefined) {
      continue;
    }
    const table = nodesById.get(parent.source_node_id);
    if (
      table?.node_type !== "PHYSICAL_TABLE" ||
      table.schema_snapshot_id !== column.schema_snapshot_id ||
      table.snapshot_content_hash !== column.snapshot_content_hash ||
      table.datasource_id !== column.datasource_id ||
      table.schema_name !== column.schema_name ||
      table.table_name !== column.table_name
    ) {
      issues.push(
        issue(
          SemanticGraphErrorCode.PHYSICAL_STRUCTURE_INVALID,
          `PhysicalColumn ${column.node_id} 与所属表的 snapshot identity 不一致。`,
          column.node_id,
        ),
      );
    }
    const attributes = parent.attributes;
    if (
      attributes.kind !== "PHYSICAL_FACT" ||
      attributes.fact_kind !== "CONTAINS_COLUMN" ||
      attributes.schema_snapshot_id !== column.schema_snapshot_id ||
      attributes.snapshot_content_hash !== column.snapshot_content_hash
    ) {
      issues.push(
        issue(
          SemanticGraphErrorCode.PHYSICAL_STRUCTURE_INVALID,
          `CONTAINS_COLUMN ${parent.edge_id} 未绑定精确 schema snapshot。`,
          parent.edge_id,
        ),
      );
    }
  }
  return issues;
}

function validateFormulaSemantics(
  graph: SemanticGraphSource,
  nodesById: ReadonlyMap<string, SemanticGraphNode>,
): SemanticGraphValidationIssue[] {
  const issues: SemanticGraphValidationIssue[] = [];
  const bindings = activeEdges(graph).filter(
    (edge) => edge.edge_type === "REFERENCES" || edge.edge_type === "DEPENDS_ON",
  );
  const contains = activeEdges(graph, "CONTAINS_COLUMN");
  const parentTableByColumn = new Map(
    contains.map((edge) => [edge.target_node_id, edge.source_node_id]),
  );

  for (const formula of graph.nodes.filter(
    (node): node is Extract<SemanticGraphNode, { node_type: "FORMULA" }> =>
      node.node_type === "FORMULA" && node.lifecycle === "ACTIVE",
  )) {
    const slots = collectSlots(formula.expression);
    const formulaBindings = bindings.filter((edge) => edge.source_node_id === formula.node_id);
    const bindingsBySlot = new Map<string, SemanticGraphEdge[]>();
    for (const edge of formulaBindings) {
      if (edge.attributes.kind !== "SLOT_BINDING") continue;
      const entries = bindingsBySlot.get(edge.attributes.slot_id) ?? [];
      entries.push(edge);
      bindingsBySlot.set(edge.attributes.slot_id, entries);
    }
    for (const slot of slots) {
      const count = bindingsBySlot.get(slot)?.length ?? 0;
      if (count === 0) {
        issues.push(
          issue(
            SemanticGraphErrorCode.FORMULA_SLOT_UNBOUND,
            `Formula ${formula.node_id} 的 slot ${slot} 未由 Edge 绑定。`,
            formula.node_id,
            [slot],
          ),
        );
      } else if (count > 1) {
        issues.push(
          issue(
            SemanticGraphErrorCode.FORMULA_SLOT_DUPLICATE_BINDING,
            `Formula ${formula.node_id} 的 slot ${slot} 存在多个 active binding。`,
            formula.node_id,
            [slot],
          ),
        );
      }
    }
    for (const slot of bindingsBySlot.keys()) {
      if (!slots.has(slot)) {
        issues.push(
          issue(
            SemanticGraphErrorCode.FORMULA_SLOT_UNUSED,
            `Formula ${formula.node_id} 的 Edge 绑定了 AST 中不存在的 slot ${slot}。`,
            formula.node_id,
            [slot],
          ),
        );
      }
    }

    const grainEdges = activeEdges(graph, "AT_GRAIN").filter(
      (edge) => edge.source_node_id === formula.node_id,
    );
    if (grainEdges.length !== 1) {
      issues.push(
        issue(
          grainEdges.length > 1
            ? SemanticGraphErrorCode.RUNTIME_COMPATIBILITY_AMBIGUOUS
            : SemanticGraphErrorCode.RUNTIME_COMPATIBILITY_UNSUPPORTED,
          `Formula ${formula.node_id} 必须且只能有一个 active AT_GRAIN Edge。`,
          formula.node_id,
        ),
      );
    }

    const metricDefinitions = activeEdges(graph, "DEFINED_BY").filter(
      (edge) => edge.target_node_id === formula.node_id,
    );
    const metricNodes = metricDefinitions
      .map((edge) => nodesById.get(edge.source_node_id))
      .filter(
        (node): node is Extract<SemanticGraphNode, { node_type: "METRIC" }> =>
          node?.node_type === "METRIC",
      );
    if (formula.expression.kind === "AGGREGATE") {
      const inputSlot =
        formula.expression.input?.kind === "SLOT" ? formula.expression.input.slot_id : null;
      const inputBinding = inputSlot === null ? undefined : bindingsBySlot.get(inputSlot)?.[0];
      const inputNode =
        inputBinding === undefined ? undefined : nodesById.get(inputBinding.target_node_id);
      if (
        (formula.expression.function === "SUM" || formula.expression.function === "AVG") &&
        inputNode?.node_type === "PHYSICAL_COLUMN" &&
        inputNode.data_type !== "numeric" &&
        inputNode.data_type !== "integer"
      ) {
        issues.push(
          issue(
            SemanticGraphErrorCode.FORMULA_TYPE_CONFLICT,
            `Formula ${formula.node_id} 的 ${formula.expression.function} 输入必须是数值列。`,
            formula.node_id,
          ),
        );
      }
      if (
        (formula.expression.function === "COUNT" ||
          formula.expression.function === "COUNT_DISTINCT") &&
        formula.return_type !== "integer"
      ) {
        issues.push(
          issue(
            SemanticGraphErrorCode.FORMULA_TYPE_CONFLICT,
            `Formula ${formula.node_id} 的计数返回类型必须是 integer。`,
            formula.node_id,
          ),
        );
      }
      if (
        (formula.expression.function === "COUNT" ||
          formula.expression.function === "COUNT_DISTINCT") &&
        metricNodes.some((metric) => metric.unit?.dimension !== "count")
      ) {
        issues.push(
          issue(
            SemanticGraphErrorCode.UNIT_CONFLICT,
            `计数 Formula ${formula.node_id} 的 Metric unit 必须是 count。`,
            formula.node_id,
          ),
        );
      }
    }
    const referencedTables = new Set(
      formulaBindings
        .filter((edge) => edge.edge_type === "REFERENCES")
        .map((edge) => parentTableByColumn.get(edge.target_node_id))
        .filter((tableId): tableId is string => tableId !== undefined),
    );
    if (
      referencedTables.size > 1 &&
      metricNodes.some((metric) => metric.fanout_policy === "reject")
    ) {
      issues.push(
        issue(
          SemanticGraphErrorCode.FANOUT_CONFLICT,
          `Formula ${formula.node_id} 跨多个物理表，但 Metric fanout_policy=reject。`,
          formula.node_id,
          [...referencedTables],
        ),
      );
    }
  }

  const dependencyCycle = cycleNodes(activeEdges(graph, "DEPENDS_ON"));
  if (dependencyCycle.length > 0) {
    issues.push(
      issue(
        SemanticGraphErrorCode.FORMULA_DEPENDENCY_CYCLE,
        "Formula DEPENDS_ON 图存在环。",
        dependencyCycle[0],
        dependencyCycle,
      ),
    );
  }
  const rollupCycle = cycleNodes(activeEdges(graph, "ROLLS_UP_TO"));
  if (rollupCycle.length > 0) {
    issues.push(
      issue(
        SemanticGraphErrorCode.DIMENSION_HIERARCHY_CYCLE,
        "Dimension ROLLS_UP_TO 图存在环。",
        rollupCycle[0],
        rollupCycle,
      ),
    );
  }

  for (const dependency of activeEdges(graph, "DEPENDS_ON")) {
    const sourceGrain = activeEdges(graph, "AT_GRAIN").find(
      (edge) => edge.source_node_id === dependency.source_node_id,
    );
    const targetGrain = activeEdges(graph, "AT_GRAIN").find(
      (edge) => edge.source_node_id === dependency.target_node_id,
    );
    if (
      sourceGrain?.attributes.kind === "GRAIN_BINDING" &&
      targetGrain?.attributes.kind === "GRAIN_BINDING" &&
      sourceGrain.attributes.grain.grain_id !== targetGrain.attributes.grain.grain_id
    ) {
      issues.push(
        issue(
          SemanticGraphErrorCode.GRAIN_CONFLICT,
          `Formula dependency ${dependency.edge_id} 两端 grain 不一致。`,
          dependency.edge_id,
        ),
      );
    }
  }
  return issues;
}

function validateCompatibility(graph: SemanticGraphSource): SemanticGraphValidationIssue[] {
  const issues: SemanticGraphValidationIssue[] = [];
  for (const metric of graph.nodes.filter(
    (node) => node.node_type === "METRIC" && node.lifecycle === "ACTIVE",
  )) {
    const definitions = activeEdges(graph, "DEFINED_BY").filter(
      (edge) => edge.source_node_id === metric.node_id,
    );
    if (definitions.length !== 1) {
      issues.push(
        issue(
          definitions.length > 1
            ? SemanticGraphErrorCode.RUNTIME_COMPATIBILITY_AMBIGUOUS
            : SemanticGraphErrorCode.RUNTIME_COMPATIBILITY_UNSUPPORTED,
          `Metric ${metric.node_id} 必须且只能有一个 active DEFINED_BY Edge。`,
          metric.node_id,
        ),
      );
    }
  }
  for (const dimension of graph.nodes.filter(
    (node) => node.node_type === "DIMENSION" && node.lifecycle === "ACTIVE",
  )) {
    const primaryBindings = activeEdges(graph, "BOUND_TO").filter(
      (edge) =>
        edge.source_node_id === dimension.node_id &&
        edge.attributes.kind === "BINDING" &&
        edge.attributes.role === "PRIMARY",
    );
    const grains = activeEdges(graph, "AT_GRAIN").filter(
      (edge) => edge.source_node_id === dimension.node_id,
    );
    if (primaryBindings.length !== 1 || grains.length !== 1) {
      issues.push(
        issue(
          primaryBindings.length > 1 || grains.length > 1
            ? SemanticGraphErrorCode.RUNTIME_COMPATIBILITY_AMBIGUOUS
            : SemanticGraphErrorCode.RUNTIME_COMPATIBILITY_UNSUPPORTED,
          `Dimension ${dimension.node_id} 必须有唯一 primary BOUND_TO 和 AT_GRAIN Edge。`,
          dimension.node_id,
        ),
      );
    }
  }
  return issues;
}

export function validateSemanticGraph(input: unknown): SemanticGraphValidationIssue[] {
  const parsed = semanticGraphSourceSchema.safeParse(input);
  if (!parsed.success) {
    return [
      issue(
        SemanticGraphErrorCode.INVALID_GRAPH,
        "SemanticGraphSource@2 schema 校验失败。",
        undefined,
        parsed.error.issues.map((entry) => `${entry.path.join(".")}: ${entry.message}`),
      ),
    ];
  }
  const graph = parsed.data;
  const issues: SemanticGraphValidationIssue[] = [];
  const nodesById = new Map<string, SemanticGraphNode>();
  for (const node of graph.nodes) {
    if (nodesById.has(node.node_id)) {
      issues.push(
        issue(
          SemanticGraphErrorCode.DUPLICATE_IDENTITY,
          `Graph 中存在重复 Node ID ${node.node_id}。`,
          node.node_id,
        ),
      );
    }
    nodesById.set(node.node_id, node);
  }
  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.edge_id)) {
      issues.push(
        issue(
          SemanticGraphErrorCode.DUPLICATE_IDENTITY,
          `Graph 中存在重复 Edge ID ${edge.edge_id}。`,
          edge.edge_id,
        ),
      );
    }
    edgeIds.add(edge.edge_id);
  }
  const evidenceIds = new Set(graph.evidence.map((entry) => entry.evidence_id));
  for (const entry of [...graph.nodes, ...graph.edges]) {
    for (const evidenceRef of entry.evidence_refs) {
      if (!evidenceIds.has(evidenceRef)) {
        issues.push(
          issue(
            SemanticGraphErrorCode.EVIDENCE_NOT_FOUND,
            `${"node_id" in entry ? "Node" : "Edge"} evidence ref ${evidenceRef} 不存在。`,
            "node_id" in entry ? entry.node_id : entry.edge_id,
          ),
        );
      }
    }
  }
  issues.push(...validateRegistry(graph, nodesById));
  issues.push(...validatePhysicalStructure(graph, nodesById));
  issues.push(...validateFormulaSemantics(graph, nodesById));
  issues.push(...validateCompatibility(graph));
  return issues;
}

export const SEMANTIC_ONTOLOGY_COVERAGE_VALIDATOR_VERSION =
  "semantic-ontology-coverage-validator@1.0.0" as const;

function coverageIssue(
  code: SemanticOntologyCoverageIssue["code"],
  entryId: string,
  message: string,
  relatedEntryIds: readonly string[] = [],
): SemanticOntologyCoverageIssue {
  return {
    code,
    entry_id: entryId,
    message,
    related_entry_ids: [...new Set(relatedEntryIds)].sort(),
  };
}

function activeNodesOfType<T extends SemanticNodeType>(
  graph: SemanticGraphSource,
  nodeType: T,
): Extract<SemanticGraphNode, { node_type: T }>[] {
  return graph.nodes.filter(
    (node): node is Extract<SemanticGraphNode, { node_type: T }> =>
      node.lifecycle === "ACTIVE" && node.node_type === nodeType,
  );
}

function activeOutgoingEdges(
  graph: SemanticGraphSource,
  nodeId: string,
  edgeType: string,
): SemanticGraphEdge[] {
  return activeEdges(graph, edgeType).filter((edge) => edge.source_node_id === nodeId);
}

function activeIncomingEdges(
  graph: SemanticGraphSource,
  nodeId: string,
  edgeType: string,
): SemanticGraphEdge[] {
  return activeEdges(graph, edgeType).filter((edge) => edge.target_node_id === nodeId);
}

function isSafeJoinProof(edge: SemanticGraphEdge): boolean {
  return (
    edge.edge_type === "JOINABLE_VIA" &&
    edge.attributes.kind === "JOIN_PROOF" &&
    edge.attributes.proof_kind !== "DECLARED_ONLY" &&
    edge.evidence_refs.length > 0
  );
}

function reachableColumn(
  starts: ReadonlySet<string>,
  target: string,
  joinEdges: readonly SemanticGraphEdge[],
): boolean {
  if (starts.has(target)) return true;
  const adjacency = new Map<string, string[]>();
  for (const edge of joinEdges.filter(isSafeJoinProof)) {
    const sourceTargets = adjacency.get(edge.source_node_id) ?? [];
    sourceTargets.push(edge.target_node_id);
    adjacency.set(edge.source_node_id, sourceTargets);
    const targetSources = adjacency.get(edge.target_node_id) ?? [];
    targetSources.push(edge.source_node_id);
    adjacency.set(edge.target_node_id, targetSources);
  }
  const visited = new Set(starts);
  const queue = [...starts];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current === undefined) continue;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (neighbor === target) return true;
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return false;
}

/**
 * Strict ontology rollout gate. This deliberately goes beyond graph-schema validity:
 * an executable graph may be structurally valid while still omitting the relationships
 * needed to explain business meaning, formula context, and physical evidence.
 */
export function validateSemanticOntologyCoverage(input: unknown): SemanticOntologyCoverageIssue[] {
  const graph = semanticGraphSourceSchema.parse(input);
  const issues: SemanticOntologyCoverageIssue[] = [];
  const subjects = activeNodesOfType(graph, "BUSINESS_SUBJECT");
  const dimensions = activeNodesOfType(graph, "DIMENSION");
  const metrics = activeNodesOfType(graph, "METRIC");
  const formulas = activeNodesOfType(graph, "FORMULA");
  const glossaryTerms = activeNodesOfType(graph, "GLOSSARY_TERM");
  const containsEdges = activeEdges(graph, "CONTAINS_COLUMN");
  const joinEdges = activeEdges(graph, "JOINABLE_VIA");

  const tableColumns = new Map<string, Set<string>>();
  for (const edge of containsEdges) {
    const columns = tableColumns.get(edge.source_node_id) ?? new Set<string>();
    columns.add(edge.target_node_id);
    tableColumns.set(edge.source_node_id, columns);
  }

  for (const subject of subjects) {
    const businessRelations = activeEdges(graph, "RELATES_TO").filter(
      (edge) => edge.source_node_id === subject.node_id || edge.target_node_id === subject.node_id,
    );
    if (subjects.length > 1 && businessRelations.length === 0) {
      issues.push(
        coverageIssue(
          "SUBJECT_RELATION_MISSING",
          subject.node_id,
          `业务主体 ${subject.node_id} 未与其他业务主体建立显式 RELATES_TO。`,
        ),
      );
    }
    const dimensionEdges = activeOutgoingEdges(graph, subject.node_id, "HAS_DIMENSION");
    if (dimensionEdges.length === 0) {
      issues.push(
        coverageIssue(
          "SUBJECT_DIMENSION_MISSING",
          subject.node_id,
          `业务主体 ${subject.node_id} 缺少 HAS_DIMENSION。`,
        ),
      );
    }
    const represented = activeOutgoingEdges(graph, subject.node_id, "REPRESENTED_BY");
    if (represented.length === 0) {
      issues.push(
        coverageIssue(
          "SUBJECT_PHYSICAL_TABLE_MISSING",
          subject.node_id,
          `业务主体 ${subject.node_id} 缺少 REPRESENTED_BY 物理表映射。`,
        ),
      );
    }
    const identifiers = activeOutgoingEdges(graph, subject.node_id, "IDENTIFIED_BY");
    if (identifiers.length === 0) {
      issues.push(
        coverageIssue(
          "SUBJECT_IDENTIFIER_MISSING",
          subject.node_id,
          `业务主体 ${subject.node_id} 缺少 IDENTIFIED_BY 物理字段映射。`,
        ),
      );
    }
    const representedColumns = new Set(
      represented.flatMap((edge) => [...(tableColumns.get(edge.target_node_id) ?? [])]),
    );
    for (const identifier of identifiers) {
      if (!representedColumns.has(identifier.target_node_id)) {
        issues.push(
          coverageIssue(
            "SUBJECT_IDENTIFIER_OUTSIDE_TABLE",
            identifier.edge_id,
            `主体标识字段 ${identifier.target_node_id} 不属于该主体 REPRESENTED_BY 的物理表。`,
            [
              subject.node_id,
              identifier.target_node_id,
              ...represented.map((edge) => edge.target_node_id),
            ],
          ),
        );
      }
    }
  }

  for (const dimension of dimensions) {
    if (activeIncomingEdges(graph, dimension.node_id, "HAS_DIMENSION").length === 0) {
      issues.push(
        coverageIssue(
          "DIMENSION_SUBJECT_MISSING",
          dimension.node_id,
          `维度 ${dimension.node_id} 未关联任何业务主体。`,
        ),
      );
    }
    const primaryBindings = activeOutgoingEdges(graph, dimension.node_id, "BOUND_TO").filter(
      (edge) => edge.attributes.kind === "BINDING" && edge.attributes.role === "PRIMARY",
    );
    if (primaryBindings.length !== 1) {
      issues.push(
        coverageIssue(
          "DIMENSION_BINDING_MISSING",
          dimension.node_id,
          `维度 ${dimension.node_id} 必须且只能有一个 PRIMARY BOUND_TO 物理字段。`,
          primaryBindings.map((edge) => edge.edge_id),
        ),
      );
    }
  }

  for (const metric of metrics) {
    if (activeIncomingEdges(graph, metric.node_id, "HAS_METRIC").length === 0) {
      issues.push(
        coverageIssue(
          "METRIC_SUBJECT_MISSING",
          metric.node_id,
          `指标 ${metric.node_id} 未关联任何业务主体。`,
        ),
      );
    }
    if (activeOutgoingEdges(graph, metric.node_id, "DEFINED_BY").length !== 1) {
      issues.push(
        coverageIssue(
          "METRIC_FORMULA_MISSING",
          metric.node_id,
          `指标 ${metric.node_id} 必须且只能由一个 Formula 定义。`,
        ),
      );
    }
  }

  for (const formula of formulas) {
    const grainEdges = activeOutgoingEdges(graph, formula.node_id, "AT_GRAIN");
    if (grainEdges.length !== 1) {
      issues.push(
        coverageIssue(
          "FORMULA_SUBJECT_MISSING",
          formula.node_id,
          `公式 ${formula.node_id} 必须且只能关联一个计算主体。`,
          grainEdges.map((edge) => edge.target_node_id),
        ),
      );
    }
    if (activeOutgoingEdges(graph, formula.node_id, "USES_DIMENSION").length === 0) {
      issues.push(
        coverageIssue(
          "FORMULA_DIMENSION_MISSING",
          formula.node_id,
          `公式 ${formula.node_id} 缺少 USES_DIMENSION 上下文。`,
        ),
      );
    }
    const references = activeOutgoingEdges(graph, formula.node_id, "REFERENCES");
    if (references.length === 0) {
      issues.push(
        coverageIssue(
          "FORMULA_COLUMN_MISSING",
          formula.node_id,
          `公式 ${formula.node_id} 未引用任何物理字段。`,
        ),
      );
    }

    const subjectTableIds = new Set(
      grainEdges.flatMap((grain) =>
        activeOutgoingEdges(graph, grain.target_node_id, "REPRESENTED_BY").map(
          (edge) => edge.target_node_id,
        ),
      ),
    );
    const subjectColumns = new Set(
      [...subjectTableIds].flatMap((tableId) => [...(tableColumns.get(tableId) ?? [])]),
    );
    for (const reference of references) {
      if (
        subjectColumns.size > 0 &&
        !reachableColumn(subjectColumns, reference.target_node_id, joinEdges)
      ) {
        issues.push(
          coverageIssue(
            "FORMULA_REFERENCE_UNREACHABLE",
            reference.edge_id,
            `公式引用字段 ${reference.target_node_id} 无法从计算主体的物理表通过安全 Join 到达。`,
            [formula.node_id, reference.target_node_id, ...subjectTableIds],
          ),
        );
      }
    }
  }

  for (const edge of joinEdges) {
    if (!isSafeJoinProof(edge)) {
      issues.push(
        coverageIssue(
          "JOIN_PROOF_INSUFFICIENT",
          edge.edge_id,
          `分析 Join ${edge.edge_id} 缺少非 DECLARED_ONLY 的可验证证据。`,
          [edge.source_node_id, edge.target_node_id],
        ),
      );
    }
  }

  for (const term of glossaryTerms) {
    const terminologyLinks = activeEdges(graph).filter(
      (edge) =>
        edge.family === "TERMINOLOGY" &&
        (edge.source_node_id === term.node_id || edge.target_node_id === term.node_id),
    );
    if (terminologyLinks.length === 0) {
      issues.push(
        coverageIssue(
          "GLOSSARY_TERM_UNLINKED",
          term.node_id,
          `术语 ${term.node_id} 未通过 DENOTES/BROADER_THAN/RELATED_TERM 接入本体。`,
        ),
      );
    }
  }

  return issues.sort(
    (left, right) =>
      left.code.localeCompare(right.code) || left.entry_id.localeCompare(right.entry_id),
  );
}

function emptyCoverageNodeCounts(): Record<SemanticNodeType, number> {
  return {
    BUSINESS_SUBJECT: 0,
    DIMENSION: 0,
    METRIC: 0,
    FORMULA: 0,
    PHYSICAL_TABLE: 0,
    PHYSICAL_COLUMN: 0,
    GLOSSARY_TERM: 0,
  };
}

function emptyCoverageFamilyCounts(): Record<SemanticEdgeFamily, number> {
  return {
    BUSINESS: 0,
    ANALYTICAL: 0,
    FORMULA: 0,
    PHYSICAL: 0,
    JOIN: 0,
    PROVENANCE: 0,
    TERMINOLOGY: 0,
  };
}

export async function createSemanticOntologyCoverageReceipt(
  input: unknown,
  checkedAt: string,
): Promise<SemanticOntologyCoverageReceipt> {
  const graph = semanticGraphSourceSchema.parse(input);
  const issues = validateSemanticOntologyCoverage(graph);
  const activeNodeCounts = emptyCoverageNodeCounts();
  for (const node of graph.nodes) {
    if (node.lifecycle === "ACTIVE") activeNodeCounts[node.node_type] += 1;
  }
  const activeEdgeFamilyCounts = emptyCoverageFamilyCounts();
  for (const edge of graph.edges) {
    if (edge.lifecycle === "ACTIVE") activeEdgeFamilyCounts[edge.family] += 1;
  }
  const body = {
    receipt_version: SEMANTIC_ONTOLOGY_COVERAGE_RECEIPT_VERSION,
    graph_id: graph.metadata.graph_id,
    source_digest: await computeSemanticGraphDigest(graph),
    validator_version: SEMANTIC_ONTOLOGY_COVERAGE_VALIDATOR_VERSION,
    valid: issues.length === 0,
    checked_at: checkedAt,
    active_node_counts: activeNodeCounts,
    active_edge_family_counts: activeEdgeFamilyCounts,
    issues,
  } as const;
  return semanticOntologyCoverageReceiptSchema.parse({
    ...body,
    receipt_digest: await sha256ContentHash(body),
  });
}
