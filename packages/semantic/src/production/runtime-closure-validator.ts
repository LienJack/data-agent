import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import {
  buildSemanticRuntimeClosureValidationReceipt,
  type SemanticFormulaExpression,
  type SemanticRuntimeClosureValidationReceipt,
  type SemanticSuccessorStage,
  semanticGraphProjectionSchema,
  semanticSuccessorStageEnvelopeSchema,
  verifySemanticSuccessorStage,
} from "@data-agent/contracts/artifacts";
import { canonicalizeJson, deepFreeze, sha256ContentHash } from "@data-agent/contracts/common";
import {
  type SemanticExecutablePublicationProjection,
  type SemanticRelationshipPublicationProjection,
  type SemanticRuntimeRestrictionPublicationProjection,
  semanticExecutablePublicationProjectionSchema,
  semanticRelationshipPublicationProjectionSchema,
  semanticRuntimeRestrictionPublicationProjectionSchema,
} from "./publication-projection.js";

const VALIDATOR_VERSION = "semantic-runtime-closure-validator@1.0.0" as const;
const MAX_INPUT_DEPTH = 128;
const MAX_INPUT_NODES = 100_000;
const MAX_CONTAINER_ENTRIES = 20_000;
const verifiedSemanticReleaseEnvelopes = new WeakSet<object>();

type InertJson =
  | null
  | boolean
  | number
  | string
  | readonly InertJson[]
  | { [key: string]: InertJson };

interface InertProjectionBudget {
  nodes: number;
}

function projectInertJson(
  input: unknown,
  active: WeakSet<object>,
  budget: InertProjectionBudget,
  depth: number,
): InertJson {
  budget.nodes += 1;
  if (budget.nodes > MAX_INPUT_NODES || depth > MAX_INPUT_DEPTH) {
    throw new TypeError("SEMANTIC_RELEASE_ENVELOPE_INVALID");
  }
  if (input === null || typeof input === "boolean" || typeof input === "string") return input;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new TypeError("SEMANTIC_RELEASE_ENVELOPE_INVALID");
    return input;
  }
  if (typeof input !== "object" || isProxy(input)) {
    throw new TypeError("SEMANTIC_RELEASE_ENVELOPE_INVALID");
  }
  if (active.has(input)) throw new TypeError("SEMANTIC_RELEASE_ENVELOPE_INVALID");
  const prototype = Object.getPrototypeOf(input);
  const array = Array.isArray(input);
  if (
    (array && prototype !== Array.prototype) ||
    (!array && prototype !== Object.prototype && prototype !== null)
  ) {
    throw new TypeError("SEMANTIC_RELEASE_ENVELOPE_INVALID");
  }
  const keys = Reflect.ownKeys(input);
  if (keys.length > MAX_CONTAINER_ENTRIES || keys.some((key) => typeof key !== "string")) {
    throw new TypeError("SEMANTIC_RELEASE_ENVELOPE_INVALID");
  }
  active.add(input);
  try {
    if (array) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
      const length = lengthDescriptor?.value;
      if (
        !lengthDescriptor ||
        !("value" in lengthDescriptor) ||
        typeof length !== "number" ||
        !Number.isSafeInteger(length) ||
        length < 0 ||
        length > MAX_CONTAINER_ENTRIES
      ) {
        throw new TypeError("SEMANTIC_RELEASE_ENVELOPE_INVALID");
      }
      const result: InertJson[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
        if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
          throw new TypeError("SEMANTIC_RELEASE_ENVELOPE_INVALID");
        }
        result.push(projectInertJson(descriptor.value, active, budget, depth + 1));
      }
      if (keys.some((key) => key !== "length" && !/^(?:0|[1-9][0-9]*)$/u.test(String(key)))) {
        throw new TypeError("SEMANTIC_RELEASE_ENVELOPE_INVALID");
      }
      return result;
    }
    const result: Record<string, InertJson> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
        throw new TypeError("SEMANTIC_RELEASE_ENVELOPE_INVALID");
      }
      Object.defineProperty(result, key, {
        value: projectInertJson(descriptor.value, active, budget, depth + 1),
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return result;
  } finally {
    active.delete(input);
  }
}

function inertJson(input: unknown): InertJson {
  return projectInertJson(input, new WeakSet<object>(), { nodes: 0 }, 0);
}

type SemanticGraphProjection = ReturnType<typeof semanticGraphProjectionSchema.parse>;

export interface VerifiedSemanticReleaseEnvelope {
  readonly stage: SemanticSuccessorStage;
  readonly projections: Readonly<{
    readonly executable: Readonly<{
      readonly projection_kind: "EXECUTABLE";
      readonly projection_id: string;
      readonly projection_digest: string;
      readonly projection_payload: SemanticExecutablePublicationProjection;
    }>;
    readonly relationship: Readonly<{
      readonly projection_kind: "RELATIONSHIP";
      readonly projection_id: string;
      readonly projection_digest: string;
      readonly projection_payload: SemanticRelationshipPublicationProjection;
    }>;
    readonly runtime_restriction: Readonly<{
      readonly projection_kind: "RUNTIME_RESTRICTION";
      readonly projection_id: string;
      readonly projection_digest: string;
      readonly projection_payload: SemanticRuntimeRestrictionPublicationProjection;
    }>;
    readonly graph: Readonly<{
      readonly projection_kind: "GRAPH";
      readonly projection_id: string;
      readonly projection_digest: string;
      readonly projection_payload: SemanticGraphProjection;
    }>;
  }>;
}

export async function verifySemanticReleaseEnvelope(
  candidate: unknown,
): Promise<VerifiedSemanticReleaseEnvelope> {
  let envelope: ReturnType<typeof semanticSuccessorStageEnvelopeSchema.parse>;
  try {
    envelope = semanticSuccessorStageEnvelopeSchema.parse(inertJson(candidate));
  } catch {
    throw new TypeError("SEMANTIC_RELEASE_ENVELOPE_INVALID");
  }
  await verifySemanticSuccessorStage(envelope.stage);

  let executable: SemanticExecutablePublicationProjection;
  let relationship: SemanticRelationshipPublicationProjection;
  let runtimeRestriction: SemanticRuntimeRestrictionPublicationProjection;
  let graph: SemanticGraphProjection;
  try {
    executable = semanticExecutablePublicationProjectionSchema.parse(
      envelope.projections.executable.projection_payload,
    );
    relationship = semanticRelationshipPublicationProjectionSchema.parse(
      envelope.projections.relationship.projection_payload,
    );
    runtimeRestriction = semanticRuntimeRestrictionPublicationProjectionSchema.parse(
      envelope.projections.runtime_restriction.projection_payload,
    );
    graph = semanticGraphProjectionSchema.parse(envelope.projections.graph.projection_payload);
  } catch {
    throw new TypeError("SEMANTIC_RELEASE_ENVELOPE_INVALID");
  }

  const [executableDigest, relationshipDigest, restrictionDigest, graphDigest] = await Promise.all([
    sha256ContentHash(envelope.projections.executable.projection_payload),
    sha256ContentHash(envelope.projections.relationship.projection_payload),
    sha256ContentHash(envelope.projections.runtime_restriction.projection_payload),
    sha256ContentHash(envelope.projections.graph.projection_payload),
  ]);
  if (
    executableDigest !== envelope.projections.executable.projection_digest ||
    relationshipDigest !== envelope.projections.relationship.projection_digest ||
    restrictionDigest !== envelope.projections.runtime_restriction.projection_digest ||
    graphDigest !== envelope.projections.graph.projection_digest
  ) {
    throw new TypeError("SEMANTIC_RELEASE_PROJECTION_HASH_MISMATCH");
  }
  const expectedReleaseDigest = await sha256ContentHash({
    change_set_hash: envelope.stage.change_set_ref.change_set_hash,
    generation: envelope.stage.candidate_release.generation,
    compiler_bundle_digest: envelope.stage.compiler_bundle_ref.compiler_bundle_hash,
    executable_projection_digest: executableDigest,
    relationship_projection_digest: relationshipDigest,
    restriction_projection_digest: restrictionDigest,
    graph_projection_digest: graphDigest,
  });
  if (expectedReleaseDigest !== envelope.stage.candidate_release.release_digest) {
    throw new TypeError("SEMANTIC_RELEASE_DIGEST_MISMATCH");
  }

  const verified: VerifiedSemanticReleaseEnvelope = deepFreeze({
    stage: envelope.stage,
    projections: {
      executable: {
        ...envelope.projections.executable,
        projection_payload: executable,
      },
      relationship: {
        ...envelope.projections.relationship,
        projection_payload: relationship,
      },
      runtime_restriction: {
        ...envelope.projections.runtime_restriction,
        projection_payload: runtimeRestriction,
      },
      graph: {
        ...envelope.projections.graph,
        projection_payload: graph,
      },
    },
  });
  verifiedSemanticReleaseEnvelopes.add(verified);
  return verified;
}

function addDuplicates(values: readonly string[], reasonCodes: Set<string>): void {
  if (new Set(values).size !== values.length) {
    reasonCodes.add("SEMANTIC_RUNTIME_DUPLICATE_IDENTITY");
  }
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function collectFormulaSlots(expression: SemanticFormulaExpression, slots: Set<string>): void {
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
  }
}

function stableUuid(material: string): string {
  const digits = createHash("sha256").update(material).digest("hex").slice(0, 32).split("");
  digits[12] = "5";
  digits[16] = ((Number.parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = digits.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export async function validateSemanticRuntimeClosure(
  envelope: VerifiedSemanticReleaseEnvelope,
): Promise<SemanticRuntimeClosureValidationReceipt> {
  if (!verifiedSemanticReleaseEnvelopes.has(envelope)) {
    throw new TypeError("SEMANTIC_RELEASE_ENVELOPE_NOT_VERIFIED");
  }
  const executable = envelope.projections.executable.projection_payload;
  const relationshipProjection = envelope.projections.relationship.projection_payload;
  const restriction = envelope.projections.runtime_restriction.projection_payload;
  const graph = envelope.projections.graph.projection_payload;
  const reasonCodes = new Set<string>();

  addDuplicates(
    executable.metrics.map((metric) => metric.metric_id),
    reasonCodes,
  );
  addDuplicates(
    executable.dimensions.map((dimension) => dimension.dimension_id),
    reasonCodes,
  );
  addDuplicates(
    executable.formulas.map((formula) => formula.node_id),
    reasonCodes,
  );
  addDuplicates(
    relationshipProjection.relationships.map((relationship) => relationship.relationship_id),
    reasonCodes,
  );
  addDuplicates(
    graph.nodes.map((node) => node.node_id),
    reasonCodes,
  );
  addDuplicates(
    graph.edges.map((edge) => edge.edge_id),
    reasonCodes,
  );
  addDuplicates(
    restriction.quality_constraints.map((constraint) => constraint.constraint_id),
    reasonCodes,
  );
  addDuplicates(
    restriction.time_semantics.map((timeDomain) => timeDomain.time_domain_id),
    reasonCodes,
  );

  const activeBindings = executable.physical_bindings.filter(
    (binding) => binding.binding_lifecycle === "active",
  );
  if (
    activeBindings.some(
      (binding) => binding.datasource_id !== envelope.stage.candidate_release.datasource_id,
    )
  ) {
    reasonCodes.add("SEMANTIC_RUNTIME_DATASOURCE_CLOSURE_INVALID");
  }
  addDuplicates(
    activeBindings.map(
      (binding) => `${binding.logical_object_type}\u0000${binding.logical_object_id}`,
    ),
    reasonCodes,
  );
  const physicalColumns = new Set(
    activeBindings
      .filter((binding) => binding.column_name !== null)
      .map((binding) => `${binding.table_name}\u0000${binding.column_name ?? ""}`),
  );
  const bindingFor = (logicalObjectType: string, logicalObjectId: string) =>
    activeBindings.find(
      (binding) =>
        binding.logical_object_type === logicalObjectType &&
        binding.logical_object_id === logicalObjectId,
    );

  const dimensionsById = new Map(
    executable.dimensions.map((dimension) => [dimension.dimension_id, dimension]),
  );
  const formulasById = new Map(executable.formulas.map((formula) => [formula.node_id, formula]));
  const graphNodesById = new Map(graph.nodes.map((node) => [node.node_id, node]));
  const timeDomainsById = new Map(
    restriction.time_semantics.map((timeDomain) => [timeDomain.time_domain_id, timeDomain]),
  );

  for (const metric of executable.metrics) {
    const binding = bindingFor("metric", metric.metric_id);
    if (
      !binding ||
      binding.table_name !== metric.table_id ||
      binding.column_name !== metric.column_id ||
      !metric.dependency_column_ids.every((columnId) =>
        physicalColumns.has(`${metric.table_id}\u0000${columnId}`),
      )
    ) {
      reasonCodes.add("SEMANTIC_RUNTIME_METRIC_BINDING_INVALID");
    }
    if (
      metric.analysis.allowed_dimension_ids.some((dimensionId) => !dimensionsById.has(dimensionId))
    ) {
      reasonCodes.add("SEMANTIC_RUNTIME_METRIC_DIMENSION_CLOSURE_INVALID");
    }
    const metricNode = graphNodesById.get(metric.metric_id);
    if (metricNode?.node_type !== "METRIC") {
      reasonCodes.add("SEMANTIC_RUNTIME_GRAPH_SOURCE_CLOSURE_INVALID");
    }
    if (metric.formula !== null) {
      const formula = formulasById.get(metric.formula.formula_id);
      const slots = new Set<string>();
      if (formula) collectFormulaSlots(formula.expression, slots);
      const slotEdges = graph.edges.filter(
        (edge) =>
          edge.source_node_id === metric.formula?.formula_id &&
          edge.attributes.kind === "SLOT_BINDING",
      );
      const edgeSlots = slotEdges.map((edge) =>
        edge.attributes.kind === "SLOT_BINDING" ? edge.attributes.slot_id : "",
      );
      if (
        !formula ||
        !sameStringSet([...slots], metric.dependency_column_ids) ||
        !sameStringSet(edgeSlots, metric.dependency_column_ids) ||
        slotEdges.some((edge) => {
          const target = graphNodesById.get(edge.target_node_id);
          return (
            target?.node_type !== "PHYSICAL_COLUMN" ||
            target.table_name !== metric.table_id ||
            !metric.dependency_column_ids.includes(target.column_name)
          );
        })
      ) {
        reasonCodes.add("SEMANTIC_RUNTIME_FORMULA_DEPENDENCY_INVALID");
      }
    }
    if (metric.time_domain !== null) {
      const timeDomain = timeDomainsById.get(metric.time_domain.time_domain_id);
      const timeDimension = executable.dimensions.find(
        (dimension) =>
          dimension.table_id === metric.table_id &&
          dimension.column_id === metric.time_column_id &&
          (dimension.data_type === "date" || dimension.data_type === "timestamp"),
      );
      if (
        metric.time_column_id === null ||
        !timeDomain ||
        canonicalizeJson(timeDomain) !== canonicalizeJson(metric.time_domain) ||
        !timeDimension ||
        !metric.analysis.allowed_dimension_ids.includes(timeDimension.dimension_id)
      ) {
        reasonCodes.add("SEMANTIC_RUNTIME_TIME_CLOSURE_INVALID");
      }
    } else if (metric.time_column_id !== null) {
      reasonCodes.add("SEMANTIC_RUNTIME_TIME_CLOSURE_INVALID");
    }
  }

  for (const dimension of executable.dimensions) {
    const binding = bindingFor("dimension", dimension.dimension_id);
    if (
      !binding ||
      binding.table_name !== dimension.table_id ||
      binding.column_name !== dimension.column_id
    ) {
      reasonCodes.add("SEMANTIC_RUNTIME_DIMENSION_BINDING_INVALID");
    }
    if (dimension.parent_dimension_id !== null) {
      const parent = dimensionsById.get(dimension.parent_dimension_id);
      if (
        !dimension.hierarchical ||
        !parent ||
        parent.dimension_id === dimension.dimension_id ||
        parent.table_id !== dimension.table_id
      ) {
        reasonCodes.add("SEMANTIC_RUNTIME_DIMENSION_HIERARCHY_INVALID");
      }
    }
    const dimensionNode = graphNodesById.get(dimension.dimension_id);
    if (dimensionNode?.node_type !== "DIMENSION") {
      reasonCodes.add("SEMANTIC_RUNTIME_GRAPH_SOURCE_CLOSURE_INVALID");
    }
  }

  for (const relationship of relationshipProjection.relationships) {
    const leftClosed = relationship.left_column_ids.every((columnId) =>
      physicalColumns.has(`${relationship.left_table_id}\u0000${columnId}`),
    );
    const rightClosed = relationship.right_column_ids.every((columnId) =>
      physicalColumns.has(`${relationship.right_table_id}\u0000${columnId}`),
    );
    const joinEdge = graph.edges.find(
      (edge) =>
        edge.edge_id === relationship.relationship_id && edge.attributes.kind === "JOIN_PROOF",
    );
    if (!leftClosed || !rightClosed || !joinEdge || joinEdge.attributes.kind !== "JOIN_PROOF") {
      reasonCodes.add("SEMANTIC_RUNTIME_RELATIONSHIP_CLOSURE_INVALID");
      continue;
    }
    if (
      joinEdge.attributes.cardinality !== relationship.cardinality ||
      joinEdge.attributes.left_row_preservation !== relationship.left_row_preservation ||
      joinEdge.attributes.right_row_preservation !== relationship.right_row_preservation ||
      joinEdge.attributes.proof_kind !== relationship.proof_kind
    ) {
      reasonCodes.add("SEMANTIC_RUNTIME_RELATIONSHIP_CLOSURE_INVALID");
    }
  }

  if (
    graph.source_digest !== envelope.stage.change_set_ref.change_set_hash ||
    graph.compiler_version !== envelope.stage.compiler_bundle_ref.compiler_version ||
    graph.node_count !== graph.nodes.length ||
    graph.edge_count !== graph.edges.length ||
    graph.edges.some(
      (edge) =>
        !graphNodesById.has(edge.source_node_id) || !graphNodesById.has(edge.target_node_id),
    )
  ) {
    reasonCodes.add("SEMANTIC_RUNTIME_GRAPH_SOURCE_CLOSURE_INVALID");
  }
  for (const node of graph.nodes) {
    if (
      (node.node_type === "PHYSICAL_TABLE" || node.node_type === "PHYSICAL_COLUMN") &&
      (node.datasource_id !== envelope.stage.candidate_release.datasource_id ||
        node.schema_snapshot_id !== envelope.stage.source_snapshot_ref.snapshot_id ||
        node.snapshot_content_hash !== envelope.stage.source_snapshot_ref.snapshot_hash)
    ) {
      reasonCodes.add("SEMANTIC_RUNTIME_DATASOURCE_CLOSURE_INVALID");
    }
  }

  const validatorHash = await sha256ContentHash({
    validator_version: VALIDATOR_VERSION,
    closure_contract: "semantic-successor-runtime-closure@1.0.0",
  });
  return buildSemanticRuntimeClosureValidationReceipt({
    schema_version: "semantic-runtime-closure-validation-receipt@1.0.0",
    receipt_id: stableUuid(`${envelope.stage.stage_digest}:${VALIDATOR_VERSION}`),
    stage_id: envelope.stage.stage_id,
    stage_digest: envelope.stage.stage_digest,
    candidate_release: envelope.stage.candidate_release,
    projection_refs: envelope.stage.projection_refs,
    validator_identity: {
      validator_version: VALIDATOR_VERSION,
      validator_hash: validatorHash,
    },
    outcome: reasonCodes.size === 0 ? "PASS" : "FAIL",
    reason_codes: [...reasonCodes].sort(),
  });
}
