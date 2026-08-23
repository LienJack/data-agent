import { describe, expect, it } from "vitest";
import { generatedIdentifier, renderPostgresqlQueryAst } from "../src/compiler/postgresql-ast.js";
import type {
  PostgresqlCondition,
  PostgresqlDataType,
  PostgresqlExpression,
  PostgresqlGroundedIdentifier,
  PostgresqlQueryAst,
} from "../src/compiler/types.js";
import { POSTGRESQL_COMPILER_VERSION } from "../src/compiler/types.js";

const source = generatedIdentifier("source");

function groundedColumn(value: string): PostgresqlGroundedIdentifier {
  return {
    origin: "GROUNDING_PHYSICAL_NAME",
    logical_id: `orders.${value}`,
    value,
  };
}

function column(value: string): PostgresqlExpression {
  return {
    kind: "column",
    relation: source,
    column: groundedColumn(value),
  };
}

function parameter(position: number, dataType: PostgresqlDataType): PostgresqlExpression {
  return {
    kind: "parameter",
    placeholder: `$${position}`,
    data_type: dataType,
  };
}

function compilerAst(where: readonly PostgresqlCondition[]): PostgresqlQueryAst {
  const aggregateFunctions = ["AVG", "COUNT", "MAX", "MIN", "SUM"] as const;
  const dataTypes = [
    "boolean",
    "date",
    "integer",
    "numeric",
    "text",
    "timestamp",
    "timestamptz",
    "uuid",
  ] as const;
  const query = generatedIdentifier("query_1");
  return {
    kind: "postgresql-query",
    compiler_version: POSTGRESQL_COMPILER_VERSION,
    ctes: [
      {
        operation_id: "aggregate",
        operation: "aggregate",
        name: query,
        query: {
          kind: "select",
          columns: [
            ...aggregateFunctions.map((aggregateFunction, index) => ({
              expression: {
                kind: "aggregate" as const,
                function: aggregateFunction,
                distinct: aggregateFunction === "COUNT",
                argument: column("amount"),
              },
              alias: generatedIdentifier(`aggregate_${index + 1}`),
            })),
            ...dataTypes.map((dataType, index) => ({
              expression: parameter(index + 1, dataType),
              alias: generatedIdentifier(`parameter_${index + 1}`),
            })),
          ],
          from: {
            kind: "grounded-table",
            table: {
              origin: "GROUNDING_PHYSICAL_NAME",
              logical_id: "orders",
              value: "orders",
            },
            alias: source,
          },
          joins: [],
          where,
          group_by: [],
        },
      },
    ],
    root: {
      kind: "select",
      columns: [
        {
          expression: {
            kind: "column",
            relation: source,
            column: generatedIdentifier("aggregate_1"),
          },
          alias: generatedIdentifier("result"),
        },
      ],
      from: {
        kind: "cte",
        cte: query,
        alias: source,
      },
      joins: [],
      where: [],
      group_by: [],
    },
  };
}

describe("PostgreSQL AST renderer security primitives", () => {
  it("qualifies every aggregate, internal cast, and comparison operator", () => {
    const operators = ["eq", "neq", "gt", "gte", "lt", "lte"] as const;
    const ast = compilerAst([
      ...operators.map((operator, index) => ({
        kind: "comparison" as const,
        left: column("amount"),
        operator,
        right: parameter(index + 1, "integer"),
      })),
      {
        kind: "membership",
        field: column("status"),
        values: [parameter(7, "text"), parameter(8, "text")],
      },
    ]);

    const sql = renderPostgresqlQueryAst(ast);

    for (const aggregateFunction of ["AVG", "COUNT", "MAX", "MIN", "SUM"]) {
      expect(sql).toContain(`pg_catalog.${aggregateFunction}(`);
    }
    for (const cast of [
      "$1::pg_catalog.bool",
      "$2::pg_catalog.date",
      "$3::pg_catalog.int4",
      "$4::pg_catalog.numeric",
      "$5::pg_catalog.text",
      "$6::pg_catalog.timestamp",
      "$7::pg_catalog.timestamptz",
      "$8::pg_catalog.uuid",
    ]) {
      expect(sql).toContain(cast);
    }
    for (const operator of ["=", "<>", ">", ">=", "<", "<="]) {
      expect(sql).toContain(`OPERATOR(pg_catalog.${operator})`);
    }
    expect(sql).toContain(
      '("source"."status" OPERATOR(pg_catalog.=) $7::pg_catalog.text OR "source"."status" OPERATOR(pg_catalog.=) $8::pg_catalog.text)',
    );
    expect(sql).not.toMatch(/\sIN\s*\(/);
  });

  it("fails closed instead of rendering an empty membership predicate", () => {
    expect(() =>
      renderPostgresqlQueryAst(
        compilerAst([
          {
            kind: "membership",
            field: column("status"),
            values: [],
          },
        ]),
      ),
    ).toThrow("POSTGRESQL_MEMBERSHIP_VALUES_EMPTY");
  });
});
