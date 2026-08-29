import {
  type Text2SqlQueryCandidate,
  text2sqlQueryCandidateSchema,
} from "@data-agent/contracts/agents";
import {
  buildQueryEvidenceSemanticBinding,
  computePublishedMetricFormulaHash,
  type PhysicalBindingEntry,
  type QueryEvidenceSemanticBinding,
  type SemanticDimension,
  type SemanticMetric,
} from "@data-agent/contracts/artifacts";
import {
  type PhysicalSchemaSnapshot,
  physicalSchemaSnapshotSchema,
} from "@data-agent/contracts/catalog";
import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  type SemanticContextCommitResult,
  verifySemanticContextCommitResult,
} from "@data-agent/contracts/context";
import {
  type GovernedDatasourceQueryResult,
  verifyGovernedDatasourceQueryResult,
} from "@data-agent/contracts/datasources";

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
}

export class PostgresqlQueryEvidenceSemanticBindingError extends TypeError {
  override readonly name = "PostgresqlQueryEvidenceSemanticBindingError";

  constructor(readonly code: string) {
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

function physicalSourceIdentity(source: {
  readonly schema_name: string;
  readonly relation_name: string;
  readonly column_name: string;
}) {
  return `${source.schema_name}\0${source.relation_name}\0${source.column_name}`;
}

function physicalSources(input: {
  readonly object_id: string;
  readonly object_kind: "METRIC" | "DIMENSION";
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

function hasExplicitTemporalSourceCast(input: {
  readonly sql: string;
  readonly column_name: string;
}): boolean {
  const column = quotedIdentifierPattern(input.column_name);
  return new RegExp(`${column}\\s*${temporalCastPattern()}`, "iu").test(input.sql);
}

function hasHalfOpenPredicate(input: {
  readonly sql: string;
  readonly column_name: string;
  readonly start_parameter: number;
  readonly end_parameter: number;
}): boolean {
  const column = quotedIdentifierPattern(input.column_name);
  const columnExpression = `${column}\\s*(?:${temporalCastPattern()})?`;
  const parameter = (index: number) => `\\$${index}(?!\\d)(?:::[A-Za-z_][A-Za-z0-9_.]*)?`;
  const start = parameter(input.start_parameter);
  const end = parameter(input.end_parameter);
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
    result.columns.some(
      (column, index) =>
        column.name !== candidate.result_columns[index]?.name ||
        logicalTypeForOid(column.type) !== candidate.result_columns[index]?.semantic_type,
    )
  ) {
    reject("QUERY_EVIDENCE_RESULT_BINDING_MISMATCH");
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
  const metrics = input.semantic_catalog.executable.metrics;
  const dimensions = input.semantic_catalog.executable.dimensions;
  const formulas = input.semantic_catalog.executable.formulas;
  const bindings = input.semantic_catalog.executable.physical_bindings;
  const columns = await Promise.all(
    candidate.result_columns.map(async (column) => {
      const declaration = column.semantic_binding;
      if (!selected.has(declaration.object_id)) {
        reject("QUERY_EVIDENCE_SEMANTIC_OBJECT_NOT_SELECTED");
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
      if (
        column.semantic_type !== expectedType ||
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
      metrics: columns
        .filter(({ semantic_role: role }) => role === "METRIC")
        .map(({ semantic_object_id: objectId }) =>
          metrics.find(({ metric_id: id }) => id === objectId),
        )
        .filter((metric): metric is SemanticMetric => metric !== undefined),
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
  physicalSourceIdentity,
  selectedSemanticObjects,
  validTimeValue,
});
