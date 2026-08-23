import { artifactReferenceIdentity } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { deriveResearchStopDecisionFromDocumentsCandidate } from "../src/stop.js";
import { buildDocumentBackedResearchFixture } from "./document-fixtures.js";

function supportOutcomes(
  documents: Awaited<
    ReturnType<typeof buildDocumentBackedResearchFixture>
  >["support_decision_documents"],
): string[] {
  return documents.map(({ payload }) => {
    if (payload.artifact_type !== "SupportDecision") {
      throw new TypeError("fixture SupportDecision 类型漂移。");
    }
    return payload.decision;
  });
}

describe("document-backed Research fixture", () => {
  it("mixed 与 all-refuted 均通过完整文档闭包到达 STOP_READY", async () => {
    const mixed = await buildDocumentBackedResearchFixture({
      seed: 1_000,
      mode: "MIXED_SUPPORTED_REFUTED",
    });
    const allRefuted = await buildDocumentBackedResearchFixture({
      seed: 2_000,
      mode: "ALL_REFUTED",
    });

    expect(supportOutcomes(mixed.support_decision_documents)).toEqual(["SUPPORTED", "REFUTED"]);
    expect(supportOutcomes(allRefuted.support_decision_documents)).toEqual(["REFUTED", "REFUTED"]);
    for (const fixture of [mixed, allRefuted]) {
      expect(
        fixture.coverage_document.payload.artifact_type === "CoverageState"
          ? fixture.coverage_document.payload.obligations.map(({ state }) => state)
          : [],
      ).toEqual(["SATISFIED", "SATISFIED"]);
      expect(fixture.stop_document.payload).toMatchObject({
        artifact_type: "ResearchStopDecision",
        decision: "STOP_READY",
      });
      expect(
        fixture.material_query_evidence_documents
          .map(({ envelope }) => artifactReferenceIdentity(envelope))
          .sort(),
      ).toEqual(
        fixture.query_evidence_resolutions
          .map(({ document }) => artifactReferenceIdentity(document.envelope))
          .sort(),
      );
    }
    if (allRefuted.stop_document.payload.artifact_type !== "ResearchStopDecision") {
      throw new TypeError("fixture ResearchStopDecision 类型漂移。");
    }
    expect(allRefuted.stop_document.payload.supported_subset).toMatchObject({
      claim_refs: [],
      support_decision_refs: [],
    });
  });

  it("相同 seed 可重放，且缺失 REFUTED material evidence 时 Stop fail-close", async () => {
    const first = await buildDocumentBackedResearchFixture({ seed: 3_000 });
    const replay = await buildDocumentBackedResearchFixture({ seed: 3_000 });
    expect(replay).toEqual(first);

    await expect(
      deriveResearchStopDecisionFromDocumentsCandidate({
        ...first.stop_input,
        pre_stop_readiness: {
          ...first.stop_input.pre_stop_readiness,
          material_query_evidence_documents:
            first.stop_input.pre_stop_readiness.material_query_evidence_documents.slice(0, 1),
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "RESEARCH_STOP_INPUT_INCONSISTENT" },
    });
  });
});
