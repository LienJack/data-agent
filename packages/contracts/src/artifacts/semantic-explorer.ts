import { z } from "zod";
import {
  contentHashSchema,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import { candidateStatusSchema } from "./semantic-control-plane.js";
import {
  businessOntologySchema,
  catalogGovernanceSchema,
  formulaSignatureSchema,
  grainSchema,
  physicalBindingSchema,
  semanticRelationshipSchema,
  timeDomainSchema,
  unitSchema,
} from "./semantic-governance.js";
import { semanticDiffSchema } from "./semantic-governance-requests.js";
import { DATA_TYPE, SENSITIVITY_LEVEL } from "./text2sql-primitives.js";

export const SEMANTIC_EXPLORER_SNAPSHOT_VERSION = "semantic-explorer-snapshot@1.0.0" as const;
export const SEMANTIC_EXPLORER_SIDECAR_VERSION = "semantic-explorer-sidecar@1.0.0" as const;
export const SEMANTIC_EXPLORER_RELEASE_SUMMARY_VERSION =
  "semantic-explorer-release-summary@1.0.0" as const;
export const SEMANTIC_EXPLORER_RELEASE_TIMELINE_VERSION =
  "semantic-explorer-release-timeline@1.0.0" as const;
export const SEMANTIC_EXPLORER_DOMAIN_SUMMARY_VERSION =
  "semantic-explorer-domain-summary@1.0.0" as const;
export const SEMANTIC_EXPLORER_DIFF_VERSION = "semantic-explorer-diff@1.0.0" as const;
export const SEMANTIC_EXPLORER_LINEAGE_VERSION = "semantic-explorer-lineage@1.0.0" as const;
export const SEMANTIC_EXPLORER_CANDIDATE_COMPARISON_VERSION =
  "semantic-explorer-candidate-comparison@1.0.0" as const;
export const SEMANTIC_EXPLORER_CANDIDATE_SOURCE_VERSION =
  "semantic-explorer-candidate-source@1.0.0" as const;

const semanticDomainSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/);
const safeDisplayStringSchema = z.string().min(1).max(4096);
const nullableDescriptionSchema = z.string().max(2048).nullable();

export const semanticExplorerObjectKindSchema = z.enum([
  "business_entity",
  "business_event",
  "business_term",
  "metric",
  "dimension",
  "relationship",
  "datasource",
]);

export const semanticExplorerEdgeKindSchema = z.enum([
  "metric_dependency",
  "dimension_hierarchy",
  "analytical_relationship",
  "business_relationship",
  "physical_binding",
]);

export const semanticExplorerObjectIdentitySchema = z.strictObject({
  kind: semanticExplorerObjectKindSchema,
  object_id: versionIdentifierSchema,
});

export const semanticExplorerProjectionIdentitySchema = z.strictObject({
  projection_id: immutableIdSchema,
  projection_digest: contentHashSchema,
});

export const semanticExplorerReleaseIdentitySchema = z.strictObject({
  semantic_domain: semanticDomainSchema,
  release_id: immutableIdSchema,
  release_generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  release_digest: contentHashSchema,
  executable_projection: semanticExplorerProjectionIdentitySchema,
  relationship_projection: semanticExplorerProjectionIdentitySchema,
  runtime_restriction_projection: semanticExplorerProjectionIdentitySchema,
  published_at: timestampSchema,
  published_by: z.string().min(1).max(256),
});

export const semanticExplorerPointerObservationSchema = z
  .strictObject({
    current_release_id: immutableIdSchema.nullable(),
    current_release_generation: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    current_release_digest: contentHashSchema.nullable(),
    pointer_generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    observed_at: timestampSchema,
  })
  .superRefine((pointer, context) => {
    const isEmpty = pointer.current_release_id === null;
    if (
      (isEmpty &&
        (pointer.current_release_generation !== 0 || pointer.current_release_digest !== null)) ||
      (!isEmpty &&
        (pointer.current_release_generation < 1 || pointer.current_release_digest === null))
    ) {
      context.addIssue({
        code: "custom",
        message: "Explorer pointer release identity must be wholly present or wholly absent.",
        path: ["current_release_id"],
      });
    }
  });

export const semanticExplorerBindingSchema = z.strictObject({
  datasource_id: immutableIdSchema,
  schema_name: z.string().min(1).max(256),
  table_name: z.string().min(1).max(256),
  column_name: z.string().min(1).max(256).nullable(),
  lifecycle: z.enum(["active", "deprecated"]),
  valid_from: z.string().nullable(),
  valid_until: z.string().nullable(),
});

const normalizedGrainSchema = grainSchema.extend({
  description: z.string().max(512).nullable(),
});
const normalizedUnitSchema = unitSchema.extend({
  description: z.string().max(512).nullable(),
});
const normalizedTimeDomainSchema = timeDomainSchema.extend({
  description: z.string().max(512).nullable(),
});

const metricPayloadSchema = z.strictObject({
  kind: z.literal("metric"),
  table_id: versionIdentifierSchema,
  column_id: z.string().min(1).max(256),
  aggregation: z.enum(["sum", "count", "count_distinct", "min", "max", "avg"]),
  formula: z
    .strictObject({
      formula_id: versionIdentifierSchema,
      expression: z.string().min(1).max(4096),
      dialect: z.enum(["text2sql", "sql", "python"]),
      description: z.string().max(1024).nullable(),
    })
    .nullable(),
  grain: normalizedGrainSchema,
  unit: normalizedUnitSchema.nullable(),
  time_domain: normalizedTimeDomainSchema.nullable(),
  time_column_id: z.string().min(1).max(256).nullable(),
  additivity: z.enum(["additive", "semi-additive", "non-additive"]),
  null_policy: z.enum(["preserve", "coalesce-zero", "exclude"]),
  fanout_policy: z.enum(["reject", "preaggregate"]),
  dependency_column_ids: z.array(z.string().min(1).max(256)),
  tags: z.array(z.string().min(1).max(128)),
  bindings: z.array(semanticExplorerBindingSchema),
});

const dimensionPayloadSchema = z.strictObject({
  kind: z.literal("dimension"),
  table_id: versionIdentifierSchema,
  column_id: z.string().min(1).max(256),
  grain: normalizedGrainSchema,
  data_type: z.enum(DATA_TYPE),
  sensitivity: z.enum(SENSITIVITY_LEVEL),
  hierarchical: z.boolean(),
  parent_dimension_id: versionIdentifierSchema.nullable(),
  tags: z.array(z.string().min(1).max(128)),
  bindings: z.array(semanticExplorerBindingSchema),
});

const relationshipEndpointSchema = z.strictObject({
  table_id: versionIdentifierSchema,
  column_ids: z.array(z.string().min(1).max(256)).min(1),
});

const explorerObjectPayloadSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("business_entity"),
    domain: z.string().min(1).max(128),
    business_relationship_types: z.array(
      z.strictObject({
        relationship_type: z.string().min(1).max(128),
        target_entity_id: versionIdentifierSchema,
        description: z.string().max(512).nullable(),
      }),
    ),
  }),
  z.strictObject({
    kind: z.literal("business_event"),
    domain: z.string().min(1).max(128),
    subject_entity_id: versionIdentifierSchema,
    event_type: z.string().min(1).max(128),
  }),
  z.strictObject({
    kind: z.literal("business_term"),
    domain: z.string().min(1).max(128),
    definition: z.string().min(1).max(2048),
  }),
  metricPayloadSchema,
  dimensionPayloadSchema,
  z.strictObject({
    kind: z.literal("relationship"),
    relationship_kind: z.enum(["analytical", "physical", "business"]).nullable(),
    left: relationshipEndpointSchema,
    right: relationshipEndpointSchema,
    cardinality: z.enum(["one-to-one", "one-to-many", "many-to-one", "many-to-many"]),
    direction: z.enum(["left-to-right", "right-to-left", "bidirectional"]),
    row_preservation: z.enum(["inner", "left", "right", "full"]),
    fanout_grain_proof: z.string().max(1024).nullable(),
    proof_kind: z.enum(["DDL_ENFORCED", "SNAPSHOT_CERTIFIED", "DECLARED_ONLY"]),
    proof_detail: z.string().max(1024).nullable(),
    bindings: z.array(semanticExplorerBindingSchema),
  }),
  z.strictObject({
    kind: z.literal("datasource"),
    bindings: z.array(
      z.strictObject({
        schema_name: z.string().min(1).max(256),
        table_name: z.string().min(1).max(256),
        column_name: z.string().min(1).max(256).nullable(),
        lifecycle: z.enum(["active", "deprecated"]),
      }),
    ),
    catalog: z
      .strictObject({
        table_count: z.number().int().min(0),
        column_count: z.number().int().min(0),
        newest_snapshot_at: z.string().nullable(),
      })
      .nullable(),
  }),
]);

export const semanticExplorerObjectSchema = z
  .strictObject({
    identity: semanticExplorerObjectIdentitySchema,
    status: z.enum(["published", "deprecated"]),
    canonical_digest: contentHashSchema,
    name: safeDisplayStringSchema,
    description: nullableDescriptionSchema,
    aliases: z.array(z.string().min(1).max(128)),
    owner: z.string().min(1).max(256).nullable(),
    restricted: z.boolean(),
    payload: explorerObjectPayloadSchema,
  })
  .superRefine((value, context) => {
    if (value.identity.kind !== value.payload.kind) {
      context.addIssue({
        code: "custom",
        message: "Explorer object identity kind must match payload kind.",
        path: ["identity", "kind"],
      });
    }
  });

const semanticExplorerEdgePayloadSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("metric_dependency"),
    formula_id: versionIdentifierSchema.nullable(),
  }),
  z.strictObject({ kind: z.literal("dimension_hierarchy") }),
  z.strictObject({
    kind: z.literal("analytical_relationship"),
    relationship_id: versionIdentifierSchema,
  }),
  z.strictObject({
    kind: z.literal("business_relationship"),
    relationship_type: z.string().min(1).max(128),
  }),
  z.strictObject({
    kind: z.literal("physical_binding"),
    datasource_id: immutableIdSchema,
  }),
]);

export const semanticExplorerEdgeSchema = z
  .strictObject({
    edge_id: z.string().min(1).max(1024),
    kind: semanticExplorerEdgeKindSchema,
    source: semanticExplorerObjectIdentitySchema,
    target: semanticExplorerObjectIdentitySchema,
    canonical_digest: contentHashSchema,
    payload: semanticExplorerEdgePayloadSchema,
  })
  .superRefine((value, context) => {
    if (value.kind !== value.payload.kind) {
      context.addIssue({
        code: "custom",
        message: "Explorer edge kind must match payload kind.",
        path: ["kind"],
      });
    }
  });

export const semanticExplorerCountsSchema = z.strictObject({
  total_objects: z.number().int().min(0),
  by_object_kind: z.strictObject({
    business_entity: z.number().int().min(0),
    business_event: z.number().int().min(0),
    business_term: z.number().int().min(0),
    metric: z.number().int().min(0),
    dimension: z.number().int().min(0),
    relationship: z.number().int().min(0),
    datasource: z.number().int().min(0),
  }),
  total_edges: z.number().int().min(0),
  by_edge_kind: z.strictObject({
    metric_dependency: z.number().int().min(0),
    dimension_hierarchy: z.number().int().min(0),
    analytical_relationship: z.number().int().min(0),
    business_relationship: z.number().int().min(0),
    physical_binding: z.number().int().min(0),
  }),
});

function structuralIdentityKey(identity: z.infer<typeof semanticExplorerObjectIdentitySchema>) {
  return JSON.stringify([identity.kind, identity.object_id]);
}

export const semanticExplorerSnapshotSchema = z
  .strictObject({
    schema_version: z.literal(SEMANTIC_EXPLORER_SNAPSHOT_VERSION),
    authority: z.literal("POSTGRESQL"),
    release_identity: semanticExplorerReleaseIdentitySchema,
    pointer_observation: semanticExplorerPointerObservationSchema,
    is_active: z.boolean(),
    capabilities: z.strictObject({
      business_ontology: z.boolean(),
      physical_binding: z.boolean(),
      catalog_governance: z.boolean(),
    }),
    objects: z.array(semanticExplorerObjectSchema),
    edges: z.array(semanticExplorerEdgeSchema),
    counts: semanticExplorerCountsSchema,
  })
  .superRefine((value, context) => {
    const objectKeys = new Set<string>();
    for (const [index, object] of value.objects.entries()) {
      const key = structuralIdentityKey(object.identity);
      if (objectKeys.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Duplicate Explorer object identity.",
          path: ["objects", index, "identity"],
        });
      }
      objectKeys.add(key);
    }

    const edgeKeys = new Set<string>();
    for (const [index, edge] of value.edges.entries()) {
      const key = JSON.stringify([edge.kind, edge.edge_id]);
      if (edgeKeys.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Duplicate Explorer edge identity.",
          path: ["edges", index, "edge_id"],
        });
      }
      edgeKeys.add(key);
      if (!objectKeys.has(structuralIdentityKey(edge.source))) {
        context.addIssue({
          code: "custom",
          message: "Explorer edge has a dangling source endpoint.",
          path: ["edges", index, "source"],
        });
      }
      if (!objectKeys.has(structuralIdentityKey(edge.target))) {
        context.addIssue({
          code: "custom",
          message: "Explorer edge has a dangling target endpoint.",
          path: ["edges", index, "target"],
        });
      }
    }

    if (value.is_active) {
      const release = value.release_identity;
      const pointer = value.pointer_observation;
      if (
        pointer.current_release_id !== release.release_id ||
        pointer.current_release_generation !== release.release_generation ||
        pointer.current_release_digest !== release.release_digest
      ) {
        context.addIssue({
          code: "custom",
          message: "An active Explorer snapshot must match the observed pointer exactly.",
          path: ["is_active"],
        });
      }
    }

    const actualObjectCounts = {
      business_entity: value.objects.filter((object) => object.identity.kind === "business_entity")
        .length,
      business_event: value.objects.filter((object) => object.identity.kind === "business_event")
        .length,
      business_term: value.objects.filter((object) => object.identity.kind === "business_term")
        .length,
      metric: value.objects.filter((object) => object.identity.kind === "metric").length,
      dimension: value.objects.filter((object) => object.identity.kind === "dimension").length,
      relationship: value.objects.filter((object) => object.identity.kind === "relationship")
        .length,
      datasource: value.objects.filter((object) => object.identity.kind === "datasource").length,
    };
    const actualEdgeCounts = {
      metric_dependency: value.edges.filter((edge) => edge.kind === "metric_dependency").length,
      dimension_hierarchy: value.edges.filter((edge) => edge.kind === "dimension_hierarchy").length,
      analytical_relationship: value.edges.filter((edge) => edge.kind === "analytical_relationship")
        .length,
      business_relationship: value.edges.filter((edge) => edge.kind === "business_relationship")
        .length,
      physical_binding: value.edges.filter((edge) => edge.kind === "physical_binding").length,
    };
    if (
      value.counts.total_objects !== value.objects.length ||
      semanticExplorerObjectKindSchema.options.some(
        (kind) => value.counts.by_object_kind[kind] !== actualObjectCounts[kind],
      ) ||
      value.counts.total_edges !== value.edges.length ||
      semanticExplorerEdgeKindSchema.options.some(
        (kind) => value.counts.by_edge_kind[kind] !== actualEdgeCounts[kind],
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Explorer counts must equal the exact object and edge collections.",
        path: ["counts"],
      });
    }
  });

export const semanticExplorerSidecarMaterialSchema = z.strictObject({
  schema_version: z.literal(SEMANTIC_EXPLORER_SIDECAR_VERSION),
  business_ontology: businessOntologySchema.nullable(),
  relationships: z.array(semanticRelationshipSchema),
  formula_signatures: z.array(formulaSignatureSchema),
  physical_binding: physicalBindingSchema.nullable(),
  catalog_governance: catalogGovernanceSchema.nullable(),
});

export const semanticExplorerSidecarSchema = semanticExplorerSidecarMaterialSchema.extend({
  sidecar_digest: contentHashSchema,
});

export async function computeSemanticExplorerSidecarDigest(
  input: z.input<typeof semanticExplorerSidecarMaterialSchema>,
): Promise<`sha256:${string}`> {
  return sha256ContentHash(semanticExplorerSidecarMaterialSchema.parse(input));
}

export const semanticExplorerReleaseSummarySchema = z.strictObject({
  schema_version: z.literal(SEMANTIC_EXPLORER_RELEASE_SUMMARY_VERSION),
  release_identity: semanticExplorerReleaseIdentitySchema,
  candidate_id: immutableIdSchema,
  is_current_at_observation: z.boolean(),
});

export const semanticExplorerReleaseTimelineSchema = z
  .strictObject({
    schema_version: z.literal(SEMANTIC_EXPLORER_RELEASE_TIMELINE_VERSION),
    semantic_domain: semanticDomainSchema,
    pointer_observation: semanticExplorerPointerObservationSchema,
    releases: z.array(semanticExplorerReleaseSummarySchema),
    next_generation_cursor: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable(),
  })
  .superRefine((timeline, context) => {
    for (const [index, release] of timeline.releases.entries()) {
      const isCurrent =
        release.release_identity.release_id === timeline.pointer_observation.current_release_id &&
        release.release_identity.release_generation ===
          timeline.pointer_observation.current_release_generation &&
        release.release_identity.release_digest ===
          timeline.pointer_observation.current_release_digest;
      if (
        release.release_identity.semantic_domain !== timeline.semantic_domain ||
        release.is_current_at_observation !== isCurrent
      ) {
        context.addIssue({
          code: "custom",
          message: "Explorer release timeline identity is inconsistent.",
          path: ["releases", index],
        });
      }
    }
  });

export const semanticExplorerDomainSummarySchema = z
  .strictObject({
    schema_version: z.literal(SEMANTIC_EXPLORER_DOMAIN_SUMMARY_VERSION),
    semantic_domain: semanticDomainSchema,
    display_name: z.string().min(1).max(256),
    description: z.string().max(1024).nullable(),
    datasource_id: immutableIdSchema,
    pointer_observation: semanticExplorerPointerObservationSchema,
    has_current_release: z.boolean(),
  })
  .superRefine((domain, context) => {
    if (domain.has_current_release !== (domain.pointer_observation.current_release_id !== null)) {
      context.addIssue({
        code: "custom",
        message: "Explorer domain current-release flag is inconsistent.",
        path: ["has_current_release"],
      });
    }
  });

const semanticExplorerObjectDigestEntrySchema = z.strictObject({
  identity: semanticExplorerObjectIdentitySchema,
  canonical_digest: contentHashSchema,
});
const semanticExplorerObjectChangeSchema = z.strictObject({
  identity: semanticExplorerObjectIdentitySchema,
  before_digest: contentHashSchema,
  after_digest: contentHashSchema,
});
const semanticExplorerEdgeDigestEntrySchema = z.strictObject({
  kind: semanticExplorerEdgeKindSchema,
  edge_id: z.string().min(1).max(1024),
  canonical_digest: contentHashSchema,
});
const semanticExplorerEdgeChangeSchema = z.strictObject({
  kind: semanticExplorerEdgeKindSchema,
  edge_id: z.string().min(1).max(1024),
  before_digest: contentHashSchema,
  after_digest: contentHashSchema,
});

export const semanticExplorerDiffSchema = z.strictObject({
  schema_version: z.literal(SEMANTIC_EXPLORER_DIFF_VERSION),
  base_release: semanticExplorerReleaseIdentitySchema,
  target_release: semanticExplorerReleaseIdentitySchema,
  objects: z.strictObject({
    added: z.array(semanticExplorerObjectDigestEntrySchema),
    removed: z.array(semanticExplorerObjectDigestEntrySchema),
    changed: z.array(semanticExplorerObjectChangeSchema),
  }),
  edges: z.strictObject({
    added: z.array(semanticExplorerEdgeDigestEntrySchema),
    removed: z.array(semanticExplorerEdgeDigestEntrySchema),
    changed: z.array(semanticExplorerEdgeChangeSchema),
  }),
});

export const semanticExplorerLineageSchema = z.strictObject({
  schema_version: z.literal(SEMANTIC_EXPLORER_LINEAGE_VERSION),
  release_identity: semanticExplorerReleaseIdentitySchema,
  root: semanticExplorerObjectIdentitySchema,
  direction: z.enum(["upstream", "downstream", "both"]),
  hop_limit: z.number().int().min(1).max(6),
  nodes: z.array(semanticExplorerObjectSchema).max(250),
  edges: z.array(semanticExplorerEdgeSchema).max(500),
  cycles_detected: z.boolean(),
  truncated: z.boolean(),
  truncation_reasons: z.array(z.enum(["HOP_LIMIT", "NODE_LIMIT", "EDGE_LIMIT"])),
});

export const semanticExplorerCandidateComparisonStateSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("candidate"), reason_code: z.null() }),
  z.strictObject({
    state: z.literal("stale"),
    reason_code: z.enum([
      "CANDIDATE_GOVERNANCE_STALE",
      "BASE_RELEASE_MISSING",
      "BASE_RELEASE_ID_MISMATCH",
      "BASE_RELEASE_GENERATION_MISMATCH",
      "BASE_RELEASE_DIGEST_MISMATCH",
    ]),
  }),
]);

export const semanticExplorerCandidateComparisonSchema = z.strictObject({
  schema_version: z.literal(SEMANTIC_EXPLORER_CANDIDATE_COMPARISON_VERSION),
  semantic_domain: semanticDomainSchema,
  candidate_id: immutableIdSchema,
  revision_id: immutableIdSchema,
  revision_number: z.number().int().min(1).max(2_147_483_647),
  source_revision_id: immutableIdSchema,
  candidate_status: candidateStatusSchema,
  base_release: semanticExplorerReleaseIdentitySchema.nullable(),
  compared_release: semanticExplorerReleaseIdentitySchema.nullable(),
  comparison_state: semanticExplorerCandidateComparisonStateSchema,
  diff: semanticDiffSchema,
});

export const semanticExplorerRawCandidateComparisonSchema = z.strictObject({
  schema_version: z.literal(SEMANTIC_EXPLORER_CANDIDATE_SOURCE_VERSION),
  semantic_domain: semanticDomainSchema,
  candidate_id: immutableIdSchema,
  revision_id: immutableIdSchema,
  revision_number: z.number().int().min(1).max(2_147_483_647),
  source_revision_id: immutableIdSchema,
  candidate_status: candidateStatusSchema,
  base_release: semanticExplorerReleaseIdentitySchema.nullable(),
  compared_release: semanticExplorerReleaseIdentitySchema.nullable(),
  candidate_diff: semanticDiffSchema,
});

const rawPointerSchema = z.strictObject({
  semantic_domain: semanticDomainSchema,
  current_release_id: immutableIdSchema.nullable(),
  current_release_generation: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  current_release_digest: contentHashSchema.nullable(),
  pointer_generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  updated_at: timestampSchema,
});

const rawReleaseSchema = z.strictObject({
  semantic_domain: semanticDomainSchema,
  release_id: immutableIdSchema,
  release_generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  release_digest: contentHashSchema,
  compiler_bundle_digest: contentHashSchema,
  candidate_id: immutableIdSchema,
  executable_projection_ref: immutableIdSchema,
  executable_projection_hash: contentHashSchema,
  relationship_projection_ref: immutableIdSchema,
  relationship_projection_hash: contentHashSchema,
  runtime_restriction_projection_ref: immutableIdSchema,
  runtime_restriction_projection_hash: contentHashSchema,
  published_at: timestampSchema,
  published_by: z.string().min(1).max(256),
});

const rawProjectionSchema = z.strictObject({
  projection_id: immutableIdSchema,
  release_id: immutableIdSchema,
  projection_digest: contentHashSchema,
  projection_payload: z.unknown(),
});

const rawRelationshipProjectionSchema = rawProjectionSchema.extend({
  datasource_id: immutableIdSchema,
  catalog_epoch: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

const rawRuntimeRestrictionProjectionSchema = rawProjectionSchema.extend({
  pointer_generation: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

export const semanticExplorerRawSourceEnvelopeSchema = z.strictObject({
  source_kind: z.enum(["ACTIVE", "HISTORICAL"]),
  observed_at: timestampSchema,
  pointer: rawPointerSchema,
  release: rawReleaseSchema,
  executable_projection: rawProjectionSchema,
  relationship_projection: rawRelationshipProjectionSchema,
  runtime_restriction_projection: rawRuntimeRestrictionProjectionSchema,
});

export const semanticExplorerErrorCodeSchema = z.enum([
  "SEMANTIC_EXPLORER_DISABLED",
  "SEMANTIC_EXPLORER_INVALID_PARAMS",
  "SEMANTIC_EXPLORER_UNAVAILABLE",
  "SEMANTIC_EXPLORER_CONFIG_INVALID",
  "SEMANTIC_UNAUTHENTICATED",
  "SEMANTIC_EXPLORER_INVALID_SOURCE_ENVELOPE",
  "SEMANTIC_EXPLORER_SOURCE_BINDING_MISMATCH",
  "SEMANTIC_EXPLORER_PROJECTION_PAYLOAD_INVALID",
  "SEMANTIC_EXPLORER_SIDECAR_DIGEST_MISMATCH",
  "SEMANTIC_EXPLORER_DUPLICATE_IDENTITY",
  "SEMANTIC_EXPLORER_DANGLING_EDGE",
  "SEMANTIC_EXPLORER_PERMISSION_DENIED",
  "SEMANTIC_EXPLORER_OBJECT_NOT_VISIBLE",
  "SEMANTIC_EXPLORER_RELEASE_NOT_FOUND",
  "SEMANTIC_EXPLORER_LINEAGE_LIMIT_INVALID",
  "SEMANTIC_EXPLORER_CANDIDATE_COMPARISON_INVALID",
]);

export const semanticExplorerErrorSchema = z.strictObject({
  code: semanticExplorerErrorCodeSchema,
  message: z.string().min(1).max(256),
  retryable: z.boolean(),
});

export type SemanticExplorerObjectKind = z.infer<typeof semanticExplorerObjectKindSchema>;
export type SemanticExplorerEdgeKind = z.infer<typeof semanticExplorerEdgeKindSchema>;
export type SemanticExplorerObjectIdentity = z.infer<typeof semanticExplorerObjectIdentitySchema>;
export type SemanticExplorerProjectionIdentity = z.infer<
  typeof semanticExplorerProjectionIdentitySchema
>;
export type SemanticExplorerReleaseIdentity = z.infer<typeof semanticExplorerReleaseIdentitySchema>;
export type SemanticExplorerPointerObservation = z.infer<
  typeof semanticExplorerPointerObservationSchema
>;
export type SemanticExplorerBinding = z.infer<typeof semanticExplorerBindingSchema>;
export type SemanticExplorerObject = z.infer<typeof semanticExplorerObjectSchema>;
export type SemanticExplorerEdge = z.infer<typeof semanticExplorerEdgeSchema>;
export type SemanticExplorerCounts = z.infer<typeof semanticExplorerCountsSchema>;
export type SemanticExplorerSnapshot = z.infer<typeof semanticExplorerSnapshotSchema>;
export type SemanticExplorerSidecarMaterial = z.infer<typeof semanticExplorerSidecarMaterialSchema>;
export type SemanticExplorerSidecar = z.infer<typeof semanticExplorerSidecarSchema>;
export type SemanticExplorerReleaseSummary = z.infer<typeof semanticExplorerReleaseSummarySchema>;
export type SemanticExplorerReleaseTimeline = z.infer<typeof semanticExplorerReleaseTimelineSchema>;
export type SemanticExplorerDomainSummary = z.infer<typeof semanticExplorerDomainSummarySchema>;
export type SemanticExplorerDiff = z.infer<typeof semanticExplorerDiffSchema>;
export type SemanticExplorerLineage = z.infer<typeof semanticExplorerLineageSchema>;
export type SemanticExplorerCandidateComparison = z.infer<
  typeof semanticExplorerCandidateComparisonSchema
>;
export type SemanticExplorerRawCandidateComparison = z.infer<
  typeof semanticExplorerRawCandidateComparisonSchema
>;
export type SemanticExplorerRawSourceEnvelope = z.infer<
  typeof semanticExplorerRawSourceEnvelopeSchema
>;
export type SemanticExplorerErrorCode = z.infer<typeof semanticExplorerErrorCodeSchema>;
export type SemanticExplorerError = z.infer<typeof semanticExplorerErrorSchema>;
