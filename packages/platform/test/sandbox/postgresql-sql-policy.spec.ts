import { describe, expect, it } from "vitest";
import {
  assertPostgresqlSandboxSqlPolicy,
  type PostgresqlSandboxSqlPolicyError,
} from "../../src/sandbox/postgresql-sql-policy.internal.js";

const controlledRelations = [
  { schema_name: "fixture_snapshot", relation_name: "customers" },
  { schema_name: "fixture_snapshot", relation_name: "orders" },
] as const;

async function expectPolicyCode(sql: string, code: PostgresqlSandboxSqlPolicyError["code"]) {
  await expect(
    assertPostgresqlSandboxSqlPolicy({
      sql,
      allowed_relations: controlledRelations,
    }),
  ).rejects.toMatchObject({ code });
}

describe("PostgreSQL Sandbox server-side AST policy", () => {
  it("maps malformed Policy input to a stable fail-closed PolicyError", async () => {
    await expect(
      assertPostgresqlSandboxSqlPolicy({ sql: undefined } as never),
    ).rejects.toMatchObject({
      code: "SANDBOX_SQL_SHAPE_REJECTED",
      name: "PostgresqlSandboxSqlPolicyError",
    });
  });

  it("accepts the qualified compiler CTE/Join/Coalesce/GroupBy subset", async () => {
    const sql = `
      WITH query_1 AS (
        SELECT
          source.region AS field_0,
          source.amount AS field_1,
          source.customer_id AS field_2
        FROM orders AS source
        WHERE (
          source.region OPERATOR(pg_catalog.=) $1::pg_catalog.text
          OR source.region OPERATOR(pg_catalog.=) $2::pg_catalog.text
        )
      ),
      query_2 AS (
        SELECT
          source.id AS field_3,
          source.segment AS field_4
        FROM customers AS source
      ),
      query_3 AS (
        SELECT
          left_source.field_0 AS field_0,
          left_source.field_1 AS field_1,
          right_source.field_4 AS field_4
        FROM query_1 AS left_source
        LEFT JOIN query_2 AS right_source
        ON
          left_source.field_2 OPERATOR(pg_catalog.=) right_source.field_3
          AND left_source.field_0 OPERATOR(pg_catalog.<>) right_source.field_4
      ),
      query_4 AS (
        SELECT
          source.field_4 AS group_1,
          COALESCE(pg_catalog.SUM(COALESCE(source.field_1, 0)), 0) AS measure_1
        FROM query_3 AS source
        WHERE source.field_0 IS NOT NULL
        GROUP BY source.field_4
      ),
      query_5 AS (
        SELECT
          source.group_1 AS segment,
          source.measure_1 AS total
        FROM query_4 AS source
      )
      SELECT
        root_source.segment AS segment,
        root_source.total AS total
      FROM query_5 AS root_source
    `;

    await expect(
      assertPostgresqlSandboxSqlPolicy({
        sql,
        allowed_relations: controlledRelations,
      }),
    ).resolves.toBeUndefined();
  });

  it("accepts only the compiler's qualified aggregate and internal cast primitives", async () => {
    await expect(
      assertPostgresqlSandboxSqlPolicy({
        sql: `
          SELECT
            $1::pg_catalog.bool AS bool_value,
            $2::pg_catalog.date AS date_value,
            $3::pg_catalog.int4 AS int_value,
            $4::pg_catalog.numeric AS numeric_value,
            $5::pg_catalog.text AS text_value,
            $6::pg_catalog.timestamp AS timestamp_value,
            $7::pg_catalog.timestamptz AS timestamptz_value,
            $8::pg_catalog.uuid AS uuid_value
        `,
        allowed_relations: [],
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertPostgresqlSandboxSqlPolicy({
        sql: `
          SELECT
            pg_catalog.AVG(source.amount) AS average_amount,
            pg_catalog.COUNT(DISTINCT source.id) AS unique_orders,
            pg_catalog.MAX(source.amount) AS maximum_amount,
            pg_catalog.MIN(source.amount) AS minimum_amount,
            pg_catalog.SUM(source.amount) AS total_amount
          FROM orders AS source
        `,
        allowed_relations: controlledRelations,
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects every physical relation outside the sealed Snapshot Manifest", async () => {
    await expectPolicyCode(
      "select source.id as id from private_orders as source",
      "SANDBOX_SQL_SHAPE_REJECTED",
    );
    await expectPolicyCode(
      "select source.oid as oid from pg_catalog.pg_class as source",
      "SANDBOX_SQL_SHAPE_REJECTED",
    );
  });

  it.each([
    [
      "select $1::pg_catalog.int4 as first; select $1::pg_catalog.int4 as second",
      "multi statement",
    ],
    ["select $1::pg_catalog.int4 as result;", "semicolon"],
    ["select $1::pg_catalog.int4 as result -- comment", "line comment"],
    [
      "with changed as (delete from orders returning id) select source.id as id from changed as source",
      "DML CTE",
    ],
    ["select source.id as id into temporary copied from orders as source", "SELECT INTO"],
    ["select source.id as id from orders as source for update", "locking clause"],
    [
      "select source.id as id from orders as source union select source.id as id from orders as source",
      "set operation",
    ],
    ["select 1 as literal", "unparameterized literal"],
    [
      "select source.id as id from orders as source tablesample system(10)",
      "RangeTableSample/TABLESAMPLE",
    ],
    ["select * from orders as source", "A_Star"],
    [
      "select case when source.id operator(pg_catalog.=) $1::pg_catalog.int4 then source.id else source.id end as id from orders as source",
      "unknown PascalCase AST node",
    ],
    [
      "with private_orders as (select source.id as id from private_orders as source) select root.id as id from private_orders as root",
      "CTE self-shadowing an unauthorized physical relation",
    ],
    [
      "with query_2 as (select source.id as id from query_1 as source), query_1 as (select source.id as id from orders as source) select root.id as id from query_2 as root",
      "forward CTE reference",
    ],
    [
      "with query_2 as (with query_1 as (select source.id as id from orders as source) select source.id as id from query_1 as source) select root.id as id from query_2 as root",
      "nested WITH topology",
    ],
  ])("rejects compiler-external shape: %s (%s)", async (sql) => {
    await expectPolicyCode(sql, "SANDBOX_SQL_SHAPE_REJECTED");
  });

  it.each([
    ["select pg_catalog.pg_sleep($1::pg_catalog.int4) as slept", "sleep"],
    ["select pg_catalog.random() as random_value", "random"],
    ["select current_timestamp as current_value", "clock"],
    ["select pg_catalog.nextval($1::pg_catalog.text) as sequence_value", "sequence"],
    ["select attacker.evil() as evil_value", "user function"],
    [
      "select source.id as id from orders as source where source.id operator(attacker.=) $1::pg_catalog.int4",
      "custom operator",
    ],
    ["select $1::attacker.secret_type as secret_value", "custom cast"],
    [
      "select nested.id as id from (select source.id as id from orders as source) as nested",
      "subquery",
    ],
    [
      "select source.value as value from pg_catalog.generate_series($1::pg_catalog.int4, $2::pg_catalog.int4) as source(value)",
      "range function",
    ],
    ["select SUM(source.amount) as total from orders as source", "unqualified aggregate"],
    [
      "select source.id as id from orders as source where source.id = $1::pg_catalog.int4",
      "unqualified operator",
    ],
    ["select $1::text as text_value", "unqualified cast"],
    ["select $1::integer as int_value", "parser-normalized unqualified cast"],
    ["select $1::pg_catalog.integer as int_value", "non-internal cast alias"],
    [
      "select source.id as id from orders as source where source.id in ($1::pg_catalog.int4, $2::pg_catalog.int4)",
      "unqualified IN operator",
    ],
  ])("rejects dangerous or compiler-external execution: %s (%s)", async (sql) => {
    await expectPolicyCode(sql, "SANDBOX_DANGEROUS_FUNCTION_REJECTED");
  });
});
