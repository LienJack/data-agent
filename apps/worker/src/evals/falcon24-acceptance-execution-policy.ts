export { FALCON24_STRICT_ACCEPTANCE_POLICY_ID } from "@data-agent/contracts/evals";

import { FALCON24_STRICT_ACCEPTANCE_POLICY_ID } from "@data-agent/contracts/evals";

export const FALCON24_STRICT_ACCEPTANCE_EXECUTION_POLICY = Object.freeze({
  schema_version: "falcon24-acceptance-execution-policy@1.0.0" as const,
  policy_id: FALCON24_STRICT_ACCEPTANCE_POLICY_ID,
  mode: "FALCON24_STRICT" as const,
  max_run_attempts: 1 as const,
  max_provider_attempts_per_call: 1 as const,
  max_root_turns: 1 as const,
  max_text2sql_candidate_attempts: 1 as const,
  analysis_repair_budget_per_category: 0 as const,
  max_file_transfer_attempts: 1 as const,
  allow_stage_recovery: false as const,
  suite_failure_behavior: "STOP_IMMEDIATELY" as const,
  automatic_version_escalation: false as const,
  next_version_change_requirement: "CODE_OR_FROZEN_CONTRACT" as const,
  failure_localization_order: Object.freeze([
    "ROOT_ROUTING",
    "SQL_DATA_PREPARATION",
    "GOVERNED_OPERATOR",
    "ORACLE",
    "PUBLISHER",
    "SANDBOX_RECLAMATION",
  ] as const),
});

export type Falcon24StrictAcceptanceExecutionPolicy =
  typeof FALCON24_STRICT_ACCEPTANCE_EXECUTION_POLICY;

type FailureLayer =
  (typeof FALCON24_STRICT_ACCEPTANCE_EXECUTION_POLICY.failure_localization_order)[number];

const FAILURE_CODE_PREFIXES: ReadonlyArray<
  readonly [layer: FailureLayer, prefixes: readonly string[]]
> = Object.freeze([
  ["SANDBOX_RECLAMATION", ["FALCON24_SANDBOX_RECLAMATION_"]],
  ["PUBLISHER", ["FALCON24_RESOLUTION_TRACE_", "RESOLUTION_TRACE_", "ARTIFACT_PUBLISH_"]],
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

export function loadFalcon24StrictAcceptanceExecutionPolicy(
  environment: NodeJS.ProcessEnv,
): Falcon24StrictAcceptanceExecutionPolicy | null {
  const configured = environment.DATA_AGENT_FALCON24_ACCEPTANCE_EXECUTION_POLICY?.trim();
  if (!configured) return null;
  if (configured !== FALCON24_STRICT_ACCEPTANCE_POLICY_ID) {
    throw new TypeError("FALCON24_ACCEPTANCE_EXECUTION_POLICY_INVALID");
  }
  return FALCON24_STRICT_ACCEPTANCE_EXECUTION_POLICY;
}

export function assertFalcon24AcceptanceExecutionBinding(
  environment: NodeJS.ProcessEnv,
): Falcon24StrictAcceptanceExecutionPolicy | null {
  const policy = loadFalcon24StrictAcceptanceExecutionPolicy(environment);
  const hasManifest = Boolean(environment.FALCON24_ANALYSIS_RUN_MANIFEST?.trim());
  if (policy && !hasManifest) {
    throw new TypeError("FALCON24_ANALYSIS_RUN_MANIFEST_REQUIRED");
  }
  if (hasManifest && !policy) {
    throw new TypeError("FALCON24_ACCEPTANCE_EXECUTION_POLICY_REQUIRED");
  }
  return policy;
}
