import {
  type AppScope,
  computeSemanticRelationshipGraphManifestDigest,
  type SemanticExplorerEdge,
  type SemanticExplorerObject,
  type SemanticExplorerObjectIdentity,
  type SemanticExplorerSnapshot,
  type SemanticRelationshipEdgeCategory,
  type SemanticRelationshipGraphEdge,
  type SemanticRelationshipGraphManifest,
  type SemanticRelationshipGraphNode,
  type SemanticRelationshipIndexReasonCode,
  type SemanticRelationshipIndexState,
  type SemanticRelationshipSearchRequest,
  type SemanticRelationshipSearchResult,
  semanticRelationshipGraphManifestMaterialSchema,
  semanticRelationshipGraphManifestSchema,
  semanticRelationshipSearchRequestSchema,
  semanticRelationshipSearchResultSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { SemanticRelationshipIndexKernelError } from "./errors.js";

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function identityKey(identity: SemanticExplorerObjectIdentity): string {
  return JSON.stringify([identity.kind, identity.object_id]);
}

async function graphNodeKey(material: unknown): Promise<string> {
  return sha256ContentHash({ namespace: "semantic-relationship-node@1", material });
}

async function graphEdgeKey(material: unknown): Promise<string> {
  return sha256ContentHash({ namespace: "semantic-relationship-edge@1", material });
}

function semanticNodeSortKey(node: SemanticRelationshipGraphNode): string {
  return node.node_type === "semantic_object"
    ? `0\0${node.object.identity.kind}\0${node.name}\0${node.node_key}`
    : `1\0${node.governance_kind}\0${node.name}\0${node.node_key}`;
}

function edgeCategory(edge: SemanticExplorerEdge): SemanticRelationshipEdgeCategory {
  switch (edge.kind) {
    case "business_relationship":
      return "BIZ";
    case "analytical_relationship":
      return "JOIN";
    case "metric_dependency":
    case "dimension_hierarchy":
      return "FORMULA";
    case "physical_binding":
      return "BIND";
  }
}

function edgeLabel(edge: SemanticExplorerEdge): string {
  switch (edge.payload.kind) {
    case "business_relationship":
      return `BIZ · ${edge.payload.relationship_type}`;
    case "analytical_relationship":
      return `JOIN · ${edge.payload.relationship_id}`;
    case "metric_dependency":
      return `FORMULA · ${edge.payload.formula_id ?? "dependency"}`;
    case "dimension_hierarchy":
      return "FORMULA · hierarchy";
    case "physical_binding":
      return `BIND · ${edge.payload.datasource_id}`;
  }
}

function edgeContract(edge: SemanticExplorerEdge): SemanticRelationshipGraphEdge["contract"] {
  switch (edge.payload.kind) {
    case "business_relationship":
      return { category: "BIZ", relationship_type: edge.payload.relationship_type };
    case "analytical_relationship":
      return { category: "JOIN", relationship_id: edge.payload.relationship_id };
    case "metric_dependency":
      return {
        category: "FORMULA",
        dependency_kind: "metric_dependency",
        formula_id: edge.payload.formula_id,
      };
    case "dimension_hierarchy":
      return {
        category: "FORMULA",
        dependency_kind: "dimension_hierarchy",
        formula_id: null,
      };
    case "physical_binding":
      return { category: "BIND", datasource_id: edge.payload.datasource_id };
  }
}

async function semanticGraphNode(
  object: SemanticExplorerObject,
): Promise<SemanticRelationshipGraphNode> {
  return {
    node_type: "semantic_object",
    node_key: await graphNodeKey({ node_type: "semantic_object", identity: object.identity }),
    canonical_digest: object.canonical_digest,
    name: object.name,
    object,
  };
}

async function governanceGraphNode(input: {
  readonly governance_kind:
    | "semantic_release"
    | "executable_projection"
    | "relationship_projection"
    | "runtime_restriction_projection";
  readonly governance_id: string;
  readonly release_id: string;
  readonly release_generation: number;
  readonly digest: string;
  readonly name: string;
}): Promise<SemanticRelationshipGraphNode> {
  return {
    node_type: "governance_object",
    node_key: await graphNodeKey({
      node_type: "governance_object",
      governance_kind: input.governance_kind,
      governance_id: input.governance_id,
    }),
    canonical_digest: input.digest,
    ...input,
  };
}

async function publicGraphEdge(
  releaseId: string,
  edge: SemanticExplorerEdge,
  sourceNodeKey: string,
  targetNodeKey: string,
): Promise<SemanticRelationshipGraphEdge> {
  const category = edgeCategory(edge);
  return {
    edge_key: await graphEdgeKey({
      release_id: releaseId,
      category,
      edge_id: edge.edge_id,
      source_node_key: sourceNodeKey,
      target_node_key: targetNodeKey,
    }),
    edge_id: edge.edge_id,
    category,
    source_node_key: sourceNodeKey,
    target_node_key: targetNodeKey,
    canonical_digest: edge.canonical_digest,
    label: edgeLabel(edge),
    contract: edgeContract(edge),
  };
}

async function governanceEdge(input: {
  readonly release_id: string;
  readonly edge_id: string;
  readonly source_node_key: string;
  readonly target_node_key: string;
  readonly label: string;
  readonly governance_relation:
    | "RELEASE_BINDS_PROJECTION"
    | "PROJECTION_PUBLISHES_OBJECT"
    | "PROJECTION_GOVERNS_OBJECT";
  readonly projection_kind:
    | "executable_projection"
    | "relationship_projection"
    | "runtime_restriction_projection";
}): Promise<SemanticRelationshipGraphEdge> {
  const contract = {
    category: "GOVERN" as const,
    governance_relation: input.governance_relation,
    projection_kind: input.projection_kind,
  };
  const canonicalDigest = await sha256ContentHash({
    release_id: input.release_id,
    edge_id: input.edge_id,
    source_node_key: input.source_node_key,
    target_node_key: input.target_node_key,
    contract,
  });
  return {
    edge_key: await graphEdgeKey({
      release_id: input.release_id,
      category: "GOVERN",
      edge_id: input.edge_id,
      source_node_key: input.source_node_key,
      target_node_key: input.target_node_key,
    }),
    edge_id: input.edge_id,
    category: "GOVERN",
    source_node_key: input.source_node_key,
    target_node_key: input.target_node_key,
    canonical_digest: canonicalDigest,
    label: input.label,
    contract,
  };
}

export async function buildSemanticRelationshipGraphManifest(
  scope: AppScope,
  snapshot: SemanticExplorerSnapshot,
): Promise<SemanticRelationshipGraphManifest> {
  const semanticNodes = await Promise.all(snapshot.objects.map(semanticGraphNode));
  const release = snapshot.release_identity;
  const releaseNode = await governanceGraphNode({
    governance_kind: "semantic_release",
    governance_id: release.release_id,
    release_id: release.release_id,
    release_generation: release.release_generation,
    digest: release.release_digest,
    name: `SemanticRelease ${release.semantic_domain}@${release.release_generation}`,
  });
  const projectionNodes = await Promise.all([
    governanceGraphNode({
      governance_kind: "executable_projection",
      governance_id: release.executable_projection.projection_id,
      release_id: release.release_id,
      release_generation: release.release_generation,
      digest: release.executable_projection.projection_digest,
      name: "Executable projection",
    }),
    governanceGraphNode({
      governance_kind: "relationship_projection",
      governance_id: release.relationship_projection.projection_id,
      release_id: release.release_id,
      release_generation: release.release_generation,
      digest: release.relationship_projection.projection_digest,
      name: "Relationship projection",
    }),
    governanceGraphNode({
      governance_kind: "runtime_restriction_projection",
      governance_id: release.runtime_restriction_projection.projection_id,
      release_id: release.release_id,
      release_generation: release.release_generation,
      digest: release.runtime_restriction_projection.projection_digest,
      name: "Runtime restriction projection",
    }),
  ]);
  const nodes = [...semanticNodes, releaseNode, ...projectionNodes].sort((left, right) =>
    compareStable(semanticNodeSortKey(left), semanticNodeSortKey(right)),
  );
  const nodeByIdentity = new Map<string, SemanticRelationshipGraphNode>();
  for (const node of semanticNodes) {
    if (node.node_type === "semantic_object") {
      nodeByIdentity.set(identityKey(node.object.identity), node);
    }
  }

  const publishedEdges = await Promise.all(
    snapshot.edges.map(async (edge) => {
      const source = nodeByIdentity.get(identityKey(edge.source));
      const target = nodeByIdentity.get(identityKey(edge.target));
      if (!source || !target) {
        throw new SemanticRelationshipIndexKernelError(
          "SEMANTIC_RELATIONSHIP_RELEASE_MISMATCH",
          "Explorer snapshot graph edge has an unavailable endpoint.",
        );
      }
      return publicGraphEdge(release.release_id, edge, source.node_key, target.node_key);
    }),
  );

  const projectionByKind = new Map(
    projectionNodes.map((node) => {
      if (node.node_type !== "governance_object") {
        throw new TypeError("Projection graph node must be a governance object.");
      }
      return [node.governance_kind, node] as const;
    }),
  );
  const governanceEdges: SemanticRelationshipGraphEdge[] = [];
  for (const projectionKind of [
    "executable_projection",
    "relationship_projection",
    "runtime_restriction_projection",
  ] as const) {
    const projection = projectionByKind.get(projectionKind);
    if (!projection) {
      throw new TypeError(`Missing ${projectionKind} graph node.`);
    }
    governanceEdges.push(
      await governanceEdge({
        release_id: release.release_id,
        edge_id: `govern:release:${projectionKind}`,
        source_node_key: releaseNode.node_key,
        target_node_key: projection.node_key,
        label: `GOVERN · binds ${projectionKind}`,
        governance_relation: "RELEASE_BINDS_PROJECTION",
        projection_kind: projectionKind,
      }),
    );
  }

  for (const node of semanticNodes) {
    if (node.node_type !== "semantic_object") {
      continue;
    }
    const projectionKind =
      node.object.identity.kind === "relationship" || node.object.identity.kind === "datasource"
        ? "relationship_projection"
        : "executable_projection";
    const projection = projectionByKind.get(projectionKind);
    if (!projection) {
      throw new TypeError(`Missing ${projectionKind} graph node.`);
    }
    governanceEdges.push(
      await governanceEdge({
        release_id: release.release_id,
        edge_id: `govern:${projectionKind}:${node.object.identity.kind}:${node.object.identity.object_id}`,
        source_node_key: projection.node_key,
        target_node_key: node.node_key,
        label: `GOVERN · publishes ${node.object.identity.kind}`,
        governance_relation: "PROJECTION_PUBLISHES_OBJECT",
        projection_kind: projectionKind,
      }),
    );
    if (node.object.restricted) {
      const restriction = projectionByKind.get("runtime_restriction_projection");
      if (!restriction) {
        throw new TypeError("Missing runtime restriction projection graph node.");
      }
      governanceEdges.push(
        await governanceEdge({
          release_id: release.release_id,
          edge_id: `govern:restriction:${node.object.identity.kind}:${node.object.identity.object_id}`,
          source_node_key: restriction.node_key,
          target_node_key: node.node_key,
          label: "GOVERN · restricts object",
          governance_relation: "PROJECTION_GOVERNS_OBJECT",
          projection_kind: "runtime_restriction_projection",
        }),
      );
    }
  }

  const edges = [...publishedEdges, ...governanceEdges].sort((left, right) =>
    compareStable(`${left.category}\0${left.edge_key}`, `${right.category}\0${right.edge_key}`),
  );
  const byCategory = { BIZ: 0, JOIN: 0, FORMULA: 0, BIND: 0, GOVERN: 0 };
  for (const edge of edges) {
    byCategory[edge.category] += 1;
  }
  const material = semanticRelationshipGraphManifestMaterialSchema.parse({
    schema_version: "semantic-relationship-graph-manifest@1.0.0",
    scope,
    semantic_domain: release.semantic_domain,
    release_identity: release,
    relationship_projection_digest: release.relationship_projection.projection_digest,
    nodes,
    edges,
    counts: {
      total_nodes: nodes.length,
      semantic_nodes: semanticNodes.length,
      governance_nodes: nodes.length - semanticNodes.length,
      total_edges: edges.length,
      by_category: byCategory,
    },
  });
  return semanticRelationshipGraphManifestSchema.parse({
    ...material,
    manifest_digest: await computeSemanticRelationshipGraphManifestDigest(material),
  });
}

function matchesTerm(node: SemanticRelationshipGraphNode, term: string): boolean {
  const normalized = term.toLocaleLowerCase("en-US");
  if (node.name.toLocaleLowerCase("en-US").includes(normalized)) {
    return true;
  }
  return node.node_type === "semantic_object"
    ? node.object.identity.object_id.toLocaleLowerCase("en-US").includes(normalized)
    : node.governance_id.toLocaleLowerCase("en-US").includes(normalized);
}

function resultReleaseMatches(
  snapshot: SemanticExplorerSnapshot,
  request: SemanticRelationshipSearchRequest,
): void {
  if (snapshot.release_identity.semantic_domain !== request.semantic_domain) {
    throw new SemanticRelationshipIndexKernelError(
      "SEMANTIC_RELATIONSHIP_DOMAIN_MISMATCH",
      "Relationship search domain does not match the PostgreSQL snapshot.",
    );
  }
  if (request.release.kind === "ACTIVE") {
    if (!snapshot.is_active) {
      throw new SemanticRelationshipIndexKernelError(
        "SEMANTIC_RELATIONSHIP_ACTIVE_RELEASE_REQUIRED",
        "Relationship search requires the active PostgreSQL release.",
      );
    }
    return;
  }
  if (request.release.release_id !== snapshot.release_identity.release_id) {
    throw new SemanticRelationshipIndexKernelError(
      "SEMANTIC_RELATIONSHIP_RELEASE_MISMATCH",
      "Relationship search release does not match the PostgreSQL snapshot.",
    );
  }
}

export function searchSemanticRelationshipGraphFallback(
  snapshot: SemanticExplorerSnapshot,
  manifest: SemanticRelationshipGraphManifest,
  requestInput: unknown,
  options?: {
    readonly index_state?: SemanticRelationshipIndexState;
    readonly reason_code?: SemanticRelationshipIndexReasonCode;
    readonly authority_revalidated?: boolean;
  },
): SemanticRelationshipSearchResult {
  const request = semanticRelationshipSearchRequestSchema.parse(requestInput);
  resultReleaseMatches(snapshot, request);
  if (
    manifest.semantic_domain !== snapshot.release_identity.semantic_domain ||
    manifest.release_identity.release_id !== snapshot.release_identity.release_id ||
    manifest.release_identity.release_digest !== snapshot.release_identity.release_digest
  ) {
    throw new SemanticRelationshipIndexKernelError(
      "SEMANTIC_RELATIONSHIP_RELEASE_MISMATCH",
      "Relationship graph manifest does not match the PostgreSQL snapshot.",
    );
  }

  const nodeByKey = new Map(manifest.nodes.map((node) => [node.node_key, node] as const));
  const keyByIdentity = new Map<string, string>();
  for (const node of manifest.nodes) {
    if (node.node_type === "semantic_object") {
      keyByIdentity.set(identityKey(node.object.identity), node.node_key);
    }
  }
  const selectedCategories = new Set(request.categories);
  const candidateEdges = manifest.edges.filter((edge) => selectedCategories.has(edge.category));
  const adjacency = new Map<string, SemanticRelationshipGraphEdge[]>();
  for (const edge of candidateEdges) {
    const endpointKeys =
      request.direction === "downstream"
        ? [edge.source_node_key]
        : request.direction === "upstream"
          ? [edge.target_node_key]
          : [edge.source_node_key, edge.target_node_key];
    for (const endpointKey of endpointKeys) {
      const bucket = adjacency.get(endpointKey) ?? [];
      bucket.push(edge);
      adjacency.set(endpointKey, bucket);
    }
  }
  for (const bucket of adjacency.values()) {
    bucket.sort((left, right) => compareStable(left.edge_key, right.edge_key));
  }

  const roots: string[] = [];
  if (request.root) {
    const rootKey = keyByIdentity.get(identityKey(request.root));
    if (rootKey) {
      roots.push(rootKey);
    }
  }
  if (request.term) {
    for (const node of manifest.nodes) {
      if (matchesTerm(node, request.term) && !roots.includes(node.node_key)) {
        roots.push(node.node_key);
      }
      if (roots.length >= 25) {
        break;
      }
    }
  }
  if (request.root === null && request.term === null) {
    roots.push(...manifest.nodes.slice(0, request.node_limit).map((node) => node.node_key));
  }

  const selectedNodeKeys = new Set<string>();
  const selectedEdges = new Map<string, SemanticRelationshipGraphEdge>();
  const queue: Array<{ readonly node_key: string; readonly depth: number }> = [];
  const truncationReasons = new Set<"HOP_LIMIT" | "NODE_LIMIT" | "EDGE_LIMIT">();
  for (const rootKey of roots) {
    if (selectedNodeKeys.size >= request.node_limit) {
      truncationReasons.add("NODE_LIMIT");
      break;
    }
    if (!selectedNodeKeys.has(rootKey)) {
      selectedNodeKeys.add(rootKey);
      queue.push({ node_key: rootKey, depth: 0 });
    }
  }

  let traversedHops = 0;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (!current) {
      break;
    }
    const edges = adjacency.get(current.node_key) ?? [];
    if (current.depth >= request.hop_limit) {
      if (edges.length > 0) {
        truncationReasons.add("HOP_LIMIT");
      }
      continue;
    }
    for (const edge of edges) {
      if (selectedEdges.size >= request.edge_limit) {
        truncationReasons.add("EDGE_LIMIT");
        break;
      }
      const nextNodeKey =
        edge.source_node_key === current.node_key ? edge.target_node_key : edge.source_node_key;
      if (!nodeByKey.has(nextNodeKey)) {
        continue;
      }
      if (!selectedNodeKeys.has(nextNodeKey)) {
        if (selectedNodeKeys.size >= request.node_limit) {
          truncationReasons.add("NODE_LIMIT");
          continue;
        }
        selectedNodeKeys.add(nextNodeKey);
        queue.push({ node_key: nextNodeKey, depth: current.depth + 1 });
      }
      selectedEdges.set(edge.edge_key, edge);
      traversedHops = Math.max(traversedHops, current.depth + 1);
    }
  }

  const nodes = manifest.nodes.filter((node) => selectedNodeKeys.has(node.node_key));
  const returnedNodeKeys = new Set(nodes.map((node) => node.node_key));
  const edges = [...selectedEdges.values()].filter(
    (edge) =>
      returnedNodeKeys.has(edge.source_node_key) && returnedNodeKeys.has(edge.target_node_key),
  );
  const reasonCode = options?.reason_code ?? "INDEX_DISABLED";
  return semanticRelationshipSearchResultSchema.parse({
    schema_version: "semantic-relationship-search-result@1.0.0",
    release_identity: snapshot.release_identity,
    pointer_observation: snapshot.pointer_observation,
    is_active: snapshot.is_active,
    source: "POSTGRESQL_FALLBACK",
    index_state: options?.index_state ?? "DISABLED",
    index_reason_code: reasonCode,
    manifest_digest: manifest.manifest_digest,
    root: request.root,
    term: request.term,
    categories: request.categories,
    nodes,
    edges,
    truncated: truncationReasons.size > 0,
    truncation_reasons: [...truncationReasons],
    explanation: {
      summary: `PostgreSQL fallback traversed ${nodes.length} nodes and ${edges.length} edges for exact release ${snapshot.release_identity.release_id}.`,
      requested_hop_limit: request.hop_limit,
      traversed_hops: traversedHops,
      categories: request.categories,
      authority_revalidated: options?.authority_revalidated ?? true,
      fallback_reason: reasonCode,
    },
  });
}
