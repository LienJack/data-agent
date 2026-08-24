import { createHash } from "node:crypto";
import { STATISTICAL_OPERATOR_REGISTRY_DIGEST } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { executeAnalysisToolLoop } from "../../src/analysis/analysis-tool-loop.js";
import type {
  AnalysisAgentModelPort,
  AnalysisAgentModelTurnResult,
} from "../../src/analysis/deepseek-analysis-agent.js";
import type { OpenSandboxAnalysisSession } from "../../src/runs/opensandbox-analysis-runtime.js";

const encoder = new TextEncoder();
const operatorOutput = { tests: [{ label: "a", adjusted_p_value: 0.01, rejected: true }] };
const digest = (bytes: Uint8Array): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fakeDigest = `sha256:${"a".repeat(64)}` as const;

function providerRef(index: number) {
  return {
    resource_id: `019d2d97-110c-7735-8fbb-2c9342145a${index.toString(16).padStart(2, "0")}`,
    resource_revision: 1 as const,
    resource_hash: fakeDigest,
  };
}

function model(): AnalysisAgentModelPort {
  let toolTurn = 0;
  return {
    async turn(input): Promise<AnalysisAgentModelTurnResult> {
      if (input.phase === "FINAL") {
        return {
          phase: "FINAL",
          response: {
            schema_version: "analysis-agent-final@1.0.0",
            summary_zh: "已完成受治理分析。",
            output_names: ["result", "chart"],
          },
          provider_invocation_ref: providerRef(3),
        };
      }
      toolTurn += 1;
      if (toolTurn === 1) {
        return {
          phase: "TOOL",
          assistant_text: "",
          tool_call: {
            tool_call_id: "tool-operator",
            tool_name: "statistical_operator",
            arguments: {
              schema_version: "analysis-statistical-operator-tool@1.0.0",
              call_id: "bh",
              operator_id: "multiple-testing.bh-fdr@1",
              inputs: { tests: [{ label: "a", p_value: 0.01 }] },
              parameters: { alpha: 0.05, method: "bh" },
            },
          },
          provider_invocation_ref: providerRef(1),
        };
      }
      return {
        phase: "TOOL",
        assistant_text: "",
        tool_call: {
          tool_call_id: "tool-cell",
          tool_name: "python_cell",
          arguments: {
            schema_version: "analysis-python-cell-tool@1.0.0",
            cell_id: "publish",
            source: "# read sealed operator result and write declared files",
            timeout_ms: 1_000,
            declared_output_names: ["result", "chart"],
          },
        },
        provider_invocation_ref: providerRef(2),
      };
    },
  };
}

function session(): OpenSandboxAnalysisSession {
  const files = new Map<string, Uint8Array>([
    ["/workspace/outputs/result.json", encoder.encode(JSON.stringify(operatorOutput))],
    ["/workspace/outputs/chart.png", Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1])],
  ]);
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
  return {
    agent_sandbox_id: "agent",
    operator_sandbox_id: "operator",
    async uploadAgentFile(input) {
      expect(digest(input.content)).toBe(input.content_sha256);
      files.set(input.path, input.content);
    },
    async admitAgentCell(input) {
      return {
        schema_version: "analysis-cell-policy-result@1.0.0",
        cell_id: input.cell_id,
        status: "ADMITTED",
        violations: [],
      };
    },
    async runAgentCell(input) {
      return {
        cell_id: input.cell_id,
        status: "SUCCEEDED",
        execution_id: "execution-1",
        execution_count: 1,
        elapsed_ms: 1,
        stdout: "",
        stderr: "",
        result_text: "ok",
        error: null,
      };
    },
    async readAgentFile(input) {
      const value = files.get(input.path);
      if (!value) throw new Error("missing output");
      return value;
    },
    async runOperator(input) {
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
        cell: {
          cell_id: `operator-${input.call_id}`,
          status: "SUCCEEDED",
          execution_id: "operator-execution",
          execution_count: 1,
          elapsed_ms: 1,
          stdout: "",
          stderr: "",
          result_text: "ok",
          error: null,
        },
      };
    },
    async finalizeOperators(input) {
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
        cell: {
          cell_id: "operator-finalization",
          status: "SUCCEEDED",
          execution_id: "operator-finalization-execution",
          execution_count: 2,
          elapsed_ms: 1,
          stdout: "",
          stderr: "",
          result_text: "ok",
          error: null,
        },
      };
    },
    async close() {},
  };
}

describe("analysis tool loop", () => {
  it("lets DeepSeek orchestrate Cells while the host owns statistical formulas", async () => {
    const result = await executeAnalysisToolLoop({
      run_id: "019d2d97-110c-7735-8fbb-2c9342145a8d",
      analysis_program_id: "program-1",
      node_id: "node-1",
      generated_source_policy: "GOVERNED_OPERATOR_ORCHESTRATION",
      runtime_profile: "CORE_ANALYSIS",
      output_contract: {
        schema_version: "python-output-contract@1.0.0",
        outputs: [
          { name: "result", type: "JSON", required: true, max_bytes: 100_000 },
          { name: "chart", type: "PNG", required: true, max_bytes: 100_000 },
        ],
      },
      operator_obligations: [
        {
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
        },
      ],
      initial_messages: [
        { role: "system", content: "Use only the two governed tools." },
        { role: "user", content: "Analyze the governed input." },
      ],
      model: model(),
      session: session(),
      max_tool_turns: 4,
      max_output_tokens: 2_048,
    });

    expect(result.outputs.map(({ name }) => name)).toEqual(["result", "chart"]);
    expect(result.operator_observations).toHaveLength(1);
    expect(result.operator_finalization.operator_receipts).toHaveLength(1);
    expect(result.cells).toHaveLength(1);
    expect(result.provider_invocation_refs).toHaveLength(3);
  });
});
