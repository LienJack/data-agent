import {
  deepFreeze,
  type SemanticGraphSource,
  semanticGraphSourceSchema,
  sha256ContentHash,
} from "@data-agent/contracts";

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareStable);
}

export function canonicalizeSemanticGraph(input: unknown): SemanticGraphSource {
  const graph = semanticGraphSourceSchema.parse(input);
  return deepFreeze({
    ...graph,
    node_type_registry: [...graph.node_type_registry].sort((left, right) =>
      compareStable(left.node_type, right.node_type),
    ),
    edge_type_registry: [...graph.edge_type_registry]
      .sort((left, right) => compareStable(left.edge_type, right.edge_type))
      .map((definition) => ({
        ...definition,
        source_node_types: uniqueSorted(definition.source_node_types),
        target_node_types: uniqueSorted(definition.target_node_types),
      })),
    evidence: [...graph.evidence].sort((left, right) =>
      compareStable(left.evidence_id, right.evidence_id),
    ),
    nodes: [...graph.nodes]
      .sort((left, right) => compareStable(left.node_id, right.node_id))
      .map((node) => ({
        ...node,
        aliases: uniqueSorted(node.aliases),
        evidence_refs: uniqueSorted(node.evidence_refs),
        tags: uniqueSorted(node.tags),
      })),
    edges: [...graph.edges]
      .sort((left, right) => compareStable(left.edge_id, right.edge_id))
      .map((edge) => ({ ...edge, evidence_refs: uniqueSorted(edge.evidence_refs) })),
  });
}

export async function computeSemanticGraphDigest(input: unknown): Promise<`sha256:${string}`> {
  return sha256ContentHash(canonicalizeSemanticGraph(input));
}
