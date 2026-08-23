import {
  type AppScope,
  appScopeSchema,
  computeSemanticRelationshipGraphManifestDigest,
  type SemanticRelationshipGraphEdge,
  type SemanticRelationshipGraphManifest,
  type SemanticRelationshipGraphNode,
  type SemanticRelationshipGraphPort,
  type SemanticRelationshipSearchRequest,
  semanticRelationshipGraphEdgeSchema,
  semanticRelationshipGraphManifestMaterialSchema,
  semanticRelationshipGraphManifestSchema,
  semanticRelationshipGraphNodeSchema,
  semanticRelationshipIndexCheckpointSchema,
  semanticRelationshipSearchRequestSchema,
} from "@data-agent/contracts";
import neo4j, { type ManagedTransaction, type Record as Neo4jRecord } from "neo4j-driver";
import { z } from "zod";

const adapterOptionsSchema = z.strictObject({
  uri: z.url().refine((value) => !new URL(value).username && !new URL(value).password, {
    message: "Neo4j URI must not contain credentials.",
  }),
  username: z.string().min(1).max(256),
  password: z.string().min(1).max(4096),
  database: z.string().min(1).max(128).default("neo4j"),
  batch_size: z.number().int().min(100).max(10_000).default(1_000),
});
const buildIdSchema = z.uuid();
const graphSliceSchema = z.strictObject({
  release_id: z.uuid(),
  release_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  relationship_projection_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  build_id: z.uuid(),
  manifest_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  node_keys: z.array(z.string().regex(/^sha256:[0-9a-f]{64}$/)).max(250),
  edge_keys: z.array(z.string().regex(/^sha256:[0-9a-f]{64}$/)).max(500),
  truncated: z.boolean(),
  truncation_reasons: z.array(z.enum(["HOP_LIMIT", "NODE_LIMIT", "EDGE_LIMIT"])),
  traversed_hops: z.number().int().min(0).max(6),
});

export type SemanticRelationshipGraphSlice = z.infer<typeof graphSliceSchema>;

export interface SemanticRelationshipGraphAdapter extends SemanticRelationshipGraphPort {}

export class Neo4jRelationshipIndexError extends Error {
  readonly reason_code: "INDEX_UNAVAILABLE" | "INDEX_DIGEST_MISMATCH" | "INDEX_NOT_READY";

  constructor(
    reasonCode: "INDEX_UNAVAILABLE" | "INDEX_DIGEST_MISMATCH" | "INDEX_NOT_READY",
    message: string,
  ) {
    super(message);
    this.name = "Neo4jRelationshipIndexError";
    this.reason_code = reasonCode;
  }
}

function scopeKey(scopeInput: AppScope, semanticDomain: string): string {
  const scope = appScopeSchema.parse(scopeInput);
  return JSON.stringify([scope.app_id, scope.tenant_id, scope.environment, semanticDomain]);
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function nodeRow(node: SemanticRelationshipGraphNode) {
  return {
    node_key: node.node_key,
    canonical_digest: node.canonical_digest,
    name: node.name,
    search_text: `${node.name}\u0000${
      node.node_type === "semantic_object" ? node.object.identity.object_id : node.governance_id
    }`.toLocaleLowerCase("en-US"),
    object_identity_key:
      node.node_type === "semantic_object"
        ? JSON.stringify([node.object.identity.kind, node.object.identity.object_id])
        : null,
    payload_json: JSON.stringify(node),
  };
}

function edgeRow(edge: SemanticRelationshipGraphEdge) {
  return {
    edge_key: edge.edge_key,
    source_node_key: edge.source_node_key,
    target_node_key: edge.target_node_key,
    canonical_digest: edge.canonical_digest,
    label: edge.label,
    payload_json: JSON.stringify(edge),
  };
}

function numberValue(value: unknown): number {
  if (neo4j.isInt(value)) {
    return value.toNumber();
  }
  return z.number().int().min(0).parse(value);
}

function stringValue(record: Neo4jRecord, key: string): string {
  return z.string().parse(record.get(key));
}

function parsePayload<T>(schema: z.ZodType<T>, payload: unknown): T {
  if (typeof payload !== "string") {
    throw new Neo4jRelationshipIndexError(
      "INDEX_DIGEST_MISMATCH",
      "Neo4j relationship projection contains an invalid payload.",
    );
  }
  try {
    return schema.parse(JSON.parse(payload));
  } catch {
    throw new Neo4jRelationshipIndexError(
      "INDEX_DIGEST_MISMATCH",
      "Neo4j relationship projection contains an invalid payload.",
    );
  }
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function materialFromStoredGraph(
  manifest: SemanticRelationshipGraphManifest,
  nodes: readonly SemanticRelationshipGraphNode[],
  edges: readonly SemanticRelationshipGraphEdge[],
) {
  const semanticNodes = nodes.filter((node) => node.node_type === "semantic_object").length;
  const byCategory = { BIZ: 0, JOIN: 0, FORMULA: 0, BIND: 0, GOVERN: 0 };
  for (const edge of edges) byCategory[edge.category] += 1;
  return semanticRelationshipGraphManifestMaterialSchema.parse({
    schema_version: manifest.schema_version,
    scope: manifest.scope,
    semantic_domain: manifest.semantic_domain,
    release_identity: manifest.release_identity,
    relationship_projection_digest: manifest.relationship_projection_digest,
    nodes: [...nodes].sort((left, right) => stableCompare(left.node_key, right.node_key)),
    edges: [...edges].sort((left, right) =>
      stableCompare(
        `${left.category}\u0000${left.edge_key}`,
        `${right.category}\u0000${right.edge_key}`,
      ),
    ),
    counts: {
      total_nodes: nodes.length,
      semantic_nodes: semanticNodes,
      governance_nodes: nodes.length - semanticNodes,
      total_edges: edges.length,
      by_category: byCategory,
    },
  });
}

async function verifyStoredGraph(
  manifest: SemanticRelationshipGraphManifest,
  nodes: readonly SemanticRelationshipGraphNode[],
  edges: readonly SemanticRelationshipGraphEdge[],
): Promise<void> {
  const material = materialFromStoredGraph(manifest, nodes, edges);
  const digest = await computeSemanticRelationshipGraphManifestDigest(material);
  if (digest !== manifest.manifest_digest) {
    throw new Neo4jRelationshipIndexError(
      "INDEX_DIGEST_MISMATCH",
      "Neo4j staged relationship projection does not match the manifest digest.",
    );
  }
}

function driverError(error: unknown): never {
  if (error instanceof Neo4jRelationshipIndexError) throw error;
  throw new Neo4jRelationshipIndexError(
    "INDEX_UNAVAILABLE",
    "Neo4j relationship projection is temporarily unavailable.",
  );
}

async function closeSession(session: { close(): Promise<void> }): Promise<void> {
  try {
    await session.close();
  } catch {
    // The operation result or failure remains authoritative; close errors are not leaked.
  }
}

const constraints = [
  "CREATE CONSTRAINT semantic_graph_node_identity IF NOT EXISTS FOR (n:SemanticGraphNode) REQUIRE (n.scope_key, n.build_id, n.node_key) IS UNIQUE",
  "CREATE CONSTRAINT semantic_graph_build_identity IF NOT EXISTS FOR (b:SemanticGraphBuild) REQUIRE (b.scope_key, b.build_id) IS UNIQUE",
  "CREATE CONSTRAINT semantic_graph_seal_identity IF NOT EXISTS FOR (s:SemanticGraphSeal) REQUIRE (s.scope_key, s.release_id) IS UNIQUE",
  "CREATE INDEX semantic_graph_node_search IF NOT EXISTS FOR (n:SemanticGraphNode) ON (n.scope_key, n.build_id, n.search_text)",
] as const;

function createDriverAdapter(
  optionsInput: z.input<typeof adapterOptionsSchema>,
): SemanticRelationshipGraphAdapter {
  const options = adapterOptionsSchema.parse(optionsInput);
  const driver = neo4j.driver(options.uri, neo4j.auth.basic(options.username, options.password), {
    disableLosslessIntegers: true,
  });

  async function executeWrite<T>(work: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
    const session = driver.session({
      database: options.database,
      defaultAccessMode: neo4j.session.WRITE,
    });
    try {
      return await session.executeWrite(work);
    } catch (error) {
      return driverError(error);
    } finally {
      await closeSession(session);
    }
  }

  async function executeRead<T>(work: (tx: ManagedTransaction) => Promise<T>): Promise<T> {
    const session = driver.session({
      database: options.database,
      defaultAccessMode: neo4j.session.READ,
    });
    try {
      return await session.executeRead(work);
    } catch (error) {
      return driverError(error);
    } finally {
      await closeSession(session);
    }
  }

  return {
    async initialize() {
      try {
        await driver.verifyConnectivity();
        for (const statement of constraints) {
          await executeWrite(async (tx) => {
            await tx.run(statement);
          });
        }
      } catch (error) {
        return driverError(error);
      }
    },

    async stageBuild(input) {
      const manifest = semanticRelationshipGraphManifestSchema.parse(input.manifest);
      const buildId = buildIdSchema.parse(input.build_id);
      const key = scopeKey(manifest.scope, manifest.semantic_domain);
      await executeWrite(async (tx) => {
        await tx.run(
          `MATCH (n:SemanticGraphNode {scope_key: $scope_key, build_id: $build_id}) DETACH DELETE n`,
          { scope_key: key, build_id: buildId },
        );
        await tx.run(
          `MERGE (b:SemanticGraphBuild {scope_key: $scope_key, build_id: $build_id})
           SET b.semantic_domain = $semantic_domain,
               b.release_id = $release_id,
               b.release_digest = $release_digest,
               b.relationship_projection_digest = $relationship_projection_digest,
               b.manifest_digest = $manifest_digest,
               b.state = 'STAGING'`,
          {
            scope_key: key,
            build_id: buildId,
            semantic_domain: manifest.semantic_domain,
            release_id: manifest.release_identity.release_id,
            release_digest: manifest.release_identity.release_digest,
            relationship_projection_digest: manifest.relationship_projection_digest,
            manifest_digest: manifest.manifest_digest,
          },
        );
      });

      for (const batch of chunks(manifest.nodes.map(nodeRow), options.batch_size)) {
        await executeWrite(async (tx) => {
          await tx.run(
            `UNWIND $rows AS row
             MERGE (n:SemanticGraphNode {
               scope_key: $scope_key, build_id: $build_id, node_key: row.node_key
             })
             SET n.canonical_digest = row.canonical_digest,
                 n.name = row.name,
                 n.search_text = row.search_text,
                 n.object_identity_key = row.object_identity_key,
                 n.payload_json = row.payload_json`,
            { scope_key: key, build_id: buildId, rows: batch },
          );
        });
        await input.on_progress?.();
      }

      for (const category of ["BIZ", "JOIN", "FORMULA", "BIND", "GOVERN"] as const) {
        const rows = manifest.edges.filter((edge) => edge.category === category).map(edgeRow);
        for (const batch of chunks(rows, options.batch_size)) {
          await executeWrite(async (tx) => {
            await tx.run(
              `UNWIND $rows AS row
               MATCH (source:SemanticGraphNode {
                 scope_key: $scope_key, build_id: $build_id, node_key: row.source_node_key
               })
               MATCH (target:SemanticGraphNode {
                 scope_key: $scope_key, build_id: $build_id, node_key: row.target_node_key
               })
               MERGE (source)-[edge:${category} {
                 scope_key: $scope_key, build_id: $build_id, edge_key: row.edge_key
               }]->(target)
               SET edge.canonical_digest = row.canonical_digest,
                   edge.label = row.label,
                   edge.payload_json = row.payload_json`,
              { scope_key: key, build_id: buildId, rows: batch },
            );
          });
          await input.on_progress?.();
        }
      }
    },

    async verifyAndSeal(input) {
      const manifest = semanticRelationshipGraphManifestSchema.parse(input.manifest);
      const buildId = buildIdSchema.parse(input.build_id);
      const key = scopeKey(manifest.scope, manifest.semantic_domain);
      const stored = await executeRead(async (tx) => {
        const nodesResult = await tx.run(
          `MATCH (n:SemanticGraphNode {scope_key: $scope_key, build_id: $build_id})
           RETURN n.payload_json AS payload ORDER BY n.node_key`,
          { scope_key: key, build_id: buildId },
        );
        const edgesResult = await tx.run(
          `MATCH (:SemanticGraphNode {scope_key: $scope_key, build_id: $build_id})
                 -[edge]->
                 (:SemanticGraphNode {scope_key: $scope_key, build_id: $build_id})
           WHERE edge.scope_key = $scope_key AND edge.build_id = $build_id
           RETURN edge.payload_json AS payload ORDER BY type(edge), edge.edge_key`,
          { scope_key: key, build_id: buildId },
        );
        return {
          nodes: nodesResult.records.map((record) =>
            parsePayload(semanticRelationshipGraphNodeSchema, record.get("payload")),
          ),
          edges: edgesResult.records.map((record) =>
            parsePayload(semanticRelationshipGraphEdgeSchema, record.get("payload")),
          ),
        };
      });
      await verifyStoredGraph(manifest, stored.nodes, stored.edges);

      await executeWrite(async (tx) => {
        const counts = await tx.run(
          `MATCH (b:SemanticGraphBuild {scope_key: $scope_key, build_id: $build_id})
           OPTIONAL MATCH (n:SemanticGraphNode {scope_key: $scope_key, build_id: $build_id})
           WITH b, count(DISTINCT n) AS node_count
           OPTIONAL MATCH (:SemanticGraphNode {scope_key: $scope_key, build_id: $build_id})
                 -[edge]->
                 (:SemanticGraphNode {scope_key: $scope_key, build_id: $build_id})
           WHERE edge.scope_key = $scope_key AND edge.build_id = $build_id
           RETURN b.manifest_digest AS manifest_digest,
                  b.release_digest AS release_digest,
                  b.relationship_projection_digest AS relationship_projection_digest,
                  node_count, count(DISTINCT edge) AS edge_count`,
          { scope_key: key, build_id: buildId },
        );
        const record = counts.records[0];
        if (
          !record ||
          stringValue(record, "manifest_digest") !== manifest.manifest_digest ||
          stringValue(record, "release_digest") !== manifest.release_identity.release_digest ||
          stringValue(record, "relationship_projection_digest") !==
            manifest.relationship_projection_digest ||
          numberValue(record.get("node_count")) !== manifest.counts.total_nodes ||
          numberValue(record.get("edge_count")) !== manifest.counts.total_edges
        ) {
          throw new Neo4jRelationshipIndexError(
            "INDEX_DIGEST_MISMATCH",
            "Neo4j staged relationship projection changed before sealing.",
          );
        }
        await tx.run(
          `MATCH (b:SemanticGraphBuild {scope_key: $scope_key, build_id: $build_id})
           SET b.state = 'SEALED', b.sealed_at = datetime()
           MERGE (seal:SemanticGraphSeal {scope_key: $scope_key, release_id: $release_id})
           SET seal.semantic_domain = $semantic_domain,
               seal.release_digest = $release_digest,
               seal.relationship_projection_digest = $relationship_projection_digest,
               seal.build_id = $build_id,
               seal.manifest_digest = $manifest_digest,
               seal.node_count = $node_count,
               seal.edge_count = $edge_count,
               seal.sealed_at = datetime()`,
          {
            scope_key: key,
            build_id: buildId,
            semantic_domain: manifest.semantic_domain,
            release_id: manifest.release_identity.release_id,
            release_digest: manifest.release_identity.release_digest,
            relationship_projection_digest: manifest.relationship_projection_digest,
            manifest_digest: manifest.manifest_digest,
            node_count: manifest.counts.total_nodes,
            edge_count: manifest.counts.total_edges,
          },
        );
      });
      return { node_count: stored.nodes.length, edge_count: stored.edges.length };
    },

    async search(input) {
      const scope = appScopeSchema.parse(input.scope);
      const checkpoint = semanticRelationshipIndexCheckpointSchema.parse(input.checkpoint);
      const request = semanticRelationshipSearchRequestSchema.parse(input.request);
      if (checkpoint.state !== "READY" || !checkpoint.build_id || !checkpoint.manifest_digest) {
        throw new Neo4jRelationshipIndexError(
          "INDEX_NOT_READY",
          "Relationship index is not READY.",
        );
      }
      const key = scopeKey(scope, request.semantic_domain);
      const relationshipTypes = request.categories.join("|");
      const hopLimit = request.hop_limit;
      const pattern =
        request.direction === "downstream"
          ? `(root)-[rels:${relationshipTypes}*0..${hopLimit}]->(node)`
          : request.direction === "upstream"
            ? `(root)<-[rels:${relationshipTypes}*0..${hopLimit}]-(node)`
            : `(root)-[rels:${relationshipTypes}*0..${hopLimit}]-(node)`;
      const rootIdentityKey = request.root
        ? JSON.stringify([request.root.kind, request.root.object_id])
        : null;
      const term = request.term?.toLocaleLowerCase("en-US") ?? null;
      const pathLimit = Math.min(5_000, request.edge_limit * 8 + request.node_limit);
      const records = await executeRead(async (tx) => {
        const seal = await tx.run(
          `MATCH (seal:SemanticGraphSeal {scope_key: $scope_key, release_id: $release_id})
           WHERE seal.release_digest = $release_digest
             AND seal.relationship_projection_digest = $relationship_projection_digest
             AND seal.build_id = $build_id
             AND seal.manifest_digest = $manifest_digest
           RETURN count(seal) AS matched`,
          {
            scope_key: key,
            release_id: checkpoint.release_identity.release_id,
            release_digest: checkpoint.release_identity.release_digest,
            relationship_projection_digest: checkpoint.relationship_projection_digest,
            build_id: checkpoint.build_id,
            manifest_digest: checkpoint.manifest_digest,
          },
        );
        if (numberValue(seal.records[0]?.get("matched") ?? 0) !== 1) {
          throw new Neo4jRelationshipIndexError(
            "INDEX_NOT_READY",
            "Exact sealed relationship build is unavailable.",
          );
        }
        const result = await tx.run(
          `MATCH (seal:SemanticGraphSeal {scope_key: $scope_key, release_id: $release_id})
           WHERE seal.release_digest = $release_digest
             AND seal.relationship_projection_digest = $relationship_projection_digest
             AND seal.build_id = $build_id
             AND seal.manifest_digest = $manifest_digest
           MATCH (root:SemanticGraphNode {scope_key: $scope_key, build_id: $build_id})
           WHERE ($root_identity_key IS NOT NULL AND root.object_identity_key = $root_identity_key)
              OR ($term IS NOT NULL AND root.search_text CONTAINS $term)
              OR ($root_identity_key IS NULL AND $term IS NULL)
           WITH root ORDER BY root.node_key LIMIT $root_limit
           MATCH path = ${pattern}
           WHERE all(edge IN rels WHERE edge.scope_key = $scope_key AND edge.build_id = $build_id)
           RETURN [item IN nodes(path) | item.node_key] AS node_keys,
                  [item IN relationships(path) | item.edge_key] AS edge_keys,
                  length(path) AS hops
           ORDER BY hops, node.node_key
           LIMIT $path_limit`,
          {
            scope_key: key,
            release_id: checkpoint.release_identity.release_id,
            release_digest: checkpoint.release_identity.release_digest,
            relationship_projection_digest: checkpoint.relationship_projection_digest,
            build_id: checkpoint.build_id,
            manifest_digest: checkpoint.manifest_digest,
            root_identity_key: rootIdentityKey,
            term,
            root_limit: neo4j.int(Math.min(25, request.node_limit)),
            path_limit: neo4j.int(pathLimit),
          },
        );
        return result.records;
      });
      const nodeKeys = new Set<string>();
      const edgeKeys = new Set<string>();
      const reasons = new Set<"HOP_LIMIT" | "NODE_LIMIT" | "EDGE_LIMIT">();
      let traversedHops = 0;
      for (const record of records) {
        const pathNodes = z.array(z.string()).parse(record.get("node_keys"));
        const pathEdges = z.array(z.string()).parse(record.get("edge_keys"));
        traversedHops = Math.max(traversedHops, numberValue(record.get("hops")));
        for (const nodeKey of pathNodes) {
          if (!nodeKeys.has(nodeKey) && nodeKeys.size >= request.node_limit) {
            reasons.add("NODE_LIMIT");
            continue;
          }
          nodeKeys.add(nodeKey);
        }
        for (const edgeKey of pathEdges) {
          if (!edgeKeys.has(edgeKey) && edgeKeys.size >= request.edge_limit) {
            reasons.add("EDGE_LIMIT");
            continue;
          }
          edgeKeys.add(edgeKey);
        }
      }
      if (records.length >= pathLimit && traversedHops >= request.hop_limit) {
        reasons.add("HOP_LIMIT");
      }
      return graphSliceSchema.parse({
        release_id: checkpoint.release_identity.release_id,
        release_digest: checkpoint.release_identity.release_digest,
        relationship_projection_digest: checkpoint.relationship_projection_digest,
        build_id: checkpoint.build_id,
        manifest_digest: checkpoint.manifest_digest,
        node_keys: [...nodeKeys],
        edge_keys: [...edgeKeys],
        truncated: reasons.size > 0,
        truncation_reasons: [...reasons],
        traversed_hops: traversedHops,
      });
    },

    async cleanup(input) {
      const scope = appScopeSchema.parse(input.scope);
      const key = scopeKey(scope, semanticDomainSchema.parse(input.semantic_domain));
      const releaseIds = z.array(z.uuid()).max(1_000).parse(input.keep_release_ids);
      return executeWrite(async (tx) => {
        await tx.run(
          `MATCH (seal:SemanticGraphSeal {scope_key: $scope_key})
           WHERE NOT seal.release_id IN $keep_release_ids
           DELETE seal`,
          { scope_key: key, keep_release_ids: releaseIds },
        );
        const result = await tx.run(
          `MATCH (build:SemanticGraphBuild {scope_key: $scope_key})
           OPTIONAL MATCH (seal:SemanticGraphSeal {scope_key: $scope_key})
           WHERE seal.release_id = build.release_id
           WITH build, seal
           WHERE NOT build.release_id IN $keep_release_ids
              OR seal.build_id IS NULL
              OR seal.build_id <> build.build_id
           WITH build, build.build_id AS build_id
           OPTIONAL MATCH (node:SemanticGraphNode {scope_key: $scope_key, build_id: build_id})
           DETACH DELETE node
           DELETE build
           RETURN count(DISTINCT build_id) AS removed`,
          { scope_key: key, keep_release_ids: releaseIds },
        );
        return numberValue(result.records[0]?.get("removed") ?? 0);
      });
    },

    async close() {
      try {
        await driver.close();
      } catch (error) {
        return driverError(error);
      }
    },
  };
}

interface InMemoryBuild {
  readonly manifest: SemanticRelationshipGraphManifest;
  state: "STAGING" | "SEALED";
}

function manifestIdentityKey(node: SemanticRelationshipGraphNode): string | null {
  return node.node_type === "semantic_object"
    ? JSON.stringify([node.object.identity.kind, node.object.identity.object_id])
    : null;
}

function selectInMemorySlice(
  manifest: SemanticRelationshipGraphManifest,
  request: SemanticRelationshipSearchRequest,
) {
  const selectedCategories = new Set(request.categories);
  const candidateEdges = manifest.edges.filter((edge) => selectedCategories.has(edge.category));
  const adjacency = new Map<string, SemanticRelationshipGraphEdge[]>();
  for (const edge of candidateEdges) {
    const keys =
      request.direction === "downstream"
        ? [edge.source_node_key]
        : request.direction === "upstream"
          ? [edge.target_node_key]
          : [edge.source_node_key, edge.target_node_key];
    for (const key of keys) {
      const bucket = adjacency.get(key) ?? [];
      bucket.push(edge);
      adjacency.set(key, bucket);
    }
  }
  for (const bucket of adjacency.values()) {
    bucket.sort((left, right) => stableCompare(left.edge_key, right.edge_key));
  }

  const rootIdentity = request.root
    ? JSON.stringify([request.root.kind, request.root.object_id])
    : null;
  const term = request.term?.toLocaleLowerCase("en-US") ?? null;
  const roots = manifest.nodes
    .filter((node) => {
      const identityMatches = rootIdentity !== null && manifestIdentityKey(node) === rootIdentity;
      const termMatches =
        term !== null &&
        `${node.name}\u0000${
          node.node_type === "semantic_object" ? node.object.identity.object_id : node.governance_id
        }`
          .toLocaleLowerCase("en-US")
          .includes(term);
      return identityMatches || termMatches || (rootIdentity === null && term === null);
    })
    .slice(0, Math.min(25, request.node_limit));

  const nodeKeys = new Set<string>();
  const edgeKeys = new Set<string>();
  const queue: Array<{ readonly key: string; readonly depth: number }> = [];
  const reasons = new Set<"HOP_LIMIT" | "NODE_LIMIT" | "EDGE_LIMIT">();
  for (const node of roots) {
    nodeKeys.add(node.node_key);
    queue.push({ key: node.node_key, depth: 0 });
  }
  let traversedHops = 0;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor];
    if (!current) break;
    const edges = adjacency.get(current.key) ?? [];
    if (current.depth >= request.hop_limit) {
      if (edges.length > 0) reasons.add("HOP_LIMIT");
      continue;
    }
    for (const edge of edges) {
      if (edgeKeys.size >= request.edge_limit) {
        reasons.add("EDGE_LIMIT");
        break;
      }
      const nextKey =
        edge.source_node_key === current.key ? edge.target_node_key : edge.source_node_key;
      if (!nodeKeys.has(nextKey)) {
        if (nodeKeys.size >= request.node_limit) {
          reasons.add("NODE_LIMIT");
          continue;
        }
        nodeKeys.add(nextKey);
        queue.push({ key: nextKey, depth: current.depth + 1 });
      }
      edgeKeys.add(edge.edge_key);
      traversedHops = Math.max(traversedHops, current.depth + 1);
    }
  }
  return {
    node_keys: [...nodeKeys],
    edge_keys: [...edgeKeys],
    truncated: reasons.size > 0,
    truncation_reasons: [...reasons],
    traversed_hops: traversedHops,
  };
}

export function createInMemoryRelationshipGraphAdapter(): SemanticRelationshipGraphAdapter {
  const builds = new Map<string, InMemoryBuild>();
  const seals = new Map<string, string>();
  const buildKey = (manifest: SemanticRelationshipGraphManifest, buildId: string) =>
    `${scopeKey(manifest.scope, manifest.semantic_domain)}\u0000${buildId}`;
  const sealKey = (manifest: SemanticRelationshipGraphManifest) =>
    `${scopeKey(manifest.scope, manifest.semantic_domain)}\u0000${manifest.release_identity.release_id}`;

  const adapter: SemanticRelationshipGraphAdapter = {
    async initialize() {},

    async stageBuild(input) {
      const manifest = semanticRelationshipGraphManifestSchema.parse(
        JSON.parse(JSON.stringify(input.manifest)),
      );
      const buildId = buildIdSchema.parse(input.build_id);
      builds.set(buildKey(manifest, buildId), { manifest, state: "STAGING" });
      await input.on_progress?.();
    },

    async verifyAndSeal(input) {
      const expected = semanticRelationshipGraphManifestSchema.parse(input.manifest);
      const buildId = buildIdSchema.parse(input.build_id);
      const build = builds.get(buildKey(expected, buildId));
      if (!build) {
        throw new Neo4jRelationshipIndexError("INDEX_NOT_READY", "Staged build is unavailable.");
      }
      await verifyStoredGraph(expected, build.manifest.nodes, build.manifest.edges);
      if (build.manifest.manifest_digest !== expected.manifest_digest) {
        throw new Neo4jRelationshipIndexError(
          "INDEX_DIGEST_MISMATCH",
          "Staged build manifest identity changed.",
        );
      }
      build.state = "SEALED";
      seals.set(sealKey(expected), buildId);
      return {
        node_count: build.manifest.counts.total_nodes,
        edge_count: build.manifest.counts.total_edges,
      };
    },

    async search(input) {
      const scope = appScopeSchema.parse(input.scope);
      const checkpoint = semanticRelationshipIndexCheckpointSchema.parse(input.checkpoint);
      const request = semanticRelationshipSearchRequestSchema.parse(input.request);
      if (checkpoint.state !== "READY" || !checkpoint.build_id || !checkpoint.manifest_digest) {
        throw new Neo4jRelationshipIndexError(
          "INDEX_NOT_READY",
          "Relationship index is not READY.",
        );
      }
      const key = `${scopeKey(scope, request.semantic_domain)}\u0000${checkpoint.release_identity.release_id}`;
      if (seals.get(key) !== checkpoint.build_id) {
        throw new Neo4jRelationshipIndexError(
          "INDEX_NOT_READY",
          "Exact sealed build is unavailable.",
        );
      }
      const build = builds.get(
        `${scopeKey(scope, request.semantic_domain)}\u0000${checkpoint.build_id}`,
      );
      if (
        build?.state !== "SEALED" ||
        build.manifest.manifest_digest !== checkpoint.manifest_digest ||
        build.manifest.release_identity.release_digest !==
          checkpoint.release_identity.release_digest ||
        build.manifest.relationship_projection_digest !== checkpoint.relationship_projection_digest
      ) {
        throw new Neo4jRelationshipIndexError(
          "INDEX_DIGEST_MISMATCH",
          "Exact sealed build does not match the PostgreSQL checkpoint.",
        );
      }
      return graphSliceSchema.parse({
        release_id: checkpoint.release_identity.release_id,
        release_digest: checkpoint.release_identity.release_digest,
        relationship_projection_digest: checkpoint.relationship_projection_digest,
        build_id: checkpoint.build_id,
        manifest_digest: checkpoint.manifest_digest,
        ...selectInMemorySlice(build.manifest, request),
      });
    },

    async cleanup(input) {
      const scope = appScopeSchema.parse(input.scope);
      const semanticDomain = semanticDomainSchema.parse(input.semantic_domain);
      const keepReleaseIds = new Set(z.array(z.uuid()).max(1_000).parse(input.keep_release_ids));
      const prefix = `${scopeKey(scope, semanticDomain)}\u0000`;
      const keptBuildIds = new Set<string>();
      for (const [key, buildId] of seals) {
        if (!key.startsWith(prefix)) continue;
        const releaseId = key.slice(prefix.length);
        if (keepReleaseIds.has(releaseId)) keptBuildIds.add(buildId);
        else seals.delete(key);
      }
      let removed = 0;
      for (const key of builds.keys()) {
        if (key.startsWith(prefix) && !keptBuildIds.has(key.slice(prefix.length))) {
          builds.delete(key);
          removed += 1;
        }
      }
      return removed;
    },

    async close() {
      builds.clear();
      seals.clear();
    },
  };
  return Object.freeze(adapter);
}

const semanticDomainSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/);

export function createNeo4jRelationshipGraphAdapter(
  options: z.input<typeof adapterOptionsSchema>,
): SemanticRelationshipGraphAdapter {
  return createDriverAdapter(options);
}

export function createNeo4jRelationshipGraphAdapterFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): SemanticRelationshipGraphAdapter | null {
  const featureFlag = environment.SEMANTIC_RELATIONSHIP_INDEX_ENABLED;
  if (featureFlag !== "true" && featureFlag !== "1") return null;
  const uri = environment.NEO4J_URI;
  const username = environment.NEO4J_USERNAME;
  const password = environment.NEO4J_PASSWORD;
  if (!uri || !username || !password) {
    throw new Neo4jRelationshipIndexError(
      "INDEX_UNAVAILABLE",
      "Neo4j relationship projection is enabled but not configured.",
    );
  }
  return createDriverAdapter({
    uri,
    username,
    password,
    database: environment.NEO4J_DATABASE ?? "neo4j",
    batch_size: environment.NEO4J_RELATIONSHIP_BATCH_SIZE
      ? Number(environment.NEO4J_RELATIONSHIP_BATCH_SIZE)
      : 1_000,
  });
}
