import {
  contentHashSchema,
  immutableIdSchema,
  sha256ContentHash,
} from "@data-agent/contracts/common";
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
  actual_profile_ids: z.array(z.string().min(3).max(64)).max(12),
  observations: z.array(observationSchema).max(32),
  answer_text: z.string().max(80_000),
  table_present: z.boolean(),
  chart_present: z.boolean(),
  accepted_input_present: z.boolean(),
  current_run_evidence_present: z.boolean(),
});

const evidenceMaterialSchema = z.strictObject({
  schema_version: z.literal("falcon24-four-layer-rubric-evidence@1.0.0"),
  gate_id: z.string().regex(/^E[1-9][0-9]*-FL1$/u),
  attempt_id: immutableIdSchema,
  manifest_hash: contentHashSchema,
  turn_ordinal: z.number().int().min(0).max(14),
  turn_id: z.string().regex(/^L[1-4](?:-[AB])?-0[1-5]$/u),
  conversation_id: immutableIdSchema,
  conversation_resource_version: z.number().int().positive().safe(),
  run_id: immutableIdSchema,
  answer_hash: contentHashSchema,
  public_event_hash: contentHashSchema,
  accepted_artifact_refs_hash: contentHashSchema,
  accepted_input_artifact_refs_hash: contentHashSchema,
  observations: z.array(observationSchema).min(1).max(32),
  table_present: z.boolean(),
  chart_present: z.boolean(),
  accepted_input_present: z.boolean(),
  current_run_evidence_present: z.boolean(),
  evaluated_at: z.iso.datetime({ offset: true }),
});

export const falcon24FourLayerRubricEvidenceSchema = evidenceMaterialSchema.extend({
  evidence_hash: contentHashSchema,
});

export async function buildFalcon24FourLayerRubricEvidence(input: unknown) {
  const material = evidenceMaterialSchema.parse(input);
  return falcon24FourLayerRubricEvidenceSchema.parse({
    ...material,
    evidence_hash: await sha256ContentHash(material),
  });
}

export async function verifyFalcon24FourLayerRubricEvidence(input: unknown) {
  const evidence = falcon24FourLayerRubricEvidenceSchema.parse(input);
  const { evidence_hash: observedHash, ...material } = evidence;
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("FALCON24_FOUR_LAYER_RUBRIC_EVIDENCE_HASH_INVALID");
  }
  return evidence;
}

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

export type Falcon24FourLayerRubricEvidence = z.infer<typeof falcon24FourLayerRubricEvidenceSchema>;
