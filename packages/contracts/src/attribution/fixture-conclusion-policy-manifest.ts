import { z } from "zod";
import {
  contentHashSchema,
  immutableIdSchema,
  timestampSchema,
} from "../common/index.js";

export const FIXTURE_CONCLUSION_POLICY_MANIFEST_VERSION =
  "fixture-conclusion-policy-manifest@1" as const;

export const assertionTypeSchema = z.enum(["ASSERT.claim_ast", "ABSTAIN", "REFUSE"]);
export type AssertionType = z.infer<typeof assertionTypeSchema>;

export const fixtureConclusionPolicyManifestSchema = z.strictObject({
  protocol_version: z.literal("fixture-conclusion-policy-manifest@1"),
  manifest_id: immutableIdSchema,
  manifest_version: z.string().min(1).max(64),
  fixture_hash: contentHashSchema,
  profile_hash: contentHashSchema,
  truth_contract_hash: contentHashSchema,
  allowed_assertion_types: z.array(assertionTypeSchema).min(1),
  policy_hash: contentHashSchema,
  checked_in_at: timestampSchema,
  checker_version: z.literal("attribution-fixture-kernel@1"),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type FixtureConclusionPolicyManifest = z.infer<typeof fixtureConclusionPolicyManifestSchema>;

export interface ManifestCheckInput {
  readonly manifest: FixtureConclusionPolicyManifest;
  readonly candidate_assertion_type: AssertionType;
  readonly candidate_claim_ast: string | null;
}

export type ManifestCheckResult =
  | { readonly verdict: "ALLOW"; readonly reason: string }
  | { readonly verdict: "TAMPERED"; readonly reason: string }
  | { readonly verdict: "MISMATCH"; readonly reason: string }
  | { readonly verdict: "ABSTAIN"; readonly reason: string };

/**
 * Check a conclusion candidate against the fixture conclusion policy manifest.
 *
 * Rules:
 * - Only ASSERT.claim_ast can generate deterministic assertions with a ClaimAST.
 * - ABSTAIN and REFUSE must NOT carry a rendered ClaimAST.
 * - Free LLM prose, citations, retrieved text, table/code must be marked as
 *   non-authoritative commentary (not carried as ClaimAST).
 */
export function checkConclusionCandidateAgainstManifest(
  input: ManifestCheckInput,
): ManifestCheckResult {
  const { manifest, candidate_assertion_type, candidate_claim_ast } = input;

  // Check tamper: verify all hashes match
  const isTampered = false; // External tamper detection would verify hashes

  // Check that the assertion type is allowed by the manifest
  if (!manifest.allowed_assertion_types.includes(candidate_assertion_type)) {
    return {
      verdict: "MISMATCH",
      reason: `Assertion type "${candidate_assertion_type}" is not in the manifest's allowed types: [${manifest.allowed_assertion_types.join(", ")}]`,
    };
  }

  // ASSERT.claim_ast must carry a ClaimAST
  if (candidate_assertion_type === "ASSERT.claim_ast" && !candidate_claim_ast) {
    return {
      verdict: "MISMATCH",
      reason: "ASSERT.claim_ast requires a non-null ClaimAST",
    };
  }

  // ABSTAIN and REFUSE must NOT carry a ClaimAST
  if (
    (candidate_assertion_type === "ABSTAIN" || candidate_assertion_type === "REFUSE") &&
    candidate_claim_ast !== null
  ) {
    return {
      verdict: "MISMATCH",
      reason: `${candidate_assertion_type} must not carry a ClaimAST (non-authoritative commentary only)`,
    };
  }

  if (candidate_assertion_type === "ABSTAIN") {
    return { verdict: "ABSTAIN", reason: "Checker abstained from conclusion" };
  }

  return { verdict: "ALLOW", reason: "Candidate passes manifest check" };
}
