import { z } from "zod";
import {
  contentHashSchema,
  immutableIdSchema,
  timestampSchema,
} from "../common/index.js";

export const CONTRIBUTION_CLOSURE_RECEIPT_VERSION =
  "contribution-closure-receipt@1" as const;

export const closureVerdictSchema = z.enum(["PASS", "HOLD", "REFUSE"]);
export type ClosureVerdict = z.infer<typeof closureVerdictSchema>;

export const contributionClosureReceiptSchema = z.strictObject({
  protocol_version: z.literal("contribution-closure-receipt@1"),
  receipt_id: immutableIdSchema,
  profile_hash: contentHashSchema,
  truth_contract_hash: contentHashSchema,
  observation_set_hash: contentHashSchema,
  computed_closure_error: z.number().finite(),
  independently_observed_residual_delta: z.number().finite(),
  unexplained_remainder: z.number().finite(),
  closure_verdict: closureVerdictSchema,
  closure_verifier: z.string().min(1).max(256),
  closure_verifier_version: z.string().min(1).max(64),
  closed_at: timestampSchema,
});

export type ContributionClosureReceipt = z.infer<typeof contributionClosureReceiptSchema>;

export interface ClosureInput {
  readonly profile_hash: `sha256:${string}`;
  readonly truth_contract_hash: `sha256:${string}`;
  readonly observation_set_hash: `sha256:${string}`;
  readonly computed_closure_error: number;
  readonly independently_observed_residual_delta: number;
  readonly unexplained_remainder: number;
  readonly closure_verifier: string;
  readonly closure_verifier_version: string;
}

export function deriveContributionClosureReceipt(
  input: ClosureInput,
): ContributionClosureReceipt {
  const expectedUnexplained =
    input.computed_closure_error - input.independently_observed_residual_delta;
  const isConsistent = Math.abs(input.unexplained_remainder - expectedUnexplained) < 0.0001;

  let verdict: ClosureVerdict;
  if (!isConsistent) {
    verdict = "REFUSE";
  } else if (Math.abs(input.computed_closure_error) > 0.0001) {
    verdict = "HOLD";
  } else {
    verdict = "PASS";
  }

  return {
    protocol_version: "contribution-closure-receipt@1",
    receipt_id: crypto.randomUUID(),
    profile_hash: input.profile_hash,
    truth_contract_hash: input.truth_contract_hash,
    observation_set_hash: input.observation_set_hash,
    computed_closure_error: input.computed_closure_error,
    independently_observed_residual_delta: input.independently_observed_residual_delta,
    unexplained_remainder: input.unexplained_remainder,
    closure_verdict: verdict,
    closure_verifier: input.closure_verifier,
    closure_verifier_version: input.closure_verifier_version,
    closed_at: new Date().toISOString() as unknown as string,
  };
}
