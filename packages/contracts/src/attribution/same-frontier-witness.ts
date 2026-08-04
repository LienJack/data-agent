import { z } from "zod";
import crypto from "node:crypto";
import {
  contentHashSchema,
  immutableIdSchema,
  timestampSchema,
} from "../common/index.js";

export const SAME_FRONTIER_WITNESS_VERSION = "same-frontier-witness@1" as const;

export const frontierAxisSchema = z.strictObject({
  ref: immutableIdSchema,
  hash: contentHashSchema,
  version: z.string().min(1).max(64),
});

export type FrontierAxis = z.infer<typeof frontierAxisSchema>;

export const fiveAxisFrontierSchema = z.strictObject({
  identity_ref: frontierAxisSchema,
  principal_ref: frontierAxisSchema,
  scope_ref: frontierAxisSchema,
  time_window_ref: frontierAxisSchema,
  classification_ref: frontierAxisSchema,
});

export type FiveAxisFrontier = z.infer<typeof fiveAxisFrontierSchema>;

export const frontierWitnessStatusSchema = z.enum([
  "IDENTICAL",
  "CROSS_AXIS_MISMATCH",
  "STALE",
]);
export type FrontierWitnessStatus = z.infer<typeof frontierWitnessStatusSchema>;

export const sameFrontierWitnessSchema = z.strictObject({
  protocol_version: z.literal("same-frontier-witness@1"),
  witness_id: immutableIdSchema,
  baseline_frontier: fiveAxisFrontierSchema,
  follow_up_frontier: fiveAxisFrontierSchema,
  frontier_identity_digest: contentHashSchema,
  witness_status: frontierWitnessStatusSchema,
  witnessed_by: z.string().min(1).max(256),
  witnessed_at: timestampSchema,
});

export type SameFrontierWitness = z.infer<typeof sameFrontierWitnessSchema>;

export interface FrontierWitnessInput {
  readonly baseline: FiveAxisFrontier;
  readonly follow_up: FiveAxisFrontier;
  readonly witnessed_by: string;
}

export function computeFrontierIdentityDigest(frontier: FiveAxisFrontier): `sha256:${string}` {
  const concatenated = [
    frontier.identity_ref.hash,
    frontier.principal_ref.hash,
    frontier.scope_ref.hash,
    frontier.time_window_ref.hash,
    frontier.classification_ref.hash,
  ].join("|");
  const hash = crypto.createHash("sha256").update(concatenated, "utf-8").digest("hex");
  return `sha256:${hash}` as `sha256:${string}`;
}

export function witnessSameFrontier(
  input: FrontierWitnessInput,
): SameFrontierWitness {
  const baselineDigest = computeFrontierIdentityDigest(input.baseline);
  const followUpDigest = computeFrontierIdentityDigest(input.follow_up);

  let witness_status: FrontierWitnessStatus;
  if (baselineDigest !== followUpDigest) {
    witness_status = "CROSS_AXIS_MISMATCH";
  } else {
    witness_status = "IDENTICAL";
  }

  return {
    protocol_version: "same-frontier-witness@1",
    witness_id: crypto.randomUUID(),
    baseline_frontier: input.baseline,
    follow_up_frontier: input.follow_up,
    frontier_identity_digest: baselineDigest,
    witness_status,
    witnessed_by: input.witnessed_by,
    witnessed_at: new Date().toISOString() as unknown as string,
  };
}

export function checkCrossAxisMismatch(
  witness: SameFrontierWitness,
): string[] {
  const errors: string[] = [];
  const axes: Array<{ name: string; axis: FrontierAxis }> = [
    ["identity", witness.baseline_frontier.identity_ref],
    ["principal", witness.baseline_frontier.principal_ref],
    ["scope", witness.baseline_frontier.scope_ref],
    ["time_window", witness.baseline_frontier.time_window_ref],
    ["classification", witness.baseline_frontier.classification_ref],
  ].map(([name, ref], _i) => ({
    name: name as string,
    axis: ref as FrontierAxis,
  }));

  // Check that baseline and follow-up use the same axis combination
  const baselineKeys = axes.map((a) => `${a.name}:${a.axis.hash}`);
  const followUpKeys = [
    `identity:${witness.follow_up_frontier.identity_ref.hash}`,
    `principal:${witness.follow_up_frontier.principal_ref.hash}`,
    `scope:${witness.follow_up_frontier.scope_ref.hash}`,
    `time_window:${witness.follow_up_frontier.time_window_ref.hash}`,
    `classification:${witness.follow_up_frontier.classification_ref.hash}`,
  ];

  for (let i = 0; i < baselineKeys.length; i++) {
    if (baselineKeys[i] !== followUpKeys[i]) {
      errors.push(`Axis mismatch at position ${i}: baseline=${baselineKeys[i]}, follow_up=${followUpKeys[i]}`);
    }
  }
  return errors;
}
