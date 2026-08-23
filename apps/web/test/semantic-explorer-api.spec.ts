import { afterEach, describe, expect, it, vi } from "vitest";
import { getExplorerTimelinePage } from "../src/lib/semantic-explorer-api";

afterEach(() => {
  vi.unstubAllGlobals();
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
