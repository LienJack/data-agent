import type { ArtifactReference } from "@data-agent/contracts/artifacts";
import type { ResolutionTrace } from "@data-agent/contracts/runs";
import { describe, expect, it } from "vitest";
import {
  exactRequiredFalcon24ArtifactReferences,
  falcon24QaStartUrl,
} from "../src/cli/falcon24-browser-trace-gate";

const runId = "00000000-0000-4000-8000-000000000101";
const workspaceId = "00000000-0000-4000-8000-000000000102";
const conversationId = "00000000-0000-4000-8000-000000000103";
const artifactTypes = [
  "AnalysisReport",
  "ArtifactWorkspaceDocument",
  "DerivedAnalysisEvidence",
  "QueryEvidence",
  "SqlArtifact",
] as const;

function reference(artifactType: (typeof artifactTypes)[number], index: number): ArtifactReference {
  return {
    artifact_id: `00000000-0000-4000-8000-${String(200 + index).padStart(12, "0")}`,
    artifact_type: artifactType,
    app_id: "00000000-0000-4000-8000-000000000104",
    tenant_id: workspaceId,
    environment: "test",
    run_id: runId,
    revision: 1,
    content_hash: `sha256:${String(index + 1).repeat(64)}`,
  };
}

function traceWith(references: readonly ArtifactReference[]): ResolutionTrace {
  return {
    nodes: references.map((artifactRef, index) => ({
      node_id: `node-${index}`,
      artifact_refs: [artifactRef],
    })),
  } as ResolutionTrace;
}

describe("Falcon24 E1 browser gate", () => {
  it("always starts from the real Q&A composer without a prebuilt Run or event route", () => {
    const url = falcon24QaStartUrl({
      web_base_url: "https://data-agent.example/trace?run=forbidden&event=forbidden",
      workspace_id: workspaceId,
      conversation_id: conversationId,
    });

    expect(url.pathname).toBe(`/w/${workspaceId}/qa`);
    expect(url.searchParams.get("conversation")).toBe(conversationId);
    expect(url.searchParams.get("tab")).toBe("conversation");
    expect(url.searchParams.has("run")).toBe(false);
    expect(url.searchParams.has("event")).toBe(false);
  });

  it("requires exactly one reference for every governed UI artifact type", () => {
    const references = artifactTypes.map(reference);
    expect(exactRequiredFalcon24ArtifactReferences(traceWith(references))).toHaveLength(5);
  });

  it("fails closed when an exact governed artifact identity is duplicated", () => {
    const references = artifactTypes.map(reference);
    const duplicate = references.at(0);
    if (!duplicate) throw new Error("FALCON24_BROWSER_TEST_FIXTURE_MISSING");
    expect(() =>
      exactRequiredFalcon24ArtifactReferences(
        traceWith([...references, { ...duplicate, revision: 2 }]),
      ),
    ).toThrow("FALCON24_BROWSER_REQUIRED_ARTIFACT_CARDINALITY_INVALID");
  });
});
