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

  it("keeps month buckets typed and gives the repair turn actionable SQL safety feedback", () => {
    const prompt = directRunBoundProviderDispatcherInternals.text2SqlSpecialistSystemPrompt(
      '{"schema_version":"text2sql-repair-context@1.0.0","rejection":{"diagnostic_code":"TEXT2SQL_SQL_DANGEROUS"}}',
    );

    expect(prompt).toContain("Only these SQL functions are permitted");
    expect(prompt).toContain("Do not use to_char");
    expect(prompt).toContain("return date_trunc as a DATE or DATETIME result column");
    expect(prompt).toContain("When the frozen snapshot lists a time column as text");
    expect(prompt).toContain("column_name::pg_catalog.timestamp");
    expect(prompt).toContain("Never write a type name as a prefix");
    expect(prompt).toContain("TEXT2SQL_SQL_DANGEROUS means replace every unlisted function");
    expect(prompt).toContain(
      "DATASOURCE_ADAPTER_SQL_REJECTED means replace invalid PostgreSQL syntax",
    );
    expect(prompt).toContain(
      "DATASOURCE_ADAPTER_SQL_GROUPING_ERROR means make every non-aggregate SELECT expression structurally identical",
    );
    expect(prompt).toContain(
      "DATASOURCE_ADAPTER_SQL_TYPE_ERROR means follow the exact listed physical column types",
    );
    expect(prompt).toContain("semantic_context.request_scoped_interpretations");
    expect(prompt).toContain("aggregates numerator and denominator separately before division");
  });

  it("allows a missing exact semantic term to close only through governed request-scoped primitives", () => {
    const prompt = directRunBoundProviderDispatcherInternals.semanticSpecialistSystemPrompt(
      '{"metrics":[{"metric_id":"metric.order_revenue"}]}',
    );

    expect(prompt).toContain("request_scoped_operations");
    expect(prompt).toContain("PERIOD_COMPARISON_RATE");
    expect(prompt).toContain("SUBTRACT_DENOMINATOR for net ROI");
    expect(prompt).toContain("must not create, update, approve, or imply a Published formula");
    expect(prompt).toContain("do not expose index or governance lookup failures");
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

  it("projects only strict tool observations and verifier feedback into later Root turns", () => {
    const artifactRef = {
      artifact_id: "90000000-0000-4000-8000-000000000010",
      artifact_type: "QueryEvidence",
      app_id: "90000000-0000-4000-8000-000000000011",
      tenant_id: "90000000-0000-4000-8000-000000000012",
      environment: "test",
      run_id: "90000000-0000-4000-8000-000000000013",
      revision: 1,
      content_hash: `sha256:${"a".repeat(64)}`,
    } as const;
    const request = {
      kind: "ROOT",
      turn_index: 2,
      tool_observations: [
        {
          schema_version: "root-tool-observation@1.0.0",
          tool_call_id: "query-1",
          profile_id: "governed-text2sql-agent",
          status: "COMPLETED",
          output_ref: artifactRef,
          safe_projection: {
            schema_version: "root-tool-safe-projection@1.0.0",
            artifact_ref: artifactRef,
            projection_kind: "TABLE",
            title: "趋势",
            summary: "12 accepted governed rows are available.",
            column_keys: ["month", "revenue"],
            total_rows: 12,
            source_artifact_refs: [],
          },
          error_code: null,
        },
      ],
      verifier_feedback: {
        schema_version: "root-verifier-feedback@1.0.0",
        status: "REJECTED",
        reason_code: "ROOT_ANSWER_ARTIFACT_NOT_ACCEPTED",
      },
    } as const;
    const messages = directRunBoundProviderDispatcherInternals.buildRootLoopMessages(request);

    expect(messages).toEqual([
      { role: "system", content: "Current normal Root turn index: 2." },
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("Server-owned Tool Result"),
      }),
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("ROOT_ANSWER_ARTIFACT_NOT_ACCEPTED"),
      }),
    ]);
    expect(messages[1]).not.toHaveProperty("tool_call_id");
    expect(messages[1]?.content).toContain('"tool_call_id":"query-1"');
    expect(messages[1]?.content).toContain('"schema_version":"root-provider-tool-result@1.0.0"');
    expect(messages[1]?.content).toContain('"total_rows":12');
    expect(messages[1]?.content).not.toContain('"rows":');
    expect(() =>
      directRunBoundProviderDispatcherInternals.buildRootLoopMessages({
        ...request,
        tool_observations: [
          {
            ...request.tool_observations[0],
            safe_projection: {
              ...request.tool_observations[0].safe_projection,
              rows: [{ revenue: 10 }],
            },
          },
        ],
      }),
    ).toThrow();
  });
});
