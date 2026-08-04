import { z } from "zod";
import {
  contentHashSchema,
  environmentSchema,
  immutableIdSchema,
  timestampSchema,
} from "../common/index.js";

export const ATTRIBUTION_PROFILE_VERSION = "attribution-profile@1" as const;

/**
 * Endpoint lowering rule set: defines how endpoints are lowered
 * in the attribution profile projection.
 */
export const endpointLoweringRuleSetSchema = z.strictObject({
  rule_id: immutableIdSchema,
  lowering_strategy: z.enum(["STRICT", "PERMISSIVE", "CUSTOM"]),
  allowed_endpoint_patterns: z.array(z.string().min(1).max(512)).min(1),
  denied_endpoint_patterns: z.array(z.string().min(1).max(512)).default([]),
  default_lowering_depth: z.number().int().min(0).max(10).default(0),
  custom_rules: z
    .array(
      z.object({
        source_pattern: z.string().min(1).max(512),
        target_pattern: z.string().min(1).max(512),
        preserve_headers: z.array(z.string().min(1).max(64)).default([]),
      }),
    )
    .default([]),
});

export type EndpointLoweringRuleSet = z.infer<typeof endpointLoweringRuleSetSchema>;

/**
 * Lowering chain step: records a single step in the endpoint lowering chain
 * from canonical AST through to SQL execution.
 */
export const loweringChainStepSchema = z.strictObject({
  step: z.string().min(1).max(128),
  input_hash: contentHashSchema,
  output_hash: contentHashSchema,
});
export type LoweringChainStep = z.infer<typeof loweringChainStepSchema>;

/**
 * Endpoint lowering certificate: certifies that an endpoint lowering
 * operation was performed correctly.
 * Extended with U13.1 fields: canonical_ast_hash, query_contract_hash,
 * grounding_package_hash, logical_plan_hash, sql_artifact_hash,
 * parameter_hash, evidence_hash, and lowering_chain.
 */
export const endpointLoweringCertificateSchema = z.strictObject({
  certificate_id: immutableIdSchema,
  rule_set_hash: contentHashSchema,
  canonical_ast_hash: contentHashSchema,
  query_contract_hash: contentHashSchema,
  grounding_package_hash: contentHashSchema,
  logical_plan_hash: contentHashSchema,
  sql_artifact_hash: contentHashSchema,
  parameter_hash: contentHashSchema,
  evidence_hash: contentHashSchema,
  lowering_chain: z.array(loweringChainStepSchema).default([]),
  original_endpoint: z.string().min(1).max(512),
  lowered_endpoint: z.string().min(1).max(512),
  lowering_parameters: z.record(z.string(), z.unknown()).default({}),
  certified_by: z.string().min(1).max(256),
  certified_at: timestampSchema,
  expires_at: timestampSchema.optional(),
});

export type EndpointLoweringCertificate = z.infer<typeof endpointLoweringCertificateSchema>;

/**
 * Attribution profile projection: the projected profile
 * used for attribution analysis.
 */
export const attributionProfileProjectionSchema = z.strictObject({
  id: immutableIdSchema,
  app_id: immutableIdSchema,
  tenant_id: immutableIdSchema,
  environment: environmentSchema,
  profile_id: immutableIdSchema,
  source_release_id: immutableIdSchema,
  profile_name: z.string().min(1).max(256),
  profile_version: z.string().min(1).max(64),
  lowering_rule_set: endpointLoweringRuleSetSchema,
  contribution_endpoints: z.array(
    z.object({
      endpoint_id: immutableIdSchema,
      endpoint_url: z.string().min(1).max(512),
      endpoint_type: z.enum(["REST", "RPC", "EVENT", "STREAM"]),
      lowering_certificate: endpointLoweringCertificateSchema.optional(),
    }),
  ),
  is_active: z.boolean().default(true),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export type AttributionProfileProjection = z.infer<typeof attributionProfileProjectionSchema>;
