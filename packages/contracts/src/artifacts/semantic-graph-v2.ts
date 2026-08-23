import { z } from "zod";
import {
  contentHashSchema,
  environmentSchema,
  immutableIdSchema,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import { artifactProducerSchema, deterministicAuthoritySchema } from "./envelope.js";
import {
  grainSchema,
  semanticDimensionAnalysisSchema,
  semanticMetricAnalysisSchema,
  semanticRelationshipAnalysisSchema,
  timeDomainSchema,
  unitSchema,
} from "./semantic-governance.js";
import {
  DATA_TYPE,
  METRIC_ADDITIVITY,
  METRIC_FANOUT_POLICY,
  METRIC_NULL_POLICY,
  SENSITIVITY_LEVEL,
} from "./text2sql-primitives.js";

export const SEMANTIC_GRAPH_SOURCE_VERSION = "semantic-graph-source@2" as const;
export const SEMANTIC_FORMULA_AST_VERSION = "semantic-formula-ast@1" as const;
export const SEMANTIC_GRAPH_PATCH_VERSION = "semantic-graph-patch@1" as const;
export const SEMANTIC_GRAPH_PROJECTION_VERSION = "semantic-graph-projection@1" as const;
export const SEMANTIC_ONTOLOGY_COVERAGE_RECEIPT_VERSION = "semantic-ontology-coverage@1" as const;

export const semanticNodeTypeSchema = z.enum([
  "BUSINESS_SUBJECT",
  "DIMENSION",
  "METRIC",
  "FORMULA",
  "PHYSICAL_TABLE",
  "PHYSICAL_COLUMN",
  "GLOSSARY_TERM",
]);
export const semanticLifecycleSchema = z.enum(["ACTIVE", "DEPRECATED", "RETIRED"]);
export const semanticAuthoringPolicySchema = z.enum(["AGENT_AUTHORED", "SYSTEM_MANAGED"]);
export const semanticEdgeFamilySchema = z.enum([
  "BUSINESS",
  "ANALYTICAL",
  "FORMULA",
  "PHYSICAL",
  "JOIN",
  "PROVENANCE",
  "TERMINOLOGY",
]);
export const semanticEdgeAttributeKindSchema = z.enum([
  "NONE",
  "BUSINESS_RELATION",
  "SLOT_BINDING",
  "BINDING",
  "GRAIN_BINDING",
  "JOIN_PROOF",
  "PHYSICAL_FACT",
  "PROVENANCE",
  "DIMENSION_USE",
  "TERM_LINK",
]);

export const semanticNodeTypeDefinitionSchema = z.strictObject({
  node_type: semanticNodeTypeSchema,
  display_name: z.string().min(1).max(128),
  authoring_policy: semanticAuthoringPolicySchema,
});

export const semanticEdgeTypeDefinitionSchema = z.strictObject({
  edge_type: versionIdentifierSchema,
  display_name: z.string().min(1).max(128),
  family: semanticEdgeFamilySchema,
  source_node_types: z.array(semanticNodeTypeSchema).min(1),
  target_node_types: z.array(semanticNodeTypeSchema).min(1),
  direction: z.literal("DIRECTED"),
  parallel_policy: z.enum(["FORBID", "ALLOW_DISTINCT_ATTRIBUTES"]),
  authoring_policy: semanticAuthoringPolicySchema,
  attribute_kind: semanticEdgeAttributeKindSchema,
});

export const semanticEvidenceSchema = z.strictObject({
  evidence_id: versionIdentifierSchema,
  kind: z.enum([
    "SCHEMA_SNAPSHOT",
    "DDL_CONSTRAINT",
    "QUERY_SAMPLE",
    "BUSINESS_DOCUMENT",
    "HUMAN_ASSERTION",
    "COMPILER_RECEIPT",
  ]),
  content_hash: contentHashSchema,
  description: z.string().max(1024).optional(),
});

export type SemanticFormulaExpression =
  | { readonly kind: "LITERAL"; readonly value: string | number | boolean | null }
  | { readonly kind: "SLOT"; readonly slot_id: string }
  | {
      readonly kind: "BINARY";
      readonly operator:
        | "ADD"
        | "SUBTRACT"
        | "MULTIPLY"
        | "DIVIDE"
        | "EQ"
        | "NEQ"
        | "GT"
        | "GTE"
        | "LT"
        | "LTE";
      readonly left: SemanticFormulaExpression;
      readonly right: SemanticFormulaExpression;
    }
  | {
      readonly kind: "BOOLEAN";
      readonly operator: "AND" | "OR";
      readonly operands: readonly SemanticFormulaExpression[];
    }
  | { readonly kind: "NOT"; readonly operand: SemanticFormulaExpression }
  | {
      readonly kind: "CASE";
      readonly branches: readonly {
        readonly when: SemanticFormulaExpression;
        readonly result: SemanticFormulaExpression;
      }[];
      readonly otherwise: SemanticFormulaExpression | null;
    }
  | {
      readonly kind: "AGGREGATE";
      readonly function: "SUM" | "COUNT" | "COUNT_DISTINCT" | "AVG" | "MIN" | "MAX";
      readonly input: SemanticFormulaExpression | null;
      readonly distinct: boolean;
      readonly filter: SemanticFormulaExpression | null;
    }
  | {
      readonly kind: "DATE_BUCKET";
      readonly granularity: "hour" | "day" | "week" | "month" | "quarter" | "year";
      readonly input: SemanticFormulaExpression;
    };

export const semanticFormulaExpressionSchema: z.ZodType<SemanticFormulaExpression> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("LITERAL"),
      value: z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
    }),
    z.strictObject({ kind: z.literal("SLOT"), slot_id: versionIdentifierSchema }),
    z.strictObject({
      kind: z.literal("BINARY"),
      operator: z.enum([
        "ADD",
        "SUBTRACT",
        "MULTIPLY",
        "DIVIDE",
        "EQ",
        "NEQ",
        "GT",
        "GTE",
        "LT",
        "LTE",
      ]),
      left: semanticFormulaExpressionSchema,
      right: semanticFormulaExpressionSchema,
    }),
    z.strictObject({
      kind: z.literal("BOOLEAN"),
      operator: z.enum(["AND", "OR"]),
      operands: z.array(semanticFormulaExpressionSchema).min(2),
    }),
    z.strictObject({ kind: z.literal("NOT"), operand: semanticFormulaExpressionSchema }),
    z.strictObject({
      kind: z.literal("CASE"),
      branches: z
        .array(
          z.strictObject({
            when: semanticFormulaExpressionSchema,
            result: semanticFormulaExpressionSchema,
          }),
        )
        .min(1),
      otherwise: semanticFormulaExpressionSchema.nullable(),
    }),
    z.strictObject({
      kind: z.literal("AGGREGATE"),
      function: z.enum(["SUM", "COUNT", "COUNT_DISTINCT", "AVG", "MIN", "MAX"]),
      input: semanticFormulaExpressionSchema.nullable(),
      distinct: z.boolean().default(false),
      filter: semanticFormulaExpressionSchema.nullable().default(null),
    }),
    z.strictObject({
      kind: z.literal("DATE_BUCKET"),
      granularity: z.enum(["hour", "day", "week", "month", "quarter", "year"]),
      input: semanticFormulaExpressionSchema,
    }),
  ]),
);

const semanticNodeCommonShape = {
  node_id: versionIdentifierSchema,
  node_version: z.number().int().positive(),
  name: z.string().min(1).max(256),
  description: z.string().max(2048).optional(),
  aliases: z.array(z.string().min(1).max(128)).default([]),
  owner_ref: versionIdentifierSchema,
  lifecycle: semanticLifecycleSchema,
  evidence_refs: z.array(versionIdentifierSchema).default([]),
  tags: z.array(z.string().min(1).max(128)).default([]),
};

export const businessSubjectNodeSchema = z.strictObject({
  ...semanticNodeCommonShape,
  node_type: z.literal("BUSINESS_SUBJECT"),
  domain: z.string().min(1).max(128),
});
export const dimensionNodeSchema = z.strictObject({
  ...semanticNodeCommonShape,
  node_type: z.literal("DIMENSION"),
  data_type: z.enum(DATA_TYPE),
  sensitivity: z.enum(SENSITIVITY_LEVEL).default("PUBLIC"),
  filter_semantics: z.enum(["EXACT", "RANGE", "HIERARCHICAL", "TEMPORAL"]),
  analysis: semanticDimensionAnalysisSchema,
});
export const metricNodeSchema = z.strictObject({
  ...semanticNodeCommonShape,
  node_type: z.literal("METRIC"),
  unit: unitSchema.nullable(),
  additivity: z.enum(METRIC_ADDITIVITY),
  null_policy: z.enum(METRIC_NULL_POLICY),
  fanout_policy: z.enum(METRIC_FANOUT_POLICY),
  analysis: semanticMetricAnalysisSchema,
});
export const formulaNodeSchema = z.strictObject({
  ...semanticNodeCommonShape,
  node_type: z.literal("FORMULA"),
  formula_type: z.enum([
    "additive_aggregate",
    "semi_additive_aggregate",
    "non_additive_aggregate",
    "ratio",
    "compound",
    "window",
    "other",
  ]),
  return_type: z.enum(["numeric", "integer", "boolean", "text", "date", "timestamp"]),
  language: z.literal("semantic-ast"),
  language_version: z.literal(SEMANTIC_FORMULA_AST_VERSION),
  expression: semanticFormulaExpressionSchema,
});
export const physicalTableNodeSchema = z.strictObject({
  ...semanticNodeCommonShape,
  node_type: z.literal("PHYSICAL_TABLE"),
  schema_snapshot_id: immutableIdSchema,
  snapshot_content_hash: contentHashSchema,
  datasource_id: immutableIdSchema,
  schema_name: z.string().min(1).max(256),
  table_name: z.string().min(1).max(256),
  relation_kind: z.enum(["TABLE", "VIEW", "MATERIALIZED_VIEW"]),
});
export const physicalColumnNodeSchema = z.strictObject({
  ...semanticNodeCommonShape,
  node_type: z.literal("PHYSICAL_COLUMN"),
  schema_snapshot_id: immutableIdSchema,
  snapshot_content_hash: contentHashSchema,
  datasource_id: immutableIdSchema,
  schema_name: z.string().min(1).max(256),
  table_name: z.string().min(1).max(256),
  column_name: z.string().min(1).max(256),
  ordinal: z.number().int().nonnegative(),
  formatted_type: z.string().min(1).max(256),
  data_type: z.enum(DATA_TYPE),
  nullable: z.boolean(),
  sensitivity: z.enum(SENSITIVITY_LEVEL).default("PUBLIC"),
});
export const glossaryTermNodeSchema = z.strictObject({
  ...semanticNodeCommonShape,
  node_type: z.literal("GLOSSARY_TERM"),
  definition: z.string().min(1).max(2048),
  language: z.string().min(2).max(35).default("zh-CN"),
  term_kind: z.enum(["BUSINESS", "ANALYTICAL", "PHYSICAL", "GOVERNANCE"]),
  abbreviation: z.string().min(1).max(64).nullable().default(null),
});

export const semanticGraphNodeSchema = z.discriminatedUnion("node_type", [
  businessSubjectNodeSchema,
  dimensionNodeSchema,
  metricNodeSchema,
  formulaNodeSchema,
  physicalTableNodeSchema,
  physicalColumnNodeSchema,
  glossaryTermNodeSchema,
]);

export const semanticEdgeAttributesSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("NONE") }),
  z.strictObject({
    kind: z.literal("BUSINESS_RELATION"),
    relationship_name: z.string().min(1).max(128),
    cardinality: z.enum(["one-to-one", "one-to-many", "many-to-one", "many-to-many"]),
  }),
  z.strictObject({
    kind: z.literal("SLOT_BINDING"),
    slot_id: versionIdentifierSchema,
    role: z.enum(["MEASURE", "FILTER", "TIME", "DEPENDENCY"]),
  }),
  z.strictObject({ kind: z.literal("BINDING"), role: z.enum(["PRIMARY", "ALTERNATE"]) }),
  z.strictObject({
    kind: z.literal("GRAIN_BINDING"),
    grain: grainSchema,
    time_domain: timeDomainSchema.nullable().default(null),
  }),
  z.strictObject({
    kind: z.literal("JOIN_PROOF"),
    cardinality: z.enum(["one-to-one", "one-to-many", "many-to-one", "many-to-many"]),
    left_row_preservation: z.enum(["required", "optional"]),
    right_row_preservation: z.enum(["required", "optional"]),
    proof_kind: z.enum(["DDL_ENFORCED", "SNAPSHOT_CERTIFIED", "DECLARED_ONLY"]),
    proof_detail: z.string().max(1024).nullable(),
    analysis: semanticRelationshipAnalysisSchema,
  }),
  z.strictObject({
    kind: z.literal("PHYSICAL_FACT"),
    schema_snapshot_id: immutableIdSchema,
    snapshot_content_hash: contentHashSchema,
    fact_kind: z.enum(["CONTAINS_COLUMN", "FOREIGN_KEY"]),
  }),
  z.strictObject({
    kind: z.literal("PROVENANCE"),
    derivation_kind: z.enum(["DERIVED", "SUPPORTED", "MIGRATED"]),
    note: z.string().max(1024).nullable(),
  }),
  z.strictObject({
    kind: z.literal("DIMENSION_USE"),
    role: z.enum(["GROUP_BY", "FILTER", "TIME_CONTEXT"]),
  }),
  z.strictObject({
    kind: z.literal("TERM_LINK"),
    lexical_role: z.enum(["PREFERRED", "SYNONYM", "ABBREVIATION", "RELATED"]),
  }),
]);

export const semanticGraphEdgeSchema = z.strictObject({
  edge_id: versionIdentifierSchema,
  edge_version: z.number().int().positive(),
  edge_type: versionIdentifierSchema,
  family: semanticEdgeFamilySchema,
  source_node_id: versionIdentifierSchema,
  target_node_id: versionIdentifierSchema,
  lifecycle: semanticLifecycleSchema,
  attributes: semanticEdgeAttributesSchema,
  evidence_refs: z.array(versionIdentifierSchema).default([]),
});

export const semanticGraphMetadataSchema = z.strictObject({
  graph_version: z.literal(SEMANTIC_GRAPH_SOURCE_VERSION),
  graph_id: immutableIdSchema,
  domain_id: versionIdentifierSchema,
  base_release_id: immutableIdSchema.nullable(),
  capability_profile: z.enum(["U5_EXECUTABLE_SUBSET", "U13_EXECUTABLE_SUBSET"]),
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

export const semanticGraphSourceSchema = z.strictObject({
  metadata: semanticGraphMetadataSchema,
  node_type_registry: z.array(semanticNodeTypeDefinitionSchema).min(6),
  edge_type_registry: z.array(semanticEdgeTypeDefinitionSchema).min(1),
  evidence: z.array(semanticEvidenceSchema).default([]),
  nodes: z.array(semanticGraphNodeSchema).min(1),
  edges: z.array(semanticGraphEdgeSchema).default([]),
});

const addNodeOperationSchema = z.strictObject({
  operation: z.literal("ADD_NODE"),
  node: semanticGraphNodeSchema,
});
const updateNodeOperationSchema = z.strictObject({
  operation: z.literal("UPDATE_NODE"),
  node: semanticGraphNodeSchema,
  expected_node_version: z.number().int().positive(),
  expected_entry_digest: contentHashSchema,
});
const retireNodeOperationSchema = z.strictObject({
  operation: z.literal("RETIRE_NODE"),
  node_id: versionIdentifierSchema,
  expected_node_version: z.number().int().positive(),
  expected_entry_digest: contentHashSchema,
  retirement_reason: z.string().min(1).max(1024),
});
const addEdgeOperationSchema = z.strictObject({
  operation: z.literal("ADD_EDGE"),
  edge: semanticGraphEdgeSchema,
});
const updateEdgeOperationSchema = z.strictObject({
  operation: z.literal("UPDATE_EDGE"),
  edge: semanticGraphEdgeSchema,
  expected_edge_version: z.number().int().positive(),
  expected_entry_digest: contentHashSchema,
});
const retireEdgeOperationSchema = z.strictObject({
  operation: z.literal("RETIRE_EDGE"),
  edge_id: versionIdentifierSchema,
  expected_edge_version: z.number().int().positive(),
  expected_entry_digest: contentHashSchema,
  retirement_reason: z.string().min(1).max(1024),
});
const addEdgeTypeOperationSchema = z.strictObject({
  operation: z.literal("ADD_EDGE_TYPE"),
  edge_type_definition: semanticEdgeTypeDefinitionSchema,
});

export const semanticGraphPatchOperationSchema = z.discriminatedUnion("operation", [
  addNodeOperationSchema,
  updateNodeOperationSchema,
  retireNodeOperationSchema,
  addEdgeOperationSchema,
  updateEdgeOperationSchema,
  retireEdgeOperationSchema,
  addEdgeTypeOperationSchema,
]);
export const semanticGraphPatchSchema = z.strictObject({
  patch_version: z.literal(SEMANTIC_GRAPH_PATCH_VERSION),
  patch_id: immutableIdSchema,
  graph_id: immutableIdSchema,
  candidate_id: immutableIdSchema,
  from_working_revision: z.number().int().nonnegative(),
  to_working_revision: z.number().int().positive(),
  before_digest: contentHashSchema,
  after_digest: contentHashSchema,
  operations: z.array(semanticGraphPatchOperationSchema).min(1),
  patch_digest: contentHashSchema,
});

export const semanticGraphProjectionSchema = z.strictObject({
  projection_version: z.literal(SEMANTIC_GRAPH_PROJECTION_VERSION),
  graph_id: immutableIdSchema,
  source_digest: contentHashSchema,
  registry_digest: contentHashSchema,
  compiler_version: versionIdentifierSchema,
  node_count: z.number().int().nonnegative(),
  edge_count: z.number().int().nonnegative(),
  nodes: z.array(semanticGraphNodeSchema),
  edges: z.array(semanticGraphEdgeSchema),
});

export const semanticGraphProjectionReceiptSchema = z.strictObject({
  projection_id: immutableIdSchema,
  graph_id: immutableIdSchema,
  source_revision_id: immutableIdSchema,
  source_revision_digest: contentHashSchema,
  source_digest: contentHashSchema,
  registry_digest: contentHashSchema,
  compiler_version: versionIdentifierSchema,
  projection_storage_digest: contentHashSchema,
  node_count: z.number().int().nonnegative(),
  edge_count: z.number().int().nonnegative(),
  created_at: timestampSchema,
  created: z.boolean(),
});

export const semanticGraphReleaseBindingSchema = z.strictObject({
  release_id: immutableIdSchema,
  projection_id: immutableIdSchema,
  source_revision_id: immutableIdSchema,
  source_revision_digest: contentHashSchema,
  source_digest: contentHashSchema,
  projection_storage_digest: contentHashSchema,
  bound_at: timestampSchema,
  created: z.boolean(),
});

export const semanticOntologyCoverageCodeSchema = z.enum([
  "SUBJECT_RELATION_MISSING",
  "SUBJECT_DIMENSION_MISSING",
  "SUBJECT_PHYSICAL_TABLE_MISSING",
  "SUBJECT_IDENTIFIER_MISSING",
  "SUBJECT_IDENTIFIER_OUTSIDE_TABLE",
  "DIMENSION_SUBJECT_MISSING",
  "DIMENSION_BINDING_MISSING",
  "METRIC_SUBJECT_MISSING",
  "METRIC_FORMULA_MISSING",
  "FORMULA_SUBJECT_MISSING",
  "FORMULA_DIMENSION_MISSING",
  "FORMULA_COLUMN_MISSING",
  "FORMULA_REFERENCE_UNREACHABLE",
  "JOIN_PROOF_INSUFFICIENT",
  "GLOSSARY_TERM_UNLINKED",
]);

export const semanticOntologyCoverageIssueSchema = z.strictObject({
  code: semanticOntologyCoverageCodeSchema,
  message: z.string().min(1).max(1024),
  entry_id: versionIdentifierSchema,
  related_entry_ids: z.array(versionIdentifierSchema).default([]),
});

export const semanticOntologyCoverageReceiptSchema = z.strictObject({
  receipt_version: z.literal(SEMANTIC_ONTOLOGY_COVERAGE_RECEIPT_VERSION),
  graph_id: immutableIdSchema,
  source_digest: contentHashSchema,
  validator_version: versionIdentifierSchema,
  valid: z.boolean(),
  checked_at: timestampSchema,
  active_node_counts: z.record(semanticNodeTypeSchema, z.number().int().nonnegative()),
  active_edge_family_counts: z.record(semanticEdgeFamilySchema, z.number().int().nonnegative()),
  issues: z.array(semanticOntologyCoverageIssueSchema),
  receipt_digest: contentHashSchema,
});

export type SemanticNodeType = z.infer<typeof semanticNodeTypeSchema>;
export type SemanticEdgeFamily = z.infer<typeof semanticEdgeFamilySchema>;
export type SemanticNodeTypeDefinition = z.infer<typeof semanticNodeTypeDefinitionSchema>;
export type SemanticEdgeTypeDefinition = z.infer<typeof semanticEdgeTypeDefinitionSchema>;
export type SemanticEvidence = z.infer<typeof semanticEvidenceSchema>;
export type SemanticGraphNode = z.infer<typeof semanticGraphNodeSchema>;
export type SemanticGraphEdge = z.infer<typeof semanticGraphEdgeSchema>;
export type SemanticGraphSource = z.infer<typeof semanticGraphSourceSchema>;
export type SemanticGraphPatch = z.infer<typeof semanticGraphPatchSchema>;
export type SemanticGraphPatchOperation = z.infer<typeof semanticGraphPatchOperationSchema>;
export type SemanticGraphProjection = z.infer<typeof semanticGraphProjectionSchema>;
export type SemanticGraphProjectionReceipt = z.infer<typeof semanticGraphProjectionReceiptSchema>;
export type SemanticGraphReleaseBinding = z.infer<typeof semanticGraphReleaseBindingSchema>;
export type SemanticOntologyCoverageCode = z.infer<typeof semanticOntologyCoverageCodeSchema>;
export type SemanticOntologyCoverageIssue = z.infer<typeof semanticOntologyCoverageIssueSchema>;
export type SemanticOntologyCoverageReceipt = z.infer<typeof semanticOntologyCoverageReceiptSchema>;

export const BUILTIN_SEMANTIC_NODE_TYPES: readonly SemanticNodeTypeDefinition[] = [
  { node_type: "BUSINESS_SUBJECT", display_name: "业务主体", authoring_policy: "AGENT_AUTHORED" },
  { node_type: "DIMENSION", display_name: "维度", authoring_policy: "AGENT_AUTHORED" },
  { node_type: "METRIC", display_name: "指标", authoring_policy: "AGENT_AUTHORED" },
  { node_type: "FORMULA", display_name: "公式", authoring_policy: "AGENT_AUTHORED" },
  { node_type: "PHYSICAL_TABLE", display_name: "物理表", authoring_policy: "SYSTEM_MANAGED" },
  { node_type: "PHYSICAL_COLUMN", display_name: "物理列", authoring_policy: "SYSTEM_MANAGED" },
  { node_type: "GLOSSARY_TERM", display_name: "术语", authoring_policy: "AGENT_AUTHORED" },
];

export const BUILTIN_SEMANTIC_EDGE_TYPES: readonly SemanticEdgeTypeDefinition[] = [
  {
    edge_type: "RELATES_TO",
    display_name: "业务关系",
    family: "BUSINESS",
    source_node_types: ["BUSINESS_SUBJECT"],
    target_node_types: ["BUSINESS_SUBJECT"],
    direction: "DIRECTED",
    parallel_policy: "ALLOW_DISTINCT_ATTRIBUTES",
    authoring_policy: "AGENT_AUTHORED",
    attribute_kind: "BUSINESS_RELATION",
  },
  {
    edge_type: "HAS_DIMENSION",
    display_name: "拥有维度",
    family: "ANALYTICAL",
    source_node_types: ["BUSINESS_SUBJECT"],
    target_node_types: ["DIMENSION"],
    direction: "DIRECTED",
    parallel_policy: "FORBID",
    authoring_policy: "AGENT_AUTHORED",
    attribute_kind: "NONE",
  },
  {
    edge_type: "HAS_METRIC",
    display_name: "拥有指标",
    family: "ANALYTICAL",
    source_node_types: ["BUSINESS_SUBJECT"],
    target_node_types: ["METRIC"],
    direction: "DIRECTED",
    parallel_policy: "FORBID",
    authoring_policy: "AGENT_AUTHORED",
    attribute_kind: "NONE",
  },
  {
    edge_type: "DEFINED_BY",
    display_name: "由公式定义",
    family: "FORMULA",
    source_node_types: ["METRIC"],
    target_node_types: ["FORMULA"],
    direction: "DIRECTED",
    parallel_policy: "FORBID",
    authoring_policy: "AGENT_AUTHORED",
    attribute_kind: "NONE",
  },
  {
    edge_type: "DEPENDS_ON",
    display_name: "依赖公式",
    family: "FORMULA",
    source_node_types: ["FORMULA"],
    target_node_types: ["FORMULA"],
    direction: "DIRECTED",
    parallel_policy: "ALLOW_DISTINCT_ATTRIBUTES",
    authoring_policy: "AGENT_AUTHORED",
    attribute_kind: "SLOT_BINDING",
  },
  {
    edge_type: "AT_GRAIN",
    display_name: "计算粒度",
    family: "ANALYTICAL",
    source_node_types: ["FORMULA", "DIMENSION"],
    target_node_types: ["BUSINESS_SUBJECT"],
    direction: "DIRECTED",
    parallel_policy: "FORBID",
    authoring_policy: "AGENT_AUTHORED",
    attribute_kind: "GRAIN_BINDING",
  },
  {
    edge_type: "ROLLS_UP_TO",
    display_name: "维度上卷",
    family: "ANALYTICAL",
    source_node_types: ["DIMENSION"],
    target_node_types: ["DIMENSION"],
    direction: "DIRECTED",
    parallel_policy: "FORBID",
    authoring_policy: "AGENT_AUTHORED",
    attribute_kind: "NONE",
  },
  {
    edge_type: "CONTAINS_COLUMN",
    display_name: "包含物理列",
    family: "PHYSICAL",
    source_node_types: ["PHYSICAL_TABLE"],
    target_node_types: ["PHYSICAL_COLUMN"],
    direction: "DIRECTED",
    parallel_policy: "FORBID",
    authoring_policy: "SYSTEM_MANAGED",
    attribute_kind: "PHYSICAL_FACT",
  },
  {
    edge_type: "FOREIGN_KEY_TO",
    display_name: "物理外键",
    family: "PHYSICAL",
    source_node_types: ["PHYSICAL_COLUMN"],
    target_node_types: ["PHYSICAL_COLUMN"],
    direction: "DIRECTED",
    parallel_policy: "FORBID",
    authoring_policy: "SYSTEM_MANAGED",
    attribute_kind: "PHYSICAL_FACT",
  },
  {
    edge_type: "BOUND_TO",
    display_name: "绑定物理列",
    family: "ANALYTICAL",
    source_node_types: ["DIMENSION"],
    target_node_types: ["PHYSICAL_COLUMN"],
    direction: "DIRECTED",
    parallel_policy: "ALLOW_DISTINCT_ATTRIBUTES",
    authoring_policy: "AGENT_AUTHORED",
    attribute_kind: "BINDING",
  },
  {
    edge_type: "REPRESENTED_BY",
    display_name: "主体由物理表承载",
    family: "ANALYTICAL",
    source_node_types: ["BUSINESS_SUBJECT"],
    target_node_types: ["PHYSICAL_TABLE"],
    direction: "DIRECTED",
    parallel_policy: "ALLOW_DISTINCT_ATTRIBUTES",
    authoring_policy: "AGENT_AUTHORED",
    attribute_kind: "BINDING",
  },
  {
    edge_type: "IDENTIFIED_BY",
    display_name: "主体标识字段",
    family: "ANALYTICAL",
    source_node_types: ["BUSINESS_SUBJECT"],
    target_node_types: ["PHYSICAL_COLUMN"],
    direction: "DIRECTED",
    parallel_policy: "ALLOW_DISTINCT_ATTRIBUTES",
    authoring_policy: "AGENT_AUTHORED",
    attribute_kind: "BINDING",
  },
  {
    edge_type: "REFERENCES",
    display_name: "公式引用",
    family: "FORMULA",
    source_node_types: ["FORMULA"],
    target_node_types: ["PHYSICAL_COLUMN"],
    direction: "DIRECTED",
    parallel_policy: "ALLOW_DISTINCT_ATTRIBUTES",
    authoring_policy: "AGENT_AUTHORED",
    attribute_kind: "SLOT_BINDING",
  },
  {
    edge_type: "USES_DIMENSION",
    display_name: "公式使用维度",
    family: "FORMULA",
    source_node_types: ["FORMULA"],
    target_node_types: ["DIMENSION"],
    direction: "DIRECTED",
    parallel_policy: "ALLOW_DISTINCT_ATTRIBUTES",
    authoring_policy: "AGENT_AUTHORED",
    attribute_kind: "DIMENSION_USE",
  },
  {
    edge_type: "JOINABLE_VIA",
    display_name: "可连接",
    family: "JOIN",
    source_node_types: ["PHYSICAL_COLUMN"],
    target_node_types: ["PHYSICAL_COLUMN"],
    direction: "DIRECTED",
    parallel_policy: "ALLOW_DISTINCT_ATTRIBUTES",
    authoring_policy: "AGENT_AUTHORED",
    attribute_kind: "JOIN_PROOF",
  },
  {
    edge_type: "SUPPORTED_BY",
    display_name: "受物理事实支持",
    family: "PROVENANCE",
    source_node_types: ["BUSINESS_SUBJECT", "DIMENSION", "METRIC", "FORMULA"],
    target_node_types: ["PHYSICAL_TABLE", "PHYSICAL_COLUMN"],
    direction: "DIRECTED",
    parallel_policy: "ALLOW_DISTINCT_ATTRIBUTES",
    authoring_policy: "AGENT_AUTHORED",
    attribute_kind: "PROVENANCE",
  },
  {
    edge_type: "DERIVED_FROM",
    display_name: "派生自",
    family: "PROVENANCE",
    source_node_types: ["DIMENSION", "METRIC", "FORMULA"],
    target_node_types: ["DIMENSION", "METRIC", "FORMULA"],
    direction: "DIRECTED",
    parallel_policy: "ALLOW_DISTINCT_ATTRIBUTES",
    authoring_policy: "AGENT_AUTHORED",
    attribute_kind: "PROVENANCE",
  },
  {
    edge_type: "DENOTES",
    display_name: "术语指代",
    family: "TERMINOLOGY",
    source_node_types: ["GLOSSARY_TERM"],
    target_node_types: [
      "BUSINESS_SUBJECT",
      "DIMENSION",
      "METRIC",
      "FORMULA",
      "PHYSICAL_TABLE",
      "PHYSICAL_COLUMN",
    ],
    direction: "DIRECTED",
    parallel_policy: "ALLOW_DISTINCT_ATTRIBUTES",
    authoring_policy: "AGENT_AUTHORED",
    attribute_kind: "TERM_LINK",
  },
  {
    edge_type: "BROADER_THAN",
    display_name: "上位术语",
    family: "TERMINOLOGY",
    source_node_types: ["GLOSSARY_TERM"],
    target_node_types: ["GLOSSARY_TERM"],
    direction: "DIRECTED",
    parallel_policy: "FORBID",
    authoring_policy: "AGENT_AUTHORED",
    attribute_kind: "NONE",
  },
  {
    edge_type: "RELATED_TERM",
    display_name: "相关术语",
    family: "TERMINOLOGY",
    source_node_types: ["GLOSSARY_TERM"],
    target_node_types: ["GLOSSARY_TERM"],
    direction: "DIRECTED",
    parallel_policy: "FORBID",
    authoring_policy: "AGENT_AUTHORED",
    attribute_kind: "NONE",
  },
];
