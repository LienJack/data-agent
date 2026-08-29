import {
  type Falcon24FourLayerManifestTurn,
  falcon24FourLayerAgentContractMatches,
} from "@data-agent/contracts/evals";
import { z } from "zod";

const observationSchema = z.strictObject({
  check_id: z.string().regex(/^falcon24\.check\.[a-z0-9.-]+@1$/u),
  status: z.enum(["PASS", "FAIL"]),
  evidence_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
});

const inputSchema = z.strictObject({
  turn: z.custom<Falcon24FourLayerManifestTurn>(),
  actual_profile_ids: z.array(z.string().min(3).max(64)).min(1).max(12),
  observations: z.array(observationSchema).max(32),
  answer_text: z.string().max(80_000),
  table_present: z.boolean(),
  chart_present: z.boolean(),
  accepted_input_present: z.boolean(),
  current_run_evidence_present: z.boolean(),
});

export function evaluateFalcon24FourLayerTurn(input: unknown) {
  const candidate = inputSchema.parse(input);
  const { turn } = candidate;
  if (!falcon24FourLayerAgentContractMatches(turn.expected_agents, candidate.actual_profile_ids)) {
    return { status: "FAIL" as const, failure_code: "AGENT_CONTRACT_MISMATCH" as const };
  }

  const requiredChecks = turn.rubric.required_checks;
  const observedChecks = candidate.observations.map(({ check_id: checkId }) => checkId);
  if (
    candidate.observations.length !== requiredChecks.length ||
    new Set(observedChecks).size !== observedChecks.length ||
    candidate.observations.some(
      (observation, index) =>
        observation.check_id !== requiredChecks[index] || observation.status !== "PASS",
    )
  ) {
    return { status: "FAIL" as const, failure_code: "RUBRIC_EVIDENCE_INCOMPLETE" as const };
  }
  if (
    (turn.rubric.table_required && !candidate.table_present) ||
    (turn.rubric.chart_required && !candidate.chart_present) ||
    (turn.rubric.accepted_input_required && !candidate.accepted_input_present) ||
    (turn.rubric.current_run_evidence_required && !candidate.current_run_evidence_present)
  ) {
    return { status: "FAIL" as const, failure_code: "REQUIRED_EVIDENCE_MISSING" as const };
  }
  if (
    turn.rubric.forbidden_answer_phrases.some((phrase) => candidate.answer_text.includes(phrase))
  ) {
    return { status: "FAIL" as const, failure_code: "USER_VISIBLE_FAILURE_LEAK" as const };
  }
  return {
    status: "PASS" as const,
    failure_code: null,
    rubric_results: candidate.observations,
  };
}
