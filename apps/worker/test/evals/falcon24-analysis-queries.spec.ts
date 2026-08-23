import { tableFromIPC } from "apache-arrow";
import { describe, expect, it } from "vitest";
import {
  FALCON24_ANALYSIS_QUERY_SPECS,
  type Falcon24AnalysisQuerySpec,
  materializeFalcon24Arrow,
} from "../../src/evals/falcon24-analysis-queries.js";

const fixtureSpec: Falcon24AnalysisQuerySpec = {
  case_id: "falcon24-business-review-18m",
  input_name: "fixture",
  sql: "select value, amount from fixed_source",
  columns: [
    { name: "value", kind: "UTF8", nullable: false },
    { name: "amount", kind: "FLOAT64", nullable: true },
  ],
  expected_rows: 2,
  semantic_contract: {
    primary_metric_id: "metric.fixture_amount",
    metric_output: "amount",
    formula_inputs: ["amount"],
    grain: "fixture-row",
    unit: "units",
    time_range: {
      start: "2024-01-01T00:00:00.000Z",
      end: "2024-02-01T00:00:00.000Z",
      timezone: "Asia/Shanghai",
      semantics: "HALF_OPEN",
    },
  },
};

describe("Falcon24 bounded analysis queries", () => {
  it("defines one immutable read-only query with an exact row contract per case", () => {
    expect(Object.keys(FALCON24_ANALYSIS_QUERY_SPECS).sort()).toEqual([
      "falcon24-business-review-18m",
      "falcon24-cohort-retention-m0-m6",
      "falcon24-delivery-experience-12m",
      "falcon24-inventory-damage-12m",
      "falcon24-marketing-lag-effect",
    ]);
    expect(
      Object.values(FALCON24_ANALYSIS_QUERY_SPECS).map((spec) => ({
        case_id: spec.case_id,
        expected_rows: spec.expected_rows,
      })),
    ).toEqual([
      { case_id: "falcon24-business-review-18m", expected_rows: 4_612 },
      { case_id: "falcon24-delivery-experience-12m", expected_rows: 3_059 },
      { case_id: "falcon24-inventory-damage-12m", expected_rows: 3_216 },
      { case_id: "falcon24-marketing-lag-effect", expected_rows: 1_238 },
      { case_id: "falcon24-cohort-retention-m0-m6", expected_rows: 336 },
    ]);
    for (const spec of Object.values(FALCON24_ANALYSIS_QUERY_SPECS)) {
      expect(spec.input_name).toMatch(/^falcon24_/u);
      expect(spec.sql).toMatch(/^(select|with)\b/iu);
      expect(spec.sql).not.toMatch(/\b(insert|update|delete|truncate|alter|drop|copy)\b/iu);
      expect(spec.sql).not.toContain(";");
      expect(spec.columns.length).toBeGreaterThan(0);
      expect(spec.columns.at(-1)?.name).toBe(spec.semantic_contract.metric_output);
      expect(spec.semantic_contract.formula_inputs).toContain(spec.semantic_contract.metric_output);
      expect(spec.semantic_contract.primary_metric_id).toMatch(/^metric\./u);
      expect(Date.parse(spec.semantic_contract.time_range.start)).toBeLessThan(
        Date.parse(spec.semantic_contract.time_range.end),
      );
    }
  });

  it("materializes validated rows as an Arrow IPC file", () => {
    const bytes = materializeFalcon24Arrow(fixtureSpec, [
      { value: "first", amount: 1.5 },
      { value: "second", amount: null },
    ]);
    const table = tableFromIPC(bytes);
    expect(table.numRows).toBe(2);
    expect(table.schema.fields.map((field) => field.name)).toEqual(["value", "amount"]);
    expect(table.getChild("value")?.toArray()).toEqual(["first", "second"]);
    expect(table.getChild("amount")?.toArray()).toEqual(new Float64Array([1.5, 0]));
    expect(table.getChild("amount")?.isValid(1)).toBe(false);
  });

  it("fails closed on row, column, null, and numeric drift", () => {
    expect(() => materializeFalcon24Arrow(fixtureSpec, [])).toThrow(
      "FALCON24_QUERY_ROW_BUDGET_INVALID",
    );
    expect(() =>
      materializeFalcon24Arrow(fixtureSpec, [
        { amount: 1, value: "reordered" },
        { amount: 2, value: "columns" },
      ]),
    ).toThrow("FALCON24_QUERY_COLUMN_CONTRACT_INVALID");
    expect(() =>
      materializeFalcon24Arrow(fixtureSpec, [
        { value: null, amount: 1 },
        { value: "second", amount: 2 },
      ]),
    ).toThrow("FALCON24_QUERY_NULL_FORBIDDEN");
    expect(() =>
      materializeFalcon24Arrow(fixtureSpec, [
        { value: "first", amount: Number.NaN },
        { value: "second", amount: 2 },
      ]),
    ).toThrow("FALCON24_QUERY_NUMBER_INVALID");
  });
});
