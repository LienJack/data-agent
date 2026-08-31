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
  it("distinguishes logical date fields from pandas dtype without permitting silent coercion", () => {
    const rule = analysisAgentPromptInternals.inputDateTimeRule;
    expect(rule).toContain("logical DATE/TIMESTAMP");
    expect(rule).toContain("not a pandas datetime dtype guarantee");
    expect(rule).toContain("pandas.to_datetime");
    expect(rule).toContain("errors='raise'");
    expect(rule).toContain("declared timezone");
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
