import { text2sqlQueryCandidateSchema } from "@data-agent/contracts/agents";
import { describe, expect, it } from "vitest";
import { renderPostgresqlPeriodComparisonCandidate } from "../../src/datasources/adapters/postgresql-period-comparison-candidate.js";
import { provePostgresqlPeriodComparison } from "../../src/datasources/adapters/postgresql-request-derivation.js";
import {
  assertPostgresqlText2SqlCandidatePolicy,
  parameterizePostgresqlText2SqlCandidate,
} from "../../src/datasources/adapters/postgresql-text2sql-policy.js";
import { groupedPeriodComparisonFixture } from "../support/grouped-period-comparison-fixture.js";
import { periodComparisonFixture } from "../support/period-comparison-fixture.js";

describe("semantic period candidate renderer", () => {
  it.each(["ungrouped", "fact-category", "joined-category"])(
    "renders %s through the original proof and firewall",
    async (variant) => {
      const input =
        variant === "ungrouped"
          ? periodComparisonFixture()
          : groupedPeriodComparisonFixture(variant === "joined-category", true);
      const generated = renderPostgresqlPeriodComparisonCandidate({
        ...input,
        interpretation_id: "request-scoped.yoy",
      });
      const candidate = text2sqlQueryCandidateSchema.parse({
        ...generated,
        ...(await parameterizePostgresqlText2SqlCandidate(generated)),
      });
      const proof = await provePostgresqlPeriodComparison({ ...input, candidate });
      expect(proof.current_output).toBe("current_value");
      expect(proof.comparison_output).toBe("comparison_value");
      if (variant !== "ungrouped")
        expect(proof).toMatchObject({
          group_output: "category",
          group_coverage: "BOTH_PERIOD_GROUPS",
        });
      expect(candidate.time_window).toMatchObject({
        dimension_id: input.dimension_id,
        start_parameter: 2,
        end_parameter: 3,
      });
      await expect(
        assertPostgresqlText2SqlCandidatePolicy({
          ...candidate,
          parameter_count: candidate.parameters.length,
          allowed_relations: [
            { schema_name: "public", relation_name: "orders" },
            { schema_name: "public", relation_name: "customers" },
          ],
          proved_period_full_join: variant !== "ungrouped",
        }),
      ).resolves.toBeUndefined();
    },
  );
  it("quotes source identifiers and preserves exact source/offset constraints", async () => {
    const input = periodComparisonFixture();
    input.source.value_column = 'amount"quoted';
    const candidate = renderPostgresqlPeriodComparisonCandidate({
      ...input,
      interpretation_id: "request-scoped.yoy",
    });
    expect(candidate.sql).toContain('f."amount""quoted"');
    await expect(provePostgresqlPeriodComparison({ ...input, candidate })).resolves.toBeDefined();
    candidate.sql = candidate.sql.replace("LEFT JOIN", "INNER JOIN");
    await expect(provePostgresqlPeriodComparison({ ...input, candidate })).rejects.toMatchObject({
      diagnostic_code: "TEXT2SQL_COMPARISON_PERIOD_JOIN_REJECTED",
    });
  });
});
