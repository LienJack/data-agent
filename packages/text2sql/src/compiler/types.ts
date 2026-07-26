import type { SqlArtifactPayloadContract } from "@data-agent/contracts";
import type { GroundingPackageDraft } from "../grounding/types.js";
import type { AuthoritativeLogicalPlanBinding } from "./internal.js";

export const POSTGRESQL_COMPILER_VERSION = "postgresql-compiler@1.1.0" as const;

export const POSTGRESQL_COMPILATION_REASON_CODES = [
  "UNSUPPORTED_DIALECT",
  "POSTGRESQL_COMPILER_INPUT_INVALID",
  "POSTGRESQL_COMPILER_LOGICAL_PLAN_AUTHORITY_REQUIRED",
  "POSTGRESQL_COMPILER_LOGICAL_PLAN_VALIDATION_REQUIRED",
  "POSTGRESQL_COMPILER_GROUNDING_HASH_MISMATCH",
  "POSTGRESQL_COMPILER_POLICY_BINDING_INVALID",
  "POSTGRESQL_COMPILER_POLICY_BINDING_UNSUPPORTED",
  "POSTGRESQL_COMPILER_POLICY_PREDICATE_COVERAGE_MISMATCH",
  "POSTGRESQL_COMPILER_IDENTIFIER_NOT_GROUNDED",
  "POSTGRESQL_COMPILER_ALIAS_COLLISION",
  "POSTGRESQL_COMPILER_DATAFLOW_INVALID",
  "POSTGRESQL_COMPILER_PARAMETER_NOT_FOUND",
  "POSTGRESQL_COMPILER_PARAMETER_VALUE_INVALID",
  "POSTGRESQL_COMPILER_PARAMETER_TYPE_CONFLICT",
  "POSTGRESQL_COMPILER_MEASURE_UNSUPPORTED",
  "POSTGRESQL_COMPILER_PREAGGREGATION_UNSUPPORTED",
  "POSTGRESQL_COMPILER_ROOT_NOT_PROJECT",
  "POSTGRESQL_COMPILER_AST_SAFETY_VIOLATION",
  "POSTGRESQL_COMPILER_INTERNAL_ERROR",
] as const;

export type PostgresqlCompilationReasonCode = (typeof POSTGRESQL_COMPILATION_REASON_CODES)[number];

export type PostgresqlDataType =
  | "boolean"
  | "date"
  | "integer"
  | "numeric"
  | "text"
  | "timestamp"
  | "timestamptz"
  | "uuid";

export type PostgresqlGroundedIdentifier = Readonly<{
  origin: "GROUNDING_PHYSICAL_NAME";
  logical_id: string;
  value: string;
}>;

export type PostgresqlGeneratedIdentifier = Readonly<{
  origin: "COMPILER_GENERATED";
  value: string;
}>;

export type PostgresqlValidatedOutputIdentifier = Readonly<{
  origin: "VALIDATED_LOGICAL_ALIAS";
  logical_alias: string;
  value: string;
}>;

export type PostgresqlIdentifier =
  | PostgresqlGroundedIdentifier
  | PostgresqlGeneratedIdentifier
  | PostgresqlValidatedOutputIdentifier;

export type PostgresqlExpression =
  | Readonly<{
      kind: "column";
      relation: PostgresqlGeneratedIdentifier;
      column: PostgresqlIdentifier;
    }>
  | Readonly<{
      kind: "parameter";
      placeholder: `$${number}`;
      data_type: PostgresqlDataType;
    }>
  | Readonly<{
      kind: "aggregate";
      function: "AVG" | "COUNT" | "MAX" | "MIN" | "SUM";
      distinct: boolean;
      argument: PostgresqlExpression;
    }>
  | Readonly<{
      kind: "coalesce-zero";
      expression: PostgresqlExpression;
    }>;

export type PostgresqlCondition =
  | Readonly<{
      kind: "comparison";
      left: PostgresqlExpression;
      operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
      right: PostgresqlExpression;
    }>
  | Readonly<{
      kind: "membership";
      field: PostgresqlExpression;
      values: readonly PostgresqlExpression[];
    }>
  | Readonly<{
      kind: "null-check";
      field: PostgresqlExpression;
      operator: "is_null" | "is_not_null";
    }>;

export type PostgresqlRelationAst =
  | Readonly<{
      kind: "grounded-table";
      table: PostgresqlGroundedIdentifier;
      alias: PostgresqlGeneratedIdentifier;
    }>
  | Readonly<{
      kind: "cte";
      cte: PostgresqlGeneratedIdentifier;
      alias: PostgresqlGeneratedIdentifier;
    }>;

export type PostgresqlSelectAst = Readonly<{
  kind: "select";
  columns: readonly Readonly<{
    expression: PostgresqlExpression;
    alias: PostgresqlIdentifier;
  }>[];
  from: PostgresqlRelationAst;
  joins: readonly Readonly<{
    join_type: "inner" | "left";
    relation: PostgresqlRelationAst;
    conditions: readonly PostgresqlCondition[];
  }>[];
  where: readonly PostgresqlCondition[];
  group_by: readonly PostgresqlExpression[];
}>;

export type PostgresqlQueryAst = Readonly<{
  kind: "postgresql-query";
  compiler_version: typeof POSTGRESQL_COMPILER_VERSION;
  ctes: readonly Readonly<{
    operation_id: string;
    operation: "scan" | "filter" | "join" | "aggregate" | "project";
    name: PostgresqlGeneratedIdentifier;
    query: PostgresqlSelectAst;
  }>[];
  root: PostgresqlSelectAst;
}>;

export type PostgresqlParameterOrderEntry = Readonly<{
  position: number;
  placeholder: `$${number}`;
  parameter_key: string;
  source: "literal" | "policy" | "time";
  data_type: PostgresqlDataType;
}>;

export type PostgresqlCompilationProof = Readonly<{
  compiler_version: typeof POSTGRESQL_COMPILER_VERSION;
  dialect: "postgresql";
  logical_plan_ref: SqlArtifactPayloadContract["logical_plan_ref"];
  logical_plan_hash: `sha256:${string}`;
  grounding_hash: GroundingPackageDraft["grounding_hash"];
  policy_version: GroundingPackageDraft["policy_version"];
  policy_binding_hash: `sha256:${string}`;
  policy_binding_authority: "LOGICAL_PLAN_REF_AND_SERVER_PRINCIPAL_CAPABILITY";
  query_hash: SqlArtifactPayloadContract["query_hash"];
  identifier_authority: "GROUNDING_PHYSICAL_NAME_ONLY";
  alias_strategy: "VALIDATED_LOGICAL_OUTPUT_ALIAS_QUOTED";
  parameterization: "POSTGRESQL_POSITIONAL_ALL_VALUES";
  time_semantics: "HALF_OPEN_GTE_LT";
  search_path_binding: "REQUIRED_AT_EXECUTION";
  forbidden_constructs: readonly ["NATURAL_JOIN", "BETWEEN", "SELECT_INTO", "LOCKING_CLAUSE"];
  identifiers: readonly Readonly<{
    kind: "table" | "column";
    logical_id: string;
    physical_name: string;
  }>[];
  operations: readonly Readonly<{
    operation_id: string;
    operation: "scan" | "filter" | "join" | "aggregate" | "project";
    cte_name: string;
  }>[];
  output_columns: readonly Readonly<{
    logical_alias: string;
    sql_alias: string;
  }>[];
}>;

declare const postgresqlCompilationBrand: unique symbol;
const postgresqlCompilations = new WeakSet<object>();

export type PostgresqlCompilation = Readonly<{
  dialect: "postgresql";
  sql_artifact: SqlArtifactPayloadContract;
  ast: PostgresqlQueryAst;
  proof: PostgresqlCompilationProof;
  parameter_order: readonly PostgresqlParameterOrderEntry[];
  readonly [postgresqlCompilationBrand]: true;
}>;

export function isPostgresqlCompilation(value: unknown): value is PostgresqlCompilation {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    postgresqlCompilations.has(value)
  );
}

/** @internal Compiler authority registration; do not re-export from the package boundary. */
export function registerPostgresqlCompilation(
  value: Omit<PostgresqlCompilation, typeof postgresqlCompilationBrand>,
): PostgresqlCompilation {
  postgresqlCompilations.add(value);
  return value as PostgresqlCompilation;
}

export interface PostgresqlCompilerInput {
  readonly logical_plan_binding: AuthoritativeLogicalPlanBinding;
  readonly grounding: GroundingPackageDraft;
}

export interface SqlDialectCompilerInput extends PostgresqlCompilerInput {
  readonly dialect: string;
}

export type PostgresqlCompilationResult =
  | Readonly<{
      state: "COMPILED";
      compilation: PostgresqlCompilation;
    }>
  | Readonly<{
      state: "FAILED";
      reason_code: Exclude<
        PostgresqlCompilationReasonCode,
        "UNSUPPORTED_DIALECT" | "POSTGRESQL_COMPILER_PREAGGREGATION_UNSUPPORTED"
      >;
    }>
  | Readonly<{
      state: "UNSUPPORTED";
      reason_code: "UNSUPPORTED_DIALECT" | "POSTGRESQL_COMPILER_PREAGGREGATION_UNSUPPORTED";
    }>;
