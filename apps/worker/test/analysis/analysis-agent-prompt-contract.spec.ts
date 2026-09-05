import { describe, expect, it } from "vitest";
import { analysisAgentPromptInternals } from "../../src/analysis/analysis-agent-prompt.js";

const hash = (character: string) => `sha256:${character.repeat(64)}` as const;

function contract() {
  return {
    schema_version: "governed-analysis-contract@3.0.0",
    objective: "分析最近十二个完整月的订单收入趋势并生成折线图。",
    result_contract_hash: hash("a"),
    required_operator_ids: [
      "analysis.single-series.mann-kendall.v1",
      "analysis.single-series.theil-sen.v1",
    ],
    semantic_contract: {
      metric_ids: ["metric.order_revenue"],
      dimension_ids: ["dimension.order_month"],
    },
  } as const;
}

describe("governed analysis agent contract v3", () => {
  it("normalizes nullable numeric scalars before descriptive arithmetic, not only at publication", () => {
    const rules = analysisAgentPromptInternals;
    expect(rules).toHaveProperty("inputNumericNullRule");
    const rule = Reflect.get(rules, "inputNumericNullRule");
    expect(rule).toContain("pandas.isna(value)");
    expect(rule).toContain("before counting, sorting, ranking, or arithmetic");
    expect(rule).toContain("is None is insufficient");
    expect(rule).toContain("zero remains an observed value");
    expect(rule).toContain("Never fill missing values with zero");
    expect(rule).toContain("protected input");
  });

  it("distinguishes logical date fields from pandas dtype without permitting silent coercion", () => {
    const rule = analysisAgentPromptInternals.inputDateTimeRule;
    expect(rule).toContain("logical DATE/TIMESTAMP");
    expect(rule).toContain("not a pandas datetime dtype guarantee");
    expect(rule).toContain("pandas.to_datetime");
    expect(rule).toContain("errors='raise'");
    expect(rule).toContain("accepted business timezone");
    expect(rule).toContain("datetime_timezones");
    expect(rule).toContain("utc=True).dt.tz_convert(declared_timezone)");
    expect(rule).toContain("DATE is a calendar date, not an instant");
    expect(rule).toContain("Never coerce invalid dates to NaT");
  });

  it("accepts Host-owned objective, result hash and exact governed operators", () => {
    expect(analysisAgentPromptInternals.governedAnalysisContractSchema.parse(contract())).toEqual(
      contract(),
    );
    expect(
      analysisAgentPromptInternals.governedAnalysisContractSchema.parse({
        ...contract(),
        required_operator_ids: [],
      }).required_operator_ids,
    ).toEqual([]);
  });

  it("rejects the retired case and model-authored method contract", () => {
    expect(() =>
      analysisAgentPromptInternals.governedAnalysisContractSchema.parse({
        schema_version: "governed-analysis-contract@2.0.0",
        case_id: "falcon24-business-review-18m",
        statistical_method_contract: [],
        required_method_evidence_keys: ["theil-sen"],
        semantic_contract: {},
        output_json_schema: {},
      }),
    ).toThrow();
    expect(() =>
      analysisAgentPromptInternals.governedAnalysisContractSchema.parse({
        ...contract(),
        required_operator_ids: [
          "analysis.single-series.mann-kendall.v1",
          "analysis.single-series.mann-kendall.v1",
        ],
      }),
    ).toThrow();
  });
});
