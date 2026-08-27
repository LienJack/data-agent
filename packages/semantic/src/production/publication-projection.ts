import { createHash } from "node:crypto";
import {
  formulaNodeSchema,
  physicalBindingEntrySchema,
  SEMANTIC_FORMULA_AST_V2_VERSION,
  type SemanticAssertionCandidate,
  type SemanticChangeSet,
  type SemanticGraphEdge,
  type SemanticGraphNode,
  semanticDimensionSchema,
  semanticGraphProjectionSchema,
  semanticMetricSchema,
  semanticRelationshipSchema,
  timeDomainSchema,
} from "@data-agent/contracts/artifacts";
import {
  type PhysicalSchemaSnapshot,
  physicalSchemaSnapshotSchema,
} from "@data-agent/contracts/catalog";
import { sha256ContentHash } from "@data-agent/contracts/common";
import { z } from "zod";

export const semanticExecutablePublicationProjectionSchema = z.strictObject({
  schema_version: z.literal("semantic-executable-projection@1.0.0"),
  metrics: z.array(semanticMetricSchema),
  dimensions: z.array(semanticDimensionSchema),
  formulas: z.array(formulaNodeSchema),
  physical_bindings: z.array(physicalBindingEntrySchema),
});

export const semanticRelationshipPublicationProjectionSchema = z.strictObject({
  schema_version: z.literal("semantic-relationship-projection@1.0.0"),
  relationships: z.array(semanticRelationshipSchema),
});

export const semanticQualityConstraintPublicationSchema = z.strictObject({
  constraint_id: z.string().min(1).max(256),
  expression: z.string().min(1).max(4096),
  severity: z.enum(["WARN", "ERROR"]),
  sensitivity: z.enum(["PUBLIC", "INTERNAL", "RESTRICTED", "SECRET"]),
});

export const semanticRuntimeRestrictionPublicationProjectionSchema = z.strictObject({
  schema_version: z.literal("semantic-runtime-restriction-projection@1.0.0"),
  quality_constraints: z.array(semanticQualityConstraintPublicationSchema),
  time_semantics: z.array(timeDomainSchema),
});

export type SemanticExecutablePublicationProjection = z.infer<
  typeof semanticExecutablePublicationProjectionSchema
>;
export type SemanticRelationshipPublicationProjection = z.infer<
  typeof semanticRelationshipPublicationProjectionSchema
>;
export type SemanticRuntimeRestrictionPublicationProjection = z.infer<
  typeof semanticRuntimeRestrictionPublicationProjectionSchema
>;

export interface SemanticPublicationProjection {
  readonly release_id: string;
  readonly source_revision_id: string;
  readonly candidate_revision_id: string;
  readonly validation_receipt_id: string;
  readonly publish_attempt_id: string;
  readonly executable_projection_id: string;
  readonly relationship_projection_id: string;
  readonly restriction_projection_id: string;
  readonly graph_projection_id: string;
  readonly review_decision_id: string;
  readonly outbox_event_id: string;
  readonly compiler_bundle_digest: `sha256:${string}`;
  readonly executable_projection_digest: `sha256:${string}`;
  readonly relationship_projection_digest: `sha256:${string}`;
  readonly restriction_projection_digest: `sha256:${string}`;
  readonly graph_projection_digest: `sha256:${string}`;
  readonly release_digest: `sha256:${string}`;
  readonly executable_projection: SemanticExecutablePublicationProjection;
  readonly relationship_projection: SemanticRelationshipPublicationProjection;
  readonly restriction_projection: SemanticRuntimeRestrictionPublicationProjection;
  readonly graph_projection: ReturnType<typeof semanticGraphProjectionSchema.parse>;
  readonly binding_impact_hashes: readonly string[];
}

export interface SemanticPublicationProjectionContext {
  readonly source_snapshot: PhysicalSchemaSnapshot;
}

export const SEMANTIC_PUBLICATION_COMPILER_VERSION = "semantic-change-set-publication@3" as const;

export async function semanticPublicationCompilerBundleDigest(): Promise<`sha256:${string}`> {
  return sha256ContentHash({
    compiler_version: SEMANTIC_PUBLICATION_COMPILER_VERSION,
    source_contract: "semantic-change-set@1.0.0",
    physical_snapshot_contract: "physical-schema-snapshot@1.0.0",
    formula_ast_contract: SEMANTIC_FORMULA_AST_V2_VERSION,
    runtime_closure_contract: "semantic-successor-runtime-closure@1.0.0",
  });
}

type DimensionAnalysis = Extract<SemanticGraphNode, { node_type: "DIMENSION" }>["analysis"];
type MetricAnalysis = Extract<SemanticGraphNode, { node_type: "METRIC" }>["analysis"];

function stableUuid(material: string): string {
  const digits = createHash("sha256").update(material).digest("hex").slice(0, 32).split("");
  digits[12] = "5";
  digits[16] = ((Number.parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = digits.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function assertionsOfKind(changeSet: SemanticChangeSet, targetKind: string) {
  return changeSet.assertions.filter(({ target_kind: kind }) => kind === targetKind);
}

type PhysicalBinding = ReturnType<typeof physicalBindingEntrySchema.parse>;

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function columnIdentifierMatches(
  binding: PhysicalBinding,
  tableId: string,
  columnId: string,
): boolean {
  if (binding.logical_object_type !== "column" || binding.column_name === null) return false;
  return (
    binding.table_name === tableId &&
    (binding.column_name === columnId ||
      `${binding.table_name}.${binding.column_name}` === columnId ||
      binding.logical_object_id === columnId ||
      binding.logical_object_id === `column.${columnId}`)
  );
}

function tableIdentifierMatches(binding: PhysicalBinding, tableId: string): boolean {
  return (
    binding.logical_object_type === "table" &&
    binding.column_name === null &&
    (binding.table_name === tableId ||
      binding.logical_object_id === tableId ||
      binding.logical_object_id === `table.${tableId}`)
  );
}

function activeSourceBindings(changeSet: SemanticChangeSet): PhysicalBinding[] {
  return assertionsOfKind(changeSet, "PHYSICAL_BINDING")
    .map(({ assertion_payload }) => physicalBindingEntrySchema.parse(assertion_payload.binding))
    .filter(({ binding_lifecycle }) => binding_lifecycle === "active")
    .sort((left, right) =>
      compareStable(
        `${left.logical_object_type}\u0000${left.logical_object_id}`,
        `${right.logical_object_type}\u0000${right.logical_object_id}`,
      ),
    );
}

function executableBindings(
  changeSet: SemanticChangeSet,
  metrics: SemanticPublicationProjection["executable_projection"]["metrics"],
  dimensions: SemanticPublicationProjection["executable_projection"]["dimensions"],
): PhysicalBinding[] {
  const sourceBindings = activeSourceBindings(changeSet);
  const derived = [
    ...metrics.map((metric) => {
      const source = sourceBindings.find((binding) =>
        columnIdentifierMatches(binding, metric.table_id, metric.column_id),
      );
      if (!source)
        throw new TypeError(`SEMANTIC_COMPILER_METRIC_BINDING_MISSING:${metric.metric_id}`);
      return physicalBindingEntrySchema.parse({
        ...source,
        logical_object_id: metric.metric_id,
        logical_object_type: "metric",
      });
    }),
    ...dimensions.map((dimension) => {
      const source = sourceBindings.find((binding) =>
        columnIdentifierMatches(binding, dimension.table_id, dimension.column_id),
      );
      if (!source) {
        throw new TypeError(
          `SEMANTIC_COMPILER_DIMENSION_BINDING_MISSING:${dimension.dimension_id}`,
        );
      }
      return physicalBindingEntrySchema.parse({
        ...source,
        logical_object_id: dimension.dimension_id,
        logical_object_type: "dimension",
      });
    }),
  ];
  const unique = new Map<string, PhysicalBinding>();
  for (const binding of [...sourceBindings, ...derived]) {
    const key = `${binding.logical_object_type}\u0000${binding.logical_object_id}`;
    const existing = unique.get(key);
    if (existing && JSON.stringify(existing) !== JSON.stringify(binding)) {
      throw new TypeError(`SEMANTIC_COMPILER_BINDING_CONFLICT:${binding.logical_object_id}`);
    }
    unique.set(key, binding);
  }
  return [...unique.values()].sort((left, right) =>
    compareStable(
      `${left.logical_object_type}\u0000${left.logical_object_id}`,
      `${right.logical_object_type}\u0000${right.logical_object_id}`,
    ),
  );
}

function semanticDataType(
  formattedType: string,
): Extract<SemanticGraphNode, { node_type: "PHYSICAL_COLUMN" }>["data_type"] {
  const type = formattedType.trim().toLocaleLowerCase();
  if (/^(?:bool|boolean)$/u.test(type)) return "boolean";
  if (/^date$/u.test(type)) return "date";
  if (/^(?:smallint|integer|bigint|int2|int4|int8)$/u.test(type)) return "integer";
  if (/^(?:numeric|decimal|real|double precision|money)(?:\(|$)/u.test(type)) return "numeric";
  if (/^uuid$/u.test(type)) return "uuid";
  if (/^(?:timestamp with time zone|timestamptz)(?:\(|$)/u.test(type)) return "timestamptz";
  if (/^(?:timestamp without time zone|timestamp)(?:\(|$)/u.test(type)) return "timestamp";
  return "text";
}

function relationKind(
  kind: PhysicalSchemaSnapshot["content"]["relations"][number]["relation_kind"],
): Extract<SemanticGraphNode, { node_type: "PHYSICAL_TABLE" }>["relation_kind"] {
  if (kind === "VIEW") return "VIEW";
  if (kind === "MATERIALIZED_VIEW") return "MATERIALIZED_VIEW";
  return "TABLE";
}

function collectFormulaSlots(
  expression: Extract<SemanticGraphNode, { node_type: "FORMULA" }>["expression"],
  slots: Set<string>,
): void {
  switch (expression.kind) {
    case "LITERAL":
      return;
    case "SLOT":
      slots.add(expression.slot_id);
      return;
    case "BINARY":
      collectFormulaSlots(expression.left, slots);
      collectFormulaSlots(expression.right, slots);
      return;
    case "BOOLEAN":
      for (const operand of expression.operands) collectFormulaSlots(operand, slots);
      return;
    case "NOT":
      collectFormulaSlots(expression.operand, slots);
      return;
    case "CASE":
      for (const branch of expression.branches) {
        collectFormulaSlots(branch.when, slots);
        collectFormulaSlots(branch.result, slots);
      }
      if (expression.otherwise) collectFormulaSlots(expression.otherwise, slots);
      return;
    case "AGGREGATE":
      if (expression.input) collectFormulaSlots(expression.input, slots);
      if (expression.filter) collectFormulaSlots(expression.filter, slots);
      return;
    case "DATE_BUCKET":
      collectFormulaSlots(expression.input, slots);
      return;
    case "GROUP_COUNT":
      for (const group of expression.group_by) collectFormulaSlots(group, slots);
      collectFormulaSlots(expression.having, slots);
  }
}

function projectionNode(assertion: SemanticAssertionCandidate): SemanticGraphNode | null {
  const tags = ["published-change-set", `assertion-kind:${assertion.target_kind}`].sort();
  if (assertion.target_kind === "BUSINESS_ENTITY_TYPE") {
    const entity = assertion.assertion_payload.entity as {
      name: string;
      description?: string;
      aliases: string[];
      domain: string;
    };
    return {
      node_id: assertion.canonical_key,
      node_version: 1,
      node_type: "BUSINESS_SUBJECT",
      name: entity.name,
      description: entity.description,
      aliases: [...entity.aliases].sort(),
      owner_ref: "semantic-publication-authority",
      lifecycle: "ACTIVE",
      evidence_refs: [],
      tags,
      domain: entity.domain,
    };
  }
  if (assertion.target_kind === "DIMENSION") {
    const dimension = assertion.assertion_payload.dimension as Record<string, unknown>;
    return {
      node_id: assertion.canonical_key,
      node_version: 1,
      node_type: "DIMENSION",
      name: String(dimension.name),
      aliases: [...(dimension.aliases as string[])].sort(),
      owner_ref: "semantic-publication-authority",
      lifecycle: "ACTIVE",
      evidence_refs: [],
      tags,
      data_type: dimension.data_type as "date" | "text",
      sensitivity: dimension.sensitivity as "INTERNAL",
      filter_semantics: dimension.data_type === "date" ? "TEMPORAL" : "EXACT",
      analysis: dimension.analysis as DimensionAnalysis,
    };
  }
  if (assertion.target_kind === "METRIC") {
    const metric = assertion.assertion_payload.metric as Record<string, unknown>;
    return {
      node_id: assertion.canonical_key,
      node_version: 1,
      node_type: "METRIC",
      name: String(metric.name),
      aliases: [...(metric.aliases as string[])].sort(),
      owner_ref: "semantic-publication-authority",
      lifecycle: "ACTIVE",
      evidence_refs: [],
      tags,
      unit: metric.unit as null,
      additivity: metric.additivity as "additive" | "non-additive",
      null_policy: metric.null_policy as "exclude",
      fanout_policy: metric.fanout_policy as "preaggregate",
      analysis: metric.analysis as MetricAnalysis,
    };
  }
  if (assertion.target_kind === "FORMULA") {
    const formula = assertion.assertion_payload.formula as SemanticGraphNode;
    return { ...formula, tags: [...new Set([...formula.tags, ...tags])].sort() };
  }
  if (
    assertion.target_kind === "RELATIONSHIP" ||
    assertion.target_kind === "QUALITY_CONSTRAINT" ||
    assertion.target_kind === "TIME_SEMANTICS"
  ) {
    const material = assertion.assertion_payload as Record<string, unknown>;
    const name =
      assertion.target_kind === "RELATIONSHIP"
        ? String((material.relationship as { name: string }).name)
        : assertion.target_kind === "QUALITY_CONSTRAINT"
          ? String(material.constraint_id)
          : String((material.time_domain as { time_domain_id: string }).time_domain_id);
    return {
      node_id: assertion.canonical_key,
      node_version: 1,
      node_type: "BUSINESS_SUBJECT",
      name,
      aliases: [],
      owner_ref: "semantic-publication-authority",
      lifecycle: "ACTIVE",
      evidence_refs: [],
      tags,
      domain: assertion.scope.semantic_domain,
    };
  }
  return null;
}

function lineageEdges(changeSet: SemanticChangeSet): SemanticGraphEdge[] {
  return assertionsOfKind(changeSet, "BUSINESS_ENTITY_TYPE").flatMap((assertion) => {
    const entity = assertion.assertion_payload.entity as {
      business_relationship_types: Array<{
        relationship_type: string;
        target_entity_id: string;
      }>;
    };
    return entity.business_relationship_types.map((relationship, index) => ({
      edge_id: `lineage.${assertion.canonical_key.slice(5)}.${String(index + 1).padStart(2, "0")}`,
      edge_version: 1,
      edge_type: relationship.relationship_type,
      family: "PROVENANCE" as const,
      source_node_id: assertion.canonical_key,
      target_node_id: relationship.target_entity_id,
      lifecycle: "ACTIVE" as const,
      attributes: {
        kind: "PROVENANCE" as const,
        derivation_kind: "SUPPORTED" as const,
        note: "Published competency case mandatory semantic closure.",
      },
      evidence_refs: [],
    }));
  });
}

function physicalGraphMaterial(
  input: Readonly<{
    change_set: SemanticChangeSet;
    snapshot: PhysicalSchemaSnapshot;
    executable: SemanticExecutablePublicationProjection;
    relationships: SemanticRelationshipPublicationProjection;
    semantic_nodes: readonly SemanticGraphNode[];
  }>,
): Readonly<{ nodes: SemanticGraphNode[]; edges: SemanticGraphEdge[] }> {
  const sourceBindings = activeSourceBindings(input.change_set);
  if (
    sourceBindings.length === 0 ||
    sourceBindings.some((binding) => binding.datasource_id !== input.snapshot.content.datasource_id)
  ) {
    throw new TypeError("SEMANTIC_COMPILER_SNAPSHOT_DATASOURCE_MISMATCH");
  }
  const tableBindings = sourceBindings.filter(
    (binding) => binding.logical_object_type === "table" && binding.column_name === null,
  );
  const columnBindings = sourceBindings.filter(
    (binding) => binding.logical_object_type === "column" && binding.column_name !== null,
  );
  const relationFor = (binding: PhysicalBinding) =>
    input.snapshot.content.relations.find(
      (relation) =>
        relation.identity.schema_name === binding.schema_name &&
        relation.identity.relation_name === binding.table_name,
    );
  const tableNodeByLocation = new Map<string, string>();
  const columnNodeByLocation = new Map<string, string>();
  const physicalNodes: SemanticGraphNode[] = [];
  const physicalEdges: SemanticGraphEdge[] = [];
  for (const binding of tableBindings) {
    const relation = relationFor(binding);
    if (!relation) {
      throw new TypeError(`SEMANTIC_COMPILER_SNAPSHOT_TABLE_MISSING:${binding.logical_object_id}`);
    }
    const location = `${binding.schema_name}\u0000${binding.table_name}`;
    if (tableNodeByLocation.has(location)) {
      throw new TypeError(`SEMANTIC_COMPILER_TABLE_BINDING_AMBIGUOUS:${binding.table_name}`);
    }
    tableNodeByLocation.set(location, binding.logical_object_id);
    physicalNodes.push({
      node_id: binding.logical_object_id,
      node_version: 1,
      node_type: "PHYSICAL_TABLE",
      name: `${binding.schema_name}.${binding.table_name}`,
      ...(relation.comment === null ? {} : { description: relation.comment }),
      aliases: [],
      owner_ref: "semantic-publication-authority",
      lifecycle: "ACTIVE",
      evidence_refs: [],
      tags: ["schema-snapshot"],
      schema_snapshot_id: input.snapshot.snapshot_id,
      snapshot_content_hash: input.snapshot.snapshot_content_hash,
      datasource_id: input.snapshot.content.datasource_id,
      schema_name: binding.schema_name,
      table_name: binding.table_name,
      relation_kind: relationKind(relation.relation_kind),
    });
  }
  for (const binding of columnBindings) {
    const relation = relationFor(binding);
    const column = relation?.columns.find(({ column_name }) => column_name === binding.column_name);
    const tableLocation = `${binding.schema_name}\u0000${binding.table_name}`;
    const tableNodeId = tableNodeByLocation.get(tableLocation);
    if (!relation || !column || !tableNodeId || binding.column_name === null) {
      throw new TypeError(`SEMANTIC_COMPILER_SNAPSHOT_COLUMN_MISSING:${binding.logical_object_id}`);
    }
    const columnLocation = `${tableLocation}\u0000${binding.column_name}`;
    if (columnNodeByLocation.has(columnLocation)) {
      throw new TypeError(
        `SEMANTIC_COMPILER_COLUMN_BINDING_AMBIGUOUS:${binding.logical_object_id}`,
      );
    }
    columnNodeByLocation.set(columnLocation, binding.logical_object_id);
    physicalNodes.push({
      node_id: binding.logical_object_id,
      node_version: 1,
      node_type: "PHYSICAL_COLUMN",
      name: `${binding.schema_name}.${binding.table_name}.${binding.column_name}`,
      ...(column.comment === null ? {} : { description: column.comment }),
      aliases: [],
      owner_ref: "semantic-publication-authority",
      lifecycle: "ACTIVE",
      evidence_refs: [],
      tags: ["schema-snapshot"],
      schema_snapshot_id: input.snapshot.snapshot_id,
      snapshot_content_hash: input.snapshot.snapshot_content_hash,
      datasource_id: input.snapshot.content.datasource_id,
      schema_name: binding.schema_name,
      table_name: binding.table_name,
      column_name: binding.column_name,
      ordinal: column.ordinal_position,
      formatted_type: column.formatted_type,
      data_type: semanticDataType(column.formatted_type),
      nullable: column.nullable,
      sensitivity: "PUBLIC",
    });
    physicalEdges.push({
      edge_id: `contains.${binding.logical_object_id}`,
      edge_version: 1,
      edge_type: "CONTAINS_COLUMN",
      family: "PHYSICAL",
      source_node_id: tableNodeId,
      target_node_id: binding.logical_object_id,
      lifecycle: "ACTIVE",
      attributes: {
        kind: "PHYSICAL_FACT",
        schema_snapshot_id: input.snapshot.snapshot_id,
        snapshot_content_hash: input.snapshot.snapshot_content_hash,
        fact_kind: "CONTAINS_COLUMN",
      },
      evidence_refs: [],
    });
  }

  const semanticNodes = new Map(input.semantic_nodes.map((node) => [node.node_id, node]));
  const columnNodeFor = (tableId: string, columnId: string): string | undefined => {
    const binding = columnBindings.find((candidate) =>
      columnIdentifierMatches(candidate, tableId, columnId),
    );
    return binding?.logical_object_id;
  };
  const tableNodeFor = (tableId: string): string | undefined =>
    tableBindings.find((candidate) => tableIdentifierMatches(candidate, tableId))
      ?.logical_object_id;

  const formulaEdges: SemanticGraphEdge[] = [];
  const formulasById = new Map(
    input.executable.formulas.map((formula) => [formula.node_id, formula]),
  );
  for (const metric of input.executable.metrics) {
    if (metric.formula === null) continue;
    const formula = formulasById.get(metric.formula.formula_id);
    if (!formula) continue;
    const slots = new Set<string>();
    collectFormulaSlots(formula.expression, slots);
    for (const slotId of [...slots].sort(compareStable)) {
      const physicalTarget = columnNodeFor(metric.table_id, slotId);
      const logicalTarget = [slotId, `metric.${slotId}`, `formula.${slotId}`].find((candidate) =>
        semanticNodes.has(candidate),
      );
      const targetNodeId = physicalTarget ?? logicalTarget;
      if (!targetNodeId) continue;
      formulaEdges.push({
        edge_id: `slot.${formula.node_id}.${slotId}`,
        edge_version: 1,
        edge_type: physicalTarget ? "REFERENCES" : "DEPENDS_ON",
        family: "FORMULA",
        source_node_id: formula.node_id,
        target_node_id: targetNodeId,
        lifecycle: "ACTIVE",
        attributes: {
          kind: "SLOT_BINDING",
          slot_id: slotId,
          role: physicalTarget ? "MEASURE" : "DEPENDENCY",
        },
        evidence_refs: [],
      });
    }
  }

  const joinEdges: SemanticGraphEdge[] = input.relationships.relationships.map((relationship) => {
    const sourceNodeId = tableNodeFor(relationship.left_table_id);
    const targetNodeId = tableNodeFor(relationship.right_table_id);
    if (!sourceNodeId || !targetNodeId) {
      throw new TypeError(
        `SEMANTIC_COMPILER_RELATIONSHIP_TABLE_MISSING:${relationship.relationship_id}`,
      );
    }
    return {
      edge_id: relationship.relationship_id,
      edge_version: 1,
      edge_type: "ANALYTICAL_JOIN",
      family: "JOIN",
      source_node_id: sourceNodeId,
      target_node_id: targetNodeId,
      lifecycle: "ACTIVE",
      attributes: {
        kind: "JOIN_PROOF",
        cardinality: relationship.cardinality,
        left_row_preservation: relationship.left_row_preservation,
        right_row_preservation: relationship.right_row_preservation,
        proof_kind: relationship.proof_kind,
        proof_detail: relationship.proof_detail,
        analysis: relationship.analysis,
      },
      evidence_refs: [],
    };
  });
  return {
    nodes: physicalNodes,
    edges: [...physicalEdges, ...formulaEdges, ...joinEdges],
  };
}

export async function compileSemanticPublicationProjection(
  changeSet: SemanticChangeSet,
  context?: SemanticPublicationProjectionContext,
): Promise<SemanticPublicationProjection> {
  const snapshot = context
    ? physicalSchemaSnapshotSchema.parse(context.source_snapshot)
    : undefined;
  if (snapshot && (await sha256ContentHash(snapshot.content)) !== snapshot.snapshot_content_hash) {
    throw new TypeError("SEMANTIC_COMPILER_SNAPSHOT_HASH_MISMATCH");
  }
  const compilationIdentity = snapshot
    ? `${changeSet.change_set_hash}:${snapshot.snapshot_content_hash}`
    : changeSet.change_set_hash;
  const identifier = (kind: string) => stableUuid(`${compilationIdentity}:${kind}`);
  const executableMaterial = semanticExecutablePublicationProjectionSchema.parse({
    schema_version: "semantic-executable-projection@1.0.0" as const,
    metrics: assertionsOfKind(changeSet, "METRIC").map(
      ({ assertion_payload }) => assertion_payload.metric,
    ),
    dimensions: assertionsOfKind(changeSet, "DIMENSION").map(
      ({ assertion_payload }) => assertion_payload.dimension,
    ),
    formulas: assertionsOfKind(changeSet, "FORMULA").map(
      ({ assertion_payload }) => assertion_payload.formula,
    ),
    physical_bindings: assertionsOfKind(changeSet, "PHYSICAL_BINDING").map(
      ({ assertion_payload }) => assertion_payload.binding,
    ),
  });
  const executableProjection = semanticExecutablePublicationProjectionSchema.parse({
    ...executableMaterial,
    physical_bindings: snapshot
      ? executableBindings(changeSet, executableMaterial.metrics, executableMaterial.dimensions)
      : executableMaterial.physical_bindings,
  });
  const relationshipProjection = semanticRelationshipPublicationProjectionSchema.parse({
    schema_version: "semantic-relationship-projection@1.0.0" as const,
    relationships: ["RELATIONSHIP", "ANALYSIS_JOIN"].flatMap((kind) =>
      assertionsOfKind(changeSet, kind).map(
        ({ assertion_payload }) => assertion_payload.relationship,
      ),
    ),
  });
  const restrictionProjection = semanticRuntimeRestrictionPublicationProjectionSchema.parse({
    schema_version: "semantic-runtime-restriction-projection@1.0.0" as const,
    quality_constraints: assertionsOfKind(changeSet, "QUALITY_CONSTRAINT").map(
      ({ assertion_payload }) => assertion_payload,
    ),
    time_semantics: assertionsOfKind(changeSet, "TIME_SEMANTICS").map(
      ({ assertion_payload }) => assertion_payload.time_domain,
    ),
  });
  const semanticNodes = changeSet.assertions
    .map(projectionNode)
    .filter((node): node is SemanticGraphNode => node !== null)
    .sort((left, right) => left.node_id.localeCompare(right.node_id));
  const physical = snapshot
    ? physicalGraphMaterial({
        change_set: changeSet,
        snapshot,
        executable: executableProjection,
        relationships: relationshipProjection,
        semantic_nodes: semanticNodes,
      })
    : { nodes: [] as SemanticGraphNode[], edges: [] as SemanticGraphEdge[] };
  const nodes = [...semanticNodes, ...physical.nodes].sort((left, right) =>
    left.node_id.localeCompare(right.node_id),
  );
  const edges = [...lineageEdges(changeSet), ...physical.edges].sort((left, right) =>
    left.edge_id.localeCompare(right.edge_id),
  );
  const registryDigest = await sha256ContentHash({
    node_types: [...new Set(nodes.map(({ node_type }) => node_type))].sort(),
    edge_types: [...new Set(edges.map(({ edge_type }) => edge_type))].sort(),
  });
  const graphProjection = semanticGraphProjectionSchema.parse({
    projection_version: "semantic-graph-projection@1",
    graph_id: stableUuid(`${compilationIdentity}:graph`),
    source_digest: changeSet.change_set_hash,
    registry_digest: registryDigest,
    compiler_version: snapshot
      ? SEMANTIC_PUBLICATION_COMPILER_VERSION
      : "semantic-change-set-publication@1",
    node_count: nodes.length,
    edge_count: edges.length,
    nodes,
    edges,
  });
  const [
    compilerBundleDigest,
    executableDigest,
    relationshipDigest,
    restrictionDigest,
    graphDigest,
  ] = await Promise.all([
    snapshot
      ? semanticPublicationCompilerBundleDigest()
      : sha256ContentHash({
          compiler_version: graphProjection.compiler_version,
          registry_digest: registryDigest,
        }),
    sha256ContentHash(executableProjection),
    sha256ContentHash(relationshipProjection),
    sha256ContentHash(restrictionProjection),
    sha256ContentHash(graphProjection),
  ]);
  const releaseDigest = await sha256ContentHash({
    change_set_hash: changeSet.change_set_hash,
    generation: changeSet.base_release.generation + 1,
    compiler_bundle_digest: compilerBundleDigest,
    executable_projection_digest: executableDigest,
    relationship_projection_digest: relationshipDigest,
    restriction_projection_digest: restrictionDigest,
    graph_projection_digest: graphDigest,
  });
  return Object.freeze({
    release_id: identifier("release"),
    source_revision_id: identifier("source-revision"),
    candidate_revision_id: identifier("candidate-revision"),
    validation_receipt_id: identifier("validation-receipt"),
    publish_attempt_id: identifier("publish-attempt"),
    executable_projection_id: identifier("executable-projection"),
    relationship_projection_id: identifier("relationship-projection"),
    restriction_projection_id: identifier("restriction-projection"),
    graph_projection_id: identifier("graph-projection"),
    review_decision_id: identifier("review-decision"),
    outbox_event_id: identifier("outbox-event"),
    compiler_bundle_digest: compilerBundleDigest,
    executable_projection_digest: executableDigest,
    relationship_projection_digest: relationshipDigest,
    restriction_projection_digest: restrictionDigest,
    graph_projection_digest: graphDigest,
    release_digest: releaseDigest,
    executable_projection: executableProjection,
    relationship_projection: relationshipProjection,
    restriction_projection: restrictionProjection,
    graph_projection: graphProjection,
    binding_impact_hashes: assertionsOfKind(changeSet, "PHYSICAL_BINDING")
      .map(({ assertion_hash }) => assertion_hash)
      .sort(),
  });
}
