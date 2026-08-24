import { createHash } from "node:crypto";
import type { OpenSandboxAnalysisSession } from "../runs/opensandbox-analysis-runtime.js";
import type { AnalysisOperatorArgumentExtractorPort } from "./analysis-tool-loop.js";
import {
  analysisExtractedSymbolsSchema,
  decodeAnalysisExtractedMappingSymbol,
} from "./result-publisher.js";

const OPERATOR_EXTRACTION_LIMITS = Object.freeze({
  max_rows: 5_000,
  max_columns: 128,
  max_bytes: 16 * 1024 * 1024,
});

function extractionId(inputsSymbol: string, parametersSymbol: string): string {
  const digest = createHash("sha256")
    .update(`${inputsSymbol}\0${parametersSymbol}`)
    .digest("hex")
    .slice(0, 24);
  return `operator-arguments-${digest}`;
}

/**
 * Resolves model-supplied symbol identities through the runtime's fixed,
 * server-authored extraction Cell. Values never transit model tool arguments.
 */
export function createOpenSandboxOperatorArgumentExtractor(
  session: OpenSandboxAnalysisSession,
  signal?: AbortSignal,
): AnalysisOperatorArgumentExtractorPort {
  return Object.freeze({
    async extract(input: Parameters<AnalysisOperatorArgumentExtractorPort["extract"]>[0]) {
      if (input.inputs_symbol === input.parameters_symbol) {
        throw new TypeError("ANALYSIS_OPERATOR_ARGUMENT_SYMBOLS_DUPLICATE");
      }
      const symbols = [
        { symbol_name: input.inputs_symbol, expected_kind: "MAPPING" as const },
        { symbol_name: input.parameters_symbol, expected_kind: "MAPPING" as const },
      ];
      const extracted = analysisExtractedSymbolsSchema.parse(
        await session.extractAgentSymbols({
          extraction_id: extractionId(input.inputs_symbol, input.parameters_symbol),
          symbols,
          limits: OPERATOR_EXTRACTION_LIMITS,
          timeout_ms: 30_000,
          ...(signal ? { signal } : {}),
        }),
      );
      if (extracted.symbols.length !== 2) {
        throw new TypeError("ANALYSIS_OPERATOR_ARGUMENT_SYMBOL_CLOSURE_INVALID");
      }
      const decoded = new Map(
        extracted.symbols.map((symbol) => {
          const mapping = decodeAnalysisExtractedMappingSymbol(symbol);
          return [mapping.symbol_name, mapping.value] as const;
        }),
      );
      const inputs = decoded.get(input.inputs_symbol);
      const parameters = decoded.get(input.parameters_symbol);
      if (!inputs || !parameters || decoded.size !== 2) {
        throw new TypeError("ANALYSIS_OPERATOR_ARGUMENT_SYMBOL_CLOSURE_INVALID");
      }
      return Object.freeze({ inputs, parameters });
    },
  });
}

export const openSandboxOperatorArgumentExtractorInternals = Object.freeze({
  extractionId,
  limits: OPERATOR_EXTRACTION_LIMITS,
});
