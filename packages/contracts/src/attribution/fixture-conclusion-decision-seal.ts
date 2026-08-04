import { z } from "zod";
import crypto from "node:crypto";
import {
  contentHashSchema,
  immutableIdSchema,
  timestampSchema,
} from "../common/index.js";

export const FIXTURE_CONCLUSION_DECISION_SEAL_VERSION =
  "fixture-conclusion-decision-seal@1" as const;

export const decisionSealStatusSchema = z.enum(["SEALED", "TAMPERED", "MISMATCH"]);
export type DecisionSealStatus = z.infer<typeof decisionSealStatusSchema>;

export const fixtureConclusionDecisionSealSchema = z.strictObject({
  protocol_version: z.literal("fixture-conclusion-decision-seal@1"),
  seal_id: immutableIdSchema,
  manifest_hash: contentHashSchema,
  candidate_hash: contentHashSchema,
  conclusion_verdict: z.enum(["CONFIRMED", "REJECTED", "INCONCLUSIVE"]),
  decision_status: decisionSealStatusSchema,
  sealed_by: z.string().min(1).max(256),
  sealed_at: timestampSchema,
  seal_hash: contentHashSchema,
  metadata: z
    .object({
      is_m1_only: z.literal(true).default(true),
      has_key_nonce_rotation: z.literal(false).default(false),
      is_bearer_authorization: z.literal(false).default(false),
    })
    .default(() => ({
      is_m1_only: true as const,
      has_key_nonce_rotation: false as const,
      is_bearer_authorization: false as const,
    })),
});

export type FixtureConclusionDecisionSeal = z.infer<typeof fixtureConclusionDecisionSealSchema>;

export interface SealInput {
  readonly manifest_hash: `sha256:${string}`;
  readonly candidate_hash: `sha256:${string}`;
  readonly conclusion_verdict: "CONFIRMED" | "REJECTED" | "INCONCLUSIVE";
  readonly sealed_by: string;
}

export function computeSealHash(input: SealInput): `sha256:${string}` {
  const concatenated = [
    input.manifest_hash,
    input.candidate_hash,
    input.conclusion_verdict,
    input.sealed_by,
  ].join("|");
  const hash = crypto.createHash("sha256").update(concatenated, "utf-8").digest("hex");
  return `sha256:${hash}` as `sha256:${string}`;
}

export function sealFixtureConclusionDecision(
  input: SealInput,
): FixtureConclusionDecisionSeal {
  const seal_hash = computeSealHash(input);
  return {
    protocol_version: "fixture-conclusion-decision-seal@1",
    seal_id: crypto.randomUUID(),
    manifest_hash: input.manifest_hash,
    candidate_hash: input.candidate_hash,
    conclusion_verdict: input.conclusion_verdict,
    decision_status: "SEALED",
    sealed_by: input.sealed_by,
    sealed_at: new Date().toISOString() as unknown as string,
    seal_hash,
    metadata: {
      is_m1_only: true,
      has_key_nonce_rotation: false,
      is_bearer_authorization: false,
    },
  };
}

export function verifyFixtureConclusionDecisionSeal(
  seal: FixtureConclusionDecisionSeal,
): DecisionSealStatus {
  const expectedHash = computeSealHash({
    manifest_hash: seal.manifest_hash as `sha256:${string}`,
    candidate_hash: seal.candidate_hash as `sha256:${string}`,
    conclusion_verdict: seal.conclusion_verdict,
    sealed_by: seal.sealed_by,
  });
  if (seal.seal_hash !== expectedHash) {
    return "TAMPERED";
  }
  return seal.decision_status;
}
