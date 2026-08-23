import { z } from "zod";
import {
  appScopeSchema,
  contentHashSchema,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import {
  semanticExplorerDomainSchema,
  semanticExplorerObjectIdentitySchema,
  semanticExplorerObjectSchema,
  semanticExplorerPointerObservationSchema,
  semanticExplorerReleaseIdentitySchema,
} from "./semantic-explorer.js";

export const SEMANTIC_RELATIONSHIP_GRAPH_MANIFEST_VERSION =
  "semantic-relationship-graph-manifest@1.0.0" as const;
export const SEMANTIC_RELATIONSHIP_INDEX_CHECKPOINT_VERSION =
  "semantic-relationship-index-checkpoint@1.0.0" as const;
export const SEMANTIC_RELATIONSHIP_SEARCH_REQUEST_VERSION =
  "semantic-relationship-search-request@1.0.0" as const;
export const SEMANTIC_RELATIONSHIP_SEARCH_RESULT_VERSION =
  "semantic-relationship-search-result@1.0.0" as const;

export const semanticRelationshipEdgeCategorySchema = z.enum([
  "BIZ",
  "JOIN",
  "FORMULA",
  "BIND",
  "GOVERN",
]);

export const semanticRelationshipIndexStateSchema = z.enum([
  "DISABLED",
  "PENDING",
  "INDEXING",
  "READY",
  "FAILED",
  "STALE",
]);

export const semanticRelationshipIndexReasonCodeSchema = z.enum([
  "INDEX_DISABLED",
  "INDEX_NOT_CONFIGURED",
  "INDEX_NOT_READY",
  "INDEX_UNAVAILABLE",
  "INDEX_DIGEST_MISMATCH",
  "INDEX_BUILD_FAILED",
  "INDEX_LEASE_EXPIRED",
  "INDEX_ATTEMPT_STALE",
  "AUTHORITY_CHANGED",
]);

export const semanticRelationshipGovernanceKindSchema = z.enum([
  "semantic_release",
  "executable_projection",
  "relationship_projection",
  "runtime_restriction_projection",
]);

const graphNodeBaseSchema = z.strictObject({
  node_key: contentHashSchema,
  canonical_digest: contentHashSchema,
  name: z.string().min(1).max(512),
});

export const semanticRelationshipGraphNodeSchema = z.discriminatedUnion("node_type", [
  graphNodeBaseSchema.extend({
    node_type: z.literal("semantic_object"),
    object: semanticExplorerObjectSchema,
  }),
  graphNodeBaseSchema.extend({
    node_type: z.literal("governance_object"),
    governance_kind: semanticRelationshipGovernanceKindSchema,
    governance_id: immutableIdSchema,
    release_id: immutableIdSchema,
    release_generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    digest: contentHashSchema,
  }),
]);

const bizContractSchema = z.strictObject({
  category: z.literal("BIZ"),
  relationship_type: z.string().min(1).max(128),
});
const joinContractSchema = z.strictObject({
  category: z.literal("JOIN"),
  relationship_id: versionIdentifierSchema,
});
const formulaContractSchema = z.strictObject({
  category: z.literal("FORMULA"),
  dependency_kind: z.enum(["metric_dependency", "dimension_hierarchy"]),
  formula_id: versionIdentifierSchema.nullable(),
});
const bindContractSchema = z.strictObject({
  category: z.literal("BIND"),
  datasource_id: immutableIdSchema,
});
const governContractSchema = z.strictObject({
  category: z.literal("GOVERN"),
  governance_relation: z.enum([
    "RELEASE_BINDS_PROJECTION",
    "PROJECTION_PUBLISHES_OBJECT",
    "PROJECTION_GOVERNS_OBJECT",
  ]),
  projection_kind: z.enum([
    "executable_projection",
    "relationship_projection",
    "runtime_restriction_projection",
  ]),
});

export const semanticRelationshipGraphEdgeContractSchema = z.discriminatedUnion("category", [
  bizContractSchema,
  joinContractSchema,
  formulaContractSchema,
  bindContractSchema,
  governContractSchema,
]);

export const semanticRelationshipGraphEdgeSchema = z
  .strictObject({
    edge_key: contentHashSchema,
    edge_id: z.string().min(1).max(1024),
    category: semanticRelationshipEdgeCategorySchema,
    source_node_key: contentHashSchema,
    target_node_key: contentHashSchema,
    canonical_digest: contentHashSchema,
    label: z.string().min(1).max(256),
    contract: semanticRelationshipGraphEdgeContractSchema,
  })
  .superRefine((edge, context) => {
    if (edge.category !== edge.contract.category) {
      context.addIssue({
        code: "custom",
        message: "Graph edge category must match its contract category.",
        path: ["category"],
      });
    }
  });

export const semanticRelationshipGraphCountsSchema = z.strictObject({
  total_nodes: z.number().int().min(0),
  semantic_nodes: z.number().int().min(0),
  governance_nodes: z.number().int().min(0),
  total_edges: z.number().int().min(0),
  by_category: z.strictObject({
    BIZ: z.number().int().min(0),
    JOIN: z.number().int().min(0),
    FORMULA: z.number().int().min(0),
    BIND: z.number().int().min(0),
    GOVERN: z.number().int().min(0),
  }),
});

export const semanticRelationshipGraphManifestMaterialSchema = z
  .strictObject({
    schema_version: z.literal(SEMANTIC_RELATIONSHIP_GRAPH_MANIFEST_VERSION),
    scope: appScopeSchema,
    semantic_domain: semanticExplorerDomainSchema,
    release_identity: semanticExplorerReleaseIdentitySchema,
    relationship_projection_digest: contentHashSchema,
    nodes: z.array(semanticRelationshipGraphNodeSchema),
    edges: z.array(semanticRelationshipGraphEdgeSchema),
    counts: semanticRelationshipGraphCountsSchema,
  })
  .superRefine((manifest, context) => {
    if (
      manifest.semantic_domain !== manifest.release_identity.semantic_domain ||
      manifest.relationship_projection_digest !==
        manifest.release_identity.relationship_projection.projection_digest
    ) {
      context.addIssue({
        code: "custom",
        message: "Graph manifest must bind its exact release and relationship projection.",
        path: ["release_identity"],
      });
    }

    const nodeKeys = new Set<string>();
    let semanticNodes = 0;
    for (const [index, node] of manifest.nodes.entries()) {
      if (nodeKeys.has(node.node_key)) {
        context.addIssue({
          code: "custom",
          message: "Graph manifest contains a duplicate node key.",
          path: ["nodes", index, "node_key"],
        });
      }
      nodeKeys.add(node.node_key);
      if (node.node_type === "semantic_object") {
        semanticNodes += 1;
      } else if (
        node.release_id !== manifest.release_identity.release_id ||
        node.release_generation !== manifest.release_identity.release_generation
      ) {
        context.addIssue({
          code: "custom",
          message: "Governance graph nodes must bind the manifest release.",
          path: ["nodes", index, "release_id"],
        });
      }
    }

    const edgeKeys = new Set<string>();
    const categoryCounts = { BIZ: 0, JOIN: 0, FORMULA: 0, BIND: 0, GOVERN: 0 };
    for (const [index, edge] of manifest.edges.entries()) {
      if (edgeKeys.has(edge.edge_key)) {
        context.addIssue({
          code: "custom",
          message: "Graph manifest contains a duplicate edge key.",
          path: ["edges", index, "edge_key"],
        });
      }
      edgeKeys.add(edge.edge_key);
      categoryCounts[edge.category] += 1;
      if (!nodeKeys.has(edge.source_node_key) || !nodeKeys.has(edge.target_node_key)) {
        context.addIssue({
          code: "custom",
          message: "Graph manifest edge endpoints must exist.",
          path: ["edges", index],
        });
      }
    }

    const governanceNodes = manifest.nodes.length - semanticNodes;
    if (
      manifest.counts.total_nodes !== manifest.nodes.length ||
      manifest.counts.semantic_nodes !== semanticNodes ||
      manifest.counts.governance_nodes !== governanceNodes ||
      manifest.counts.total_edges !== manifest.edges.length ||
      semanticRelationshipEdgeCategorySchema.options.some(
        (category) => manifest.counts.by_category[category] !== categoryCounts[category],
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Graph manifest counts must match exact nodes and edges.",
        path: ["counts"],
      });
    }
  });

export const semanticRelationshipGraphManifestSchema =
  semanticRelationshipGraphManifestMaterialSchema.extend({
    manifest_digest: contentHashSchema,
  });

export async function computeSemanticRelationshipGraphManifestDigest(
  input: z.input<typeof semanticRelationshipGraphManifestMaterialSchema>,
): Promise<`sha256:${string}`> {
  return sha256ContentHash(semanticRelationshipGraphManifestMaterialSchema.parse(input));
}

export const semanticRelationshipIndexCheckpointSchema = z
  .strictObject({
    schema_version: z.literal(SEMANTIC_RELATIONSHIP_INDEX_CHECKPOINT_VERSION),
    semantic_domain: semanticExplorerDomainSchema,
    release_identity: semanticExplorerReleaseIdentitySchema,
    state: semanticRelationshipIndexStateSchema,
    attempt_id: immutableIdSchema.nullable(),
    attempt_fence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable(),
    build_id: immutableIdSchema.nullable(),
    manifest_digest: contentHashSchema.nullable(),
    relationship_projection_digest: contentHashSchema,
    node_count: z.number().int().min(0).nullable(),
    edge_count: z.number().int().min(0).nullable(),
    reason_code: semanticRelationshipIndexReasonCodeSchema.nullable(),
    observed_at: timestampSchema,
    indexed_at: timestampSchema.nullable(),
  })
  .superRefine((checkpoint, context) => {
    if (
      checkpoint.semantic_domain !== checkpoint.release_identity.semantic_domain ||
      checkpoint.relationship_projection_digest !==
        checkpoint.release_identity.relationship_projection.projection_digest
    ) {
      context.addIssue({
        code: "custom",
        message: "Relationship index checkpoint must bind the exact release projection.",
        path: ["release_identity"],
      });
    }
    const readyFields = [
      checkpoint.attempt_id,
      checkpoint.attempt_fence,
      checkpoint.build_id,
      checkpoint.manifest_digest,
      checkpoint.node_count,
      checkpoint.edge_count,
      checkpoint.indexed_at,
    ];
    if (
      checkpoint.state === "READY" &&
      (readyFields.some((field) => field === null) || checkpoint.reason_code !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "A READY relationship index checkpoint requires a complete receipt.",
        path: ["state"],
      });
    }
    if (checkpoint.state !== "READY" && checkpoint.indexed_at !== null) {
      context.addIssue({
        code: "custom",
        message: "Only a READY relationship index checkpoint may have indexed_at.",
        path: ["indexed_at"],
      });
    }
  });

export const semanticRelationshipReleaseSelectorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ACTIVE") }),
  z.strictObject({ kind: z.literal("HISTORICAL"), release_id: immutableIdSchema }),
]);

export const semanticRelationshipSearchRequestSchema = z
  .strictObject({
    schema_version: z.literal(SEMANTIC_RELATIONSHIP_SEARCH_REQUEST_VERSION),
    semantic_domain: semanticExplorerDomainSchema,
    release: semanticRelationshipReleaseSelectorSchema,
    root: semanticExplorerObjectIdentitySchema.nullable(),
    term: z.string().trim().min(1).max(128).nullable(),
    categories: z.array(semanticRelationshipEdgeCategorySchema).min(1).max(5),
    direction: z.enum(["upstream", "downstream", "both"]),
    hop_limit: z.number().int().min(1).max(6),
    node_limit: z.number().int().min(1).max(250),
    edge_limit: z.number().int().min(1).max(500),
  })
  .superRefine((request, context) => {
    if (new Set(request.categories).size !== request.categories.length) {
      context.addIssue({
        code: "custom",
        message: "Relationship search categories must be unique.",
        path: ["categories"],
      });
    }
  });

export const semanticRelationshipSearchExplanationSchema = z.strictObject({
  summary: z.string().min(1).max(2048),
  requested_hop_limit: z.number().int().min(1).max(6),
  traversed_hops: z.number().int().min(0).max(6),
  categories: z.array(semanticRelationshipEdgeCategorySchema).min(1).max(5),
  authority_revalidated: z.boolean(),
  fallback_reason: semanticRelationshipIndexReasonCodeSchema.nullable(),
});

export const semanticRelationshipSearchResultSchema = z
  .strictObject({
    schema_version: z.literal(SEMANTIC_RELATIONSHIP_SEARCH_RESULT_VERSION),
    release_identity: semanticExplorerReleaseIdentitySchema,
    pointer_observation: semanticExplorerPointerObservationSchema,
    is_active: z.boolean(),
    source: z.enum(["NEO4J", "POSTGRESQL_FALLBACK"]),
    index_state: semanticRelationshipIndexStateSchema,
    index_reason_code: semanticRelationshipIndexReasonCodeSchema.nullable(),
    manifest_digest: contentHashSchema.nullable(),
    root: semanticExplorerObjectIdentitySchema.nullable(),
    term: z.string().min(1).max(128).nullable(),
    categories: z.array(semanticRelationshipEdgeCategorySchema).min(1).max(5),
    nodes: z.array(semanticRelationshipGraphNodeSchema).max(250),
    edges: z.array(semanticRelationshipGraphEdgeSchema).max(500),
    truncated: z.boolean(),
    truncation_reasons: z.array(z.enum(["HOP_LIMIT", "NODE_LIMIT", "EDGE_LIMIT"])),
    explanation: semanticRelationshipSearchExplanationSchema,
  })
  .superRefine((result, context) => {
    const nodeKeys = new Set(result.nodes.map((node) => node.node_key));
    for (const [index, edge] of result.edges.entries()) {
      if (!nodeKeys.has(edge.source_node_key) || !nodeKeys.has(edge.target_node_key)) {
        context.addIssue({
          code: "custom",
          message: "Relationship search result edges must have returned endpoints.",
          path: ["edges", index],
        });
      }
    }
    if (result.is_active) {
      const pointer = result.pointer_observation;
      const release = result.release_identity;
      if (
        pointer.current_release_id !== release.release_id ||
        pointer.current_release_generation !== release.release_generation ||
        pointer.current_release_digest !== release.release_digest
      ) {
        context.addIssue({
          code: "custom",
          message: "An active relationship result must match the PostgreSQL pointer exactly.",
          path: ["is_active"],
        });
      }
    }
    if (result.source === "NEO4J" && (result.index_state !== "READY" || !result.manifest_digest)) {
      context.addIssue({
        code: "custom",
        message: "A Neo4j result requires an exact READY checkpoint and manifest digest.",
        path: ["source"],
      });
    }
    if (
      result.explanation.categories.length !== result.categories.length ||
      result.categories.some((category, index) => result.explanation.categories[index] !== category)
    ) {
      context.addIssue({
        code: "custom",
        message: "Relationship search explanation must preserve requested categories.",
        path: ["explanation", "categories"],
      });
    }
  });

export type SemanticRelationshipEdgeCategory = z.infer<
  typeof semanticRelationshipEdgeCategorySchema
>;
export type SemanticRelationshipIndexState = z.infer<typeof semanticRelationshipIndexStateSchema>;
export type SemanticRelationshipIndexReasonCode = z.infer<
  typeof semanticRelationshipIndexReasonCodeSchema
>;
export type SemanticRelationshipGraphNode = z.infer<typeof semanticRelationshipGraphNodeSchema>;
export type SemanticRelationshipGraphEdge = z.infer<typeof semanticRelationshipGraphEdgeSchema>;
export type SemanticRelationshipGraphManifest = z.infer<
  typeof semanticRelationshipGraphManifestSchema
>;
export type SemanticRelationshipIndexCheckpoint = z.infer<
  typeof semanticRelationshipIndexCheckpointSchema
>;
export type SemanticRelationshipSearchRequest = z.infer<
  typeof semanticRelationshipSearchRequestSchema
>;
export type SemanticRelationshipSearchResult = z.infer<
  typeof semanticRelationshipSearchResultSchema
>;
