import { z } from "zod";
import {
  contentHashSchema,
  immutableIdSchema,
  sha256ContentHash,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import { runtimeBuildIdentitySchema } from "../operations/runtime-build-identity.js";
import { semanticScopeSchema } from "./semantic-control-plane.js";

export const SEMANTIC_ASSERTION_CANDIDATE_VERSION = "semantic-assertion-candidate@1.0.0" as const;
export const SEMANTIC_CHANGE_SET_VERSION = "semantic-change-set@1.0.0" as const;
export const SEMANTIC_COMPETENCY_CASE_VERSION = "semantic-competency-case@1.0.0" as const;
export const SEMANTIC_REVIEW_DECISION_VERSION = "semantic-review-decision@1.0.0" as const;
export const SEMANTIC_PUBLICATION_RECEIPT_VERSION = "semantic-publication-receipt@1.0.0" as const;
export const STAGE_REVIEWED_SEMANTIC_SUCCESSOR_COMMAND_VERSION =
  "stage-reviewed-semantic-successor-command@1.0.0" as const;
export const SEMANTIC_SUCCESSOR_STAGE_LOAD_COMMAND_VERSION =
  "semantic-successor-stage-load@1.0.0" as const;
export const SEMANTIC_SUCCESSOR_RELEASE_LOAD_COMMAND_VERSION =
  "semantic-successor-release-load@1.0.0" as const;
export const SEMANTIC_SUCCESSOR_SMOKE_COMMIT_COMMAND_VERSION =
  "semantic-successor-smoke-commit@1.0.0" as const;

export const semanticReleaseReferenceSchema = z.strictObject({
  release_id: immutableIdSchema,
  generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  release_digest: contentHashSchema,
});

export const semanticSuccessorCandidateReleaseReferenceSchema = semanticReleaseReferenceSchema
  .extend({
    datasource_id: immutableIdSchema,
  })
  .strict();

const semanticProjectionReferenceSchema = z.strictObject({
  projection_id: immutableIdSchema,
  projection_digest: contentHashSchema,
});

export const semanticSuccessorProjectionReferenceSetSchema = z.strictObject({
  executable: semanticProjectionReferenceSchema,
  relationship: semanticProjectionReferenceSchema,
  runtime_restriction: semanticProjectionReferenceSchema,
  graph: semanticProjectionReferenceSchema,
});

export const semanticRuntimeClosureValidatorIdentitySchema = z.strictObject({
  validator_version: versionIdentifierSchema,
  validator_hash: contentHashSchema,
});

export const semanticSuccessorStageReferenceSchema = z.strictObject({
  stage_id: immutableIdSchema,
  stage_digest: contentHashSchema,
});

export const semanticRuntimeClosureValidationReceiptReferenceSchema = z.strictObject({
  schema_version: z.literal("semantic-runtime-closure-validation-receipt@1.0.0"),
  receipt_id: immutableIdSchema,
  validation_receipt_hash: contentHashSchema,
});

export const semanticRuntimeSmokeReceiptReferenceSchema = z.strictObject({
  schema_version: z.literal("semantic-runtime-smoke-receipt@1.0.0"),
  receipt_id: immutableIdSchema,
  smoke_receipt_hash: contentHashSchema,
});

export const stageReviewedSemanticSuccessorCommandSchema = z
  .strictObject({
    schema_version: z.literal(STAGE_REVIEWED_SEMANTIC_SUCCESSOR_COMMAND_VERSION),
    command_id: immutableIdSchema,
    idempotency_key: z.string().trim().min(1).max(256),
    scope: semanticScopeSchema,
    change_set_ref: z.strictObject({
      change_set_id: immutableIdSchema,
      change_set_hash: contentHashSchema,
    }),
    review_ref: z.strictObject({
      review_id: immutableIdSchema,
      review_hash: contentHashSchema,
    }),
    source_snapshot_ref: z.strictObject({
      snapshot_id: immutableIdSchema,
      snapshot_revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
      snapshot_hash: contentHashSchema,
    }),
    compiler_bundle_ref: z.strictObject({
      compiler_version: versionIdentifierSchema,
      compiler_bundle_hash: contentHashSchema,
    }),
    expected_predecessor: semanticReleaseReferenceSchema,
    expected_pointer_version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    target_generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  })
  .superRefine((command, context) => {
    if (command.target_generation !== command.expected_predecessor.generation + 1) {
      context.addIssue({
        code: "custom",
        message: "SEMANTIC_SUCCESSOR_GENERATION_INVALID",
        path: ["target_generation"],
      });
    }
  });

export async function buildStageReviewedSemanticSuccessorCommand(input: unknown) {
  return stageReviewedSemanticSuccessorCommandSchema.parse(input);
}

const semanticSuccessorStageMaterialSchema = z
  .strictObject({
    schema_version: z.literal("semantic-successor-stage@1.0.0"),
    stage_id: immutableIdSchema,
    scope: semanticScopeSchema,
    predecessor_release: semanticReleaseReferenceSchema,
    expected_pointer_version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    target_generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    change_set_ref: z.strictObject({
      change_set_id: immutableIdSchema,
      change_set_hash: contentHashSchema,
    }),
    review_ref: z.strictObject({
      review_id: immutableIdSchema,
      review_hash: contentHashSchema,
    }),
    source_snapshot_ref: z.strictObject({
      snapshot_id: immutableIdSchema,
      snapshot_revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
      snapshot_hash: contentHashSchema,
    }),
    compiler_bundle_ref: z.strictObject({
      compiler_version: versionIdentifierSchema,
      compiler_bundle_hash: contentHashSchema,
    }),
    candidate_release: semanticSuccessorCandidateReleaseReferenceSchema,
    projection_refs: semanticSuccessorProjectionReferenceSetSchema,
    status: z.enum(["STAGED", "SMOKE_PASSED", "REJECTED", "PROMOTED"]),
  })
  .superRefine((stage, context) => {
    if (
      stage.target_generation !== stage.predecessor_release.generation + 1 ||
      stage.candidate_release.generation !== stage.target_generation
    ) {
      context.addIssue({
        code: "custom",
        message: "SEMANTIC_SUCCESSOR_GENERATION_INVALID",
        path: ["target_generation"],
      });
    }
  });

export const semanticSuccessorStageSchema = semanticSuccessorStageMaterialSchema.extend({
  stage_digest: contentHashSchema,
});

const semanticSuccessorProjectionStageSchema = z.strictObject({
  projection_kind: z.enum(["EXECUTABLE", "RELATIONSHIP", "RUNTIME_RESTRICTION", "GRAPH"]),
  projection_id: immutableIdSchema,
  projection_digest: contentHashSchema,
  projection_payload: z.unknown(),
});

export const semanticSuccessorProjectionSetSchema = z.strictObject({
  executable: semanticSuccessorProjectionStageSchema.extend({
    projection_kind: z.literal("EXECUTABLE"),
  }),
  relationship: semanticSuccessorProjectionStageSchema.extend({
    projection_kind: z.literal("RELATIONSHIP"),
  }),
  runtime_restriction: semanticSuccessorProjectionStageSchema.extend({
    projection_kind: z.literal("RUNTIME_RESTRICTION"),
  }),
  graph: semanticSuccessorProjectionStageSchema.extend({
    projection_kind: z.literal("GRAPH"),
  }),
});

export const semanticSuccessorStageEnvelopeSchema = z
  .strictObject({
    stage: semanticSuccessorStageSchema,
    projections: semanticSuccessorProjectionSetSchema,
  })
  .superRefine((envelope, context) => {
    const projectionKeys = ["executable", "relationship", "runtime_restriction", "graph"] as const;
    for (const key of projectionKeys) {
      const projection = envelope.projections[key];
      const reference = envelope.stage.projection_refs[key];
      if (
        projection.projection_id !== reference.projection_id ||
        projection.projection_digest !== reference.projection_digest
      ) {
        context.addIssue({
          code: "custom",
          message: "SEMANTIC_SUCCESSOR_PROJECTION_REFERENCE_MISMATCH",
          path: ["projections", key],
        });
      }
    }
  });

function semanticSuccessorStageMaterial(input: unknown) {
  const full = semanticSuccessorStageSchema.safeParse(input);
  if (!full.success) return semanticSuccessorStageMaterialSchema.parse(input);
  const { stage_digest: _stageDigest, ...material } = full.data;
  return semanticSuccessorStageMaterialSchema.parse(material);
}

export async function computeSemanticSuccessorStageDigest(input: unknown) {
  const stage = semanticSuccessorStageMaterial(input);
  return sha256ContentHash({
    hash_domain: "semantic-successor-stage-digest@1.0.0",
    scope: stage.scope,
    predecessor_release: stage.predecessor_release,
    expected_pointer_version: stage.expected_pointer_version,
    change_set_ref: stage.change_set_ref,
    review_ref: stage.review_ref,
    source_snapshot_ref: stage.source_snapshot_ref,
    compiler_bundle_ref: stage.compiler_bundle_ref,
    candidate_release: stage.candidate_release,
    projection_refs: stage.projection_refs,
  });
}

export async function buildSemanticSuccessorStage(input: unknown) {
  const material = semanticSuccessorStageMaterial(input);
  return semanticSuccessorStageSchema.parse({
    ...material,
    stage_digest: await computeSemanticSuccessorStageDigest(material),
  });
}

export async function verifySemanticSuccessorStage(input: unknown) {
  const stage = semanticSuccessorStageSchema.parse(input);
  if ((await computeSemanticSuccessorStageDigest(stage)) !== stage.stage_digest) {
    throw new TypeError("SEMANTIC_SUCCESSOR_STAGE_DIGEST_MISMATCH");
  }
  return stage;
}

const canonicalReasonCodesSchema = z
  .array(z.string().regex(/^[A-Z][A-Z0-9_]{2,127}$/u))
  .max(256)
  .superRefine((values, context) => {
    for (let index = 1; index < values.length; index += 1) {
      if ((values[index - 1] ?? "") >= (values[index] ?? "")) {
        context.addIssue({
          code: "custom",
          message: "Reason codes must be unique and canonically sorted.",
          path: [index],
        });
      }
    }
  });

const semanticRuntimeClosureValidationReceiptMaterialSchema = z
  .strictObject({
    schema_version: z.literal("semantic-runtime-closure-validation-receipt@1.0.0"),
    receipt_id: immutableIdSchema,
    stage_id: immutableIdSchema,
    stage_digest: contentHashSchema,
    candidate_release: semanticSuccessorCandidateReleaseReferenceSchema,
    projection_refs: semanticSuccessorProjectionReferenceSetSchema,
    validator_identity: semanticRuntimeClosureValidatorIdentitySchema,
    outcome: z.enum(["PASS", "FAIL"]),
    reason_codes: canonicalReasonCodesSchema,
  })
  .superRefine((receipt, context) => {
    if ((receipt.outcome === "PASS") !== (receipt.reason_codes.length === 0)) {
      context.addIssue({
        code: "custom",
        message: "Validation PASS requires no reason codes and FAIL requires at least one.",
        path: ["reason_codes"],
      });
    }
  });

export const semanticRuntimeClosureValidationReceiptSchema =
  semanticRuntimeClosureValidationReceiptMaterialSchema.extend({
    validation_receipt_hash: contentHashSchema,
  });

function semanticRuntimeClosureValidationReceiptMaterial(input: unknown) {
  const full = semanticRuntimeClosureValidationReceiptSchema.safeParse(input);
  if (!full.success) return semanticRuntimeClosureValidationReceiptMaterialSchema.parse(input);
  const { validation_receipt_hash: _receiptHash, ...material } = full.data;
  return semanticRuntimeClosureValidationReceiptMaterialSchema.parse(material);
}

export async function computeSemanticRuntimeClosureValidationReceiptHash(input: unknown) {
  return sha256ContentHash({
    hash_domain: "semantic-runtime-closure-validation-receipt@1.0.0",
    receipt: semanticRuntimeClosureValidationReceiptMaterial(input),
  });
}

export async function buildSemanticRuntimeClosureValidationReceipt(input: unknown) {
  const material = semanticRuntimeClosureValidationReceiptMaterial(input);
  return semanticRuntimeClosureValidationReceiptSchema.parse({
    ...material,
    validation_receipt_hash: await computeSemanticRuntimeClosureValidationReceiptHash(material),
  });
}

export async function verifySemanticRuntimeClosureValidationReceipt(input: unknown) {
  const receipt = semanticRuntimeClosureValidationReceiptSchema.parse(input);
  if (
    (await computeSemanticRuntimeClosureValidationReceiptHash(receipt)) !==
    receipt.validation_receipt_hash
  ) {
    throw new TypeError("SEMANTIC_RUNTIME_VALIDATION_RECEIPT_HASH_MISMATCH");
  }
  return receipt;
}

const semanticRuntimeSmokeReceiptMaterialSchema = z
  .strictObject({
    schema_version: z.literal("semantic-runtime-smoke-receipt@1.0.0"),
    receipt_id: immutableIdSchema,
    stage_id: immutableIdSchema,
    stage_digest: contentHashSchema,
    candidate_release: semanticSuccessorCandidateReleaseReferenceSchema,
    projection_refs: semanticSuccessorProjectionReferenceSetSchema,
    resolved_metric_id: z.literal("metric.order_revenue"),
    resolved_dimension_id: z.literal("dimension.order_month"),
    resolved_binding_hash: contentHashSchema,
    plan_hash: contentHashSchema,
    calendar_timezone: z.literal("Asia/Shanghai"),
    window_start: z.literal("2023-11-01T00:00:00.000Z"),
    window_end_exclusive: z.literal("2024-11-01T00:00:00.000Z"),
    validator_identity: semanticRuntimeClosureValidatorIdentitySchema,
    worker_build_identity: runtimeBuildIdentitySchema,
    outcome: z.enum(["PASS", "FAIL"]),
    failure_code: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{2,127}$/u)
      .nullable(),
  })
  .superRefine((receipt, context) => {
    if ((receipt.outcome === "PASS") !== (receipt.failure_code === null)) {
      context.addIssue({
        code: "custom",
        message: "Smoke PASS requires a null failure code and FAIL requires a stable code.",
        path: ["failure_code"],
      });
    }
  });

export const semanticRuntimeSmokeReceiptSchema = semanticRuntimeSmokeReceiptMaterialSchema.extend({
  smoke_receipt_hash: contentHashSchema,
});

function semanticRuntimeSmokeReceiptMaterial(input: unknown) {
  const full = semanticRuntimeSmokeReceiptSchema.safeParse(input);
  if (!full.success) return semanticRuntimeSmokeReceiptMaterialSchema.parse(input);
  const { smoke_receipt_hash: _receiptHash, ...material } = full.data;
  return semanticRuntimeSmokeReceiptMaterialSchema.parse(material);
}

export async function computeSemanticRuntimeSmokeReceiptHash(input: unknown) {
  return sha256ContentHash({
    hash_domain: "semantic-runtime-smoke-receipt@1.0.0",
    receipt: semanticRuntimeSmokeReceiptMaterial(input),
  });
}

export async function buildSemanticRuntimeSmokeReceipt(input: unknown) {
  const material = semanticRuntimeSmokeReceiptMaterial(input);
  return semanticRuntimeSmokeReceiptSchema.parse({
    ...material,
    smoke_receipt_hash: await computeSemanticRuntimeSmokeReceiptHash(material),
  });
}

export async function verifySemanticRuntimeSmokeReceipt(input: unknown) {
  const receipt = semanticRuntimeSmokeReceiptSchema.parse(input);
  if ((await computeSemanticRuntimeSmokeReceiptHash(receipt)) !== receipt.smoke_receipt_hash) {
    throw new TypeError("SEMANTIC_RUNTIME_SMOKE_RECEIPT_HASH_MISMATCH");
  }
  return receipt;
}

const semanticSuccessorStageLoadCommandMaterialSchema = z.strictObject({
  schema_version: z.literal(SEMANTIC_SUCCESSOR_STAGE_LOAD_COMMAND_VERSION),
  stage_id: immutableIdSchema,
});

export const semanticSuccessorStageLoadCommandSchema =
  semanticSuccessorStageLoadCommandMaterialSchema.extend({
    command_hash: contentHashSchema,
  });

export async function buildSemanticSuccessorStageLoadCommand(input: unknown) {
  const material = semanticSuccessorStageLoadCommandMaterialSchema.parse(input);
  return semanticSuccessorStageLoadCommandSchema.parse({
    ...material,
    command_hash: await sha256ContentHash(material),
  });
}

const semanticSuccessorReleaseLoadCommandMaterialSchema = z.strictObject({
  schema_version: z.literal(SEMANTIC_SUCCESSOR_RELEASE_LOAD_COMMAND_VERSION),
  semantic_domain: semanticScopeSchema.shape.semantic_domain,
  release_id: immutableIdSchema,
});

export const semanticSuccessorReleaseLoadCommandSchema =
  semanticSuccessorReleaseLoadCommandMaterialSchema.extend({
    command_hash: contentHashSchema,
  });

export async function buildSemanticSuccessorReleaseLoadCommand(input: unknown) {
  const material = semanticSuccessorReleaseLoadCommandMaterialSchema.parse(input);
  return semanticSuccessorReleaseLoadCommandSchema.parse({
    ...material,
    command_hash: await sha256ContentHash(material),
  });
}

const semanticSuccessorSmokeCommitCommandMaterialSchema = z
  .strictObject({
    schema_version: z.literal(SEMANTIC_SUCCESSOR_SMOKE_COMMIT_COMMAND_VERSION),
    idempotency_key: z.string().trim().min(1).max(256),
    stage_id: immutableIdSchema,
    expected_stage_digest: contentHashSchema,
    receipt: semanticRuntimeSmokeReceiptSchema,
  })
  .superRefine((command, context) => {
    if (
      command.receipt.stage_id !== command.stage_id ||
      command.receipt.stage_digest !== command.expected_stage_digest
    ) {
      context.addIssue({
        code: "custom",
        message: "SEMANTIC_SUCCESSOR_SMOKE_COMMAND_RECEIPT_MISMATCH",
        path: ["receipt"],
      });
    }
  });

export const semanticSuccessorSmokeCommitCommandSchema =
  semanticSuccessorSmokeCommitCommandMaterialSchema.extend({
    command_hash: contentHashSchema,
  });

export async function buildSemanticSuccessorSmokeCommitCommand(input: unknown) {
  const material = semanticSuccessorSmokeCommitCommandMaterialSchema.parse(input);
  return semanticSuccessorSmokeCommitCommandSchema.parse({
    ...material,
    command_hash: await sha256ContentHash(material),
  });
}

export const semanticAssertionSourceKindSchema = z.enum([
  "SELECTED_KNOWLEDGE_EVIDENCE",
  "SCHEMA_FACT",
  "CURRENT_SEMANTIC_FACT",
  "AGENT_INFERENCE",
]);

export const semanticAssertionTargetKindSchema = z.enum([
  "BUSINESS_ENTITY_TYPE",
  "DIMENSION",
  "METRIC",
  "RELATIONSHIP",
  "PHYSICAL_BINDING",
  "TERM",
  "FORMULA",
  "TIME_SEMANTICS",
  "QUALITY_CONSTRAINT",
  "ANALYSIS_JOIN",
]);

export const semanticAssertionEvidenceSchema = z.strictObject({
  evidence_id: versionIdentifierSchema,
  source_kind: semanticAssertionSourceKindSchema,
  source_ref: z.strictObject({
    resource_id: versionIdentifierSchema,
    resource_revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    resource_hash: contentHashSchema,
  }),
  locator: z.strictObject({
    locator_kind: z.enum(["DOCUMENT_SPAN", "SCHEMA_OBJECT", "SEMANTIC_OBJECT", "INFERENCE_RULE"]),
    locator_value: z.string().trim().min(1).max(2_048),
  }),
  observation: z.string().trim().min(1).max(4_096),
});

const canonicalVersionIdentifiersSchema = z
  .array(versionIdentifierSchema)
  .max(256)
  .superRefine((values, context) => {
    for (let index = 1; index < values.length; index += 1) {
      if ((values[index - 1] ?? "") >= (values[index] ?? "")) {
        context.addIssue({
          code: "custom",
          message: "Identifiers must be unique and canonically sorted.",
          path: [index],
        });
      }
    }
  });

const semanticAssertionCandidateMaterialSchema = z
  .strictObject({
    schema_version: z.literal(SEMANTIC_ASSERTION_CANDIDATE_VERSION),
    assertion_id: immutableIdSchema,
    scope: semanticScopeSchema,
    target_kind: semanticAssertionTargetKindSchema,
    canonical_key: z.string().trim().min(1).max(512),
    applicability_scope: z.record(z.string().min(1).max(128), z.string().max(1_024)),
    assertion_payload: z.record(z.string().min(1).max(256), z.unknown()),
    source_kind: semanticAssertionSourceKindSchema,
    evidence: z.array(semanticAssertionEvidenceSchema).min(1).max(256),
    premise_assertion_ids: canonicalVersionIdentifiersSchema,
    inference_rule_id: versionIdentifierSchema.nullable(),
    confidence: z.number().min(0).max(1),
  })
  .superRefine((assertion, context) => {
    const ownSourceEvidence = assertion.evidence.some(
      (evidence) => evidence.source_kind === assertion.source_kind,
    );
    if (!ownSourceEvidence) {
      context.addIssue({
        code: "custom",
        message: "Assertion source kind must be backed by matching evidence.",
        path: ["evidence"],
      });
    }
    if (assertion.source_kind === "AGENT_INFERENCE") {
      if (assertion.premise_assertion_ids.length === 0 || assertion.inference_rule_id === null) {
        context.addIssue({
          code: "custom",
          message: "Agent inference requires explicit premises and a registered rule.",
          path: ["premise_assertion_ids"],
        });
      }
      if (assertion.confidence === 1) {
        context.addIssue({
          code: "custom",
          message: "Agent inference cannot claim absolute confidence.",
          path: ["confidence"],
        });
      }
    } else if (assertion.premise_assertion_ids.length > 0 || assertion.inference_rule_id !== null) {
      context.addIssue({
        code: "custom",
        message: "Only Agent inference may declare premises or inference rules.",
        path: ["inference_rule_id"],
      });
    }
  });

export const semanticAssertionCandidateSchema = semanticAssertionCandidateMaterialSchema.extend({
  identity_hash: contentHashSchema,
  assertion_hash: contentHashSchema,
});

export const semanticAssertionConflictSchema = z.strictObject({
  identity_hash: contentHashSchema,
  assertion_ids: canonicalVersionIdentifiersSchema.min(2),
  assertion_hashes: z
    .array(contentHashSchema)
    .min(2)
    .superRefine((values, context) => {
      for (let index = 1; index < values.length; index += 1) {
        if ((values[index - 1] ?? "") >= (values[index] ?? "")) {
          context.addIssue({
            code: "custom",
            message: "Assertion hashes must be unique and canonically sorted.",
            path: [index],
          });
        }
      }
    }),
  reason_code: z.literal("SEMANTIC_ASSERTION_CONFLICT"),
});

export const semanticChangeSetValidationSchema = z.strictObject({
  outcome: z.enum(["PASS", "FAIL"]),
  reason_codes: z.array(z.string().trim().min(1).max(128)).max(256),
  formula_cycle_free: z.boolean(),
  evidence_closed: z.boolean(),
  identity_conflict_free: z.boolean(),
  shapes_valid: z.boolean(),
  formulas_valid: z.boolean(),
  grain_join_time_valid: z.boolean(),
  policy_quality_valid: z.boolean(),
  competency_cases_passed: z.boolean(),
});

export const semanticCompetencyCaseSchema = z.strictObject({
  schema_version: z.literal(SEMANTIC_COMPETENCY_CASE_VERSION),
  case_id: versionIdentifierSchema,
  question: z.string().trim().min(1).max(4_000),
  required_assertion_keys: z.array(z.string().trim().min(1).max(512)).min(1).max(256),
  required_target_kinds: z.array(semanticAssertionTargetKindSchema).min(1).max(32),
  required_relationship_paths: z
    .array(z.array(z.string().trim().min(1).max(512)).min(1).max(16))
    .max(64),
  expected_analysis_capabilities: z.array(versionIdentifierSchema).min(1).max(32),
});

export const semanticCompetencyResultSchema = z.strictObject({
  case_id: versionIdentifierSchema,
  case_hash: contentHashSchema,
  verdict: z.enum(["PASS", "FAIL"]),
  resolved_assertion_ids: canonicalVersionIdentifiersSchema,
  resolved_relationship_paths: z.array(z.array(versionIdentifierSchema).min(1).max(16)).max(64),
  reason_codes: z.array(z.string().trim().min(1).max(128)).max(64),
  result_hash: contentHashSchema,
});

const semanticChangeSetMaterialSchema = z.strictObject({
  schema_version: z.literal(SEMANTIC_CHANGE_SET_VERSION),
  change_set_id: immutableIdSchema,
  scope: semanticScopeSchema,
  base_release: z.strictObject({
    release_id: immutableIdSchema,
    generation: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    release_hash: contentHashSchema,
  }),
  revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  assertions: z.array(semanticAssertionCandidateSchema).min(1).max(10_000),
  conflicts: z.array(semanticAssertionConflictSchema).max(10_000),
  competency_results: z.array(semanticCompetencyResultSchema).max(256),
  validation: semanticChangeSetValidationSchema,
  lifecycle_state: z.enum(["DRAFT", "VALIDATED", "BLOCKED", "REVIEW_FROZEN"]),
});

const semanticReviewDecisionMaterialSchema = z.strictObject({
  schema_version: z.literal(SEMANTIC_REVIEW_DECISION_VERSION),
  review_id: immutableIdSchema,
  scope: semanticScopeSchema,
  change_set_id: immutableIdSchema,
  change_set_hash: contentHashSchema,
  reviewer_principal_id: immutableIdSchema,
  decision: z.enum(["APPROVE", "REJECT"]),
  reason_codes: z.array(z.string().trim().min(1).max(128)).max(64),
  reviewed_at: timestampSchema,
});

export const semanticReviewDecisionSchema = semanticReviewDecisionMaterialSchema.extend({
  review_hash: contentHashSchema,
});

const semanticPublicationReceiptMaterialSchema = z.strictObject({
  schema_version: z.literal(SEMANTIC_PUBLICATION_RECEIPT_VERSION),
  publication_id: immutableIdSchema,
  scope: semanticScopeSchema,
  change_set_id: immutableIdSchema,
  change_set_hash: contentHashSchema,
  review_id: immutableIdSchema,
  review_hash: contentHashSchema,
  previous_release: z.strictObject({
    release_id: immutableIdSchema,
    generation: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    release_hash: contentHashSchema,
  }),
  published_release: z.strictObject({
    release_id: immutableIdSchema,
    generation: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    release_hash: contentHashSchema,
    valid_from: timestampSchema,
  }),
  binding_impact_hashes: z.array(contentHashSchema).max(10_000),
  projection_rebuild: z.strictObject({
    sparse: z.enum(["QUEUED", "READY"]),
    vector: z.enum(["QUEUED", "READY"]),
    graph: z.enum(["QUEUED", "READY"]),
  }),
  published_at: timestampSchema,
});

export const semanticPublicationReceiptSchema = semanticPublicationReceiptMaterialSchema.extend({
  publication_hash: contentHashSchema,
});

export const semanticChangeSetSchema = semanticChangeSetMaterialSchema
  .extend({ change_set_hash: contentHashSchema })
  .superRefine((changeSet, context) => {
    const keys = changeSet.assertions.map(
      (assertion) => `${assertion.identity_hash}\u0000${assertion.assertion_hash}`,
    );
    for (let index = 1; index < keys.length; index += 1) {
      if ((keys[index - 1] ?? "") >= (keys[index] ?? "")) {
        context.addIssue({
          code: "custom",
          message: "Assertions must be unique and canonically sorted.",
          path: ["assertions", index],
        });
      }
    }
    const blocked = changeSet.validation.outcome === "FAIL" || changeSet.conflicts.length > 0;
    if (blocked !== (changeSet.lifecycle_state === "BLOCKED")) {
      context.addIssue({
        code: "custom",
        message: "Blocked lifecycle state must match validation and conflict outcome.",
        path: ["lifecycle_state"],
      });
    }
  });

function assertionMaterial(input: unknown) {
  const full = semanticAssertionCandidateSchema.safeParse(input);
  if (!full.success) return semanticAssertionCandidateMaterialSchema.parse(input);
  const { identity_hash: _identityHash, assertion_hash: _assertionHash, ...material } = full.data;
  return semanticAssertionCandidateMaterialSchema.parse(material);
}

export async function computeSemanticAssertionIdentityHash(input: unknown) {
  const assertion = assertionMaterial(input);
  return sha256ContentHash({
    scope: assertion.scope,
    target_kind: assertion.target_kind,
    canonical_key: assertion.canonical_key,
    applicability_scope: assertion.applicability_scope,
  });
}

export async function computeSemanticAssertionHash(input: unknown) {
  return sha256ContentHash(assertionMaterial(input));
}

export async function buildSemanticAssertionCandidate(input: unknown) {
  const material = assertionMaterial(input);
  return semanticAssertionCandidateSchema.parse({
    ...material,
    identity_hash: await computeSemanticAssertionIdentityHash(material),
    assertion_hash: await computeSemanticAssertionHash(material),
  });
}

function changeSetMaterial(input: unknown) {
  const full = semanticChangeSetSchema.safeParse(input);
  if (!full.success) return semanticChangeSetMaterialSchema.parse(input);
  const { change_set_hash: _changeSetHash, ...material } = full.data;
  return semanticChangeSetMaterialSchema.parse(material);
}

export async function computeSemanticChangeSetHash(input: unknown) {
  return sha256ContentHash(changeSetMaterial(input));
}

export async function buildSemanticChangeSet(input: unknown) {
  const material = changeSetMaterial(input);
  return semanticChangeSetSchema.parse({
    ...material,
    change_set_hash: await computeSemanticChangeSetHash(material),
  });
}

export async function verifySemanticChangeSet(input: unknown) {
  const changeSet = semanticChangeSetSchema.parse(input);
  if ((await computeSemanticChangeSetHash(changeSet)) !== changeSet.change_set_hash) {
    throw new TypeError("SEMANTIC_CHANGE_SET_HASH_MISMATCH");
  }
  for (const assertion of changeSet.assertions) {
    if (
      (await computeSemanticAssertionIdentityHash(assertion)) !== assertion.identity_hash ||
      (await computeSemanticAssertionHash(assertion)) !== assertion.assertion_hash
    ) {
      throw new TypeError("SEMANTIC_ASSERTION_HASH_MISMATCH");
    }
  }
  return changeSet;
}

export async function computeSemanticReviewDecisionHash(input: unknown) {
  const full = semanticReviewDecisionSchema.safeParse(input);
  const material = full.success
    ? semanticReviewDecisionMaterialSchema.parse(
        Object.fromEntries(Object.entries(full.data).filter(([key]) => key !== "review_hash")),
      )
    : semanticReviewDecisionMaterialSchema.parse(input);
  return sha256ContentHash(material);
}

export async function buildSemanticReviewDecision(input: unknown) {
  const material = semanticReviewDecisionMaterialSchema.parse(input);
  return semanticReviewDecisionSchema.parse({
    ...material,
    review_hash: await computeSemanticReviewDecisionHash(material),
  });
}

export async function verifySemanticReviewDecision(input: unknown) {
  const decision = semanticReviewDecisionSchema.parse(input);
  if ((await computeSemanticReviewDecisionHash(decision)) !== decision.review_hash) {
    throw new TypeError("SEMANTIC_REVIEW_DECISION_HASH_MISMATCH");
  }
  return decision;
}

export async function computeSemanticPublicationReceiptHash(input: unknown) {
  const full = semanticPublicationReceiptSchema.safeParse(input);
  const material = full.success
    ? semanticPublicationReceiptMaterialSchema.parse(
        Object.fromEntries(Object.entries(full.data).filter(([key]) => key !== "publication_hash")),
      )
    : semanticPublicationReceiptMaterialSchema.parse(input);
  return sha256ContentHash(material);
}

export async function buildSemanticPublicationReceipt(input: unknown) {
  const material = semanticPublicationReceiptMaterialSchema.parse(input);
  return semanticPublicationReceiptSchema.parse({
    ...material,
    publication_hash: await computeSemanticPublicationReceiptHash(material),
  });
}

export async function verifySemanticPublicationReceipt(input: unknown) {
  const receipt = semanticPublicationReceiptSchema.parse(input);
  if ((await computeSemanticPublicationReceiptHash(receipt)) !== receipt.publication_hash) {
    throw new TypeError("SEMANTIC_PUBLICATION_RECEIPT_HASH_MISMATCH");
  }
  return receipt;
}

export type SemanticAssertionSourceKind = z.infer<typeof semanticAssertionSourceKindSchema>;
export type SemanticAssertionTargetKind = z.infer<typeof semanticAssertionTargetKindSchema>;
export type SemanticAssertionEvidence = z.infer<typeof semanticAssertionEvidenceSchema>;
export type SemanticAssertionCandidate = z.infer<typeof semanticAssertionCandidateSchema>;
export type SemanticAssertionConflict = z.infer<typeof semanticAssertionConflictSchema>;
export type SemanticChangeSetValidation = z.infer<typeof semanticChangeSetValidationSchema>;
export type SemanticChangeSet = z.infer<typeof semanticChangeSetSchema>;
export type SemanticCompetencyCase = z.infer<typeof semanticCompetencyCaseSchema>;
export type SemanticCompetencyResult = z.infer<typeof semanticCompetencyResultSchema>;
export type SemanticReviewDecision = z.infer<typeof semanticReviewDecisionSchema>;
export type SemanticPublicationReceipt = z.infer<typeof semanticPublicationReceiptSchema>;
export type StageReviewedSemanticSuccessorCommand = z.infer<
  typeof stageReviewedSemanticSuccessorCommandSchema
>;
export type SemanticSuccessorStage = z.infer<typeof semanticSuccessorStageSchema>;
export type SemanticSuccessorProjectionSet = z.infer<typeof semanticSuccessorProjectionSetSchema>;
export type SemanticSuccessorStageEnvelope = z.infer<typeof semanticSuccessorStageEnvelopeSchema>;
export type SemanticRuntimeClosureValidationReceipt = z.infer<
  typeof semanticRuntimeClosureValidationReceiptSchema
>;
export type SemanticRuntimeSmokeReceipt = z.infer<typeof semanticRuntimeSmokeReceiptSchema>;
export type SemanticSuccessorStageLoadCommand = z.infer<
  typeof semanticSuccessorStageLoadCommandSchema
>;
export type SemanticSuccessorReleaseLoadCommand = z.infer<
  typeof semanticSuccessorReleaseLoadCommandSchema
>;
export type SemanticSuccessorSmokeCommitCommand = z.infer<
  typeof semanticSuccessorSmokeCommitCommandSchema
>;
