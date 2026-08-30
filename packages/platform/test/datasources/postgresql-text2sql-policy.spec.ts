import { describe, expect, it } from "vitest";
import {
  assertPostgresqlText2SqlCandidatePolicy,
  type PostgresqlText2SqlPolicyError,
  parameterizePostgresqlText2SqlCandidate,
} from "../../src/datasources/adapters/postgresql-text2sql-policy.js";

const allowed = [
  { schema_name: "falcon_db_24", relation_name: "customers" },
  { schema_name: "falcon_db_24", relation_name: "orders" },
] as const;

async function expectCode(sql: string, code: PostgresqlText2SqlPolicyError["code"]) {
  await expect(
    assertPostgresqlText2SqlCandidatePolicy({
      sql,
      parameter_count: 0,
      allowed_relations: allowed,
    }),
  ).rejects.toMatchObject({ code });
}

describe("PostgreSQL model-authored Text2SQL policy", () => {
  it("compiles non-zero literals into an explicit append-only parameter vector", async () => {
    const compiled = await parameterizePostgresqlText2SqlCandidate({
      sql: "select round(sum(o.amount) / nullif(count(*), 0), 2) as average_amount from falcon_db_24.orders as o where o.customer_id = 'customer-1'",
      parameters: [],
    });

    expect(compiled.parameters).toEqual([2, "customer-1"]);
    expect(compiled.sql).toContain("$1");
    expect(compiled.sql).toContain("$2");
    expect(compiled.sql).toMatch(/nullif\s*\(count\(\*\), 0\)/iu);
    await expect(
      assertPostgresqlText2SqlCandidatePolicy({
        sql: compiled.sql,
        parameter_count: compiled.parameters.length,
        parameters: compiled.parameters,
        allowed_relations: allowed,
      }),
    ).resolves.toBeUndefined();
  });

  it.each([0, -1, 1.5, "10"])(
    "rejects a non-positive-integer exact result limit: %s",
    async (limit) => {
      await expect(
        assertPostgresqlText2SqlCandidatePolicy({
          sql: "select o.customer_id as customer_id from falcon_db_24.orders as o limit $1",
          parameter_count: 1,
          parameters: [limit],
          allowed_relations: allowed,
        }),
      ).rejects.toMatchObject({
        code: "TEXT2SQL_SQL_SHAPE_REJECTED",
        diagnostic_code: "TEXT2SQL_SQL_LIMIT_SHAPE_REJECTED",
      });
    },
  );

  it("reuses a stable temporal unit parameter across matching select and group expressions", async () => {
    const compiled = await parameterizePostgresqlText2SqlCandidate({
      sql: `
        select
          date_trunc('month', o.created_at::timestamp) as order_month,
          sum(o.amount) as order_revenue
        from falcon_db_24.orders as o
        where o.created_at::timestamp >= $1::timestamp
          and o.created_at::timestamp < $2::timestamp
        group by date_trunc('month', o.created_at::timestamp)
        order by order_month
      `,
      parameters: ["2025-08-01", "2026-08-01"],
    });

    expect(compiled.parameters).toEqual(["2025-08-01", "2026-08-01", "month"]);
    expect(compiled.sql.match(/\$3/gu)).toHaveLength(2);
    expect(compiled.sql).not.toContain("$4");
    await expect(
      assertPostgresqlText2SqlCandidatePolicy({
        sql: compiled.sql,
        parameter_count: compiled.parameters.length,
        parameters: compiled.parameters,
        allowed_relations: allowed,
      }),
    ).resolves.toBeUndefined();
  });

  it("accepts schema-qualified aggregation, safe date functions, ordering and parameters", async () => {
    await expect(
      assertPostgresqlText2SqlCandidatePolicy({
        sql: `
          select
            date_trunc($1, o.created_at) as month,
            count(*) as order_count,
            sum(o.amount) as revenue
          from falcon_db_24.orders as o
          where o.created_at >= $2::pg_catalog.date
          group by date_trunc($1, o.created_at)
          order by month
        `,
        parameter_count: 2,
        allowed_relations: allowed,
      }),
    ).resolves.toBeUndefined();
  });

  it("parameterizes and accepts an exact result limit while keeping the candidate bounded", async () => {
    const compiled = await parameterizePostgresqlText2SqlCandidate({
      sql: `
        select
          o.order_id as order_id,
          o.order_date as ordered_at,
          o.amount as order_amount
        from falcon_db_24.orders as o
        order by ordered_at desc
        limit 10
      `,
      parameters: [],
    });

    expect(compiled.parameters).toEqual([10]);
    expect(compiled.sql).toMatch(/limit\s+\$1/iu);
    await expect(
      assertPostgresqlText2SqlCandidatePolicy({
        sql: compiled.sql,
        parameter_count: compiled.parameters.length,
        parameters: compiled.parameters,
        allowed_relations: allowed,
      }),
    ).resolves.toBeUndefined();
  });

  it("accepts an explicitly typed exact result-limit parameter", async () => {
    await expect(
      assertPostgresqlText2SqlCandidatePolicy({
        sql: `
          select
            o.order_id as order_id,
            o.created_at as ordered_at,
            o.amount as order_amount
          from falcon_db_24.orders as o
          order by ordered_at desc
          limit $1::pg_catalog.int8
        `,
        parameter_count: 1,
        parameters: [10],
        allowed_relations: allowed,
      }),
    ).resolves.toBeUndefined();
  });

  it.each([
    {
      sql: "select o.order_id as order_id from falcon_db_24.orders as o limit $1 offset 0",
      parameters: [10],
    },
    {
      sql: "select o.order_id as order_id from falcon_db_24.orders as o limit $1 offset $2",
      parameters: [10, 0],
    },
  ])(
    "accepts a zero-offset no-op on an exact bounded result: $sql",
    async ({ sql, parameters }) => {
      await expect(
        assertPostgresqlText2SqlCandidatePolicy({
          sql,
          parameter_count: parameters.length,
          parameters,
          allowed_relations: allowed,
        }),
      ).resolves.toBeUndefined();
    },
  );

  it("rejects a positive offset even when the result has an exact limit", async () => {
    await expect(
      assertPostgresqlText2SqlCandidatePolicy({
        sql: "select o.order_id as order_id from falcon_db_24.orders as o limit $1 offset $2",
        parameter_count: 2,
        parameters: [10, 1],
        allowed_relations: allowed,
      }),
    ).rejects.toMatchObject({
      code: "TEXT2SQL_SQL_SHAPE_REJECTED",
      diagnostic_code: "TEXT2SQL_SQL_LIMIT_SHAPE_REJECTED",
    });
  });

  it.each([
    { parameter: 0, type: "int8" },
    { parameter: -1, type: "int8" },
    { parameter: 1.5, type: "int8" },
    { parameter: 10, type: "numeric" },
  ])("rejects an unsafe typed result limit: $parameter::$type", async ({ parameter, type }) => {
    await expect(
      assertPostgresqlText2SqlCandidatePolicy({
        sql: `select o.order_id as order_id from falcon_db_24.orders as o limit $1::pg_catalog.${type}`,
        parameter_count: 1,
        parameters: [parameter],
        allowed_relations: allowed,
      }),
    ).rejects.toMatchObject({
      code: "TEXT2SQL_SQL_SHAPE_REJECTED",
      diagnostic_code: "TEXT2SQL_SQL_LIMIT_SHAPE_REJECTED",
    });
  });

  it("accepts a safe cast of a physical date column for recent-row ordering", async () => {
    const compiled = await parameterizePostgresqlText2SqlCandidate({
      sql: `
        select
          o.order_id as order_id,
          o.created_at as ordered_at,
          o.amount as order_amount
        from falcon_db_24.orders as o
        order by o.order_date::pg_catalog.timestamp desc
        limit 10
      `,
      parameters: [],
    });

    expect(compiled.parameters).toEqual([10]);
    await expect(
      assertPostgresqlText2SqlCandidatePolicy({
        sql: compiled.sql,
        parameter_count: compiled.parameters.length,
        parameters: compiled.parameters,
        allowed_relations: allowed,
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects ordering by a non-temporal cast even when its source is a column", async () => {
    await expect(
      assertPostgresqlText2SqlCandidatePolicy({
        sql: `
          select o.amount as order_amount
          from falcon_db_24.orders as o
          order by o.amount::pg_catalog.numeric desc
        `,
        parameter_count: 0,
        allowed_relations: allowed,
      }),
    ).rejects.toMatchObject({
      code: "TEXT2SQL_SQL_SHAPE_REJECTED",
      diagnostic_code: "TEXT2SQL_SQL_ORDERING_SHAPE_REJECTED",
    });
  });

  it("accepts multi-relation CTE joins without allowing unqualified physical relations", async () => {
    await expect(
      assertPostgresqlText2SqlCandidatePolicy({
        sql: `
          with customer_orders as (
            select o.customer_id as customer_id, count(*) as order_count
            from falcon_db_24.orders as o
            group by o.customer_id
          )
          select c.id as customer_id, co.order_count as order_count
          from falcon_db_24.customers as c
          left join customer_orders as co on c.id = co.customer_id
          order by co.order_count desc
        `,
        parameter_count: 0,
        allowed_relations: allowed,
      }),
    ).resolves.toBeUndefined();
  });

  it("preserves a parameterized monthly self-join through the actual compiler round trip", async () => {
    const compiled = await parameterizePostgresqlText2SqlCandidate({
      sql: `with monthly as (
        select date_trunc('month', o.created_at::timestamp) as month,
          sum(o.amount) as revenue from falcon_db_24.orders as o
        group by date_trunc('month', o.created_at::timestamp)
      ) select current_month.month as month, current_month.revenue as revenue,
        prior_month.revenue as prior_revenue,
        (current_month.revenue-prior_month.revenue)/nullif(prior_month.revenue,0) as growth
      from monthly as current_month
      left join monthly as prior_month on prior_month.month=current_month.month-$1::interval
      where current_month.month >= $2::timestamp and current_month.month < $3::timestamp
      order by month`,
      parameters: ["1 year", "2023-11-01", "2024-11-01"],
    });
    await expect(
      assertPostgresqlText2SqlCandidatePolicy({
        ...compiled,
        parameter_count: compiled.parameters.length,
        allowed_relations: allowed,
      }),
    ).resolves.toBeUndefined();
  });

  it.each([
    [
      "select orders.amount as amount from falcon_db_24.orders",
      "TEXT2SQL_SQL_RELATION_ALIAS_REQUIRED",
    ],
    ["select o.amount as amount from orders as o", "TEXT2SQL_SQL_RELATION_UNQUALIFIED"],
    ["select o.amount as amount from private.orders as o", "TEXT2SQL_SQL_RELATION_NOT_ALLOWED"],
    [
      "select o.amount as amount from only falcon_db_24.orders as o",
      "TEXT2SQL_SQL_RELATION_SHAPE_REJECTED",
    ],
    [
      "with revenue as (select o.amount as amount from falcon_db_24.orders as o) select revenue.amount as amount from revenue",
      "TEXT2SQL_SQL_RELATION_ALIAS_REQUIRED",
    ],
  ])("distinguishes relation rejection without exposing SQL: %s", async (sql, diagnostic) => {
    await expect(
      assertPostgresqlText2SqlCandidatePolicy({
        sql,
        parameter_count: 0,
        allowed_relations: allowed,
      }),
    ).rejects.toMatchObject({ code: "TEXT2SQL_SQL_SHAPE_REJECTED", diagnostic_code: diagnostic });
  });

  it("distinguishes a duplicate host relation allowlist from a model relation error", async () => {
    await expect(
      assertPostgresqlText2SqlCandidatePolicy({
        sql: "select o.amount as amount from falcon_db_24.orders as o",
        parameter_count: 0,
        allowed_relations: [allowed[1], allowed[1]],
      }),
    ).rejects.toMatchObject({ diagnostic_code: "TEXT2SQL_SQL_RELATION_SET_DUPLICATE" });
  });

  it.each([
    ["delete from falcon_db_24.orders", "TEXT2SQL_SQL_SHAPE_REJECTED"],
    [
      "select pg_sleep($1::pg_catalog.int4) as slept from falcon_db_24.orders as o",
      "TEXT2SQL_SQL_DANGEROUS",
    ],
    [
      "select to_char(o.created_at, $1) as month_label from falcon_db_24.orders as o",
      "TEXT2SQL_SQL_DANGEROUS",
    ],
    ["select o.customer_id as customer_id from private.orders as o", "TEXT2SQL_SQL_SHAPE_REJECTED"],
    ["select o.customer_id as customer_id from orders as o", "TEXT2SQL_SQL_SHAPE_REJECTED"],
    [
      "select o.customer_id as customer_id from falcon_db_24.orders as o limit 10",
      "TEXT2SQL_SQL_SHAPE_REJECTED",
    ],
    [
      "select o.customer_id as customer_id from falcon_db_24.orders as o limit $1 offset $2",
      "TEXT2SQL_SQL_SHAPE_REJECTED",
    ],
  ] as const)("rejects unsafe candidate: %s", async (sql, code) => {
    await expectCode(sql, code);
  });

  it("requires the SQL placeholders and candidate parameter vector to match exactly", async () => {
    await expect(
      assertPostgresqlText2SqlCandidatePolicy({
        sql: "select o.customer_id as customer_id from falcon_db_24.orders as o where o.customer_id = $1",
        parameter_count: 2,
        allowed_relations: allowed,
      }),
    ).rejects.toMatchObject({
      code: "TEXT2SQL_SQL_SHAPE_REJECTED",
      diagnostic_code: "TEXT2SQL_SQL_PARAMETER_BINDING_REJECTED",
    });
  });

  it("classifies safe structural rejection branches without retaining model SQL", async () => {
    await expect(
      assertPostgresqlText2SqlCandidatePolicy({
        sql: "select o.customer_id as customer_id from falcon_db_24.orders as o, falcon_db_24.customers as c",
        parameter_count: 0,
        allowed_relations: allowed,
      }),
    ).rejects.toMatchObject({
      code: "TEXT2SQL_SQL_SHAPE_REJECTED",
      diagnostic_code: "TEXT2SQL_SQL_FROM_SHAPE_REJECTED",
    });
    await expect(
      assertPostgresqlText2SqlCandidatePolicy({
        sql: "select o.customer_id as customer_id from orders as o",
        parameter_count: 0,
        allowed_relations: allowed,
      }),
    ).rejects.toMatchObject({
      code: "TEXT2SQL_SQL_SHAPE_REJECTED",
      diagnostic_code: "TEXT2SQL_SQL_RELATION_UNQUALIFIED",
    });
    await expect(
      assertPostgresqlText2SqlCandidatePolicy({
        sql: "select o.customer_id from falcon_db_24.orders as o",
        parameter_count: 0,
        allowed_relations: allowed,
      }),
    ).rejects.toMatchObject({
      code: "TEXT2SQL_SQL_SHAPE_REJECTED",
      diagnostic_code: "TEXT2SQL_SQL_TARGET_ALIAS_REQUIRED",
    });
    await expect(
      assertPostgresqlText2SqlCandidatePolicy({
        sql: "select pg_sleep($1::pg_catalog.int4) as slept from falcon_db_24.orders as o",
        parameter_count: 1,
        allowed_relations: allowed,
      }),
    ).rejects.toMatchObject({
      code: "TEXT2SQL_SQL_DANGEROUS",
      diagnostic_code: "TEXT2SQL_SQL_FUNCTION_DENIED",
    });
    await expect(
      assertPostgresqlText2SqlCandidatePolicy({
        sql: "select o.customer_id::pg_catalog.jsonb as customer_id from falcon_db_24.orders as o",
        parameter_count: 0,
        allowed_relations: allowed,
      }),
    ).rejects.toMatchObject({
      code: "TEXT2SQL_SQL_DANGEROUS",
      diagnostic_code: "TEXT2SQL_SQL_CAST_DENIED",
    });
    await expect(
      assertPostgresqlText2SqlCandidatePolicy({
        sql: "select o.customer_id as customer_id from falcon_db_24.orders as o where o.customer_id like $1",
        parameter_count: 1,
        allowed_relations: allowed,
      }),
    ).rejects.toMatchObject({
      code: "TEXT2SQL_SQL_DANGEROUS",
      diagnostic_code: "TEXT2SQL_SQL_OPERATOR_DENIED",
    });
  });
});
