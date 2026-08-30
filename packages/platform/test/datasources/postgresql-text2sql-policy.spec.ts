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
        allowed_relations: allowed,
      }),
    ).resolves.toBeUndefined();
  });

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
        sql: "select o.customer_id as customer_id from orders as o",
        parameter_count: 0,
        allowed_relations: allowed,
      }),
    ).rejects.toMatchObject({
      code: "TEXT2SQL_SQL_SHAPE_REJECTED",
      diagnostic_code: "TEXT2SQL_SQL_RELATION_BINDING_REJECTED",
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
