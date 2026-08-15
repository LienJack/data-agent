import type { PublicBenchmarkCase, SealedFalconCase } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  type FalconOracleQueryExecutor,
  FalconResultOracle,
  falconOracleReference,
  toFalconSqlBenchmarkDataset,
} from "../src/test-center/index.js";

const publicCase = {
  suite_id: "falcon",
  suite_version: "1.0.0",
  dataset_version: "falcon-fixed-8ff29caa-postgres-v1",
  case_id: "bbffcf99-f4f4-520a-b86b-536f5bcd75e4",
  ordinal: 0,
  registry: "DEMO",
  difficulty: "moderate",
  capabilities: ["TEXT_TO_SQL"],
  database_id: "falcon_db_14",
  question: "库存是多少？",
  schema: [],
  evidence: "fixed",
  runnable: true,
  status_reason: null,
  public_case_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
} satisfies PublicBenchmarkCase;

function sealed(overrides: Partial<SealedFalconCase> = {}): SealedFalconCase {
  return {
    public_case: publicCase,
    expected_results: [
      {
        columns: ["name", "amount", "day", "note"],
        rows: [
          ["甲", "1.0000000", "2024-01-01", null],
          ["甲", "2", "2024-01-02", "ok"],
          ["甲", "2", "2024-01-02", "ok"],
        ],
        ordered: false,
      },
    ],
    source_gold_sql: ["server only"],
    sealed_case_hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ...overrides,
  };
}

function executor(result: {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (null | string | number)[])[];
}): FalconOracleQueryExecutor {
  return {
    async execute() {
      return result;
    },
  };
}

async function evaluate(queryExecutor: FalconOracleQueryExecutor, sealedCase = sealed()) {
  const oracle = new FalconResultOracle({ executor: queryExecutor, sealed_cases: [sealedCase] });
  return oracle.evaluate({
    database_path: "falcon_db_14",
    candidate_sql: "select safe",
    gold_sql: falconOracleReference(publicCase.case_id),
  });
}

describe("FalconResultOracle", () => {
  it("preserves duplicates and compares unordered numeric/date/null/text values", async () => {
    const result = await evaluate(
      executor({
        columns: ["NAME", "amount", "day", "note"],
        rows: [
          ["甲", 2.0000001, "2024-01-02T00:00:00.000Z", "ok"],
          ["甲", 1, "2024-01-01T00:00:00.000Z", null],
          ["甲", 2, "2024-01-02", "ok"],
        ],
      }),
    );
    expect(result.verdict).toBe("PASS");
  });

  it("enforces ordered results, duplicate cardinality and explicit column count", async () => {
    const ordered = sealed({
      expected_results: [{ columns: ["value"], rows: [[1], [2], [2]], ordered: true }],
    });
    expect(
      (await evaluate(executor({ columns: ["value"], rows: [[2], [1], [2]] }), ordered)).verdict,
    ).toBe("FAIL");
    expect(
      (
        await evaluate(
          executor({
            columns: ["value", "extra"],
            rows: [
              [1, 1],
              [2, 2],
              [2, 2],
            ],
          }),
          ordered,
        )
      ).verdict,
    ).toBe("FAIL");
    expect(
      (await evaluate(executor({ columns: ["other"], rows: [[1], [2], [2]] }), ordered)).verdict,
    ).toBe("PASS");
  });

  it("accepts any declared standard result without leaking expected values", async () => {
    const multiple = sealed({
      expected_results: [
        { columns: ["value"], rows: [[1]], ordered: false },
        { columns: ["value"], rows: [[2]], ordered: false },
      ],
    });
    const result = await evaluate(executor({ columns: ["value"], rows: [[2]] }), multiple);
    expect(result.verdict).toBe("PASS");
    expect(JSON.stringify(result.feedback)).not.toContain("[[2]]");
    expect(JSON.stringify(result.feedback)).not.toContain("server only");
  });

  it.each([
    ["POSTGRES_QUERY_POLICY_REJECTED", "SAFETY_VIOLATION"],
    ["POSTGRES_QUERY_TIMEOUT", "TIMEOUT"],
    ["POSTGRES_QUERY_FAILED", "SQL_EXECUTION"],
  ] as const)("classifies %s as %s", async (code, expectedType) => {
    const result = await evaluate({
      async execute() {
        throw new Error(code);
      },
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.feedback.failure_type).toBe(expectedType);
  });

  it("rejects a mismatched case-to-schema mapping", async () => {
    const oracle = new FalconResultOracle({
      executor: executor({ columns: [], rows: [] }),
      sealed_cases: [sealed()],
    });
    const result = await oracle.evaluate({
      database_path: "falcon_db_24",
      candidate_sql: "select 1",
      gold_sql: falconOracleReference(publicCase.case_id),
    });
    expect(result.verdict).toBe("INVALID_CASE");
  });

  it("adapts sealed truth to opaque runner references", async () => {
    const adapted = await toFalconSqlBenchmarkDataset({
      manifest: {} as never,
      public_cases: [publicCase],
      main_demo_cases: [],
      smoke_cases: [],
      sealed_cases: [sealed()],
      installed_digest: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    });
    expect(adapted.sealed_cases[0]?.gold_sql).toBe(falconOracleReference(publicCase.case_id));
    expect(JSON.stringify(adapted)).not.toContain("server only");
    expect(JSON.stringify(adapted)).not.toContain("1.0000000");
  });
});
