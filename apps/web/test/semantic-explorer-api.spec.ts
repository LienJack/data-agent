import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getExplorerTimelinePage,
  getSemanticBindingImpact,
} from "../src/lib/semantic-explorer-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Semantic binding impact browser API", () => {
  it("uses the unique Workspace route and parses the strict safe projection", async () => {
    const workspaceId = "00000000-0000-4000-8000-000000009001";
    const impactId = "00000000-0000-8000-8000-000000009002";
    const releaseId = "00000000-0000-4000-8000-000000009003";
    const digest = `sha256:${"a".repeat(64)}`;
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              schema_version: "semantic-binding-impact-safe-projection@1.0.0",
              impact_id: impactId,
              receipt_hash: digest,
              plan_hash: digest,
              drift_event_id: releaseId,
              release: { release_id: releaseId, generation: 2, release_digest: digest },
              status: "NO_SEMANTIC_ACTION",
              risk_level: "LOW",
              direct_impact_count: 0,
              transitive_impact_count: 0,
              suggested_actions: ["NO_SEMANTIC_ACTION"],
              manual_reason_codes: [],
              candidate_ref: null,
              committed_at: "2026-08-23T08:00:00.000Z",
            },
            meta: { authority: "POSTGRESQL" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const projection = await getSemanticBindingImpact(workspaceId, "commerce", impactId);

    expect(projection.impact_id).toBe(impactId);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/workspaces/${workspaceId}/semantic/binding-impacts/${impactId}?domain=commerce`,
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({ "x-workspace-id": workspaceId }),
      }),
    );
  });
});

describe("Semantic Explorer browser API", () => {
  it("carries the release generation cursor through the public client", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              schema_version: "semantic-explorer-release-timeline@1.0.0",
              semantic_domain: "revenue",
              pointer_observation: {
                current_release_id: null,
                current_release_generation: 0,
                current_release_digest: null,
                pointer_generation: 1,
                observed_at: "2026-08-09T00:00:00.000Z",
              },
              releases: [],
              next_generation_cursor: null,
            },
            meta: { authority: "POSTGRESQL" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getExplorerTimelinePage("workspace-1", "revenue", 3);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/semantic/releases?domain=revenue&limit=50&cursor=3",
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({ "x-workspace-id": "workspace-1" }),
        signal: expect.any(AbortSignal),
      }),
    );
  });
});
