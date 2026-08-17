import { z } from "zod";
import { relationIdentitySchema } from "../catalog/physical-schema.js";
import {
  contentHashSchema,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import { semanticScopeSchema } from "./semantic-control-plane.js";
import {
  businessEntitySchema,
  physicalBindingEntrySchema,
  semanticDimensionSchema,
  semanticMetricSchema,
  semanticRelationshipSchema,
} from "./semantic-governance.js";

export const SEMANTIC_COMPILE_REQUEST_VERSION = "semantic-compile-request@1.0.0" as const;
export const SCHEMA_FEATURE_PACKET_VERSION = "schema-feature-packet@1.0.0" as const;
export const SEMANTIC_CHANGE_PROPOSAL_VERSION = "semantic-change-proposal@1.0.0" as const;
export const SEMANTIC_COMPILE_RUN_VERSION = "semantic-compile-run@1.0.0" as const;

export const semanticCompileRequestSchema = z.strictObject({
  schema_version: z.literal(SEMANTIC_COMPILE_REQUEST_VERSION),
  semantic_domain: semanticScopeSchema.shape.semantic_domain,
  snapshot_id: immutableIdSchema,
  drift_event_id: immutableIdSchema.optional(),
  idempotency_key: immutableIdSchema,
});

export const physicalRelationEvidenceLocatorSchema = z.strictObject({
  locator_kind: z.literal("PHYSICAL_RELATION"),
  relation: relationIdentitySchema,
});

export const physicalColumnEvidenceLocatorSchema = z.strictObject({
  locator_kind: z.literal("PHYSICAL_COLUMN"),
  relation: relationIdentitySchema,
  column_name: z.string().min(1).max(256),
});

export const physicalConstraintEvidenceLocatorSchema = z.strictObject({
  locator_kind: z.literal("PHYSICAL_CONSTRAINT"),
  relation: relationIdentitySchema,
  constraint_kind: z.enum(["PRIMARY_KEY", "FOREIGN_KEY", "UNIQUE", "CHECK", "INDEX"]),
  constraint_name: z.string().min(1).max(256),
});

export const metricInputEvidenceLocatorSchema = z.strictObject({
  locator_kind: z.literal("METRIC_INPUT"),
  metric_input_id: immutableIdSchema,
  field_path: z.string().min(1).max(512),
});

export const documentChunkEvidenceLocatorSchema = z.strictObject({
  locator_kind: z.literal("DOCUMENT_CHUNK"),
  document_id: immutableIdSchema,
  chunk_id: immutableIdSchema,
  start_offset: z.number().int().min(0),
  end_offset: z.number().int().positive(),
});

export const semanticEvidenceLocatorSchema = z.discriminatedUnion("locator_kind", [
  physicalRelationEvidenceLocatorSchema,
  physicalColumnEvidenceLocatorSchema,
  physicalConstraintEvidenceLocatorSchema,
  metricInputEvidenceLocatorSchema,
  documentChunkEvidenceLocatorSchema,
]);

export const semanticEvidenceRefSchema = z
  .strictObject({
    evidence_id: versionIdentifierSchema,
    source_kind: z.enum(["PHYSICAL_SCHEMA", "METRIC_INPUT", "DOCUMENT_CHUNK"]),
    source_id: immutableIdSchema,
    source_digest: contentHashSchema,
    locator: semanticEvidenceLocatorSchema,
    observation: z.string().min(1).max(2_048),
    confidence: z.number().min(0).max(1),
  })
  .superRefine((evidence, context) => {
    const expectedSourceKind = evidence.locator.locator_kind.startsWith("PHYSICAL_")
      ? "PHYSICAL_SCHEMA"
      : evidence.locator.locator_kind;
    if (evidence.source_kind !== expectedSourceKind) {
      context.addIssue({
        code: "custom",
        path: ["source_kind"],
        message: "证据来源类型必须与结构化定位器一致。",
      });
    }
    if (
      evidence.locator.locator_kind === "DOCUMENT_CHUNK" &&
      evidence.locator.end_offset <= evidence.locator.start_offset
    ) {
      context.addIssue({
        code: "custom",
        path: ["locator", "end_offset"],
        message: "知识分片结束偏移必须大于开始偏移。",
      });
    }
  });

export const schemaFeatureKindSchema = z.enum([
  "RELATION",
  "COLUMN",
  "PRIMARY_KEY",
  "FOREIGN_KEY",
  "UNIQUE",
  "CHECK",
  "INDEX",
]);

export const schemaFeatureSchema = z.strictObject({
  feature_id: versionIdentifierSchema,
  feature_kind: schemaFeatureKindSchema,
  locator: z.union([
    physicalRelationEvidenceLocatorSchema,
    physicalColumnEvidenceLocatorSchema,
    physicalConstraintEvidenceLocatorSchema,
  ]),
  display_name: z.string().min(1).max(512),
  relation_kind: z
    .enum(["TABLE", "PARTITIONED_TABLE", "VIEW", "MATERIALIZED_VIEW", "FOREIGN_TABLE"])
    .nullable(),
  formatted_type: z.string().min(1).max(2_048).nullable(),
  nullable: z.boolean().nullable(),
  comment: z.string().max(32_768).nullable(),
  definition: z.string().max(32_768).nullable(),
  column_names: z.array(z.string().min(1).max(256)).max(1_000),
  referenced_relation: relationIdentitySchema.nullable(),
  referenced_column_names: z.array(z.string().min(1).max(256)).max(1_000),
  proof_kind: z.enum(["DDL_ENFORCED", "OBSERVED_ONLY"]),
});

export const semanticBaseReleaseIdentitySchema = z.strictObject({
  release_id: immutableIdSchema,
  generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  release_digest: contentHashSchema,
});

export const schemaFeaturePacketMaterialSchema = z.strictObject({
  schema_version: z.literal(SCHEMA_FEATURE_PACKET_VERSION),
  scope: semanticScopeSchema,
  snapshot_id: immutableIdSchema,
  snapshot_digest: contentHashSchema,
  drift_event_id: immutableIdSchema.nullable(),
  drift_digest: contentHashSchema.nullable(),
  base_release: semanticBaseReleaseIdentitySchema.nullable(),
  features: z.array(schemaFeatureSchema).max(250_000),
});

export const schemaFeaturePacketSchema = schemaFeaturePacketMaterialSchema.extend({
  feature_digest: contentHashSchema,
});

export const semanticCandidateActionSchema = z.enum(["CREATE", "UPDATE", "MARK_STALE"]);
export const semanticCandidateTargetTypeSchema = z.enum([
  "BUSINESS_ENTITY_TYPE",
  "DIMENSION",
  "METRIC",
  "RELATIONSHIP",
  "PHYSICAL_BINDING",
]);

const operationBaseShape = {
  schema_version: z.literal("semantic-candidate-operation@1.0.0"),
  operation_id: immutableIdSchema,
  action: semanticCandidateActionSchema,
  target_id: versionIdentifierSchema,
  evidence_refs: z.array(versionIdentifierSchema).min(1).max(256),
  field_evidence: z.record(
    z.string().min(1).max(512),
    z.array(versionIdentifierSchema).min(1).max(64),
  ),
  confidence: z.number().min(0).max(1),
  assumptions: z.array(z.string().min(1).max(1_024)).max(64),
  open_questions: z.array(z.string().min(1).max(1_024)).max(64),
  impact: z.strictObject({
    risk_level: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    affected_object_ids: z.array(versionIdentifierSchema).max(1_000),
    summary: z.string().min(1).max(2_048),
  }),
} as const;

export const semanticCandidateOperationSchema = z
  .discriminatedUnion("target_type", [
    z.strictObject({
      ...operationBaseShape,
      target_type: z.literal("BUSINESS_ENTITY_TYPE"),
      payload: businessEntitySchema.nullable(),
    }),
    z.strictObject({
      ...operationBaseShape,
      target_type: z.literal("DIMENSION"),
      payload: semanticDimensionSchema.nullable(),
    }),
    z.strictObject({
      ...operationBaseShape,
      target_type: z.literal("METRIC"),
      payload: semanticMetricSchema.nullable(),
    }),
    z.strictObject({
      ...operationBaseShape,
      target_type: z.literal("RELATIONSHIP"),
      payload: semanticRelationshipSchema.nullable(),
    }),
    z.strictObject({
      ...operationBaseShape,
      target_type: z.literal("PHYSICAL_BINDING"),
      payload: physicalBindingEntrySchema.nullable(),
    }),
  ])
  .superRefine((operation, context) => {
    if (operation.action === "MARK_STALE" && operation.payload !== null) {
      context.addIssue({
        code: "custom",
        path: ["payload"],
        message: "MARK_STALE 只能引用既有对象，不能携带替换 payload。",
      });
    }
    if (operation.action !== "MARK_STALE" && operation.payload === null) {
      context.addIssue({
        code: "custom",
        path: ["payload"],
        message: "CREATE/UPDATE 必须携带对应目标类型的 payload。",
      });
    }
  });

export const semanticAgentReceiptSchema = z.strictObject({
  provider_id: versionIdentifierSchema,
  model_id: z.string().min(1).max(256),
  model_profile_digest: contentHashSchema,
  prompt_digest: contentHashSchema,
  tool_policy_digest: contentHashSchema,
  compiler_digest: contentHashSchema,
  candidate_policy_digest: contentHashSchema,
});

export const semanticAgentCandidateOutputSchema = z.strictObject({
  schema_version: z.literal("semantic-agent-candidate-output@1.0.0"),
  operations: z.array(semanticCandidateOperationSchema).min(1).max(256),
  summary: z.string().min(1).max(2_048),
});

export const semanticChangeProposalMaterialSchema = z.strictObject({
  schema_version: z.literal(SEMANTIC_CHANGE_PROPOSAL_VERSION),
  compile_run_id: immutableIdSchema,
  source_revision_id: immutableIdSchema,
  feature_digest: contentHashSchema,
  snapshot_id: immutableIdSchema,
  snapshot_digest: contentHashSchema,
  drift_event_id: immutableIdSchema.nullable(),
  drift_digest: contentHashSchema.nullable(),
  base_release: semanticBaseReleaseIdentitySchema.nullable(),
  agent_receipt: semanticAgentReceiptSchema,
  evidence: z.array(semanticEvidenceRefSchema).min(1).max(250_000),
  operations: z.array(semanticCandidateOperationSchema).min(1).max(256),
  summary: z.string().min(1).max(2_048),
});

export const semanticChangeProposalSchema = semanticChangeProposalMaterialSchema.extend({
  proposal_digest: contentHashSchema,
});

export const semanticCompileTerminalSchema = z.enum([
  "COMPILED",
  "AGENT_UNAVAILABLE",
  "TIMEOUT",
  "INVALID_OUTPUT",
  "VALIDATION_FAILED",
  "STALE_BASE",
  "IDEMPOTENCY_CONFLICT",
]);

export const semanticCompileRunSchema = z.strictObject({
  schema_version: z.literal(SEMANTIC_COMPILE_RUN_VERSION),
  scope: semanticScopeSchema,
  compile_run_id: immutableIdSchema,
  idempotency_key: immutableIdSchema,
  input_digest: contentHashSchema,
  source_revision_id: immutableIdSchema,
  feature_digest: contentHashSchema,
  snapshot_id: immutableIdSchema,
  snapshot_digest: contentHashSchema,
  drift_event_id: immutableIdSchema.nullable(),
  drift_digest: contentHashSchema.nullable(),
  base_release: semanticBaseReleaseIdentitySchema.nullable(),
  agent_receipt: semanticAgentReceiptSchema,
  terminal: semanticCompileTerminalSchema,
  proposal_digest: contentHashSchema.nullable(),
  candidate_id: immutableIdSchema.nullable(),
  candidate_revision_id: immutableIdSchema.nullable(),
  failure_code: z.string().min(1).max(128).nullable(),
  created_at: timestampSchema,
  completed_at: timestampSchema,
});

export async function computeSchemaFeaturePacketDigest(
  packet: z.input<typeof schemaFeaturePacketMaterialSchema>,
) {
  return sha256ContentHash(schemaFeaturePacketMaterialSchema.parse(packet));
}

export async function computeSemanticChangeProposalDigest(
  proposal: z.input<typeof semanticChangeProposalMaterialSchema>,
) {
  return sha256ContentHash(semanticChangeProposalMaterialSchema.parse(proposal));
}

export async function computeSemanticCompileInputDigest(input: {
  readonly request: SemanticCompileRequest;
  readonly scope: z.infer<typeof semanticScopeSchema>;
  readonly snapshot_digest: z.infer<typeof contentHashSchema>;
  readonly drift_digest: z.infer<typeof contentHashSchema> | null;
  readonly base_release: SemanticBaseReleaseIdentity | null;
  readonly agent_receipt: SemanticAgentReceipt;
}) {
  return sha256ContentHash(input);
}

export type SemanticCompileRequest = z.infer<typeof semanticCompileRequestSchema>;
export type SemanticEvidenceLocator = z.infer<typeof semanticEvidenceLocatorSchema>;
export type SemanticEvidenceRef = z.infer<typeof semanticEvidenceRefSchema>;
export type SchemaFeature = z.infer<typeof schemaFeatureSchema>;
export type SchemaFeaturePacketMaterial = z.infer<typeof schemaFeaturePacketMaterialSchema>;
export type SchemaFeaturePacket = z.infer<typeof schemaFeaturePacketSchema>;
export type SemanticBaseReleaseIdentity = z.infer<typeof semanticBaseReleaseIdentitySchema>;
export type SemanticCandidateOperation = z.infer<typeof semanticCandidateOperationSchema>;
export type SemanticAgentReceipt = z.infer<typeof semanticAgentReceiptSchema>;
export type SemanticAgentCandidateOutput = z.infer<typeof semanticAgentCandidateOutputSchema>;
export type SemanticChangeProposalMaterial = z.infer<typeof semanticChangeProposalMaterialSchema>;
export type SemanticChangeProposal = z.infer<typeof semanticChangeProposalSchema>;
export type SemanticCompileTerminal = z.infer<typeof semanticCompileTerminalSchema>;
export type SemanticCompileRun = z.infer<typeof semanticCompileRunSchema>;
