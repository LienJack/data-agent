import type { SemanticAuthoringPublicEvent } from "@data-agent/contracts";
import type { SemanticStudioAuthoringState } from "@data-agent/semantic/application";
import { describe, expect, it } from "vitest";
import {
  createSemanticStudioControllerState,
  semanticStudioControllerReducer,
} from "../src/components/semantic/studio/state";

function event(sequence: number): SemanticAuthoringPublicEvent {
  return {
    schema_version: "semantic-authoring-public-event@1.0.0",
    event_id: `10000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    run_id: "10000000-0000-4000-8000-000000000099",
    sequence,
    occurred_at: "2026-08-23T00:00:00.000Z",
    type: "stage",
    payload: { phase: "test", status: "RUNNING", summary: `event ${sequence}` },
  };
}

const authoringState = {
  run: {
    authoring_run_id: "10000000-0000-4000-8000-000000000099",
    status: "RUNNING",
  },
} as unknown as SemanticStudioAuthoringState;

describe("Semantic Studio controller", () => {
  it("isolates draft, selection, stream and error when the workspace changes", () => {
    const initial = {
      ...createSemanticStudioControllerState({
        workspaceId: "workspace-a",
        snapshot: null,
        draft: "unsaved instruction",
        evidenceSelectionId: "selection-a",
      }),
      error: "stream failed",
      connection: "reconnecting" as const,
      events: [event(4)],
      eventSequence: 4,
    };

    const next = semanticStudioControllerReducer(initial, {
      type: "workspace-changed",
      workspaceId: "workspace-b",
      snapshot: null,
    });

    expect(next).toMatchObject({
      workspaceId: "workspace-b",
      draft: "",
      evidenceSelectionId: null,
      selectedNode: null,
      selectedEdge: null,
      error: null,
      connection: "idle",
      events: [],
      eventSequence: 0,
    });
  });

  it("deduplicates replayed SSE events and rejects a stale batch", () => {
    const initial = createSemanticStudioControllerState({
      workspaceId: "workspace-a",
      snapshot: null,
      draft: "",
      evidenceSelectionId: null,
    });
    const current = semanticStudioControllerReducer(initial, {
      type: "authoring-received",
      authoringState,
      events: [event(1), event(2)],
    });
    const replayed = semanticStudioControllerReducer(current, {
      type: "authoring-received",
      authoringState,
      events: [event(2)],
    });
    const stale = semanticStudioControllerReducer(replayed, {
      type: "authoring-received",
      authoringState,
      events: [event(1)],
    });

    expect(replayed.events.map((item) => item.sequence)).toEqual([1, 2]);
    expect(stale).toBe(replayed);
  });

  it("models reconnect, save conflict and publish transitions deterministically", () => {
    const initial = createSemanticStudioControllerState({
      workspaceId: "workspace-a",
      snapshot: null,
      draft: "",
      evidenceSelectionId: null,
    });
    const reconnecting = semanticStudioControllerReducer(initial, {
      type: "connection-changed",
      connection: "reconnecting",
    });
    const conflicted = semanticStudioControllerReducer(reconnecting, {
      type: "save-conflicted",
      message: "revision conflict",
    });
    const publishing = semanticStudioControllerReducer(
      { ...conflicted, mutation: "ready-to-publish" },
      { type: "publish-started" },
    );
    const published = semanticStudioControllerReducer(publishing, {
      type: "publish-succeeded",
    });

    expect(reconnecting.connection).toBe("reconnecting");
    expect(conflicted).toMatchObject({ mutation: "save-conflict", error: "revision conflict" });
    expect(publishing).toMatchObject({ mutation: "publishing", authoringBusy: true });
    expect(published).toMatchObject({ mutation: "published", authoringBusy: false });
  });
});
