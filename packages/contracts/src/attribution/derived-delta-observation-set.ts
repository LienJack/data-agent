import { z } from "zod";
import { contentHashSchema, immutableIdSchema, timestampSchema } from "../common/index.js";

export const DERIVED_DELTA_OBSERVATION_SET_VERSION = "derived-delta-observation-set@1" as const;

export const deltaObservationKindSchema = z.enum([
  "OUTCOME",
  "DRIVER",
  "INDEPENDENTLY_OBSERVED_RESIDUAL",
]);

export type DeltaObservationKind = z.infer<typeof deltaObservationKindSchema>;

export const deltaObservationSchema = z.strictObject({
  observation_id: immutableIdSchema,
  subject_id: z.string().min(1).max(256),
  observation_kind: deltaObservationKindSchema,
  subject_label: z.string().min(1).max(512),
  baseline_level: z.number().finite(),
  follow_up_level: z.number().finite(),
  signed_delta: z.number().finite(),
  delta_unit: z.string().min(1).max(64),
  endpoint_binding_ref: immutableIdSchema,
  baseline_evidence_hash: contentHashSchema,
  follow_up_evidence_hash: contentHashSchema,
  frontier_witness_hash: contentHashSchema,
  derivation_metadata: z.strictObject({
    delta_method: z.enum(["DIRECT_DIFFERENCE", "RATIO_DIFFERENCE", "WEIGHTED_DECOMPOSITION"]),
    confidence: z.number().min(0).max(1).default(0.5),
    computed_at: timestampSchema,
  }),
});

export type DeltaObservation = z.infer<typeof deltaObservationSchema>;

export const derivedDeltaObservationSetSchema = z.strictObject({
  protocol_version: z.literal("derived-delta-observation-set@1"),
  observation_set_id: immutableIdSchema,
  profile_hash: contentHashSchema,
  truth_contract_hash: contentHashSchema,
  observations: z.array(deltaObservationSchema).min(1),
  computed_closure_error: z.number().finite(),
  independently_observed_residual_delta: z.number().finite(),
  unexplained_remainder: z.number().finite(),
  derivation_version: z.literal("attribution-fixture-kernel@1"),
  derived_at: timestampSchema,
});

export type DerivedDeltaObservationSet = z.infer<typeof derivedDeltaObservationSetSchema>;

export function validateDeltaObservationSet(set: DerivedDeltaObservationSet): string[] {
  const errors: string[] = [];
  for (const obs of set.observations) {
    const expectedDelta = obs.follow_up_level - obs.baseline_level;
    if (Math.abs(obs.signed_delta - expectedDelta) > 0.0001) {
      errors.push(
        `Observation ${obs.observation_id}: signed_delta ${obs.signed_delta} does not match ` +
          `follow_up - baseline (${expectedDelta})`,
      );
    }
  }
  const expectedUnexplained =
    set.computed_closure_error - set.independently_observed_residual_delta;
  if (Math.abs(set.unexplained_remainder - expectedUnexplained) > 0.0001) {
    errors.push(
      `unexplained_remainder ${set.unexplained_remainder} does not match ` +
        `computed_closure_error - independently_observed_residual_delta (${expectedUnexplained})`,
    );
  }
  const outcomeCount = set.observations.filter((o) => o.observation_kind === "OUTCOME").length;
  if (outcomeCount === 0) {
    errors.push("Delta observation set must contain at least one OUTCOME observation");
  }
  if (outcomeCount > 1) {
    errors.push("Delta observation set must contain exactly one OUTCOME observation");
  }
  return errors;
}
