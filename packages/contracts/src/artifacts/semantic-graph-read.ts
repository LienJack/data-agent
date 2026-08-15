import { z } from "zod";
import { contentHashSchema, immutableIdSchema, versionIdentifierSchema } from "../common/index.js";
import {
  semanticEdgeFamilySchema,
  semanticGraphEdgeSchema,
  semanticGraphNodeSchema,
  semanticLifecycleSchema,
  semanticNodeTypeSchema,
} from "./semantic-graph-v2.js";

export const SEMANTIC_GRAPH_READ_VERSION = "semantic-graph-read@1" as const;

export const semanticGraphEntryStatusSchema = z.enum(["PUBLISHED", "ADDED", "MODIFIED", "RETIRED"]);

export const semanticGraphRelationCountSchema = z.strictObject({
  incoming: z.number().int().nonnegative(),
  outgoing: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  by_family: z.record(semanticEdgeFamilySchema, z.number().int().nonnegative()),
});

export const semanticGraphReadNodeSchema = z.strictObject({
  node: semanticGraphNodeSchema,
  status: semanticGraphEntryStatusSchema,
  relation_count: semanticGraphRelationCountSchema,
});

export const semanticGraphReadEdgeSchema = z.strictObject({
  edge: semanticGraphEdgeSchema,
  status: semanticGraphEntryStatusSchema,
});

export const semanticGraphReadIdentitySchema = z.strictObject({
  read_version: z.literal(SEMANTIC_GRAPH_READ_VERSION),
  graph_id: immutableIdSchema,
  published_source_digest: contentHashSchema,
  candidate_source_digest: contentHashSchema.nullable(),
  consistency_token: contentHashSchema,
});

export const semanticGraphNodeListQuerySchema = z.strictObject({
  search: z.string().max(256).default(""),
  node_types: z.array(semanticNodeTypeSchema).default([]),
  owners: z.array(versionIdentifierSchema).default([]),
  lifecycles: z.array(semanticLifecycleSchema).default([]),
  statuses: z.array(semanticGraphEntryStatusSchema).default([]),
  domains: z.array(z.string().min(1).max(256)).default([]),
  sort: z.enum(["NAME_ASC", "NAME_DESC", "TYPE_ASC", "RELATIONS_DESC"]).default("NAME_ASC"),
  cursor: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(250).default(50),
});

export const semanticGraphNodeListResultSchema = z.strictObject({
  identity: semanticGraphReadIdentitySchema,
  items: z.array(semanticGraphReadNodeSchema),
  total: z.number().int().nonnegative(),
  next_cursor: z.number().int().nonnegative().nullable(),
  domains: z.array(z.string()),
});

export const semanticGraphNeighborhoodQuerySchema = z.strictObject({
  center_node_id: versionIdentifierSchema,
  hops: z.union([z.literal(1), z.literal(2)]).default(1),
  direction: z.enum(["BOTH", "INCOMING", "OUTGOING"]).default("BOTH"),
  families: z.array(semanticEdgeFamilySchema).default([]),
  continuation: z.number().int().nonnegative().default(0),
  node_limit: z.number().int().min(1).max(250).default(250),
  edge_limit: z.number().int().min(1).max(500).default(500),
});

export const semanticGraphNeighborhoodResultSchema = z.strictObject({
  identity: semanticGraphReadIdentitySchema,
  center_node_id: versionIdentifierSchema,
  nodes: z.array(semanticGraphReadNodeSchema),
  edges: z.array(semanticGraphReadEdgeSchema),
  truncated: z.boolean(),
  omitted_node_count: z.number().int().nonnegative(),
  omitted_edge_count: z.number().int().nonnegative(),
  next_continuation: z.number().int().nonnegative().nullable(),
});

export const semanticGraphPathQuerySchema = z.strictObject({
  source_node_id: versionIdentifierSchema,
  target_node_id: versionIdentifierSchema,
  families: z.array(semanticEdgeFamilySchema).default([]),
  max_hops: z.number().int().min(1).max(12).default(6),
});

export const semanticGraphPathResultSchema = z.strictObject({
  identity: semanticGraphReadIdentitySchema,
  found: z.boolean(),
  nodes: z.array(semanticGraphReadNodeSchema),
  edges: z.array(semanticGraphReadEdgeSchema),
});

export const semanticGraphImpactResultSchema = z.strictObject({
  identity: semanticGraphReadIdentitySchema,
  root_node_id: versionIdentifierSchema,
  nodes: z.array(semanticGraphReadNodeSchema),
  edges: z.array(semanticGraphReadEdgeSchema),
  truncated: z.boolean(),
});

export const semanticGraphClusterSchema = z.strictObject({
  cluster_id: versionIdentifierSchema,
  label: z.string().min(1).max(256),
  kind: z.enum(["DOMAIN", "PHYSICAL_SCHEMA", "UNASSIGNED"]),
  node_count: z.number().int().nonnegative(),
  edge_count: z.number().int().nonnegative(),
  candidate_count: z.number().int().nonnegative(),
  node_type_counts: z.record(semanticNodeTypeSchema, z.number().int().nonnegative()),
  top_hub_node_ids: z.array(versionIdentifierSchema).max(8),
  position: z.strictObject({ x: z.number().finite(), y: z.number().finite() }),
});

export const semanticGraphFullQuerySchema = z.strictObject({
  expanded_cluster_ids: z.array(versionIdentifierSchema).max(24).default([]),
  node_types: z.array(semanticNodeTypeSchema).default([]),
  families: z.array(semanticEdgeFamilySchema).default([]),
  statuses: z.array(semanticGraphEntryStatusSchema).default([]),
  glyph_limit: z.number().int().min(1).max(500).default(500),
});

export const semanticGraphFullResultSchema = z.strictObject({
  identity: semanticGraphReadIdentitySchema,
  hierarchy_digest: contentHashSchema,
  clusters: z.array(semanticGraphClusterSchema),
  nodes: z.array(semanticGraphReadNodeSchema),
  edges: z.array(semanticGraphReadEdgeSchema),
  glyph_count: z.number().int().nonnegative(),
  truncated: z.boolean(),
  omitted_glyph_count: z.number().int().nonnegative(),
});

export type SemanticGraphEntryStatus = z.infer<typeof semanticGraphEntryStatusSchema>;
export type SemanticGraphReadNode = z.infer<typeof semanticGraphReadNodeSchema>;
export type SemanticGraphReadEdge = z.infer<typeof semanticGraphReadEdgeSchema>;
export type SemanticGraphReadIdentity = z.infer<typeof semanticGraphReadIdentitySchema>;
export type SemanticGraphNodeListQuery = z.infer<typeof semanticGraphNodeListQuerySchema>;
export type SemanticGraphNodeListResult = z.infer<typeof semanticGraphNodeListResultSchema>;
export type SemanticGraphNeighborhoodQuery = z.infer<typeof semanticGraphNeighborhoodQuerySchema>;
export type SemanticGraphNeighborhoodResult = z.infer<typeof semanticGraphNeighborhoodResultSchema>;
export type SemanticGraphPathQuery = z.infer<typeof semanticGraphPathQuerySchema>;
export type SemanticGraphPathResult = z.infer<typeof semanticGraphPathResultSchema>;
export type SemanticGraphImpactResult = z.infer<typeof semanticGraphImpactResultSchema>;
export type SemanticGraphCluster = z.infer<typeof semanticGraphClusterSchema>;
export type SemanticGraphFullQuery = z.infer<typeof semanticGraphFullQuerySchema>;
export type SemanticGraphFullResult = z.infer<typeof semanticGraphFullResultSchema>;
