import { z } from "zod";
import { contentHashSchema, immutableIdSchema, timestampSchema } from "../common/index.js";

export const STATIC_DRIVER_CAPACITY_PROOF_VERSION = "static-driver-capacity-proof@1" as const;

export const MAX_DRIVER_LIMIT = 6 as const;
export const MAX_SQL_LIMIT = 16 as const;

export const capacityVerdictSchema = z.enum(["WITHIN_CAPACITY", "EXCEEDS_CAPACITY"]);
export type CapacityVerdict = z.infer<typeof capacityVerdictSchema>;

export const staticDriverCapacityProofSchema = z.strictObject({
  protocol_version: z.literal("static-driver-capacity-proof@1"),
  proof_id: immutableIdSchema,
  profile_hash: contentHashSchema,
  source_release_digest: contentHashSchema,
  driver_count: z.number().int().min(0).max(MAX_DRIVER_LIMIT),
  max_driver_limit: z.literal(MAX_DRIVER_LIMIT),
  sql_estimate: z.number().int().min(0).max(MAX_SQL_LIMIT),
  max_sql_limit: z.literal(MAX_SQL_LIMIT),
  obligation_estimate: z.number().int().min(0).max(100),
  max_obligation_limit: z.literal(100),
  artifact_input_estimate: z.number().int().min(0).max(50),
  max_artifact_input_limit: z.literal(50),
  verdict: capacityVerdictSchema,
  checked_at: timestampSchema,
  checker_version: z.literal("attribution-fixture-kernel@1"),
});

export type StaticDriverCapacityProof = z.infer<typeof staticDriverCapacityProofSchema>;

export interface CapacityCheckInput {
  readonly profile_hash: `sha256:${string}`;
  readonly source_release_digest: `sha256:${string}`;
  readonly driver_count: number;
  readonly sql_estimate: number;
  readonly obligation_estimate: number;
  readonly artifact_input_estimate: number;
}

export function computeStaticDriverCapacityProof(
  input: CapacityCheckInput,
): StaticDriverCapacityProof {
  const exceedsDriver = input.driver_count > MAX_DRIVER_LIMIT;
  const exceedsSql = input.sql_estimate > MAX_SQL_LIMIT;
  const exceedsObligation = input.obligation_estimate > 100;
  const exceedsArtifactInput = input.artifact_input_estimate > 50;
  const exceeds = exceedsDriver || exceedsSql || exceedsObligation || exceedsArtifactInput;

  return {
    protocol_version: "static-driver-capacity-proof@1",
    proof_id: crypto.randomUUID(),
    profile_hash: input.profile_hash,
    source_release_digest: input.source_release_digest,
    driver_count: input.driver_count,
    max_driver_limit: MAX_DRIVER_LIMIT,
    sql_estimate: input.sql_estimate,
    max_sql_limit: MAX_SQL_LIMIT,
    obligation_estimate: input.obligation_estimate,
    max_obligation_limit: 100,
    artifact_input_estimate: input.artifact_input_estimate,
    max_artifact_input_limit: 50,
    verdict: exceeds ? "EXCEEDS_CAPACITY" : "WITHIN_CAPACITY",
    checked_at: new Date().toISOString() as unknown as string,
    checker_version: "attribution-fixture-kernel@1",
  };
}
