import {
  deepFreeze,
  type SemanticExplorerEdge,
  type SemanticExplorerLineage,
  type SemanticExplorerObjectIdentity,
  type SemanticExplorerSnapshot,
  semanticExplorerLineageSchema,
} from "@data-agent/contracts";
import { semanticExplorerIdentityKey } from "./builder.js";
import { explorerFailure } from "./errors.js";

const LINEAGE_NODE_LIMIT = 250;
const LINEAGE_EDGE_LIMIT = 500;

export interface SemanticExplorerLineageOptions {
  readonly direction: "upstream" | "downstream" | "both";
  readonly hop_limit: number;
}

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function edgeKey(edge: SemanticExplorerEdge): string {
  return JSON.stringify([edge.kind, edge.edge_id]);
}

function traversalsFor(
  edge: SemanticExplorerEdge,
  currentKey: string,
  direction: SemanticExplorerLineageOptions["direction"],
): readonly SemanticExplorerObjectIdentity[] {
  const sourceKey = semanticExplorerIdentityKey(edge.source);
  const targetKey = semanticExplorerIdentityKey(edge.target);
  const neighbors: SemanticExplorerObjectIdentity[] = [];
  if ((direction === "upstream" || direction === "both") && sourceKey === currentKey) {
    neighbors.push(edge.target);
  }
  if ((direction === "downstream" || direction === "both") && targetKey === currentKey) {
    neighbors.push(edge.source);
  }
  return neighbors;
}

function hasDirectedCycle(
  nodeKeys: ReadonlySet<string>,
  edges: readonly SemanticExplorerEdge[],
): boolean {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const source = semanticExplorerIdentityKey(edge.source);
    const target = semanticExplorerIdentityKey(edge.target);
    if (!nodeKeys.has(source) || !nodeKeys.has(target)) continue;
    const targets = adjacency.get(source) ?? [];
    targets.push(target);
    adjacency.set(source, targets);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const target of adjacency.get(node) ?? []) {
      if (visit(target)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  return [...nodeKeys].some((node) => visit(node));
}

export function buildSemanticExplorerLineage(
  snapshot: SemanticExplorerSnapshot,
  root: SemanticExplorerObjectIdentity,
  options: SemanticExplorerLineageOptions,
): SemanticExplorerLineage {
  if (!Number.isInteger(options.hop_limit) || options.hop_limit < 1 || options.hop_limit > 6) {
    explorerFailure("SEMANTIC_EXPLORER_LINEAGE_LIMIT_INVALID");
  }

  const objectIndex = new Map(
    snapshot.objects.map((object) => [semanticExplorerIdentityKey(object.identity), object]),
  );
  const rootKey = semanticExplorerIdentityKey(root);
  if (!objectIndex.has(rootKey)) {
    explorerFailure("SEMANTIC_EXPLORER_OBJECT_NOT_VISIBLE");
  }

  const visited = new Set<string>([rootKey]);
  const selectedEdges = new Map<string, SemanticExplorerEdge>();
  const queue: Array<{
    readonly identity: SemanticExplorerObjectIdentity;
    readonly depth: number;
  }> = [{ identity: root, depth: 0 }];
  const truncationReasons = new Set<"HOP_LIMIT" | "NODE_LIMIT" | "EDGE_LIMIT">();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const currentKey = semanticExplorerIdentityKey(current.identity);
    for (const edge of snapshot.edges) {
      const neighbors = traversalsFor(edge, currentKey, options.direction);
      for (const neighbor of neighbors) {
        const neighborKey = semanticExplorerIdentityKey(neighbor);
        if (current.depth >= options.hop_limit) {
          if (!visited.has(neighborKey)) truncationReasons.add("HOP_LIMIT");
          continue;
        }
        const neighborAlreadyVisited = visited.has(neighborKey);
        if (!neighborAlreadyVisited && visited.size >= LINEAGE_NODE_LIMIT) {
          truncationReasons.add("NODE_LIMIT");
          continue;
        }
        if (!selectedEdges.has(edgeKey(edge))) {
          if (selectedEdges.size >= LINEAGE_EDGE_LIMIT) {
            truncationReasons.add("EDGE_LIMIT");
            continue;
          }
          selectedEdges.set(edgeKey(edge), edge);
        }
        if (!neighborAlreadyVisited) {
          visited.add(neighborKey);
          queue.push({ identity: neighbor, depth: current.depth + 1 });
        }
      }
    }
  }

  const nodes = [...visited]
    .map((key) => objectIndex.get(key))
    .filter((object): object is NonNullable<typeof object> => object !== undefined)
    .sort((left, right) =>
      compareStable(
        semanticExplorerIdentityKey(left.identity),
        semanticExplorerIdentityKey(right.identity),
      ),
    );
  const edges = [...selectedEdges.values()].sort((left, right) =>
    compareStable(edgeKey(left), edgeKey(right)),
  );

  return deepFreeze(
    semanticExplorerLineageSchema.parse({
      schema_version: "semantic-explorer-lineage@1.0.0",
      release_identity: snapshot.release_identity,
      root,
      direction: options.direction,
      hop_limit: options.hop_limit,
      nodes,
      edges,
      cycles_detected: hasDirectedCycle(visited, edges),
      truncated: truncationReasons.size > 0,
      truncation_reasons: [...truncationReasons].sort(compareStable),
    }),
  );
}
