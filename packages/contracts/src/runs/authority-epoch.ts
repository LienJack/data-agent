import { z } from "zod";
import { artifactReferenceSchema } from "../artifacts/envelope.js";
import { semanticScopeSchema } from "../artifacts/semantic-control-plane.js";
import {
  semanticRuntimeSmokeReceiptReferenceSchema,
  semanticSuccessorCandidateReleaseReferenceSchema,
  semanticSuccessorStageReferenceSchema,
} from "../artifacts/semantic-lifecycle.js";
import { contentHashSchema, immutableIdSchema, sha256ContentHash } from "../common/index.js";
import {
  falcon24AuthorityBaselineSchema,
  falcon24AuthorityBaselineV2Schema,
} from "../evals/falcon24-authority-baseline.js";
import {
  FALCON24_E1_AUTHORITY_EPOCH,
  falcon24AuthorityEpochSchema,
  falcon24E1AuthorityEpochSchema,
  falcon24SuccessorAuthorityEpochSchema,
} from "./falcon24-authority-identity.js";

export const FALCON24_AUTHORITY_EPOCH = FALCON24_E1_AUTHORITY_EPOCH;
export const FALCON24_E1_STAGING_COMPONENTS = Object.freeze([
  "AGENT_PROFILES",
  "DATASET",
  "LLM_CONFIGURATION",
  "OPERATOR_REGISTRY",
  "SANDBOX_RUNTIME",
  "SEMANTIC_RELEASE",
] as const);

export { falcon24AuthorityEpochSchema } from "./falcon24-authority-identity.js";
export const falcon24E1StagingComponentSchema = z.enum(FALCON24_E1_STAGING_COMPONENTS);

const stableFailureCodeSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]{2,127}$/u);

export const falcon24AuthorityBindingV1Schema = z.strictObject({
  schema_version: z.literal("falcon24-authority-binding@1.0.0"),
  authority_epoch: falcon24E1AuthorityEpochSchema,
  baseline_id: immutableIdSchema,
  baseline_hash: contentHashSchema,
  activation_attempt_id: immutableIdSchema,
});

export const falcon24AuthorityBindingV2Schema = z.strictObject({
  schema_version: z.literal("falcon24-authority-binding@2.0.0"),
  authority_epoch: falcon24SuccessorAuthorityEpochSchema,
  baseline_id: immutableIdSchema,
  baseline_hash: contentHashSchema,
  activation_attempt_id: immutableIdSchema,
});

export const falcon24AuthorityBindingSchema = z.union([
  falcon24AuthorityBindingV1Schema,
  falcon24AuthorityBindingV2Schema,
]);

export const falcon24AuthorityPersistenceBindingSchema = z.strictObject({
  authority_epoch: falcon24AuthorityEpochSchema,
  authority_baseline_id: immutableIdSchema,
  authority_baseline_hash: contentHashSchema,
  authority_activation_attempt_id: immutableIdSchema,
});

export const falcon24E1StagingSessionRequestSchema = z.strictObject({
  staging_id: immutableIdSchema,
  retained_assets_hash: contentHashSchema,
});

export const falcon24StagingSessionRequestV2Schema = z.strictObject({
  schema_version: z.literal("falcon24-staging-session@2.0.0"),
  authority_epoch: falcon24SuccessorAuthorityEpochSchema,
  staging_id: immutableIdSchema,
  retained_assets_hash: contentHashSchema,
});

function addStagingReceiptIsolationIssue(
  receipt: {
    component: z.infer<typeof falcon24E1StagingComponentSchema>;
    production_isolation_proven: boolean;
  },
  context: z.RefinementCtx,
): void {
  if (receipt.component !== "SANDBOX_RUNTIME" && receipt.production_isolation_proven) {
    context.addIssue({
      code: "custom",
      message: "只有 SANDBOX_RUNTIME receipt 可以声明 production isolation proof。",
      path: ["production_isolation_proven"],
    });
  }
}

const falcon24E1StagingReceiptMaterialSchema = z
  .strictObject({
    schema_version: z.literal("falcon24-e1-staging-receipt@1.0.0"),
    staging_id: immutableIdSchema,
    component: falcon24E1StagingComponentSchema,
    subject_hash: contentHashSchema,
    evidence_hash: contentHashSchema,
    production_isolation_proven: z.boolean(),
  })
  .superRefine(addStagingReceiptIsolationIssue);

export const falcon24E1StagingReceiptSchema = falcon24E1StagingReceiptMaterialSchema.extend({
  receipt_hash: contentHashSchema,
});

const falcon24StagingReceiptV2MaterialSchema = z
  .strictObject({
    ...falcon24E1StagingReceiptMaterialSchema.shape,
    schema_version: z.literal("falcon24-staging-receipt@2.0.0"),
    authority_epoch: falcon24SuccessorAuthorityEpochSchema,
  })
  .superRefine(addStagingReceiptIsolationIssue);

export const falcon24StagingReceiptV2Schema = falcon24StagingReceiptV2MaterialSchema.extend({
  receipt_hash: contentHashSchema,
});

export const falcon24StagingReceiptDocumentSchema = z.union([
  falcon24E1StagingReceiptSchema,
  falcon24StagingReceiptV2Schema,
]);

export async function buildFalcon24E1StagingReceipt(input: unknown) {
  const material = falcon24E1StagingReceiptMaterialSchema.parse(input);
  return falcon24E1StagingReceiptSchema.parse({
    ...material,
    receipt_hash: await sha256ContentHash(material),
  });
}

export async function verifyFalcon24E1StagingReceipt(input: unknown) {
  const receipt = falcon24E1StagingReceiptSchema.parse(input);
  const { receipt_hash: observedHash, ...material } = receipt;
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("FALCON24_E1_STAGING_RECEIPT_HASH_INVALID");
  }
  return receipt;
}

export async function buildFalcon24StagingReceiptV2(input: unknown) {
  const material = falcon24StagingReceiptV2MaterialSchema.parse(input);
  return falcon24StagingReceiptV2Schema.parse({
    ...material,
    receipt_hash: await sha256ContentHash(material),
  });
}

export async function verifyFalcon24StagingReceiptV2(input: unknown) {
  const receipt = falcon24StagingReceiptV2Schema.parse(input);
  const { receipt_hash: observedHash, ...material } = receipt;
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("FALCON24_STAGING_RECEIPT_HASH_INVALID");
  }
  return receipt;
}

export const falcon24E1StageBaselineRequestSchema = z.strictObject({
  staging_id: immutableIdSchema,
  baseline: falcon24AuthorityBaselineSchema,
});

export const falcon24StageBaselineRequestV2Schema = z
  .strictObject({
    schema_version: z.literal("falcon24-stage-baseline-request@2.0.0"),
    authority_epoch: falcon24SuccessorAuthorityEpochSchema,
    staging_id: immutableIdSchema,
    baseline: falcon24AuthorityBaselineV2Schema,
  })
  .superRefine((request, context) => {
    if (request.authority_epoch !== request.baseline.authority_epoch) {
      context.addIssue({
        code: "custom",
        message: "baseline authority_epoch 必须与 staging request 一致。",
        path: ["baseline", "authority_epoch"],
      });
    }
  });

export const falcon24E1ActivationAttemptRequestSchema = z.strictObject({
  attempt_id: immutableIdSchema,
  baseline_id: immutableIdSchema,
  expected_baseline_hash: contentHashSchema,
});

export const falcon24E1ActivationHoldRequestSchema =
  falcon24E1ActivationAttemptRequestSchema.extend({
    failure_code: stableFailureCodeSchema,
  });

export const falcon24E1ActivationRequestSchema = falcon24E1ActivationAttemptRequestSchema;

export const falcon24ActivationAttemptRequestV2Schema = z.strictObject({
  schema_version: z.literal("falcon24-activation-request@2.0.0"),
  authority_epoch: falcon24SuccessorAuthorityEpochSchema,
  attempt_id: immutableIdSchema,
  baseline_id: immutableIdSchema,
  expected_baseline_hash: contentHashSchema,
});

export const falcon24ActivationHoldRequestV2Schema =
  falcon24ActivationAttemptRequestV2Schema.extend({
    failure_code: stableFailureCodeSchema,
  });

export const falcon24ActivationRequestV2Schema = falcon24ActivationAttemptRequestV2Schema;

const combinedFalcon24SemanticActivationExpectedVersionsSchema = z.strictObject({
  semantic_pointer: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  semantic_runtime: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  workspace_defaults: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});

const combinedFalcon24SemanticActivationCommandMaterialSchema = z
  .strictObject({
    schema_version: z.literal("combined-falcon24-semantic-activation-command@1.0.0"),
    command_id: immutableIdSchema,
    idempotency_key: z.string().trim().min(1).max(256),
    scope: semanticScopeSchema,
    authority_epoch: z.literal("E4"),
    expected_current_authority: falcon24AuthorityBindingV2Schema,
    expected_semantic_predecessor: semanticSuccessorCandidateReleaseReferenceSchema,
    stage_ref: semanticSuccessorStageReferenceSchema,
    smoke_receipt_ref: semanticRuntimeSmokeReceiptReferenceSchema,
    baseline_ref: z.strictObject({
      baseline_id: immutableIdSchema,
      baseline_hash: contentHashSchema,
    }),
    activation_attempt_ref: z.strictObject({
      activation_attempt_id: immutableIdSchema,
    }),
    expected_versions: combinedFalcon24SemanticActivationExpectedVersionsSchema,
  })
  .superRefine((command, context) => {
    if (
      command.expected_current_authority.authority_epoch !== "E3" ||
      command.expected_semantic_predecessor.generation !== 1
    ) {
      context.addIssue({
        code: "custom",
        message: "COMBINED_FALCON24_SEMANTIC_ACTIVATION_PREDECESSOR_INVALID",
        path: ["expected_current_authority"],
      });
    }
  });

export const combinedFalcon24SemanticActivationCommandSchema =
  combinedFalcon24SemanticActivationCommandMaterialSchema.extend({
    command_hash: contentHashSchema,
  });

function combinedFalcon24SemanticActivationCommandMaterial(input: unknown) {
  const full = combinedFalcon24SemanticActivationCommandSchema.safeParse(input);
  if (!full.success) return combinedFalcon24SemanticActivationCommandMaterialSchema.parse(input);
  const { command_hash: _commandHash, ...material } = full.data;
  return combinedFalcon24SemanticActivationCommandMaterialSchema.parse(material);
}

export async function computeCombinedFalcon24SemanticActivationCommandHash(input: unknown) {
  return sha256ContentHash({
    hash_domain: "combined-falcon24-semantic-activation-command@1.0.0",
    command: combinedFalcon24SemanticActivationCommandMaterial(input),
  });
}

export async function buildCombinedFalcon24SemanticActivationCommand(input: unknown) {
  const material = combinedFalcon24SemanticActivationCommandMaterial(input);
  return combinedFalcon24SemanticActivationCommandSchema.parse({
    ...material,
    command_hash: await computeCombinedFalcon24SemanticActivationCommandHash(material),
  });
}

export async function verifyCombinedFalcon24SemanticActivationCommand(input: unknown) {
  const command = combinedFalcon24SemanticActivationCommandSchema.parse(input);
  if (
    (await computeCombinedFalcon24SemanticActivationCommandHash(command)) !== command.command_hash
  ) {
    throw new TypeError("COMBINED_FALCON24_SEMANTIC_ACTIVATION_COMMAND_HASH_INVALID");
  }
  return command;
}

const combinedFalcon24SemanticActivationReceiptMaterialSchema = z
  .strictObject({
    schema_version: z.literal("combined-falcon24-semantic-activation-receipt@1.0.0"),
    command_id: immutableIdSchema,
    command_hash: contentHashSchema,
    scope: semanticScopeSchema,
    authority: falcon24AuthorityBindingV2Schema,
    semantic_release: semanticSuccessorCandidateReleaseReferenceSchema,
    workspace_defaults: z.strictObject({
      version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
      semantic_release: semanticSuccessorCandidateReleaseReferenceSchema,
    }),
    stage_ref: semanticSuccessorStageReferenceSchema,
    smoke_receipt_ref: semanticRuntimeSmokeReceiptReferenceSchema,
    outbox_event_id: immutableIdSchema,
    transaction_id: z.string().trim().min(1).max(256),
  })
  .superRefine((receipt, context) => {
    const release = receipt.semantic_release;
    const defaultsRelease = receipt.workspace_defaults.semantic_release;
    if (
      receipt.authority.authority_epoch !== "E4" ||
      release.generation !== 2 ||
      release.release_id !== defaultsRelease.release_id ||
      release.generation !== defaultsRelease.generation ||
      release.release_digest !== defaultsRelease.release_digest ||
      release.datasource_id !== defaultsRelease.datasource_id
    ) {
      context.addIssue({
        code: "custom",
        message: "COMBINED_FALCON24_SEMANTIC_ACTIVATION_RECEIPT_CLOSURE_INVALID",
        path: ["workspace_defaults", "semantic_release"],
      });
    }
  });

export const combinedFalcon24SemanticActivationReceiptSchema =
  combinedFalcon24SemanticActivationReceiptMaterialSchema.extend({
    activation_receipt_hash: contentHashSchema,
  });

function combinedFalcon24SemanticActivationReceiptMaterial(input: unknown) {
  const full = combinedFalcon24SemanticActivationReceiptSchema.safeParse(input);
  if (!full.success) return combinedFalcon24SemanticActivationReceiptMaterialSchema.parse(input);
  const { activation_receipt_hash: _receiptHash, ...material } = full.data;
  return combinedFalcon24SemanticActivationReceiptMaterialSchema.parse(material);
}

export async function computeCombinedFalcon24SemanticActivationReceiptHash(input: unknown) {
  return sha256ContentHash({
    hash_domain: "combined-falcon24-semantic-activation-receipt@1.0.0",
    receipt: combinedFalcon24SemanticActivationReceiptMaterial(input),
  });
}

export async function buildCombinedFalcon24SemanticActivationReceipt(input: unknown) {
  const material = combinedFalcon24SemanticActivationReceiptMaterial(input);
  return combinedFalcon24SemanticActivationReceiptSchema.parse({
    ...material,
    activation_receipt_hash: await computeCombinedFalcon24SemanticActivationReceiptHash(material),
  });
}

export async function verifyCombinedFalcon24SemanticActivationReceipt(input: unknown) {
  const receipt = combinedFalcon24SemanticActivationReceiptSchema.parse(input);
  if (
    (await computeCombinedFalcon24SemanticActivationReceiptHash(receipt)) !==
    receipt.activation_receipt_hash
  ) {
    throw new TypeError("COMBINED_FALCON24_SEMANTIC_ACTIVATION_RECEIPT_HASH_INVALID");
  }
  return receipt;
}

export const falcon24E1ActivationAttemptSchema = z
  .strictObject({
    schema_version: z.literal("falcon24-e1-activation-attempt@1.0.0"),
    attempt_id: immutableIdSchema,
    baseline_id: immutableIdSchema,
    expected_baseline_hash: contentHashSchema,
    status: z.enum(["OPEN", "HOLD", "ACTIVATED"]),
    failure_code: stableFailureCodeSchema.nullable(),
  })
  .superRefine((attempt, context) => {
    if ((attempt.status === "HOLD") !== (attempt.failure_code !== null)) {
      context.addIssue({
        code: "custom",
        message: "只有 HOLD activation attempt 必须携带 failure_code。",
        path: ["failure_code"],
      });
    }
  });

export const falcon24ActivationAttemptV2Schema = z
  .strictObject({
    schema_version: z.literal("falcon24-activation-attempt@2.0.0"),
    authority_epoch: falcon24SuccessorAuthorityEpochSchema,
    attempt_id: immutableIdSchema,
    baseline_id: immutableIdSchema,
    expected_baseline_hash: contentHashSchema,
    status: z.enum(["OPEN", "HOLD", "ACTIVATED"]),
    failure_code: stableFailureCodeSchema.nullable(),
  })
  .superRefine((attempt, context) => {
    if ((attempt.status === "HOLD") !== (attempt.failure_code !== null)) {
      context.addIssue({
        code: "custom",
        message: "只有 HOLD activation attempt 必须携带 failure_code。",
        path: ["failure_code"],
      });
    }
  });

export const falcon24ActivationAttemptDocumentSchema = z.union([
  falcon24E1ActivationAttemptSchema,
  falcon24ActivationAttemptV2Schema,
]);

export const falcon24RunAuthorityLookupSchema = z.strictObject({
  run_id: immutableIdSchema,
});

const falcon24E1UiReceiptCommonSchema = z.strictObject({
  run_id: immutableIdSchema,
  conversation_id: immutableIdSchema,
  authority: falcon24AuthorityBindingV1Schema,
  web_build: z.strictObject({ build_id: contentHashSchema, generation_id: contentHashSchema }),
  browser_harness_version: z.literal("falcon24-agent-browser-trace-gate@2.0.0"),
  viewport: z.strictObject({
    width: z.union([z.literal(390), z.literal(1440)]),
    height: z.number().int().min(640).max(2400),
  }),
  error_banner: z.null(),
  dom_snapshot_hash: contentHashSchema,
  screenshot_hash: contentHashSchema,
  observed_at: z.iso.datetime({ offset: true }),
});

const falcon24QaE2eReceiptMaterialSchema = falcon24E1UiReceiptCommonSchema.extend({
  schema_version: z.literal("falcon24-qa-e2e-receipt@1.0.0"),
  entry_path: z.literal("QUESTION_COMPOSER_SUBMIT_TO_RESULT"),
  question_hash: contentHashSchema,
  terminal_status: z.literal("COMPLETED"),
  answer_visible: z.literal(true),
  table_visible: z.literal(true),
  chart_rendered: z.literal(true),
  report_visible: z.literal(true),
});
export const falcon24QaE2eReceiptSchema = falcon24QaE2eReceiptMaterialSchema.extend({
  receipt_hash: contentHashSchema,
});

const falcon24TraceUiReceiptMaterialSchema = falcon24E1UiReceiptCommonSchema.extend({
  schema_version: z.literal("falcon24-trace-ui-receipt@1.0.0"),
  trace_hash: contentHashSchema,
  entry_path: z.literal("RESULT_TRACE_ENTRY_TO_EXACT_RUN"),
  opened_nodes: z
    .array(z.strictObject({ node_id: z.string().min(1).max(320), detail_hash: contentHashSchema }))
    .min(1),
  opened_artifact_refs: z.array(artifactReferenceSchema).length(5),
  chart_ref: artifactReferenceSchema,
  chart_rendered: z.literal(true),
  source_table_visible: z.literal(true),
  returned_to_result: z.literal(true),
});
export const falcon24TraceUiReceiptSchema = falcon24TraceUiReceiptMaterialSchema.extend({
  receipt_hash: contentHashSchema,
});
export const falcon24E1UiReceiptSchema = z.union([
  falcon24QaE2eReceiptSchema,
  falcon24TraceUiReceiptSchema,
]);

const falcon24QaE2eReceiptV2MaterialSchema = z.strictObject({
  ...falcon24QaE2eReceiptMaterialSchema.shape,
  schema_version: z.literal("falcon24-qa-e2e-receipt@2.0.0"),
  authority: falcon24AuthorityBindingV2Schema,
});
export const falcon24QaE2eReceiptV2Schema = falcon24QaE2eReceiptV2MaterialSchema.extend({
  receipt_hash: contentHashSchema,
});

const falcon24TraceUiReceiptV2MaterialSchema = z.strictObject({
  ...falcon24TraceUiReceiptMaterialSchema.shape,
  schema_version: z.literal("falcon24-trace-ui-receipt@2.0.0"),
  authority: falcon24AuthorityBindingV2Schema,
});
export const falcon24TraceUiReceiptV2Schema = falcon24TraceUiReceiptV2MaterialSchema.extend({
  receipt_hash: contentHashSchema,
});

export const falcon24UiReceiptV2Schema = z.union([
  falcon24QaE2eReceiptV2Schema,
  falcon24TraceUiReceiptV2Schema,
]);
export const falcon24UiReceiptDocumentSchema = z.union([
  falcon24E1UiReceiptSchema,
  falcon24UiReceiptV2Schema,
]);

export async function buildFalcon24QaE2eReceipt(input: unknown) {
  const material = falcon24QaE2eReceiptMaterialSchema.parse(input);
  return falcon24QaE2eReceiptSchema.parse({
    ...material,
    receipt_hash: await sha256ContentHash(material),
  });
}

export async function buildFalcon24TraceUiReceipt(input: unknown) {
  const material = falcon24TraceUiReceiptMaterialSchema.parse(input);
  return falcon24TraceUiReceiptSchema.parse({
    ...material,
    receipt_hash: await sha256ContentHash(material),
  });
}

export async function verifyFalcon24E1UiReceipt(input: unknown) {
  const receipt = falcon24E1UiReceiptSchema.parse(input);
  const { receipt_hash: observedHash, ...material } = receipt;
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("FALCON24_E1_UI_RECEIPT_HASH_INVALID");
  }
  return receipt;
}

export async function buildFalcon24QaE2eReceiptV2(input: unknown) {
  const material = falcon24QaE2eReceiptV2MaterialSchema.parse(input);
  return falcon24QaE2eReceiptV2Schema.parse({
    ...material,
    receipt_hash: await sha256ContentHash(material),
  });
}

export async function buildFalcon24TraceUiReceiptV2(input: unknown) {
  const material = falcon24TraceUiReceiptV2MaterialSchema.parse(input);
  return falcon24TraceUiReceiptV2Schema.parse({
    ...material,
    receipt_hash: await sha256ContentHash(material),
  });
}

export async function verifyFalcon24UiReceiptDocument(input: unknown) {
  const receipt = falcon24UiReceiptDocumentSchema.parse(input);
  const { receipt_hash: observedHash, ...material } = receipt;
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("FALCON24_UI_RECEIPT_HASH_INVALID");
  }
  return receipt;
}

export type Falcon24AuthorityBinding = z.infer<typeof falcon24AuthorityBindingSchema>;
export type Falcon24AuthorityBindingV2 = z.infer<typeof falcon24AuthorityBindingV2Schema>;
export type Falcon24AuthorityPersistenceBinding = z.infer<
  typeof falcon24AuthorityPersistenceBindingSchema
>;
export type Falcon24E1StagingReceipt = z.infer<typeof falcon24E1StagingReceiptSchema>;
export type Falcon24StagingReceiptV2 = z.infer<typeof falcon24StagingReceiptV2Schema>;
export type Falcon24E1ActivationAttempt = z.infer<typeof falcon24E1ActivationAttemptSchema>;
export type Falcon24E1UiReceipt = z.infer<typeof falcon24E1UiReceiptSchema>;
export type Falcon24ActivationAttemptV2 = z.infer<typeof falcon24ActivationAttemptV2Schema>;
export type Falcon24UiReceiptV2 = z.infer<typeof falcon24UiReceiptV2Schema>;
export type CombinedFalcon24SemanticActivationCommand = z.infer<
  typeof combinedFalcon24SemanticActivationCommandSchema
>;
export type CombinedFalcon24SemanticActivationReceipt = z.infer<
  typeof combinedFalcon24SemanticActivationReceiptSchema
>;
