import { describe, expect, it } from "vitest";
import { provePostgresqlAggregateRatio } from "../../src/datasources/adapters/postgresql-request-derivation.js";
import {
  assertPostgresqlText2SqlCandidatePolicy,
  parameterizePostgresqlText2SqlCandidate,
} from "../../src/datasources/adapters/postgresql-text2sql-policy.js";
import { aggregateRatioFixture as fixture } from "../support/aggregate-ratio-fixture.js";

describe("request-only aggregate ratio proof", () => {
  it("proves net ROI, raw sums and exact grouping through the real compiler round trip", async () => {
    const input = fixture();
    const compiled = await parameterizePostgresqlText2SqlCandidate(input.candidate);
    const candidate = { ...input.candidate, ...compiled, parameters: [...compiled.parameters] };
    await assertPostgresqlText2SqlCandidatePolicy({
      ...candidate,
      parameter_count: candidate.parameters.length,
      allowed_relations: [{ schema_name: "public", relation_name: "marketing" }],
    });
    await expect(provePostgresqlAggregateRatio({ ...input, candidate })).resolves.toEqual({
      group_outputs: ["channel"],
      numerator_outputs: ["revenue"],
      denominator_outputs: ["spend"],
    });
  });

  it("accepts CASE with NULL but never substitutes the published ROAS zero result", async () => {
    const input = fixture();
    input.candidate.sql = input.candidate.sql.replace(
      "(SUM(m.revenue)-SUM(m.spend))/NULLIF(SUM(m.spend),0)",
      "CASE WHEN SUM(m.spend)=0 THEN NULL ELSE (SUM(m.revenue)-SUM(m.spend))/SUM(m.spend) END",
    );
    await expect(provePostgresqlAggregateRatio(input)).resolves.toBeDefined();
    const parameterized = await parameterizePostgresqlText2SqlCandidate(input.candidate);
    await expect(
      provePostgresqlAggregateRatio({
        ...input,
        candidate: {
          ...input.candidate,
          ...parameterized,
          parameters: [...parameterized.parameters],
        },
      }),
    ).resolves.toBeDefined();
    input.candidate.sql = input.candidate.sql.replace("THEN NULL", "THEN 0");
    await expect(provePostgresqlAggregateRatio(input)).rejects.toThrow(
      "TEXT2SQL_REQUEST_DERIVATION_EXPRESSION_MISMATCH",
    );
  });

  it("keeps NONE and SUBTRACT_DENOMINATOR distinct", async () => {
    const input = fixture();
    input.numerator_adjustment = "NONE";
    await expect(provePostgresqlAggregateRatio(input)).rejects.toThrow();
    input.candidate.sql = input.candidate.sql.replace(
      "(SUM(m.revenue)-SUM(m.spend))",
      "SUM(m.revenue)",
    );
    await expect(provePostgresqlAggregateRatio(input)).resolves.toBeDefined();
  });

  it.each([
    [
      "QUERY_SHAPE",
      "public.marketing AS m",
      "public.marketing AS m JOIN public.other AS x ON m.channel=x.channel",
    ],
    ["SOURCE", "public.marketing", "public.private_marketing"],
    ["PROJECTION", "SUM(m.revenue) AS revenue", "AVG(m.revenue) AS revenue"],
    ["PROJECTION", "SUM(m.spend) AS spend", "SUM(m.revenue) AS spend"],
    ["PROJECTION", "m.channel AS channel", "m.audience AS channel"],
    ["RATE", "(SUM(m.revenue)-SUM(m.spend))", "SUM(m.revenue)"],
    ["RATE", "NULLIF(SUM(m.spend),0)", "NULLIF(SUM(m.revenue),0)"],
    ["RATE", "NULLIF(SUM(m.spend),0)", "NULLIF(SUM(m.spend),1)"],
    ["RATE", "(SUM(m.revenue)-SUM(m.spend))", "(SUM(m.revenue)/SUM(m.spend)-1)"],
    [
      "RATE",
      "(SUM(m.revenue)-SUM(m.spend))/NULLIF(SUM(m.spend),0)",
      "AVG((m.revenue-m.spend)/NULLIF(m.spend,0))",
    ],
    ["RATE", "(SUM(m.revenue)-SUM(m.spend))", "(SUM(DISTINCT m.revenue)-SUM(m.spend))"],
    [
      "RATE",
      "(SUM(m.revenue)-SUM(m.spend))",
      "(SUM(m.revenue) FILTER (WHERE m.spend>0)-SUM(m.spend))",
    ],
    ["GROUP", "GROUP BY m.channel", "GROUP BY m.audience"],
    ["GROUP", "GROUP BY m.channel", "GROUP BY m.channel,m.audience"],
    ["QUERY_SHAPE", "GROUP BY m.channel", "WHERE m.spend>0 GROUP BY m.channel"],
    ["QUERY_SHAPE", "GROUP BY m.channel", "GROUP BY m.channel HAVING SUM(m.spend)>0"],
    ["QUERY_SHAPE", "NULLS LAST", "NULLS LAST LIMIT 3"],
    ["ORDERING", "ORDER BY net_roi", "ORDER BY m.spend"],
  ])(
    "fails closed at %s without rewriting SQL or exposing source values",
    async (stage, from, to) => {
      const input = fixture();
      input.candidate.sql = input.candidate.sql.replace(from, to);
      const before = JSON.stringify(input);
      const error = await provePostgresqlAggregateRatio(input).catch((error) => error);
      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toBe("TEXT2SQL_REQUEST_DERIVATION_EXPRESSION_MISMATCH");
      expect(error.diagnostic_code).toBe(`TEXT2SQL_RATIO_${stage}_REJECTED`);
      expect(Object.keys(error)).toEqual(["diagnostic_code"]);
      expect(JSON.stringify(error)).not.toMatch(/private_marketing|revenue|spend/);
      expect(JSON.stringify(input)).toBe(before);
    },
  );

  it.each(["numerator", "denominator", "integer", "binding", "dimension"])(
    "rejects %s authority drift",
    async (variant) => {
      const input = fixture();
      if (variant === "numerator") input.source.numerator_column = "other";
      if (variant === "denominator") input.source.denominator_column = "other";
      if (variant === "integer") {
        input.source.numerator_type = "integer";
        input.source.denominator_type = "integer";
      }
      if (variant === "binding") input.interpretation_id = "request-scoped.other";
      if (variant === "dimension") input.dimensions = [];
      await expect(provePostgresqlAggregateRatio(input)).rejects.toThrow(
        "TEXT2SQL_REQUEST_DERIVATION_EXPRESSION_MISMATCH",
      );
    },
  );

  it.each(["bigint", "integer", "smallint"])(
    "supports numeric promotion for %s without accepting unsupported SUM input types",
    async (type) => {
      const input = fixture();
      input.source.numerator_type = type;
      await expect(provePostgresqlAggregateRatio(input)).resolves.toBeDefined();
      input.source.numerator_type = "money";
      await expect(provePostgresqlAggregateRatio(input)).rejects.toMatchObject({
        diagnostic_code: "TEXT2SQL_RATIO_SOURCE_REJECTED",
      });
    },
  );

  it("accepts a total without fabricated grouping and a multi-dimension group without hidden keys", async () => {
    const input = fixture();
    const total = {
      ...input,
      candidate: {
        ...input.candidate,
        sql: input.candidate.sql
          .replace("m.channel AS channel, ", "")
          .replace(" GROUP BY m.channel", ""),
        result_columns: input.candidate.result_columns.slice(1),
      },
    };
    await expect(provePostgresqlAggregateRatio(total)).resolves.toMatchObject({
      group_outputs: [],
    });
    input.dimensions.push({ object_id: "dimension.audience", column_name: "audience" });
    input.candidate.sql = input.candidate.sql
      .replace("m.channel AS channel, ", "m.channel AS channel, m.audience AS audience, ")
      .replace("GROUP BY m.channel", "GROUP BY m.channel,m.audience");
    input.candidate.result_columns.splice(1, 0, {
      name: "audience",
      label: "人群",
      semantic_type: "STRING",
      semantic_binding: { object_kind: "DIMENSION", object_id: "dimension.audience" },
    });
    await expect(provePostgresqlAggregateRatio(input)).resolves.toMatchObject({
      group_outputs: ["channel", "audience"],
    });
  });
});
