export interface ExplorerOperation {
  readonly token: number;
  readonly signal: AbortSignal;
}

export interface LatestExplorerOperationGate {
  begin(): ExplorerOperation;
  cancel(): void;
  isLatest(operation: ExplorerOperation): boolean;
  finish(operation: ExplorerOperation): boolean;
}

export function createLatestExplorerOperationGate(): LatestExplorerOperationGate {
  let token = 0;
  let controller: AbortController | null = null;

  return {
    begin() {
      controller?.abort();
      controller = new AbortController();
      token += 1;
      return { token, signal: controller.signal };
    },

    cancel() {
      token += 1;
      controller?.abort();
      controller = null;
    },

    isLatest(operation) {
      return operation.token === token && !operation.signal.aborted;
    },

    finish(operation) {
      if (operation.token !== token || operation.signal.aborted) return false;
      controller = null;
      return true;
    },
  };
}

export function timelineMatchesSnapshot(
  timeline: SemanticExplorerReleaseTimeline,
  snapshot: SemanticExplorerSnapshot,
): boolean {
  const timelinePointer = timeline.pointer_observation;
  const snapshotPointer = snapshot.pointer_observation;
  return (
    timeline.semantic_domain === snapshot.release_identity.semantic_domain &&
    timelinePointer.pointer_generation === snapshotPointer.pointer_generation &&
    timelinePointer.current_release_id === snapshotPointer.current_release_id &&
    timelinePointer.current_release_generation === snapshotPointer.current_release_generation &&
    timelinePointer.current_release_digest === snapshotPointer.current_release_digest
  );
}

import type {
  SemanticExplorerReleaseTimeline,
  SemanticExplorerSnapshot,
} from "@data-agent/contracts";
