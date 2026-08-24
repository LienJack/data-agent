import {
  buildSemanticPublicationReceipt,
  type SemanticChangeSet,
  type SemanticPublicationReceipt,
  type SemanticReviewDecision,
  verifySemanticChangeSet,
  verifySemanticReviewDecision,
} from "@data-agent/contracts/artifacts";
import { canonicalizeJson } from "@data-agent/contracts/common";

export interface SemanticPublicationAuthorityPort {
  publishAtomically(
    input: Readonly<{
      change_set: SemanticChangeSet;
      review: SemanticReviewDecision;
      published_at: string;
    }>,
  ): Promise<
    Readonly<{
      release_id: string;
      generation: number;
      release_hash: `sha256:${string}`;
      binding_impact_hashes: readonly `sha256:${string}`[];
      projection_rebuild: Readonly<{
        sparse: "READY";
        vector: "READY";
        graph: "READY";
      }>;
    }>
  >;
}

export async function publishReviewedSemanticChangeSet(
  input: Readonly<{
    publication_id: string;
    change_set: SemanticChangeSet;
    review: SemanticReviewDecision;
    authority: SemanticPublicationAuthorityPort;
    published_at: string;
  }>,
): Promise<SemanticPublicationReceipt> {
  const [changeSet, review] = await Promise.all([
    verifySemanticChangeSet(input.change_set),
    verifySemanticReviewDecision(input.review),
  ]);
  if (
    changeSet.lifecycle_state !== "REVIEW_FROZEN" ||
    changeSet.validation.outcome !== "PASS" ||
    !changeSet.validation.competency_cases_passed ||
    review.decision !== "APPROVE" ||
    review.change_set_id !== changeSet.change_set_id ||
    review.change_set_hash !== changeSet.change_set_hash ||
    canonicalizeJson(review.scope) !== canonicalizeJson(changeSet.scope)
  ) {
    throw new TypeError("SEMANTIC_PUBLICATION_REVIEW_CLOSURE_INVALID");
  }

  const committed = await input.authority.publishAtomically({
    change_set: changeSet,
    review,
    published_at: input.published_at,
  });
  if (committed.generation !== changeSet.base_release.generation + 1) {
    throw new TypeError("SEMANTIC_PUBLICATION_GENERATION_INVALID");
  }
  const receipt = await buildSemanticPublicationReceipt({
    schema_version: "semantic-publication-receipt@1.0.0",
    publication_id: input.publication_id,
    scope: changeSet.scope,
    change_set_id: changeSet.change_set_id,
    change_set_hash: changeSet.change_set_hash,
    review_id: review.review_id,
    review_hash: review.review_hash,
    previous_release: changeSet.base_release,
    published_release: {
      release_id: committed.release_id,
      generation: committed.generation,
      release_hash: committed.release_hash,
      valid_from: input.published_at,
    },
    binding_impact_hashes: [...committed.binding_impact_hashes].sort(),
    projection_rebuild: committed.projection_rebuild,
    published_at: input.published_at,
  });
  return receipt;
}
