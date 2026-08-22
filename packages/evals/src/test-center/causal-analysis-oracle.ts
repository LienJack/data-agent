import { sha256ContentHash } from "@data-agent/contracts";

export const CAUSAL_ANALYSIS_ORACLE_VERSION = "causal-scm-independent-oracle@1.0.0";

export type CausalAdversarialCase =
  | "SIMPSON_PARADOX"
  | "REVERSE_CAUSALITY"
  | "COLLIDER_ADJUSTMENT"
  | "UNOBSERVED_CONFOUNDING"
  | "POSITIVITY_FAILURE"
  | "POST_TREATMENT_LEAKAGE"
  | "SMALL_SAMPLE"
  | "MISSING_NOT_AT_RANDOM"
  | "MULTIPLE_TESTING";

export interface CausalScmFixture {
  readonly fixture_id: string;
  readonly expected_effect: number;
  readonly tolerance: number;
  readonly minimum_effective_sample_size: number;
  readonly minimum_overlap: number;
  readonly expected_terminal: "L5_CERTIFIED" | "L4_DISCOVERY" | "HOLD";
  readonly adversarial_case: CausalAdversarialCase | null;
}

export interface CausalScmObservation {
  readonly candidate_grounded: boolean;
  readonly temporal_order_passed: boolean;
  readonly point_estimate: number | null;
  readonly interval_low: number | null;
  readonly interval_high: number | null;
  readonly effective_sample_size: number;
  readonly overlap_score: number;
  readonly adjustment_has_mediator_or_collider: boolean;
  readonly refutation_verdicts: readonly ("PASS" | "FAIL")[];
  readonly negative_control_passed: boolean;
  readonly sensitivity_passed: boolean;
  readonly attribution_authority_passed: boolean;
  readonly certificate_verdict: "CERTIFIED" | "HOLD" | null;
  readonly public_level: "L5_CERTIFIED" | "L4_DISCOVERY" | "HOLD";
}

export interface CausalScmOracleVerdict {
  readonly oracle_version: typeof CAUSAL_ANALYSIS_ORACLE_VERSION;
  readonly fixture_id: string;
  readonly verdict: "PASS" | "FAIL";
  readonly score: number;
  readonly hard_failures: readonly string[];
  readonly oracle_receipt_hash: `sha256:${string}`;
}

function sign(value: number, tolerance: number) {
  return Math.abs(value) <= tolerance ? 0 : value > 0 ? 1 : -1;
}

export async function evaluateCausalScm(input: {
  readonly fixture: CausalScmFixture;
  readonly observed: CausalScmObservation;
}): Promise<CausalScmOracleVerdict> {
  const { fixture, observed } = input;
  const failures: string[] = [];
  if (!observed.candidate_grounded) failures.push("ONTOLOGY_CANDIDATE_UNGROUNDED");
  if (!observed.temporal_order_passed) failures.push("TEMPORAL_ORDER_FAILED");
  const eligibleForL5 = fixture.expected_terminal === "L5_CERTIFIED";
  if (eligibleForL5) {
    if (
      observed.point_estimate === null ||
      observed.interval_low === null ||
      observed.interval_high === null ||
      sign(observed.point_estimate, fixture.tolerance) !==
        sign(fixture.expected_effect, fixture.tolerance) ||
      fixture.expected_effect < observed.interval_low - fixture.tolerance ||
      fixture.expected_effect > observed.interval_high + fixture.tolerance
    ) {
      failures.push("SCM_EFFECT_DIRECTION_OR_INTERVAL_MISMATCH");
    }
    if (observed.effective_sample_size < fixture.minimum_effective_sample_size) {
      failures.push("EFFECTIVE_SAMPLE_INSUFFICIENT");
    }
    if (observed.overlap_score < fixture.minimum_overlap) failures.push("OVERLAP_FAILED");
    if (observed.adjustment_has_mediator_or_collider) failures.push("DAG_ADJUSTMENT_INVALID");
    if (observed.refutation_verdicts.length < 4 || observed.refutation_verdicts.includes("FAIL")) {
      failures.push("REFUTATION_FAILED");
    }
    if (!observed.negative_control_passed || !observed.sensitivity_passed) {
      failures.push("SENSITIVITY_FAILED");
    }
    if (!observed.attribution_authority_passed) failures.push("ATTRIBUTION_AUTHORITY_FAILED");
    if (observed.certificate_verdict !== "CERTIFIED" || observed.public_level !== "L5_CERTIFIED") {
      failures.push("CERTIFICATE_OR_PUBLIC_LEVEL_INVALID");
    }
  } else if (observed.public_level !== fixture.expected_terminal) {
    failures.push("FAIL_CLOSED_LEVEL_MISMATCH");
  }
  if (fixture.adversarial_case && observed.public_level === "L5_CERTIFIED") {
    failures.push(`ADVERSARIAL_${fixture.adversarial_case}_NOT_HELD`);
  }
  const material = {
    oracle_version: CAUSAL_ANALYSIS_ORACLE_VERSION as typeof CAUSAL_ANALYSIS_ORACLE_VERSION,
    fixture_id: fixture.fixture_id,
    verdict: failures.length === 0 ? ("PASS" as const) : ("FAIL" as const),
    score: failures.length === 0 ? 100 : 0,
    hard_failures: failures.sort(),
  };
  return { ...material, oracle_receipt_hash: await sha256ContentHash(material) };
}
