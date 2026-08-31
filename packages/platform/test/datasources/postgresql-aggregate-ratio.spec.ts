import type { Text2SqlQueryCandidate } from "@data-agent/contracts/agents";
import { describe, expect, it } from "vitest";
import { provePostgresqlAggregateRatio } from "../../src/datasources/adapters/postgresql-request-derivation.js";
import {
  assertPostgresqlText2SqlCandidatePolicy,
  parameterizePostgresqlText2SqlCandidate,
} from "../../src/datasources/adapters/postgresql-text2sql-policy.js";
import { aggregateRatioFixture as fixture } from "../support/aggregate-ratio-fixture.js";

function windowFixture(timeType = "text") {
  const base = fixture();
  const candidate: Text2SqlQueryCandidate = base.candidate;
  const input = { ...base, candidate };
  const time = timeType === "text" ? "m.date::pg_catalog.timestamp" : "m.date";
  input.candidate.sql = input.candidate.sql
    .replace("m.channel AS channel,", `date_trunc($3, ${time}) AS month, m.channel AS channel,`)
    .replace(
      "GROUP BY m.channel",
      `WHERE ${time} >= $1::pg_catalog.timestamp AND ${time} < $2::pg_catalog.timestamp GROUP BY month,m.channel`,
    );
  input.candidate.parameters = ["2023-11-01", "2024-11-01", "month"];
  input.candidate.time_window = {
    dimension_id: "dimension.month",
    start_parameter: 1,
    end_parameter: 2,
    semantics: "HALF_OPEN",
  };
  input.candidate.result_columns.unshift({
    name: "month",
    label: "月份",
    semantic_type: "DATETIME",
    semantic_binding: { object_kind: "DIMENSION", object_id: "dimension.month" },
  });
  input.dimensions.push({ object_id: "dimension.month", column_name: "date" });
  return {
    ...input,
    time_window: {
      dimension_id: "dimension.month",
      column_name: "date",
      formatted_type: timeType,
      start: "2023-11-01T00:00:00.000Z",
      end: "2024-11-01T00:00:00.000Z",
    },
  };
}

describe("request-only aggregate ratio proof", () => {
  it.each(["text", "date", "timestamp without time zone"])(
    "proves the exact bounded month/channel ratio for %s through the real compiler",
    async (type) => {
      const input = windowFixture(type);
      const compiled = await parameterizePostgresqlText2SqlCandidate(input.candidate);
      const candidate = { ...input.candidate, ...compiled, parameters: [...compiled.parameters] };
      await assertPostgresqlText2SqlCandidatePolicy({
        ...candidate,
        parameter_count: candidate.parameters.length,
        allowed_relations: [{ schema_name: "public", relation_name: "marketing" }],
      });
      await expect(provePostgresqlAggregateRatio({ ...input, candidate })).resolves.toMatchObject({
        group_outputs: ["month", "channel"],
        numerator_outputs: ["revenue"],
        denominator_outputs: ["spend"],
      });
    },
  );

  it("retains an exact window even when its time column is not projected", async () => {
    const input = windowFixture();
    input.candidate.sql = input.candidate.sql
      .replace("date_trunc($3, m.date::pg_catalog.timestamp) AS month, ", "")
      .replace("GROUP BY month,m.channel", "GROUP BY m.channel");
    input.candidate.result_columns.shift();
    await expect(provePostgresqlAggregateRatio(input)).resolves.toMatchObject({
      group_outputs: ["channel"],
    });
  });

  it.each([
    ["WINDOW", ">= $1", "> $1"],
    ["WINDOW", "< $2", "<= $2"],
    ["WINDOW", ">= $1", ">= $2"],
    ["WINDOW", "AND m.date", "OR m.date"],
    ["WINDOW", "GROUP BY month", "AND m.spend>0 GROUP BY month"],
    ["WINDOW", "m.date::pg_catalog.timestamp >=", "m.other_date::pg_catalog.timestamp >="],
    ["WINDOW", "m.date::pg_catalog.timestamp >=", "m.date::pg_catalog.date >="],
    ["PROJECTION", "date_trunc($3,", "date_trunc($1,"],
    [
      "PROJECTION",
      "date_trunc($3, m.date::pg_catalog.timestamp)",
      "date_trunc($3, m.other_date::pg_catalog.timestamp)",
    ],
    ["GROUP", "GROUP BY month,m.channel", "GROUP BY m.channel"],
  ])("rejects bounded ratio %s drift without exposing parameters", async (stage, from, to) => {
    const input = windowFixture();
    input.candidate.sql = input.candidate.sql.replace(from, to);
    const compiled = await parameterizePostgresqlText2SqlCandidate(input.candidate);
    const candidate = { ...input.candidate, ...compiled, parameters: [...compiled.parameters] };
    const before = JSON.stringify(candidate);
    const error = await provePostgresqlAggregateRatio({ ...input, candidate }).catch(
      (error) => error,
    );
    expect(error).toMatchObject({ diagnostic_code: `TEXT2SQL_RATIO_${stage}_REJECTED` });
    expect(Object.keys(error)).toEqual(["diagnostic_code"]);
    expect(JSON.stringify(error)).not.toMatch(/other_date|spend|2023|2024/);
    expect(JSON.stringify(candidate)).toBe(before);
  });

  it.each([
    "declaration",
    "dimension",
    "bound",
    "same-value-other-index",
    "missing-authority",
    "source-type",
  ])("rejects %s window drift", async (variant) => {
    const input = windowFixture();
    if (variant === "declaration") input.candidate.time_window = null;
    if (variant === "dimension" && input.candidate.time_window)
      input.candidate.time_window.dimension_id = "other";
    if (variant === "bound") input.candidate.parameters[0] = "2023-12-01";
    if (variant === "same-value-other-index") {
      input.candidate.parameters.push("2023-11-01");
      input.candidate.sql = input.candidate.sql.replace(">= $1", ">= $4");
    }
    if (variant === "source-type") input.time_window.formatted_type = "timestamp with time zone";
    const proof =
      variant === "missing-authority"
        ? provePostgresqlAggregateRatio({ ...fixture(), candidate: input.candidate })
        : provePostgresqlAggregateRatio(input);
    await expect(proof).rejects.toThrow("TEXT2SQL_REQUEST_DERIVATION_EXPRESSION_MISMATCH");
  });

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
