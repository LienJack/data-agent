import { z } from "zod";
import { contentHashSchema, environmentSchema, immutableIdSchema } from "../common/index.js";
import { changeClassSchema, semanticScopeSchema } from "./semantic-control-plane.js";

export const semanticRiskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const semanticSourcePayloadSchema = z.strictObject({
  schema_version: z.literal("semantic-source-payload@1.0.0"),
  source_kind: z.enum(["MANUAL", "AGENT", "SCHEMA_DISCOVERY"]),
  content: z.record(z.string(), z.unknown()),
});

export const semanticDiffOperationSchema = z
  .strictObject({
    path: z.string().min(1).max(512),
    change_type: z.enum(["ADD", "MODIFY", "DELETE"]),
    before: z.unknown().optional(),
    after: z.unknown().optional(),
  })
  .superRefine((operation, context) => {
    if (operation.change_type !== "ADD" && operation.before === undefined) {
      context.addIssue({
        code: "custom",
        message: "MODIFY/DELETE 操作必须提供 before。",
        path: ["before"],
      });
    }
    if (operation.change_type !== "DELETE" && operation.after === undefined) {
      context.addIssue({
        code: "custom",
        message: "ADD/MODIFY 操作必须提供 after。",
        path: ["after"],
      });
    }
  });

export const semanticDiffSchema = z.strictObject({
  schema_version: z.literal("semantic-diff@1.0.0"),
  summary: z.string().min(1).max(2048),
  operations: z.array(semanticDiffOperationSchema).min(1).max(256),
});

export const semanticCandidateDraftSchema = z.strictObject({
  schema_version: z.literal("semantic-candidate-draft@1.0.0"),
  title: z.string().min(1).max(256),
  description: z.string().min(1).max(2048),
  semantic_domain: semanticScopeSchema.shape.semantic_domain,
  change_class: changeClassSchema,
  risk_level: semanticRiskLevelSchema,
  idempotency_key: immutableIdSchema,
  source_payload: semanticSourcePayloadSchema,
  diff: semanticDiffSchema,
});

export const semanticCandidateCreateResultSchema = z.strictObject({
  schema_version: z.literal("semantic-candidate-create-result@1.0.0"),
  authority: z.literal("POSTGRESQL"),
  candidate_id: immutableIdSchema,
  revision_id: immutableIdSchema,
  source_revision_id: immutableIdSchema,
  source_digest: contentHashSchema,
  revision_digest: contentHashSchema,
  idempotency_digest: contentHashSchema,
  candidate_status: z.literal("DRAFT"),
  created: z.boolean(),
});

export const semanticDecisionInputSchema = z.strictObject({
  schema_version: z.literal("semantic-decision@1.0.0"),
  semantic_domain: semanticScopeSchema.shape.semantic_domain,
  packet_id: immutableIdSchema,
  decision: z.enum(["APPROVE", "REJECT"]),
  decision_reason: z.string().min(1).max(2048).optional(),
});

export const semanticPreparePublishInputSchema = z.strictObject({
  schema_version: z.literal("semantic-prepare-publish@1.0.0"),
  semantic_domain: semanticScopeSchema.shape.semantic_domain,
  packet_id: immutableIdSchema,
  compiler_bundle_digest: contentHashSchema,
  catalog_epoch: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  dependency_generation: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  target_generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  idempotency_digest: contentHashSchema,
});

export const semanticCommitPublishInputSchema = z.strictObject({
  schema_version: z.literal("semantic-commit-publish@1.0.0"),
  semantic_domain: semanticScopeSchema.shape.semantic_domain,
  packet_id: immutableIdSchema,
  attempt_id: immutableIdSchema,
  executable_projection_ref: immutableIdSchema,
  executable_projection_hash: contentHashSchema,
  relationship_projection_ref: immutableIdSchema,
  relationship_projection_hash: contentHashSchema,
  runtime_restriction_projection_ref: immutableIdSchema,
  runtime_restriction_projection_hash: contentHashSchema,
  profile_child_manifest: z.record(z.string(), z.unknown()).optional(),
});

export const semanticRollbackInputSchema = z.strictObject({
  schema_version: z.literal("semantic-rollback@1.0.0"),
  semantic_domain: semanticScopeSchema.shape.semantic_domain,
  packet_id: immutableIdSchema,
  authorization_id: immutableIdSchema,
  authorization_nonce: immutableIdSchema,
  rollback_reason: z.string().min(1).max(2048),
});

export const dataSourceCredentialRefSchema = z.strictObject({
  schema_version: z.literal("datasource-credential-ref@1.0.0"),
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  credential_ref_id: immutableIdSchema,
  secret_ref_id: immutableIdSchema,
  secret_version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  rotation_state: z.enum(["ACTIVE", "ROTATION_PENDING", "REVOKED"]),
});

export type SemanticRiskLevel = z.infer<typeof semanticRiskLevelSchema>;
export type SemanticSourcePayload = z.infer<typeof semanticSourcePayloadSchema>;
export type SemanticDiffOperation = z.infer<typeof semanticDiffOperationSchema>;
export type SemanticDiff = z.infer<typeof semanticDiffSchema>;
export type SemanticCandidateDraft = z.infer<typeof semanticCandidateDraftSchema>;
export type SemanticCandidateCreateResult = z.infer<typeof semanticCandidateCreateResultSchema>;
export type SemanticDecisionInput = z.infer<typeof semanticDecisionInputSchema>;
export type SemanticPreparePublishInput = z.infer<typeof semanticPreparePublishInputSchema>;
export type SemanticCommitPublishInput = z.infer<typeof semanticCommitPublishInputSchema>;
export type SemanticRollbackInput = z.infer<typeof semanticRollbackInputSchema>;
export type DataSourceCredentialRef = z.infer<typeof dataSourceCredentialRefSchema>;
