import type {
  SemanticExplorerEdge,
  SemanticExplorerObject,
  SemanticExplorerObjectIdentity,
  SemanticExplorerSnapshot,
} from "@data-agent/contracts";

const MAX_GRAPH_NODES = 250;
const MAX_GRAPH_EDGES = 500;

function key(identity: SemanticExplorerObjectIdentity): string {
  return JSON.stringify([identity.kind, identity.object_id]);
}

export interface BoundedExplorerGraph {
  readonly nodes: readonly SemanticExplorerObject[];
  readonly edges: readonly SemanticExplorerEdge[];
  readonly truncated: boolean;
}

export function deriveBoundedExplorerGraph(
  snapshot: SemanticExplorerSnapshot,
  selected: SemanticExplorerObjectIdentity | null,
): BoundedExplorerGraph {
  if (!selected) return { nodes: [], edges: [], truncated: false };
  const objectIndex = new Map(snapshot.objects.map((object) => [key(object.identity), object]));
  const selectedKey = key(selected);
  if (!objectIndex.has(selectedKey)) return { nodes: [], edges: [], truncated: false };

  const adjacency = new Map<string, SemanticExplorerEdge[]>();
  for (const edge of snapshot.edges) {
    const source = key(edge.source);
    const target = key(edge.target);
    if (!objectIndex.has(source) || !objectIndex.has(target)) continue;
    const sourceEdges = adjacency.get(source) ?? [];
    sourceEdges.push(edge);
    adjacency.set(source, sourceEdges);
    if (target !== source) {
      const targetEdges = adjacency.get(target) ?? [];
      targetEdges.push(edge);
      adjacency.set(target, targetEdges);
    }
  }

  const included = new Set<string>([selectedKey]);
  const queue = [selectedKey];
  let truncated = false;
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    for (const edge of adjacency.get(current) ?? []) {
      const source = key(edge.source);
      const target = key(edge.target);
      const neighbor = source === current ? target : source;
      if (included.has(neighbor)) continue;
      if (included.size >= MAX_GRAPH_NODES) {
        truncated = true;
        continue;
      }
      included.add(neighbor);
      queue.push(neighbor);
    }
  }

  const edges = snapshot.edges.filter(
    (edge) => included.has(key(edge.source)) && included.has(key(edge.target)),
  );
  if (edges.length > MAX_GRAPH_EDGES) truncated = true;
  return {
    nodes: [...included]
      .map((identityKey) => objectIndex.get(identityKey))
      .filter((object): object is SemanticExplorerObject => object !== undefined),
    edges: edges.slice(0, MAX_GRAPH_EDGES),
    truncated,
  };
}
