import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildAnalysisResultContract } from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import type { AnalysisToolCallCandidate } from "@data-agent/contracts/ports";
import {
  STATISTICAL_OPERATOR_REGISTRY_DIGEST,
  type StatisticalOperatorObligation,
} from "@data-agent/contracts/statistical-operators";
import { describe, expect, it } from "vitest";
import {
  type AnalysisOperatorArgumentExtractorPort,
  type AnalysisToolLoopProgressEvent,
  analysisToolLoopInternals,
  executeAnalysisToolLoop,
} from "../../src/analysis/analysis-tool-loop.js";
import type {
  AnalysisAgentModelPort,
  AnalysisAgentModelTurnResult,
} from "../../src/analysis/deepseek-analysis-agent.js";
import type {
  GovernedResultBridge,
  RecoveredGovernedOperatorResult,
} from "../../src/analysis/governed-result-bridge.js";
import {
  AnalysisSandboxRuntimeError,
  type OpenSandboxAnalysisSession,
} from "../../src/runs/opensandbox-analysis-runtime.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const fakeDigest = `sha256:${"a".repeat(64)}` as const;
const operatorOutput = {
  tests: [{ label: "a", adjusted_p_value: 0.01, rejected: true }],
};

describe("safe cell diagnostics", () => {
  it("projects only allowlisted AST policy identifiers", () => {
    expect(
      analysisToolLoopInternals.safePolicyViolationIdentifier({
        code: "IMPORT_DENIED",
        detail: "os,pathlib.Path",
      }),
    ).toBe("os,pathlib.Path");
    expect(
      analysisToolLoopInternals.safePolicyViolationIdentifier({
        code: "FILE_PATH_DENIED",
        detail: "/workspace/secret.csv",
      }),
    ).toBeNull();
    expect(
      analysisToolLoopInternals.safePolicyViolationIdentifier({
        code: "NAME_DENIED",
        detail: "identifier with raw value",
      }),
    ).toBeNull();
  });

  it("repairs an allowlisted fixed extractor failure without exposing raw Python errors", () => {
    expect(
      analysisToolLoopInternals.repairablePublishFailureCode(
        new TypeError("ANALYSIS_RESULT_TEXT_POLICY_MISMATCH"),
      ),
    ).toBe("ANALYSIS_RESULT_TEXT_POLICY_MISMATCH");
    expect(
      analysisToolLoopInternals.repairablePublishFailureCode(
        new TypeError("ANALYSIS_RESULT_TABLE_COLUMNS_MISMATCH"),
      ),
    ).toBe("ANALYSIS_RESULT_TABLE_COLUMNS_MISMATCH");
    expect(
      analysisToolLoopInternals.repairablePublishFailureCode(
        new TypeError("ANALYSIS_RESULT_COLLECTION_PREDICATE_MISMATCH"),
      ),
    ).toBe("ANALYSIS_RESULT_COLLECTION_PREDICATE_MISMATCH");
    expect(
      analysisToolLoopInternals.repairablePublishFailureCode(
        new TypeError("ANALYSIS_RESULT_TABLE_PROJECTION_MISMATCH"),
      ),
    ).toBe("ANALYSIS_RESULT_TABLE_PROJECTION_MISMATCH");
    expect(
      analysisToolLoopInternals.repairablePublishFailureCode(
        new AnalysisSandboxRuntimeError(
          "ANALYSIS_SANDBOX_SYMBOL_EXTRACTION_REJECTED",
          "CELL",
          false,
          "ANALYSIS_RESULT_TIMESTAMP_TIMEZONE_REQUIRED",
        ),
      ),
    ).toBe("ANALYSIS_RESULT_TIMESTAMP_TIMEZONE_REQUIRED");
    expect(
      analysisToolLoopInternals.repairablePublishFailureCode(
        new AnalysisSandboxRuntimeError("ANALYSIS_SANDBOX_ARTIFACT_INVALID", "ARTIFACT", false),
      ),
    ).toBeNull();
  });

  it("extracts only the missing attribute identifier", () => {
    expect(
      analysisToolLoopInternals.safeCellErrorIdentifier({
        schema_version: "analysis-cell-observation@1.0.0",
        cell_id: "failed-cell",
        status: "FAILED",
        execution_id: "execution-1",
        execution_count: 1,
        elapsed_ms: 1,
        stdout: "",
        stderr: "secret traceback",
        result_text: null,
        error: {
          name: "AttributeError",
          value: "'DataFrame' object has no attribute 'to_list'",
        },
      }),
    ).toBe("to_list");
  });

  it("projects a data-free assertion code but rejects assertion text", () => {
    const observation = (value: string) => ({
      schema_version: "analysis-cell-observation@1.0.0" as const,
      cell_id: "failed-cell",
      status: "FAILED" as const,
      execution_id: "execution-1",
      execution_count: 1,
      elapsed_ms: 1,
      stdout: "",
      stderr: "secret traceback",
      result_text: null,
      error: { name: "AssertionError", value },
    });
    expect(
      analysisToolLoopInternals.safeCellErrorIdentifier(observation("SHAPLEY_FACTOR_NON_FINITE")),
    ).toBe("SHAPLEY_FACTOR_NON_FINITE");
    expect(
      analysisToolLoopInternals.safeCellErrorIdentifier(
        observation("factor value 3.14 was not finite"),
      ),
    ).toBeNull();
  });
});

function digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function providerRef(index: number) {
  return {
    resource_id: `019d2d97-110c-7735-8fbb-${String(index).padStart(12, "0")}`,
    resource_revision: 1,
    resource_hash: fakeDigest,
  } as const;
}

async function resultContract() {
  return buildAnalysisResultContract({
    schema_version: "analysis-result-contract@2.0.0",
    contract_id: "falcon24.q1.result",
    semantic_context_hash: fakeDigest,
    result_fields: [
      { field: "tests", data_type: "JSON", nullable: false, semantic_role: "DERIVED" },
      { field: "period", data_type: "DATE", nullable: false, semantic_role: "DIMENSION" },
    ],
    metric_bindings: [
      {
        semantic_metric_id: "metric.adjusted_p_value",
        field: "tests",
        unit: null,
        aggregation: "NONE",
        formula_hash: fakeDigest,
      },
    ],
    dimension_bindings: [{ semantic_dimension_id: "dimension.period", field: "period" }],
    grain: {
      dimension_ids: ["dimension.period"],
      time_dimension_id: "dimension.period",
      time_grain: "MONTH",
    },
    lineage: [
      {
        field: "tests",
        source_semantic_object_ids: ["metric.adjusted_p_value"],
        source_physical_fields: ["orders.total_amount"],
        transformation: "STATISTICAL_OPERATOR",
      },
      {
        field: "period",
        source_semantic_object_ids: ["dimension.period"],
        source_physical_fields: ["orders.order_date"],
        transformation: "DIRECT",
      },
    ],
    collection_constraints: [],
    tables: [
      {
        table_id: "monthly_trend",
        title_zh: "月度趋势",
        required: true,
        columns: [
          {
            key: "period",
            label_zh: "月份",
            data_type: "DATE",
            nullable: false,
            semantic_object_id: "dimension.period",
            semantic_role: "DIMENSION",
          },
          {
            key: "revenue",
            label_zh: "收入",
            data_type: "NUMBER",
            nullable: false,
            semantic_object_id: "metric.order_revenue",
            semantic_role: "METRIC",
          },
        ],
        projection: { mode: "MODEL_DERIVED" },
        max_rows: 18,
      },
    ],
    charts: [
      {
        chart_id: "monthly_chart",
        title_zh: "月度趋势图",
        required: true,
        intent: "TREND",
        table_id: "monthly_trend",
        allowed_template_ids: ["line.multi-series@1"],
      },
    ],
    limits: {
      max_result_bytes: 1_048_576,
      max_table_rows: 18,
      max_table_columns: 16,
      max_closure_bytes: 4_194_304,
    },
  });
}

const obligation = {
  call_id: "bh",
  operator_id: "multiple-testing.bh-fdr@1",
  result_binding: {
    result_output_name: "result",
    result_collection_path: "/tests",
    operator_collection_path: "/tests",
    label_fields: ["label"],
    value_bindings: [
      {
        result_field: "adjusted_p_value",
        operator_field: "adjusted_p_value",
        comparison: "EXACT",
        absolute_tolerance: 0,
        relative_tolerance: 0,
      },
    ],
    require_exact_label_set: true,
  },
} as const satisfies StatisticalOperatorObligation;

function cell(cellId: string, source = `value_${cellId.replaceAll("-", "_")} = 1`) {
  return {
    tool_call_id: `tool-${cellId}`,
    tool_name: "python_cell",
    arguments: {
      schema_version: "analysis-python-cell-tool@1.0.0",
      cell_id: cellId,
      source,
      timeout_ms: 1_000,
    },
  } as const satisfies AnalysisToolCallCandidate;
}

function operatorCall() {
  return {
    tool_call_id: "tool-bh",
    tool_name: "statistical_operator",
    arguments: {
      schema_version: "analysis-statistical-operator-tool@1.0.0",
      call_id: "bh",
      operator_id: "multiple-testing.bh-fdr@1",
      inputs_symbol: "operator_inputs",
      parameters_symbol: "operator_parameters",
    },
  } as const satisfies AnalysisToolCallCandidate;
}

function publishCall(publishId = "q1-final", includeOperator = true) {
  return {
    tool_call_id: `tool-${publishId}`,
    tool_name: "publish_analysis_result",
    arguments: {
      schema_version: "analysis-result-publish-tool@1.0.0",
      publish_id: publishId,
      result_symbol: "result_document",
      table_bindings: [{ table_id: "monthly_trend", data_symbol: "monthly_table" }],
      chart_bindings: [
        {
          chart_id: "monthly_chart",
          intent: "TREND",
          template_id: "line.multi-series@1",
          data_symbol: "monthly_table",
          x_field: "period",
          y_fields: ["revenue"],
          series_field: "",
          lower_bound_field: "",
          upper_bound_field: "",
        },
      ],
      operator_bindings: includeOperator
        ? [
            {
              call_id: "bh",
              operator_id: "multiple-testing.bh-fdr@1" as const,
              result_symbol: "bh_result",
            },
          ]
        : [],
    },
  } as const satisfies AnalysisToolCallCandidate;
}

type ToolScriptItem = AnalysisToolCallCandidate | "INVALID_TOOL";

function scriptedModel(
  script: readonly ToolScriptItem[],
  calls: Parameters<AnalysisAgentModelPort["turn"]>[0][],
): AnalysisAgentModelPort {
  let toolIndex = 0;
  return {
    async turn(input) {
      calls.push(input);
      if (input.phase === "FINAL") {
        return {
          phase: "FINAL",
          response: {
            schema_version: "analysis-agent-final@1.0.0",
            summary_zh: "已根据冻结结果完成解释，并保留关联性措辞。",
          },
          provider_invocation_ref: providerRef(100 + toolIndex),
        };
      }
      const next = script[toolIndex++];
      if (!next) throw new Error("unexpected model tool turn");
      if (next === "INVALID_TOOL") {
        return {
          phase: "INVALID_TOOL",
          error_code: "ANALYSIS_AGENT_TOOL_CALL_INVALID",
          validation_issues: [{ path: "arguments.source", code: "invalid_type" }],
          provider_invocation_ref: providerRef(toolIndex),
        };
      }
      return {
        phase: "TOOL",
        assistant_text: "",
        tool_call: next,
        provider_invocation_ref: providerRef(toolIndex),
      } satisfies AnalysisAgentModelTurnResult;
    },
  };
}

interface SessionOptions {
  readonly policy_rejections?: ReadonlySet<string>;
  readonly runtime_failures?: ReadonlySet<string>;
  readonly invalid_publish_attempts?: number;
  readonly log?: string[];
  readonly operator_requests?: unknown[];
}

function session(options: SessionOptions = {}): OpenSandboxAnalysisSession {
  let invalidPublishAttempts = options.invalid_publish_attempts ?? 0;
  const mapping = (entries: readonly { readonly key: string; readonly value: unknown }[]) => ({
    kind: "OBJECT" as const,
    entries,
  });
  const resultEntries = () => [
    {
      key: "tests",
      value: {
        kind: "ARRAY" as const,
        items: operatorOutput.tests.map((test) =>
          mapping([
            { key: "label", value: { kind: "STRING" as const, value: test.label } },
            {
              key: "adjusted_p_value",
              value: { kind: "NUMBER" as const, value: test.adjusted_p_value },
            },
            { key: "rejected", value: { kind: "BOOLEAN" as const, value: test.rejected } },
          ]),
        ),
      },
    },
    { key: "period", value: { kind: "DATE" as const, value: "2024-10-01" } },
  ];
  const symbols = () =>
    new Map([
      [
        "result_document",
        {
          symbol_name: "result_document",
          symbol_kind: "MAPPING" as const,
          value: mapping([
            ...resultEntries(),
            ...(invalidPublishAttempts > 0
              ? [{ key: "unexpected", value: { kind: "STRING" as const, value: "x" } }]
              : []),
          ]),
        },
      ],
      [
        "monthly_table",
        {
          symbol_name: "monthly_table",
          symbol_kind: "TABLE" as const,
          columns: ["period", "revenue"],
          rows: [
            [
              { kind: "DATE" as const, value: "2024-09-01" },
              { kind: "NUMBER" as const, value: 100 },
            ],
            [
              { kind: "DATE" as const, value: "2024-10-01" },
              { kind: "NUMBER" as const, value: 120 },
            ],
          ],
        },
      ],
      [
        "bh_result",
        {
          symbol_name: "bh_result",
          symbol_kind: "MAPPING" as const,
          value: mapping([
            {
              key: "tests",
              value: {
                kind: "ARRAY" as const,
                items: operatorOutput.tests.map((test) =>
                  mapping([
                    { key: "label", value: { kind: "STRING" as const, value: test.label } },
                    {
                      key: "adjusted_p_value",
                      value: { kind: "NUMBER" as const, value: test.adjusted_p_value },
                    },
                    {
                      key: "rejected",
                      value: { kind: "BOOLEAN" as const, value: test.rejected },
                    },
                  ]),
                ),
              },
            },
          ]),
        },
      ],
    ] as const);
  const receipt = {
    schema_version: "statistical-operator-call-receipt@1.0.0",
    call_id: "bh",
    operator_id: "multiple-testing.bh-fdr@1",
    operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
    implementation_digest: fakeDigest,
    resolved_parameters: { alpha: 0.05, method: "bh" },
    resolved_parameters_hash: fakeDigest,
    input_hash: fakeDigest,
    output_hash: fakeDigest,
    result_binding_hash: fakeDigest,
    sample_size: null,
    group_count: null,
    family_size: 1,
    rank: null,
    applicability: "ASSUMPTION_BOUND",
    limitation_codes: ["DEPENDENCE_STRUCTURE_NOT_VERIFIED"],
  } as const;
  const successfulCell = (cellId: string, executionCount: number) => ({
    cell_id: cellId,
    status: "SUCCEEDED" as const,
    execution_id: `execution-${executionCount}`,
    execution_count: executionCount,
    elapsed_ms: 1,
    stdout: "",
    stderr: "",
    result_text: "ok",
    error: null,
  });
  let executionCount = 0;

  return {
    agent_sandbox_id: "agent",
    operator_sandbox_id: "operator",
    runtime_profile: "CORE_ANALYSIS",
    agent_image: "agent@sha256:test",
    operator_image: "operator@sha256:test",
    secure_access: true,
    async uploadAgentFile(input) {
      options.log?.push(`upload:${input.path}`);
      expect(digest(input.content)).toBe(input.content_sha256);
    },
    async bindGovernedInput(input) {
      return {
        binding_id: "input-binding-aaaaaaaaaaaaaaaaaaaaaaaa",
        input_symbol: "__da_input_aaaaaaaaaaaaaaaaaaaaaaaa",
        content_sha256: input.content_sha256,
      };
    },
    async admitAgentCell(input) {
      if (options.policy_rejections?.has(input.cell_id)) {
        return {
          schema_version: "analysis-cell-policy-result@1.0.0",
          cell_id: input.cell_id,
          status: "REJECTED",
          violations: [{ code: "IMPORT_NOT_ALLOWED", line: 1, detail: "scrubbed" }],
        };
      }
      return {
        schema_version: "analysis-cell-policy-result@1.0.0",
        cell_id: input.cell_id,
        status: "ADMITTED",
        violations: [],
      };
    },
    async runAgentCell(input) {
      executionCount += 1;
      options.log?.push(`cell:${input.cell_id}`);
      if (options.runtime_failures?.has(input.cell_id)) {
        return {
          cell_id: input.cell_id,
          status: "FAILED",
          execution_id: `execution-${executionCount}`,
          execution_count: executionCount,
          elapsed_ms: 1,
          stdout: "secret stdout",
          stderr: "secret traceback",
          result_text: null,
          error: { name: "ValueError", value: "secret raw row" },
        };
      }
      return successfulCell(input.cell_id, executionCount);
    },
    async recoverAgentContext() {},
    async freezeAgentContext() {},
    async bindGovernedResult(input) {
      return {
        binding_id: "binding-aaaaaaaaaaaaaaaaaaaaaaaa",
        result_symbol: "__da_gov_aaaaaaaaaaaaaaaaaaaaaaaa",
        result_sha256: input.governed_result.result_sha256 as `sha256:${string}`,
      };
    },
    async extractAgentSymbols(input) {
      options.log?.push("publish:extract");
      const available: ReadonlyMap<string, unknown> = symbols();
      const selected = input.symbols.map(({ symbol_name }) => {
        const value = available.get(symbol_name);
        if (!value) throw new Error(`missing fixture symbol ${symbol_name}`);
        return value;
      });
      if (invalidPublishAttempts > 0) invalidPublishAttempts -= 1;
      return {
        schema_version: "analysis-extracted-symbols@1.0.0",
        symbols: selected,
      };
    },
    async runOperator(input) {
      options.log?.push("operator:run");
      const request = JSON.parse(decoder.decode(input.request)) as unknown;
      options.operator_requests?.push(request);
      const output = encoder.encode(
        JSON.stringify({
          schema_version: "statistical-operator-tool-result@1.0.0",
          call_id: "bh",
          operator_id: "multiple-testing.bh-fdr@1",
          operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
          output: operatorOutput,
          execution_evidence: {
            call_id: "bh",
            operator_id: "multiple-testing.bh-fdr@1",
            operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
            implementation_digest: fakeDigest,
            resolved_parameters: { alpha: 0.05, method: "bh" },
            resolved_parameters_hash: fakeDigest,
            input_hash: fakeDigest,
            output_hash: fakeDigest,
            sample_size: null,
            group_count: null,
            family_size: 1,
            rank: null,
            applicability: "ASSUMPTION_BOUND",
            limitation_codes: ["DEPENDENCE_STRUCTURE_NOT_VERIFIED"],
          },
        }),
      );
      return {
        call_id: input.call_id,
        status: "SUCCEEDED",
        elapsed_ms: 1,
        request_sha256: input.request_sha256,
        output_sha256: digest(output),
        output,
        cell: successfulCell(`operator-${input.call_id}`, 1),
      };
    },
    async finalizeOperators(input) {
      options.log?.push("operator:finalize");
      const request = JSON.parse(decoder.decode(input.request)) as {
        json_outputs: { result: typeof operatorOutput & { period: string } };
      };
      expect(request.json_outputs.result.tests).toEqual(operatorOutput.tests);
      const output = encoder.encode(
        JSON.stringify({
          schema_version: "statistical-operator-finalization-result@1.0.0",
          operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
          operator_receipts: [receipt],
          operator_receipt_closure_hash: fakeDigest,
        }),
      );
      return {
        finalization_id: input.finalization_id,
        status: "SUCCEEDED",
        elapsed_ms: 1,
        request_sha256: input.request_sha256,
        output_sha256: digest(output),
        output,
        cell: successfulCell("operator-finalization", 2),
      };
    },
    async close() {},
  };
}

function governedResultBridge(): GovernedResultBridge {
  let committed: Awaited<ReturnType<GovernedResultBridge["persist"]>> | null = null;
  return {
    async recordModelCell() {
      return {
        journal_seq: 1,
        source_ref: {
          artifact_id: "019d2d97-110c-7735-8fbb-000000000006",
          artifact_type: "SensitiveExecutionArtifact",
          app_id: "019d2d97-110c-7735-8fbb-000000000001",
          tenant_id: "019d2d97-110c-7735-8fbb-000000000002",
          environment: "test",
          run_id: "019d2d97-110c-7735-8fbb-2c9342145a8d",
          revision: 1,
          content_hash: fakeDigest,
        },
      };
    },
    async recordOperatorIntent() {
      return { journal_seq: 2 };
    },
    async persist(input) {
      const resultSha256 = await sha256ContentHash(input.output);
      committed = {
        schema_version: "governed-operator-result-ref@1.0.0",
        scope: {
          app_id: "019d2d97-110c-7735-8fbb-000000000001",
          tenant_id: "019d2d97-110c-7735-8fbb-000000000002",
          environment: "test",
        },
        run_id: "019d2d97-110c-7735-8fbb-2c9342145a8d",
        node_id: "node-1",
        attempt_id: "019d2d97-110c-7735-8fbb-000000000003",
        context_generation: 1,
        call_id: input.call_id,
        operator_id: input.operator_id,
        program_hash: fakeDigest,
        request_sha256: input.request_sha256,
        result_artifact_ref: {
          artifact_id: "019d2d97-110c-7735-8fbb-000000000004",
          artifact_type: "SandboxResult",
          app_id: "019d2d97-110c-7735-8fbb-000000000001",
          tenant_id: "019d2d97-110c-7735-8fbb-000000000002",
          environment: "test",
          run_id: "019d2d97-110c-7735-8fbb-2c9342145a8d",
          revision: 1,
          content_hash: resultSha256,
        },
        result_sha256: resultSha256,
        result_bytes: encoder.encode(JSON.stringify(input.output)).byteLength,
        shape: { kind: "MAPPING", keys: 1, bounded_summary: "tests" },
        receipt_ref: {
          artifact_id: "019d2d97-110c-7735-8fbb-000000000005",
          artifact_type: "SandboxExecutionReceipt",
          app_id: "019d2d97-110c-7735-8fbb-000000000001",
          tenant_id: "019d2d97-110c-7735-8fbb-000000000002",
          environment: "test",
          run_id: "019d2d97-110c-7735-8fbb-2c9342145a8d",
          revision: 1,
          content_hash: fakeDigest,
        },
        worker_fence: 1,
      };
      return committed;
    },
    async bind() {
      if (!committed) throw new Error("result not committed");
      return {
        binding_id: "binding-aaaaaaaaaaaaaaaaaaaaaaaa",
        result_symbol: "__da_gov_aaaaaaaaaaaaaaaaaaaaaaaa",
        result_sha256: committed.result_sha256 as `sha256:${string}`,
        journal_seq: 4,
      };
    },
    async recover() {
      return [];
    },
  };
}

function operatorArgumentExtractor(
  calls: { inputs_symbol: string; parameters_symbol: string }[] = [],
): AnalysisOperatorArgumentExtractorPort {
  return {
    async extract(input) {
      calls.push(input);
      return {
        inputs: { p_values: [0.01] },
        parameters: { alpha: 0.05 },
      };
    },
  };
}

async function recoveredOperatorResult(): Promise<RecoveredGovernedOperatorResult> {
  const request = encoder.encode(
    JSON.stringify({
      schema_version: "statistical-operator-tool-call@1.0.0",
      call_id: obligation.call_id,
      operator_id: obligation.operator_id,
      operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
      runtime_profile: "CORE_ANALYSIS",
      obligation,
      inputs: { p_values: [0.01] },
      parameters: { alpha: 0.05 },
    }),
  );
  const resultSha256 = await sha256ContentHash(operatorOutput);
  return {
    result: {
      schema_version: "governed-operator-result-ref@1.0.0",
      scope: {
        app_id: "019d2d97-110c-7735-8fbb-000000000001",
        tenant_id: "019d2d97-110c-7735-8fbb-000000000002",
        environment: "test",
      },
      run_id: "019d2d97-110c-7735-8fbb-2c9342145a8d",
      node_id: "node-1",
      attempt_id: "019d2d97-110c-7735-8fbb-000000000003",
      context_generation: 1,
      call_id: obligation.call_id,
      operator_id: obligation.operator_id,
      program_hash: fakeDigest,
      request_sha256: digest(request),
      result_artifact_ref: {
        artifact_id: "019d2d97-110c-7735-8fbb-000000000004",
        artifact_type: "SandboxResult",
        app_id: "019d2d97-110c-7735-8fbb-000000000001",
        tenant_id: "019d2d97-110c-7735-8fbb-000000000002",
        environment: "test",
        run_id: "019d2d97-110c-7735-8fbb-2c9342145a8d",
        revision: 1,
        content_hash: resultSha256,
      },
      result_sha256: resultSha256,
      result_bytes: encoder.encode(JSON.stringify(operatorOutput)).byteLength,
      shape: { kind: "MAPPING", keys: 1, bounded_summary: "tests" },
      receipt_ref: {
        artifact_id: "019d2d97-110c-7735-8fbb-000000000005",
        artifact_type: "SandboxExecutionReceipt",
        app_id: "019d2d97-110c-7735-8fbb-000000000001",
        tenant_id: "019d2d97-110c-7735-8fbb-000000000002",
        environment: "test",
        run_id: "019d2d97-110c-7735-8fbb-2c9342145a8d",
        revision: 1,
        content_hash: fakeDigest,
      },
      worker_fence: 1,
    },
    request_content: request,
    receipt_payload: {
      schema_version: "governed-operator-result-receipt@1.0.0",
      call_id: obligation.call_id,
      operator_id: obligation.operator_id,
      request_sha256: digest(request),
      result_sha256: resultSha256,
      execution_evidence: {
        call_id: obligation.call_id,
        operator_id: obligation.operator_id,
        operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
        implementation_digest: fakeDigest,
        resolved_parameters: { alpha: 0.05, method: "bh" },
        resolved_parameters_hash: fakeDigest,
        input_hash: fakeDigest,
        output_hash: fakeDigest,
        sample_size: null,
        group_count: null,
        family_size: 1,
        rank: null,
        applicability: "ASSUMPTION_BOUND",
        limitation_codes: ["DEPENDENCE_STRUCTURE_NOT_VERIFIED"],
      },
    },
    binding: {
      binding_id: "binding-aaaaaaaaaaaaaaaaaaaaaaaa",
      result_symbol: "__da_gov_aaaaaaaaaaaaaaaaaaaaaaaa",
      result_sha256: resultSha256,
      journal_seq: 4,
    },
  };
}

async function run(input: {
  readonly script: readonly ToolScriptItem[];
  readonly session?: OpenSandboxAnalysisSession;
  readonly obligations?: readonly StatisticalOperatorObligation[];
  readonly extractor?: AnalysisOperatorArgumentExtractorPort;
  readonly progress?: AnalysisToolLoopProgressEvent[];
  readonly calls?: Parameters<AnalysisAgentModelPort["turn"]>[0][];
  readonly max_tool_turns?: number;
  readonly recovered_operator_results?: readonly RecoveredGovernedOperatorResult[];
}) {
  const calls = input.calls ?? [];
  const obligations = input.obligations ?? [obligation];
  return executeAnalysisToolLoop({
    run_id: "019d2d97-110c-7735-8fbb-2c9342145a8d",
    analysis_program_id: "program-1",
    node_id: "node-1",
    generated_source_policy:
      obligations.length > 0 ? "GOVERNED_OPERATOR_ORCHESTRATION" : "OPEN_ANALYSIS",
    runtime_profile: "CORE_ANALYSIS",
    result_contract: await resultContract(),
    operator_obligations: obligations,
    operator_argument_extractor: input.extractor ?? operatorArgumentExtractor(),
    governed_result_bridge: governedResultBridge(),
    recovered_operator_results: input.recovered_operator_results ?? [],
    stage: {
      async stage({ closure }) {
        return {
          stage_id: "019d2d97-110c-7735-8fbb-000000000099",
          closure_hash: closure.closure_hash,
        };
      },
    },
    initial_messages: [{ role: "system", content: "Use governed tools." }],
    model: scriptedModel(input.script, calls),
    session: input.session ?? session(),
    max_tool_turns: input.max_tool_turns ?? 12,
    max_output_tokens: 2_048,
    on_progress(event) {
      input.progress?.push(event);
    },
  });
}

describe("unique analysis Result Publisher state machine", () => {
  it("reuses Journal-recovered governed results without rerunning the operator", async () => {
    const log: string[] = [];
    const calls: Parameters<AnalysisAgentModelPort["turn"]>[0][] = [];
    const result = await run({
      script: [cell("after-recovery"), publishCall()],
      session: session({ log }),
      calls,
      recovered_operator_results: [await recoveredOperatorResult()],
    });

    expect(log).not.toContain("operator:run");
    expect(log).toContain("operator:finalize");
    expect(result.operator_observations).toHaveLength(1);
    expect(JSON.stringify(calls[0]?.messages)).toContain("SERVER_RECOVERED_GOVERNED_RESULTS");
    expect(JSON.stringify(calls[0]?.messages)).not.toContain('"output"');
    expect(JSON.stringify(calls[0]?.messages)).not.toContain("/workspace/");
  });
  it("closes operators and durably stages exactly one result/table/chart closure", async () => {
    const calls: Parameters<AnalysisAgentModelPort["turn"]>[0][] = [];
    const log: string[] = [];
    const operatorRequests: unknown[] = [];
    const argumentCalls: { inputs_symbol: string; parameters_symbol: string }[] = [];
    const result = await run({
      script: [
        cell("prepare"),
        operatorCall(),
        cell("assemble", "result_document = {}; monthly_table = []; bh_result = {}"),
        publishCall(),
      ],
      session: session({ log, operator_requests: operatorRequests }),
      extractor: operatorArgumentExtractor(argumentCalls),
      calls,
    });

    expect(result.state_sequence).toEqual([
      "ANALYZE",
      "OPERATOR_INTENT",
      "OPERATOR_RESULT_COMMITTED",
      "RESULT_BOUND",
      "ANALYZE",
      "OPERATORS_CLOSED",
      "PUBLISH_REQUIRED",
      "PUBLISH_STAGED",
    ]);
    expect(
      result.published_result.closure.artifacts.map(({ artifact_kind }) => artifact_kind),
    ).toEqual(["RESULT", "TABLE", "CHART"]);
    expect(log.filter((item) => item === "publish:extract")).toHaveLength(1);
    expect(log.indexOf("publish:extract")).toBeLessThan(log.indexOf("operator:finalize"));
    expect(argumentCalls).toEqual([
      { inputs_symbol: "operator_inputs", parameters_symbol: "operator_parameters" },
    ]);
    expect(operatorRequests).toMatchObject([
      { inputs: { p_values: [0.01] }, parameters: { alpha: 0.05 } },
    ]);
    const boundedOperatorResult = calls
      .flatMap(({ messages }) => messages)
      .find(({ content }) => content.includes('"status":"BOUND"'))?.content;
    expect(boundedOperatorResult).toContain('"result_symbol":"__da_gov_');
    expect(boundedOperatorResult).toContain(
      '"collection_expression":"__da_gov_aaaaaaaaaaaaaaaaaaaaaaaa[\\"tests\\"]"',
    );
    expect(boundedOperatorResult).toContain('"instruction":"Read this exact protected symbol');
    expect(boundedOperatorResult).not.toContain('"output"');
    expect(boundedOperatorResult).not.toContain("workspace");
    expect(boundedOperatorResult).not.toContain("execution_evidence");
    expect(calls.map(({ allowed_tool_names }) => allowed_tool_names)).toEqual([
      ["python_cell", "statistical_operator"],
      ["python_cell", "statistical_operator"],
      ["python_cell", "publish_analysis_result"],
      ["python_cell", "publish_analysis_result"],
    ]);
    expect(calls.at(-1)?.phase).toBe("TOOL");
  });

  it("rejects early publish, spends one model-contract repair, then allows one publish after Python", async () => {
    const progress: AnalysisToolLoopProgressEvent[] = [];
    const calls: Parameters<AnalysisAgentModelPort["turn"]>[0][] = [];
    const result = await run({
      script: [publishCall("early", false), cell("prepare"), publishCall("early", false)],
      obligations: [],
      progress,
      calls,
    });

    expect(progress).toContainEqual(
      expect.objectContaining({
        outcome: "TOOL_STATE_REJECTED",
        repair_category: "MODEL_TOOL_CONTRACT",
        failure_code: "ANALYSIS_AGENT_PUBLISH_NOT_READY",
      }),
    );
    expect(result.repair_attempts.MODEL_TOOL_CONTRACT).toBe(1);
    expect(calls[0]?.allowed_tool_names).toEqual(["python_cell"]);
    expect(result.published_result.observation.publish_id).toBe("early");
  });

  it("enforces one independent repair per model, policy, execution, and publish category", async () => {
    const progress: AnalysisToolLoopProgressEvent[] = [];
    const result = await run({
      script: [
        "INVALID_TOOL",
        cell("policy-bad"),
        cell("runtime-bad"),
        cell("fixed"),
        publishCall("first", false),
        cell("publish-fix"),
        publishCall("first", false),
      ],
      obligations: [],
      session: session({
        policy_rejections: new Set(["policy-bad"]),
        runtime_failures: new Set(["runtime-bad"]),
        invalid_publish_attempts: 1,
      }),
      progress,
    });

    expect(result.repair_attempts).toEqual({
      MODEL_TOOL_CONTRACT: 1,
      CELL_EXECUTION: 1,
      CELL_POLICY: 1,
      PUBLISH_SYMBOL_CONTRACT: 1,
    });
    const providerRepairMessages = progress.filter(
      ({ repair_category }) => repair_category !== null,
    );
    expect(providerRepairMessages.map(({ repair_category }) => repair_category)).toEqual([
      "MODEL_TOOL_CONTRACT",
      "CELL_POLICY",
      "CELL_EXECUTION",
      "PUBLISH_SYMBOL_CONTRACT",
    ]);
    expect(progress).toContainEqual(
      expect.objectContaining({
        repair_category: "CELL_POLICY",
        policy_violation_codes: ["IMPORT_NOT_ALLOWED"],
      }),
    );
    expect(progress).toContainEqual(
      expect.objectContaining({
        repair_category: "CELL_EXECUTION",
        cell_error_name: "ValueError",
        cell_error_identifier: null,
      }),
    );
    const serializedProgress = JSON.stringify(progress);
    expect(serializedProgress).not.toContain("secret raw row");
    expect(serializedProgress).not.toContain("secret traceback");
  });

  it("terminates on the second failure in the same repair category", async () => {
    await expect(
      run({
        script: ["INVALID_TOOL", "INVALID_TOOL"],
        obligations: [],
      }),
    ).rejects.toThrow("ANALYSIS_AGENT_REPAIR_BUDGET_EXHAUSTED_MODEL_TOOL_CONTRACT");

    await expect(
      run({
        script: [
          cell("prepare"),
          publishCall("retry", false),
          cell("repair"),
          publishCall("retry", false),
        ],
        obligations: [],
        session: session({ invalid_publish_attempts: 2 }),
      }),
    ).rejects.toThrow("ANALYSIS_AGENT_REPAIR_BUDGET_EXHAUSTED_PUBLISH_SYMBOL_CONTRACT");
  });

  it("spends the existing model-contract repair once, then terminates repeated non-progress", async () => {
    const repeatedSource = "raise ValueError('same failure')";
    const calls: Parameters<AnalysisAgentModelPort["turn"]>[0][] = [];
    await expect(
      run({
        script: [
          cell("failed-1", repeatedSource),
          cell("failed-2", repeatedSource),
          cell("failed-3", repeatedSource),
        ],
        obligations: [],
        session: session({
          runtime_failures: new Set(["failed-1", "failed-2", "failed-3"]),
        }),
        calls,
        max_tool_turns: 12,
      }),
    ).rejects.toThrow("ANALYSIS_AGENT_REPAIR_BUDGET_EXHAUSTED_MODEL_TOOL_CONTRACT");
    expect(calls).toHaveLength(3);
  });

  it("does not model-repair sandbox staging or governed receipt failures", async () => {
    const broken = session();
    const infrastructureFailure: OpenSandboxAnalysisSession = {
      ...broken,
      async extractAgentSymbols() {
        throw new Error("staging I/O unavailable");
      },
    };
    const calls: Parameters<AnalysisAgentModelPort["turn"]>[0][] = [];
    await expect(
      run({
        script: [cell("prepare"), publishCall("io-failure", false)],
        obligations: [],
        session: infrastructureFailure,
        calls,
      }),
    ).rejects.toThrow("staging I/O unavailable");
    expect(calls).toHaveLength(2);
  });

  it("contains no legacy output-file publishing path or declaration contract", () => {
    const source = readFileSync(
      new URL("../../src/analysis/analysis-tool-loop.ts", import.meta.url),
      "utf8",
    );
    const forbiddenFragments = [
      ["Python", "OutputContractV1"],
      ["declared_", "output_names"],
      ["/workspace/", "outputs"],
      ["readAgent", "File("],
      ["consecutive", "Failures"],
    ];
    for (const fragments of forbiddenFragments) {
      expect(source).not.toContain(fragments.join(""));
    }
  });
});
