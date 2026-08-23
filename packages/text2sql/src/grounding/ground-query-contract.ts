import { computeGroundingHash, deepFreeze } from "@data-agent/contracts";
import {
  type CatalogDimension,
  type CatalogMetric,
  type CatalogRelationship,
  type CatalogSnapshot,
  type GroundingPackageDraft,
  type GroundingResult,
  groundingPackageDraftSchema,
  groundingRequestSchema,
  type MandatoryPredicate,
  type PolicySnapshot,
} from "./types.js";

type Path = readonly CatalogRelationship[];

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function tableForColumn(columnId: string): string {
  const separator = columnId.indexOf(".");
  return separator === -1 ? "" : columnId.slice(0, separator);
}

function snapshotMatchesQueryScope(
  snapshot: Pick<CatalogSnapshot | PolicySnapshot, "scope" | "run_id">,
  queryContract: {
    readonly evidence_plan_ref: {
      readonly app_id: string;
      readonly tenant_id: string;
      readonly environment: string;
      readonly run_id: string;
    };
  },
): boolean {
  const reference = queryContract.evidence_plan_ref;
  return (
    snapshot.scope.app_id === reference.app_id &&
    snapshot.scope.tenant_id === reference.tenant_id &&
    snapshot.scope.environment === reference.environment &&
    snapshot.run_id === reference.run_id
  );
}

function allowedColumns(
  policy: PolicySnapshot,
  catalog: CatalogSnapshot,
): Map<string, Set<string>> {
  const catalogTables = new Map(catalog.tables.map((table) => [table.table_id, table]));
  const allowed = new Map<string, Set<string>>();
  for (const policyTable of policy.allowed_tables) {
    const table = catalogTables.get(policyTable.table_id);
    if (!table) continue;
    const catalogColumnIds = new Set(table.columns.map(({ column_id }) => column_id));
    const columns = new Set(
      policyTable.column_ids.filter((columnId) => catalogColumnIds.has(columnId)),
    );
    if (columns.size > 0) allowed.set(table.table_id, columns);
  }
  return allowed;
}

function objectAuthorized(
  objectId: string,
  catalog: CatalogSnapshot,
  allowed: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  const metric = catalog.metrics.find(({ metric_id }) => metric_id === objectId);
  if (metric) {
    const allowedMetricColumns = allowed.get(metric.table_id);
    return (
      allowedMetricColumns?.has(metric.column_id) === true &&
      metric.dependency_column_ids.every((columnId) => allowedMetricColumns.has(columnId)) &&
      (metric.time_column_id === null || allowedMetricColumns.has(metric.time_column_id))
    );
  }
  const dimension = catalog.dimensions.find(({ dimension_id }) => dimension_id === objectId);
  return allowed.get(dimension?.table_id ?? "")?.has(dimension?.column_id ?? "") === true;
}

function relationshipAuthorized(
  relationship: CatalogRelationship,
  allowed: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  const left = allowed.get(relationship.left_table_id);
  const right = allowed.get(relationship.right_table_id);
  return (
    relationship.left_column_ids.every((columnId) => left?.has(columnId) === true) &&
    relationship.right_column_ids.every((columnId) => right?.has(columnId) === true)
  );
}

function pathsBetween(
  source: string,
  target: string,
  relationships: readonly CatalogRelationship[],
  maxDepth: number,
): Path[] {
  if (source === target) return [[]];
  const paths: Path[] = [];
  const visit = (
    current: string,
    path: readonly CatalogRelationship[],
    visited: ReadonlySet<string>,
  ): void => {
    if (path.length >= maxDepth) return;
    for (const relationship of relationships) {
      const next =
        relationship.left_table_id === current
          ? relationship.right_table_id
          : relationship.right_table_id === current
            ? relationship.left_table_id
            : null;
      if (!next || visited.has(next)) continue;
      const nextPath = [...path, relationship];
      if (next === target) {
        paths.push(nextPath);
      } else {
        visit(next, nextPath, new Set([...visited, next]));
      }
    }
  };
  visit(source, [], new Set([source]));
  if (paths.length === 0) return [];
  const shortest = Math.min(...paths.map(({ length }) => length));
  return paths
    .filter(({ length }) => length === shortest)
    .sort((left, right) =>
      compareStable(
        left.map(({ relationship_id }) => relationship_id).join("\u0000"),
        right.map(({ relationship_id }) => relationship_id).join("\u0000"),
      ),
    );
}

function metricDependencies(metric: CatalogMetric): string[] {
  return [
    metric.column_id,
    ...metric.dependency_column_ids,
    ...(metric.time_column_id ? [metric.time_column_id] : []),
  ];
}

function dimensionDependencies(dimensions: readonly CatalogDimension[]): string[] {
  return dimensions.map(({ column_id }) => column_id);
}

function missingColumns(
  columnIds: ReadonlySet<string>,
  allowed: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  return [...columnIds]
    .filter((columnId) => allowed.get(tableForColumn(columnId))?.has(columnId) !== true)
    .sort();
}

function orientCardinality(
  relationship: CatalogRelationship,
  fromTableId: string,
): "one-to-one" | "one-to-many" | "many-to-one" {
  if (relationship.left_table_id === fromTableId) return relationship.cardinality;
  if (relationship.cardinality === "one-to-many") return "many-to-one";
  if (relationship.cardinality === "many-to-one") return "one-to-many";
  return "one-to-one";
}

function pathHasFanout(rootTableId: string, path: Path): boolean {
  let current = rootTableId;
  for (const edge of path) {
    if (orientCardinality(edge, current) === "one-to-many") return true;
    current = edge.left_table_id === current ? edge.right_table_id : edge.left_table_id;
  }
  return false;
}

function policyPredicatesForTables(
  policy: PolicySnapshot,
  tableIds: ReadonlySet<string>,
): MandatoryPredicate[] {
  return policy.mandatory_predicates
    .filter(({ table_id }) => tableIds.has(table_id))
    .sort((left, right) =>
      compareStable(
        `${left.table_id}\u0000${left.column_id}`,
        `${right.table_id}\u0000${right.column_id}`,
      ),
    );
}

export async function groundQueryContract(input: unknown): Promise<GroundingResult> {
  const parsed = groundingRequestSchema.parse(input);
  const { query_contract: queryContract, catalog, policy } = parsed;
  if (!policy) {
    return deepFreeze({ state: "DENIED", reason_code: "GROUNDING_POLICY_MISSING" });
  }
  if (
    !snapshotMatchesQueryScope(catalog, queryContract) ||
    !snapshotMatchesQueryScope(policy, queryContract)
  ) {
    return deepFreeze({ state: "DENIED", reason_code: "GROUNDING_SCOPE_MISMATCH" });
  }
  if (
    queryContract.datasource_id !== catalog.datasource_id ||
    queryContract.datasource_id !== policy.datasource_id
  ) {
    return deepFreeze({ state: "DENIED", reason_code: "GROUNDING_DATASOURCE_MISMATCH" });
  }
  const allowed = allowedColumns(policy, catalog);
  if (allowed.size === 0) {
    return deepFreeze({ state: "DENIED", reason_code: "GROUNDING_ALLOWED_SCHEMA_EMPTY" });
  }

  const metric = catalog.metrics.find(({ metric_id }) => metric_id === queryContract.metric);
  if (!metric) {
    return deepFreeze({ state: "DENIED", reason_code: "GROUNDING_METRIC_NOT_FOUND" });
  }
  const dimensions = queryContract.dimensions.map((dimensionId) =>
    catalog.dimensions.find(({ dimension_id }) => dimension_id === dimensionId),
  );
  if (dimensions.some((dimension) => dimension === undefined)) {
    return deepFreeze({
      state: "DENIED",
      reason_code: "GROUNDING_DIMENSION_NOT_FOUND",
      missing_ids: queryContract.dimensions.filter(
        (dimensionId) =>
          !catalog.dimensions.some(({ dimension_id }) => dimension_id === dimensionId),
      ),
    });
  }
  const resolvedDimensions = dimensions as CatalogDimension[];
  const requiredColumns = new Set([
    ...metricDependencies(metric),
    ...dimensionDependencies(resolvedDimensions),
    ...queryContract.filters.map(({ field }) => field),
  ]);
  const initialMissing = missingColumns(requiredColumns, allowed);
  if (initialMissing.length > 0) {
    return deepFreeze({
      state: "DENIED",
      reason_code: "GROUNDING_DEPENDENCY_DENIED",
      missing_ids: initialMissing,
    });
  }

  const authorizedRelationships = catalog.relationships.filter((relationship) =>
    relationshipAuthorized(relationship, allowed),
  );
  const selectedTables = new Set<string>([metric.table_id]);
  const selectedEdges = new Map<string, CatalogRelationship>();
  const preaggregations: GroundingPackageDraft["join_closure"]["preaggregations"] = [];
  const targetTables = new Set([
    ...resolvedDimensions.map(({ table_id }) => table_id),
    ...queryContract.filters.map(({ field }) => tableForColumn(field)),
  ]);
  for (const targetTable of [...targetTables].sort()) {
    const paths = pathsBetween(
      metric.table_id,
      targetTable,
      authorizedRelationships,
      catalog.tables.length,
    );
    if (paths.length === 0) {
      return deepFreeze({
        state: "DENIED",
        reason_code: "GROUNDING_JOIN_PATH_MISSING",
        missing_ids: [targetTable],
      });
    }
    if (paths.length > 1) {
      return deepFreeze({
        state: "CLARIFY",
        reason_code: "GROUNDING_JOIN_PATH_AMBIGUOUS",
        conflict_set: paths.map((path) =>
          path.map(({ relationship_id }) => relationship_id).join("->"),
        ),
      });
    }
    const path = paths[0] ?? [];
    if (pathHasFanout(metric.table_id, path)) {
      // 仅有 “preaggregate” 标记不足以证明跨一对多维度的可分摊性；
      // 在 Allocation/Composable Aggregate 契约落地前必须失败关闭。
      return deepFreeze({
        state: "DENIED",
        reason_code: "GROUNDING_FANOUT_UNSAFE",
        missing_ids: [targetTable],
      });
    }
    for (const edge of path) {
      selectedEdges.set(edge.relationship_id, edge);
      selectedTables.add(edge.left_table_id);
      selectedTables.add(edge.right_table_id);
      for (const columnId of [...edge.left_column_ids, ...edge.right_column_ids]) {
        requiredColumns.add(columnId);
      }
    }
  }

  const mandatoryPredicates = policyPredicatesForTables(policy, selectedTables);
  for (const predicate of mandatoryPredicates) requiredColumns.add(predicate.column_id);
  const closureMissing = missingColumns(requiredColumns, allowed);
  if (closureMissing.length > 0) {
    return deepFreeze({
      state: "DENIED",
      reason_code: "GROUNDING_DEPENDENCY_DENIED",
      missing_ids: closureMissing,
    });
  }
  const objectCount = selectedTables.size + requiredColumns.size + selectedEdges.size;
  if (objectCount > parsed.max_context_objects) {
    return deepFreeze({
      state: "CLARIFY",
      reason_code: "GROUNDING_CONTEXT_BUDGET_EXCEEDED",
      conflict_set: [],
    });
  }

  const rankedAuthorizedCandidates = parsed.retrieval_candidates
    .filter(({ object_id }) => objectAuthorized(object_id, catalog, allowed))
    .sort(
      (left, right) => right.score - left.score || compareStable(left.object_id, right.object_id),
    );
  const acceptedCandidateIds: string[] = [];
  const seenCandidateIds = new Set<string>();
  for (const { object_id: objectId } of rankedAuthorizedCandidates) {
    if (seenCandidateIds.has(objectId)) continue;
    seenCandidateIds.add(objectId);
    acceptedCandidateIds.push(objectId);
  }
  const selectedCatalogTables = catalog.tables
    .filter(({ table_id }) => selectedTables.has(table_id))
    .sort((left, right) => compareStable(left.table_id, right.table_id))
    .map((table) => ({
      table_id: table.table_id,
      physical_name: table.physical_name,
      columns: table.columns
        .filter(({ column_id }) => requiredColumns.has(column_id))
        .sort((left, right) => compareStable(left.column_id, right.column_id)),
    }));
  const groundingMaterial = {
    catalog_version: catalog.catalog_version,
    policy_version: policy.policy_version,
    datasource_id: queryContract.datasource_id,
    allowed_schema: { tables: selectedCatalogTables },
    metric,
    // QueryContract 的 Dimension 顺序定义结果列顺序，Grounding 不得重排。
    dimensions: resolvedDimensions,
    required_column_ids: [...requiredColumns].sort(),
    mandatory_predicates: mandatoryPredicates,
    join_closure: {
      root_table_id: metric.table_id,
      table_ids: [...selectedTables].sort(),
      edges: [...selectedEdges.values()].sort((left, right) =>
        compareStable(left.relationship_id, right.relationship_id),
      ),
      preaggregations,
    },
    accepted_candidate_ids: acceptedCandidateIds,
    conflict_set: [],
  };
  const grounding = groundingPackageDraftSchema.parse({
    ...groundingMaterial,
    grounding_hash: await computeGroundingHash(groundingMaterial),
  });
  return deepFreeze({ state: "READY", grounding });
}
