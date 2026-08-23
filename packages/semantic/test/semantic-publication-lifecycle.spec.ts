import {
  buildSemanticAssertionCandidate,
  buildSemanticReviewDecision,
} from "@data-agent/contracts/artifacts";
import { describe, expect, it, vi } from "vitest";
import {
  compileSemanticChangeSet,
  freezeSemanticChangeSetForReview,
  publishReviewedSemanticChangeSet,
} from "../src/production/index.js";

const id = (suffix: number) => `30000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" as const, semantic_domain: "falcon24" };

async function frozenChangeSet() {
  const assertion = await buildSemanticAssertionCandidate({
    schema_version: "semantic-assertion-candidate@1.0.0",
    assertion_id: id(10),
    scope,
    target_kind: "QUALITY_CONSTRAINT",
    canonical_key: "orders.before_registration",
    applicability_scope: { datasource: "falcon_db_24" },
    assertion_payload: {
      constraint_id: "orders-before-registration",
      expression: "order_date >= registration_date",
      severity: "WARN",
      sensitivity: "INTERNAL",
    },
    source_kind: "SCHEMA_FACT",
    evidence: [{
      evidence_id: "falcon24-profile:orders-before-registration",
      source_kind: "SCHEMA_FACT",
      source_ref: { resource_id: "falcon24-profile", resource_revision: 1, resource_hash: hash("1") },
      locator: { locator_kind: "SCHEMA_OBJECT", locator_value: "orders.order_date" },
      observation: "Order timestamps may precede registration timestamps.",
    }],
    premise_assertion_ids: [],
    inference_rule_id: null,
    confidence: 1,
  });
  return freezeSemanticChangeSetForReview(await compileSemanticChangeSet({
    change_set_id: id(11),
    scope,
    base_release: { release_id: id(12), generation: 4, release_hash: hash("2") },
    revision: 1,
    assertions: [assertion],
  }));
}

describe("semantic publication lifecycle", () => {
  it("publishes only an exact approved frozen change set before queuing projections", async () => {
    const changeSet = await frozenChangeSet();
    const review = await buildSemanticReviewDecision({
      schema_version: "semantic-review-decision@1.0.0",
      review_id: id(13),
      scope,
      change_set_id: changeSet.change_set_id,
      change_set_hash: changeSet.change_set_hash,
      reviewer_principal_id: id(14),
      decision: "APPROVE",
      reason_codes: [],
      reviewed_at: "2026-08-24T00:00:00.000Z",
    });
    const publishAtomically = vi.fn(async () => ({
      release_id: id(15),
      generation: 5,
      release_hash: hash("3"),
      binding_impact_hashes: [hash("4")],
    }));
    const enqueuePublishedRelease = vi.fn(async () => undefined);
    const receipt = await publishReviewedSemanticChangeSet({
      publication_id: id(16),
      change_set: changeSet,
      review,
      authority: { publishAtomically },
      projections: { enqueuePublishedRelease },
      published_at: "2026-08-24T00:01:00.000Z",
    });
    expect(receipt.published_release.generation).toBe(5);
    expect(publishAtomically).toHaveBeenCalledOnce();
    expect(enqueuePublishedRelease).toHaveBeenCalledAfter(publishAtomically);
  });

  it("rejects a review for a different change-set hash before authority I/O", async () => {
    const changeSet = await frozenChangeSet();
    const review = await buildSemanticReviewDecision({
      schema_version: "semantic-review-decision@1.0.0",
      review_id: id(17),
      scope,
      change_set_id: changeSet.change_set_id,
      change_set_hash: hash("9"),
      reviewer_principal_id: id(18),
      decision: "APPROVE",
      reason_codes: [],
      reviewed_at: "2026-08-24T00:00:00.000Z",
    });
    const publishAtomically = vi.fn();
    await expect(publishReviewedSemanticChangeSet({
      publication_id: id(19),
      change_set: changeSet,
      review,
      authority: { publishAtomically },
      projections: { enqueuePublishedRelease: vi.fn() },
      published_at: "2026-08-24T00:01:00.000Z",
    })).rejects.toThrow("SEMANTIC_PUBLICATION_REVIEW_CLOSURE_INVALID");
    expect(publishAtomically).not.toHaveBeenCalled();
  });
});
