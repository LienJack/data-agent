import { postgresqlOutputAliasSchema } from "@data-agent/contracts";
import type {
  PostgresqlCondition,
  PostgresqlExpression,
  PostgresqlGeneratedIdentifier,
  PostgresqlIdentifier,
  PostgresqlQueryAst,
  PostgresqlRelationAst,
  PostgresqlSelectAst,
  PostgresqlValidatedOutputIdentifier,
} from "./types.js";

function assertNever(_value: never): never {
  throw new TypeError("POSTGRESQL_AST_NODE_UNHANDLED");
}

export function quotePostgresqlIdentifier(value: string): string {
  if (value.length === 0 || value.includes("\u0000")) {
    throw new TypeError("POSTGRESQL_IDENTIFIER_INVALID");
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function renderIdentifier(identifier: PostgresqlIdentifier): string {
  if (identifier.origin === "COMPILER_GENERATED" && !/^[a-z][a-z0-9_]*$/.test(identifier.value)) {
    throw new TypeError("POSTGRESQL_GENERATED_IDENTIFIER_INVALID");
  }
  if (
    identifier.origin === "VALIDATED_LOGICAL_ALIAS" &&
    (identifier.value !== identifier.logical_alias ||
      identifier.value.length === 0 ||
      identifier.value.includes("\u0000"))
  ) {
    throw new TypeError("POSTGRESQL_VALIDATED_OUTPUT_IDENTIFIER_INVALID");
  }
  return quotePostgresqlIdentifier(identifier.value);
}

function renderDataType(expression: Extract<PostgresqlExpression, { kind: "parameter" }>): string {
  switch (expression.data_type) {
    case "boolean":
      return "pg_catalog.bool";
    case "date":
      return "pg_catalog.date";
    case "integer":
      return "pg_catalog.int4";
    case "numeric":
      return "pg_catalog.numeric";
    case "text":
      return "pg_catalog.text";
    case "timestamp":
      return "pg_catalog.timestamp";
    case "timestamptz":
      return "pg_catalog.timestamptz";
    case "uuid":
      return "pg_catalog.uuid";
    default:
      return assertNever(expression.data_type);
  }
}

function renderExpression(expression: PostgresqlExpression): string {
  switch (expression.kind) {
    case "column":
      return `${renderIdentifier(expression.relation)}.${renderIdentifier(expression.column)}`;
    case "parameter":
      if (!/^\$[1-9][0-9]*$/.test(expression.placeholder)) {
        throw new TypeError("POSTGRESQL_PARAMETER_PLACEHOLDER_INVALID");
      }
      return `${expression.placeholder}::${renderDataType(expression)}`;
    case "aggregate": {
      const distinct = expression.distinct ? "DISTINCT " : "";
      return `pg_catalog.${expression.function}(${distinct}${renderExpression(expression.argument)})`;
    }
    case "coalesce-zero":
      return `COALESCE(${renderExpression(expression.expression)}, 0)`;
    default:
      return assertNever(expression);
  }
}

function renderComparisonOperator(
  operator: Extract<PostgresqlCondition, { kind: "comparison" }>["operator"],
): string {
  switch (operator) {
    case "eq":
      return "OPERATOR(pg_catalog.=)";
    case "neq":
      return "OPERATOR(pg_catalog.<>)";
    case "gt":
      return "OPERATOR(pg_catalog.>)";
    case "gte":
      return "OPERATOR(pg_catalog.>=)";
    case "lt":
      return "OPERATOR(pg_catalog.<)";
    case "lte":
      return "OPERATOR(pg_catalog.<=)";
    default:
      return assertNever(operator);
  }
}

function renderCondition(condition: PostgresqlCondition): string {
  switch (condition.kind) {
    case "comparison":
      return `${renderExpression(condition.left)} ${renderComparisonOperator(condition.operator)} ${renderExpression(condition.right)}`;
    case "membership": {
      if (condition.values.length === 0) {
        throw new TypeError("POSTGRESQL_MEMBERSHIP_VALUES_EMPTY");
      }
      const field = renderExpression(condition.field);
      const equality = renderComparisonOperator("eq");
      return `(${condition.values
        .map((value) => `${field} ${equality} ${renderExpression(value)}`)
        .join(" OR ")})`;
    }
    case "null-check":
      return `${renderExpression(condition.field)} ${condition.operator === "is_null" ? "IS NULL" : "IS NOT NULL"}`;
    default:
      return assertNever(condition);
  }
}

function renderRelation(relation: PostgresqlRelationAst): string {
  switch (relation.kind) {
    case "grounded-table":
      return `${renderIdentifier(relation.table)} AS ${renderIdentifier(relation.alias)}`;
    case "cte":
      return `${renderIdentifier(relation.cte)} AS ${renderIdentifier(relation.alias)}`;
    default:
      return assertNever(relation);
  }
}

function renderJoinType(joinType: "inner" | "left"): string {
  switch (joinType) {
    case "inner":
      return "INNER JOIN";
    case "left":
      return "LEFT JOIN";
    default:
      return assertNever(joinType);
  }
}

function renderConditionList(prefix: string, conditions: readonly PostgresqlCondition[]): string[] {
  if (conditions.length === 0) return [];
  return [
    prefix,
    ...conditions.map((condition, index) => {
      const conjunction = index === 0 ? "  " : "  AND ";
      return `${conjunction}${renderCondition(condition)}`;
    }),
  ];
}

function renderSelect(select: PostgresqlSelectAst): string {
  if (select.columns.length === 0) {
    throw new TypeError("POSTGRESQL_SELECT_COLUMNS_EMPTY");
  }
  const lines = [
    "SELECT",
    ...select.columns.map(
      (column, index) =>
        `  ${renderExpression(column.expression)} AS ${renderIdentifier(column.alias)}${index === select.columns.length - 1 ? "" : ","}`,
    ),
    `FROM ${renderRelation(select.from)}`,
  ];
  for (const join of select.joins) {
    if (join.conditions.length === 0) {
      throw new TypeError("POSTGRESQL_JOIN_CONDITION_EMPTY");
    }
    lines.push(
      `${renderJoinType(join.join_type)} ${renderRelation(join.relation)}`,
      ...renderConditionList("ON", join.conditions),
    );
  }
  lines.push(...renderConditionList("WHERE", select.where));
  if (select.group_by.length > 0) {
    lines.push(
      "GROUP BY",
      ...select.group_by.map(
        (expression, index) =>
          `  ${renderExpression(expression)}${index === select.group_by.length - 1 ? "" : ","}`,
      ),
    );
  }
  return lines.join("\n");
}

function indent(value: string): string {
  return value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

export function renderPostgresqlQueryAst(ast: PostgresqlQueryAst): string {
  if (ast.ctes.length === 0) {
    throw new TypeError("POSTGRESQL_CTE_LIST_EMPTY");
  }
  const withClause = ast.ctes
    .map((cte) => `${renderIdentifier(cte.name)} AS (\n${indent(renderSelect(cte.query))}\n)`)
    .join(",\n");
  return `WITH\n${withClause}\n${renderSelect(ast.root)}`;
}

export function generatedIdentifier(value: string): PostgresqlGeneratedIdentifier {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) {
    throw new TypeError("POSTGRESQL_GENERATED_IDENTIFIER_INVALID");
  }
  return {
    origin: "COMPILER_GENERATED",
    value,
  };
}

export function validatedOutputIdentifier(value: string): PostgresqlValidatedOutputIdentifier {
  if (!postgresqlOutputAliasSchema.safeParse(value).success) {
    throw new TypeError("POSTGRESQL_VALIDATED_OUTPUT_IDENTIFIER_INVALID");
  }
  return {
    origin: "VALIDATED_LOGICAL_ALIAS",
    logical_alias: value,
    value,
  };
}
