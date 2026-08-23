import { describe, expect, it } from "vitest";
import {
  buildWorkspaceJourneyEvidenceArtifact,
  verifyWorkspaceJourneyEvidenceArtifact,
  WORKSPACE_JOURNEY_REQUIRED_CHECKPOINTS,
  workspaceJourneyCheckSchema,
} from "../src/index.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;

function input() {
  return {
    artifact_id: id(1),
    scope: { app_id: id(2), tenant_id: id(3), environment: "test" },
    workspace_id: id(4),
    goal_id: "datafoundry-coa-u17",
    checks: WORKSPACE_JOURNEY_REQUIRED_CHECKPOINTS.map((checkpoint_id, index) => ({
      checkpoint_id,
      status: "PASS" as const,
      actor_role: index % 2 === 0 ? ("ANALYST" as const) : ("SYSTEM" as const),
      route: `/w/${id(4)}/qa?runId=${id(index + 20)}`,
      verification_method: index < 8 ? ("AUTOMATED_TEST" as const) : ("BROWSER" as const),
      evidence_refs: [hash(((index % 6) + 1).toString())],
      summary: `verified ${checkpoint_id}`,
    })),
    viewports: [
      { name: "DESKTOP" as const, width: 1440, height: 1000, screenshot_hash: hash("a") },
      { name: "MOBILE" as const, width: 390, height: 844, screenshot_hash: hash("b") },
    ],
    validated_at: "2026-08-18T04:00:00.000Z",
  };
}

describe("WorkspaceJourneyEvidenceArtifact", () => {
  it("builds a stable content-addressed GO artifact independent of input order", async () => {
    const canonical = await buildWorkspaceJourneyEvidenceArtifact(input());
    const reorderedInput = input();
    reorderedInput.checks.reverse();
    reorderedInput.viewports.reverse();
    const reordered = await buildWorkspaceJourneyEvidenceArtifact(reorderedInput);

    expect(reordered).toEqual(canonical);
    await expect(verifyWorkspaceJourneyEvidenceArtifact(canonical)).resolves.toEqual(canonical);
  });

  it("fails closed when a required checkpoint is missing or duplicated", async () => {
    const missing = input();
    missing.checks.pop();
    await expect(buildWorkspaceJourneyEvidenceArtifact(missing)).rejects.toThrow(
      "WORKSPACE_JOURNEY_MISSING_CHECKPOINT",
    );

    const duplicate = input();
    const first = duplicate.checks[0];
    if (!first) throw new Error("test fixture requires a first checkpoint");
    duplicate.checks[1] = first;
    await expect(buildWorkspaceJourneyEvidenceArtifact(duplicate)).rejects.toThrow(
      "WORKSPACE_JOURNEY_DUPLICATE_CHECKPOINT",
    );
  });

  it("rejects unknown fields, failed checks and hash substitution", async () => {
    const artifact = await buildWorkspaceJourneyEvidenceArtifact(input());
    await expect(
      verifyWorkspaceJourneyEvidenceArtifact({ ...artifact, private_reasoning: "hidden" }),
    ).rejects.toThrow();
    expect(
      workspaceJourneyCheckSchema.safeParse({ ...input().checks[0], status: "FAIL" }).success,
    ).toBe(false);
    await expect(
      verifyWorkspaceJourneyEvidenceArtifact({ ...artifact, artifact_hash: hash("f") }),
    ).rejects.toThrow("WORKSPACE_JOURNEY_ARTIFACT_HASH_MISMATCH");
  });
});
