export { FALCON24_STRICT_ACCEPTANCE_POLICY_ID } from "@data-agent/contracts/evals";

import type { FALCON24_ACCEPTANCE_FAILURE_LAYER_ORDER } from "@data-agent/contracts/evals";

type FailureLayer = (typeof FALCON24_ACCEPTANCE_FAILURE_LAYER_ORDER)[number];

const FAILURE_CODE_PREFIXES: ReadonlyArray<
  readonly [layer: FailureLayer, prefixes: readonly string[]]
> = Object.freeze([
  ["SANDBOX_RECLAMATION", ["FALCON24_SANDBOX_RECLAMATION_"]],
  [
    "PUBLISHER",
    [
      "FALCON24_RESOLUTION_TRACE_",
      "FALCON24_BROWSER_",
      "FALCON24_QA_E2E_",
      "FALCON24_TRACE_UI_",
      "FALCON24_UI_RECEIPT_",
      "FALCON24_E1_UI_RECEIPT_",
      "RESOLUTION_TRACE_",
      "ARTIFACT_PUBLISH_",
    ],
  ],
  [
    "ORACLE",
    [
      "FALCON24_ORACLE_",
      "FALCON24_Q1_",
      "FALCON24_Q2_",
      "FALCON24_Q3_",
      "FALCON24_Q4_",
      "FALCON24_Q5_",
    ],
  ],
  ["GOVERNED_OPERATOR", ["FALCON24_ANALYSIS_", "STATISTICAL_OPERATOR_", "ANALYSIS_SANDBOX_"]],
  [
    "SQL_DATA_PREPARATION",
    ["TEXT2SQL_", "QUERY_EVIDENCE_", "SEMANTIC_", "DATASOURCE_", "SCHEMA_SNAPSHOT_"],
  ],
]);

export function classifyFalcon24RunFailureCode(errorCode: string): FailureLayer {
  for (const [layer, prefixes] of FAILURE_CODE_PREFIXES) {
    if (prefixes.some((prefix) => errorCode.startsWith(prefix))) return layer;
  }
  return "ROOT_ROUTING";
}
