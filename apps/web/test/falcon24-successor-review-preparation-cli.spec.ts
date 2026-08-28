import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(import.meta.dirname, "../src/cli/prepare-falcon24-semantic-successor-review.ts"),
  "utf8",
);

describe("Falcon24 successor review-preparation CLI", () => {
  it("opens only a human review packet from the server-built ChangeSet", () => {
    expect(source).toContain("buildFalcon24SuccessorChangeSet");
    expect(source).toContain("prepareSuccessorReview");
    expect(source).toContain("WAITING_REVIEW");
    expect(source).not.toContain("prepareApprovedSuccessor");
    expect(source).not.toContain("human_record_semantic_review_decision");
    expect(source).not.toContain("stageReviewedSuccessor");
    expect(source).not.toContain("promoteStagedSuccessor");
  });

  it("requires an explicit preparation confirmation without activation authority", () => {
    expect(source).toContain("DATA_AGENT_ALLOW_FALCON24_SUCCESSOR_REVIEW_PREPARATION");
    expect(source).not.toContain("DATA_AGENT_ALLOW_FALCON24_AUTHORITY_ACTIVATION");
  });
});
