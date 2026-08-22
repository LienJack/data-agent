import { createHash } from "node:crypto";
import { sha256ContentHash } from "@data-agent/contracts";

export const GENERATED_PROGRAM_ORACLE_VERSION = "generated-program-independent-gate@1.0.0";

const forbiddenSource = [
  /\b(?:eval|exec|compile|__import__)\s*\(/u,
  /\b(?:subprocess|socket|multiprocessing|ctypes|pickle|os\.environ)\b/u,
  /\b(?:open|fork|spawn|system|popen)\s*\(/u,
  /\b(?:random|secrets|uuid|time\.time)\b/u,
  /^\s*(?:from|import)\s+(?!data_agent_sandbox|math|statistics|numpy|pandas|scipy|statsmodels|sklearn)([\w.]+)/mu,
];

export interface GeneratedProgramOracleInput {
  readonly source_text: string;
  readonly source_hash: `sha256:${string}`;
  readonly admitted_imports: readonly string[];
  readonly expected_runtime_digest: `sha256:${string}`;
  readonly expected_dependency_lock_digest: `sha256:${string}`;
  readonly observed_runtime_digest: `sha256:${string}`;
  readonly observed_dependency_lock_digest: `sha256:${string}`;
  readonly first_result_hash: `sha256:${string}` | null;
  readonly replay_result_hash: `sha256:${string}` | null;
  readonly terminal: "SUCCEEDED" | "POLICY_REJECTED" | "TIMEOUT" | "CANCELLED" | "UNAVAILABLE";
  readonly output_count: number;
  readonly repair_attempts: number;
}

export interface GeneratedProgramOracleVerdict {
  readonly oracle_version: typeof GENERATED_PROGRAM_ORACLE_VERSION;
  readonly verdict: "PASS" | "HOLD";
  readonly reason_codes: readonly string[];
  readonly oracle_receipt_hash: `sha256:${string}`;
}

export async function evaluateGeneratedProgram(
  input: GeneratedProgramOracleInput,
): Promise<GeneratedProgramOracleVerdict> {
  const reasons: string[] = [];
  const observedSourceHash = `sha256:${createHash("sha256").update(input.source_text).digest("hex")}`;
  if (observedSourceHash !== input.source_hash) {
    reasons.push("SOURCE_HASH_MISMATCH");
  }
  if (forbiddenSource.some((pattern) => pattern.test(input.source_text))) {
    reasons.push("GENERATED_PROGRAM_POLICY_REJECTED");
  }
  const declaredImports = [
    ...input.source_text.matchAll(/(?:^|\n)\s*(?:from|import)\s+([\w.]+)/gu),
  ].map((match) => match[1]?.split(".")[0] ?? "");
  if (declaredImports.some((name) => !input.admitted_imports.includes(name))) {
    reasons.push("IMPORT_PROFILE_VIOLATION");
  }
  if (
    input.observed_runtime_digest !== input.expected_runtime_digest ||
    input.observed_dependency_lock_digest !== input.expected_dependency_lock_digest
  ) {
    reasons.push("RUNTIME_OR_LOCK_DRIFT");
  }
  if (input.repair_attempts > 1) reasons.push("REPAIR_BUDGET_EXCEEDED");
  if (input.terminal === "SUCCEEDED") {
    if (
      input.output_count < 1 ||
      input.first_result_hash === null ||
      input.first_result_hash !== input.replay_result_hash
    ) {
      reasons.push("DETERMINISTIC_REPLAY_FAILED");
    }
  } else {
    if (input.output_count !== 0 || input.first_result_hash !== null) {
      reasons.push("NON_SUCCESS_OUTPUT_COMMITTED");
    }
    reasons.push(
      input.terminal === "UNAVAILABLE"
        ? "ANALYSIS_SANDBOX_UNAVAILABLE"
        : `GENERATED_PROGRAM_${input.terminal}`,
    );
  }
  const material = {
    oracle_version: GENERATED_PROGRAM_ORACLE_VERSION as typeof GENERATED_PROGRAM_ORACLE_VERSION,
    verdict: reasons.length === 0 ? ("PASS" as const) : ("HOLD" as const),
    reason_codes: [...new Set(reasons)].sort(),
  };
  return { ...material, oracle_receipt_hash: await sha256ContentHash(material) };
}
