import type { AnalysisResultContract } from "@data-agent/contracts/artifacts";
import { describe, expect, it, vi } from "vitest";
import { analysisOperatorArgumentSymbols } from "../../src/analysis/analysis-operator-symbols.js";
import { createRunBoundDeepSeekAnalysisAgentModel } from "../../src/analysis/deepseek-analysis-agent.js";
import type { RunProviderDispatchCapability } from "../../src/runs/run-execution-context.js";

function request(phase: "TOOL" | "FINAL") {
  return {
    run_id: "019d2d97-110c-7735-8fbb-2c9342145a8d",
    analysis_program_id: "program-1",
    node_id: "node-1",
    turn_index: phase === "TOOL" ? 0 : 1,
    phase,
    result_contract: { charts: [] } as unknown as AnalysisResultContract,
    allowed_tool_names: phase === "TOOL" ? (["python_cell"] as const) : ([] as const),
    messages: [
      { role: "system" as const, content: "Use governed tools." },
      { role: "user" as const, content: "Analyze the input." },
    ],
    max_output_tokens: 2_048,
  };
}

describe("run-bound DeepSeek analysis Agent model", () => {
  it("projects exactly one server-owned tool candidate", async () => {
    const invoke = vi.fn(async (input: Parameters<RunProviderDispatchCapability["invoke"]>[0]) => ({
      ok: true as const,
      value: {
        output_text: "",
        tool_calls: [
          {
            tool_call_id: "tool-1",
            tool_name: "python_cell",
            arguments: {
              source: "value = 1",
              timeout_ms: 1_000,
            },
          },
        ],
        projection: {
          invocation_id: input.logical_call_id,
          status: "COMPLETED" as const,
          provider: "deepseek",
          model_id: "deepseek-v4-flash",
        },
      },
    }));
    const model = createRunBoundDeepSeekAnalysisAgentModel({ invoke });

    await expect(model.turn(request("TOOL"))).resolves.toMatchObject({
      phase: "TOOL",
      tool_call: {
        tool_name: "python_cell",
        arguments: {
          schema_version: "analysis-python-cell-tool@1.0.0",
          cell_id: expect.stringMatching(/^cell-[0-9a-f-]{36}$/u),
        },
      },
    });
    expect(invoke.mock.calls[0]?.[0]).toMatchObject({
      analysis_agent: { phase: "TOOL", response_schema_version: "analysis-agent-final@1.0.0" },
    });
  });

  it("parses the no-tool final response", async () => {
    const invoke = vi.fn(async (input: Parameters<RunProviderDispatchCapability["invoke"]>[0]) => ({
      ok: true as const,
      value: {
        output_text: '{"schema_version":"analysis-agent-final@1.0.0","summary_zh":"完成分析。"}',
        tool_calls: [],
        projection: {
          invocation_id: input.logical_call_id,
          status: "COMPLETED" as const,
          provider: "deepseek",
          model_id: "deepseek-v4-flash",
        },
      },
    }));
    const model = createRunBoundDeepSeekAnalysisAgentModel({ invoke });

    await expect(model.turn(request("FINAL"))).resolves.toMatchObject({
      phase: "FINAL",
      response: { summary_zh: "完成分析。" },
    });
  });

  it("binds chart identity and its table symbol from the server-owned result contract", async () => {
    const invoke = vi.fn(async (input: Parameters<RunProviderDispatchCapability["invoke"]>[0]) => ({
      ok: true as const,
      value: {
        output_text: "",
        tool_calls: [
          {
            tool_call_id: "tool-publish",
            tool_name: "publish_analysis_result",
            arguments: {
              publish_id: "result-1",
              result_symbol: "result_document",
              table_bindings: [{ table_id: "trend", data_symbol: "trend_table" }],
              chart_bindings: [
                {
                  chart_id: "trend_chart",
                  x_field: "month",
                  y_fields: ["revenue"],
                  series_field: "",
                  lower_bound_field: "",
                  upper_bound_field: "",
                },
              ],
              operator_bindings: [],
            },
          },
        ],
        projection: {
          invocation_id: input.logical_call_id,
          status: "COMPLETED" as const,
          provider: "deepseek",
          model_id: "deepseek-v4-flash",
        },
      },
    }));
    const model = createRunBoundDeepSeekAnalysisAgentModel({ invoke });
    const toolRequest = {
      ...request("TOOL"),
      allowed_tool_names: ["publish_analysis_result"] as const,
      result_contract: {
        charts: [
          {
            chart_id: "trend_chart",
            table_id: "trend",
            intent: "TREND",
            allowed_template_ids: ["line.multi-series@1"],
          },
        ],
      } as unknown as AnalysisResultContract,
    };

    await expect(model.turn(toolRequest)).resolves.toMatchObject({
      phase: "TOOL",
      tool_call: {
        arguments: {
          schema_version: "analysis-result-publish-tool@1.0.0",
          chart_bindings: [
            {
              chart_id: "trend_chart",
              intent: "TREND",
              template_id: "line.multi-series@1",
              data_symbol: "trend_table",
            },
          ],
        },
      },
    });
  });

  it("binds exact operator argument symbols on the server", async () => {
    const invoke = vi.fn(async (input: Parameters<RunProviderDispatchCapability["invoke"]>[0]) => ({
      ok: true as const,
      value: {
        output_text: "",
        tool_calls: [
          {
            tool_call_id: "tool-operator",
            tool_name: "statistical_operator",
            arguments: {
              call_id: "q1_revenue_identity",
              operator_id: "decomposition.product-shapley-exact@1",
            },
          },
        ],
        projection: {
          invocation_id: input.logical_call_id,
          status: "COMPLETED" as const,
          provider: "deepseek",
          model_id: "deepseek-v4-flash",
        },
      },
    }));
    const model = createRunBoundDeepSeekAnalysisAgentModel({ invoke });
    const symbols = analysisOperatorArgumentSymbols("q1_revenue_identity");

    await expect(
      model.turn({
        ...request("TOOL"),
        allowed_tool_names: ["statistical_operator"] as const,
      }),
    ).resolves.toMatchObject({
      phase: "TOOL",
      tool_call: {
        arguments: {
          schema_version: "analysis-statistical-operator-tool@1.0.0",
          call_id: "q1_revenue_identity",
          operator_id: "decomposition.product-shapley-exact@1",
          ...symbols,
        },
      },
    });
  });

  it("rejects the retired model-selected operator symbol fields", async () => {
    const invoke = vi.fn(async (input: Parameters<RunProviderDispatchCapability["invoke"]>[0]) => ({
      ok: true as const,
      value: {
        output_text: "",
        tool_calls: [
          {
            tool_call_id: "tool-operator-old",
            tool_name: "statistical_operator",
            arguments: {
              call_id: "q1_revenue_identity",
              operator_id: "decomposition.product-shapley-exact@1",
              inputs_symbol: "model_chosen_inputs",
              parameters_symbol: "model_chosen_parameters",
            },
          },
        ],
        projection: {
          invocation_id: input.logical_call_id,
          status: "COMPLETED" as const,
          provider: "deepseek",
          model_id: "deepseek-v4-flash",
        },
      },
    }));
    const model = createRunBoundDeepSeekAnalysisAgentModel({ invoke });

    await expect(model.turn(request("TOOL"))).resolves.toMatchObject({
      phase: "INVALID_TOOL",
      validation_issues: expect.arrayContaining([
        {
          path: "arguments",
          code: "unrecognized_keys",
          identifiers: ["inputs_symbol", "parameters_symbol"],
        },
      ]),
    });
  });

  it("returns a repairable observation for an invalid tool schema", async () => {
    const invoke = vi.fn(async (input: Parameters<RunProviderDispatchCapability["invoke"]>[0]) => ({
      ok: true as const,
      value: {
        output_text: "",
        tool_calls: [
          {
            tool_call_id: "tool-invalid",
            tool_name: "python_cell",
            arguments: {
              explanation: "must never be reflected into diagnostics",
            },
          },
        ],
        projection: {
          invocation_id: input.logical_call_id,
          status: "COMPLETED" as const,
          provider: "deepseek",
          model_id: "deepseek-v4-flash",
        },
      },
    }));
    const model = createRunBoundDeepSeekAnalysisAgentModel({ invoke });

    await expect(model.turn(request("TOOL"))).resolves.toMatchObject({
      phase: "INVALID_TOOL",
      error_code: "ANALYSIS_AGENT_TOOL_CALL_INVALID",
      validation_issues: expect.arrayContaining([
        { path: "arguments.source", code: "invalid_type" },
        { path: "arguments.timeout_ms", code: "invalid_type" },
        {
          path: "arguments",
          code: "unrecognized_keys",
          identifiers: ["explanation"],
        },
      ]),
    });
    const result = await model.turn(request("TOOL"));
    expect(JSON.stringify(result)).not.toContain("must never be reflected");
  });
});
