import { z } from "zod";
import {
  canonicalizeJson,
  contentHashSchema,
  deepFreeze,
  environmentSchema,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import { semanticFormulaExpressionSchema, semanticGraphSourceSchema } from "./semantic-graph-v2.js";

export const ONTOLOGY_PACKAGE_VERSION = "ontology-package@1.0.0" as const;
export const ONTOLOGY_OBJECT_ID_VERSION = "ontology-object-id@1.0.0" as const;
export const ONTOLOGY_NAMESPACE_ID_VERSION = "ontology-namespace-id@1.0.0" as const;
export const ONTOLOGY_PACKAGE_ID_VERSION = "ontology-package-id@1.0.0" as const;
export const MANDATORY_RELEASE_MANIFEST_VERSION = "mandatory-release-manifest@1.0.0" as const;
export const ONTOLOGY_PACKAGE_VALIDATION_RECEIPT_VERSION =
  "ontology-package-validation@1.0.0" as const;
export const ONTOLOGY_PACKAGE_PREVIEW_VERSION = "ontology-package-preview@1.0.0" as const;
export const ONTOLOGY_ANALYSIS_SOURCE_BINDING_VERSION =
  "ontology-analysis-source-binding@1.0.0" as const;

const stablePathSegmentSchema = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => value.trim() === value, "Object path 不允许前后空白。");

const ontologyNamespaceBaseSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  workspace_id: immutableIdSchema,
  environment: environmentSchema,
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
});

export const ontologyNamespaceSchema = ontologyNamespaceBaseSchema
  .extend({ namespace_id: immutableIdSchema })
  .superRefine((namespace, ctx) => {
    if (namespace.tenant_id !== namespace.workspace_id) {
      ctx.addIssue({
        code: "custom",
        message: "Ontology Namespace 的 workspace_id 必须等于 tenant_id。",
        path: ["workspace_id"],
      });
    }
  });

export const ontologySourceClassSchema = z.enum([
  "SCHEMA",
  "BUSINESS_CONTEXT",
  "POLICY",
  "COMPILER_EVIDENCE",
]);

export const ontologySourceRoleSchema = z.enum([
  "SCHEMA_SNAPSHOT",
  "DDL_CONSTRAINT",
  "QUERY_PROBE",
  "STATISTICS",
  "BUSINESS_SOURCE_BUNDLE",
  "BUSINESS_DOCUMENT",
  "POLICY_DIGEST",
  "COMPILER_RECEIPT",
]);

const SOURCE_ROLE_MATRIX = Object.freeze({
  SCHEMA: new Set(["SCHEMA_SNAPSHOT", "DDL_CONSTRAINT", "QUERY_PROBE", "STATISTICS"]),
  BUSINESS_CONTEXT: new Set(["BUSINESS_SOURCE_BUNDLE", "BUSINESS_DOCUMENT"]),
  POLICY: new Set(["POLICY_DIGEST"]),
  COMPILER_EVIDENCE: new Set(["COMPILER_RECEIPT"]),
} as const);

export const ontologySourceIdentitySchema = z
  .strictObject({
    source_class: ontologySourceClassSchema,
    source_role: ontologySourceRoleSchema,
    namespace_id: immutableIdSchema,
    source_id: immutableIdSchema,
    source_version: z.number().int().positive().safe(),
    source_hash: contentHashSchema,
    object_path: z.array(stablePathSegmentSchema).min(1).max(64),
  })
  .superRefine((source, ctx) => {
    if (!SOURCE_ROLE_MATRIX[source.source_class].has(source.source_role as never)) {
      ctx.addIssue({
        code: "custom",
        message: "Source role 与 allowlisted source class 不匹配。",
        path: ["source_role"],
      });
    }
  });

export const ontologySemanticRoleSchema = z.enum([
  "CONCEPT",
  "CLASS",
  "ENTITY",
  "EVENT",
  "DATA_PROPERTY",
  "OBJECT_PROPERTY",
  "TAXONOMY",
  "ALIGNMENT",
  "CONSTRAINT",
  "PHYSICAL_MAPPING",
  "METRIC",
  "FORMULA",
  "GRAIN",
  "TIME",
  "UNIT",
  "GLOSSARY_TERM",
]);

export const ontologyStableObjectSchema = z.strictObject({
  object_id: immutableIdSchema,
  graph_entry_kind: z.enum(["NODE", "EDGE", "AUXILIARY"]),
  graph_entry_id: versionIdentifierSchema,
  source: ontologySourceIdentitySchema,
  semantic_role: ontologySemanticRoleSchema,
  resolution: z.enum(["RESOLVED", "UNRESOLVED"]),
});

const packagePointerSchema = z.strictObject({
  namespace_id: immutableIdSchema,
  package_id: immutableIdSchema,
  package_version: z.number().int().positive().safe(),
  package_hash: contentHashSchema,
});

export const ontologyPackageDependencySchema = packagePointerSchema.extend({
  dependency_path: z.array(immutableIdSchema).min(1).max(64),
});

export const ontologyPackageImportSchema = packagePointerSchema.extend({
  import_mode: z.enum(["EXACT", "KNOWLEDGE_ONLY"]),
  imported_object_ids: z.array(immutableIdSchema).min(1),
});

export const ontologyPackageSourceBindingSchema = z.strictObject({
  schema_snapshot: ontologySourceIdentitySchema,
  business_source_bundle: ontologySourceIdentitySchema,
  policy: ontologySourceIdentitySchema,
  datasource_id: immutableIdSchema,
});

const ontologyAnalysisSourceBindingMaterialSchema = z
  .strictObject({
    schema_version: z.literal(ONTOLOGY_ANALYSIS_SOURCE_BINDING_VERSION),
    namespace_id: immutableIdSchema,
    package_id: immutableIdSchema,
    package_version: z.number().int().positive().safe(),
    package_hash: contentHashSchema,
    semantic_release_id: immutableIdSchema,
    semantic_release_revision: z.number().int().positive().safe(),
    semantic_release_hash: contentHashSchema,
    semantic_source_bundle: ontologySourceIdentitySchema,
  })
  .superRefine((binding, ctx) => {
    if (
      binding.semantic_source_bundle.source_class !== "BUSINESS_CONTEXT" ||
      binding.semantic_source_bundle.source_role !== "BUSINESS_SOURCE_BUNDLE" ||
      binding.semantic_source_bundle.source_version < 2
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Analysis Source Binding 必须绑定 SemanticSourceBundle@2 或更高版本。",
        path: ["semantic_source_bundle"],
      });
    }
  });

export const ontologyAnalysisSourceBindingSchema =
  ontologyAnalysisSourceBindingMaterialSchema.extend({ binding_hash: contentHashSchema });

export async function computeOntologyAnalysisSourceBindingHash(input: unknown) {
  const full = ontologyAnalysisSourceBindingSchema.safeParse(input);
  const material = full.success
    ? ontologyAnalysisSourceBindingMaterialSchema.parse(
        Object.fromEntries(Object.entries(full.data).filter(([key]) => key !== "binding_hash")),
      )
    : ontologyAnalysisSourceBindingMaterialSchema.parse(input);
  return sha256ContentHash(material);
}

export async function buildOntologyAnalysisSourceBinding(input: unknown) {
  const material = ontologyAnalysisSourceBindingMaterialSchema.parse(input);
  return deepFreeze(
    ontologyAnalysisSourceBindingSchema.parse({
      ...material,
      binding_hash: await computeOntologyAnalysisSourceBindingHash(material),
    }),
  );
}

export async function verifyOntologyAnalysisSourceBinding(input: unknown) {
  const binding = ontologyAnalysisSourceBindingSchema.parse(input);
  if ((await computeOntologyAnalysisSourceBindingHash(binding)) !== binding.binding_hash) {
    throw new TypeError("ONTOLOGY_ANALYSIS_SOURCE_BINDING_HASH_MISMATCH");
  }
  return binding;
}

export const ontologyBusinessSubjectSemanticsSchema = z.strictObject({
  object_id: immutableIdSchema,
  graph_node_id: versionIdentifierSchema,
  role: z.enum(["CONCEPT", "CLASS", "ENTITY", "EVENT"]),
});

export const ontologyDimensionSemanticsSchema = z.strictObject({
  object_id: immutableIdSchema,
  graph_node_id: versionIdentifierSchema,
  data_type: z.enum([
    "boolean",
    "date",
    "integer",
    "numeric",
    "text",
    "timestamp",
    "timestamptz",
    "uuid",
  ]),
  unit_object_id: immutableIdSchema.nullable(),
  sensitivity: z.enum(["PUBLIC", "INTERNAL", "RESTRICTED", "SECRET"]),
  required: z.boolean(),
});

export const ontologyEdgeSemanticsSchema = z.strictObject({
  object_id: immutableIdSchema,
  graph_edge_id: versionIdentifierSchema,
  relationship_kind: z.enum(["OBJECT_PROPERTY", "TAXONOMY", "ALIGNMENT"]),
  domain_object_id: immutableIdSchema,
  range_object_id: immutableIdSchema,
  inverse_object_id: immutableIdSchema.nullable(),
  cardinality: z.enum(["ONE_TO_ONE", "ONE_TO_MANY", "MANY_TO_ONE", "MANY_TO_MANY"]),
  taxonomy_relation: z.enum(["PARENT_OF", "CHILD_OF"]).nullable(),
  alignment_relation: z.enum(["EQUIVALENT", "APPROXIMATE", "DISJOINT", "ALIAS"]).nullable(),
});

export const ontologyConstraintRuleSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("REQUIRED"), target_object_id: immutableIdSchema }),
  z.strictObject({
    kind: z.literal("CARDINALITY"),
    target_object_id: immutableIdSchema,
    minimum: z.number().int().nonnegative().safe(),
    maximum: z.number().int().positive().safe().nullable(),
  }),
  z.strictObject({
    kind: z.literal("DATA_TYPE"),
    target_object_id: immutableIdSchema,
    data_type: versionIdentifierSchema,
  }),
  z.strictObject({ kind: z.literal("UNIQUE"), target_object_id: immutableIdSchema }),
  z.strictObject({
    kind: z.literal("BUSINESS_RULE"),
    target_object_id: immutableIdSchema,
    operator: z.enum(["EQ", "NEQ", "GT", "GTE", "LT", "LTE", "IN"]),
    operand: z.union([
      z.string().max(1024),
      z.number().finite(),
      z.boolean(),
      z.array(z.union([z.string().max(256), z.number().finite(), z.boolean()])).min(1),
    ]),
  }),
]);

export const ontologyConstraintSchema = z.strictObject({
  constraint_id: immutableIdSchema,
  target_kind: z.enum(["NODE", "EDGE"]),
  target_object_id: immutableIdSchema,
  constraint_kind: z.enum(["CARDINALITY", "REQUIRED", "DATA_TYPE", "UNIQUE", "BUSINESS_RULE"]),
  rule: ontologyConstraintRuleSchema,
  rule_hash: contentHashSchema,
  provenance_object_ids: z.array(immutableIdSchema).min(1),
  validation_status: z.enum(["VALID", "INVALID", "UNRESOLVED"]),
});

const ontologyPhysicalLocatorSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("TABLE"),
    schema_name: stablePathSegmentSchema,
    table_name: stablePathSegmentSchema,
  }),
  z.strictObject({
    kind: z.literal("COLUMN"),
    schema_name: stablePathSegmentSchema,
    table_name: stablePathSegmentSchema,
    column_name: stablePathSegmentSchema,
  }),
  z.strictObject({
    kind: z.literal("JOIN"),
    left_schema_name: stablePathSegmentSchema,
    left_table_name: stablePathSegmentSchema,
    left_column_name: stablePathSegmentSchema,
    right_schema_name: stablePathSegmentSchema,
    right_table_name: stablePathSegmentSchema,
    right_column_name: stablePathSegmentSchema,
  }),
]);

export const ontologyPhysicalMappingSchema = z.strictObject({
  mapping_id: immutableIdSchema,
  logical_object_id: immutableIdSchema,
  mode: z.enum(["QUERYABLE", "KNOWLEDGE_ONLY"]),
  datasource_id: immutableIdSchema,
  schema_snapshot_id: immutableIdSchema,
  snapshot_content_hash: contentHashSchema,
  physical_locator: ontologyPhysicalLocatorSchema,
  evidence_sources: z.array(ontologySourceIdentitySchema),
  resolution: z.enum(["RESOLVED", "UNRESOLVED"]),
});

export const ontologyMetricBindingSchema = z.strictObject({
  metric_object_id: immutableIdSchema,
  formula_object_id: immutableIdSchema,
  dimension_object_ids: z.array(immutableIdSchema),
  grain_object_ids: z.array(immutableIdSchema),
  time_object_id: immutableIdSchema.nullable(),
  unit_object_id: immutableIdSchema.nullable(),
  formula_ast_hash: contentHashSchema,
  compiler_digest: contentHashSchema,
  resolution: z.enum(["RESOLVED", "UNRESOLVED"]),
});

export const ontologyMandatoryReleaseManifestSchema = z.strictObject({
  manifest_version: z.literal(MANDATORY_RELEASE_MANIFEST_VERSION),
  node_object_ids: z.array(immutableIdSchema),
  edge_object_ids: z.array(immutableIdSchema),
  constraint_ids: z.array(immutableIdSchema),
  mapping_ids: z.array(immutableIdSchema),
  metric_object_ids: z.array(immutableIdSchema),
});

const ontologyPackageCandidateDraftObjectSchema = z.strictObject({
  schema_version: z.literal(ONTOLOGY_PACKAGE_VERSION),
  namespace: ontologyNamespaceSchema,
  package_id: immutableIdSchema,
  package_version: z.number().int().positive().safe(),
  status: z.literal("CANDIDATE"),
  source_binding: ontologyPackageSourceBindingSchema,
  dependencies: z.array(ontologyPackageDependencySchema),
  imports: z.array(ontologyPackageImportSchema),
  objects: z.array(ontologyStableObjectSchema).min(1),
  business_subjects: z.array(ontologyBusinessSubjectSemanticsSchema),
  dimensions: z.array(ontologyDimensionSemanticsSchema),
  edge_semantics: z.array(ontologyEdgeSemanticsSchema),
  constraints: z.array(ontologyConstraintSchema),
  physical_mappings: z.array(ontologyPhysicalMappingSchema),
  metric_bindings: z.array(ontologyMetricBindingSchema),
  graph_source: semanticGraphSourceSchema,
  mandatory_manifest: ontologyMandatoryReleaseManifestSchema,
});

export const ontologyPackageCandidateDraftSchema = ontologyPackageCandidateDraftObjectSchema;
export const ontologyPackageCandidateSchema = ontologyPackageCandidateDraftObjectSchema.extend({
  package_hash: contentHashSchema,
});

export const ontologyPackageValidationIssueSchema = z.strictObject({
  code: versionIdentifierSchema,
  path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
  message: z.string().min(1).max(1024),
  object_id: immutableIdSchema.nullable(),
});

const ontologyPackageValidationReceiptDraftSchema = z.strictObject({
  schema_version: z.literal(ONTOLOGY_PACKAGE_VALIDATION_RECEIPT_VERSION),
  receipt_id: immutableIdSchema,
  namespace: ontologyNamespaceSchema,
  package_id: immutableIdSchema,
  package_version: z.number().int().positive().safe(),
  package_hash: contentHashSchema,
  source_binding_hash: contentHashSchema,
  compiler_digest: contentHashSchema,
  validator_version: versionIdentifierSchema,
  valid: z.boolean(),
  issues: z.array(ontologyPackageValidationIssueSchema),
  validated_at: timestampSchema,
});

export const ontologyPackageValidationReceiptSchema =
  ontologyPackageValidationReceiptDraftSchema.extend({ receipt_hash: contentHashSchema });

export const ontologyPackagePreviewSchema = z.strictObject({
  schema_version: z.literal(ONTOLOGY_PACKAGE_PREVIEW_VERSION),
  namespace_id: immutableIdSchema,
  package_id: immutableIdSchema,
  package_version: z.number().int().positive().safe(),
  package_hash: contentHashSchema,
  graph_source_digest: contentHashSchema,
  mandatory_object_ids: z.array(immutableIdSchema),
  runtime_queryable_object_ids: z.array(immutableIdSchema),
  knowledge_only_object_ids: z.array(immutableIdSchema),
  formula_ast_digests: z.array(
    z.strictObject({ metric_object_id: immutableIdSchema, formula_ast_hash: contentHashSchema }),
  ),
  compiler_version: versionIdentifierSchema,
  compiler_digest: contentHashSchema,
});

export const ontologyPackageCandidateCommitReceiptSchema = z.strictObject({
  namespace_id: immutableIdSchema,
  package_id: immutableIdSchema,
  package_version: z.number().int().positive().safe(),
  package_hash: contentHashSchema,
  candidate_id: immutableIdSchema,
  revision_id: immutableIdSchema,
  revision_digest: contentHashSchema,
  committed_at: timestampSchema,
  replayed: z.boolean(),
});

export const ontologyPackageValidationCommitReceiptSchema = z.strictObject({
  receipt_id: immutableIdSchema,
  namespace_id: immutableIdSchema,
  package_id: immutableIdSchema,
  package_version: z.number().int().positive().safe(),
  package_hash: contentHashSchema,
  receipt_hash: contentHashSchema,
  valid: z.boolean(),
  committed_at: timestampSchema,
  replayed: z.boolean(),
});

export const ontologyPackagePreviewBindingCommandSchema = z.strictObject({
  schema_version: z.literal("ontology-package-preview-binding@1.0.0"),
  preview_id: immutableIdSchema,
  validation_receipt_id: immutableIdSchema,
  validation_receipt_hash: contentHashSchema,
  projection_id: immutableIdSchema,
  projection_storage_digest: contentHashSchema,
  preview: ontologyPackagePreviewSchema,
});

export const ontologyPackagePreviewBindingReceiptSchema = z.strictObject({
  preview_id: immutableIdSchema,
  namespace_id: immutableIdSchema,
  package_id: immutableIdSchema,
  package_version: z.number().int().positive().safe(),
  package_hash: contentHashSchema,
  validation_receipt_id: immutableIdSchema,
  validation_receipt_hash: contentHashSchema,
  projection_id: immutableIdSchema,
  projection_storage_digest: contentHashSchema,
  preview_hash: contentHashSchema,
  committed_at: timestampSchema,
  replayed: z.boolean(),
});

export const ontologyPackagePreviewLoadResultSchema = z.strictObject({
  binding: ontologyPackagePreviewBindingReceiptSchema,
  preview: ontologyPackagePreviewSchema,
});

export type OntologyNamespace = z.infer<typeof ontologyNamespaceSchema>;
export type OntologySourceIdentity = z.infer<typeof ontologySourceIdentitySchema>;
export type OntologySemanticRole = z.infer<typeof ontologySemanticRoleSchema>;
export type OntologyPackageCandidateDraft = z.infer<typeof ontologyPackageCandidateDraftSchema>;
export type OntologyAnalysisSourceBinding = z.infer<typeof ontologyAnalysisSourceBindingSchema>;
export type OntologyPackageCandidate = z.infer<typeof ontologyPackageCandidateSchema>;
export type OntologyPackageValidationReceipt = z.infer<
  typeof ontologyPackageValidationReceiptSchema
>;
export type OntologyPackagePreview = z.infer<typeof ontologyPackagePreviewSchema>;
export type OntologyPackageCandidateCommitReceipt = z.infer<
  typeof ontologyPackageCandidateCommitReceiptSchema
>;
export type OntologyPackageValidationCommitReceipt = z.infer<
  typeof ontologyPackageValidationCommitReceiptSchema
>;
export type OntologyPackagePreviewBindingCommand = z.infer<
  typeof ontologyPackagePreviewBindingCommandSchema
>;
export type OntologyPackagePreviewBindingReceipt = z.infer<
  typeof ontologyPackagePreviewBindingReceiptSchema
>;
export type OntologyPackagePreviewLoadResult = z.infer<
  typeof ontologyPackagePreviewLoadResultSchema
>;

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new TypeError(`${label} contains duplicate value: ${value}`);
    seen.add(value);
  }
}

function canonicalUuidFromHash(hash: `sha256:${string}`): string {
  const hex = hash.slice("sha256:".length, "sha256:".length + 32).split("");
  hex[12] = "5";
  hex[16] = "8";
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export async function deriveOntologyNamespaceId(
  input: z.input<typeof ontologyNamespaceBaseSchema>,
): Promise<string> {
  const candidate = input as Record<string, unknown>;
  const namespace = ontologyNamespaceBaseSchema.parse({
    app_id: candidate.app_id,
    tenant_id: candidate.tenant_id,
    workspace_id: candidate.workspace_id,
    environment: candidate.environment,
    semantic_domain: candidate.semantic_domain,
  });
  if (namespace.tenant_id !== namespace.workspace_id) {
    throw new TypeError("Ontology Namespace workspace_id must equal tenant_id.");
  }
  return canonicalUuidFromHash(
    await sha256ContentHash({ schema_version: ONTOLOGY_NAMESPACE_ID_VERSION, namespace }),
  );
}

export async function deriveOntologyPackageId(input: unknown): Promise<string> {
  const namespace = ontologyNamespaceSchema.parse(input);
  return canonicalUuidFromHash(
    await sha256ContentHash({ schema_version: ONTOLOGY_PACKAGE_ID_VERSION, namespace }),
  );
}

export async function deriveOntologyStableObjectId(input: {
  readonly namespace: unknown;
  readonly source: unknown;
  readonly semantic_role: unknown;
}): Promise<string> {
  const namespace = ontologyNamespaceSchema.parse(input.namespace);
  const source = ontologySourceIdentitySchema.parse(input.source);
  const semanticRole = ontologySemanticRoleSchema.parse(input.semantic_role);
  if (source.namespace_id !== namespace.namespace_id) {
    throw new TypeError("Ontology source namespace does not match object namespace.");
  }
  return canonicalUuidFromHash(
    await sha256ContentHash({
      schema_version: ONTOLOGY_OBJECT_ID_VERSION,
      namespace,
      source,
      semantic_role: semanticRole,
    }),
  );
}

export async function computeOntologyConstraintRuleHash(
  input: unknown,
): Promise<`sha256:${string}`> {
  return sha256ContentHash(ontologyConstraintRuleSchema.parse(input));
}

export async function computeOntologyFormulaAstHash(input: unknown): Promise<`sha256:${string}`> {
  return sha256ContentHash(semanticFormulaExpressionSchema.parse(input));
}

function sortUnique<T extends string>(values: readonly T[], label: string): T[] {
  assertUnique(values, label);
  return [...values].sort(compareStable);
}

function canonicalizeGraph(graph: z.infer<typeof semanticGraphSourceSchema>) {
  return {
    ...graph,
    node_type_registry: [...graph.node_type_registry]
      .sort((left, right) => compareStable(left.node_type, right.node_type))
      .map((entry) => ({ ...entry })),
    edge_type_registry: [...graph.edge_type_registry]
      .sort((left, right) => compareStable(left.edge_type, right.edge_type))
      .map((entry) => ({
        ...entry,
        source_node_types: sortUnique(
          entry.source_node_types,
          `edge registry ${entry.edge_type} source_node_types`,
        ),
        target_node_types: sortUnique(
          entry.target_node_types,
          `edge registry ${entry.edge_type} target_node_types`,
        ),
      })),
    evidence: [...graph.evidence].sort((left, right) =>
      compareStable(left.evidence_id, right.evidence_id),
    ),
    nodes: [...graph.nodes]
      .sort((left, right) => compareStable(left.node_id, right.node_id))
      .map((node) => ({
        ...node,
        aliases: sortUnique(node.aliases, `node ${node.node_id} aliases`),
        evidence_refs: sortUnique(node.evidence_refs, `node ${node.node_id} evidence_refs`),
        tags: sortUnique(node.tags, `node ${node.node_id} tags`),
      })),
    edges: [...graph.edges]
      .sort((left, right) => compareStable(left.edge_id, right.edge_id))
      .map((edge) => ({
        ...edge,
        evidence_refs: sortUnique(edge.evidence_refs, `edge ${edge.edge_id} evidence_refs`),
      })),
  };
}

function canonicalizeParsedCandidate(
  candidate: OntologyPackageCandidateDraft,
): OntologyPackageCandidateDraft {
  return deepFreeze({
    ...candidate,
    dependencies: [...candidate.dependencies]
      .sort((left, right) =>
        compareStable(
          `${left.namespace_id}:${left.package_id}:${left.package_version}`,
          `${right.namespace_id}:${right.package_id}:${right.package_version}`,
        ),
      )
      .map((entry) => ({
        ...entry,
        dependency_path: sortUnique(entry.dependency_path, "dependency_path"),
      })),
    imports: [...candidate.imports]
      .sort((left, right) =>
        compareStable(
          `${left.namespace_id}:${left.package_id}:${left.package_version}`,
          `${right.namespace_id}:${right.package_id}:${right.package_version}`,
        ),
      )
      .map((entry) => ({
        ...entry,
        imported_object_ids: sortUnique(entry.imported_object_ids, "imported_object_ids"),
      })),
    objects: [...candidate.objects].sort((left, right) =>
      compareStable(left.object_id, right.object_id),
    ),
    business_subjects: [...candidate.business_subjects].sort((left, right) =>
      compareStable(left.object_id, right.object_id),
    ),
    dimensions: [...candidate.dimensions].sort((left, right) =>
      compareStable(left.object_id, right.object_id),
    ),
    edge_semantics: [...candidate.edge_semantics].sort((left, right) =>
      compareStable(left.object_id, right.object_id),
    ),
    constraints: [...candidate.constraints]
      .sort((left, right) => compareStable(left.constraint_id, right.constraint_id))
      .map((entry) => ({
        ...entry,
        provenance_object_ids: sortUnique(
          entry.provenance_object_ids,
          `constraint ${entry.constraint_id} provenance`,
        ),
      })),
    physical_mappings: [...candidate.physical_mappings]
      .sort((left, right) => compareStable(left.mapping_id, right.mapping_id))
      .map((entry) => ({
        ...entry,
        evidence_sources: [...entry.evidence_sources].sort((left, right) =>
          compareStable(canonicalizeJson(left), canonicalizeJson(right)),
        ),
      })),
    metric_bindings: [...candidate.metric_bindings]
      .sort((left, right) => compareStable(left.metric_object_id, right.metric_object_id))
      .map((entry) => ({
        ...entry,
        dimension_object_ids: sortUnique(
          entry.dimension_object_ids,
          `metric ${entry.metric_object_id} dimensions`,
        ),
        grain_object_ids: sortUnique(
          entry.grain_object_ids,
          `metric ${entry.metric_object_id} grains`,
        ),
      })),
    graph_source: canonicalizeGraph(candidate.graph_source),
    mandatory_manifest: {
      ...candidate.mandatory_manifest,
      node_object_ids: sortUnique(candidate.mandatory_manifest.node_object_ids, "manifest nodes"),
      edge_object_ids: sortUnique(candidate.mandatory_manifest.edge_object_ids, "manifest edges"),
      constraint_ids: sortUnique(
        candidate.mandatory_manifest.constraint_ids,
        "manifest constraints",
      ),
      mapping_ids: sortUnique(candidate.mandatory_manifest.mapping_ids, "manifest mappings"),
      metric_object_ids: sortUnique(
        candidate.mandatory_manifest.metric_object_ids,
        "manifest metrics",
      ),
    },
  });
}

function expectObject(
  objects: ReadonlyMap<string, z.infer<typeof ontologyStableObjectSchema>>,
  objectId: string,
  label: string,
) {
  const object = objects.get(objectId);
  if (!object) throw new TypeError(`${label} references unknown object ${objectId}.`);
  return object;
}

async function assertCandidateClosure(candidate: OntologyPackageCandidateDraft): Promise<void> {
  const expectedNamespaceId = await deriveOntologyNamespaceId(candidate.namespace);
  if (candidate.namespace.namespace_id !== expectedNamespaceId) {
    throw new TypeError("Ontology namespace_id is not canonical.");
  }
  if (candidate.package_id !== (await deriveOntologyPackageId(candidate.namespace))) {
    throw new TypeError("Ontology package_id is not canonical.");
  }
  if (
    candidate.graph_source.metadata.scope.app_id !== candidate.namespace.app_id ||
    candidate.graph_source.metadata.scope.tenant_id !== candidate.namespace.tenant_id ||
    candidate.graph_source.metadata.scope.environment !== candidate.namespace.environment ||
    candidate.graph_source.metadata.domain_id !== candidate.namespace.semantic_domain ||
    candidate.graph_source.metadata.base_release_id !== null
  ) {
    throw new TypeError("Graph source must be greenfield and match the ontology namespace.");
  }

  for (const source of [
    candidate.source_binding.schema_snapshot,
    candidate.source_binding.business_source_bundle,
    candidate.source_binding.policy,
  ]) {
    if (source.namespace_id !== candidate.namespace.namespace_id) {
      throw new TypeError("Source binding namespace does not match ontology namespace.");
    }
  }
  if (
    candidate.source_binding.schema_snapshot.source_role !== "SCHEMA_SNAPSHOT" ||
    candidate.source_binding.business_source_bundle.source_role !== "BUSINESS_SOURCE_BUNDLE" ||
    candidate.source_binding.policy.source_role !== "POLICY_DIGEST"
  ) {
    throw new TypeError("Package source binding must use exact allowlisted source roles.");
  }

  assertUnique(
    candidate.objects.map((entry) => entry.object_id),
    "objects",
  );
  assertUnique(
    candidate.objects.map((entry) => entry.graph_entry_id),
    "graph entries",
  );
  assertUnique(
    candidate.dependencies.map(
      (entry) => `${entry.namespace_id}:${entry.package_id}:${entry.package_version}`,
    ),
    "dependencies",
  );
  assertUnique(
    candidate.imports.map(
      (entry) => `${entry.namespace_id}:${entry.package_id}:${entry.package_version}`,
    ),
    "imports",
  );

  const graphNodeIds = new Set(candidate.graph_source.nodes.map((node) => node.node_id));
  const graphEdgeIds = new Set(candidate.graph_source.edges.map((edge) => edge.edge_id));
  const objects = new Map(candidate.objects.map((entry) => [entry.object_id, entry]));
  for (const object of candidate.objects) {
    if (object.source.namespace_id !== candidate.namespace.namespace_id) {
      throw new TypeError(`Object ${object.object_id} has a cross-namespace source.`);
    }
    if (
      object.object_id !==
      (await deriveOntologyStableObjectId({
        namespace: candidate.namespace,
        source: object.source,
        semantic_role: object.semantic_role,
      }))
    ) {
      throw new TypeError(`Object ${object.object_id} is not a canonical stable ID.`);
    }
    if (object.graph_entry_kind === "NODE" && !graphNodeIds.has(object.graph_entry_id)) {
      throw new TypeError(`Object ${object.object_id} references a missing graph node.`);
    }
    if (object.graph_entry_kind === "EDGE" && !graphEdgeIds.has(object.graph_entry_id)) {
      throw new TypeError(`Object ${object.object_id} references a missing graph edge.`);
    }
  }

  for (const dependency of candidate.dependencies) {
    if (dependency.namespace_id !== candidate.namespace.namespace_id) {
      throw new TypeError("Cross-namespace package dependencies are forbidden in v1.");
    }
    if (
      dependency.package_id === candidate.package_id ||
      dependency.dependency_path.includes(candidate.package_id)
    ) {
      throw new TypeError("Ontology package dependency cycle detected.");
    }
  }
  for (const imported of candidate.imports) {
    if (imported.namespace_id !== candidate.namespace.namespace_id) {
      throw new TypeError("Cross-namespace ontology imports are forbidden.");
    }
  }

  for (const subject of candidate.business_subjects) {
    const object = expectObject(objects, subject.object_id, "business subject");
    if (
      object.graph_entry_kind !== "NODE" ||
      object.graph_entry_id !== subject.graph_node_id ||
      object.semantic_role !== subject.role
    ) {
      throw new TypeError(`Business subject ${subject.object_id} role/graph binding is invalid.`);
    }
  }
  for (const dimension of candidate.dimensions) {
    const object = expectObject(objects, dimension.object_id, "dimension");
    if (
      object.graph_entry_kind !== "NODE" ||
      object.graph_entry_id !== dimension.graph_node_id ||
      object.semantic_role !== "DATA_PROPERTY"
    ) {
      throw new TypeError(`Dimension ${dimension.object_id} is not a DATA_PROPERTY node.`);
    }
  }
  for (const edge of candidate.edge_semantics) {
    const object = expectObject(objects, edge.object_id, "edge semantics");
    expectObject(objects, edge.domain_object_id, "edge domain");
    expectObject(objects, edge.range_object_id, "edge range");
    if (edge.inverse_object_id !== null)
      expectObject(objects, edge.inverse_object_id, "edge inverse");
    if (object.graph_entry_kind !== "EDGE" || object.graph_entry_id !== edge.graph_edge_id) {
      throw new TypeError(`Edge semantics ${edge.object_id} does not bind its graph edge.`);
    }
    if (edge.relationship_kind === "TAXONOMY" && edge.taxonomy_relation === null) {
      throw new TypeError("Taxonomy edge requires taxonomy_relation.");
    }
    if (edge.relationship_kind === "ALIGNMENT" && edge.alignment_relation === null) {
      throw new TypeError("Alignment edge requires alignment_relation.");
    }
  }

  for (const constraint of candidate.constraints) {
    const constraintObject = expectObject(objects, constraint.constraint_id, "constraint");
    expectObject(objects, constraint.target_object_id, "constraint target");
    if (constraintObject.semantic_role !== "CONSTRAINT") {
      throw new TypeError(
        `Constraint ${constraint.constraint_id} lacks CONSTRAINT stable identity.`,
      );
    }
    if (constraint.rule.kind !== constraint.constraint_kind) {
      throw new TypeError(`Constraint ${constraint.constraint_id} kind does not match its rule.`);
    }
    if (constraint.rule.target_object_id !== constraint.target_object_id) {
      throw new TypeError(`Constraint ${constraint.constraint_id} target does not match its rule.`);
    }
    if (constraint.rule.kind === "CARDINALITY") {
      if (constraint.rule.maximum !== null && constraint.rule.maximum < constraint.rule.minimum) {
        throw new TypeError(
          `Constraint ${constraint.constraint_id} has contradictory cardinality.`,
        );
      }
    }
    if (constraint.rule_hash !== (await computeOntologyConstraintRuleHash(constraint.rule))) {
      throw new TypeError(`Constraint ${constraint.constraint_id} rule hash drifted.`);
    }
    for (const provenanceId of constraint.provenance_object_ids) {
      expectObject(objects, provenanceId, "constraint provenance");
    }
  }

  for (const mapping of candidate.physical_mappings) {
    const mappingObject = expectObject(objects, mapping.mapping_id, "mapping");
    expectObject(objects, mapping.logical_object_id, "mapping target");
    if (mappingObject.semantic_role !== "PHYSICAL_MAPPING") {
      throw new TypeError(`Mapping ${mapping.mapping_id} lacks PHYSICAL_MAPPING stable identity.`);
    }
    if (
      mapping.datasource_id !== candidate.source_binding.datasource_id ||
      mapping.schema_snapshot_id !== candidate.source_binding.schema_snapshot.source_id ||
      mapping.snapshot_content_hash !== candidate.source_binding.schema_snapshot.source_hash
    ) {
      throw new TypeError(
        `Mapping ${mapping.mapping_id} does not match the exact snapshot binding.`,
      );
    }
    for (const evidence of mapping.evidence_sources) {
      if (evidence.namespace_id !== candidate.namespace.namespace_id) {
        throw new TypeError(`Mapping ${mapping.mapping_id} contains cross-namespace evidence.`);
      }
    }
    if (mapping.mode === "QUERYABLE") {
      if (mapping.resolution !== "RESOLVED" || mapping.evidence_sources.length === 0) {
        throw new TypeError(`Queryable mapping ${mapping.mapping_id} requires resolved evidence.`);
      }
      if (
        mapping.physical_locator.kind === "JOIN" &&
        !mapping.evidence_sources.some((source) =>
          ["DDL_CONSTRAINT", "QUERY_PROBE", "STATISTICS"].includes(source.source_role),
        )
      ) {
        throw new TypeError(`Queryable join ${mapping.mapping_id} requires join proof evidence.`);
      }
    }
  }

  const formulaNodes = new Map(
    candidate.graph_source.nodes
      .filter((node) => node.node_type === "FORMULA")
      .map((node) => [node.node_id, node]),
  );
  for (const metric of candidate.metric_bindings) {
    const metricObject = expectObject(objects, metric.metric_object_id, "metric");
    const formulaObject = expectObject(objects, metric.formula_object_id, "metric formula");
    for (const objectId of [
      ...metric.dimension_object_ids,
      ...metric.grain_object_ids,
      metric.time_object_id,
      metric.unit_object_id,
    ]) {
      if (objectId !== null) expectObject(objects, objectId, "metric closure");
    }
    if (metric.resolution === "RESOLVED") {
      if (metricObject.semantic_role !== "METRIC" || formulaObject.semantic_role !== "FORMULA") {
        throw new TypeError(`Resolved metric ${metric.metric_object_id} has invalid roles.`);
      }
      const formulaNode = formulaNodes.get(formulaObject.graph_entry_id);
      if (!formulaNode)
        throw new TypeError(`Metric ${metric.metric_object_id} has no Formula node.`);
      if (
        metric.formula_ast_hash !== (await computeOntologyFormulaAstHash(formulaNode.expression))
      ) {
        throw new TypeError(`Metric ${metric.metric_object_id} Formula AST hash drifted.`);
      }
    }
  }

  const manifest = candidate.mandatory_manifest;
  for (const objectId of [...manifest.node_object_ids, ...manifest.edge_object_ids]) {
    const object = expectObject(objects, objectId, "mandatory manifest");
    if (object.resolution !== "RESOLVED") {
      throw new TypeError(`Mandatory object ${objectId} is unresolved.`);
    }
  }
  const constraints = new Map(candidate.constraints.map((entry) => [entry.constraint_id, entry]));
  for (const constraintId of manifest.constraint_ids) {
    const constraint = constraints.get(constraintId);
    const object = expectObject(objects, constraintId, "mandatory constraint");
    if (constraint?.validation_status !== "VALID" || object.resolution !== "RESOLVED") {
      throw new TypeError(`Mandatory constraint ${constraintId} is unresolved or invalid.`);
    }
  }
  const mappings = new Map(candidate.physical_mappings.map((entry) => [entry.mapping_id, entry]));
  for (const mappingId of manifest.mapping_ids) {
    const mapping = mappings.get(mappingId);
    if (mapping?.mode !== "QUERYABLE" || mapping.resolution !== "RESOLVED") {
      throw new TypeError(`Mandatory mapping ${mappingId} is not queryable and resolved.`);
    }
  }
  const metrics = new Map(
    candidate.metric_bindings.map((entry) => [entry.metric_object_id, entry]),
  );
  for (const metricId of manifest.metric_object_ids) {
    const metric = metrics.get(metricId);
    if (metric?.resolution !== "RESOLVED") {
      throw new TypeError(`Mandatory metric ${metricId} is unresolved.`);
    }
  }
}

export async function buildOntologyPackageCandidate(
  input: unknown,
): Promise<OntologyPackageCandidate> {
  const parsed = ontologyPackageCandidateDraftSchema.parse(input);
  await assertCandidateClosure(parsed);
  const canonical = canonicalizeParsedCandidate(parsed);
  const packageHash = await sha256ContentHash(canonical);
  return deepFreeze(
    ontologyPackageCandidateSchema.parse({ ...canonical, package_hash: packageHash }),
  );
}

export async function verifyOntologyPackageCandidate(input: unknown): Promise<boolean> {
  try {
    const parsed = ontologyPackageCandidateSchema.parse(input);
    const { package_hash: packageHash, ...draft } = parsed;
    await assertCandidateClosure(draft);
    return packageHash === (await sha256ContentHash(canonicalizeParsedCandidate(draft)));
  } catch {
    return false;
  }
}

export async function computeOntologyPackageSourceBindingHash(
  input: unknown,
): Promise<`sha256:${string}`> {
  return sha256ContentHash(ontologyPackageSourceBindingSchema.parse(input));
}

function canonicalizeValidationIssues(
  issues: readonly z.infer<typeof ontologyPackageValidationIssueSchema>[],
) {
  const canonicalKeys = issues.map((issue) => canonicalizeJson(issue));
  assertUnique(canonicalKeys, "validation issues");
  return [...issues].sort((left, right) =>
    compareStable(canonicalizeJson(left), canonicalizeJson(right)),
  );
}

export async function buildOntologyPackageValidationReceipt(
  input: z.input<typeof ontologyPackageValidationReceiptDraftSchema>,
): Promise<OntologyPackageValidationReceipt> {
  const draft = ontologyPackageValidationReceiptDraftSchema.parse(input);
  const issues = canonicalizeValidationIssues(draft.issues);
  if (draft.valid !== (issues.length === 0)) {
    throw new TypeError("Validation receipt valid flag must match the canonical issue set.");
  }
  const canonical = deepFreeze({ ...draft, issues });
  return deepFreeze(
    ontologyPackageValidationReceiptSchema.parse({
      ...canonical,
      receipt_hash: await sha256ContentHash(canonical),
    }),
  );
}

export async function verifyOntologyPackageValidationReceipt(input: unknown): Promise<boolean> {
  try {
    const parsed = ontologyPackageValidationReceiptSchema.parse(input);
    const { receipt_hash: receiptHash, ...draft } = parsed;
    const issues = canonicalizeValidationIssues(draft.issues);
    return (
      draft.valid === (draft.issues.length === 0) &&
      canonicalizeJson(draft.issues) === canonicalizeJson(issues) &&
      receiptHash === (await sha256ContentHash({ ...draft, issues }))
    );
  } catch {
    return false;
  }
}
