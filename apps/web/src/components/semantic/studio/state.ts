import type {
  SemanticAuthoringPublicEvent,
  SemanticCandidateRevisionSaveResult,
  SemanticGraphReadEdge,
  SemanticGraphReadNode,
  SemanticManualEdit,
} from "@data-agent/contracts";
import type {
  SemanticStudioAuthoringState,
  SemanticStudioSnapshot,
} from "@data-agent/semantic/application";
import { mergeAuthoringEvents } from "@/lib/semantic-studio-model";

export type SemanticStudioConnection = "idle" | "live" | "reconnecting" | "closed";
export type SemanticStudioMutation =
  | "read-only"
  | "editing"
  | "saving"
  | "save-conflict"
  | "ready-to-publish"
  | "publishing"
  | "published"
  | "error";

export interface SemanticStudioControllerState {
  readonly workspaceId: string;
  readonly snapshot: SemanticStudioSnapshot | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly selectedNode: SemanticGraphReadNode | null;
  readonly selectedEdge: SemanticGraphReadEdge | null;
  readonly draft: string;
  readonly evidenceSelectionId: string | null;
  readonly authoringState: SemanticStudioAuthoringState | null;
  readonly events: readonly SemanticAuthoringPublicEvent[];
  readonly eventSequence: number;
  readonly connection: SemanticStudioConnection;
  readonly mutation: SemanticStudioMutation;
  readonly authoringBusy: boolean;
  readonly manualEdits: readonly SemanticManualEdit[];
  readonly lastSavedRevision: SemanticCandidateRevisionSaveResult | null;
}

export function createSemanticStudioControllerState(input: {
  readonly workspaceId: string;
  readonly snapshot: SemanticStudioSnapshot | null;
  readonly draft: string;
  readonly evidenceSelectionId: string | null;
}): SemanticStudioControllerState {
  const events = input.snapshot?.authoring?.events ?? [];
  const selectedNode = input.snapshot?.local
    ? (input.snapshot.local.nodes.find(
        ({ node }) => node.node_id === input.snapshot?.local?.center_node_id,
      ) ?? null)
    : null;
  return {
    workspaceId: input.workspaceId,
    snapshot: input.snapshot,
    loading: input.snapshot === null,
    error: null,
    selectedNode,
    selectedEdge: null,
    draft: input.draft,
    evidenceSelectionId: input.evidenceSelectionId,
    authoringState: input.snapshot?.authoring?.state ?? null,
    events,
    eventSequence: events.at(-1)?.sequence ?? 0,
    connection: "idle",
    mutation: input.snapshot?.authoring?.saved_revision ? "ready-to-publish" : "read-only",
    authoringBusy: false,
    manualEdits: [],
    lastSavedRevision: input.snapshot?.authoring?.saved_revision ?? null,
  };
}

export type SemanticStudioControllerAction =
  | {
      readonly type: "workspace-changed";
      readonly workspaceId: string;
      readonly snapshot: SemanticStudioSnapshot | null;
    }
  | { readonly type: "load-started" }
  | { readonly type: "load-succeeded"; readonly snapshot: SemanticStudioSnapshot }
  | { readonly type: "failed"; readonly message: string }
  | { readonly type: "error-cleared" }
  | {
      readonly type: "selection-changed";
      readonly node: SemanticGraphReadNode | null;
      readonly edge: SemanticGraphReadEdge | null;
    }
  | { readonly type: "draft-changed"; readonly draft: string }
  | { readonly type: "evidence-cleared" }
  | { readonly type: "busy-changed"; readonly busy: boolean }
  | {
      readonly type: "authoring-received";
      readonly authoringState: SemanticStudioAuthoringState;
      readonly events: readonly SemanticAuthoringPublicEvent[];
    }
  | { readonly type: "connection-changed"; readonly connection: SemanticStudioConnection }
  | { readonly type: "manual-edit-appended"; readonly edit: SemanticManualEdit }
  | { readonly type: "save-started" }
  | { readonly type: "save-conflicted"; readonly message: string }
  | {
      readonly type: "save-succeeded";
      readonly revision: SemanticCandidateRevisionSaveResult;
    }
  | { readonly type: "saved-revision-cleared" }
  | { readonly type: "publish-started" }
  | { readonly type: "publish-succeeded" };

function projectManualEdit(
  state: SemanticStudioControllerState,
  edit: SemanticManualEdit,
): Pick<SemanticStudioControllerState, "selectedNode" | "selectedEdge"> {
  if (edit.operation === "ADD_NODE") {
    return {
      selectedNode: {
        node: edit.node,
        status: "ADDED",
        relation_count: {
          incoming: 0,
          outgoing: 0,
          total: 0,
          by_family: {
            BUSINESS: 0,
            ANALYTICAL: 0,
            FORMULA: 0,
            PHYSICAL: 0,
            JOIN: 0,
            PROVENANCE: 0,
            TERMINOLOGY: 0,
          },
        },
      },
      selectedEdge: null,
    };
  }
  if (edit.operation === "UPDATE_NODE") {
    return {
      selectedNode:
        state.selectedNode?.node.node_id === edit.node.node_id
          ? {
              ...state.selectedNode,
              node: edit.node,
              status:
                state.selectedNode.status === "PUBLISHED" ? "MODIFIED" : state.selectedNode.status,
            }
          : state.selectedNode,
      selectedEdge: state.selectedEdge,
    };
  }
  if (edit.operation === "RETIRE_NODE") {
    return {
      selectedNode:
        state.selectedNode?.node.node_id === edit.node_id
          ? {
              ...state.selectedNode,
              node: { ...state.selectedNode.node, lifecycle: "RETIRED" },
              status: "RETIRED",
            }
          : state.selectedNode,
      selectedEdge: state.selectedEdge,
    };
  }
  if (edit.operation === "ADD_EDGE") {
    return { selectedNode: null, selectedEdge: { edge: edit.edge, status: "ADDED" } };
  }
  if (edit.operation === "UPDATE_EDGE") {
    return {
      selectedNode: state.selectedNode,
      selectedEdge:
        state.selectedEdge?.edge.edge_id === edit.edge.edge_id
          ? {
              edge: edit.edge,
              status:
                state.selectedEdge.status === "PUBLISHED" ? "MODIFIED" : state.selectedEdge.status,
            }
          : state.selectedEdge,
    };
  }
  if (edit.operation === "ADD_EDGE_TYPE") {
    return { selectedNode: state.selectedNode, selectedEdge: state.selectedEdge };
  }
  return {
    selectedNode: state.selectedNode,
    selectedEdge:
      state.selectedEdge?.edge.edge_id === edit.edge_id
        ? {
            edge: { ...state.selectedEdge.edge, lifecycle: "RETIRED" },
            status: "RETIRED",
          }
        : state.selectedEdge,
  };
}

export function semanticStudioControllerReducer(
  state: SemanticStudioControllerState,
  action: SemanticStudioControllerAction,
): SemanticStudioControllerState {
  switch (action.type) {
    case "workspace-changed":
      return createSemanticStudioControllerState({
        workspaceId: action.workspaceId,
        snapshot: action.snapshot,
        draft: "",
        evidenceSelectionId: null,
      });
    case "load-started":
      return { ...state, loading: true, error: null };
    case "load-succeeded": {
      const incomingEvents = action.snapshot.authoring?.events ?? [];
      return {
        ...state,
        snapshot: action.snapshot,
        loading: false,
        error: null,
        authoringState: action.snapshot.authoring?.state ?? null,
        events: action.snapshot.authoring ? mergeAuthoringEvents(state.events, incomingEvents) : [],
        eventSequence: Math.max(state.eventSequence, incomingEvents.at(-1)?.sequence ?? 0),
        lastSavedRevision: action.snapshot.authoring?.saved_revision ?? null,
        mutation: action.snapshot.authoring?.saved_revision
          ? "ready-to-publish"
          : state.manualEdits.length > 0
            ? "editing"
            : "read-only",
      };
    }
    case "failed":
      return {
        ...state,
        loading: false,
        authoringBusy: false,
        mutation: "error",
        error: action.message,
      };
    case "error-cleared":
      return { ...state, error: null };
    case "selection-changed":
      return { ...state, selectedNode: action.node, selectedEdge: action.edge };
    case "draft-changed":
      return { ...state, draft: action.draft };
    case "evidence-cleared":
      return { ...state, evidenceSelectionId: null };
    case "busy-changed":
      return { ...state, authoringBusy: action.busy };
    case "authoring-received": {
      const newestSequence = action.events.at(-1)?.sequence ?? 0;
      if (newestSequence > 0 && newestSequence < state.eventSequence) return state;
      return {
        ...state,
        authoringState: action.authoringState,
        events: mergeAuthoringEvents(state.events, action.events),
        eventSequence: Math.max(state.eventSequence, newestSequence),
      };
    }
    case "connection-changed":
      return { ...state, connection: action.connection };
    case "manual-edit-appended":
      return {
        ...state,
        ...projectManualEdit(state, action.edit),
        manualEdits: [...state.manualEdits, action.edit],
        mutation: "editing",
        lastSavedRevision: null,
      };
    case "save-started":
      return { ...state, authoringBusy: true, error: null, mutation: "saving" };
    case "save-conflicted":
      return {
        ...state,
        authoringBusy: false,
        mutation: "save-conflict",
        error: action.message,
      };
    case "save-succeeded":
      return {
        ...state,
        authoringBusy: false,
        manualEdits: [],
        lastSavedRevision: action.revision,
        mutation: "ready-to-publish",
        error: null,
      };
    case "saved-revision-cleared":
      return { ...state, lastSavedRevision: null, mutation: "editing" };
    case "publish-started":
      return { ...state, authoringBusy: true, mutation: "publishing", error: null };
    case "publish-succeeded":
      return { ...state, authoringBusy: false, mutation: "published", error: null };
  }
}
