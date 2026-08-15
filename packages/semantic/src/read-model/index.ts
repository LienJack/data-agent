import {
  SEMANTIC_GRAPH_READ_VERSION,
  type SemanticEdgeFamily,
  type SemanticGraphCluster,
  type SemanticGraphEntryStatus,
  type SemanticGraphFullQuery,
  type SemanticGraphFullResult,
  type SemanticGraphImpactResult,
  type SemanticGraphNeighborhoodQuery,
  type SemanticGraphNeighborhoodResult,
  type SemanticGraphNode,
  type SemanticGraphNodeListQuery,
  type SemanticGraphNodeListResult,
  type SemanticGraphPathQuery,
  type SemanticGraphPathResult,
  type SemanticGraphProjection,
  type SemanticGraphReadEdge,
  type SemanticGraphReadIdentity,
  type SemanticGraphReadNode,
  semanticGraphFullQuerySchema,
  semanticGraphFullResultSchema,
  semanticGraphImpactResultSchema,
  semanticGraphNeighborhoodQuerySchema,
  semanticGraphNeighborhoodResultSchema,
  semanticGraphNodeListQuerySchema,
  semanticGraphNodeListResultSchema,
  semanticGraphPathQuerySchema,
  semanticGraphPathResultSchema,
  semanticGraphProjectionSchema,
  semanticGraphSourceSchema,
  sha256ContentHash,
} from "@data-agent/contracts";

const EDGE_FAMILIES = [
  "BUSINESS",
  "ANALYTICAL",
  "FORMULA",
  "PHYSICAL",
  "JOIN",
  "PROVENANCE",
] as const satisfies readonly SemanticEdgeFamily[];

const NODE_TYPES = [
  "BUSINESS_SUBJECT",
  "DIMENSION",
  "METRIC",
  "FORMULA",
  "PHYSICAL_TABLE",
  "PHYSICAL_COLUMN",
] as const;

interface ClusterMembership {
  readonly cluster_id: string;
  readonly label: string;
  readonly kind: SemanticGraphCluster["kind"];
}

interface InternalSnapshot {
  readonly identity: SemanticGraphReadIdentity;
  readonly nodes: readonly SemanticGraphReadNode[];
  readonly edges: readonly SemanticGraphReadEdge[];
  readonly node_by_id: ReadonlyMap<string, SemanticGraphReadNode>;
  readonly edge_by_id: ReadonlyMap<string, SemanticGraphReadEdge>;
  readonly incident_edges: ReadonlyMap<string, readonly SemanticGraphReadEdge[]>;
  readonly cluster_by_node_id: ReadonlyMap<string, ClusterMembership>;
  readonly clusters: readonly SemanticGraphCluster[];
  readonly hierarchy_digest: `sha256:${string}`;
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

export interface SemanticGraphReadModel {
  readonly identity: SemanticGraphReadIdentity;
  getNode(nodeId: string): SemanticGraphReadNode | null;
  getEdge(edgeId: string): SemanticGraphReadEdge | null;
  listNodes(query?: Partial<SemanticGraphNodeListQuery>): SemanticGraphNodeListResult;
  neighborhood(query: SemanticGraphNeighborhoodQuery): SemanticGraphNeighborhoodResult;
  shortestPath(query: SemanticGraphPathQuery): SemanticGraphPathResult;
  impact(rootNodeId: string, limit?: number): SemanticGraphImpactResult;
  fullGraph(query?: Partial<SemanticGraphFullQuery>): SemanticGraphFullResult;
}

function stableString(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableString).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableString(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameEntry(left: unknown, right: unknown): boolean {
  return stableString(left) === stableString(right);
}

function entryStatus<T extends { readonly lifecycle: string }>(
  published: T | undefined,
  candidate: T | undefined,
): SemanticGraphEntryStatus {
  if (published === undefined) {
    return "ADDED";
  }
  if (
    candidate === undefined ||
    (candidate.lifecycle === "RETIRED" && published.lifecycle !== "RETIRED")
  ) {
    return "RETIRED";
  }
  return sameEntry(published, candidate) ? "PUBLISHED" : "MODIFIED";
}

function overlayEntries<T extends { readonly lifecycle: string }>(
  published: readonly T[],
  candidate: readonly T[] | null,
  idOf: (entry: T) => string,
): readonly { readonly entry: T; readonly status: SemanticGraphEntryStatus }[] {
  if (candidate === null) {
    return published.map((entry) => ({ entry, status: "PUBLISHED" as const }));
  }
  const publishedById = new Map(published.map((entry) => [idOf(entry), entry]));
  const candidateById = new Map(candidate.map((entry) => [idOf(entry), entry]));
  const ids = [...new Set([...publishedById.keys(), ...candidateById.keys()])].sort();
  return ids.map((id) => {
    const publishedEntry = publishedById.get(id);
    const candidateEntry = candidateById.get(id);
    return {
      entry: candidateEntry ?? required(publishedEntry, `SEMANTIC_GRAPH_ENTRY_NOT_FOUND:${id}`),
      status: entryStatus(publishedEntry, candidateEntry),
    };
  });
}

function emptyFamilyCounts(): Record<SemanticEdgeFamily, number> {
  return {
    BUSINESS: 0,
    ANALYTICAL: 0,
    FORMULA: 0,
    PHYSICAL: 0,
    JOIN: 0,
    PROVENANCE: 0,
  };
}

function emptyNodeTypeCounts(): Record<SemanticGraphNode["node_type"], number> {
  return {
    BUSINESS_SUBJECT: 0,
    DIMENSION: 0,
    METRIC: 0,
    FORMULA: 0,
    PHYSICAL_TABLE: 0,
    PHYSICAL_COLUMN: 0,
  };
}

function hash32(value: string): number {
  let result = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16_777_619);
  }
  return result >>> 0;
}

function clusterPosition(clusterId: string): { readonly x: number; readonly y: number } {
  const angle = ((hash32(clusterId) % 3_600) / 3_600) * Math.PI * 2;
  const radius = 0.54 + (hash32(`${clusterId}:radius`) % 360) / 1_000;
  return {
    x: Number((Math.cos(angle) * radius).toFixed(6)),
    y: Number((Math.sin(angle) * radius).toFixed(6)),
  };
}

function clusterIdentity(kind: ClusterMembership["kind"], label: string): ClusterMembership {
  return {
    cluster_id: `cluster:${kind.toLowerCase()}:${hash32(`${kind}:${label}`).toString(16)}`,
    label,
    kind,
  };
}

function buildClusterMembership(
  nodes: readonly SemanticGraphReadNode[],
  edges: readonly SemanticGraphReadEdge[],
): ReadonlyMap<string, ClusterMembership> {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.node.node_id, []);
  for (const { edge } of edges) {
    adjacency.get(edge.source_node_id)?.push(edge.target_node_id);
    adjacency.get(edge.target_node_id)?.push(edge.source_node_id);
  }
  for (const neighbors of adjacency.values()) neighbors.sort();

  const result = new Map<string, ClusterMembership>();
  const queue: string[] = [];
  for (const { node } of [...nodes].sort((left, right) =>
    left.node.node_id.localeCompare(right.node.node_id),
  )) {
    if (node.node_type === "BUSINESS_SUBJECT") {
      result.set(node.node_id, clusterIdentity("DOMAIN", node.domain));
      queue.push(node.node_id);
    }
  }

  for (let index = 0; index < queue.length; index += 1) {
    const currentId = required(queue[index], "SEMANTIC_GRAPH_CLUSTER_QUEUE_INVALID");
    const membership = required(
      result.get(currentId),
      `SEMANTIC_GRAPH_CLUSTER_MEMBERSHIP_NOT_FOUND:${currentId}`,
    );
    for (const neighborId of adjacency.get(currentId) ?? []) {
      if (!result.has(neighborId)) {
        result.set(neighborId, membership);
        queue.push(neighborId);
      }
    }
  }

  for (const { node } of nodes) {
    if (result.has(node.node_id)) continue;
    if (node.node_type === "PHYSICAL_TABLE" || node.node_type === "PHYSICAL_COLUMN") {
      result.set(node.node_id, clusterIdentity("PHYSICAL_SCHEMA", node.schema_name));
    } else {
      result.set(node.node_id, clusterIdentity("UNASSIGNED", "未归属"));
    }
  }
  return result;
}

function buildClusters(
  nodes: readonly SemanticGraphReadNode[],
  edges: readonly SemanticGraphReadEdge[],
  membershipByNodeId: ReadonlyMap<string, ClusterMembership>,
): readonly SemanticGraphCluster[] {
  const grouped = new Map<
    string,
    {
      membership: ClusterMembership;
      nodes: SemanticGraphReadNode[];
      internalEdgeCount: number;
    }
  >();
  for (const node of nodes) {
    const membership = required(
      membershipByNodeId.get(node.node.node_id),
      `SEMANTIC_GRAPH_CLUSTER_MEMBERSHIP_NOT_FOUND:${node.node.node_id}`,
    );
    const group = grouped.get(membership.cluster_id) ?? {
      membership,
      nodes: [],
      internalEdgeCount: 0,
    };
    group.nodes.push(node);
    grouped.set(membership.cluster_id, group);
  }
  for (const { edge } of edges) {
    const source = membershipByNodeId.get(edge.source_node_id)?.cluster_id;
    const target = membershipByNodeId.get(edge.target_node_id)?.cluster_id;
    if (source !== undefined && source === target) {
      const group = grouped.get(source);
      if (group !== undefined) group.internalEdgeCount += 1;
    }
  }
  return [...grouped.values()]
    .map(({ membership, nodes: clusterNodes, internalEdgeCount }) => {
      const nodeTypeCounts = emptyNodeTypeCounts();
      for (const { node } of clusterNodes) {
        nodeTypeCounts[node.node_type] = (nodeTypeCounts[node.node_type] ?? 0) + 1;
      }
      return {
        cluster_id: membership.cluster_id,
        label: membership.label,
        kind: membership.kind,
        node_count: clusterNodes.length,
        edge_count: internalEdgeCount,
        candidate_count: clusterNodes.filter((node) => node.status !== "PUBLISHED").length,
        node_type_counts: nodeTypeCounts,
        top_hub_node_ids: [...clusterNodes]
          .sort(
            (left, right) =>
              right.relation_count.total - left.relation_count.total ||
              left.node.node_id.localeCompare(right.node.node_id),
          )
          .slice(0, 8)
          .map(({ node }) => node.node_id),
        position: clusterPosition(membership.cluster_id),
      };
    })
    .sort(
      (left, right) =>
        left.label.localeCompare(right.label) || left.cluster_id.localeCompare(right.cluster_id),
    );
}

function edgeAllowed(
  edge: SemanticGraphReadEdge,
  families: readonly SemanticEdgeFamily[],
): boolean {
  return families.length === 0 || families.includes(edge.edge.family);
}

function buildIncidentEdges(
  nodes: readonly SemanticGraphReadNode[],
  edges: readonly SemanticGraphReadEdge[],
): ReadonlyMap<string, readonly SemanticGraphReadEdge[]> {
  const result = new Map<string, SemanticGraphReadEdge[]>();
  for (const { node } of nodes) result.set(node.node_id, []);
  for (const edge of edges) {
    result.get(edge.edge.source_node_id)?.push(edge);
    result.get(edge.edge.target_node_id)?.push(edge);
  }
  for (const items of result.values()) {
    items.sort((left, right) => left.edge.edge_id.localeCompare(right.edge.edge_id));
  }
  return result;
}

function domainFor(snapshot: InternalSnapshot, nodeId: string): string {
  return snapshot.cluster_by_node_id.get(nodeId)?.label ?? "未归属";
}

function traverseNeighborhood(
  snapshot: InternalSnapshot,
  query: SemanticGraphNeighborhoodQuery,
): { readonly node_ids: readonly string[]; readonly edge_ids: readonly string[] } {
  if (!snapshot.node_by_id.has(query.center_node_id)) return { node_ids: [], edge_ids: [] };
  const visited = new Set([query.center_node_id]);
  const ordered = [query.center_node_id];
  const edgeIds = new Set<string>();
  let frontier = [query.center_node_id];
  for (let hop = 0; hop < query.hops; hop += 1) {
    const next = new Set<string>();
    for (const nodeId of frontier) {
      for (const item of snapshot.incident_edges.get(nodeId) ?? []) {
        const { edge } = item;
        if (!edgeAllowed(item, query.families)) continue;
        const outgoing = edge.source_node_id === nodeId;
        if (query.direction === "OUTGOING" && !outgoing) continue;
        if (query.direction === "INCOMING" && outgoing) continue;
        const neighborId = outgoing ? edge.target_node_id : edge.source_node_id;
        edgeIds.add(edge.edge_id);
        if (!visited.has(neighborId)) next.add(neighborId);
      }
    }
    const nextSorted = [...next].sort();
    for (const nodeId of nextSorted) {
      visited.add(nodeId);
      ordered.push(nodeId);
    }
    frontier = nextSorted;
  }
  return { node_ids: ordered, edge_ids: [...edgeIds].sort() };
}

function createModel(snapshot: InternalSnapshot): SemanticGraphReadModel {
  return {
    identity: snapshot.identity,

    getNode(nodeId) {
      return snapshot.node_by_id.get(nodeId) ?? null;
    },

    getEdge(edgeId) {
      return snapshot.edge_by_id.get(edgeId) ?? null;
    },

    listNodes(input = {}) {
      const query = semanticGraphNodeListQuerySchema.parse(input);
      const search = query.search.trim().toLocaleLowerCase();
      const filtered = snapshot.nodes.filter((item) => {
        const { node } = item;
        return (
          (search.length === 0 ||
            [node.node_id, node.name, node.description ?? "", ...node.aliases]
              .join(" ")
              .toLocaleLowerCase()
              .includes(search)) &&
          (query.node_types.length === 0 || query.node_types.includes(node.node_type)) &&
          (query.owners.length === 0 || query.owners.includes(node.owner_ref)) &&
          (query.lifecycles.length === 0 || query.lifecycles.includes(node.lifecycle)) &&
          (query.statuses.length === 0 || query.statuses.includes(item.status)) &&
          (query.domains.length === 0 || query.domains.includes(domainFor(snapshot, node.node_id)))
        );
      });
      filtered.sort((left, right) => {
        switch (query.sort) {
          case "NAME_DESC":
            return (
              right.node.name.localeCompare(left.node.name) ||
              right.node.node_id.localeCompare(left.node.node_id)
            );
          case "TYPE_ASC":
            return (
              left.node.node_type.localeCompare(right.node.node_type) ||
              left.node.name.localeCompare(right.node.name)
            );
          case "RELATIONS_DESC":
            return (
              right.relation_count.total - left.relation_count.total ||
              left.node.name.localeCompare(right.node.name)
            );
          default:
            return (
              left.node.name.localeCompare(right.node.name) ||
              left.node.node_id.localeCompare(right.node.node_id)
            );
        }
      });
      const items = filtered.slice(query.cursor, query.cursor + query.limit);
      const nextCursor =
        query.cursor + items.length < filtered.length ? query.cursor + items.length : null;
      return semanticGraphNodeListResultSchema.parse({
        identity: snapshot.identity,
        items,
        total: filtered.length,
        next_cursor: nextCursor,
        domains: [
          ...new Set(snapshot.nodes.map(({ node }) => domainFor(snapshot, node.node_id))),
        ].sort(),
      });
    },

    neighborhood(input) {
      const query = semanticGraphNeighborhoodQuerySchema.parse(input);
      const traversed = traverseNeighborhood(snapshot, query);
      if (traversed.node_ids.length === 0) {
        throw new Error(`SEMANTIC_GRAPH_NODE_NOT_FOUND:${query.center_node_id}`);
      }
      const remaining = traversed.node_ids.slice(1);
      const pageNodeIds = [
        query.center_node_id,
        ...remaining.slice(
          query.continuation,
          query.continuation + Math.max(0, query.node_limit - 1),
        ),
      ];
      const pageSet = new Set(pageNodeIds);
      const eligibleEdges = traversed.edge_ids
        .map((id) => snapshot.edge_by_id.get(id))
        .filter((item): item is SemanticGraphReadEdge => item !== undefined)
        .filter(({ edge }) => pageSet.has(edge.source_node_id) && pageSet.has(edge.target_node_id));
      const edges = eligibleEdges.slice(0, query.edge_limit);
      const nextOffset = query.continuation + pageNodeIds.length - 1;
      const nextContinuation = nextOffset < remaining.length ? nextOffset : null;
      const omittedNodeCount = Math.max(0, remaining.length - (pageNodeIds.length - 1));
      const omittedEdgeCount = Math.max(0, traversed.edge_ids.length - edges.length);
      return semanticGraphNeighborhoodResultSchema.parse({
        identity: snapshot.identity,
        center_node_id: query.center_node_id,
        nodes: pageNodeIds.map((id) =>
          required(snapshot.node_by_id.get(id), `SEMANTIC_GRAPH_NODE_NOT_FOUND:${id}`),
        ),
        edges,
        truncated: omittedNodeCount > 0 || omittedEdgeCount > 0,
        omitted_node_count: omittedNodeCount,
        omitted_edge_count: omittedEdgeCount,
        next_continuation: nextContinuation,
      });
    },

    shortestPath(input) {
      const query = semanticGraphPathQuerySchema.parse(input);
      if (
        !snapshot.node_by_id.has(query.source_node_id) ||
        !snapshot.node_by_id.has(query.target_node_id)
      ) {
        return semanticGraphPathResultSchema.parse({
          identity: snapshot.identity,
          found: false,
          nodes: [],
          edges: [],
        });
      }
      const queue: { node_id: string; hops: number }[] = [
        { node_id: query.source_node_id, hops: 0 },
      ];
      const visited = new Set([query.source_node_id]);
      const previous = new Map<string, { node_id: string; edge_id: string }>();
      for (let index = 0; index < queue.length; index += 1) {
        const current = required(queue[index], "SEMANTIC_GRAPH_PATH_QUEUE_INVALID");
        if (current.node_id === query.target_node_id) break;
        if (current.hops >= query.max_hops) continue;
        for (const item of snapshot.incident_edges.get(current.node_id) ?? []) {
          if (!edgeAllowed(item, query.families)) continue;
          const nextId =
            item.edge.source_node_id === current.node_id
              ? item.edge.target_node_id
              : item.edge.source_node_id;
          if (visited.has(nextId)) continue;
          visited.add(nextId);
          previous.set(nextId, { node_id: current.node_id, edge_id: item.edge.edge_id });
          queue.push({ node_id: nextId, hops: current.hops + 1 });
        }
      }
      if (!visited.has(query.target_node_id)) {
        return semanticGraphPathResultSchema.parse({
          identity: snapshot.identity,
          found: false,
          nodes: [],
          edges: [],
        });
      }
      const nodeIds = [query.target_node_id];
      const edgeIds: string[] = [];
      while (nodeIds[0] !== query.source_node_id) {
        const currentNodeId = required(nodeIds[0], "SEMANTIC_GRAPH_PATH_INVALID");
        const step = previous.get(currentNodeId);
        if (step === undefined) break;
        nodeIds.unshift(step.node_id);
        edgeIds.unshift(step.edge_id);
      }
      return semanticGraphPathResultSchema.parse({
        identity: snapshot.identity,
        found: true,
        nodes: nodeIds.map((id) =>
          required(snapshot.node_by_id.get(id), `SEMANTIC_GRAPH_NODE_NOT_FOUND:${id}`),
        ),
        edges: edgeIds.map((id) =>
          required(snapshot.edge_by_id.get(id), `SEMANTIC_GRAPH_EDGE_NOT_FOUND:${id}`),
        ),
      });
    },

    impact(rootNodeId, limit = 250) {
      if (!snapshot.node_by_id.has(rootNodeId))
        throw new Error(`SEMANTIC_GRAPH_NODE_NOT_FOUND:${rootNodeId}`);
      const boundedLimit = Math.max(1, Math.min(250, Math.trunc(limit)));
      const queue = [rootNodeId];
      const visited = new Set(queue);
      const edgeIds = new Set<string>();
      for (let index = 0; index < queue.length && queue.length < boundedLimit; index += 1) {
        const current = required(queue[index], "SEMANTIC_GRAPH_IMPACT_QUEUE_INVALID");
        for (const item of snapshot.incident_edges.get(current) ?? []) {
          if (item.edge.target_node_id !== current) continue;
          edgeIds.add(item.edge.edge_id);
          if (!visited.has(item.edge.source_node_id)) {
            visited.add(item.edge.source_node_id);
            queue.push(item.edge.source_node_id);
            if (queue.length >= boundedLimit) break;
          }
        }
      }
      const included = new Set(queue);
      return semanticGraphImpactResultSchema.parse({
        identity: snapshot.identity,
        root_node_id: rootNodeId,
        nodes: queue.map((id) =>
          required(snapshot.node_by_id.get(id), `SEMANTIC_GRAPH_NODE_NOT_FOUND:${id}`),
        ),
        edges: [...edgeIds]
          .sort()
          .map((id) => required(snapshot.edge_by_id.get(id), `SEMANTIC_GRAPH_EDGE_NOT_FOUND:${id}`))
          .filter(
            ({ edge }) => included.has(edge.source_node_id) && included.has(edge.target_node_id),
          ),
        truncated: queue.length >= boundedLimit,
      });
    },

    fullGraph(input = {}) {
      const query = semanticGraphFullQuerySchema.parse(input);
      const visibleNodes = snapshot.nodes.filter(
        (item) =>
          (query.node_types.length === 0 || query.node_types.includes(item.node.node_type)) &&
          (query.statuses.length === 0 || query.statuses.includes(item.status)),
      );
      const visibleNodeIds = new Set(visibleNodes.map(({ node }) => node.node_id));
      const visibleEdges = snapshot.edges.filter(
        (item) =>
          edgeAllowed(item, query.families) &&
          visibleNodeIds.has(item.edge.source_node_id) &&
          visibleNodeIds.has(item.edge.target_node_id),
      );
      const expanded = new Set(query.expanded_cluster_ids);
      const selectedNodes: SemanticGraphReadNode[] = [];
      const selectedClusters: SemanticGraphCluster[] = [];
      let glyphCount = 0;
      let totalGlyphCount = 0;
      for (const cluster of snapshot.clusters) {
        const clusterNodes = visibleNodes.filter(
          ({ node }) =>
            snapshot.cluster_by_node_id.get(node.node_id)?.cluster_id === cluster.cluster_id,
        );
        if (clusterNodes.length === 0) continue;
        if (expanded.has(cluster.cluster_id)) {
          totalGlyphCount += clusterNodes.length;
          const room = Math.max(0, query.glyph_limit - glyphCount);
          selectedNodes.push(...clusterNodes.slice(0, room));
          glyphCount += Math.min(room, clusterNodes.length);
        } else {
          totalGlyphCount += 1;
          if (glyphCount < query.glyph_limit) {
            const nodeTypeCounts = emptyNodeTypeCounts();
            for (const { node } of clusterNodes) {
              nodeTypeCounts[node.node_type] = (nodeTypeCounts[node.node_type] ?? 0) + 1;
            }
            selectedClusters.push({
              ...cluster,
              node_count: clusterNodes.length,
              candidate_count: clusterNodes.filter((item) => item.status !== "PUBLISHED").length,
              node_type_counts: nodeTypeCounts,
            });
            glyphCount += 1;
          }
        }
      }
      const selectedNodeIds = new Set(selectedNodes.map(({ node }) => node.node_id));
      const selectedEdges = visibleEdges.filter(
        ({ edge }) =>
          selectedNodeIds.has(edge.source_node_id) && selectedNodeIds.has(edge.target_node_id),
      );
      return semanticGraphFullResultSchema.parse({
        identity: snapshot.identity,
        hierarchy_digest: snapshot.hierarchy_digest,
        clusters: selectedClusters,
        nodes: selectedNodes,
        edges: selectedEdges,
        glyph_count: glyphCount,
        truncated: totalGlyphCount > glyphCount,
        omitted_glyph_count: Math.max(0, totalGlyphCount - glyphCount),
      });
    },
  };
}

export async function createSemanticGraphReadModel(
  publishedInput: unknown,
  candidateInput: unknown | null = null,
): Promise<SemanticGraphReadModel> {
  const published = semanticGraphProjectionSchema.parse(publishedInput);
  const candidate =
    candidateInput === null ? null : semanticGraphProjectionSchema.parse(candidateInput);
  if (candidate !== null && candidate.graph_id !== published.graph_id) {
    throw new Error("SEMANTIC_GRAPH_OVERLAY_GRAPH_ID_MISMATCH");
  }
  const nodeOverlay = overlayEntries(
    published.nodes,
    candidate?.nodes ?? null,
    (node) => node.node_id,
  );
  const edgeOverlay = overlayEntries(
    published.edges,
    candidate?.edges ?? null,
    (edge) => edge.edge_id,
  );
  const edgesWithoutCounts: SemanticGraphReadEdge[] = edgeOverlay.map(({ entry, status }) => ({
    edge: entry,
    status,
  }));
  const relationCounts = new Map<
    string,
    {
      incoming: number;
      outgoing: number;
      total: number;
      by_family: Record<SemanticEdgeFamily, number>;
    }
  >();
  for (const { entry } of nodeOverlay) {
    relationCounts.set(entry.node_id, {
      incoming: 0,
      outgoing: 0,
      total: 0,
      by_family: emptyFamilyCounts(),
    });
  }
  for (const { edge } of edgesWithoutCounts) {
    const source = relationCounts.get(edge.source_node_id);
    const target = relationCounts.get(edge.target_node_id);
    if (source !== undefined) {
      source.outgoing += 1;
      source.total += 1;
      source.by_family[edge.family] = (source.by_family[edge.family] ?? 0) + 1;
    }
    if (target !== undefined) {
      target.incoming += 1;
      target.total += 1;
      target.by_family[edge.family] = (target.by_family[edge.family] ?? 0) + 1;
    }
  }
  const nodes: SemanticGraphReadNode[] = nodeOverlay.map(({ entry, status }) => ({
    node: entry,
    status,
    relation_count: required(
      relationCounts.get(entry.node_id),
      `SEMANTIC_GRAPH_RELATION_COUNT_NOT_FOUND:${entry.node_id}`,
    ),
  }));
  const nodeById = new Map(nodes.map((item) => [item.node.node_id, item]));
  const edges = edgesWithoutCounts.filter(
    ({ edge }) => nodeById.has(edge.source_node_id) && nodeById.has(edge.target_node_id),
  );
  const clusterByNodeId = buildClusterMembership(nodes, edges);
  const clusters = buildClusters(nodes, edges, clusterByNodeId);
  const candidateSourceDigest = candidate?.source_digest ?? null;
  const identity: SemanticGraphReadIdentity = {
    read_version: SEMANTIC_GRAPH_READ_VERSION,
    graph_id: published.graph_id,
    published_source_digest: published.source_digest,
    candidate_source_digest: candidateSourceDigest,
    consistency_token: await sha256ContentHash({
      graph_id: published.graph_id,
      published_source_digest: published.source_digest,
      candidate_source_digest: candidateSourceDigest,
    }),
  };
  const hierarchyDigest = await sha256ContentHash(
    clusters.map(({ cluster_id, kind, label, node_count, edge_count, top_hub_node_ids }) => ({
      cluster_id,
      kind,
      label,
      node_count,
      edge_count,
      top_hub_node_ids,
    })),
  );
  return createModel({
    identity,
    nodes,
    edges,
    node_by_id: nodeById,
    edge_by_id: new Map(edges.map((item) => [item.edge.edge_id, item])),
    incident_edges: buildIncidentEdges(nodes, edges),
    cluster_by_node_id: clusterByNodeId,
    clusters,
    hierarchy_digest: hierarchyDigest,
  });
}

/**
 * Builds a non-authoritative projection for list/graph rendering. Unlike the runtime compiler this
 * intentionally accepts a structurally valid candidate that still has deterministic validation
 * issues, so the UI can show the incomplete graph and its errors before review.
 */
export async function projectSemanticGraphSourceForRead(
  input: unknown,
): Promise<SemanticGraphProjection> {
  const source = semanticGraphSourceSchema.parse(input);
  return semanticGraphProjectionSchema.parse({
    projection_version: "semantic-graph-projection@1",
    graph_id: source.metadata.graph_id,
    source_digest: await sha256ContentHash(source),
    registry_digest: await sha256ContentHash({
      node_type_registry: source.node_type_registry,
      edge_type_registry: source.edge_type_registry,
    }),
    compiler_version: "semantic-graph-read-projection@1",
    node_count: source.nodes.length,
    edge_count: source.edges.length,
    nodes: source.nodes,
    edges: source.edges,
  });
}

export {
  EDGE_FAMILIES as SEMANTIC_GRAPH_READ_EDGE_FAMILIES,
  NODE_TYPES as SEMANTIC_GRAPH_READ_NODE_TYPES,
};
