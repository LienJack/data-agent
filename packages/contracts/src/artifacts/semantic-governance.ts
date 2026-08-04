import { z } from "zod";
import {
  contentHashSchema,
  environmentSchema,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import {
  artifactProducerSchema,
  artifactReferenceFor,
  artifactReferenceSchema,
  deterministicAuthoritySchema,
} from "./envelope.js";
import {
  DATA_TYPE,
  METRIC_ADDITIVITY,
  METRIC_AGGREGATION,
  METRIC_FANOUT_POLICY,
  METRIC_NULL_POLICY,
  SENSITIVITY_LEVEL,
} from "./text2sql-primitives.js";

// ─── Version constant ─────────────────────────────────────────────────────────

export const SEMANTIC_SOURCE_BUNDLE_VERSION = "semantic-source-bundle@1" as const;
export const U5_EXECUTABLE_SUBSET = "U5_EXECUTABLE_SUBSET" as const;
export const U13_EXECUTABLE_SUBSET = "U13_EXECUTABLE_SUBSET" as const;
export type CapabilityProfile =
  | typeof U5_EXECUTABLE_SUBSET
  | typeof U13_EXECUTABLE_SUBSET;

// ─── Grain / Unit / TimeDomain ────────────────────────────────────────────────

export const grainSchema = z.strictObject({
  grain_id: versionIdentifierSchema,
  description: z.string().max(512).optional(),
  granularity: z.enum(["atomic", "hour", "day", "week", "month", "quarter", "year"]),
});

export const unitSchema = z.strictObject({
  unit_id: versionIdentifierSchema,
  description: z.string().max(512).optional(),
  dimension: z.enum(["count", "currency", "ratio", "percentage", "rate", "duration", "other"]),
  base_unit: versionIdentifierSchema.nullable(),
  conversion_factor: z.number().positive().nullable(),
});

export const timeDomainSchema = z.strictObject({
  time_domain_id: versionIdentifierSchema,
  description: z.string().max(512).optional(),
  calendar: z.enum(["gregorian", "fiscal", "relative"]),
  timezone: z.string().max(64).nullable(),
  min_time: z.string().nullable(),
  max_time: z.string().nullable(),
});

// ─── Formula AST ──────────────────────────────────────────────────────────────

export const formulaSourceSchema = z.strictObject({
  formula_id: versionIdentifierSchema,
  expression: z.string().min(1).max(4096),
  dialect: z.enum(["text2sql", "sql", "python"]).default("text2sql"),
  description: z.string().max(1024).optional(),
});

export const formulaTypeSchema = z.enum([
  "additive_aggregate",
  "semi_additive_aggregate",
  "non_additive_aggregate",
  "ratio",
  "compound",
  "window",
  "other",
]);

export const formulaSignatureSchema = z.strictObject({
  formula_id: versionIdentifierSchema,
  formula_type: formulaTypeSchema,
  return_type: z.enum(["numeric", "integer", "boolean", "text", "date", "timestamp"]),
  grain: grainSchema,
  unit: unitSchema.nullable(),
  time_domain: timeDomainSchema.nullable(),
  additivity: z.enum(["additive", "semi-additive", "non-additive"]),
  cardinality: z.enum(["scalar", "vector", "set"]),
  null_policy: z.enum(["preserve", "coalesce-zero", "exclude", "propagate"]),
  dependency_formula_ids: z.array(versionIdentifierSchema),
});

// ─── Semantic source object types ─────────────────────────────────────────────

export const semanticMetricSchema = z.strictObject({
  metric_id: versionIdentifierSchema,
  name: z.string().min(1).max(256),
  description: z.string().max(1024).optional(),
  aliases: z.array(z.string().min(1).max(128)).min(1),
  table_id: versionIdentifierSchema,
  column_id: z.string().min(1).max(256),
  aggregation: z.enum(METRIC_AGGREGATION),
  formula: formulaSourceSchema.nullable(),
  grain: grainSchema,
  unit: unitSchema.nullable(),
  time_domain: timeDomainSchema.nullable(),
  time_column_id: z.string().min(1).max(256).nullable(),
  additivity: z.enum(METRIC_ADDITIVITY),
  null_policy: z.enum(METRIC_NULL_POLICY),
  fanout_policy: z.enum(METRIC_FANOUT_POLICY),
  dependency_column_ids: z.array(z.string().min(1).max(256)).min(1),
  tags: z.array(z.string().min(1).max(128)).default([]),
});

export const semanticDimensionSchema = z.strictObject({
  dimension_id: versionIdentifierSchema,
  name: z.string().min(1).max(256),
  description: z.string().max(1024).optional(),
  aliases: z.array(z.string().min(1).max(128)).min(1),
  table_id: versionIdentifierSchema,
  column_id: z.string().min(1).max(256),
  grain: grainSchema,
  data_type: z.enum(DATA_TYPE),
  sensitivity: z.enum(SENSITIVITY_LEVEL).default("PUBLIC"),
  hierarchical: z.boolean().default(false),
  parent_dimension_id: versionIdentifierSchema.nullable(),
  tags: z.array(z.string().min(1).max(128)).default([]),
});

// ─── Relationship ─────────────────────────────────────────────────────────────

export const relationshipKindSchema = z.enum(["analytical", "physical", "business"]);
export const relationshipCardinalitySchema = z.enum([
  "one-to-one",
  "one-to-many",
  "many-to-one",
  "many-to-many",
]);
export const relationshipProofKindSchema = z.enum([
  "DDL_ENFORCED",
  "SNAPSHOT_CERTIFIED",
  "DECLARED_ONLY",
]);

export const semanticRelationshipSchema = z.strictObject({
  relationship_id: versionIdentifierSchema,
  name: z.string().min(1).max(256),
  description: z.string().max(1024).optional(),
  kind: relationshipKindSchema,
  left_table_id: versionIdentifierSchema,
  left_column_ids: z.array(z.string().min(1).max(256)).min(1),
  right_table_id: versionIdentifierSchema,
  right_column_ids: z.array(z.string().min(1).max(256)).min(1),
  cardinality: relationshipCardinalitySchema,
  left_row_preservation: z.enum(["required", "optional"]),
  right_row_preservation: z.enum(["required", "optional"]),
  proof_kind: relationshipProofKindSchema,
  proof_detail: z.string().max(1024).nullable(),
  tags: z.array(z.string().min(1).max(128)).default([]),
});

// ─── Runtime Authorization ────────────────────────────────────────────────────

export const runtimeAuthActionSchema = z.enum(["DENY", "RESTRICT"]);

export const runtimeAuthPredicateSchema = z.strictObject({
  table_id: versionIdentifierSchema,
  column_id: z.string().min(1).max(256),
  operator: z.enum([
    "eq",
    "neq",
    "lt",
    "lte",
    "gt",
    "gte",
    "in",
    "between",
    "is_null",
    "is_not_null",
  ]),
  parameter_key: z.string().min(1).max(128),
});

export const runtimeAuthTableRuleSchema = z.strictObject({
  table_id: versionIdentifierSchema,
  action: runtimeAuthActionSchema,
  column_ids: z.array(z.string().min(1).max(256)).min(1),
  predicates: z.array(runtimeAuthPredicateSchema).default([]),
});

export const runtimeAuthSchema = z.strictObject({
  table_rules: z.array(runtimeAuthTableRuleSchema).min(1),
});

// ─── BusinessOntology ─────────────────────────────────────────────────────────

export const businessEntityRelationshipTypeSchema = z.strictObject({
  relationship_type: z.string().min(1).max(128),
  target_entity_id: versionIdentifierSchema,
  description: z.string().max(512).optional(),
});

export const businessEntitySchema = z.strictObject({
  entity_id: versionIdentifierSchema,
  name: z.string().min(1).max(256),
  description: z.string().max(1024).optional(),
  aliases: z.array(z.string().min(1).max(128)).default([]),
  domain: z.string().min(1).max(128),
  owner: z.string().min(1).max(128),
  lifecycle: z.enum(["active", "deprecated", "archived"]).default("active"),
  business_relationship_types: z.array(businessEntityRelationshipTypeSchema).default([]),
});

export const businessEventSchema = z.strictObject({
  event_id: versionIdentifierSchema,
  name: z.string().min(1).max(256),
  description: z.string().max(1024).optional(),
  domain: z.string().min(1).max(128),
  subject_entity_id: versionIdentifierSchema,
  event_type: z.string().min(1).max(128),
});

export const businessTermSchema = z.strictObject({
  term_id: versionIdentifierSchema,
  name: z.string().min(1).max(256),
  definition: z.string().min(1).max(2048),
  domain: z.string().min(1).max(128),
  aliases: z.array(z.string().min(1).max(128)).default([]),
});

export const businessOntologySchema = z.strictObject({
  domain: z.string().min(1).max(128),
  entities: z.array(businessEntitySchema).default([]),
  events: z.array(businessEventSchema).default([]),
  terms: z.array(businessTermSchema).default([]),
  owner: z.string().min(1).max(128),
  lifecycle: z.enum(["active", "draft", "deprecated", "archived"]).default("active"),
});

// ─── CatalogGovernance ────────────────────────────────────────────────────────

export const columnGovernanceSchema = z.strictObject({
  column_id: z.string().min(1).max(256),
  nullable: z.boolean(),
  data_type: z.string().min(1).max(64),
  constraint_refs: z.array(z.string().min(1).max(256)).default([]),
  description: z.string().max(1024).optional(),
});

export const tableGovernanceSchema = z.strictObject({
  table_id: versionIdentifierSchema,
  table_name: z.string().min(1).max(256),
  description: z.string().max(1024).optional(),
  columns: z.array(columnGovernanceSchema).min(1),
  snapshot_currentness: z.strictObject({
    snapshot_timestamp: z.string().nullable(),
    staleness_threshold_seconds: z.number().int().positive().nullable(),
  }),
  catalog_fence: z.string().min(1).max(128).nullable(),
});

export const catalogGovernanceSchema = z.strictObject({
  tables: z.array(tableGovernanceSchema).min(1),
  data_quality_oracle_refs: z.array(artifactReferenceSchema).default([]),
});

// ─── PhysicalBinding ──────────────────────────────────────────────────────────

export const bindingLifecycleSchema = z.enum(["active", "pending", "deprecated", "archived"]);

export const physicalBindingEntrySchema = z.strictObject({
  logical_object_id: versionIdentifierSchema,
  logical_object_type: z.enum(["metric", "dimension", "table", "column", "relationship"]),
  datasource_id: immutableIdSchema,
  schema_name: z.string().min(1).max(256),
  table_name: z.string().min(1).max(256),
  column_name: z.string().min(1).max(256).nullable(),
  binding_lifecycle: bindingLifecycleSchema,
  valid_from: z.string().nullable(),
  valid_until: z.string().nullable(),
});

export const physicalBindingSchema = z.strictObject({
  entries: z.array(physicalBindingEntrySchema).min(1),
  default_datasource_id: immutableIdSchema.nullable(),
});

// ─── Descriptive Contribution Profile ─────────────────────────────────────────

export const endpointTemplateKindSchema = z.enum(["ROW_PARTITION", "FORMULA_IDENTITY"]);

export const endpointExecutionTemplateSchema = z.strictObject({
  endpoint_id: versionIdentifierSchema,
  kind: endpointTemplateKindSchema,
  metric_ref: versionIdentifierSchema,
  baseline_query_contract_template_hash: contentHashSchema,
  followup_query_contract_template_hash: contentHashSchema,
  fixed_predicate_ast_hash: contentHashSchema,
  expected_row0_cell: z.string().max(1024),
  ontology_identity: versionIdentifierSchema,
  datasource_id: immutableIdSchema,
  unit_ref: versionIdentifierSchema.nullable(),
  grain_ref: versionIdentifierSchema,
  time_domain_ref: versionIdentifierSchema.nullable(),
  filter_hash: contentHashSchema,
  snapshot_policy: z.enum(["LATEST", "SNAPSHOT", "TIME_BOUNDED"]),
});

export const sameMeasureWitnessSchema = z.strictObject({
  canonical_measure_ast_hash: contentHashSchema,
  aggregation_algebra: z.string().max(256),
  grain_identity: versionIdentifierSchema,
  unit_identity: versionIdentifierSchema.nullable(),
  null_policy_identity: z.string().max(128),
  universe_hash: contentHashSchema,
});

export const rowPartitionWitnessSchema = z.strictObject({
  same_measure: sameMeasureWitnessSchema,
  driver_predicate_hash: contentHashSchema,
  residual_predicate_hash: contentHashSchema,
  driver_residual_mutual_exclusion_hash: contentHashSchema,
  driver_residual_exhaustive_union_hash: contentHashSchema,
  max_bound: z.number().int().positive(),
  stable_ordering: z.array(z.string().min(1).max(256)).min(1),
});

export const formulaEquivalenceWitnessSchema = z.strictObject({
  formula_ast_hash: contentHashSchema,
  sign: z.enum(["positive", "negative"]),
  unit: versionIdentifierSchema.nullable(),
  grain: versionIdentifierSchema,
});

export const endpointWitnessSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ROW_PARTITION"), witness: rowPartitionWitnessSchema }),
  z.strictObject({ kind: z.literal("FORMULA_IDENTITY"), witness: formulaEquivalenceWitnessSchema }),
]);

export const driverCapacityConstraintSchema = z.strictObject({
  obligation_id: versionIdentifierSchema,
  max_sql_executions: z.number().int().positive(),
  endpoint_cost_model: z.string().max(256),
  compiler_version: versionIdentifierSchema,
  diagnostic_binding_limit: z.number().int().positive(),
  artifact_input_limit: z.number().int().positive(),
});

export const descriptiveContributionProfileSchema = z.strictObject({
  profile_id: versionIdentifierSchema,
  targets: z.array(endpointExecutionTemplateSchema).min(1),
  witnesses: z.array(endpointWitnessSchema).min(1),
  static_driver_capacity: z.array(driverCapacityConstraintSchema).min(1),
  stable_ordering: z.array(z.string().min(1).max(256)),
  declared_max_bound: z.number().int().positive(),
});

// ─── SemanticSourceBundle@1 Envelope ──────────────────────────────────────────

export const semanticSourceBundleMetadataSchema = z.strictObject({
  bundle_version: z.literal(SEMANTIC_SOURCE_BUNDLE_VERSION),
  capability_profile: z.union([z.literal(U5_EXECUTABLE_SUBSET), z.literal(U13_EXECUTABLE_SUBSET)]),
  bundle_id: immutableIdSchema,
  scope: z.strictObject({
    app_id: immutableIdSchema,
    tenant_id: immutableIdSchema,
    environment: environmentSchema,
  }),
  producer: artifactProducerSchema,
  authority: deterministicAuthoritySchema,
  created_at: timestampSchema,
  description: z.string().max(2048).optional(),
});

export const semanticSourceBundleSchema = z.strictObject({
  metadata: semanticSourceBundleMetadataSchema,
  formulas: z.array(formulaSignatureSchema).default([]),
  metrics: z.array(semanticMetricSchema).min(1),
  dimensions: z.array(semanticDimensionSchema).default([]),
  relationships: z.array(semanticRelationshipSchema).default([]),
  business_ontology: businessOntologySchema.optional(),
  physical_binding: physicalBindingSchema.optional(),
  catalog_governance: catalogGovernanceSchema.optional(),
  runtime_authorization: runtimeAuthSchema.optional(),
  contribution_profile: descriptiveContributionProfileSchema.optional(),
});

export type SemanticSourceBundle = z.infer<typeof semanticSourceBundleSchema>;
export type SemanticSourceBundleMetadata = z.infer<typeof semanticSourceBundleMetadataSchema>;
export type SemanticMetric = z.infer<typeof semanticMetricSchema>;
export type SemanticDimension = z.infer<typeof semanticDimensionSchema>;
export type SemanticRelationship = z.infer<typeof semanticRelationshipSchema>;
export type RuntimeAuth = z.infer<typeof runtimeAuthSchema>;
export type RuntimeAuthTableRule = z.infer<typeof runtimeAuthTableRuleSchema>;
export type RuntimeAuthPredicate = z.infer<typeof runtimeAuthPredicateSchema>;
export type FormulaSignature = z.infer<typeof formulaSignatureSchema>;
export type Grain = z.infer<typeof grainSchema>;
export type Unit = z.infer<typeof unitSchema>;
export type BusinessOntology = z.infer<typeof businessOntologySchema>;
export type BusinessEntity = z.infer<typeof businessEntitySchema>;
export type BusinessEvent = z.infer<typeof businessEventSchema>;
export type BusinessTerm = z.infer<typeof businessTermSchema>;
export type BusinessEntityRelationshipType = z.infer<typeof businessEntityRelationshipTypeSchema>;
export type CatalogGovernance = z.infer<typeof catalogGovernanceSchema>;
export type TableGovernance = z.infer<typeof tableGovernanceSchema>;
export type ColumnGovernance = z.infer<typeof columnGovernanceSchema>;
export type PhysicalBinding = z.infer<typeof physicalBindingSchema>;
export type PhysicalBindingEntry = z.infer<typeof physicalBindingEntrySchema>;
export type BindingLifecycle = z.infer<typeof bindingLifecycleSchema>;
export type TimeDomain = z.infer<typeof timeDomainSchema>;
export type EndpointExecutionTemplate = z.infer<typeof endpointExecutionTemplateSchema>;
export type DescriptiveContributionProfile = z.infer<typeof descriptiveContributionProfileSchema>;
export type DriverCapacityConstraint = z.infer<typeof driverCapacityConstraintSchema>;
export type RowPartitionWitness = z.infer<typeof rowPartitionWitnessSchema>;
export type FormulaEquivalenceWitness = z.infer<typeof formulaEquivalenceWitnessSchema>;

/**
 * AnalyticalSemantics 平面 — 分析语义，包含指标、维度和公式。
 * 在 SemanticSourceBundle 中对应 metrics、dimensions 和 formulas 字段。
 */
export type AnalyticalSemantics = {
  metrics: SemanticMetric[];
  dimensions: SemanticDimension[];
  formulas: FormulaSignature[];
};

/** RelationshipRegistry 平面 — 关系注册表，包含语义关系。 */
export type RelationshipRegistry = {
  relationships: SemanticRelationship[];
};

/** RuntimeAuthorization 平面 — 运行时授权（RuntimeAuth 的别名）。 */
export type RuntimeAuthorization = RuntimeAuth;
// ─── Content digest ───────────────────────────────────────────────────────────

export async function computeExecutableSemanticDigest(
  bundle: SemanticSourceBundle,
): Promise<`sha256:${string}`> {
  const { metadata: _metadata, ...executableContent } = bundle;
  return await sha256ContentHash(executableContent);
}

export async function computeSemanticSourceBundleHash(
  bundle: SemanticSourceBundle,
): Promise<`sha256:${string}`> {
  return sha256ContentHash(bundle);
}

// ─── Validation helpers ───────────────────────────────────────────────────────

export function assertSemanticSourceBundleInvariants(bundle: SemanticSourceBundle): void {
  if (bundle.metrics.length === 0) {
    throw new SemanticGovernanceError("SemanticSourceBundle 必须包含至少一个 Metric。");
  }
  if (bundle.metadata.capability_profile !== U5_EXECUTABLE_SUBSET && bundle.metadata.capability_profile !== U13_EXECUTABLE_SUBSET) {
    throw new SemanticGovernanceError("CapabilityProfile 必须为 U5_EXECUTABLE_SUBSET 或 U13_EXECUTABLE_SUBSET。");
  }
  if (bundle.metadata.bundle_version !== SEMANTIC_SOURCE_BUNDLE_VERSION) {
    throw new SemanticGovernanceError("BundleVersion 必须为 semantic-source-bundle@1。");
  }

  const metricIds = new Set(bundle.metrics.map((m) => m.metric_id));
  if (metricIds.size !== bundle.metrics.length) {
    throw new SemanticGovernanceError("SemanticSourceBundle 不能包含重复的 Metric ID。");
  }

  const dimensionIds = new Set(bundle.dimensions.map((d) => d.dimension_id));
  if (dimensionIds.size !== bundle.dimensions.length) {
    throw new SemanticGovernanceError("SemanticSourceBundle 不能包含重复的 Dimension ID。");
  }
  for (const metricId of metricIds) {
    if (dimensionIds.has(metricId)) {
      throw new SemanticGovernanceError("Metric 与 Dimension 的身份必须互斥。");
    }
  }

  const relationshipIds = new Set(bundle.relationships.map((r) => r.relationship_id));
  if (relationshipIds.size !== bundle.relationships.length) {
    throw new SemanticGovernanceError("SemanticSourceBundle 不能包含重复的 Relationship ID。");
  }

  const formulaIds = new Set(bundle.formulas.map((f) => f.formula_id));
  if (formulaIds.size !== bundle.formulas.length) {
    throw new SemanticGovernanceError("SemanticSourceBundle 不能包含重复的 Formula ID。");
  }
  // ─── BusinessOntology 校验 ────────────────────────────────────────────────
  if (bundle.business_ontology) {
    const ontology = bundle.business_ontology;
    const entityIds = new Set(ontology.entities.map((e) => e.entity_id));
    if (entityIds.size !== ontology.entities.length) {
      throw new SemanticGovernanceError("BusinessOntology 不能包含重复的 Entity ID。");
    }
    const eventIds = new Set(ontology.events.map((e) => e.event_id));
    if (eventIds.size !== ontology.events.length) {
      throw new SemanticGovernanceError("BusinessOntology 不能包含重复的 Event ID。");
    }
    const termIds = new Set(ontology.terms.map((t) => t.term_id));
    if (termIds.size !== ontology.terms.length) {
      throw new SemanticGovernanceError("BusinessOntology 不能包含重复的 Term ID。");
    }
    // 交叉引用校验：entity / event / term ID 互斥
    for (const entityId of entityIds) {
      if (eventIds.has(entityId)) {
        throw new SemanticGovernanceError("Entity ID 与 Event ID 必须互斥。");
      }
      if (termIds.has(entityId)) {
        throw new SemanticGovernanceError("Entity ID 与 Term ID 必须互斥。");
      }
    }
    for (const eventId of eventIds) {
      if (termIds.has(eventId)) {
        throw new SemanticGovernanceError("Event ID 与 Term ID 必须互斥。");
      }
    }
    // 校验事件引用的 subject_entity_id 在实体中存在
    for (const event of ontology.events) {
      if (!entityIds.has(event.subject_entity_id)) {
        throw new SemanticGovernanceError(
          `Event ${event.event_id} 引用不存在的 subject_entity_id: ${event.subject_entity_id}。`,
        );
      }
    }
    // 校验实体业务关系引用的 target_entity_id 在实体中存在
    for (const entity of ontology.entities) {
      for (const rel of entity.business_relationship_types) {
        if (!entityIds.has(rel.target_entity_id)) {
          throw new SemanticGovernanceError(
            `Entity ${entity.entity_id} 的业务关系引用不存在的 target_entity_id: ${rel.target_entity_id}。`,
          );
        }
      }
    }
  }

  // ─── CatalogGovernance 校验 ────────────────────────────────────────────────
  if (bundle.catalog_governance) {
    const catalog = bundle.catalog_governance;
    const tableIds = new Set(catalog.tables.map((t) => t.table_id));
    if (tableIds.size !== catalog.tables.length) {
      throw new SemanticGovernanceError("CatalogGovernance 不能包含重复的 Table ID。");
    }
    for (const table of catalog.tables) {
      const columnIds = new Set(table.columns.map((c) => c.column_id));
      if (columnIds.size !== table.columns.length) {
        throw new SemanticGovernanceError(
          `CatalogGovernance 表 ${table.table_id} 不能包含重复的 Column ID。`,
        );
      }
    }
  }

  // ─── PhysicalBinding 校验 ──────────────────────────────────────────────────
  if (bundle.physical_binding) {
    const binding = bundle.physical_binding;
    const logicalObjectIds = new Set(binding.entries.map((e) => e.logical_object_id));
    if (logicalObjectIds.size !== binding.entries.length) {
      throw new SemanticGovernanceError("PhysicalBinding 不能包含重复的 Logical Object ID。");
    }
  }

  // ─── Bounded closure 校验：所有引用指向 bundle 内的有效对象 ──────────────
  if (bundle.physical_binding && bundle.physical_binding.entries.length > 0) {
    const allLogicalIds = new Set([...metricIds, ...dimensionIds, ...relationshipIds]);
    for (const entry of bundle.physical_binding.entries) {
      if (!allLogicalIds.has(entry.logical_object_id)) {
        throw new SemanticGovernanceError(
          `PhysicalBinding 条目引用不存在的逻辑对象 ID: ${entry.logical_object_id}。`,
        );
      }
    }
  }
}

export class SemanticGovernanceError extends Error {
  override readonly name = "SemanticGovernanceError";
}

// ─── Reference types ──────────────────────────────────────────────────────────

export const semanticSourceBundleReferenceSchema = artifactReferenceFor("SemanticSourceBundle");
export type SemanticSourceBundleReference = z.infer<typeof semanticSourceBundleReferenceSchema>;

// ─── M1 subset restriction ────────────────────────────────────────────────────

export const M1_ALLOWED_CAPABILITY_PROFILES = [U5_EXECUTABLE_SUBSET] as const;

export function assertM1SubsetRestriction(bundle: SemanticSourceBundle): void {
  if (
    !M1_ALLOWED_CAPABILITY_PROFILES.includes(
      bundle.metadata.capability_profile as typeof U5_EXECUTABLE_SUBSET,
    ) && bundle.metadata.capability_profile !== U13_EXECUTABLE_SUBSET
  ) {
    throw new SemanticGovernanceError("M1 只允许 U5_EXECUTABLE_SUBSET 或 U13_EXECUTABLE_SUBSET 能力子集。");
  }
  if (bundle.metadata.capability_profile === U5_EXECUTABLE_SUBSET && bundle.contribution_profile) {
    throw new SemanticGovernanceError("M1 不允许 DescriptiveContributionProfile。");
  }
}
