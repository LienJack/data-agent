import {
  ANALYSIS_PYTHON_CELL_TOOL_NAME,
  ANALYSIS_RESULT_PUBLISH_TOOL_NAME,
  ANALYSIS_STATISTICAL_OPERATOR_TOOL_NAME,
  analysisPythonCellToolArgumentsSchema,
  analysisStatisticalOperatorToolArgumentsSchema,
  analysisToolCallCandidateSchema,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";

describe("analysis tool contracts", () => {
  it("admits one bounded Python Cell without an entrypoint", () => {
    const parsed = analysisPythonCellToolArgumentsSchema.parse({
      schema_version: "analysis-python-cell-tool@1.0.0",
      cell_id: "prepare-monthly",
      source: "frame = frame.sort_values('month')",
      timeout_ms: 30_000,
    });

    expect(parsed.cell_id).toBe("prepare-monthly");
    expect(parsed.source).toBe("frame = frame.sort_values('month')");
  });

  it("only admits registered statistical operator ids", () => {
    expect(() =>
      analysisStatisticalOperatorToolArgumentsSchema.parse({
        schema_version: "analysis-statistical-operator-tool@1.0.0",
        call_id: "trend",
        operator_id: "custom.hand-written-formula@1",
        inputs_symbol: "trend_inputs",
        parameters_symbol: "trend_parameters",
      }),
    ).toThrow();
  });

  it("keeps the model protocol at exactly three server-owned tools", () => {
    const toolNames = [
      ANALYSIS_PYTHON_CELL_TOOL_NAME,
      ANALYSIS_STATISTICAL_OPERATOR_TOOL_NAME,
      ANALYSIS_RESULT_PUBLISH_TOOL_NAME,
    ];
    expect(toolNames).toEqual(["python_cell", "statistical_operator", "publish_analysis_result"]);
    expect(
      analysisToolCallCandidateSchema.parse({
        tool_call_id: "tool-1",
        tool_name: ANALYSIS_PYTHON_CELL_TOOL_NAME,
        arguments: {
          schema_version: "analysis-python-cell-tool@1.0.0",
          cell_id: "chart",
          source: "'ok'",
          timeout_ms: 1_000,
        },
      }).tool_name,
    ).toBe(ANALYSIS_PYTHON_CELL_TOOL_NAME);
  });
});
