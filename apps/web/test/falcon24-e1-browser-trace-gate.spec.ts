import type { ArtifactReference } from "@data-agent/contracts/artifacts";
import type { ResolutionTrace } from "@data-agent/contracts/runs";
import { describe, expect, it, vi } from "vitest";
import {
  exactRequiredFalcon24ArtifactReferences,
  falcon24QaStartUrl,
  preflightFalcon24BrowserSubmission,
} from "../src/cli/falcon24-browser-trace-gate";

const execFileAsyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const execFile = Object.assign(vi.fn(), {
    [Symbol.for("nodejs.util.promisify.custom")]: execFileAsyncMock,
  });
  return { ...actual, execFile };
});

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

  it("accepts the complete runtime identity while comparing only the governed web fields", async () => {
    const buildId = `sha256:${"a".repeat(64)}`;
    const generationId = `sha256:${"b".repeat(64)}`;
    let composerReady = false;
    execFileAsyncMock.mockImplementation(async (_file: string, args: readonly string[]) => ({
      stdout: JSON.stringify({
        success: true,
        data: args.includes("eval")
          ? {
              result: {
                location: `https://data-agent.example/w/${workspaceId}/qa?conversation=${conversationId}&tab=conversation`,
                ready: true,
                question_input_visible: true,
                submit_visible: true,
                composer_ready: composerReady,
                expected_run_absent: true,
                error_banners: [],
                web_build: { build_id: buildId, generation_id: generationId },
              },
            }
          : {},
        error: null,
      }),
      stderr: "",
    }));

    const runtimeIdentity = {
      schema_version: "runtime-build-identity@1.0.0",
      consumer_role: "web",
      build_id: buildId,
      generation_id: generationId,
      built_at: "2026-08-27T00:00:00.000Z",
      git_commit: "0".repeat(40),
      git_dirty: false,
    };

    await expect(
      preflightFalcon24BrowserSubmission({
        session: "falcon24-e1-q1-regression",
        web_base_url: "https://data-agent.example",
        workspace_id: workspaceId,
        conversation_id: conversationId,
        expected_run_id: runId,
        expected_web_build: runtimeIdentity,
        viewport: { width: 1440, height: 900 },
      }),
    ).rejects.toThrow();

    composerReady = true;
    await expect(
      preflightFalcon24BrowserSubmission({
        session: "falcon24-e1-q1-regression",
        web_base_url: "https://data-agent.example",
        workspace_id: workspaceId,
        conversation_id: conversationId,
        expected_run_id: runId,
        expected_web_build: runtimeIdentity,
        viewport: { width: 1440, height: 900 },
      }),
    ).resolves.toMatchObject({
      ready: true,
      web_build: { build_id: buildId, generation_id: generationId },
    });
  });
});
