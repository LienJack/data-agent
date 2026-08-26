import { z } from "zod";
import { contentHashSchema, immutableIdSchema, sha256ContentHash } from "../common/index.js";
import { falcon24AuthorityBaselineSchema } from "../evals/falcon24-authority-baseline.js";

export const FALCON24_AUTHORITY_EPOCH = "E1" as const;
export const FALCON24_E1_STAGING_COMPONENTS = Object.freeze([
  "AGENT_PROFILES",
  "DATASET",
  "LLM_CONFIGURATION",
  "OPERATOR_REGISTRY",
  "SANDBOX_RUNTIME",
  "SEMANTIC_RELEASE",
] as const);

export const falcon24AuthorityEpochSchema = z.literal(FALCON24_AUTHORITY_EPOCH);
export const falcon24E1StagingComponentSchema = z.enum(FALCON24_E1_STAGING_COMPONENTS);

const stableFailureCodeSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]{2,127}$/u);

export const falcon24AuthorityBindingSchema = z.strictObject({
  schema_version: z.literal("falcon24-authority-binding@1.0.0"),
  authority_epoch: falcon24AuthorityEpochSchema,
  baseline_id: immutableIdSchema,
  baseline_hash: contentHashSchema,
  activation_attempt_id: immutableIdSchema,
});

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

const falcon24E1StagingReceiptMaterialSchema = z
  .strictObject({
    schema_version: z.literal("falcon24-e1-staging-receipt@1.0.0"),
    staging_id: immutableIdSchema,
    component: falcon24E1StagingComponentSchema,
    subject_hash: contentHashSchema,
    evidence_hash: contentHashSchema,
    production_isolation_proven: z.boolean(),
  })
  .superRefine((receipt, context) => {
    if (receipt.component !== "SANDBOX_RUNTIME" && receipt.production_isolation_proven) {
      context.addIssue({
        code: "custom",
        message: "只有 SANDBOX_RUNTIME receipt 可以声明 production isolation proof。",
        path: ["production_isolation_proven"],
      });
    }
  });

export const falcon24E1StagingReceiptSchema = falcon24E1StagingReceiptMaterialSchema.extend({
  receipt_hash: contentHashSchema,
});

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

export const falcon24E1StageBaselineRequestSchema = z.strictObject({
  staging_id: immutableIdSchema,
  baseline: falcon24AuthorityBaselineSchema,
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

export const falcon24RunAuthorityLookupSchema = z.strictObject({
  run_id: immutableIdSchema,
});

export type Falcon24AuthorityBinding = z.infer<typeof falcon24AuthorityBindingSchema>;
export type Falcon24AuthorityPersistenceBinding = z.infer<
  typeof falcon24AuthorityPersistenceBindingSchema
>;
export type Falcon24E1StagingReceipt = z.infer<typeof falcon24E1StagingReceiptSchema>;
export type Falcon24E1ActivationAttempt = z.infer<typeof falcon24E1ActivationAttemptSchema>;
