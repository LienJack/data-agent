import { describe, expect, it } from "vitest";
import { directRunBoundProviderDispatcherInternals } from "../../src/providers/direct-run-bound-provider-dispatcher.js";

describe("direct run-bound provider retry policy", () => {
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
