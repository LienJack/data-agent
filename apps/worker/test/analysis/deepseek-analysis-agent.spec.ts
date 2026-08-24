import { describe, expect, it, vi } from "vitest";
import { createRunBoundDeepSeekAnalysisAgentModel } from "../../src/analysis/deepseek-analysis-agent.js";
import type { RunProviderDispatchCapability } from "../../src/runs/run-execution-context.js";

function request(phase: "TOOL" | "FINAL") {
  return {
    run_id: "019d2d97-110c-7735-8fbb-2c9342145a8d",
    analysis_program_id: "program-1",
    node_id: "node-1",
    turn_index: phase === "TOOL" ? 0 : 1,
    phase,
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
              schema_version: "analysis-python-cell-tool@1.0.0",
              cell_id: "prepare",
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
      tool_call: { tool_name: "python_cell", arguments: { cell_id: "prepare" } },
    });
    expect(invoke.mock.calls[0]?.[0]).toMatchObject({
      analysis_agent: { phase: "TOOL", response_schema_version: "analysis-agent-final@1.0.0" },
    });
  });

  it("parses the no-tool final response", async () => {
    const invoke = vi.fn(async (input: Parameters<RunProviderDispatchCapability["invoke"]>[0]) => ({
      ok: true as const,
      value: {
        output_text:
          '{"schema_version":"analysis-agent-final@1.0.0","summary_zh":"完成分析。"}',
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

  it("returns a repairable observation for an invalid tool schema", async () => {
    const invoke = vi.fn(async (input: Parameters<RunProviderDispatchCapability["invoke"]>[0]) => ({
      ok: true as const,
      value: {
        output_text: "",
        tool_calls: [
          {
            tool_call_id: "tool-invalid",
            tool_name: "python_cell",
            arguments: { cell_id: "missing-required-fields" },
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
    });
  });
});
