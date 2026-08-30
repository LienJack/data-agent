import {
  type Text2SqlQueryCandidate,
  text2sqlQueryCandidateSchema,
} from "@data-agent/contracts/agents";
import {
  type QueryEvidenceSemanticBinding,
  type SemanticQueryContext,
  verifySemanticQueryContext,
} from "@data-agent/contracts/artifacts";
import type { PhysicalSchemaSnapshot } from "@data-agent/contracts/catalog";
import { canonicalizeJson, sha256ContentHash } from "@data-agent/contracts/common";
import type { SemanticContextCommitResult } from "@data-agent/contracts/context";
import {
  buildGovernedDatasourceQueryRequest,
  type GovernedDatasourceQueryResult,
} from "@data-agent/contracts/datasources";
import type { PortResult } from "@data-agent/contracts/ports";
import type { WorkspaceDatasource } from "@data-agent/contracts/workspaces";
import type { PostgresSchemaSnapshotStore } from "@data-agent/platform/catalog";
import {
  assertPostgresqlText2SqlCandidatePolicy,
  buildBuiltinDatasourceAdapterDescriptors,
  buildPostgresqlQueryEvidenceSemanticBinding,
  createGovernedDatasourceAdapter,
  DatasourceAdapterPolicyError,
  type DatasourceAdapterTransport,
  parameterizePostgresqlText2SqlCandidate,
} from "@data-agent/platform/datasource-adapters";
import type { PersistedSecretRef } from "@data-agent/platform/secrets";
import type pg from "pg";
import type { RunExecutionContext } from "../runs/run-worker-runner.js";
import type { FrozenSemanticReleaseCatalog } from "../semantic/semantic-release-read-port.js";
import type { DataAgentProductTeamRuntimePort } from "./data-agent-team-runner.js";

const POSTGRES_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/u;
const POSTGRES_DATE_OID = 1082;

type EffectiveConfig = ReturnType<RunExecutionContext["getEffectiveConfig"]>;
type SemanticContextPackage = Parameters<
  DataAgentProductTeamRuntimePort["execute"]
>[0]["semantic_context_package"];

export interface Text2SqlQueryExecution {
  readonly result: GovernedDatasourceQueryResult;
  readonly semantic_binding: QueryEvidenceSemanticBinding;
}

export interface PreparedText2SqlContext {
  readonly context_text: string;
  readonly datasource_id: string;
  readonly schema_snapshot_id: string;
  readonly schema_snapshot_hash: string;
  readonly allowed_relations: readonly string[];
  readonly target_capability_hash: string;
  readonly reader_role: string;
  readonly semantic_query_context_hash: string | null;
  readonly semantic_query_context_binding?: {
    readonly metric_ids: readonly string[];
    readonly dimension_ids: readonly string[];
  };
  readonly binding_authority?: {
    readonly physical_snapshot: PhysicalSchemaSnapshot;
    readonly semantic_context: SemanticContextCommitResult;
    readonly semantic_catalog: FrozenSemanticReleaseCatalog;
    readonly datasource_ref: EffectiveConfig["datasource"];
  };
}

export interface Text2SqlQueryRuntimePort {
  prepare(input: {
    readonly effective_config: EffectiveConfig;
    readonly semantic_context: SemanticContextCommitResult;
    readonly semantic_catalog: FrozenSemanticReleaseCatalog;
    readonly semantic_query_context?: SemanticQueryContext | null;
    readonly max_context_bytes: number;
  }): Promise<PreparedText2SqlContext>;
  compileCandidate(input: {
    readonly prepared: PreparedText2SqlContext;
    readonly candidate: Text2SqlQueryCandidate;
  }): Promise<Text2SqlQueryCandidate>;
  execute(input: {
    readonly effective_config: EffectiveConfig;
    readonly prepared: PreparedText2SqlContext;
    readonly candidate: Text2SqlQueryCandidate;
    readonly timeout_ms: number;
    readonly max_rows: number;
    readonly max_bytes: number;
    readonly signal?: AbortSignal;
  }): Promise<Text2SqlQueryExecution>;
}

function allowedRelationBindings(prepared: PreparedText2SqlContext) {
  return prepared.allowed_relations.map((relation) => {
    const [schemaName, relationName] = relation.split(".", 2);
    if (!schemaName || !relationName) {
      throw new Text2SqlQueryRuntimeError("TEXT2SQL_ALLOWED_RELATION_INVALID");
    }
    return { schema_name: schemaName, relation_name: relationName };
  });
}

async function validateCandidate(
  prepared: PreparedText2SqlContext,
  candidate: Text2SqlQueryCandidate,
): Promise<void> {
  const contextBinding = prepared.semantic_query_context_binding;
  if (contextBinding) {
    const metricIds = new Set(contextBinding.metric_ids);
    const dimensionIds = new Set(contextBinding.dimension_ids);
    if (
      candidate.result_columns.some(({ semantic_binding: binding }) =>
        binding.object_kind === "METRIC"
          ? !metricIds.has(binding.object_id)
          : !dimensionIds.has(binding.object_id),
      ) ||
      (candidate.time_window && !dimensionIds.has(candidate.time_window.dimension_id))
    ) {
      throw new Text2SqlQueryRuntimeError("TEXT2SQL_SEMANTIC_BINDING_OUT_OF_RANGE");
    }
  }
  await assertPostgresqlText2SqlCandidatePolicy({
    sql: candidate.sql,
    parameter_count: candidate.parameters.length,
    allowed_relations: allowedRelationBindings(prepared),
  });
}

export interface PostgresqlText2SqlQueryRuntimeDependencies {
  readonly pool: pg.Pool;
  readonly capability: unknown;
  readonly schema_snapshots: Pick<PostgresSchemaSnapshotStore, "getSnapshot">;
  readonly datasources: {
    getDatasource(
      capability: unknown,
      datasourceId: unknown,
    ): Promise<PortResult<WorkspaceDatasource | null>>;
  };
  readonly secrets: {
    get(capability: unknown, input: unknown): Promise<PortResult<PersistedSecretRef | null>>;
  };
  readonly bind_query_evidence?: typeof buildPostgresqlQueryEvidenceSemanticBinding;
  readonly now?: () => number;
}

class Text2SqlQueryRuntimeError extends Error {
  override readonly name = "Text2SqlQueryRuntimeError";

  constructor(readonly code: string) {
    super(code);
  }
}

function value<T>(result: PortResult<T>): T {
  if (!result.ok) throw new Text2SqlQueryRuntimeError(result.error.code);
  return result.value;
}

function datasourceHash(datasource: WorkspaceDatasource) {
  return sha256ContentHash({
    datasource_id: datasource.datasource_id,
    datasource_type: datasource.type,
    status: datasource.status,
    resource_version: datasource.resource_version,
  });
}

function contextRelationIds(context: SemanticQueryContext): readonly string[] {
  const result = [
    ...new Set(
      context.physical_bindings.map(
        ({ schema_name: schemaName, table_name: tableName }) => `${schemaName}.${tableName}`,
      ),
    ),
  ].sort();
  if (result.length === 0) {
    throw new Text2SqlQueryRuntimeError("TEXT2SQL_SEMANTIC_CONTEXT_PHYSICAL_CLOSURE_EMPTY");
  }
  return result;
}

function relations(
  snapshot: PhysicalSchemaSnapshot,
  semanticQueryContext: SemanticQueryContext | null = null,
): readonly string[] {
  const available = snapshot.content.relations
    .map(({ identity }) => `${identity.schema_name}.${identity.relation_name}`)
    .sort();
  const selected = semanticQueryContext ? contextRelationIds(semanticQueryContext) : available;
  const availableSet = new Set(available);
  if (selected.some((relation) => !availableSet.has(relation))) {
    throw new Text2SqlQueryRuntimeError("TEXT2SQL_SEMANTIC_CONTEXT_SCHEMA_OUT_OF_RANGE");
  }
  const result = selected;
  if (result.length === 0 || result.length > 256 || new Set(result).size !== result.length) {
    throw new Text2SqlQueryRuntimeError("TEXT2SQL_SCHEMA_RELATION_SET_INVALID");
  }
  return Object.freeze(result);
}

function schemaProjection(snapshot: PhysicalSchemaSnapshot, allowedRelations: readonly string[]) {
  const allowed = new Set(allowedRelations);
  return snapshot.content.relations
    .filter((relation) =>
      allowed.has(`${relation.identity.schema_name}.${relation.identity.relation_name}`),
    )
    .map((relation) => ({
      relation: `${relation.identity.schema_name}.${relation.identity.relation_name}`,
      description: relation.comment,
      columns: relation.columns.map((column) => ({
        name: column.column_name,
        type: column.formatted_type,
        nullable: column.nullable,
        description: column.comment,
      })),
      primary_key: relation.primary_key?.columns ?? [],
      foreign_keys: relation.foreign_keys
        .filter((foreignKey) =>
          allowed.has(
            `${foreignKey.referenced_relation.schema_name}.${foreignKey.referenced_relation.relation_name}`,
          ),
        )
        .map((foreignKey) => ({
          columns: foreignKey.column_pairs.map(({ column_name: columnName }) => columnName),
          references: `${foreignKey.referenced_relation.schema_name}.${foreignKey.referenced_relation.relation_name}`,
          referenced_columns: foreignKey.column_pairs.map(
            ({ referenced_column_name: columnName }) => columnName,
          ),
        })),
    }));
}

function semanticProjection(
  packageDocument: SemanticContextPackage,
  catalog: FrozenSemanticReleaseCatalog,
  semanticQueryContext: SemanticQueryContext | null = null,
) {
  if (semanticQueryContext) {
    return {
      package_id: packageDocument.package_id,
      package_hash: packageDocument.package_hash,
      semantic_release: packageDocument.semantic_release,
      semantic_query_context_hash: semanticQueryContext.context_hash,
      requested_object_ids: semanticQueryContext.requested_object_ids,
      unresolved_ambiguities: semanticQueryContext.unresolved_ambiguities,
      request_scoped_interpretations: semanticQueryContext.request_scoped_interpretations ?? [],
      executable: {
        metrics: semanticQueryContext.metrics,
        dimensions: semanticQueryContext.dimensions,
        formulas: semanticQueryContext.formulas,
        relationships: semanticQueryContext.relationships,
        physical_bindings: semanticQueryContext.physical_bindings,
        time_semantics: semanticQueryContext.time_semantics,
        quality_constraints: semanticQueryContext.quality_constraints,
      },
    };
  }
  const selectedIds = new Set([
    ...packageDocument.retrieval_receipt.selected_object_ids,
    ...packageDocument.mandatory_closure.object_ids,
    ...(packageDocument.route_decision.selected_metric_id
      ? [packageDocument.route_decision.selected_metric_id]
      : []),
    ...packageDocument.route_decision.selected_ontology_ids,
  ]);
  const metrics = catalog.executable.metrics.filter(({ metric_id: metricId }) =>
    selectedIds.has(metricId),
  );
  const dimensions = catalog.executable.dimensions.filter(({ dimension_id: dimensionId }) =>
    selectedIds.has(dimensionId),
  );
  const formulaIds = new Set(
    metrics.flatMap(({ formula }) => (formula ? [formula.formula_id] : [])),
  );
  const formulas = catalog.executable.formulas.filter(
    ({ node_id: nodeId }) => selectedIds.has(nodeId) || formulaIds.has(nodeId),
  );
  const physicalObjectIds = new Set([
    ...selectedIds,
    ...metrics.flatMap((metric) =>
      metric.dependency_column_ids.map((columnId) =>
        columnId.startsWith("column.")
          ? columnId
          : `column.${columnId.includes(".") ? columnId : `${metric.table_id}.${columnId}`}`,
      ),
    ),
    ...dimensions.map((dimension) =>
      dimension.column_id.startsWith("column.")
        ? dimension.column_id
        : `column.${
            dimension.column_id.includes(".")
              ? dimension.column_id
              : `${dimension.table_id}.${dimension.column_id}`
          }`,
    ),
  ]);
  return {
    package_id: packageDocument.package_id,
    package_hash: packageDocument.package_hash,
    semantic_release: packageDocument.semantic_release,
    route_decision: packageDocument.route_decision,
    mandatory_closure: packageDocument.mandatory_closure,
    evidence: packageDocument.evidence.map((entry) => ({
      kind: entry.evidence_kind,
      id: entry.evidence_id,
      hash: entry.evidence_hash,
      summary: entry.summary,
    })),
    executable: {
      metrics,
      dimensions,
      formulas,
      physical_bindings: catalog.executable.physical_bindings.filter(({ logical_object_id: id }) =>
        physicalObjectIds.has(id),
      ),
    },
  };
}

function text2sqlContext(input: {
  readonly snapshot: PhysicalSchemaSnapshot;
  readonly semantic_context_package: SemanticContextPackage;
  readonly semantic_catalog: FrozenSemanticReleaseCatalog;
  readonly semantic_query_context?: SemanticQueryContext | null;
  readonly allowed_relations: readonly string[];
  readonly max_context_bytes: number;
}): string {
  const context = canonicalizeJson({
    schema_snapshot: {
      snapshot_id: input.snapshot.snapshot_id,
      snapshot_content_hash: input.snapshot.snapshot_content_hash,
      datasource_id: input.snapshot.content.datasource_id,
      included_schemas: input.snapshot.content.included_schemas,
      relations: schemaProjection(input.snapshot, input.allowed_relations),
    },
    semantic_context: semanticProjection(
      input.semantic_context_package,
      input.semantic_catalog,
      input.semantic_query_context ?? null,
    ),
  });
  if (new TextEncoder().encode(context).byteLength > input.max_context_bytes) {
    throw new Text2SqlQueryRuntimeError("TEXT2SQL_CONTEXT_BUDGET_EXCEEDED");
  }
  return context;
}

function sameVersionedResource(
  left: Readonly<{ resource_id: string; resource_revision: number; resource_hash: string }>,
  right: Readonly<{ resource_id: string; resource_revision: number; resource_hash: string }>,
): boolean {
  return (
    left.resource_id === right.resource_id &&
    left.resource_revision === right.resource_revision &&
    left.resource_hash === right.resource_hash
  );
}

function exactProjectionObjects<T>(input: {
  readonly projected: readonly T[];
  readonly available: readonly T[];
  readonly identity: (value: T) => string;
  readonly expected_ids: ReadonlySet<string>;
  readonly error_code: string;
}): void {
  const available = new Map(
    input.available.map((value) => [input.identity(value), canonicalizeJson(value)] as const),
  );
  const projectedIds = new Set<string>();
  for (const value of input.projected) {
    const identity = input.identity(value);
    if (projectedIds.has(identity) || available.get(identity) !== canonicalizeJson(value)) {
      throw new Text2SqlQueryRuntimeError(input.error_code);
    }
    projectedIds.add(identity);
  }
  if (
    projectedIds.size !== input.expected_ids.size ||
    [...input.expected_ids].some((identity) => !projectedIds.has(identity))
  ) {
    throw new Text2SqlQueryRuntimeError(input.error_code);
  }
}

async function validateSemanticQueryContextBinding(input: {
  readonly context: SemanticQueryContext;
  readonly effective_config: EffectiveConfig;
  readonly semantic_context_package: SemanticContextPackage;
  readonly semantic_catalog?: FrozenSemanticReleaseCatalog;
}): Promise<SemanticQueryContext> {
  let context: SemanticQueryContext;
  try {
    context = await verifySemanticQueryContext(input.context);
  } catch {
    throw new Text2SqlQueryRuntimeError("TEXT2SQL_SEMANTIC_CONTEXT_INVALID");
  }
  const config = input.effective_config;
  const packageDocument = input.semantic_context_package;
  if (
    context.scope.app_id !== config.scope.app_id ||
    context.scope.tenant_id !== config.scope.tenant_id ||
    context.scope.environment !== config.scope.environment ||
    context.run_id !== config.run_id ||
    context.semantic_domain !== packageDocument.semantic_domain ||
    !sameVersionedResource(context.semantic_release, config.semantic_release) ||
    context.semantic_release.datasource_id !== config.semantic_release.datasource_id ||
    context.semantic_release.semantic_generation !== config.semantic_release.semantic_generation ||
    !sameVersionedResource(context.datasource, config.datasource) ||
    !sameVersionedResource(context.schema_snapshot, config.schema_snapshot) ||
    context.schema_snapshot.datasource_id !== config.schema_snapshot.datasource_id ||
    context.schema_snapshot.semantic_release_id !== config.schema_snapshot.semantic_release_id ||
    context.schema_snapshot.semantic_generation !== config.schema_snapshot.semantic_generation ||
    context.semantic_context_ref.package_id !== packageDocument.package_id ||
    context.semantic_context_ref.package_hash !== packageDocument.package_hash ||
    context.semantic_context_ref.retrieval_receipt_hash !==
      packageDocument.retrieval_receipt.receipt_hash ||
    context.semantic_context_ref.inference_receipt_hash !==
      packageDocument.inference_receipt.receipt_hash
  ) {
    throw new Text2SqlQueryRuntimeError("TEXT2SQL_SEMANTIC_CONTEXT_BINDING_STALE");
  }
  if (context.unresolved_ambiguities.length > 0) {
    throw new Text2SqlQueryRuntimeError("TEXT2SQL_SEMANTIC_CONTEXT_AMBIGUOUS");
  }
  const catalog = input.semantic_catalog;
  if (!catalog) return context;
  if (
    catalog.release_identity.semantic_domain !== context.semantic_domain ||
    catalog.release_identity.release_id !== context.semantic_release.resource_id ||
    catalog.release_identity.release_digest !== context.semantic_release.resource_hash ||
    catalog.release_identity.release_generation !== context.semantic_release.semantic_generation ||
    catalog.release_identity.datasource_id !== context.datasource.resource_id
  ) {
    throw new Text2SqlQueryRuntimeError("TEXT2SQL_SEMANTIC_CONTEXT_RELEASE_STALE");
  }

  const requestedIds = new Set(context.requested_object_ids);
  const ambiguousIds = new Set(
    context.unresolved_ambiguities.flatMap(({ candidate_ids: candidateIds }) => candidateIds),
  );
  const selectedIds = new Set([...requestedIds].filter((id) => !ambiguousIds.has(id)));
  const allowedIds = new Set([
    ...packageDocument.retrieval_receipt.selected_object_ids,
    ...packageDocument.inference_receipt.mandatory_object_ids,
    ...packageDocument.inference_receipt.mandatory_relationship_ids,
  ]);

  const metricById = new Map(
    catalog.executable.metrics.map((metric) => [metric.metric_id, metric] as const),
  );
  const dimensionById = new Map(
    catalog.executable.dimensions.map((dimension) => [dimension.dimension_id, dimension] as const),
  );
  const formulaById = new Map(
    catalog.executable.formulas.map((formula) => [formula.node_id, formula] as const),
  );
  const relationshipById = new Map(
    catalog.relationships.relationships.map(
      (relationship) => [relationship.relationship_id, relationship] as const,
    ),
  );
  const timeById = new Map(
    catalog.restrictions.time_semantics.map(
      (timeDomain) => [timeDomain.time_domain_id, timeDomain] as const,
    ),
  );
  const qualityById = new Map(
    catalog.restrictions.quality_constraints.map(
      (constraint) => [constraint.constraint_id, constraint] as const,
    ),
  );
  const allowedRequestedIds = new Set(allowedIds);
  for (const requestedId of requestedIds) {
    if (!allowedIds.has(requestedId)) continue;
    const timeDomainId = metricById.get(requestedId)?.time_domain?.time_domain_id;
    if (timeDomainId) allowedRequestedIds.add(timeDomainId);
  }
  if ([...requestedIds].some((id) => !allowedRequestedIds.has(id))) {
    throw new Text2SqlQueryRuntimeError("TEXT2SQL_SEMANTIC_CONTEXT_OUT_OF_RANGE");
  }
  const allKnownIds = new Set([
    ...metricById.keys(),
    ...dimensionById.keys(),
    ...formulaById.keys(),
    ...relationshipById.keys(),
    ...timeById.keys(),
    ...qualityById.keys(),
  ]);
  if ([...requestedIds].some((id) => !allKnownIds.has(id))) {
    throw new Text2SqlQueryRuntimeError("TEXT2SQL_SEMANTIC_CONTEXT_OUT_OF_RANGE");
  }

  const expectedMetricIds = new Set([...selectedIds].filter((id) => metricById.has(id)));
  const expectedDimensionIds = new Set([...selectedIds].filter((id) => dimensionById.has(id)));
  for (let changed = true; changed; ) {
    changed = false;
    for (const dimensionId of [...expectedDimensionIds]) {
      const parentId = dimensionById.get(dimensionId)?.parent_dimension_id;
      if (parentId && !expectedDimensionIds.has(parentId)) {
        if (!dimensionById.has(parentId)) {
          throw new Text2SqlQueryRuntimeError("TEXT2SQL_SEMANTIC_CONTEXT_OUT_OF_RANGE");
        }
        expectedDimensionIds.add(parentId);
        changed = true;
      }
    }
  }
  const expectedFormulaIds = new Set([...selectedIds].filter((id) => formulaById.has(id)));
  const expectedTimeIds = new Set([...selectedIds].filter((id) => timeById.has(id)));
  for (const metricId of expectedMetricIds) {
    const metric = metricById.get(metricId);
    if (metric?.formula) expectedFormulaIds.add(metric.formula.formula_id);
    if (metric?.time_domain) expectedTimeIds.add(metric.time_domain.time_domain_id);
  }
  const expectedRelationshipIds = new Set([
    ...[...selectedIds].filter((id) => relationshipById.has(id)),
    ...packageDocument.inference_receipt.mandatory_relationship_ids.filter((id) =>
      relationshipById.has(id),
    ),
  ]);
  const expectedQualityIds = new Set([...selectedIds].filter((id) => qualityById.has(id)));

  exactProjectionObjects({
    projected: context.metrics,
    available: catalog.executable.metrics,
    identity: (metric) => metric.metric_id,
    expected_ids: expectedMetricIds,
    error_code: "TEXT2SQL_SEMANTIC_CONTEXT_METRIC_CLOSURE_INVALID",
  });
  exactProjectionObjects({
    projected: context.dimensions,
    available: catalog.executable.dimensions,
    identity: (dimension) => dimension.dimension_id,
    expected_ids: expectedDimensionIds,
    error_code: "TEXT2SQL_SEMANTIC_CONTEXT_DIMENSION_CLOSURE_INVALID",
  });
  exactProjectionObjects({
    projected: context.formulas,
    available: catalog.executable.formulas,
    identity: (formula) => formula.node_id,
    expected_ids: expectedFormulaIds,
    error_code: "TEXT2SQL_SEMANTIC_CONTEXT_FORMULA_CLOSURE_INVALID",
  });
  exactProjectionObjects({
    projected: context.relationships,
    available: catalog.relationships.relationships,
    identity: (relationship) => relationship.relationship_id,
    expected_ids: expectedRelationshipIds,
    error_code: "TEXT2SQL_SEMANTIC_CONTEXT_RELATIONSHIP_CLOSURE_INVALID",
  });
  exactProjectionObjects({
    projected: context.time_semantics,
    available: catalog.restrictions.time_semantics,
    identity: (timeDomain) => timeDomain.time_domain_id,
    expected_ids: expectedTimeIds,
    error_code: "TEXT2SQL_SEMANTIC_CONTEXT_TIME_CLOSURE_INVALID",
  });
  exactProjectionObjects({
    projected: context.quality_constraints,
    available: catalog.restrictions.quality_constraints,
    identity: (constraint) => constraint.constraint_id,
    expected_ids: expectedQualityIds,
    error_code: "TEXT2SQL_SEMANTIC_CONTEXT_QUALITY_CLOSURE_INVALID",
  });

  const relevantBindingIds = new Set<string>([
    ...context.metrics.flatMap((metric) => [
      metric.metric_id,
      metric.table_id,
      metric.column_id,
      ...metric.dependency_column_ids,
      ...(metric.time_column_id ? [metric.time_column_id] : []),
    ]),
    ...context.dimensions.flatMap((dimension) => [
      dimension.dimension_id,
      dimension.table_id,
      dimension.column_id,
    ]),
    ...context.formulas.map(({ node_id: id }) => id),
    ...context.relationships.flatMap((relationship) => [
      relationship.relationship_id,
      relationship.left_table_id,
      relationship.right_table_id,
      ...relationship.left_column_ids,
      ...relationship.right_column_ids,
    ]),
  ]);
  const expectedBindings = catalog.executable.physical_bindings.filter((binding) =>
    relevantBindingIds.has(binding.logical_object_id),
  );
  exactProjectionObjects({
    projected: context.physical_bindings,
    available: catalog.executable.physical_bindings,
    identity: (binding) =>
      [
        binding.logical_object_id,
        binding.logical_object_type,
        binding.schema_name,
        binding.table_name,
        binding.column_name ?? "",
      ].join("\0"),
    expected_ids: new Set(
      expectedBindings.map((binding) =>
        [
          binding.logical_object_id,
          binding.logical_object_type,
          binding.schema_name,
          binding.table_name,
          binding.column_name ?? "",
        ].join("\0"),
      ),
    ),
    error_code: "TEXT2SQL_SEMANTIC_CONTEXT_PHYSICAL_CLOSURE_INVALID",
  });
  return context;
}

type LocalTarget = Readonly<{ reader_role: string }>;

function localTarget(input: unknown): LocalTarget {
  if (
    typeof input !== "object" ||
    input === null ||
    !("reader_role" in input) ||
    typeof input.reader_role !== "string" ||
    !POSTGRES_IDENTIFIER.test(input.reader_role)
  ) {
    throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_TARGET_INVALID");
  }
  return { reader_role: input.reader_role };
}

function jsonValue(
  input: unknown,
  postgresqlTypeId?: number,
): null | string | number | boolean | object {
  if (
    input === null ||
    typeof input === "string" ||
    typeof input === "number" ||
    typeof input === "boolean"
  ) {
    if (typeof input === "number" && !Number.isFinite(input)) {
      throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_RESULT_INVALID");
    }
    return input;
  }
  if (typeof input === "bigint") return input.toString();
  if (input instanceof Date) {
    if (!Number.isFinite(input.getTime())) {
      throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_RESULT_INVALID");
    }
    if (postgresqlTypeId === POSTGRES_DATE_OID) {
      // node-postgres decodes DATE at local midnight. UTC serialization can move the
      // calendar value to the previous day, so recover the original local components.
      const year = input.getFullYear();
      if (year < 0 || year > 9_999) {
        throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_RESULT_INVALID");
      }
      return `${String(year).padStart(4, "0")}-${String(input.getMonth() + 1).padStart(
        2,
        "0",
      )}-${String(input.getDate()).padStart(2, "0")}`;
    }
    return input.toISOString();
  }
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    return `hex:${Buffer.from(input).toString("hex")}`;
  }
  if (typeof input === "object") return JSON.parse(canonicalizeJson(input)) as object;
  throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_RESULT_INVALID");
}

function classifiedPostgresqlExecutionError(error: unknown): DatasourceAdapterPolicyError | null {
  const sqlState =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : null;
  if (!sqlState) return null;
  if (sqlState === "42601") {
    return new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_SQL_REJECTED");
  }
  if (sqlState === "42803") {
    return new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_SQL_GROUPING_ERROR");
  }
  if (["42804", "42809", "42846", "42883", "42P18"].includes(sqlState)) {
    return new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_SQL_TYPE_ERROR");
  }
  if (sqlState === "42703") {
    return new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_SQL_COLUMN_NOT_FOUND");
  }
  if (sqlState === "42P01") {
    return new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_SQL_RELATION_NOT_FOUND");
  }
  if (sqlState.startsWith("22")) {
    return new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_SQL_DATA_ERROR");
  }
  return null;
}

function createManagedPostgresqlTransport(pool: pg.Pool): DatasourceAdapterTransport {
  const transaction = async <T>(
    targetInput: unknown,
    timeoutMs: number,
    execute: (client: pg.PoolClient) => Promise<T>,
  ) => {
    const target = localTarget(targetInput);
    const client = await pool.connect();
    try {
      await client.query("begin read only");
      await client.query(`set local role ${target.reader_role}`);
      await client.query("set local search_path = pg_catalog");
      await client.query(`set local statement_timeout = '${timeoutMs}ms'`);
      await client.query("set local lock_timeout = '1000ms'");
      const result = await execute(client);
      await client.query("rollback");
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  };
  const transport: DatasourceAdapterTransport = {
    async scanSchema() {
      throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_SCHEMA_SCAN_NOT_ALLOWED");
    },
    async explain({ request, target, signal }) {
      if (signal.aborted) throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_TIMEOUT");
      try {
        await transaction(target, request.limits.timeout_ms, async (client) => {
          await client.query({
            text: `explain (format json) ${request.statement}`,
            values: [...request.parameters],
          });
        });
      } catch (error) {
        throw classifiedPostgresqlExecutionError(error) ?? error;
      }
    },
    async execute({ request, target, signal }) {
      if (signal.aborted) throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_TIMEOUT");
      try {
        return await transaction(target, request.limits.timeout_ms, async (client) => {
          const result = await client.query<Record<string, unknown>>({
            text: `select * from (${request.statement}) as __data_agent_candidate limit ${request.limits.max_rows + 1}`,
            values: [...request.parameters],
          });
          const fieldNames = result.fields.map(({ name }) => name);
          if (new Set(fieldNames).size !== fieldNames.length) {
            throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_RESULT_INVALID");
          }
          const fieldTypeByName = new Map(
            result.fields.map((field) => [field.name, field.dataTypeID] as const),
          );
          return {
            columns: result.fields.map((field) => ({
              name: field.name,
              type: field.dataTypeID === undefined ? "unknown" : String(field.dataTypeID),
            })),
            rows: result.rows.map((row) =>
              Object.fromEntries(
                Object.entries(row).map(([key, child]) => [
                  key,
                  jsonValue(child, fieldTypeByName.get(key)),
                ]),
              ),
            ),
          };
        });
      } catch (error) {
        if (error instanceof DatasourceAdapterPolicyError) throw error;
        throw classifiedPostgresqlExecutionError(error) ?? error;
      }
    },
  };
  return Object.freeze(transport);
}

export function createPostgresqlText2SqlQueryRuntime(
  dependencies: PostgresqlText2SqlQueryRuntimeDependencies,
): Text2SqlQueryRuntimePort {
  const bindQueryEvidence =
    dependencies.bind_query_evidence ?? buildPostgresqlQueryEvidenceSemanticBinding;
  const descriptor = buildBuiltinDatasourceAdapterDescriptors().then((descriptors) => {
    const postgresql = descriptors.find(({ adapter_id: adapterId }) => adapterId === "postgresql");
    if (!postgresql) throw new Text2SqlQueryRuntimeError("POSTGRESQL_ADAPTER_NOT_REGISTERED");
    return postgresql;
  });

  const runtime: Text2SqlQueryRuntimePort = {
    async prepare(input) {
      const {
        effective_config: config,
        semantic_context,
        semantic_catalog,
        semantic_query_context: semanticQueryContextInput = null,
        max_context_bytes,
      } = input;
      const semantic_context_package = semantic_context.package;
      const semanticQueryContext = semanticQueryContextInput
        ? await validateSemanticQueryContextBinding({
            context: semanticQueryContextInput,
            effective_config: config,
            semantic_context_package,
            semantic_catalog,
          })
        : null;
      if (
        semanticQueryContext &&
        (semanticQueryContext.semantic_context_ref.receipt_id !==
          semantic_context.receipt.receipt_id ||
          semanticQueryContext.semantic_context_ref.receipt_hash !==
            semantic_context.receipt.receipt_hash)
      ) {
        throw new Text2SqlQueryRuntimeError("TEXT2SQL_SEMANTIC_CONTEXT_RECEIPT_STALE");
      }
      const snapshot = value(
        await dependencies.schema_snapshots.getSnapshot(
          dependencies.capability,
          config.schema_snapshot.resource_id,
        ),
      );
      const datasource = value(
        await dependencies.datasources.getDatasource(
          dependencies.capability,
          config.datasource.resource_id,
        ),
      );
      if (!datasource) throw new Text2SqlQueryRuntimeError("TEXT2SQL_DATASOURCE_NOT_FOUND");
      const credential = datasource.credential_ref;
      if (
        datasource.type !== "postgresql" ||
        datasource.status !== "ACTIVE" ||
        datasource.resource_version !== config.datasource.resource_revision ||
        (await datasourceHash(datasource)) !== config.datasource.resource_hash ||
        !credential ||
        credential.rotation_state !== "ACTIVE"
      ) {
        throw new Text2SqlQueryRuntimeError("TEXT2SQL_DATASOURCE_BINDING_STALE");
      }
      const secret = value(
        await dependencies.secrets.get(dependencies.capability, {
          ref: `secretref:${credential.secret_ref_id}`,
          expected_version: credential.secret_version,
        }),
      );
      if (secret?.status !== "ACTIVE" || secret.version !== credential.secret_version) {
        throw new Text2SqlQueryRuntimeError("TEXT2SQL_SECRET_REF_STALE");
      }
      if (
        snapshot.snapshot_id !== config.schema_snapshot.resource_id ||
        snapshot.snapshot_content_hash !== config.schema_snapshot.resource_hash ||
        snapshot.content.datasource_id !== config.datasource.resource_id ||
        semantic_context_package.schema_snapshot.resource_id !== snapshot.snapshot_id ||
        semantic_context_package.schema_snapshot.resource_hash !== snapshot.snapshot_content_hash ||
        semantic_context_package.semantic_release.resource_id !==
          config.semantic_release.resource_id ||
        semantic_context_package.semantic_release.resource_hash !==
          config.semantic_release.resource_hash
      ) {
        throw new Text2SqlQueryRuntimeError("TEXT2SQL_CONTEXT_BINDING_STALE");
      }
      if (!datasource.username || !POSTGRES_IDENTIFIER.test(datasource.username)) {
        throw new Text2SqlQueryRuntimeError("TEXT2SQL_READER_ROLE_INVALID");
      }
      const allowedRelations = relations(snapshot, semanticQueryContext);
      const targetCapabilityHash = await sha256ContentHash({
        datasource: config.datasource,
        schema_snapshot: config.schema_snapshot,
        semantic_query_context_hash: semanticQueryContext?.context_hash ?? null,
        credential_ref: credential,
        secret_ref: { ref: secret.ref, version: secret.version, status: secret.status },
        reader_role: datasource.username,
      });
      return Object.freeze({
        context_text: text2sqlContext({
          snapshot,
          semantic_context_package,
          semantic_catalog,
          semantic_query_context: semanticQueryContext,
          allowed_relations: allowedRelations,
          max_context_bytes,
        }),
        datasource_id: datasource.datasource_id,
        schema_snapshot_id: snapshot.snapshot_id,
        schema_snapshot_hash: snapshot.snapshot_content_hash,
        allowed_relations: allowedRelations,
        target_capability_hash: targetCapabilityHash,
        reader_role: datasource.username,
        semantic_query_context_hash: semanticQueryContext?.context_hash ?? null,
        ...(semanticQueryContext
          ? {
              semantic_query_context_binding: {
                metric_ids: semanticQueryContext.metrics.map(({ metric_id: id }) => id),
                dimension_ids: semanticQueryContext.dimensions.map(({ dimension_id: id }) => id),
              },
            }
          : {}),
        binding_authority: {
          physical_snapshot: snapshot,
          semantic_context,
          semantic_catalog,
          datasource_ref: config.datasource,
        },
      });
    },

    async compileCandidate(input) {
      const parameterized = await parameterizePostgresqlText2SqlCandidate({
        sql: input.candidate.sql,
        parameters: input.candidate.parameters,
      });
      const compiled = text2sqlQueryCandidateSchema.parse({
        ...input.candidate,
        ...parameterized,
      });
      await validateCandidate(input.prepared, compiled);
      return compiled;
    },

    async execute(input) {
      const adapterDescriptor = await descriptor;
      const prepared = input.prepared;
      if (
        prepared.datasource_id !== input.effective_config.datasource.resource_id ||
        prepared.schema_snapshot_id !== input.effective_config.schema_snapshot.resource_id ||
        prepared.schema_snapshot_hash !== input.effective_config.schema_snapshot.resource_hash
      ) {
        throw new Text2SqlQueryRuntimeError("TEXT2SQL_PREPARED_CONTEXT_STALE");
      }
      if (!prepared.binding_authority) {
        throw new Text2SqlQueryRuntimeError("TEXT2SQL_BINDING_AUTHORITY_REQUIRED");
      }
      const request = await buildGovernedDatasourceQueryRequest({
        schema_version: "governed-datasource-query@1.0.0",
        scope: {
          app_id: input.effective_config.scope.app_id,
          tenant_id: input.effective_config.scope.tenant_id,
          environment: input.effective_config.scope.environment,
        },
        query_id: crypto.randomUUID(),
        datasource_id: prepared.datasource_id,
        adapter_ref: {
          adapter_id: adapterDescriptor.adapter_id,
          adapter_revision: adapterDescriptor.revision,
          descriptor_hash: adapterDescriptor.descriptor_hash,
          dialect: adapterDescriptor.dialect,
        },
        target_capability_hash: prepared.target_capability_hash,
        statement: input.candidate.sql,
        parameters: input.candidate.parameters,
        allowed_relations: prepared.allowed_relations,
        limits: {
          timeout_ms: input.timeout_ms,
          max_rows: input.max_rows,
          max_bytes: input.max_bytes,
        },
      });
      const adapter = await createGovernedDatasourceAdapter({
        descriptor: adapterDescriptor,
        target_authority: {
          authorize: async (candidate) =>
            candidate.request_hash === request.request_hash &&
            candidate.target_capability_hash === prepared.target_capability_hash
              ? {
                  ok: true,
                  value: {
                    target_capability_hash: prepared.target_capability_hash,
                    target: { reader_role: prepared.reader_role },
                  },
                }
              : {
                  ok: false,
                  error: {
                    code: "DATASOURCE_ADAPTER_TARGET_MISMATCH",
                    message: "Run-bound datasource target binding is stale.",
                    retryable: false,
                  },
                },
        },
        transport: createManagedPostgresqlTransport(dependencies.pool),
        validate_statement: (candidateRequest) =>
          validateCandidate(prepared, {
            ...input.candidate,
            sql: candidateRequest.statement,
            parameters: [...candidateRequest.parameters],
          }),
        ...(dependencies.now ? { now: dependencies.now } : {}),
      });
      const executed = await adapter.execute(request, input.signal);
      const result = value(executed);
      const actualColumns = result.columns.map(({ name }) => name);
      const expectedColumns = input.candidate.result_columns.map(({ name }) => name);
      if (
        actualColumns.length !== expectedColumns.length ||
        actualColumns.some((name, index) => name !== expectedColumns[index])
      ) {
        throw new Text2SqlQueryRuntimeError("TEXT2SQL_RESULT_SHAPE_MISMATCH");
      }
      return Object.freeze({
        result,
        semantic_binding: await bindQueryEvidence({
          candidate: input.candidate,
          result,
          physical_snapshot: prepared.binding_authority.physical_snapshot,
          semantic_context: prepared.binding_authority.semantic_context,
          semantic_catalog: prepared.binding_authority.semantic_catalog,
          datasource_ref: prepared.binding_authority.datasource_ref,
          target_binding_hash: prepared.target_capability_hash,
        }),
      });
    },
  };
  return Object.freeze(runtime);
}

export const postgresqlText2SqlQueryRuntimeInternals = Object.freeze({
  datasourceHash,
  relations,
  allowedRelationBindings,
  classifiedPostgresqlExecutionError,
  schemaProjection,
  semanticProjection,
  text2sqlContext,
  validateSemanticQueryContextBinding,
});
