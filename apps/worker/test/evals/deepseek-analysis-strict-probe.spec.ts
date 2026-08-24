import { sha256ContentHash } from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  type buildDeepSeekAnalysisStrictProbePlan,
  DEEPSEEK_ANALYSIS_STRICT_PROBE_ATTEMPTS,
  runDeepSeekAnalysisStrictProbe,
  verifyDeepSeekAnalysisStrictProbeReport,
} from "../../src/evals/deepseek-analysis-strict-probe.js";

describe("DeepSeek analysis Strict probe", () => {
  it("covers all three authoritative tools across exactly 100 validated calls", async () => {
    const invoke = vi.fn(
      async (plan: ReturnType<typeof buildDeepSeekAnalysisStrictProbePlan>[number]) => ({
        request_id: plan.request_id,
        response_hash: await sha256ContentHash({ ordinal: plan.ordinal, kind: "response" }),
        tool_calls: [
          {
            tool_call_id: `tool-call-${plan.ordinal}`,
            tool_name: plan.tool_name,
            arguments: plan.arguments,
          },
        ],
        usage: {
          availability: "AVAILABLE" as const,
          source: "PROVIDER_REPORTED" as const,
          input_tokens: 10,
          output_tokens: 5,
          tool_calls: 1,
          unavailable_reason: null,
        },
      }),
    );
    const times = [new Date("2026-08-25T00:00:00.000Z"), new Date("2026-08-25T00:10:00.000Z")];
    const report = await runDeepSeekAnalysisStrictProbe({
      invoke,
      now: () => times.shift() ?? new Date("2026-08-25T00:10:00.000Z"),
    });

    expect(invoke).toHaveBeenCalledTimes(DEEPSEEK_ANALYSIS_STRICT_PROBE_ATTEMPTS);
    expect(report.result).toBe("GO");
    expect(report.passed_attempts).toBe(100);
    expect(new Set(report.attempts.map(({ tool_name: toolName }) => toolName))).toEqual(
      new Set(["python_cell", "statistical_operator", "publish_analysis_result"]),
    );
    await expect(verifyDeepSeekAnalysisStrictProbeReport(report)).resolves.toEqual(report);
  });

  it("fails closed on a provider tool-name or argument mismatch", async () => {
    await expect(
      runDeepSeekAnalysisStrictProbe({
        invoke: async (plan) => ({
          request_id: plan.request_id,
          response_hash: await sha256ContentHash({ ordinal: plan.ordinal }),
          tool_calls: [
            {
              tool_call_id: "wrong-call",
              tool_name: "python_cell",
              arguments: { unexpected: true },
            },
          ],
          usage: {
            availability: "UNAVAILABLE" as const,
            source: "UNAVAILABLE" as const,
            input_tokens: null,
            output_tokens: null,
            tool_calls: null,
            unavailable_reason: "PROVIDER_DID_NOT_REPORT_USAGE" as const,
          },
        }),
      }),
    ).rejects.toThrow("DEEPSEEK_STRICT_PROBE_ARGUMENTS_INVALID");
  });

  it("fails closed when valid provider arguments differ from the requested document", async () => {
    await expect(
      runDeepSeekAnalysisStrictProbe({
        invoke: async (plan) => ({
          request_id: plan.request_id,
          response_hash: await sha256ContentHash({ ordinal: plan.ordinal }),
          tool_calls: [
            {
              tool_call_id: "substituted-call",
              tool_name: plan.tool_name,
              arguments:
                plan.tool_name === "python_cell"
                  ? { ...plan.arguments, source: "strict_probe_value = -1" }
                  : plan.arguments,
            },
          ],
          usage: {
            availability: "UNAVAILABLE" as const,
            source: "UNAVAILABLE" as const,
            input_tokens: null,
            output_tokens: null,
            tool_calls: null,
            unavailable_reason: "PROVIDER_DID_NOT_REPORT_USAGE" as const,
          },
        }),
      }),
    ).rejects.toThrow("DEEPSEEK_STRICT_PROBE_ARGUMENTS_SUBSTITUTED");
  });

  it("rejects a tampered 100-call report", async () => {
    const report = await runDeepSeekAnalysisStrictProbe({
      invoke: async (plan) => ({
        request_id: plan.request_id,
        response_hash: await sha256ContentHash({ ordinal: plan.ordinal }),
        tool_calls: [
          {
            tool_call_id: `tool-call-${plan.ordinal}`,
            tool_name: plan.tool_name,
            arguments: plan.arguments,
          },
        ],
        usage: {
          availability: "UNAVAILABLE" as const,
          source: "UNAVAILABLE" as const,
          input_tokens: null,
          output_tokens: null,
          tool_calls: null,
          unavailable_reason: "PROVIDER_DID_NOT_REPORT_USAGE" as const,
        },
      }),
    });

    await expect(
      verifyDeepSeekAnalysisStrictProbeReport({
        ...report,
        report_hash: `sha256:${"0".repeat(64)}`,
      }),
    ).rejects.toThrow("DEEPSEEK_STRICT_PROBE_REPORT_HASH_INVALID");
  });
});
