import { z } from "zod";
import {
  appScopeSchema,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
} from "../common/index.js";
import {
  semanticAuthoringStateSchema,
  semanticAuthoringValidationReceiptSchema,
} from "./semantic-authoring.js";
import {
  semanticEdgeTypeDefinitionSchema,
  semanticGraphEdgeSchema,
  semanticGraphNodeSchema,
  semanticGraphPatchSchema,
  semanticGraphProjectionSchema,
  semanticGraphSourceSchema,
} from "./semantic-graph-v2.js";

const semanticDomainSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/);
const positiveSafeIntegerSchema = z.number().int().positive().safe();
const nonNegativeSafeIntegerSchema = z.number().int().nonnegative().safe();

export const semanticEvidenceSelectionReferenceSchema = z.strictObject({
  selection_id: immutableIdSchema,
  selection_hash: contentHashSchema,
});

export const semanticManualEditSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("ADD_EDGE_TYPE"),
    edge_type_definition: semanticEdgeTypeDefinitionSchema.refine(
      (definition) =>
        definition.authoring_policy === "AGENT_AUTHORED" &&
        definition.attribute_kind !== "PHYSICAL_FACT",
      { message: "MANUAL_EDGE_TYPE_PROPOSAL_MUST_BE_AGENT_AUTHORED" },
    ),
  }),
  z.strictObject({ operation: z.literal("ADD_NODE"), node: semanticGraphNodeSchema }),
  z.strictObject({
    operation: z.literal("UPDATE_NODE"),
    node: semanticGraphNodeSchema,
    expected_node_version: positiveSafeIntegerSchema,
  }),
  z.strictObject({
    operation: z.literal("RETIRE_NODE"),
    node_id: z.string().min(1).max(128),
    expected_node_version: positiveSafeIntegerSchema,
    retirement_reason: z.string().trim().min(1).max(1_024),
  }),
  z.strictObject({ operation: z.literal("ADD_EDGE"), edge: semanticGraphEdgeSchema }),
  z.strictObject({
    operation: z.literal("UPDATE_EDGE"),
    edge: semanticGraphEdgeSchema,
    expected_edge_version: positiveSafeIntegerSchema,
  }),
  z.strictObject({
    operation: z.literal("RETIRE_EDGE"),
    edge_id: z.string().min(1).max(128),
    expected_edge_version: positiveSafeIntegerSchema,
    retirement_reason: z.string().trim().min(1).max(1_024),
  }),
]);

export const semanticCandidateRevisionSaveRequestSchema = z.strictObject({
  schema_version: z.literal("semantic-candidate-revision-save-request@1.0.0"),
  semantic_domain: semanticDomainSchema,
  authoring_run_id: immutableIdSchema.nullable(),
  expected_working_revision: nonNegativeSafeIntegerSchema,
  expected_graph_digest: contentHashSchema,
  manual_edits: z.array(semanticManualEditSchema).max(256),
  evidence_selection_refs: z.array(semanticEvidenceSelectionReferenceSchema).max(32),
  summary: z.string().trim().min(1).max(2_048),
  idempotency_key: immutableIdSchema,
});

export const semanticManualSessionStartRequestSchema = z.strictObject({
  schema_version: z.literal("semantic-manual-session-start-request@1.0.0"),
  semantic_domain: semanticDomainSchema,
  idempotency_key: immutableIdSchema,
});

const semanticManualSessionStartCommandDraftSchema = z.strictObject({
  schema_version: z.literal("semantic-manual-session-start-command@1.0.0"),
  command_id: immutableIdSchema,
  scope: appScopeSchema,
  semantic_domain: semanticDomainSchema,
  principal_id: immutableIdSchema,
  authoring_run_id: immutableIdSchema,
  candidate_id: immutableIdSchema,
  base_release_id: immutableIdSchema,
  base_release_generation: positiveSafeIntegerSchema,
  base_graph: semanticGraphSourceSchema,
  base_graph_digest: contentHashSchema,
  idempotency_key: immutableIdSchema,
  started_at: timestampSchema,
});

export const semanticManualSessionStartCommandSchema =
  semanticManualSessionStartCommandDraftSchema.extend({ command_hash: contentHashSchema });

export async function buildSemanticManualSessionStartCommand(input: unknown) {
  const draft = semanticManualSessionStartCommandDraftSchema.parse(input);
  return deepFreeze(
    semanticManualSessionStartCommandSchema.parse({
      ...draft,
      command_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifySemanticManualSessionStartCommand(input: unknown) {
  const command = semanticManualSessionStartCommandSchema.parse(input);
  const { command_hash: _hash, ...draft } = command;
  if ((await sha256ContentHash(draft)) !== command.command_hash) {
    throw new TypeError("SEMANTIC_MANUAL_SESSION_START_HASH_MISMATCH");
  }
  return deepFreeze(command);
}

export const semanticManualSessionStartResultSchema = semanticAuthoringStateSchema;

const semanticOperationOriginSchema = z.strictObject({
  operation_index: nonNegativeSafeIntegerSchema,
  origin: z.enum(["CHAT_AGENT", "KNOWLEDGE_AGENT", "MANUAL"]),
  authoring_run_id: immutableIdSchema.nullable(),
  evidence_selection_refs: z.array(semanticEvidenceSelectionReferenceSchema).max(32),
});

const semanticCandidateRevisionSaveCommandDraftSchema = z.strictObject({
  schema_version: z.literal("semantic-candidate-revision-save-command@1.0.0"),
  command_id: immutableIdSchema,
  scope: appScopeSchema,
  semantic_domain: semanticDomainSchema,
  principal_id: immutableIdSchema,
  authoring_run_id: immutableIdSchema,
  candidate_id: immutableIdSchema,
  base_release_id: immutableIdSchema,
  expected_working_revision: nonNegativeSafeIntegerSchema,
  expected_graph_digest: contentHashSchema,
  final_graph: semanticGraphSourceSchema,
  final_graph_digest: contentHashSchema,
  manual_patch: semanticGraphPatchSchema.nullable(),
  operation_origins: z.array(semanticOperationOriginSchema).max(256),
  evidence_selection_refs: z.array(semanticEvidenceSelectionReferenceSchema).max(32),
  validation_receipt: semanticAuthoringValidationReceiptSchema,
  summary: z.string().trim().min(1).max(2_048),
  idempotency_key: immutableIdSchema,
  saved_at: timestampSchema,
});

export const semanticCandidateRevisionSaveCommandSchema =
  semanticCandidateRevisionSaveCommandDraftSchema.extend({ command_hash: contentHashSchema });

export async function buildSemanticCandidateRevisionSaveCommand(input: unknown) {
  const draft = semanticCandidateRevisionSaveCommandDraftSchema.parse(input);
  return deepFreeze(
    semanticCandidateRevisionSaveCommandSchema.parse({
      ...draft,
      command_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifySemanticCandidateRevisionSaveCommand(input: unknown) {
  const command = semanticCandidateRevisionSaveCommandSchema.parse(input);
  const { command_hash: _hash, ...draft } = command;
  if ((await sha256ContentHash(draft)) !== command.command_hash) {
    throw new TypeError("SEMANTIC_CANDIDATE_REVISION_SAVE_HASH_MISMATCH");
  }
  return deepFreeze(command);
}

export const semanticCandidateRevisionSaveResultSchema = z.strictObject({
  schema_version: z.literal("semantic-candidate-revision-save-result@1.0.0"),
  disposition: z.enum(["CREATED", "REPLAYED"]),
  candidate_id: immutableIdSchema,
  source_revision_id: immutableIdSchema,
  candidate_revision_id: immutableIdSchema,
  revision_number: positiveSafeIntegerSchema,
  final_graph_digest: contentHashSchema,
  validation_receipt_digest: contentHashSchema,
  saved_at: timestampSchema,
});

export const semanticCandidateSelfPublishRequestSchema = z.strictObject({
  schema_version: z.literal("semantic-candidate-self-publish-request@1.0.0"),
  semantic_domain: semanticDomainSchema,
  authoring_run_id: immutableIdSchema,
  candidate_id: immutableIdSchema,
  candidate_revision_id: immutableIdSchema,
  revision_number: positiveSafeIntegerSchema,
  source_revision_id: immutableIdSchema,
  review_reason: z.string().trim().min(1).max(2_048),
  idempotency_key: immutableIdSchema,
});

const semanticCandidateSelfPublishCommandDraftSchema = z.strictObject({
  schema_version: z.literal("semantic-candidate-self-publish-command@1.0.0"),
  command_id: immutableIdSchema,
  scope: appScopeSchema,
  semantic_domain: semanticDomainSchema,
  principal_id: immutableIdSchema,
  candidate_id: immutableIdSchema,
  candidate_revision_id: immutableIdSchema,
  revision_number: positiveSafeIntegerSchema,
  source_revision_id: immutableIdSchema,
  source_graph_digest: contentHashSchema,
  base_release_id: immutableIdSchema,
  graph_projection_id: immutableIdSchema,
  graph_projection: semanticGraphProjectionSchema,
  executable_projection_id: immutableIdSchema,
  executable_projection_hash: contentHashSchema,
  executable_projection: z.json(),
  relationship_projection_id: immutableIdSchema,
  relationship_projection_hash: contentHashSchema,
  relationship_projection: z.json(),
  runtime_restriction_projection_id: immutableIdSchema,
  runtime_restriction_projection_hash: contentHashSchema,
  runtime_restriction_projection: z.json(),
  compiler_bundle_digest: contentHashSchema,
  review_reason: z.string().trim().min(1).max(2_048),
  idempotency_key: immutableIdSchema,
  reviewed_at: timestampSchema,
});

export const semanticCandidateSelfPublishCommandSchema =
  semanticCandidateSelfPublishCommandDraftSchema.extend({ command_hash: contentHashSchema });

export async function buildSemanticCandidateSelfPublishCommand(input: unknown) {
  const draft = semanticCandidateSelfPublishCommandDraftSchema.parse(input);
  return deepFreeze(
    semanticCandidateSelfPublishCommandSchema.parse({
      ...draft,
      command_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifySemanticCandidateSelfPublishCommand(input: unknown) {
  const command = semanticCandidateSelfPublishCommandSchema.parse(input);
  const { command_hash: _hash, ...draft } = command;
  if ((await sha256ContentHash(draft)) !== command.command_hash) {
    throw new TypeError("SEMANTIC_CANDIDATE_SELF_PUBLISH_HASH_MISMATCH");
  }
  return deepFreeze(command);
}

export const semanticCandidateSelfPublishResultSchema = z.strictObject({
  schema_version: z.literal("semantic-candidate-self-publish-result@1.0.0"),
  disposition: z.enum(["PUBLISHED", "REPLAYED"]),
  candidate_id: immutableIdSchema,
  candidate_revision_id: immutableIdSchema,
  packet_id: immutableIdSchema,
  decision_id: immutableIdSchema,
  publish_attempt_id: immutableIdSchema,
  release_id: immutableIdSchema,
  release_generation: positiveSafeIntegerSchema,
  release_digest: contentHashSchema,
  graph_projection_id: immutableIdSchema,
  source_graph_digest: contentHashSchema,
  reviewed_at: timestampSchema,
  published_at: timestampSchema,
});

export type SemanticManualEdit = z.infer<typeof semanticManualEditSchema>;
export type SemanticManualSessionStartRequest = z.infer<
  typeof semanticManualSessionStartRequestSchema
>;
export type SemanticManualSessionStartCommand = z.infer<
  typeof semanticManualSessionStartCommandSchema
>;
export type SemanticCandidateRevisionSaveRequest = z.infer<
  typeof semanticCandidateRevisionSaveRequestSchema
>;
export type SemanticCandidateRevisionSaveCommand = z.infer<
  typeof semanticCandidateRevisionSaveCommandSchema
>;
export type SemanticCandidateRevisionSaveResult = z.infer<
  typeof semanticCandidateRevisionSaveResultSchema
>;
export type SemanticCandidateSelfPublishRequest = z.infer<
  typeof semanticCandidateSelfPublishRequestSchema
>;
export type SemanticCandidateSelfPublishCommand = z.infer<
  typeof semanticCandidateSelfPublishCommandSchema
>;
export type SemanticCandidateSelfPublishResult = z.infer<
  typeof semanticCandidateSelfPublishResultSchema
>;
