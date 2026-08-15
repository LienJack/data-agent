import {
  type SemanticFormulaExpression,
  type SemanticGraphEdge,
  type SemanticGraphNode,
  type SemanticGraphSource,
  semanticGraphSourceSchema,
} from "@data-agent/contracts";
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
