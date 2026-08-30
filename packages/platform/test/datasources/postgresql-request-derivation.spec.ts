import { describe, expect, it } from "vitest";
import { provePostgresqlPeriodComparison } from "../../src/datasources/adapters/postgresql-request-derivation.js";
import {
  assertPostgresqlText2SqlCandidatePolicy,
  parameterizePostgresqlText2SqlCandidate,
} from "../../src/datasources/adapters/postgresql-text2sql-policy.js";
import { periodComparisonFixture as fixture } from "../support/period-comparison-fixture.js";

describe("request-scoped period comparison SQL proof", () => {
  it.each([
    ["QUERY_SHAPE", "LEFT JOIN", "INNER JOIN"],
    ["CURRENT_SOURCE", "public.orders", "public.private_relation"],
    ["PRIOR_SOURCE", "public.orders", "public.private_relation"],
    ["CURRENT_PROJECTION", "sum(o.amount)", "avg(o.amount)"],
    ["PRIOR_PROJECTION", "sum(o.amount)", "avg(o.amount)"],
    [
      "CURRENT_GROUP",
      "GROUP BY date_trunc($1, o.order_date::pg_catalog.timestamp)",
      "GROUP BY o.amount",
    ],
    ["CURRENT_WINDOW", ">= $2::pg_catalog.timestamp", ">= $4::pg_catalog.timestamp"],
    [
      "PRIOR_GROUP",
      "GROUP BY date_trunc($1, o.order_date::pg_catalog.timestamp)",
      "GROUP BY o.amount",
    ],
    ["PRIOR_WINDOW", ">= $4::pg_catalog.timestamp", ">= $2::pg_catalog.timestamp"],
    ["ALIGNMENT", "p.m+$6::pg_catalog.interval", "p.m"],
    ["RATE", "NULLIF(p.v,0)", "NULLIF(c.v,0)"],
    ["OUTPUT_BINDING", "c.v AS current_value", "p.v AS current_value"],
    ["ORDERING", "ORDER BY month", "ORDER BY current_value"],
  ])(
    "reports only the fixed %s proof diagnostic without candidate values",
    async (stage, from, to) => {
      const input = fixture();
      const sql = input.candidate.sql;
      const index = stage.startsWith("PRIOR") ? sql.lastIndexOf(from) : sql.indexOf(from);
      expect(index).toBeGreaterThanOrEqual(0);
      input.candidate.sql = sql.slice(0, index) + to + sql.slice(index + from.length);
      const error = await provePostgresqlPeriodComparison(input).catch((error) => error);
      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toBe("TEXT2SQL_REQUEST_DERIVATION_EXPRESSION_MISMATCH");
      expect(error.diagnostic_code).toBe(`TEXT2SQL_COMPARISON_${stage}_REJECTED`);
      expect(Object.keys(error)).toEqual(["diagnostic_code"]);
      expect(JSON.stringify(error)).not.toMatch(/private_relation|order_date|amount|2023|2024/);
    },
  );

  it("isolates concurrent proof diagnostics and never includes parser details", async () => {
    const invalidSql = fixture();
    invalidSql.candidate.sql = "private invalid SQL";
    const invalidType = fixture();
    invalidType.source.value_type = "integer";
    const results = await Promise.allSettled([
      provePostgresqlPeriodComparison(invalidSql),
      provePostgresqlPeriodComparison(invalidType),
      provePostgresqlPeriodComparison(fixture()),
    ]);
    expect(results[0]).toMatchObject({
      status: "rejected",
      reason: { diagnostic_code: "TEXT2SQL_COMPARISON_QUERY_SHAPE_REJECTED" },
    });
    expect(results[1]).toMatchObject({
      status: "rejected",
      reason: { diagnostic_code: "TEXT2SQL_COMPARISON_SOURCE_TYPE_REJECTED" },
    });
    expect(results[2]).toMatchObject({ status: "fulfilled" });
    expect(JSON.stringify(results)).not.toContain("private");
  });

  it("proves the exact rate, both raw value columns, two clipped sources and one annual alignment after the real compiler round trip", async () => {
    const input = fixture();
    const compiled = await parameterizePostgresqlText2SqlCandidate(input.candidate);
    input.candidate = { ...input.candidate, ...compiled, parameters: [...compiled.parameters] };
    await assertPostgresqlText2SqlCandidatePolicy({
      ...input.candidate,
      parameter_count: input.candidate.parameters.length,
      allowed_relations: [{ schema_name: "public", relation_name: "orders" }],
    });
    await expect(provePostgresqlPeriodComparison(input)).resolves.toEqual({
      current_output: "current_value",
      comparison_output: "comparison_value",
    });
  });

  it.each([
    ["wrong aggregate", "sum(o.amount)", "avg(o.amount)"],
    ["wrong source value", "sum(o.amount)", "sum(o.other_amount)"],
    ["distinct aggregate", "sum(o.amount)", "sum(DISTINCT o.amount)"],
    ["filtered aggregate", "sum(o.amount)", "sum(o.amount) FILTER (WHERE o.amount > 0)"],
    ["wrong source", "public.orders", "public.other_orders"],
    ["missing text cast", "o.order_date::pg_catalog.timestamp", "o.order_date"],
    ["inner join", "LEFT JOIN", "INNER JOIN"],
    ["no year alignment", "p.m+$6::pg_catalog.interval", "p.m"],
    ["opposite alignment", "p.m+$6::pg_catalog.interval", "p.m-$6::pg_catalog.interval"],
    ["wrong numerator", "(c.v-p.v)", "(p.v-c.v)"],
    ["wrong denominator", "NULLIF(p.v,0)", "NULLIF(c.v,0)"],
    ["no zero rule", "NULLIF(p.v,0)", "p.v"],
    ["filled missing data", "NULLIF(p.v,0)", "COALESCE(NULLIF(p.v,0),1)"],
    ["percentage scaling", "(c.v-p.v)/NULLIF(p.v,0)", "100*(c.v-p.v)/NULLIF(p.v,0)"],
    ["wrong current raw value", "c.v AS current_value", "p.v AS current_value"],
    [
      "filled comparison raw value",
      "p.v AS comparison_value",
      "COALESCE(p.v,0) AS comparison_value",
    ],
    ["outer filtering", "ORDER BY month", "WHERE p.v > 0 ORDER BY month"],
    ["outer limiting", "ORDER BY month", "ORDER BY month LIMIT 12"],
    ["extra source filtering", "GROUP BY date_trunc", "AND o.amount > 0 GROUP BY date_trunc"],
    [
      "wrong group",
      "GROUP BY date_trunc($1, o.order_date::pg_catalog.timestamp)",
      "GROUP BY o.amount",
    ],
    ["wrong comparison bounds", ">= $4::pg_catalog.timestamp", ">= $2::pg_catalog.timestamp"],
    ["wrong boundary inclusivity", "< $5::pg_catalog.timestamp", "<= $5::pg_catalog.timestamp"],
  ])("rejects %s without executing or rewriting SQL", async (_name, from, to) => {
    const input = fixture();
    input.candidate.sql = input.candidate.sql.replace(from, to);
    const before = JSON.stringify(input);
    await expect(provePostgresqlPeriodComparison(input)).rejects.toThrow(
      "TEXT2SQL_REQUEST_DERIVATION_EXPRESSION_MISMATCH",
    );
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each(["year", "month", "integer", "binding", "date", "zero"])(
    "rejects %s authority or parameter drift",
    async (variant) => {
      const input = fixture();
      if (variant === "year") input.candidate.parameters[5] = "2 years";
      if (variant === "month") input.candidate.parameters[0] = "day";
      if (variant === "integer") input.source.value_type = "integer";
      if (variant === "binding")
        input.candidate.result_columns = input.candidate.result_columns.map((column, index) =>
          index === 3
            ? {
                ...column,
                semantic_binding: { object_kind: "METRIC", object_id: "metric.order_revenue" },
              }
            : column,
        );
      if (variant === "date") input.comparison.start = "2023-06-01";
      if (variant === "zero")
        input.candidate.sql = input.candidate.sql.replace("NULLIF(p.v,0)", "NULLIF(p.v,1)");
      await expect(provePostgresqlPeriodComparison(input)).rejects.toThrow(
        "TEXT2SQL_REQUEST_DERIVATION_EXPRESSION_MISMATCH",
      );
    },
  );

  it("supports DATE display and GROUP BY alias without changing the rate", async () => {
    const input = fixture();
    input.candidate.sql = input.candidate.sql
      .replace("c.m AS month", "c.m::pg_catalog.date AS month")
      .replaceAll("GROUP BY date_trunc($1, o.order_date::pg_catalog.timestamp)", "GROUP BY m");
    input.candidate.result_columns = input.candidate.result_columns.map((column, index) =>
      index === 0 ? { ...column, semantic_type: "DATE" } : column,
    );
    await expect(provePostgresqlPeriodComparison(input)).resolves.toBeDefined();
  });
});
