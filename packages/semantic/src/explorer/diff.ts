import {
  deepFreeze,
  type SemanticExplorerDiff,
  type SemanticExplorerEdge,
  type SemanticExplorerObject,
  type SemanticExplorerSnapshot,
  semanticExplorerDiffSchema,
} from "@data-agent/contracts";
import { semanticExplorerIdentityKey } from "./builder.js";
import { explorerFailure } from "./errors.js";

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function edgeKey(edge: Pick<SemanticExplorerEdge, "kind" | "edge_id">): string {
  return JSON.stringify([edge.kind, edge.edge_id]);
}

export function diffSemanticExplorerSnapshots(
  base: SemanticExplorerSnapshot,
  target: SemanticExplorerSnapshot,
): SemanticExplorerDiff {
  if (base.release_identity.semantic_domain !== target.release_identity.semantic_domain) {
    explorerFailure("SEMANTIC_EXPLORER_SOURCE_BINDING_MISMATCH");
  }
  const baseObjects = new Map(
    base.objects.map((object) => [semanticExplorerIdentityKey(object.identity), object]),
  );
  const targetObjects = new Map(
    target.objects.map((object) => [semanticExplorerIdentityKey(object.identity), object]),
  );
  const baseEdges = new Map(base.edges.map((edge) => [edgeKey(edge), edge]));
  const targetEdges = new Map(target.edges.map((edge) => [edgeKey(edge), edge]));

  const addedObjects = [...targetObjects.entries()]
    .filter(([key]) => !baseObjects.has(key))
    .map(([, object]) => ({
      identity: object.identity,
      canonical_digest: object.canonical_digest,
    }));
  const removedObjects = [...baseObjects.entries()]
    .filter(([key]) => !targetObjects.has(key))
    .map(([, object]) => ({
      identity: object.identity,
      canonical_digest: object.canonical_digest,
    }));
  const changedObjects = [...targetObjects.entries()].flatMap(([key, after]) => {
    const before = baseObjects.get(key);
    return before && before.canonical_digest !== after.canonical_digest
      ? [
          {
            identity: after.identity,
            before_digest: before.canonical_digest,
            after_digest: after.canonical_digest,
          },
        ]
      : [];
  });

  const addedEdges = [...targetEdges.entries()]
    .filter(([key]) => !baseEdges.has(key))
    .map(([, edge]) => ({
      kind: edge.kind,
      edge_id: edge.edge_id,
      canonical_digest: edge.canonical_digest,
    }));
  const removedEdges = [...baseEdges.entries()]
    .filter(([key]) => !targetEdges.has(key))
    .map(([, edge]) => ({
      kind: edge.kind,
      edge_id: edge.edge_id,
      canonical_digest: edge.canonical_digest,
    }));
  const changedEdges = [...targetEdges.entries()].flatMap(([key, after]) => {
    const before = baseEdges.get(key);
    return before && before.canonical_digest !== after.canonical_digest
      ? [
          {
            kind: after.kind,
            edge_id: after.edge_id,
            before_digest: before.canonical_digest,
            after_digest: after.canonical_digest,
          },
        ]
      : [];
  });

  const sortObjects = <T extends { readonly identity: SemanticExplorerObject["identity"] }>(
    items: T[],
  ) =>
    items.sort((left, right) =>
      compareStable(
        semanticExplorerIdentityKey(left.identity),
        semanticExplorerIdentityKey(right.identity),
      ),
    );
  const sortEdges = <T extends { readonly kind: string; readonly edge_id: string }>(items: T[]) =>
    items.sort((left, right) =>
      compareStable(
        JSON.stringify([left.kind, left.edge_id]),
        JSON.stringify([right.kind, right.edge_id]),
      ),
    );

  return deepFreeze(
    semanticExplorerDiffSchema.parse({
      schema_version: "semantic-explorer-diff@1.0.0",
      base_release: base.release_identity,
      target_release: target.release_identity,
      objects: {
        added: sortObjects(addedObjects),
        removed: sortObjects(removedObjects),
        changed: sortObjects(changedObjects),
      },
      edges: {
        added: sortEdges(addedEdges),
        removed: sortEdges(removedEdges),
        changed: sortEdges(changedEdges),
      },
    }),
  );
}
