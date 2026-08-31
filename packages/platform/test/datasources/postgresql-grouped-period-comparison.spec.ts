import { describe, expect, it } from "vitest";
import { provePostgresqlPeriodComparison } from "../../src/datasources/adapters/postgresql-request-derivation.js";
import {
  assertPostgresqlText2SqlCandidatePolicy,
  parameterizePostgresqlText2SqlCandidate,
} from "../../src/datasources/adapters/postgresql-text2sql-policy.js";
import { groupedPeriodComparisonFixture } from "../support/grouped-period-comparison-fixture.js";

describe("monthly categorical period comparison SQL proof", () => {
  it.each([true, false])(
    "proves both period group domains without inventing zeros (joined=%s)",
    async (joined) => {
      const input = groupedPeriodComparisonFixture(joined, true);
      const compiled = await parameterizePostgresqlText2SqlCandidate(input.candidate);
      input.candidate = { ...input.candidate, ...compiled, parameters: [...compiled.parameters] };
      const proof = await provePostgresqlPeriodComparison(input);
      expect(proof).toEqual({
        current_output: "current_value",
        comparison_output: "comparison_value",
        group_output: "segment",
        group_coverage: "BOTH_PERIOD_GROUPS",
      });
      const policy = {
        ...input.candidate,
        parameter_count: input.candidate.parameters.length,
        allowed_relations: [
          { schema_name: "public", relation_name: "orders" },
          ...(joined ? [{ schema_name: "public", relation_name: "customers" }] : []),
        ],
        published_time_coverage: [
          {
            schema_name: "public",
            relation_name: "orders",
            column_name: "order_date",
            min_time: "2023-05-01T00:00:00.000Z",
            max_time: "2024-11-01T00:00:00.000Z",
          },
        ],
      };
      await expect(assertPostgresqlText2SqlCandidatePolicy(policy)).rejects.toMatchObject({
        diagnostic_code: "TEXT2SQL_SQL_JOIN_SHAPE_REJECTED",
      });
      await expect(
        assertPostgresqlText2SqlCandidatePolicy({
          ...policy,
          proved_period_full_join: proof.group_coverage === "BOTH_PERIOD_GROUPS",
        }),
      ).resolves.toBeUndefined();
    },
  );

  it.each([
    ["dropped prior-only group", "COALESCE(c.g,p.g)", "c.g"],
    ["dropped prior-only month", "COALESCE(c.m,p.m+$6::pg_catalog.interval)", "c.m"],
    ["unshifted fallback month", "COALESCE(c.m,p.m+$6::pg_catalog.interval)", "COALESCE(c.m,p.m)"],
    ["filled missing current", "c.v AS current_value", "COALESCE(c.v,0) AS current_value"],
    ["inner dimension broadened", "LEFT JOIN public.customers", "FULL JOIN public.customers"],
  ])("rejects incomplete full comparison: %s", async (_name, from, to) => {
    const input = groupedPeriodComparisonFixture(true, true);
    input.candidate.sql = input.candidate.sql.replace(from, to);
    await expect(provePostgresqlPeriodComparison(input)).rejects.toThrow(
      "TEXT2SQL_REQUEST_DERIVATION_EXPRESSION_MISMATCH",
    );
  });

  it.each([true, false])(
    "proves exact complete monthly group panels after compiler roundtrip (dimension join=%s)",
    async (joined) => {
      const input = groupedPeriodComparisonFixture(joined);
      const compiled = await parameterizePostgresqlText2SqlCandidate(input.candidate);
      input.candidate = { ...input.candidate, ...compiled, parameters: [...compiled.parameters] };
      await assertPostgresqlText2SqlCandidatePolicy({
        ...input.candidate,
        parameter_count: input.candidate.parameters.length,
        published_time_coverage: [
          {
            schema_name: "public",
            relation_name: "orders",
            column_name: "order_date",
            min_time: "2023-05-01T00:00:00.000Z",
            max_time: "2024-11-01T00:00:00.000Z",
          },
        ],
        allowed_relations: [
          { schema_name: "public", relation_name: "orders" },
          ...(joined ? [{ schema_name: "public", relation_name: "customers" }] : []),
        ],
      });
      const before = JSON.stringify(input);
      await expect(provePostgresqlPeriodComparison(input)).resolves.toEqual({
        current_output: "current_value",
        comparison_output: "comparison_value",
        group_output: "segment",
      });
      expect(JSON.stringify(input)).toBe(before);
    },
  );

  it.each([
    ["fanout join key", "o.customer_id=d.customer_id", "o.customer_id=d.segment"],
    ["dropped unmatched facts", "LEFT JOIN public.customers", "INNER JOIN public.customers"],
    ["missing group equality", " AND (c.g=p.g OR (c.g IS NULL AND p.g IS NULL))", ""],
    ["null groups lost", "c.g=p.g OR (c.g IS NULL AND p.g IS NULL)", "c.g=p.g"],
    ["mixed group alignment", "c.g=p.g", "c.g=p.m"],
    ["wrong null side", "p.g IS NULL", "p.m IS NULL"],
    ["opposite null rule", "p.g IS NULL", "p.g IS NOT NULL"],
    ["filled group sentinel", "d.segment AS g", "COALESCE(d.segment,$1) AS g"],
    [
      "extra group",
      "GROUP BY date_trunc($1, o.order_date::pg_catalog.timestamp), d.segment",
      "GROUP BY date_trunc($1, o.order_date::pg_catalog.timestamp), d.segment, o.customer_id",
    ],
    ["changed prior category", "p.v AS comparison_value", "c.v AS comparison_value"],
    ["outer filtering", "ORDER BY month, segment", "WHERE c.g=$1 ORDER BY month, segment"],
    ["outer limit", "ORDER BY month, segment", "ORDER BY month, segment LIMIT 3"],
    [
      "extra dimension join predicate",
      "o.customer_id=d.customer_id",
      "o.customer_id=d.customer_id AND d.segment=$1",
    ],
  ])("rejects %s before database I/O", async (_label, from, to) => {
    const input = groupedPeriodComparisonFixture();
    expect(input.candidate.sql).toContain(from);
    input.candidate.sql = input.candidate.sql.replace(from, to);
    await expect(provePostgresqlPeriodComparison(input)).rejects.toThrow(
      "TEXT2SQL_REQUEST_DERIVATION_EXPRESSION_MISMATCH",
    );
  });
});
