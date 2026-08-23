import {
  buildSemanticBindingImpactPlan,
  canonicalizeJson,
  type SchemaDriftOperation,
  type SemanticBindingImpactAction,
  type SemanticBindingImpactAuthorityBundle,
  type SemanticBindingImpactObjectKind,
  type SemanticBindingImpactPlan,
  type SemanticBindingImpactReason,
  type SemanticCandidateOperation,
  sha256ContentHash,
  uuidV8FromContentHash,
} from "@data-agent/contracts";
import { collectTransitiveDependents, type TransitiveDependency } from "./impact-planner.js";

type PackageProjection = SemanticBindingImpactAuthorityBundle["packages"][number];
type PhysicalMapping = PackageProjection["physical_mappings"][number];
type ReleaseObject = PackageProjection["objects"][number];
type RiskLevel = SemanticBindingImpactPlan["risk_level"];

const RISK_RANK: Readonly<Record<RiskLevel, number>> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

function compareCanonical(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function maximumRisk(values: readonly RiskLevel[]): RiskLevel {
  return values.reduce<RiskLevel>(
    (current, value) => ((RISK_RANK[value] ?? -1) > (RISK_RANK[current] ?? -1) ? value : current),
    "LOW",
  );
}

type OperationPolicy = Readonly<{
  risk_level: RiskLevel;
  action: SemanticBindingImpactAction;
}>;

function operationPolicy(operation: SchemaDriftOperation): OperationPolicy | null {
  switch (operation.operation_kind) {
    case "RELATION_REMOVED":
    case "COLUMN_REMOVED":
      return {
        risk_level: "CRITICAL",
        action: operation.operation_kind === "COLUMN_REMOVED" ? "REMAP_COLUMN" : "REVIEW_MAPPING",
      };
    case "RELATION_KIND_CHANGED":
      return { risk_level: "HIGH", action: "REVIEW_MAPPING" };
    case "COLUMN_TYPE_CHANGED":
    case "COLUMN_NULLABILITY_CHANGED":
    case "COLUMN_DEFAULT_CHANGED":
    case "COLUMN_IDENTITY_CHANGED":
    case "COLUMN_GENERATED_CHANGED":
    case "CHECK_CONSTRAINT_REMOVED":
    case "CHECK_CONSTRAINT_CHANGED":
      return { risk_level: "HIGH", action: "REVALIDATE_FORMULA" };
    case "PRIMARY_KEY_REMOVED":
    case "PRIMARY_KEY_CHANGED":
    case "FOREIGN_KEY_REMOVED":
    case "FOREIGN_KEY_CHANGED":
    case "UNIQUE_CONSTRAINT_REMOVED":
    case "UNIQUE_CONSTRAINT_CHANGED":
      return { risk_level: "HIGH", action: "REVALIDATE_JOIN" };
    case "RELATION_ADDED":
    case "RELATION_COMMENT_CHANGED":
    case "COLUMN_ADDED":
    case "COLUMN_ORDINAL_CHANGED":
    case "COLUMN_COMMENT_CHANGED":
    case "PRIMARY_KEY_ADDED":
    case "FOREIGN_KEY_ADDED":
    case "UNIQUE_CONSTRAINT_ADDED":
    case "CHECK_CONSTRAINT_ADDED":
    case "INDEX_ADDED":
    case "INDEX_REMOVED":
    case "INDEX_CHANGED":
      return null;
  }
}

type RelationIdentity = Readonly<{ schema_name: string; relation_name: string }>;

function locatorTouchesRelation(
  locator: PhysicalMapping["physical_locator"],
  relation: RelationIdentity,
): boolean {
  switch (locator.kind) {
    case "TABLE":
    case "COLUMN":
      return (
        locator.schema_name === relation.schema_name &&
        locator.table_name === relation.relation_name
      );
    case "JOIN":
      return (
        (locator.left_schema_name === relation.schema_name &&
          locator.left_table_name === relation.relation_name) ||
        (locator.right_schema_name === relation.schema_name &&
          locator.right_table_name === relation.relation_name)
      );
  }
  return false;
}

function locatorTouchesColumn(
  locator: PhysicalMapping["physical_locator"],
  identity: Readonly<{ relation: RelationIdentity; column_name: string }>,
): boolean {
  switch (locator.kind) {
    case "TABLE":
      return false;
    case "COLUMN":
      return (
        locator.schema_name === identity.relation.schema_name &&
        locator.table_name === identity.relation.relation_name &&
        locator.column_name === identity.column_name
      );
    case "JOIN":
      return (
        (locator.left_schema_name === identity.relation.schema_name &&
          locator.left_table_name === identity.relation.relation_name &&
          locator.left_column_name === identity.column_name) ||
        (locator.right_schema_name === identity.relation.schema_name &&
          locator.right_table_name === identity.relation.relation_name &&
          locator.right_column_name === identity.column_name)
      );
  }
  return false;
}

function locatorMatchesForeignKey(
  locator: PhysicalMapping["physical_locator"],
  relation: RelationIdentity,
  foreignKeys: readonly Readonly<{
    referenced_relation: RelationIdentity;
    column_pairs: readonly Readonly<{
      column_name: string;
      referenced_column_name: string;
    }>[];
  }>[],
): boolean {
  if (locator.kind !== "JOIN") return false;
  return foreignKeys.some((foreignKey) =>
    foreignKey.column_pairs.some(
      (pair) =>
        (locator.left_schema_name === relation.schema_name &&
          locator.left_table_name === relation.relation_name &&
          locator.left_column_name === pair.column_name &&
          locator.right_schema_name === foreignKey.referenced_relation.schema_name &&
          locator.right_table_name === foreignKey.referenced_relation.relation_name &&
          locator.right_column_name === pair.referenced_column_name) ||
        (locator.right_schema_name === relation.schema_name &&
          locator.right_table_name === relation.relation_name &&
          locator.right_column_name === pair.column_name &&
          locator.left_schema_name === foreignKey.referenced_relation.schema_name &&
          locator.left_table_name === foreignKey.referenced_relation.relation_name &&
          locator.left_column_name === pair.referenced_column_name),
    ),
  );
}

function locatorTouchesColumns(
  locator: PhysicalMapping["physical_locator"],
  relation: RelationIdentity,
  columns: ReadonlySet<string>,
): boolean {
  if (columns.size === 0) return locatorTouchesRelation(locator, relation);
  return [...columns].some((column_name) =>
    locatorTouchesColumn(locator, { relation, column_name }),
  );
}

function matchesOperation(mapping: PhysicalMapping, operation: SchemaDriftOperation): boolean {
  const locator = mapping.physical_locator;
  switch (operation.operation_kind) {
    case "RELATION_REMOVED":
      return locatorTouchesRelation(locator, operation.before.identity);
    case "RELATION_KIND_CHANGED":
      return locatorTouchesRelation(locator, operation.identity);
    case "COLUMN_REMOVED":
    case "COLUMN_TYPE_CHANGED":
    case "COLUMN_NULLABILITY_CHANGED":
    case "COLUMN_DEFAULT_CHANGED":
    case "COLUMN_IDENTITY_CHANGED":
    case "COLUMN_GENERATED_CHANGED":
      return locatorTouchesColumn(locator, operation.identity);
    case "FOREIGN_KEY_REMOVED":
      return locatorMatchesForeignKey(locator, operation.identity.relation, [operation.before]);
    case "FOREIGN_KEY_CHANGED":
      return locatorMatchesForeignKey(locator, operation.identity.relation, [
        operation.before,
        operation.after,
      ]);
    case "PRIMARY_KEY_REMOVED":
    case "UNIQUE_CONSTRAINT_REMOVED":
      return locatorTouchesColumns(
        locator,
        operation.identity.relation,
        new Set(operation.before.columns),
      );
    case "PRIMARY_KEY_CHANGED":
    case "UNIQUE_CONSTRAINT_CHANGED":
      return locatorTouchesColumns(
        locator,
        operation.identity.relation,
        new Set([...operation.before.columns, ...operation.after.columns]),
      );
    case "CHECK_CONSTRAINT_REMOVED":
    case "CHECK_CONSTRAINT_CHANGED":
      return locatorTouchesRelation(locator, operation.identity.relation);
    case "RELATION_ADDED":
    case "RELATION_COMMENT_CHANGED":
    case "COLUMN_ADDED":
    case "COLUMN_ORDINAL_CHANGED":
    case "COLUMN_COMMENT_CHANGED":
    case "PRIMARY_KEY_ADDED":
    case "FOREIGN_KEY_ADDED":
    case "UNIQUE_CONSTRAINT_ADDED":
    case "CHECK_CONSTRAINT_ADDED":
    case "INDEX_ADDED":
    case "INDEX_REMOVED":
    case "INDEX_CHANGED":
      return false;
  }
  return false;
}

function objectKind(object: ReleaseObject): SemanticBindingImpactObjectKind {
  switch (object.semantic_role) {
    case "PHYSICAL_MAPPING":
      return "PHYSICAL_MAPPING";
    case "ENTITY":
    case "EVENT":
    case "CLASS":
    case "CONCEPT":
      return "ENTITY";
    case "DATA_PROPERTY":
    case "GRAIN":
    case "TIME":
    case "UNIT":
      return "DIMENSION";
    case "METRIC":
      return "METRIC";
    case "OBJECT_PROPERTY":
    case "TAXONOMY":
    case "ALIGNMENT":
      return "RELATIONSHIP";
    case "FORMULA":
      return "FORMULA";
    case "CONSTRAINT":
      return "CONSTRAINT";
    case "GLOSSARY_TERM":
      return "OTHER";
  }
  return "OTHER";
}

function candidateTargetType(
  object: ReleaseObject,
): SemanticCandidateOperation["target_type"] | null {
  switch (objectKind(object)) {
    case "ENTITY":
      return "BUSINESS_ENTITY_TYPE";
    case "DIMENSION":
      return "DIMENSION";
    case "METRIC":
      return "METRIC";
    case "RELATIONSHIP":
      return "RELATIONSHIP";
    case "PHYSICAL_MAPPING":
      return "PHYSICAL_BINDING";
    case "FORMULA":
    case "CONSTRAINT":
    case "OTHER":
      return null;
  }
}

function transitiveAction(kind: SemanticBindingImpactObjectKind): SemanticBindingImpactAction {
  if (kind === "METRIC" || kind === "FORMULA") return "REVALIDATE_FORMULA";
  if (kind === "RELATIONSHIP" || kind === "CONSTRAINT") return "REVALIDATE_JOIN";
  return "REVIEW_MAPPING";
}

function buildDependencies(
  packages: SemanticBindingImpactAuthorityBundle["packages"],
  manualReasons: Set<SemanticBindingImpactReason>,
): {
  readonly dependencies: readonly TransitiveDependency[];
  readonly objects: ReadonlyMap<string, ReleaseObject>;
  readonly mappings: ReadonlyMap<string, PhysicalMapping>;
} {
  const objects = new Map<string, ReleaseObject>();
  const mappings = new Map<string, PhysicalMapping>();
  const dependencies: TransitiveDependency[] = [];
  for (const packageProjection of packages) {
    for (const object of packageProjection.objects) {
      objects.set(object.object_id, object);
    }
    for (const mapping of packageProjection.physical_mappings)
      mappings.set(mapping.mapping_id, mapping);
  }
  for (const mapping of mappings.values()) {
    if (!objects.has(mapping.logical_object_id)) {
      manualReasons.add("DANGLING_RELEASE_REFERENCE");
      continue;
    }
    dependencies.push({
      source_object_id: mapping.mapping_id,
      dependent_object_id: mapping.logical_object_id,
    });
  }
  for (const packageProjection of packages) {
    const objectByGraphEntry = new Map(
      packageProjection.objects.map((object) => [object.graph_entry_id, object] as const),
    );
    for (const edge of packageProjection.graph_edges) {
      const edgeObject = objectByGraphEntry.get(edge.edge_id);
      const source = objectByGraphEntry.get(edge.source_node_id);
      const target = objectByGraphEntry.get(edge.target_node_id);
      if (!edgeObject || !source || !target) {
        manualReasons.add("UNKNOWN_DEPENDENCY_LINEAGE");
        continue;
      }
      dependencies.push(
        { source_object_id: source.object_id, dependent_object_id: edgeObject.object_id },
        { source_object_id: target.object_id, dependent_object_id: edgeObject.object_id },
      );
    }
    for (const metric of packageProjection.metric_bindings) {
      const sources = [
        metric.formula_object_id,
        ...metric.dimension_object_ids,
        ...metric.grain_object_ids,
        metric.time_object_id,
        metric.unit_object_id,
      ].filter((value): value is string => value !== null);
      if (!objects.has(metric.metric_object_id) || sources.some((value) => !objects.has(value))) {
        manualReasons.add("DANGLING_RELEASE_REFERENCE");
        continue;
      }
      for (const source of new Set(sources)) {
        dependencies.push({
          source_object_id: source,
          dependent_object_id: metric.metric_object_id,
        });
      }
    }
    for (const constraint of packageProjection.constraints) {
      if (!objects.has(constraint.constraint_id) || !objects.has(constraint.target_object_id)) {
        manualReasons.add("DANGLING_RELEASE_REFERENCE");
        continue;
      }
      dependencies.push({
        source_object_id: constraint.target_object_id,
        dependent_object_id: constraint.constraint_id,
      });
      for (const provenanceId of constraint.provenance_object_ids) {
        if (!objects.has(provenanceId)) {
          manualReasons.add("DANGLING_RELEASE_REFERENCE");
          continue;
        }
        dependencies.push({
          source_object_id: provenanceId,
          dependent_object_id: constraint.constraint_id,
        });
      }
    }
  }
  const unique = new Map(
    dependencies.map((dependency) => [
      `${dependency.source_object_id}\u0000${dependency.dependent_object_id}`,
      dependency,
    ]),
  );
  return {
    dependencies: [...unique.values()].sort((left, right) =>
      compareCanonical(
        `${left.source_object_id}\u0000${left.dependent_object_id}`,
        `${right.source_object_id}\u0000${right.dependent_object_id}`,
      ),
    ),
    objects,
    mappings,
  };
}

async function candidateOperation(
  input: Readonly<{
    authority_hash: string;
    target_type: SemanticCandidateOperation["target_type"];
    target_id: string;
    evidence_refs: readonly string[];
    risk_level: RiskLevel;
    affected_object_ids: readonly string[];
    summary: string;
  }>,
): Promise<SemanticCandidateOperation> {
  const operationId = uuidV8FromContentHash(
    await sha256ContentHash({
      authority_input_hash: input.authority_hash,
      action: "MARK_STALE",
      target_type: input.target_type,
      target_id: input.target_id,
    }),
  );
  return {
    schema_version: "semantic-candidate-operation@1.0.0",
    operation_id: operationId,
    action: "MARK_STALE",
    target_type: input.target_type,
    target_id: input.target_id,
    payload: null,
    evidence_refs: [...input.evidence_refs].sort(compareCanonical),
    field_evidence: { state: [...input.evidence_refs].sort(compareCanonical) },
    confidence: 1,
    assumptions: [],
    open_questions: [],
    impact: {
      risk_level: input.risk_level,
      affected_object_ids: [...input.affected_object_ids].sort(compareCanonical),
      summary: input.summary,
    },
  } as SemanticCandidateOperation;
}

export async function planSemanticBindingImpact(
  authority: SemanticBindingImpactAuthorityBundle,
): Promise<SemanticBindingImpactPlan> {
  const manualReasons = new Set<SemanticBindingImpactReason>();
  const { dependencies, objects, mappings } = buildDependencies(authority.packages, manualReasons);
  const directImpacts: SemanticBindingImpactPlan["direct_impacts"][number][] = [];
  const evidenceByMapping = new Map<string, Set<string>>();
  const riskByMapping = new Map<string, RiskLevel[]>();

  for (const operation of authority.drift.event.operations) {
    const policy = operationPolicy(operation);
    if (!policy) continue;
    const operationHash = await sha256ContentHash(operation);
    const matched = [...mappings.values()].filter((mapping) =>
      matchesOperation(mapping, operation),
    );
    const locatorGroups = new Map<string, Set<string>>();
    for (const mapping of matched) {
      const locator = canonicalizeJson(mapping.physical_locator);
      const logicalIds = locatorGroups.get(locator) ?? new Set<string>();
      logicalIds.add(mapping.logical_object_id);
      locatorGroups.set(locator, logicalIds);
    }
    if ([...locatorGroups.values()].some((logicalIds) => logicalIds.size > 1)) {
      manualReasons.add("AMBIGUOUS_PHYSICAL_MAPPING");
    }
    for (const mapping of matched) {
      directImpacts.push({
        operation_hash: operationHash,
        operation,
        mapping_id: mapping.mapping_id,
        logical_object_id: mapping.logical_object_id,
        mapping_hash: await sha256ContentHash(mapping),
        risk_level: policy.risk_level,
        suggested_action: policy.action,
      });
      const evidence = evidenceByMapping.get(mapping.mapping_id) ?? new Set<string>();
      evidence.add(operationHash);
      evidenceByMapping.set(mapping.mapping_id, evidence);
      const risks = riskByMapping.get(mapping.mapping_id) ?? [];
      risks.push(policy.risk_level);
      riskByMapping.set(mapping.mapping_id, risks);
    }
  }
  directImpacts.sort((left, right) =>
    compareCanonical(
      `${left.operation_hash}\u0000${left.mapping_id}`,
      `${right.operation_hash}\u0000${right.mapping_id}`,
    ),
  );

  const roots = [...evidenceByMapping.keys()].sort(compareCanonical);
  const knownIds = new Set([...mappings.keys(), ...objects.keys()]);
  const closure = collectTransitiveDependents({ roots, dependencies, known_object_ids: knownIds });
  const transitiveImpacts: SemanticBindingImpactPlan["transitive_impacts"][number][] = [];
  for (const affected of closure) {
    if (roots.includes(affected.object_id)) continue;
    const object = objects.get(affected.object_id);
    if (!object) {
      manualReasons.add("DANGLING_RELEASE_REFERENCE");
      continue;
    }
    const risks = affected.source_object_ids.flatMap(
      (sourceId) => riskByMapping.get(sourceId) ?? [],
    );
    const kind = objectKind(object);
    transitiveImpacts.push({
      object_id: object.object_id,
      object_kind: kind,
      object_hash: object.object_hash,
      source_object_ids: [...affected.source_object_ids],
      risk_level: maximumRisk(risks),
      suggested_action: transitiveAction(kind),
    });
  }

  const affectedObjectIds = new Set(transitiveImpacts.map(({ object_id }) => object_id));
  const unchangedObjectHashes = [...objects.values()]
    .filter((object) => !affectedObjectIds.has(object.object_id))
    .map((object) => ({ object_id: object.object_id, object_hash: object.object_hash }))
    .sort((left, right) => compareCanonical(left.object_id, right.object_id));

  let candidateOperations: SemanticCandidateOperation[] = [];
  if (directImpacts.length > 0 && manualReasons.size === 0) {
    const candidateInputs = new Map<
      string,
      {
        target_type: SemanticCandidateOperation["target_type"];
        target_id: string;
        evidence: Set<string>;
        risks: RiskLevel[];
        affected: Set<string>;
      }
    >();
    for (const mappingId of roots) {
      candidateInputs.set(`PHYSICAL_BINDING:${mappingId}`, {
        target_type: "PHYSICAL_BINDING",
        target_id: mappingId,
        evidence: new Set(evidenceByMapping.get(mappingId) ?? []),
        risks: riskByMapping.get(mappingId) ?? ["LOW"],
        affected: new Set(
          closure
            .filter(({ source_object_ids }) => source_object_ids.includes(mappingId))
            .map(({ object_id }) => object_id),
        ),
      });
    }
    for (const impact of transitiveImpacts) {
      const object = objects.get(impact.object_id);
      if (!object) continue;
      const targetType = candidateTargetType(object);
      if (!targetType) continue;
      const evidence = new Set(
        impact.source_object_ids.flatMap((mappingId) => [
          ...(evidenceByMapping.get(mappingId) ?? []),
        ]),
      );
      candidateInputs.set(`${targetType}:${impact.object_id}`, {
        target_type: targetType,
        target_id: impact.object_id,
        evidence,
        risks: [impact.risk_level],
        affected: new Set([impact.object_id]),
      });
    }
    if (
      candidateInputs.size > 256 ||
      [...candidateInputs.values()].some((input) => input.affected.size > 1_000)
    ) {
      manualReasons.add("CANDIDATE_OPERATION_LIMIT_EXCEEDED");
    } else {
      candidateOperations = await Promise.all(
        [...candidateInputs.values()].map((input) =>
          candidateOperation({
            authority_hash: authority.authority_input_hash,
            target_type: input.target_type,
            target_id: input.target_id,
            evidence_refs: [...input.evidence],
            risk_level: maximumRisk(input.risks),
            affected_object_ids: [...input.affected],
            summary: `Schema drift requires review of ${input.target_type} ${input.target_id}.`,
          }),
        ),
      );
      candidateOperations.sort((left, right) =>
        compareCanonical(left.operation_id, right.operation_id),
      );
    }
  }

  const status =
    directImpacts.length === 0
      ? "NO_SEMANTIC_ACTION"
      : manualReasons.size > 0
        ? "MANUAL_INVESTIGATION"
        : "REVIEW_REQUIRED";
  if (status !== "REVIEW_REQUIRED") candidateOperations = [];
  const suggestedActions = new Set<SemanticBindingImpactAction>(
    directImpacts.map(({ suggested_action }) => suggested_action),
  );
  for (const impact of transitiveImpacts) suggestedActions.add(impact.suggested_action);
  if (status === "NO_SEMANTIC_ACTION") suggestedActions.add("NO_SEMANTIC_ACTION");
  if (status === "MANUAL_INVESTIGATION") suggestedActions.add("MANUAL_INVESTIGATION");

  return buildSemanticBindingImpactPlan({
    schema_version: "semantic-binding-impact-plan@1.0.0",
    impact_id: uuidV8FromContentHash(authority.authority_input_hash),
    scope: authority.scope,
    datasource_id: authority.datasource_id,
    authority_input_hash: authority.authority_input_hash,
    drift_ref: {
      drift_event_id: authority.drift.event.drift_event_id,
      event_storage_digest: authority.drift.event_storage_digest,
      base_snapshot_content_hash: authority.drift.event.base_snapshot_content_hash,
      current_snapshot_content_hash: authority.drift.event.current_snapshot_content_hash,
    },
    release_ref: authority.release,
    status,
    risk_level: maximumRisk([
      ...directImpacts.map(({ risk_level }) => risk_level),
      ...transitiveImpacts.map(({ risk_level }) => risk_level),
    ]),
    direct_impacts: directImpacts,
    transitive_impacts: transitiveImpacts,
    unchanged_object_hashes: unchangedObjectHashes,
    suggested_actions: [...suggestedActions].sort(compareCanonical),
    manual_reason_codes: [...manualReasons].sort(compareCanonical),
    candidate_operations: candidateOperations,
  });
}
