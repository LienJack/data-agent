import { createHash } from "node:crypto";

const stableCallIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export interface AnalysisOperatorArgumentSymbols {
  readonly inputs_symbol: string;
  readonly parameters_symbol: string;
}

/**
 * Model-visible operator argument symbols are selected by the server. The
 * model creates values at these exact names, but never chooses the names sent
 * through the statistical_operator tool boundary.
 */
export function analysisOperatorArgumentSymbols(callId: string): AnalysisOperatorArgumentSymbols {
  if (!stableCallIdPattern.test(callId)) {
    throw new TypeError("ANALYSIS_OPERATOR_CALL_ID_INVALID");
  }
  const suffix = createHash("sha256")
    .update(`analysis-operator-argument-symbols@1.0.0\0${callId}`)
    .digest("hex")
    .slice(0, 24);
  return Object.freeze({
    inputs_symbol: `da_operator_inputs_${suffix}`,
    parameters_symbol: `da_operator_parameters_${suffix}`,
  });
}
