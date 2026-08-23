import { describe, expect, it } from "vitest";
import {
  type PostgresOracleQueryExecutor,
  PostgresResultOracle,
} from "../src/test-center/index.js";

function executor(
  results: Readonly<Record<string, readonly (readonly (null | string | number)[])[]>>,
): PostgresOracleQueryExecutor {
  return {
    async execute(input) {
      const rows = results[input.sql];
      if (!rows) throw new Error("POSTGRES_QUERY_FAILED");
      return { columns: ["value"], rows };
    },
  };
}

describe("PostgresResultOracle", () => {
  it("scores Candidate and Gold by deterministic result equivalence", async () => {
    const oracle = new PostgresResultOracle({
      executor: executor({ candidate: [[2], [1]], gold: [[1], [2]] }),
    });
    const evaluation = await oracle.evaluate({
      database_path: "postgresql://demo",
      candidate_sql: "candidate",
      gold_sql: "gold",
    });
    expect(evaluation.verdict).toBe("PASS");
    expect(evaluation.candidate_result_hash).not.toBeNull();
    expect(evaluation.feedback.oracle_receipt_hash).toMatch(/^sha256:/u);
  });

  it("preserves ordered Gold semantics and classifies Candidate errors as FAIL", async () => {
    const ordered = new PostgresResultOracle({
      executor: executor({ candidate: [[2], [1]], "gold order by value": [[1], [2]] }),
    });
    expect(
      (
        await ordered.evaluate({
          database_path: "postgresql://demo",
          candidate_sql: "candidate",
          gold_sql: "gold order by value",
        })
      ).verdict,
    ).toBe("FAIL");

    const rejected = new PostgresResultOracle({
      executor: {
        async execute(input) {
          if (input.sql === "gold") return { columns: ["value"], rows: [[1]] };
          throw new Error("POSTGRES_QUERY_POLICY_REJECTED");
        },
      },
    });
    const evaluation = await rejected.evaluate({
      database_path: "postgresql://demo",
      candidate_sql: "delete",
      gold_sql: "gold",
    });
    expect(evaluation.verdict).toBe("FAIL");
    expect(evaluation.diagnostic_code).toBe("POSTGRES_QUERY_POLICY_REJECTED");
    expect(JSON.stringify(evaluation.feedback)).not.toContain("select");
  });
});
