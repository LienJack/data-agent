import type {
  SemanticExplorerObjectIdentity,
  SemanticExplorerObjectKind,
  SemanticExplorerSnapshot,
} from "@data-agent/contracts";

export type ExplorerViewMode = "table" | "graph";

export type ExplorerServerState =
  | { readonly kind: "loading" }
  | { readonly kind: "empty"; readonly snapshot: SemanticExplorerSnapshot }
  | { readonly kind: "permission-denied" }
  | { readonly kind: "error"; readonly code: string; readonly message: string }
  | { readonly kind: "success"; readonly snapshot: SemanticExplorerSnapshot };

export interface ExplorerState {
  readonly category: SemanticExplorerObjectKind | null;
  readonly domain: string | null;
  readonly highest_pointer_generation: number;
  readonly observed_pointer_generations: Readonly<Record<string, number>>;
  readonly refreshing: boolean;
  readonly request_epoch: number;
  readonly server: ExplorerServerState;
  readonly search: string;
  readonly selected: SemanticExplorerObjectIdentity | null;
  readonly view: ExplorerViewMode;
}

export type ExplorerAction =
  | { readonly type: "request-started"; readonly domain: string; readonly request_epoch: number }
  | {
      readonly type: "request-succeeded";
      readonly domain: string;
      readonly request_epoch: number;
      readonly snapshot: SemanticExplorerSnapshot;
    }
  | {
      readonly type: "request-failed";
      readonly domain: string;
      readonly request_epoch: number;
      readonly code: string;
      readonly message: string;
      readonly permission_denied: boolean;
    }
  | { readonly type: "search-changed"; readonly search: string }
  | { readonly type: "selection-changed"; readonly selected: SemanticExplorerObjectIdentity | null }
  | { readonly type: "category-changed"; readonly category: SemanticExplorerObjectKind | null }
  | { readonly type: "view-changed"; readonly view: ExplorerViewMode };

export const initialExplorerState: ExplorerState = {
  category: null,
  domain: null,
  highest_pointer_generation: 0,
  observed_pointer_generations: {},
  refreshing: false,
  request_epoch: 0,
  server: { kind: "loading" },
  search: "",
  selected: null,
  view: "table",
};

function isCurrentRequest(state: ExplorerState, domain: string, epoch: number): boolean {
  return state.domain === domain && state.request_epoch === epoch;
}

export function semanticExplorerReducer(
  state: ExplorerState,
  action: ExplorerAction,
): ExplorerState {
  switch (action.type) {
    case "request-started":
      return {
        ...state,
        category: state.domain === action.domain ? state.category : null,
        domain: action.domain,
        highest_pointer_generation: state.observed_pointer_generations[action.domain] ?? 0,
        request_epoch: action.request_epoch,
        refreshing: true,
        server:
          state.domain === action.domain && state.server.kind !== "loading"
            ? state.server
            : { kind: "loading" },
        selected: state.domain === action.domain ? state.selected : null,
      };
    case "request-succeeded": {
      if (!isCurrentRequest(state, action.domain, action.request_epoch)) return state;
      if (
        action.snapshot.pointer_observation.pointer_generation < state.highest_pointer_generation
      ) {
        return { ...state, refreshing: false };
      }
      return {
        ...state,
        highest_pointer_generation: Math.max(
          state.highest_pointer_generation,
          action.snapshot.pointer_observation.pointer_generation,
        ),
        observed_pointer_generations: {
          ...state.observed_pointer_generations,
          [action.domain]: Math.max(
            state.highest_pointer_generation,
            action.snapshot.pointer_observation.pointer_generation,
          ),
        },
        refreshing: false,
        server:
          action.snapshot.objects.length === 0
            ? { kind: "empty", snapshot: action.snapshot }
            : { kind: "success", snapshot: action.snapshot },
        selected: action.snapshot.objects[0]?.identity ?? null,
      };
    }
    case "request-failed":
      if (!isCurrentRequest(state, action.domain, action.request_epoch)) return state;
      return {
        ...state,
        refreshing: false,
        server: action.permission_denied
          ? { kind: "permission-denied" }
          : { kind: "error", code: action.code, message: action.message },
      };
    case "search-changed":
      return { ...state, search: action.search };
    case "selection-changed":
      return { ...state, selected: action.selected };
    case "category-changed":
      return { ...state, category: action.category, selected: null };
    case "view-changed":
      return { ...state, view: action.view };
  }
}
