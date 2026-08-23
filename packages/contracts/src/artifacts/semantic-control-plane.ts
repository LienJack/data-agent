import { z } from "zod";
import {
  contentHashSchema,
  environmentSchema,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
} from "../common/index.js";

// ─── Version constant ─────────────────────────────────────────────────────────

export const SEMANTIC_CONTROL_PLANE_VERSION = "semantic-control-plane@1" as const;

// ─── Semantic Scope ───────────────────────────────────────────────────────────

/**
 * Semantic scope (app_id, tenant_id, environment, semantic_domain).
 * Used by every table in the semantic control plane.
 */
export const semanticScopeSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
});

export type SemanticScope = z.infer<typeof semanticScopeSchema>;

// ─── Domain Registry ──────────────────────────────────────────────────────────

export const semanticDomainRegistrySchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  datasource_id: immutableIdSchema,
  domain_display_name: z.string().min(1).max(256),
  domain_description: z.string().max(1024).optional(),
  domain_version: z.number().int().min(1).max(2147483647).default(1),
  is_active: z.boolean().default(true),
  created_at: timestampSchema,
  created_by: z.string().min(1).max(256),
  updated_at: timestampSchema,
});

export type SemanticDomainRegistry = z.infer<typeof semanticDomainRegistrySchema>;

// ─── Domain Bootstrap ─────────────────────────────────────────────────────────

export const semanticDomainBootstrapSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  bootstrap_id: immutableIdSchema,
  bootstrap_packet_digest: contentHashSchema,
  supersedes_packet_digest: contentHashSchema.optional(),
  signer_one_principal: z.string().min(1).max(256),
  signer_two_principal: z.string().min(1).max(256),
  signer_one_signature: z.string().min(1).max(1024),
  signer_two_signature: z.string().min(1).max(1024),
  initial_review_policy_digest: contentHashSchema,
  initial_catalog_fence_digest: contentHashSchema,
  initial_compiler_dependency_digest: contentHashSchema,
  bootstrap_nonce: immutableIdSchema,
  bootstrap_expires_at: timestampSchema,
  is_closed: z.boolean().default(false),
  closed_at: timestampSchema.optional(),
  created_at: timestampSchema,
});

export type SemanticDomainBootstrap = z.infer<typeof semanticDomainBootstrapSchema>;

// ─── Authority Fence ──────────────────────────────────────────────────────────

export const semanticAuthorityFenceSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  fence_epoch: z.number().int().min(0).max(9007199254740991).default(0),
  last_fence_update_at: timestampSchema,
  last_fence_update_by: z.string().min(1).max(256).default("system"),
  created_at: timestampSchema,
});

export type SemanticAuthorityFence = z.infer<typeof semanticAuthorityFenceSchema>;

// ─── Reviewer Policy Revision ─────────────────────────────────────────────────

export const quorumRulesSchema = z.strictObject({
  required_approvals: z.number().int().positive().optional(),
  min_reviewers: z.number().int().positive().optional(),
  required_roles: z.array(z.string().min(1).max(64)).optional(),
});

export const vetoRulesSchema = z.strictObject({
  min_veto_count: z.number().int().positive().default(1),
  veto_roles: z.array(z.string().min(1).max(64)).optional(),
  any_veto_closes: z.boolean().default(true),
});

export const expiryRulesSchema = z.strictObject({
  decision_timeout_seconds: z.number().int().min(60).max(2592000),
  publish_timeout_seconds: z.number().int().min(60).max(2592000).optional(),
  auto_expire_on_epoch_change: z.boolean().default(false),
});

export const roleSeparationRulesSchema = z.strictObject({
  proposer_cannot_approve: z.boolean().default(true),
  proposer_cannot_veto: z.boolean().default(true),
  min_distinct_approvers: z.number().int().positive().default(1),
  require_author_exclusion: z.boolean().default(true),
});

export const reviewerPolicyRevisionSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  policy_version: z.number().int().min(1).max(9007199254740991),
  policy_digest: contentHashSchema,
  policy_payload: z.record(z.string(), z.unknown()),
  quorum_rules: quorumRulesSchema,
  veto_rules: vetoRulesSchema,
  expiry_rules: expiryRulesSchema,
  role_separation_rules: roleSeparationRulesSchema,
  min_reviewers: z.number().int().min(1).max(100),
  decision_timeout_seconds: z.number().int().min(60).max(2592000),
  created_at: timestampSchema,
  created_by: z.string().min(1).max(256),
});

export type ReviewerPolicyRevision = z.infer<typeof reviewerPolicyRevisionSchema>;
export type QuorumRules = z.infer<typeof quorumRulesSchema>;
export type VetoRules = z.infer<typeof vetoRulesSchema>;
export type ExpiryRules = z.infer<typeof expiryRulesSchema>;
export type RoleSeparationRules = z.infer<typeof roleSeparationRulesSchema>;

// ─── Reviewer Assignment ──────────────────────────────────────────────────────

export const semanticRoleSchema = z.enum([
  "domain_reviewer",
  "security_reviewer",
  "admin_reviewer",
]);

export const reviewerAssignmentSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  assignment_id: immutableIdSchema,
  principal: z.string().min(1).max(256),
  semantic_role: semanticRoleSchema,
  membership_version: z.number().int().min(1).max(9007199254740991),
  policy_version: z.number().int().min(1).max(9007199254740991),
  is_active: z.boolean().default(true),
  assigned_at: timestampSchema,
  assigned_by: z.string().min(1).max(256),
  expires_at: timestampSchema.optional(),
});

export type ReviewerAssignment = z.infer<typeof reviewerAssignmentSchema>;

// ─── Reviewer Policy Pointer ──────────────────────────────────────────────────

export const reviewerPolicyPointerSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  current_policy_version: z.number().int().min(1).max(9007199254740991),
  current_policy_digest: contentHashSchema,
  pointer_generation: z.number().int().min(1).max(9007199254740991).default(1),
  updated_at: timestampSchema,
  updated_by: z.string().min(1).max(256),
});

export type ReviewerPolicyPointer = z.infer<typeof reviewerPolicyPointerSchema>;

// ─── Catalog Fence ────────────────────────────────────────────────────────────

export const catalogFenceSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  catalog_epoch: z.number().int().min(0).max(9007199254740991),
  catalog_digest: contentHashSchema,
  schema_digest: contentHashSchema,
  is_valid: z.boolean().default(true),
  invalidated_at: timestampSchema.optional(),
  created_at: timestampSchema,
});

export type CatalogFence = z.infer<typeof catalogFenceSchema>;

// ─── Dependency Pointer ───────────────────────────────────────────────────────

export const dependencyPointerSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  current_catalog_epoch: z.number().int().min(0).max(9007199254740991),
  current_catalog_digest: contentHashSchema,
  current_compiler_bundle_digest: contentHashSchema,
  current_closure_policy_digest: contentHashSchema,
  pointer_generation: z.number().int().min(1).max(9007199254740991).default(1),
  updated_at: timestampSchema,
  updated_by: z.string().min(1).max(256),
});

export type DependencyPointer = z.infer<typeof dependencyPointerSchema>;

// ─── Source Revision ──────────────────────────────────────────────────────────

export const changeClassSchema = z.enum(["MINOR", "MAJOR", "RUNTIME_AUTHORIZATION", "SECURITY"]);

export const sourceRevisionSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  revision_id: immutableIdSchema,
  revision_number: z.number().int().min(1).max(2147483647),
  base_release_id: immutableIdSchema.optional(),
  base_release_generation: z.number().int().min(0).max(9007199254740991).optional(),
  source_payload: z.record(z.string(), z.unknown()),
  source_digest: contentHashSchema,
  author_principal: z.string().min(1).max(256),
  change_description: z.string().max(2048).optional(),
  change_class: changeClassSchema.optional(),
  created_at: timestampSchema,
});

export type SourceRevision = z.infer<typeof sourceRevisionSchema>;

// ─── Candidate ────────────────────────────────────────────────────────────────

export const candidateStatusSchema = z.enum([
  "DRAFT",
  "VALIDATING",
  "VALIDATION_FAILED",
  "REVIEW_SUBMITTED",
  "WAITING_REVIEW",
  "REJECTED",
  "REVIEW_EXPIRED",
  "APPROVED",
  "PUBLISHING",
  "PUBLISHED",
  "STALE_REBASE_REQUIRED",
]);

export const candidateSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  candidate_id: immutableIdSchema,
  proposer_principal: z.string().min(1).max(256),
  current_revision_id: immutableIdSchema,
  candidate_status: candidateStatusSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export type Candidate = z.infer<typeof candidateSchema>;
export type CandidateStatus = z.infer<typeof candidateStatusSchema>;

// ─── Candidate Revision ───────────────────────────────────────────────────────

export const candidateRevisionSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  candidate_id: immutableIdSchema,
  revision_id: immutableIdSchema,
  revision_number: z.number().int().min(1).max(2147483647),
  source_revision_id: immutableIdSchema,
  revision_payload: z.record(z.string(), z.unknown()),
  revision_digest: contentHashSchema,
  author_principal: z.string().min(1).max(256),
  change_description: z.string().max(2048).optional(),
  change_class: changeClassSchema.optional(),
  created_at: timestampSchema,
});

export type CandidateRevision = z.infer<typeof candidateRevisionSchema>;

// ─── Validation Receipt ───────────────────────────────────────────────────────

export const validationOutcomeSchema = z.enum(["PASS", "FAIL", "WARN"]);

export const semanticValidationReceiptSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  receipt_id: immutableIdSchema,
  candidate_id: immutableIdSchema,
  revision_id: immutableIdSchema,
  catalog_epoch: z.number().int().min(0),
  compiler_bundle_digest: contentHashSchema,
  validation_outcome: validationOutcomeSchema,
  validation_details: z.record(z.string(), z.unknown()).optional(),
  impact_analysis: z.record(z.string(), z.unknown()).optional(),
  receipt_digest: contentHashSchema,
  created_at: timestampSchema,
});

export type SemanticValidationReceipt = z.infer<typeof semanticValidationReceiptSchema>;
export type ValidationOutcome = z.infer<typeof validationOutcomeSchema>;

// ─── Review Task ──────────────────────────────────────────────────────────────

export const packetKindSchema = z.enum(["CANDIDATE_REVIEW", "ROLLBACK_REVIEW"]);

export const decisionWindowStatusSchema = z.enum(["OPEN", "CLOSED"]);
export const reviewOutcomeSchema = z.enum(["PENDING", "APPROVED", "VETOED", "EXPIRED"]);

export const reviewTaskSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  packet_id: immutableIdSchema,
  packet_kind: packetKindSchema,
  packet_digest: contentHashSchema,
  packet_payload: z.record(z.string(), z.unknown()),
  candidate_id: immutableIdSchema.optional(),
  decision_window_status: decisionWindowStatusSchema.default("OPEN"),
  review_outcome: reviewOutcomeSchema.default("PENDING"),
  decision_expires_at: timestampSchema,
  publish_expires_at: timestampSchema.optional(),
  quorum_rules_snapshot: z.record(z.string(), z.unknown()),
  veto_rules_snapshot: z.record(z.string(), z.unknown()),
  exclusion_set: z.array(z.string().min(1).max(256)).default([]),
  created_at: timestampSchema,
  created_by: z.string().min(1).max(256),
  closed_at: timestampSchema.optional(),
});

export type ReviewTask = z.infer<typeof reviewTaskSchema>;
export type PacketKind = z.infer<typeof packetKindSchema>;
export type DecisionWindowStatus = z.infer<typeof decisionWindowStatusSchema>;
export type ReviewOutcome = z.infer<typeof reviewOutcomeSchema>;

// ─── Review Decision ──────────────────────────────────────────────────────────

export const reviewDecisionSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  packet_id: immutableIdSchema,
  decision_id: immutableIdSchema,
  principal: z.string().min(1).max(256),
  semantic_role: semanticRoleSchema,
  decision: z.enum(["APPROVE", "REJECT"]),
  decision_reason: z.string().max(2048).optional(),
  decision_digest: contentHashSchema,
  created_at: timestampSchema,
});

export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;

// ─── Publish Attempt ──────────────────────────────────────────────────────────

export const attemptStateSchema = z.enum(["PREPARED", "COMMITTED", "STALE"]);

export const publishAttemptSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  attempt_id: immutableIdSchema,
  packet_id: immutableIdSchema,
  candidate_id: immutableIdSchema,
  attempt_state: attemptStateSchema,
  compiler_bundle_digest: contentHashSchema,
  catalog_fence_epoch: z.number().int().min(0),
  dependency_generation: z.number().int().min(0),
  executable_projection_ref: immutableIdSchema.optional(),
  executable_projection_hash: contentHashSchema.optional(),
  relationship_projection_ref: immutableIdSchema.optional(),
  relationship_projection_hash: contentHashSchema.optional(),
  runtime_restriction_projection_ref: immutableIdSchema.optional(),
  runtime_restriction_projection_hash: contentHashSchema.optional(),
  target_generation: z.number().int().min(0).max(9007199254740991),
  idempotency_digest: contentHashSchema,
  terminal_code: z.string().max(256).optional(),
  terminal_detail_digest: contentHashSchema.optional(),
  committed_release_ref: immutableIdSchema.optional(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export type PublishAttempt = z.infer<typeof publishAttemptSchema>;
export type AttemptState = z.infer<typeof attemptStateSchema>;

// ─── Source Release ───────────────────────────────────────────────────────────

export const sourceReleaseSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  release_id: immutableIdSchema,
  release_generation: z.number().int().min(1).max(9007199254740991),
  attempt_id: immutableIdSchema,
  packet_id: immutableIdSchema,
  candidate_id: immutableIdSchema,
  release_digest: contentHashSchema,
  compiler_bundle_digest: contentHashSchema,
  executable_projection_ref: immutableIdSchema,
  executable_projection_hash: contentHashSchema,
  relationship_projection_ref: immutableIdSchema,
  relationship_projection_hash: contentHashSchema,
  runtime_restriction_projection_ref: immutableIdSchema,
  runtime_restriction_projection_hash: contentHashSchema,
  profile_child_manifest: z.record(z.string(), z.unknown()).optional(),
  quorum_snapshot: z.record(z.string(), z.unknown()),
  decision_set_digest: contentHashSchema,
  published_at: timestampSchema,
  published_by: z.string().min(1).max(256),
});

export type SourceRelease = z.infer<typeof sourceReleaseSchema>;

// ─── Projection Types ─────────────────────────────────────────────────────────

export const executableProjectionSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  projection_id: immutableIdSchema,
  release_id: immutableIdSchema,
  projection_digest: contentHashSchema,
  projection_payload: z.record(z.string(), z.unknown()),
  created_at: timestampSchema,
});

export type ExecutableProjection = z.infer<typeof executableProjectionSchema>;

export const relationshipProjectionSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  projection_id: immutableIdSchema,
  release_id: immutableIdSchema,
  datasource_id: immutableIdSchema,
  catalog_epoch: z.number().int().min(0),
  projection_digest: contentHashSchema,
  projection_payload: z.record(z.string(), z.unknown()),
  created_at: timestampSchema,
});

export type RelationshipProjection = z.infer<typeof relationshipProjectionSchema>;

export const runtimeRestrictionProjectionSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  projection_id: immutableIdSchema,
  release_id: immutableIdSchema,
  projection_digest: contentHashSchema,
  platform_policy_digest: contentHashSchema,
  compiler_bundle_digest: contentHashSchema,
  pointer_generation: z.number().int().min(0),
  restriction_payload: z.record(z.string(), z.unknown()),
  created_at: timestampSchema,
});

export type RuntimeRestrictionProjection = z.infer<typeof runtimeRestrictionProjectionSchema>;

export const descriptiveContributionProfileProjectionSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  projection_id: immutableIdSchema,
  parent_projection_id: immutableIdSchema,
  release_id: immutableIdSchema,
  projection_digest: contentHashSchema,
  profile_payload: z.record(z.string(), z.unknown()),
  created_at: timestampSchema,
});

export type DescriptiveContributionProfileProjection = z.infer<
  typeof descriptiveContributionProfileProjectionSchema
>;

// ─── Active Pointer ───────────────────────────────────────────────────────────

export const activePointerSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  current_release_id: immutableIdSchema.optional(),
  current_release_generation: z.number().int().min(0).max(9007199254740991).default(0),
  current_release_digest: contentHashSchema.optional(),
  pointer_generation: z.number().int().min(1).max(9007199254740991).default(1),
  updated_at: timestampSchema,
  updated_by: z.string().min(1).max(256),
});

export type ActivePointer = z.infer<typeof activePointerSchema>;

// ─── Grounding Issuer Draft ───────────────────────────────────────────────────

export const issuerKindSchema = z.enum(["AUTHORITY", "COMPILER", "MATERIALIZER"]);

export const groundingIssuerDraftSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  draft_id: immutableIdSchema,
  issuer_kind: issuerKindSchema,
  issuer_principal: z.string().min(1).max(256),
  capability: z.string().min(1).max(256),
  sealed_input: z.record(z.string(), z.unknown()),
  currentness_hash: contentHashSchema,
  draft_hash: contentHashSchema,
  is_ready: z.boolean().default(false),
  created_at: timestampSchema,
});

export type GroundingIssuerDraft = z.infer<typeof groundingIssuerDraftSchema>;
export type IssuerKind = z.infer<typeof issuerKindSchema>;

// ─── Runtime Projection Binding ───────────────────────────────────────────────

export const runtimeProjectionBindingSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  binding_id: immutableIdSchema,
  release_id: immutableIdSchema,
  projection_id: immutableIdSchema,
  run_id: immutableIdSchema,
  u5_artifact_ref: immutableIdSchema.optional(),
  u5_artifact_hash: contentHashSchema.optional(),
  binding_hash: contentHashSchema,
  created_at: timestampSchema,
});

export type RuntimeProjectionBinding = z.infer<typeof runtimeProjectionBindingSchema>;

// ─── Runtime Activation ───────────────────────────────────────────────────────

export const runtimeActivationSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  activation_generation: z.number().int().min(1).max(9007199254740991).default(1),
  current_release_id: immutableIdSchema.optional(),
  current_release_generation: z.number().int().min(0).max(9007199254740991).default(0),
  last_governance_readiness_receipt_digest: contentHashSchema.optional(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export type RuntimeActivation = z.infer<typeof runtimeActivationSchema>;

// ─── Rollback Authorization ───────────────────────────────────────────────────

export const rollbackAuthorizationSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  authorization_id: immutableIdSchema,
  packet_id: immutableIdSchema,
  from_release_id: immutableIdSchema,
  from_release_generation: z.number().int().min(0),
  to_release_id: immutableIdSchema,
  to_release_generation: z.number().int().min(0),
  current_release_id: immutableIdSchema,
  current_release_generation: z.number().int().min(0),
  authorization_digest: contentHashSchema,
  decision_set_digest: contentHashSchema,
  nonce: immutableIdSchema,
  expires_at: timestampSchema,
  is_consumed: z.boolean().default(false),
  created_at: timestampSchema,
  consumed_at: timestampSchema.optional(),
});

export type RollbackAuthorization = z.infer<typeof rollbackAuthorizationSchema>;

// ─── Rollback Receipt ─────────────────────────────────────────────────────────

export const rollbackReceiptSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  receipt_id: immutableIdSchema,
  authorization_id: immutableIdSchema,
  from_release_id: immutableIdSchema,
  from_release_generation: z.number().int().min(0),
  to_release_id: immutableIdSchema,
  to_release_generation: z.number().int().min(0),
  rollback_reason: z.string().min(1).max(4096),
  decision_set_digest: contentHashSchema,
  receipt_digest: contentHashSchema,
  created_at: timestampSchema,
});

export type RollbackReceipt = z.infer<typeof rollbackReceiptSchema>;

// ─── Outbox ───────────────────────────────────────────────────────────────────

export const outboxEventTypeSchema = z.enum([
  "CANDIDATE_SUBMITTED",
  "CANDIDATE_APPROVED",
  "CANDIDATE_REJECTED",
  "CANDIDATE_PUBLISHED",
  "CANDIDATE_STALE",
  "REVIEW_PACKET_CREATED",
  "REVIEW_DECISION_RECORDED",
  "REVIEW_PACKET_CLOSED",
  "REVIEW_PACKET_EXPIRED",
  "PUBLISH_ATTEMPT_PREPARED",
  "PUBLISH_ATTEMPT_COMMITTED",
  "PUBLISH_ATTEMPT_STALE",
  "SOURCE_RELEASE_CREATED",
  "SOURCE_RELEASE_ACTIVATED",
  "ROLLBACK_AUTHORIZED",
  "ROLLBACK_EXECUTED",
  "RUNTIME_ACTIVATION_CHANGED",
  "APPLICATION_ROLLBACK_EXECUTED",
]);

export const counterKindSchema = z.enum(["RELEASE", "ACTIVATION"]);

export const semanticOutboxSchema = z.strictObject({
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  event_id: immutableIdSchema,
  event_type: outboxEventTypeSchema,
  counter_kind: counterKindSchema,
  axis_generation: z.number().int().min(0).max(9007199254740991),
  observed_release_generation: z.number().int().min(0).max(9007199254740991).optional(),
  observed_activation_generation: z.number().int().min(1).max(9007199254740991).optional(),
  event_payload: z.record(z.string(), z.unknown()),
  event_digest: contentHashSchema,
  created_at: timestampSchema,
});

export type SemanticOutbox = z.infer<typeof semanticOutboxSchema>;
export type OutboxEventType = z.infer<typeof outboxEventTypeSchema>;
export type CounterKind = z.infer<typeof counterKindSchema>;

// ─── RPC Result Types ─────────────────────────────────────────────────────────

export const bootstrapDomainResultSchema = z.strictObject({
  bootstrap_id: immutableIdSchema,
  bootstrap_packet_digest: contentHashSchema,
  initial_policy_version: z.number().int().positive(),
  initial_reviewer_count: z.number().int().min(0),
});

export type BootstrapDomainResult = z.infer<typeof bootstrapDomainResultSchema>;

export const preparePublishAttemptResultSchema = z.strictObject({
  attempt_id: immutableIdSchema,
  attempt_state: z.literal("PREPARED"),
  target_generation: z.number().int().min(0),
});

export type PreparePublishAttemptResult = z.infer<typeof preparePublishAttemptResultSchema>;

export const commitPublishAttemptResultSchema = z.strictObject({
  release_id: immutableIdSchema,
  release_generation: z.number().int().min(0),
  release_digest: contentHashSchema,
  attempt_state: z.literal("COMMITTED"),
});

export type CommitPublishAttemptResult = z.infer<typeof commitPublishAttemptResultSchema>;

export const recordReviewDecisionResultSchema = z.strictObject({
  decision_id: immutableIdSchema,
  decision_digest: contentHashSchema,
  packet_closed: z.boolean(),
  outcome: reviewOutcomeSchema,
  decision_set_digest: contentHashSchema.optional(),
  total_approvals: z.number().int().min(0),
  total_rejections: z.number().int().min(0),
  required_approvals: z.number().int().positive().optional(),
});

export type RecordReviewDecisionResult = z.infer<typeof recordReviewDecisionResultSchema>;

export const executeRollbackResultSchema = z.strictObject({
  receipt_id: immutableIdSchema,
  receipt_digest: contentHashSchema,
  from_release_generation: z.number().int().min(0),
  to_release_generation: z.number().int().min(0),
});

export type ExecuteRollbackResult = z.infer<typeof executeRollbackResultSchema>;

// ─── Error Types ──────────────────────────────────────────────────────────────

export const semanticControlPlaneErrorCodeSchema = z.enum([
  "SEMANTIC_DOMAIN_BOOTSTRAP_CLOSED",
  "SEMANTIC_MIGRATION_EXECUTOR_UNSAFE",
  "SEMANTIC_PUBLISH_CONFLICT",
  "SEMANTIC_CANDIDATE_NOT_PUBLISHED",
  "SEMANTIC_ROLLBACK_CONFLICT",
  "SEMANTIC_REVIEWER_REQUIRED",
  "SEMANTIC_CANDIDATE_NOT_FOUND",
  "SEMANTIC_CANDIDATE_WRONG_STATE",
  "SEMANTIC_SOURCE_REVISION_NOT_FOUND",
  "SEMANTIC_PACKET_NOT_FOUND",
  "SEMANTIC_PACKET_EXPIRED",
  "SEMANTIC_DECISION_ALREADY_EXISTS",
  "SEMANTIC_POLICY_NOT_FOUND",
  "SEMANTIC_ASSIGNMENT_NOT_FOUND",
  "SEMANTIC_FENCE_NOT_FOUND",
  "SEMANTIC_VALIDATION_FAILED",
  "SEMANTIC_PROJECTION_MISMATCH",
  "SEMANTIC_AUTHORIZATION_EXPIRED",
  "SEMANTIC_NONCE_CONSUMED",
  "SEMANTIC_SCOPE_MISMATCH",
]);

export type SemanticControlPlaneErrorCode = z.infer<typeof semanticControlPlaneErrorCodeSchema>;

export class SemanticControlPlaneError extends Error {
  override readonly name = "SemanticControlPlaneError";
  readonly code: SemanticControlPlaneErrorCode;

  constructor(code: SemanticControlPlaneErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

// ─── Content Hash Helpers ─────────────────────────────────────────────────────

export async function computeCandidateRevisionDigest(
  revision: Omit<CandidateRevision, "revision_digest" | "created_at">,
): Promise<`sha256:${string}`> {
  return sha256ContentHash(revision);
}

export async function computeValidationReceiptDigest(
  receipt: Omit<SemanticValidationReceipt, "receipt_digest" | "created_at">,
): Promise<`sha256:${string}`> {
  return sha256ContentHash(receipt);
}

export async function computeReviewTaskDigest(
  task: Omit<ReviewTask, "packet_digest" | "created_at" | "closed_at">,
): Promise<`sha256:${string}`> {
  return sha256ContentHash(task);
}

export async function computeReviewDecisionDigest(
  decision: Omit<ReviewDecision, "decision_digest" | "created_at">,
): Promise<`sha256:${string}`> {
  return sha256ContentHash(decision);
}

export async function computeSourceReleaseDigest(
  release: Omit<SourceRelease, "release_digest" | "published_at">,
): Promise<`sha256:${string}`> {
  return sha256ContentHash(release);
}

export async function computeRollbackAuthorizationDigest(
  authorization: Omit<RollbackAuthorization, "authorization_digest" | "created_at" | "consumed_at">,
): Promise<`sha256:${string}`> {
  return sha256ContentHash(authorization);
}

export async function computeRollbackReceiptDigest(
  receipt: Omit<RollbackReceipt, "receipt_digest" | "created_at">,
): Promise<`sha256:${string}`> {
  return sha256ContentHash(receipt);
}

export async function computeOutboxEventDigest(
  event: Omit<SemanticOutbox, "event_digest" | "created_at">,
): Promise<`sha256:${string}`> {
  return sha256ContentHash(event);
}

// ─── Validation Helpers ───────────────────────────────────────────────────────

export function assertSemanticScope(scope: SemanticScope): void {
  if (!scope.app_id || !scope.tenant_id || !scope.environment || !scope.semantic_domain) {
    throw new SemanticControlPlaneError(
      "SEMANTIC_SCOPE_MISMATCH",
      "Semantic scope 必须包含 app_id、tenant_id、environment 和 semantic_domain。",
    );
  }
}

export function assertCandidateStatusTransition(
  current: CandidateStatus,
  target: CandidateStatus,
): void {
  const validTransitions: Record<CandidateStatus, CandidateStatus[]> = {
    DRAFT: ["VALIDATING", "STALE_REBASE_REQUIRED"],
    VALIDATING: ["VALIDATION_FAILED", "REVIEW_SUBMITTED", "DRAFT"],
    VALIDATION_FAILED: ["DRAFT", "STALE_REBASE_REQUIRED"],
    REVIEW_SUBMITTED: ["WAITING_REVIEW", "DRAFT", "REJECTED"],
    WAITING_REVIEW: ["APPROVED", "REJECTED", "REVIEW_EXPIRED", "DRAFT"],
    REJECTED: ["DRAFT", "STALE_REBASE_REQUIRED"],
    REVIEW_EXPIRED: ["DRAFT", "STALE_REBASE_REQUIRED"],
    APPROVED: ["PUBLISHING", "STALE_REBASE_REQUIRED"],
    PUBLISHING: ["PUBLISHED", "STALE_REBASE_REQUIRED"],
    PUBLISHED: ["STALE_REBASE_REQUIRED"],
    STALE_REBASE_REQUIRED: ["DRAFT"],
  };

  const allowed = validTransitions[current];
  if (!allowed?.includes(target)) {
    throw new SemanticControlPlaneError(
      "SEMANTIC_CANDIDATE_WRONG_STATE",
      `候选状态不能从 ${current} 转为 ${target}。`,
    );
  }
}

export function assertReviewPacketOpen(task: ReviewTask): void {
  if (task.decision_window_status !== "OPEN") {
    throw new SemanticControlPlaneError(
      "SEMANTIC_PACKET_NOT_FOUND",
      "Review Packet 的决策窗口已关闭。",
    );
  }
  if (task.review_outcome !== "PENDING") {
    throw new SemanticControlPlaneError(
      "SEMANTIC_PACKET_NOT_FOUND",
      `Review Packet 已有最终结果: ${task.review_outcome}。`,
    );
  }
  if (new Date(task.decision_expires_at) < new Date()) {
    throw new SemanticControlPlaneError(
      "SEMANTIC_PACKET_EXPIRED",
      "Review Packet 的决策窗口已过期。",
    );
  }
}

export function assertPublishAttemptFresh(attempt: PublishAttempt): void {
  if (attempt.attempt_state !== "PREPARED") {
    throw new SemanticControlPlaneError(
      "SEMANTIC_CANDIDATE_NOT_PUBLISHED",
      `Publish Attempt 状态不是 PREPARED: ${attempt.attempt_state}。`,
    );
  }
}

export function assertRollbackAuthorizationFresh(auth: RollbackAuthorization): void {
  if (auth.is_consumed) {
    throw new SemanticControlPlaneError(
      "SEMANTIC_NONCE_CONSUMED",
      "Rollback Authorization 的 nonce 已被使用。",
    );
  }
  if (new Date(auth.expires_at) < new Date()) {
    throw new SemanticControlPlaneError(
      "SEMANTIC_AUTHORIZATION_EXPIRED",
      "Rollback Authorization 已过期。",
    );
  }
}
