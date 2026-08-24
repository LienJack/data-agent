import { createHash } from "node:crypto";
import type { OpenSandboxAnalysisSession } from "../runs/opensandbox-analysis-runtime.js";
import type { AnalysisResultSymbolExtractorPort } from "./result-publisher.js";

function extractionId(
  symbols: readonly { readonly symbol_name: string; readonly expected_kind: string }[],
): string {
  const digest = createHash("sha256").update(JSON.stringify(symbols)).digest("hex").slice(0, 24);
  return `result-publisher-${digest}`;
}

/**
 * Adapts the runtime's single server-owned extraction primitive to the Result
 * Publisher. The adapter submits only allowlisted symbol identities and hard
 * limits; it never accepts Python source, a filesystem path or serialized
 * model output.
 */
export function createOpenSandboxAnalysisResultSymbolExtractor(
  session: OpenSandboxAnalysisSession,
): AnalysisResultSymbolExtractorPort {
  return Object.freeze({
    extract(input: Parameters<AnalysisResultSymbolExtractorPort["extract"]>[0]) {
      return session.extractAgentSymbols({
        extraction_id: extractionId(input.symbols),
        symbols: input.symbols,
        limits: input.limits,
        timeout_ms: 30_000,
      });
    },
  });
}

export const openSandboxResultSymbolExtractorInternals = Object.freeze({ extractionId });
