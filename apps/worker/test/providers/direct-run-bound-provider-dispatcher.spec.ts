import { describe, expect, it, vi } from "vitest";
import {
  createDirectRunBoundProviderDispatcher,
  directRunBoundProviderDispatcherInternals,
} from "../../src/providers/direct-run-bound-provider-dispatcher.js";

describe("direct run-bound provider retry policy", () => {
  it("rejects the removed Direct QA fallback before reading Run or provider state", async () => {
    const getRun = vi.fn();
    const dispatcher = createDirectRunBoundProviderDispatcher({
      runs: { getRun },
      task_artifacts: {} as never,
      capability: {},
      environment: {},
    });
    const runId = "90000000-0000-4000-8000-000000000001";
    const attemptId = "90000000-0000-4000-8000-000000000002";
    const result = await dispatcher.invoke({
      lease: { run_id: runId, attempt_id: attemptId, worker_fence: 1 },
      effective_config: { run_id: runId },
      context_receipt: { run_id: runId, attempt_id: attemptId, worker_fence: 1 },
      logical_call_id: "90000000-0000-4000-8000-000000000003",
      signal: new AbortController().signal,
    } as never);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "MODEL_DISPATCH_MODE_REQUIRED",
        message: "生产模型调用必须选择唯一的 Root、Specialist、Analysis 或 smoke turn。",
        retryable: false,
      },
    });
    expect(getRun).not.toHaveBeenCalled();
  });

  it("projects native tool-call events into the strict Root Harness shape", () => {
    const providerEvent = {
      tool_call_id: "call-1",
      tool_name: "delegate_to_subagent@1",
      arguments: { profile_id: "semantic-management-agent" },
      event_type: "TOOL_CALL_CANDIDATE",
    };
    expect(
      directRunBoundProviderDispatcherInternals.projectToolCallCandidate(providerEvent),
    ).toEqual({
      tool_call_id: "call-1",
      tool_name: "delegate_to_subagent@1",
      arguments: { profile_id: "semantic-management-agent" },
    });
  });

  it("retries a transient structured-output protocol failure once", () => {
    expect(
      directRunBoundProviderDispatcherInternals.retryableReason("MODEL_STREAM_PROTOCOL_VIOLATION"),
    ).toBe(true);
    expect(
      directRunBoundProviderDispatcherInternals.retryableReason("MODEL_PROVIDER_TIMEOUT"),
    ).toBe(true);
    expect(
      directRunBoundProviderDispatcherInternals.retryableReason("MODEL_PROVIDER_AUTH_FAILED"),
    ).toBe(false);
    expect(
      directRunBoundProviderDispatcherInternals.shouldRetryProviderCall({
        first_ok: false,
        retryable: true,
        signal_aborted: false,
        max_attempts_per_call: 1,
      }),
    ).toBe(false);
    expect(
      directRunBoundProviderDispatcherInternals.shouldRetryProviderCall({
        first_ok: false,
        retryable: true,
        signal_aborted: false,
        max_attempts_per_call: 2,
      }),
    ).toBe(true);
  });

  it("fails closed unless a tool turn exposes a non-empty unique registered subset", () => {
    const validate = directRunBoundProviderDispatcherInternals.validAnalysisToolAllowlist;
    expect(validate("TOOL", ["python_cell"])).toBe(true);
    expect(validate("TOOL", ["statistical_operator"])).toBe(true);
    expect(validate("TOOL", ["publish_analysis_result"])).toBe(true);
    expect(validate("TOOL", [])).toBe(false);
    expect(validate("TOOL", ["python_cell", "statistical_operator"])).toBe(true);
    expect(validate("TOOL", ["python_cell", "python_cell"])).toBe(false);
    expect(validate("TOOL", ["unknown"])).toBe(false);
    expect(validate("FINAL", [])).toBe(true);
    expect(validate("FINAL", ["publish_analysis_result"])).toBe(false);
  });
});
