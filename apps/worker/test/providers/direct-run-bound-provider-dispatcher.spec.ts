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

  it("binds specialist context length to the frozen run budget instead of a smaller constant", () => {
    expect(
      directRunBoundProviderDispatcherInternals.validSpecialistContextText(
        "x".repeat(100_001),
        128_000,
      ),
    ).toBe(true);
    expect(
      directRunBoundProviderDispatcherInternals.validSpecialistContextText(
        "x".repeat(128_001),
        128_000,
      ),
    ).toBe(false);
  });

  it("keeps month buckets typed and gives the repair turn actionable SQL safety feedback", () => {
    const prompt = directRunBoundProviderDispatcherInternals.text2SqlSpecialistSystemPrompt(
      '{"schema_version":"text2sql-repair-context@1.0.0","rejection":{"diagnostic_code":"TEXT2SQL_SQL_DANGEROUS"}}',
    );

    expect(prompt).toContain("Only these SQL functions are permitted");
    expect(prompt).toContain("Do not use to_char");
    expect(prompt).toContain("date_trunc returns a PostgreSQL timestamp");
    expect(prompt).toContain("declare DATETIME unless the output expression is explicitly cast");
    expect(prompt).toContain("When the frozen snapshot lists a time column as text");
    expect(prompt).toContain("column_name::pg_catalog.timestamp");
    expect(prompt).toContain("Never write a type name as a prefix");
    expect(prompt).toContain("PHYSICAL_COLUMN");
    expect(prompt).toContain("row-level identifiers, dates, or values");
    expect(prompt).toContain(
      "QUERY_EVIDENCE_SEMANTIC_OBJECT_NOT_SELECTED means replace invented or out-of-scope result bindings",
    );
    expect(prompt).toContain("TEXT2SQL_SQL_DANGEROUS means replace every unlisted function");
    expect(prompt).toContain(
      "TEXT2SQL_SQL_RELATION_BINDING_REJECTED means replace every physical relation with an exact schema-qualified relation",
    );
    expect(prompt).toContain(
      "TEXT2SQL_SQL_PRIMITIVE_DENIED means remove every function, operator, cast, type, or SQL construct not explicitly permitted",
    );
    expect(prompt).toContain(
      "TEXT2SQL_SQL_PROJECTION_SHAPE_REJECTED means give every SELECT target an explicit unique ASCII alias",
    );
    expect(prompt).toContain(
      "TEXT2SQL_SQL_TARGET_ALIAS_REQUIRED means add AS ascii_alias to every SELECT item",
    );
    expect(prompt).toContain("TEXT2SQL_SQL_FUNCTION_DENIED means remove the unlisted function");
    expect(prompt).toContain("Before returning, scan the outer SELECT and every CTE SELECT");
    expect(prompt).toContain("Never compute current time with current_date");
    expect(prompt).toContain("frozen min_time and max_time");
    expect(prompt).toContain("TEXT2SQL_SQL_OPERATOR_DENIED means replace the denied operator");
    expect(prompt).toContain("TEXT2SQL_SQL_CAST_DENIED means replace the denied cast");
    expect(prompt).toContain("TEXT2SQL_SQL_LIMIT_SHAPE_REJECTED means remove OFFSET");
    expect(prompt).toContain("LIMIT $n::pg_catalog.int2|int4|int8");
    expect(prompt).toContain("TEXT2SQL_SQL_FROM_SHAPE_REJECTED means use exactly one FROM item");
    expect(prompt).toContain(
      "TEXT2SQL_SQL_ORDERING_SHAPE_REJECTED means order by a declared output alias or an exact column reference",
    );
    expect(prompt).toContain("LIMIT must use exactly one positional parameter");
    expect(prompt).toContain("JSON number, never a quoted numeric string");
    expect(prompt).toContain('"parameters":[7]');
    expect(prompt).toContain('not "parameters":["7"]');
    expect(prompt).toContain("An SQL integer cast does not repair a JSON string parameter");
    expect(prompt).toContain(
      "DATASOURCE_ADAPTER_SQL_REJECTED means replace invalid PostgreSQL syntax",
    );
    expect(prompt).toContain(
      "DATASOURCE_ADAPTER_SQL_GROUPING_ERROR means make every non-aggregate SELECT expression structurally identical",
    );
    expect(prompt).toContain(
      "DATASOURCE_ADAPTER_SQL_TYPE_ERROR means follow the exact listed physical column types",
    );
    expect(prompt).toContain(
      "QUERY_EVIDENCE_RESULT_BINDING_MISMATCH means make every SELECT output name and PostgreSQL result type agree",
    );
    expect(prompt).toContain("semantic_context.request_scoped_interpretations");
    expect(prompt).toContain("aggregates numerator and denominator separately before division");
  });

  it("binds analysis-program parameters to the frozen method schema", () => {
    const prompt = directRunBoundProviderDispatcherInternals.analysisProgramSpecialistSystemPrompt(
      '{"method_registry":{"entries":[{"method_id":"published-trend@1","parameter_schema":{"type":"object","properties":{},"additionalProperties":false}}]}}',
    );

    expect(prompt).toContain("parameters must validate exactly");
    expect(prompt).toContain("parameter_schema");
    expect(prompt).toContain("Unknown parameter keys are forbidden");
    expect(prompt).toContain("Use {} when the selected method needs no parameters");
  });

  it("allows a missing exact semantic term to close only through governed request-scoped primitives", () => {
    const prompt = directRunBoundProviderDispatcherInternals.semanticSpecialistSystemPrompt(
      '{"metrics":[{"metric_id":"metric.order_revenue"}]}',
    );

    expect(prompt).toContain("request_scoped_operations");
    expect(prompt).toContain("answer_scope");
    expect(prompt).toContain("SEMANTIC_FACTS_ONLY");
    expect(prompt).toContain("DATA_RESULT_REQUIRED");
    expect(prompt).toContain("PERIOD_COMPARISON_RATE");
    expect(prompt).toContain(
      "When the assigned objective requests a derived comparison term such as year-over-year growth",
    );
    expect(prompt).toContain("MUST emit the matching request_scoped_operations entry");
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
      accepted_input_artifacts: [
        {
          schema_version: "root-accepted-input-artifact@1.0.0",
          artifact_ref: artifactRef,
          safe_projection: {
            schema_version: "root-tool-safe-projection@1.0.0",
            artifact_ref: artifactRef,
            projection_kind: "TABLE",
            title: "已验收经营表格",
            summary: "12 accepted input rows are available.",
            column_keys: ["month", "revenue"],
            total_rows: 12,
            source_artifact_refs: [],
          },
        },
      ],
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
        content: expect.stringContaining("Server-owned accepted input Artifact"),
      }),
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("Server-owned Tool Result"),
      }),
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("ROOT_ANSWER_ARTIFACT_NOT_ACCEPTED"),
      }),
    ]);
    expect(messages[1]?.content).toContain('"schema_version":"root-accepted-input-artifact@1.0.0"');
    expect(messages[1]?.content).not.toContain('"rows":');
    expect(messages[2]).not.toHaveProperty("tool_call_id");
    expect(messages[2]?.content).toContain('"tool_call_id":"query-1"');
    expect(messages[2]?.content).toContain('"schema_version":"root-provider-tool-result@1.0.0"');
    expect(messages[2]?.content).toContain('"total_rows":12');
    expect(messages[2]?.content).not.toContain('"rows":');
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
