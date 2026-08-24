import { describe, expect, it } from "vitest";
import {
  createOpenSandboxAnalysisResultSymbolExtractor,
  openSandboxResultSymbolExtractorInternals,
} from "../../src/analysis/opensandbox-result-symbol-extractor.js";
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
            symbol_name: "result_document",
            symbol_kind: "MAPPING",
            value: { kind: "OBJECT", entries: [] },
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

describe("OpenSandbox Result Publisher extraction adapter", () => {
  it("uses only the runtime's server-owned extraction primitive", async () => {
    const observed: unknown[] = [];
    const symbols = [{ symbol_name: "result_document", expected_kind: "MAPPING" as const }];
    const extractor = createOpenSandboxAnalysisResultSymbolExtractor(session(observed));

    await expect(
      extractor.extract({
        symbols,
        limits: { max_rows: 10, max_columns: 10, max_bytes: 10_000 },
      }),
    ).resolves.toMatchObject({ symbols: [{ symbol_name: "result_document" }] });
    expect(observed).toEqual([
      {
        extraction_id: openSandboxResultSymbolExtractorInternals.extractionId(symbols),
        symbols,
        limits: { max_rows: 10, max_columns: 10, max_bytes: 10_000 },
        timeout_ms: 30_000,
      },
    ]);
    expect(JSON.stringify(observed)).not.toContain("source");
    expect(JSON.stringify(observed)).not.toContain("path");
  });
});
