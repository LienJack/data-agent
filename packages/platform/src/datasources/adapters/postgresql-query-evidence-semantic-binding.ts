import {
  type Text2SqlQueryCandidate,
  text2sqlQueryCandidateSchema,
} from "@data-agent/contracts/agents";
import {
  buildQueryEvidenceSemanticBinding,
  computePublishedMetricFormulaHash,
  formulaNodeSchema,
  type PhysicalBindingEntry,
  type QueryEvidenceSemanticBinding,
  type SemanticDimension,
  type SemanticMetric,
} from "@data-agent/contracts/artifacts";
import {
  type PhysicalSchemaSnapshot,
  physicalSchemaSnapshotSchema,
} from "@data-agent/contracts/catalog";
import { canonicalizeJson, sha256ContentHash } from "@data-agent/contracts/common";
import {
  type SemanticContextCommitResult,
  verifySemanticContextCommitResult,
} from "@data-agent/contracts/context";
import {
  type GovernedDatasourceQueryResult,
  verifyGovernedDatasourceQueryResult,
} from "@data-agent/contracts/datasources";
import {
  assertPostgresqlTemporalSelectionDeclared,
  type PostgresqlTemporalColumn,
} from "./postgresql-temporal-selection-policy.js";
import {
  hasExactPostgresqlPhysicalColumnProjections,
  resolvePostgresqlFormulaProjectionSlots,
} from "./postgresql-text2sql-policy.js";

export interface QueryEvidenceSemanticCatalog {
  readonly release_identity: {
    readonly semantic_domain: string;
    readonly release_id: string;
    readonly release_digest: string;
  };
  readonly executable: {
    readonly metrics: readonly SemanticMetric[];
    readonly dimensions: readonly SemanticDimension[];
    readonly formulas: readonly Readonly<{ readonly node_id: string } & Record<string, unknown>>[];
    readonly physical_bindings: readonly PhysicalBindingEntry[];
  };
}

export interface PostgresqlQueryEvidenceSemanticBindingInput {
  readonly candidate: Text2SqlQueryCandidate;
  readonly result: GovernedDatasourceQueryResult;
  readonly physical_snapshot: PhysicalSchemaSnapshot;
  readonly semantic_context: SemanticContextCommitResult;
  readonly semantic_catalog: QueryEvidenceSemanticCatalog;
  readonly datasource_ref: {
    readonly resource_id: string;
    readonly resource_revision: number;
    readonly resource_hash: string;
  };
  readonly target_binding_hash: string;
  readonly formula_dependency_metric_ids?: readonly string[];
}

export class PostgresqlQueryEvidenceSemanticBindingError extends TypeError {
  override readonly name = "PostgresqlQueryEvidenceSemanticBindingError";

  constructor(
    readonly code: string,
    readonly observed_result_types?: readonly Text2SqlQueryCandidate["result_columns"][number]["semantic_type"][],
  ) {
    super(code);
  }
}

function reject(code: string): never {
  throw new PostgresqlQueryEvidenceSemanticBindingError(code);
}

function logicalTypeForOid(
  oid: string,
): Text2SqlQueryCandidate["result_columns"][number]["semantic_type"] {
  if (["20", "21", "23", "26", "700", "701", "790", "1700"].includes(oid)) return "NUMBER";
  if (oid === "16") return "BOOLEAN";
  if (oid === "1082") return "DATE";
  if (["1114", "1184"].includes(oid)) return "DATETIME";
  if (["18", "19", "25", "1042", "1043", "2950"].includes(oid)) return "STRING";
  reject("QUERY_EVIDENCE_RESULT_TYPE_UNSUPPORTED");
}

function logicalTypeForPhysicalType(
  typeName: string,
): Text2SqlQueryCandidate["result_columns"][number]["semantic_type"] {
  if (["int2", "int4", "int8", "float4", "float8", "money", "numeric", "oid"].includes(typeName)) {
    return "NUMBER";
  }
  if (typeName === "bool") return "BOOLEAN";
  if (typeName === "date") return "DATE";
  if (["timestamp", "timestamptz"].includes(typeName)) return "DATETIME";
  if (["bpchar", "char", "name", "text", "uuid", "varchar"].includes(typeName)) return "STRING";
  reject("QUERY_EVIDENCE_PHYSICAL_TYPE_UNSUPPORTED");
}

function selectedSemanticObjects(context: SemanticContextCommitResult): ReadonlySet<string> {
  return new Set([
    ...context.package.retrieval_receipt.selected_object_ids,
    ...context.package.mandatory_closure.object_ids,
    ...(context.package.route_decision.selected_metric_id
      ? [context.package.route_decision.selected_metric_id]
      : []),
  ]);
}

function physicalColumnId(tableId: string, columnId: string): string {
  const qualified = columnId.includes(".") ? columnId : `${tableId}.${columnId}`;
  return qualified.startsWith("column.") ? qualified : `column.${qualified}`;
}

function selectedPhysicalColumns(
  context: SemanticContextCommitResult,
  catalog: QueryEvidenceSemanticCatalog,
): ReadonlySet<string> {
  const selected = selectedSemanticObjects(context);
  const physicalIds = new Set([...selected].filter((id) => id.startsWith("column.")));
  for (const metric of catalog.executable.metrics) {
    if (!selected.has(metric.metric_id)) continue;
    for (const columnId of [
      metric.column_id,
      ...metric.dependency_column_ids,
      ...(metric.time_column_id ? [metric.time_column_id] : []),
    ]) {
      physicalIds.add(physicalColumnId(metric.table_id, columnId));
    }
  }
  for (const dimension of catalog.executable.dimensions) {
    if (!selected.has(dimension.dimension_id)) continue;
    physicalIds.add(physicalColumnId(dimension.table_id, dimension.column_id));
  }
  return physicalIds;
}

function physicalSourceIdentity(source: {
  readonly schema_name: string;
  readonly relation_name: string;
  readonly column_name: string;
}) {
  return `${source.schema_name}\0${source.relation_name}\0${source.column_name}`;
}

function physicalSources(input: {
  readonly object_id: string;
  readonly object_kind: "METRIC" | "DIMENSION" | "PHYSICAL_COLUMN";
  readonly table_id: string;
  readonly column_ids: readonly string[];
  readonly datasource_id: string;
  readonly bindings: readonly PhysicalBindingEntry[];
  readonly snapshot: PhysicalSchemaSnapshot;
}) {
  const declaredColumns = [...new Set(input.column_ids)].map((columnId) => {
    const qualified = columnId.includes(".") ? columnId : `${input.table_id}.${columnId}`;
    const parts = qualified.split(".");
    const columnName = parts.pop();
    const tableName = parts.join(".");
    if (!columnName || !tableName || tableName !== input.table_id) {
      reject("QUERY_EVIDENCE_PHYSICAL_BINDING_INVALID");
    }
    return {
      table_name: tableName,
      column_name: columnName,
      logical_ids: new Set([columnId, qualified, `column.${qualified}`]),
    };
  });
  if (declaredColumns.length === 0) reject("QUERY_EVIDENCE_PHYSICAL_BINDING_INVALID");
  const resolvedSources = input.bindings
    .filter((binding) => {
      const declared = declaredColumns.find(
        (column) =>
          column.table_name === binding.table_name && column.column_name === binding.column_name,
      );
      return (
        declared !== undefined &&
        binding.datasource_id === input.datasource_id &&
        binding.binding_lifecycle === "active" &&
        binding.column_name !== null &&
        ((binding.logical_object_id === input.object_id &&
          binding.logical_object_type === input.object_kind.toLowerCase()) ||
          (binding.logical_object_type === "column" &&
            declared.logical_ids.has(binding.logical_object_id)))
      );
    })
    .map((binding) => {
      const relation = input.snapshot.content.relations.find(
        ({ identity }) =>
          identity.schema_name === binding.schema_name &&
          identity.relation_name === binding.table_name,
      );
      const column = relation?.columns.find(
        ({ column_name: columnName }) => columnName === binding.column_name,
      );
      if (!relation || !column) reject("QUERY_EVIDENCE_PHYSICAL_BINDING_STALE");
      return {
        schema_name: binding.schema_name,
        relation_name: binding.table_name,
        column_name: binding.column_name as string,
        formatted_type: column.formatted_type,
        nullable: column.nullable,
        logical_type: logicalTypeForPhysicalType(column.type_identity.type_name),
      };
    });
  const sources = [
    ...new Map(
      resolvedSources.map((source) => [physicalSourceIdentity(source), source] as const),
    ).values(),
  ].sort((left, right) =>
    physicalSourceIdentity(left).localeCompare(physicalSourceIdentity(right)),
  );
  if (
    sources.length === 0 ||
    declaredColumns.some(
      (column) =>
        !sources.some(
          (source) =>
            source.relation_name === column.table_name && source.column_name === column.column_name,
        ),
    )
  ) {
    reject("QUERY_EVIDENCE_PHYSICAL_BINDING_INVALID");
  }
  return sources;
}

/** Restriction metadata is not permission to select a temporal Dimension. */
export async function assertPostgresqlQueryTemporalSelection(
  input: Pick<
    PostgresqlQueryEvidenceSemanticBindingInput,
    "candidate" | "physical_snapshot" | "semantic_context" | "semantic_catalog" | "datasource_ref"
  >,
): Promise<void> {
  if (input.candidate.time_window) return;
  const snapshot = input.physical_snapshot;
  const temporalColumns: PostgresqlTemporalColumn[] = snapshot.content.relations.flatMap(
    (relation) =>
      relation.columns
        .filter((column) =>
          ["date", "timestamp", "timestamptz"].includes(column.type_identity.type_name),
        )
        .map((column) => ({ ...relation.identity, column_name: column.column_name })),
  );
  const selected = selectedSemanticObjects(input.semantic_context);
  const catalog = input.semantic_catalog.executable;
  for (const metric of catalog.metrics) {
    if (!selected.has(metric.metric_id) || !metric.time_column_id) continue;
    const timeId = physicalColumnId(metric.table_id, metric.time_column_id);
    const qualifiedTimeColumn = timeId.slice("column.".length);
    const separator = qualifiedTimeColumn.lastIndexOf(".");
    const timeTable = qualifiedTimeColumn.slice(0, separator);
    const timeColumn = qualifiedTimeColumn.slice(separator + 1);
    if (separator <= 0 || !timeColumn) reject("QUERY_EVIDENCE_PHYSICAL_BINDING_INVALID");
    const sameTable = timeTable === metric.table_id;
    // A same-table Metric identifies text time via its own dependency binding, even
    // without a time Dimension. Cross-table time must instead have its exact column
    // binding; never rebase an explicit qualified time source onto the Metric table.
    const sources = physicalSources({
      object_id: sameTable ? metric.metric_id : timeId,
      object_kind: sameTable ? "METRIC" : "PHYSICAL_COLUMN",
      table_id: timeTable,
      column_ids: sameTable ? metric.dependency_column_ids : [qualifiedTimeColumn],
      datasource_id: input.datasource_ref.resource_id,
      bindings: catalog.physical_bindings,
      snapshot,
    });
    for (const source of sources) {
      const relation = snapshot.content.relations.find(
        ({ identity }) =>
          identity.schema_name === source.schema_name &&
          identity.relation_name === source.relation_name,
      );
      if (!relation?.columns.some((column) => column.column_name === timeColumn)) {
        reject("QUERY_EVIDENCE_PHYSICAL_BINDING_STALE");
      }
      temporalColumns.push({ ...source, column_name: timeColumn });
    }
  }
  for (const dimension of catalog.dimensions) {
    if (
      !selected.has(dimension.dimension_id) ||
      !["date", "timestamp", "timestamptz"].includes(dimension.data_type)
    )
      continue;
    temporalColumns.push(
      ...physicalSources({
        object_id: dimension.dimension_id,
        object_kind: "DIMENSION",
        table_id: dimension.table_id,
        column_ids: [dimension.column_id],
        datasource_id: input.datasource_ref.resource_id,
        bindings: catalog.physical_bindings,
        snapshot,
      }),
    );
  }
  await assertPostgresqlTemporalSelectionDeclared({
    sql: input.candidate.sql,
    has_declared_window: false,
    temporal_columns: temporalColumns,
  });
}

/** Shared by pre-I/O compilation and post-query evidence acceptance. Never constructs SQL. */
export async function resolvePostgresqlPublishedFormulaBindings(
  input: Pick<
    PostgresqlQueryEvidenceSemanticBindingInput,
    | "candidate"
    | "physical_snapshot"
    | "semantic_context"
    | "semantic_catalog"
    | "datasource_ref"
    | "formula_dependency_metric_ids"
  >,
) {
  const outputs = input.candidate.result_columns.filter(
    ({ semantic_binding }) => semantic_binding.object_kind === "FORMULA",
  );
  if (outputs.length === 0) return [];
  const selected = selectedSemanticObjects(input.semantic_context);
  const acceptedMetrics = input.formula_dependency_metric_ids
    ? new Set(input.formula_dependency_metric_ids)
    : selected;
  const catalog = input.semantic_catalog;
  const dependencies = catalog.executable.metrics
    .filter(({ metric_id }) => selected.has(metric_id) && acceptedMetrics.has(metric_id))
    .flatMap((metric) =>
      metric.dependency_column_ids.flatMap((columnId) => {
        const sources = physicalSources({
          object_id: metric.metric_id,
          object_kind: "METRIC",
          table_id: metric.table_id,
          column_ids: [columnId],
          datasource_id: input.datasource_ref.resource_id,
          bindings: catalog.executable.physical_bindings,
          snapshot: input.physical_snapshot,
        });
        const qualifiedId = physicalColumnId(metric.table_id, columnId);
        return sources.flatMap((source) =>
          [
            ...new Set([
              columnId,
              qualifiedId,
              qualifiedId.slice("column.".length),
              source.column_name,
            ]),
          ].map((slot_id) => ({ slot_id, metric, source })),
        );
      }),
    );
  return Promise.all(
    outputs.map(async (output) => {
      const formulas = catalog.executable.formulas.filter(
        ({ node_id }) => node_id === output.semantic_binding.object_id,
      );
      const parsed = formulaNodeSchema.safeParse(formulas[0]);
      if (
        formulas.length !== 1 ||
        !parsed.success ||
        !selected.has(output.semantic_binding.object_id) ||
        output.semantic_type !== "NUMBER" ||
        parsed.data.lifecycle !== "ACTIVE" ||
        !["numeric", "integer"].includes(parsed.data.return_type)
      )
        reject("QUERY_EVIDENCE_FORMULA_BINDING_INVALID");
      const formula = parsed.data;
      const usedSlots = await resolvePostgresqlFormulaProjectionSlots({
        sql: input.candidate.sql,
        parameters: input.candidate.parameters,
        output_name: output.name,
        expression: formula.expression,
        slots: dependencies.map(({ slot_id, source }) => ({
          slot_id,
          physical_type: source.formatted_type,
          ...source,
        })),
      });
      if (!usedSlots) reject("TEXT2SQL_PUBLISHED_FORMULA_EXPRESSION_MISMATCH");
      const used = dependencies.filter(({ slot_id }) => usedSlots.includes(slot_id));
      const grains = new Map(
        used.map(({ metric }) => [canonicalizeJson(metric.grain), metric.grain]),
      );
      const grain = grains.values().next().value;
      if (
        !grain ||
        grains.size !== 1 ||
        used.some(({ source }) => source.logical_type !== "NUMBER")
      ) {
        reject("QUERY_EVIDENCE_FORMULA_BINDING_INVALID");
      }
      const sources = [
        ...new Map(
          used.map(({ source }) => [
            canonicalizeJson([source.schema_name, source.relation_name, source.column_name]),
            source,
          ]),
        ).entries(),
      ]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([, { logical_type: _logicalType, ...source }]) => source);
      const dependencyMetrics = [
        ...new Map(used.map(({ metric }) => [metric.metric_id, metric])).values(),
      ].sort((left, right) => left.metric_id.localeCompare(right.metric_id));
      const slotBindings = [
        ...new Map(
          used.map(({ slot_id, metric, source }) => {
            const binding = { slot_id, metric_id: metric.metric_id, source };
            return [canonicalizeJson(binding), binding];
          }),
        ).entries(),
      ]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([, binding]) => binding);
      return {
        column: {
          output_name: output.name,
          logical_type: "NUMBER" as const,
          nullable: true,
          semantic_role: "FORMULA" as const,
          semantic_object_id: formula.node_id,
          formula_hash: await sha256ContentHash({
            hash_domain: "published-formula-physical-binding@1.0.0",
            semantic_release_hash: input.semantic_context.package.semantic_release.resource_hash,
            formula,
            metrics: dependencyMetrics,
            slot_bindings: slotBindings,
          }),
          aggregate: null,
          grain: { grain_id: grain.grain_id, granularity: grain.granularity },
          physical_sources: sources,
        },
        dependency_metrics: dependencyMetrics,
      };
    }),
  );
}

function exactParameter(candidate: Text2SqlQueryCandidate, index: number): string {
  const value = candidate.parameters[index - 1];
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    reject("QUERY_EVIDENCE_TIME_WINDOW_INVALID");
  }
  return value;
}

function validTimeValue(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/u.test(value)) return false;
  return Number.isFinite(Date.parse(value.length === 10 ? `${value}T00:00:00.000Z` : value));
}

function quotedIdentifierPattern(value: string): string {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return `(?:\\b${escaped}\\b|"${escaped}")`;
}

function temporalCastPattern(): string {
  return `::\\s*(?:pg_catalog\\.)?(?:date|timestamp|timestamptz)\\b`;
}

function temporalParameterExpression(index: number): string {
  const reference = `\\$${index}(?!\\d)`;
  const temporalType = `(?:pg_catalog\\.)?(?:date|timestamp|timestamptz)\\b`;
  return `(?:${reference}(?:\\s*::\\s*${temporalType})?|CAST\\s*\\(\\s*${reference}\\s+AS\\s+${temporalType}\\s*\\))`;
}

function hasExplicitTemporalSourceCast(input: {
  readonly sql: string;
  readonly column_name: string;
}): boolean {
  const column = quotedIdentifierPattern(input.column_name);
  return new RegExp(`${column}\\s*${temporalCastPattern()}`, "iu").test(input.sql);
}

function hasTemporalBucketForSource(input: {
  readonly sql: string;
  readonly column_name: string;
}): boolean {
  const column = quotedIdentifierPattern(input.column_name);
  return new RegExp(`\\bdate_trunc\\s*\\([^)]*${column}`, "iu").test(input.sql);
}

function hasHalfOpenPredicate(input: {
  readonly sql: string;
  readonly column_name: string;
  readonly start_parameter: number;
  readonly end_parameter: number;
}): boolean {
  const column = quotedIdentifierPattern(input.column_name);
  const columnExpression = `${column}\\s*(?:${temporalCastPattern()})?`;
  const start = temporalParameterExpression(input.start_parameter);
  const end = temporalParameterExpression(input.end_parameter);
  const lowerBound = new RegExp(
    `(?:${columnExpression}\\s*>=\\s*${start}|${start}\\s*<=\\s*${columnExpression})`,
    "iu",
  );
  const upperBound = new RegExp(
    `(?:${columnExpression}\\s*<\\s*${end}|${end}\\s*>\\s*${columnExpression})`,
    "iu",
  );
  return lowerBound.test(input.sql) && upperBound.test(input.sql);
}

function timeWindow(input: {
  readonly candidate: Text2SqlQueryCandidate;
  readonly metrics: readonly SemanticMetric[];
  readonly dimensions: readonly SemanticDimension[];
  readonly bindings: readonly PhysicalBindingEntry[];
  readonly snapshot: PhysicalSchemaSnapshot;
  readonly datasource_id: string;
}) {
  const declared = input.candidate.time_window;
  if (!declared) return null;
  const dimension = input.dimensions.find(({ dimension_id: id }) => id === declared.dimension_id);
  if (!dimension) reject("QUERY_EVIDENCE_TIME_DIMENSION_INVALID");
  const sources = physicalSources({
    object_id: dimension.dimension_id,
    object_kind: "DIMENSION",
    table_id: dimension.table_id,
    column_ids: [dimension.column_id],
    datasource_id: input.datasource_id,
    bindings: input.bindings,
    snapshot: input.snapshot,
  });
  const temporalMetrics = input.metrics.filter(
    (metric) =>
      metric.time_domain !== null &&
      metric.time_column_id !== null &&
      (metric.time_column_id === dimension.column_id ||
        metric.time_column_id.endsWith(`.${dimension.column_id}`) ||
        dimension.column_id.endsWith(`.${metric.time_column_id}`)),
  );
  if (temporalMetrics.length === 0) reject("QUERY_EVIDENCE_TIME_DIMENSION_INVALID");
  const start = exactParameter(input.candidate, declared.start_parameter);
  const end = exactParameter(input.candidate, declared.end_parameter);
  if (
    !validTimeValue(start) ||
    !validTimeValue(end) ||
    Date.parse(start.length === 10 ? `${start}T00:00:00.000Z` : start) >=
      Date.parse(end.length === 10 ? `${end}T00:00:00.000Z` : end) ||
    !sources.some((source) =>
      hasHalfOpenPredicate({
        sql: input.candidate.sql,
        column_name: source.column_name,
        start_parameter: declared.start_parameter,
        end_parameter: declared.end_parameter,
      }),
    )
  ) {
    reject("QUERY_EVIDENCE_TIME_WINDOW_INVALID");
  }
  const domains = temporalMetrics
    .map(({ time_domain: domain }) => domain)
    .filter((domain) => domain !== null);
  const timezone = domains[0]?.timezone ?? null;
  if (domains.some((domain) => domain.timezone !== timezone)) {
    reject("QUERY_EVIDENCE_TIME_WINDOW_INVALID");
  }
  const startTime = Date.parse(start);
  const endTime = Date.parse(end);
  for (const domain of domains) {
    const minTime = domain.min_time === null ? null : Date.parse(domain.min_time);
    const maxTime = domain.max_time === null ? null : Date.parse(domain.max_time);
    if (
      (minTime !== null && !Number.isFinite(minTime)) ||
      (maxTime !== null && !Number.isFinite(maxTime)) ||
      (minTime !== null && maxTime !== null && minTime >= maxTime)
    ) {
      reject("QUERY_EVIDENCE_TIME_DOMAIN_INVALID");
    }
    if ((minTime !== null && startTime < minTime) || (maxTime !== null && endTime > maxTime)) {
      reject("QUERY_EVIDENCE_TIME_WINDOW_OUT_OF_RANGE");
    }
  }
  return {
    dimension_id: dimension.dimension_id,
    start,
    end,
    semantics: "HALF_OPEN" as const,
    timezone,
  };
}

export async function buildPostgresqlQueryEvidenceSemanticBinding(
  input: PostgresqlQueryEvidenceSemanticBindingInput,
): Promise<QueryEvidenceSemanticBinding> {
  const [candidate, result, context] = await Promise.all([
    Promise.resolve(text2sqlQueryCandidateSchema.parse(input.candidate)),
    verifyGovernedDatasourceQueryResult(input.result),
    verifySemanticContextCommitResult(input.semantic_context),
  ]);
  const snapshot = physicalSchemaSnapshotSchema.parse(input.physical_snapshot);
  if ((await sha256ContentHash(snapshot.content)) !== snapshot.snapshot_content_hash) {
    reject("QUERY_EVIDENCE_SCHEMA_SNAPSHOT_HASH_MISMATCH");
  }
  const packageDocument = context.package;
  if (
    result.columns.length !== candidate.result_columns.length ||
    result.columns.some((column, index) => column.name !== candidate.result_columns[index]?.name)
  ) {
    reject("QUERY_EVIDENCE_RESULT_BINDING_MISMATCH");
  }
  const observedResultTypes = result.columns.map((column) => logicalTypeForOid(column.type));
  if (
    observedResultTypes.some(
      (type, index) => type !== candidate.result_columns[index]?.semantic_type,
    )
  ) {
    throw new PostgresqlQueryEvidenceSemanticBindingError(
      "QUERY_EVIDENCE_RESULT_BINDING_MISMATCH",
      Object.freeze(observedResultTypes),
    );
  }
  if (
    snapshot.snapshot_id !== packageDocument.schema_snapshot.resource_id ||
    snapshot.snapshot_content_hash !== packageDocument.schema_snapshot.resource_hash ||
    snapshot.content.datasource_id !== input.datasource_ref.resource_id ||
    packageDocument.semantic_release.datasource_id !== input.datasource_ref.resource_id ||
    input.semantic_catalog.release_identity.semantic_domain !== packageDocument.semantic_domain ||
    input.semantic_catalog.release_identity.release_id !==
      packageDocument.semantic_release.resource_id ||
    input.semantic_catalog.release_identity.release_digest !==
      packageDocument.semantic_release.resource_hash ||
    input.datasource_ref.resource_id !== packageDocument.semantic_release.datasource_id
  ) {
    reject("QUERY_EVIDENCE_AUTHORITY_BINDING_MISMATCH");
  }

  const selected = selectedSemanticObjects(context);
  await assertPostgresqlQueryTemporalSelection(input);
  const selectedColumns = selectedPhysicalColumns(context, input.semantic_catalog);
  const metrics = input.semantic_catalog.executable.metrics;
  const dimensions = input.semantic_catalog.executable.dimensions;
  const formulas = input.semantic_catalog.executable.formulas;
  const bindings = input.semantic_catalog.executable.physical_bindings;
  const formulaBindings = await resolvePostgresqlPublishedFormulaBindings(input);
  const columns = await Promise.all(
    candidate.result_columns.map(async (column) => {
      const declaration = column.semantic_binding;
      if (
        declaration.object_kind === "PHYSICAL_COLUMN"
          ? !selectedColumns.has(declaration.object_id)
          : !selected.has(declaration.object_id)
      ) {
        reject("QUERY_EVIDENCE_SEMANTIC_OBJECT_NOT_SELECTED");
      }
      if (declaration.object_kind === "PHYSICAL_COLUMN") {
        const parts = declaration.object_id.split(".");
        const columnName = parts.pop();
        const prefix = parts.shift();
        const tableId = parts.join(".");
        if (prefix !== "column" || !tableId || !columnName) {
          reject("QUERY_EVIDENCE_PHYSICAL_BINDING_INVALID");
        }
        const sources = physicalSources({
          object_id: declaration.object_id,
          object_kind: declaration.object_kind,
          table_id: tableId,
          column_ids: [`${tableId}.${columnName}`],
          datasource_id: input.datasource_ref.resource_id,
          bindings,
          snapshot,
        });
        if (
          sources.length !== 1 ||
          sources.some(
            ({ logical_type: logicalType, column_name: sourceColumn }) =>
              logicalType !== column.semantic_type &&
              !(
                logicalType === "STRING" &&
                (column.semantic_type === "DATE" || column.semantic_type === "DATETIME") &&
                hasExplicitTemporalSourceCast({
                  sql: candidate.sql,
                  column_name: sourceColumn,
                })
              ),
          )
        ) {
          reject("QUERY_EVIDENCE_PHYSICAL_BINDING_INVALID");
        }
        return {
          output_name: column.name,
          logical_type: column.semantic_type,
          nullable: sources.some(({ nullable }) => nullable),
          semantic_role: "PHYSICAL_COLUMN" as const,
          semantic_object_id: declaration.object_id,
          formula_hash: null,
          aggregate: null,
          grain: {
            grain_id: `grain.physical.${tableId}`,
            granularity: "atomic" as const,
          },
          physical_sources: sources.map(({ logical_type: _logicalType, ...source }) => source),
        };
      }
      if (declaration.object_kind === "METRIC") {
        const metric = metrics.find(({ metric_id: id }) => id === declaration.object_id);
        if (!metric) reject("QUERY_EVIDENCE_METRIC_BINDING_INVALID");
        const sources = physicalSources({
          object_id: declaration.object_id,
          object_kind: declaration.object_kind,
          table_id: metric.table_id,
          column_ids: metric.dependency_column_ids,
          datasource_id: input.datasource_ref.resource_id,
          bindings,
          snapshot,
        });
        if (
          column.semantic_type !== "NUMBER" ||
          sources.some(({ logical_type: logicalType }) => logicalType !== "NUMBER")
        ) {
          reject("QUERY_EVIDENCE_METRIC_BINDING_INVALID");
        }
        const formula = metric.formula
          ? (formulas.find(({ node_id: id }) => id === metric.formula?.formula_id) ?? null)
          : null;
        if (metric.formula && !formula) reject("QUERY_EVIDENCE_METRIC_FORMULA_INVALID");
        return {
          output_name: column.name,
          logical_type: column.semantic_type,
          nullable:
            metric.aggregation === "count" || metric.aggregation === "count_distinct"
              ? false
              : sources.some(({ nullable }) => nullable),
          semantic_role: "METRIC" as const,
          semantic_object_id: metric.metric_id,
          formula_hash: await computePublishedMetricFormulaHash({
            semantic_release_hash: packageDocument.semantic_release.resource_hash,
            metric,
            formula,
          }),
          aggregate: metric.aggregation,
          grain: {
            grain_id: metric.grain.grain_id,
            granularity: metric.grain.granularity,
          },
          physical_sources: sources.map(({ logical_type: _logicalType, ...source }) => source),
        };
      }
      if (declaration.object_kind === "FORMULA") {
        const formula = formulaBindings.find(
          ({ column: bound }) => bound.output_name === column.name,
        );
        if (!formula) reject("QUERY_EVIDENCE_FORMULA_BINDING_INVALID");
        return formula.column;
      }
      const dimension = dimensions.find(({ dimension_id: id }) => id === declaration.object_id);
      if (!dimension) reject("QUERY_EVIDENCE_DIMENSION_BINDING_INVALID");
      const sources = physicalSources({
        object_id: declaration.object_id,
        object_kind: declaration.object_kind,
        table_id: dimension.table_id,
        column_ids: [dimension.column_id],
        datasource_id: input.datasource_ref.resource_id,
        bindings,
        snapshot,
      });
      const expectedType =
        dimension.data_type === "date"
          ? "DATE"
          : dimension.data_type === "timestamp" || dimension.data_type === "timestamptz"
            ? "DATETIME"
            : dimension.data_type === "integer" || dimension.data_type === "numeric"
              ? "NUMBER"
              : dimension.data_type === "boolean"
                ? "BOOLEAN"
                : "STRING";
      const outputTypeCompatible =
        column.semantic_type === expectedType ||
        (expectedType === "DATE" &&
          column.semantic_type === "DATETIME" &&
          sources.every(({ column_name: columnName }) =>
            hasTemporalBucketForSource({ sql: candidate.sql, column_name: columnName }),
          ));
      if (
        !outputTypeCompatible ||
        sources.some(
          ({ logical_type: logicalType, column_name: columnName }) =>
            logicalType !== expectedType &&
            !(
              logicalType === "STRING" &&
              (expectedType === "DATE" || expectedType === "DATETIME") &&
              hasExplicitTemporalSourceCast({
                sql: candidate.sql,
                column_name: columnName,
              })
            ),
        )
      ) {
        reject("QUERY_EVIDENCE_DIMENSION_BINDING_INVALID");
      }
      return {
        output_name: column.name,
        logical_type: column.semantic_type,
        nullable: sources.some(({ nullable }) => nullable),
        semantic_role: "DIMENSION" as const,
        semantic_object_id: dimension.dimension_id,
        formula_hash: null,
        aggregate: null,
        grain: {
          grain_id: dimension.grain.grain_id,
          granularity: dimension.grain.granularity,
        },
        physical_sources: sources.map(({ logical_type: _logicalType, ...source }) => source),
      };
    }),
  );

  if (
    !(await hasExactPostgresqlPhysicalColumnProjections({
      sql: candidate.sql,
      columns: columns.flatMap((column) =>
        column.semantic_role === "PHYSICAL_COLUMN"
          ? column.physical_sources.map((source) => ({
              output_name: column.output_name,
              schema_name: source.schema_name,
              relation_name: source.relation_name,
              column_name: source.column_name,
            }))
          : [],
      ),
    }))
  ) {
    reject("QUERY_EVIDENCE_PHYSICAL_BINDING_INVALID");
  }

  return buildQueryEvidenceSemanticBinding({
    protocol_version: "query-evidence-semantic-binding@1.0.0",
    semantic_release_ref: packageDocument.semantic_release,
    semantic_context_ref: {
      package_id: packageDocument.package_id,
      package_hash: packageDocument.package_hash,
      receipt_id: context.receipt.receipt_id,
      receipt_hash: context.receipt.receipt_hash,
    },
    schema_snapshot_ref: packageDocument.schema_snapshot,
    datasource_ref: input.datasource_ref,
    target_binding_hash: input.target_binding_hash,
    columns,
    time_window: timeWindow({
      candidate,
      metrics: [
        ...formulaBindings.flatMap(({ dependency_metrics }) => dependency_metrics),
        ...columns
          .filter(({ semantic_role: role }) => role === "METRIC")
          .map(({ semantic_object_id: objectId }) =>
            metrics.find(({ metric_id: id }) => id === objectId),
          )
          .filter((metric): metric is SemanticMetric => metric !== undefined),
      ],
      dimensions,
      bindings,
      snapshot,
      datasource_id: input.datasource_ref.resource_id,
    }),
  });
}

export const postgresqlQueryEvidenceSemanticBindingInternals = Object.freeze({
  hasHalfOpenPredicate,
  logicalTypeForOid,
  logicalTypeForPhysicalType,
  hasExplicitTemporalSourceCast,
  hasTemporalBucketForSource,
  temporalParameterExpression,
  physicalSourceIdentity,
  selectedSemanticObjects,
  selectedPhysicalColumns,
  validTimeValue,
});
