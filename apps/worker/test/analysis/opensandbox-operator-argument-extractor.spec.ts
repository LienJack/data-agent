import { describe, expect, it } from "vitest";
import {
  createOpenSandboxOperatorArgumentExtractor,
  openSandboxOperatorArgumentExtractorInternals,
} from "../../src/analysis/opensandbox-operator-argument-extractor.js";
import type { OpenSandboxAnalysisSession } from "../../src/runs/opensandbox-analysis-runtime.js";

function session(observed: unknown[]): OpenSandboxAnalysisSession {
  return {
    agent_sandbox_id: "00000000-0000-4000-8000-000000000001",
    operator_sandbox_id: "00000000-0000-4000-8000-000000000002",
    runtime_profile: "CORE_ANALYSIS",
    agent_image: "agent@sha256:test",
    operator_image: "operator@sha256:test",
    secure_access: true,
    async uploadAgentFile() {},
    async admitAgentCell(input) {
      return {
        schema_version: "analysis-cell-policy-result@1.0.0",
        cell_id: input.cell_id,
        status: "ADMITTED",
        violations: [],
      };
    },
    async runAgentCell() {
      throw new Error("unused");
    },
    async recoverAgentContext() {},
    async freezeAgentContext() {},
    async bindGovernedResult() {
      throw new Error("unused");
    },
    async extractAgentSymbols(input) {
      observed.push(input);
      return {
        schema_version: "analysis-extracted-symbols@1.0.0",
        symbols: [
          {
            symbol_name: "operator_inputs",
            symbol_kind: "MAPPING",
            value: {
              kind: "OBJECT",
              entries: [{ key: "series", value: { kind: "ARRAY", items: [] } }],
            },
          },
          {
            symbol_name: "operator_parameters",
            symbol_kind: "MAPPING",
            value: {
              kind: "OBJECT",
              entries: [{ key: "alpha", value: { kind: "NUMBER", value: 0.05 } }],
            },
          },
        ],
      };
    },
    async runOperator() {
      throw new Error("unused");
    },
    async finalizeOperators() {
      throw new Error("unused");
    },
    async close() {},
  };
}

describe("OpenSandbox operator argument extraction adapter", () => {
  it("extracts exact mapping symbols through one fixed runtime primitive", async () => {
    const observed: unknown[] = [];
    const extractor = createOpenSandboxOperatorArgumentExtractor(session(observed));

    await expect(
      extractor.extract({
        inputs_symbol: "operator_inputs",
        parameters_symbol: "operator_parameters",
      }),
    ).resolves.toEqual({ inputs: { series: [] }, parameters: { alpha: 0.05 } });
    expect(observed).toEqual([
      {
        extraction_id: openSandboxOperatorArgumentExtractorInternals.extractionId(
          "operator_inputs",
          "operator_parameters",
        ),
        symbols: [
          { symbol_name: "operator_inputs", expected_kind: "MAPPING" },
          { symbol_name: "operator_parameters", expected_kind: "MAPPING" },
        ],
        limits: openSandboxOperatorArgumentExtractorInternals.limits,
        timeout_ms: 30_000,
      },
    ]);
    expect(JSON.stringify(observed)).not.toContain("source");
    expect(JSON.stringify(observed)).not.toContain("path");
  });

  it("rejects one symbol being reused for both authorities", async () => {
    const extractor = createOpenSandboxOperatorArgumentExtractor(session([]));
    await expect(
      extractor.extract({ inputs_symbol: "same", parameters_symbol: "same" }),
    ).rejects.toThrow("ANALYSIS_OPERATOR_ARGUMENT_SYMBOLS_DUPLICATE");
  });
});
