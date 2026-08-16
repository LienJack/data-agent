import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  handleGetSemanticAuthoringPublicFeed,
  handleLoadSemanticStudio,
  handleStreamSemanticAuthoringRun,
} from "../src/lib/semantic-studio-route";
import type { SemanticStudioService } from "../src/lib/semantic-studio-service";

const runId = "10000000-0000-4000-8000-000000000099";

describe("Semantic Studio routes", () => {
  it("binds server-side Node filters and pagination to the read model query", async () => {
    const load = vi.fn(async () => ({ ok: true as const, value: { marker: "snapshot" } }));
    const service = { load } as unknown as SemanticStudioService;
    const response = await handleLoadSemanticStudio(
      new NextRequest(
        "http://localhost/api/workspaces/w/semantic/studio?domain=ecommerce&search=paid&nodeType=METRIC&owner=commerce-team&lifecycle=ACTIVE&status=MODIFIED&nodeDomain=commerce&cursor=250&limit=250",
      ),
      service,
    );
    expect(response.status).toBe(200);
    expect(load).toHaveBeenCalledWith({
      semantic_domain: "ecommerce",
      selected_node_id: null,
      authoring_run_id: null,
      hops: 1,
      expanded_cluster_id: null,
      list_query: {
        search: "paid",
        node_types: ["METRIC"],
        owners: ["commerce-team"],
        lifecycles: ["ACTIVE"],
        statuses: ["MODIFIED"],
        domains: ["commerce"],
        cursor: 250,
        limit: 250,
      },
    });
  });

  it("resumes SSE from Last-Event-ID and closes after a terminal authoring state", async () => {
    const getRun = vi.fn(async () => ({
      ok: true as const,
      value: {
        state: { run: { status: "READY_FOR_REVIEW" } },
        events: [{ sequence: 8, event_id: "event-8" }],
      },
    }));
    const service = { getRun } as unknown as SemanticStudioService;
    const response = await handleStreamSemanticAuthoringRun(
      new NextRequest(
        `http://localhost/api/workspaces/w/semantic/studio/authoring-runs/${runId}/events?semanticDomain=ecommerce&after=2`,
        { headers: { "Last-Event-ID": "7" } },
      ),
      runId,
      service,
    );
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const body = await response.text();
    expect(body).toContain("id: 8");
    expect(body).toContain("event: authoring");
    expect(getRun).toHaveBeenCalledWith({
      semantic_domain: "ecommerce",
      authoring_run_id: runId,
      after_sequence: 7,
    });
  });

  it("loads the browser-safe public feed through a dedicated endpoint", async () => {
    const getPublicRun = vi.fn(async () => ({
      ok: true as const,
      value: { schema_version: "semantic-authoring-public-feed@1.0.0" },
    }));
    const service = { getPublicRun } as unknown as SemanticStudioService;
    const response = await handleGetSemanticAuthoringPublicFeed(
      new NextRequest(
        `http://localhost/api/workspaces/w/semantic/studio/authoring-runs/${runId}/feed?semanticDomain=ecommerce&after=4`,
      ),
      runId,
      service,
    );

    expect(response.status).toBe(200);
    expect(getPublicRun).toHaveBeenCalledWith({
      semantic_domain: "ecommerce",
      authoring_run_id: runId,
      after_sequence: 4,
    });
  });
});
