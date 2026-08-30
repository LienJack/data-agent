import type { SemanticFormulaExpression } from "@data-agent/contracts/artifacts";
import { describe, expect, it } from "vitest";
import {
  assertPostgresqlText2SqlCandidatePolicy,
  type PostgresqlText2SqlPolicyError,
  parameterizePostgresqlText2SqlCandidate,
  resolvePostgresqlFormulaProjectionSlots,
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
  it.each([
    ["CASE WHEN SUM(m.spend)=0 THEN 0 ELSE SUM(m.revenue)/SUM(m.spend) END", true],
    ["CASE WHEN SUM(m.spend)=$1 THEN $1 ELSE SUM(m.revenue)/SUM(m.spend) END", true],
    ["CASE WHEN SUM(m.spend)=0 THEN 0 ELSE AVG(m.revenue)/SUM(m.spend) END", false],
    ["CASE WHEN SUM(m.spend)=0 THEN 0 ELSE SUM(m.spend)/SUM(m.revenue) END", false],
    ["CASE WHEN SUM(m.spend)=0 THEN NULL ELSE SUM(m.revenue)/SUM(m.spend) END", false],
    ["SUM(m.revenue)/NULLIF(SUM(m.spend),0)", false],
    ["CASE WHEN SUM(m.spend)=0 THEN 0 ELSE SUM(m.revenue)/SUM(m.spend)+$2 END", false],
    ["CASE WHEN SUM(m.spend)=0 THEN 0 ELSE SUM(DISTINCT m.revenue)/SUM(m.spend) END", false],
    [
      "CASE WHEN SUM(m.spend)=0 THEN 0 ELSE SUM(m.revenue) FILTER (WHERE m.spend>0)/SUM(m.spend) END",
      false,
    ],
    ["CASE WHEN SUM(m.spend)=0 THEN 0 ELSE SUM(m.revenue)::numeric/SUM(m.spend) END", false],
    ["CASE WHEN SUM(m.spend)=0 THEN 0 ELSE SUM(revenue)/SUM(m.spend) END", false],
    ["CASE WHEN SUM(m.spend)=0 THEN 0 ELSE SUM(m.revenue) OVER ()/SUM(m.spend) END", false],
  ] as const)(
    "proves the published aggregate formula, not just its claimed id: %s",
    async (expression, pass) => {
      const sum = (slot_id: string): SemanticFormulaExpression => ({
        kind: "AGGREGATE",
        function: "SUM",
        input: { kind: "SLOT", slot_id },
        distinct: false,
        filter: null,
      });
      const formula: SemanticFormulaExpression = {
        kind: "CASE",
        branches: [
          {
            when: {
              kind: "BINARY",
              operator: "EQ",
              left: sum("spend"),
              right: { kind: "LITERAL", value: 0 },
            },
            result: { kind: "LITERAL", value: 0 },
          },
        ],
        otherwise: {
          kind: "BINARY",
          operator: "DIVIDE",
          left: sum("revenue"),
          right: sum("spend"),
        },
      };
      const slots = ["spend", "revenue"].map((column_name) => ({
        slot_id: column_name,
        physical_type: "numeric",
        schema_name: "falcon_db_24",
        relation_name: "marketing",
        column_name,
      }));
      const input = {
        sql: `select ${expression} as roas from falcon_db_24.marketing as m`,
        parameters: [0, 1],
        output_name: "roas",
        expression: formula,
        slots,
      };
      await expect(resolvePostgresqlFormulaProjectionSlots(input)).resolves.toEqual(
        pass ? ["revenue", "spend"] : null,
      );
      if (pass) {
        for (const change of [
          { slots: slots.filter((slot) => slot.slot_id !== "spend") },
          {
            slots: [
              ...slots,
              {
                slot_id: "spend",
                physical_type: "numeric",
                schema_name: "falcon_db_24",
                column_name: "spend",
                relation_name: "other",
              },
            ],
          },
          { slots: slots.map((slot) => ({ ...slot, physical_type: "integer" })) },
          {
            sql: `select ${expression} as roas from falcon_db_24.marketing as m join falcon_db_24.marketing as n on m.spend=n.spend`,
          },
          {
            sql: `with ignored as (select 1 as n) select ${expression} as roas from falcon_db_24.marketing as m`,
          },
          { parameters: [1, 1] },
          { output_name: "other" },
        ]) {
          if (!expression.includes("$1") && "parameters" in change) continue;
          await expect(
            resolvePostgresqlFormulaProjectionSlots({ ...input, ...change }),
          ).resolves.toBeNull();
        }
      }
    },
  );
  it.each([
    ["SUM", "integer", false],
    ["SUM", "bigint", true],
    ["SUM", "numeric(12,2)", true],
    ["COUNT", "numeric", false],
    ["AVG", "integer", true],
  ] as const)(
    "does not mistake %s(%s) division for non-truncating arithmetic",
    async (fn, type, supported) => {
      const aggregate: SemanticFormulaExpression = {
        kind: "AGGREGATE",
        function: fn,
        input: { kind: "SLOT", slot_id: "amount" },
        distinct: false,
        filter: null,
      };
      await expect(
        resolvePostgresqlFormulaProjectionSlots({
          sql: `select ${fn}(o.amount)/${fn}(o.amount) as ratio from falcon_db_24.orders as o`,
          parameters: [],
          output_name: "ratio",
          expression: { kind: "BINARY", operator: "DIVIDE", left: aggregate, right: aggregate },
          slots: [
            {
              slot_id: "amount",
              physical_type: type,
              schema_name: "falcon_db_24",
              relation_name: "orders",
              column_name: "amount",
            },
          ],
        }),
      ).resolves.toEqual(supported ? ["amount"] : null);
    },
  );

  const coverage = [
    {
      schema_name: "falcon_db_24",
      relation_name: "orders",
      column_name: "created_at",
      min_time: "2023-05-01T00:00:00.000Z",
      max_time: "2024-11-01T00:00:00.000Z",
    },
  ] as const;

  it.each([
    [
      "inclusive lower and exclusive upper",
      "o.created_at::timestamp >= $1::timestamp and o.created_at::timestamp < $2::timestamp",
      true,
    ],
    ["reversed operands", "$1::date <= o.created_at::date and $2::date > o.created_at::date", true],
    ["exclusive lower", "o.created_at::date > $1::date and o.created_at::date < $2::date", true],
    ["bare column in one range", "created_at >= $1 and created_at < $2", true],
    ["OR bypass", "o.created_at >= $1 or o.created_at < $2", false],
    ["NOT bypass", "not (o.created_at >= $1 and o.created_at < $2)", false],
    ["wrong alias", "p.created_at >= $1 and p.created_at < $2", false],
    ["wrong column", "o.customer_id >= $1 and o.customer_id < $2", false],
    ["inclusive frontier", "o.created_at >= $1 and o.created_at <= $2", false],
    ["missing upper", "o.created_at >= $1", false],
  ] as const)("proves only conjunctive direct bounds: %s", async (_label, predicate, accepted) => {
    const result = assertPostgresqlText2SqlCandidatePolicy({
      sql: `select count(*) as count from falcon_db_24.orders as o where ${predicate}`,
      parameters: ["2023-05-01", "2024-11-01"],
      parameter_count: 2,
      allowed_relations: allowed,
      published_time_coverage: coverage,
    });
    if (accepted) await expect(result).resolves.toBeUndefined();
    else
      await expect(result).rejects.toMatchObject({
        diagnostic_code: "TEXT2SQL_SQL_TIME_COVERAGE_REQUIRED",
      });
  });

  it.each([
    "select count(*) as count from falcon_db_24.orders as o join falcon_db_24.orders as p on o.customer_id = p.customer_id where o.created_at >= $1 and o.created_at < $2",
    "select count(*) as count from falcon_db_24.orders as o join falcon_db_24.customers as c on o.created_at >= $1 and o.created_at < $2",
    "with source as (select o.created_at as created_at from falcon_db_24.orders as o) select s.created_at as created_at from source as s where s.created_at >= $1 and s.created_at < $2",
  ])("rejects scans not independently bounded in their own WHERE: %s", async (sql) => {
    await expect(
      assertPostgresqlText2SqlCandidatePolicy({
        sql,
        parameters: ["2023-05-01", "2024-11-01"],
        parameter_count: 2,
        allowed_relations: allowed,
        published_time_coverage: coverage,
      }),
    ).rejects.toMatchObject({ diagnostic_code: "TEXT2SQL_SQL_TIME_COVERAGE_REQUIRED" });
  });

  it.each(["2024-02-30", "2023-05-01T00:00:00+08:00", "2023-05-01T12:00:00Z"])(
    "does not infer coverage from unsupported calendar boundaries: %s",
    async (bound) => {
      await expect(
        assertPostgresqlText2SqlCandidatePolicy({
          sql: "select count(*) as count from falcon_db_24.orders as o where o.created_at >= $1 and o.created_at < $2",
          parameters: [bound, "2024-11-01"],
          parameter_count: 2,
          allowed_relations: allowed,
          published_time_coverage: coverage,
        }),
      ).rejects.toMatchObject({ diagnostic_code: "TEXT2SQL_SQL_TIME_COVERAGE_REQUIRED" });
    },
  );

  it.each(["2024-02-30", "2023-05-01T00:00:00+08:00", "2025-05-01"])(
    "fails closed on malformed or reversed published bounds: %s",
    async (minimum) => {
      await expect(
        assertPostgresqlText2SqlCandidatePolicy({
          sql: "select count(*) as count from falcon_db_24.orders as o",
          parameter_count: 0,
          allowed_relations: allowed,
          published_time_coverage: [{ ...coverage[0], min_time: minimum }],
        }),
      ).rejects.toMatchObject({ diagnostic_code: "TEXT2SQL_SQL_TIME_COVERAGE_INVALID" });
    },
  );

  it("preserves null published bounds without inventing coverage", async () => {
    await expect(
      assertPostgresqlText2SqlCandidatePolicy({
        sql: "select count(*) as count from falcon_db_24.orders as o",
        parameter_count: 0,
        allowed_relations: allowed,
        published_time_coverage: [{ ...coverage[0], min_time: null, max_time: null }],
      }),
    ).resolves.toBeUndefined();
  });

  it("admits an inclusive upper bound strictly before the published frontier", async () => {
    await expect(
      assertPostgresqlText2SqlCandidatePolicy({
        sql: "select count(*) as count from falcon_db_24.orders as o where o.created_at >= $1 and o.created_at <= $2",
        parameters: ["2023-05-01", "2024-10-01"],
        parameter_count: 2,
        allowed_relations: allowed,
        published_time_coverage: coverage,
      }),
    ).resolves.toBeUndefined();
  });

  it("requires every comparison source scan to stay inside published time coverage", async () => {
    const sql = `with current_period as (
      select sum(o.amount) as revenue from falcon_db_24.orders as o
      where o.created_at::timestamp >= $1::timestamp and o.created_at::timestamp < $2::timestamp
    ), prior_period as (
      select sum(p.amount) as revenue from falcon_db_24.orders as p
      where p.created_at::timestamp >= $3::timestamp and p.created_at::timestamp < $4::timestamp
    ) select c.revenue as current_revenue, p.revenue as prior_revenue
      from current_period as c left join prior_period as p on c.revenue = p.revenue`;
    await expect(
      assertPostgresqlText2SqlCandidatePolicy({
        sql,
        parameters: ["2023-11-01", "2024-11-01", "2022-11-01", "2023-11-01"],
        parameter_count: 4,
        allowed_relations: allowed,
        published_time_coverage: [
          {
            schema_name: "falcon_db_24",
            relation_name: "orders",
            column_name: "created_at",
            min_time: "2023-05-01T00:00:00.000Z",
            max_time: "2024-11-01T00:00:00.000Z",
          },
        ],
      }),
    ).rejects.toMatchObject({ diagnostic_code: "TEXT2SQL_SQL_TIME_COVERAGE_REQUIRED" });
  });

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

  it.each(["interval '1 year'", "cast('1 year' as pg_catalog.interval)"])(
    "preserves identical shifted-month grouping when parameterizing %s",
    async (intervalExpression) => {
      const compiled = await parameterizePostgresqlText2SqlCandidate({
        sql: `select date_trunc('month', o.created_at::timestamp) + ${intervalExpression} as month,
          sum(o.amount) as revenue from falcon_db_24.orders as o
          group by date_trunc('month', o.created_at::timestamp) + ${intervalExpression}`,
        parameters: [],
      });
      expect(compiled.parameters).toEqual(["month", "1 year"]);
      expect(compiled.sql.match(/\$2\b/gu)).toHaveLength(2);
      await expect(
        assertPostgresqlText2SqlCandidatePolicy({
          ...compiled,
          parameter_count: compiled.parameters.length,
          allowed_relations: allowed,
        }),
      ).resolves.toBeUndefined();
    },
  );

  it("keeps different interval values and unrelated typed literals separate", async () => {
    const compiled = await parameterizePostgresqlText2SqlCandidate({
      sql: `select o.created_at + interval '1 year' as next_year,
        o.created_at + interval '2 years' as later_year,
        '1 year'::text as label from falcon_db_24.orders as o`,
      parameters: [],
    });
    expect(compiled.parameters).toEqual(["1 year", "2 years", "1 year"]);
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
